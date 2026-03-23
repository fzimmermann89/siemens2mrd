import type { MappingSelection } from "./mappings";
import { findMappingAsset } from "./mappings";
import type { TwixInspectionResult, TwixMeasurementEntry } from "./twix";
import type { ConversionParameters, ConverterSettings, EditableHeaderField } from "./headerDraft";
import { getChildNodeByName, getStringValueArray, parseXProtocol } from "./xprotocol";

const ISMRMRD_NS = "http://www.ismrm.org/ISMRMRD";
const XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8"?>';
const assetCache = new Map<string, Promise<string>>();

interface ParameterMapEntry {
  source: string;
  destination: string;
}

export interface HeaderDraftParameters extends ConversionParameters {}

export interface HeaderDraftDocument {
  xml: string;
  sourceXml: string;
  fields: EditableHeaderField[];
  parameters: HeaderDraftParameters;
}

export async function buildHeaderDraftDocument(
  inspection: TwixInspectionResult,
  measurement: TwixMeasurementEntry,
  selection: MappingSelection,
  settings: ConverterSettings
): Promise<HeaderDraftDocument> {
  const searchableText = (measurement.buffers ?? [])
    .map((buffer) => buffer.text ?? "")
    .filter(Boolean)
    .join("\n");

  const [parameterMapXml, xsltText] = await Promise.all([
    loadAssetText(selection.selectedXml, "xml"),
    loadAssetText(selection.selectedXsl, "xsl")
  ]);

  const measBuffer = measurement.buffers?.find((buffer) => buffer.name === "Meas" && buffer.text)?.text;
  if (!measBuffer) {
    throw new Error("No Meas buffer found in Siemens dataset");
  }

  const xprotocol = parseXProtocol(measBuffer);
  const mapEntries = parseParameterMap(parameterMapXml);
  const sourceDoc = buildSiemensSourceDocument(mapEntries, xprotocol);
  const headerDoc = transformToIsmrmrdHeader(sourceDoc, xsltText);

  appendProtocolBuffers(headerDoc, measurement, settings);

  const fields = flattenEditableFields(headerDoc);
  const sourceXml = serializeXml(sourceDoc);
  const xml = serializeXml(headerDoc);
  const parameters = deriveConversionParameters(headerDoc, sourceDoc, inspection);

  return { xml, sourceXml, fields, parameters };
}

export function applyHeaderFieldEditsToXml(xml: string, fields: EditableHeaderField[]): string {
  const doc = parseXmlDocument(xml, "apply header field edits");
  for (const field of fields) {
    const element = findElementByPath(doc.documentElement, field.xmlPath);
    if (element) {
      element.textContent = field.value;
    }
  }
  return serializeXml(doc);
}

export function ensureWaveformInformationInXml(xml: string): string {
  const doc = parseXmlDocument(xml, "append waveform information");
  appendWaveformInformation(doc);
  return serializeXml(doc);
}

export function extractEditableFieldsFromXml(xml: string): EditableHeaderField[] {
  const doc = parseXmlDocument(xml, "extract editable header fields");
  return flattenEditableFields(doc);
}

function loadAssetText(name: string, kind: "xml" | "xsl"): Promise<string> {
  const asset = findMappingAsset(name, kind);
  if (!asset) {
    throw new Error(`Missing ${kind.toUpperCase()} asset: ${name}`);
  }
  const cached = assetCache.get(asset.path);
  if (cached) return cached;
  const request = fetch(asset.path).then(async (response) => {
    if (!response.ok) {
      throw new Error(`Failed to load ${asset.path}`);
    }
    return response.text();
  });
  assetCache.set(asset.path, request);
  return request;
}

function parseParameterMap(xml: string): ParameterMapEntry[] {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const entries = Array.from(doc.getElementsByTagName("p"));
  return entries.flatMap((entry) => {
    const source = entry.getElementsByTagName("s")[0]?.textContent?.trim() ?? "";
    const destination = entry.getElementsByTagName("d")[0]?.textContent?.trim() ?? "";
    return source && destination ? [{ source, destination }] : [];
  });
}

function buildSiemensSourceDocument(entries: ParameterMapEntry[], xprotocol: ReturnType<typeof parseXProtocol>): XMLDocument {
  const doc = document.implementation.createDocument(null, "siemens");
  const root = doc.documentElement;

  for (const entry of entries) {
    const values = resolveSourceValues(xprotocol, entry.source);
    if (values.length === 0) continue;
    appendDestinationValues(doc, root, entry.destination, values);
  }

  return doc;
}

function resolveSourceValues(xprotocol: ReturnType<typeof parseXProtocol>, source: string): string[] {
  const parts = source.split(".");
  if (parts.length === 0) return [];

  let searchPath = source;
  let index = -1;
  const last = parts[parts.length - 1] ?? "";
  if (/^\d+$/.test(last)) {
    index = Number.parseInt(last, 10);
    searchPath = parts.slice(0, -1).join(".");
  }

  const node = getChildNodeByName(xprotocol, searchPath);
  if (!node) return [];
  const values = getStringValueArray(node);
  if (index >= 0) {
    return values[index] !== undefined ? [values[index]] : [];
  }
  return values;
}

function appendDestinationValues(doc: XMLDocument, root: Element, destination: string, values: string[]): void {
  const segments = destination.split(".");
  if (segments[0] !== "siemens") return;

  let current = root;
  for (const segment of segments.slice(1, -1)) {
    let next = findDirectChild(current, segment);
    if (!next) {
      next = doc.createElement(segment);
      current.appendChild(next);
    }
    current = next;
  }

  const leafName = segments[segments.length - 1];
  for (const value of values) {
    const leaf = doc.createElement(leafName);
    leaf.textContent = value;
    current.appendChild(leaf);
  }
}

function transformToIsmrmrdHeader(sourceDoc: XMLDocument, xsltText: string): XMLDocument {
  const parser = new DOMParser();
  const xsltDoc = parser.parseFromString(xsltText, "application/xml");
  const processor = new XSLTProcessor();
  processor.importStylesheet(xsltDoc);
  const transformed = processor.transformToDocument(sourceDoc);
  return transformed;
}

function appendProtocolBuffers(doc: XMLDocument, measurement: TwixMeasurementEntry, settings: ConverterSettings): void {
  if (!settings.bufferAppend) return;
  const root = doc.documentElement;
  const userParameters = ensureChild(doc, root, "userParameters", ISMRMRD_NS);

  for (const buffer of measurement.buffers ?? []) {
    if (!buffer.name || !buffer.text) continue;
    const base64Node = doc.createElementNS(ISMRMRD_NS, "userParameterBase64");
    const nameNode = doc.createElementNS(ISMRMRD_NS, "name");
    const valueNode = doc.createElementNS(ISMRMRD_NS, "value");
    nameNode.textContent = `SiemensBuffer_${buffer.name}`;
    valueNode.textContent = encodeBase64(buffer.text);
    base64Node.append(nameNode, valueNode);
    userParameters.appendChild(base64Node);
  }
}

function appendWaveformInformation(doc: XMLDocument): void {
  const root = doc.documentElement;
  if (!root || hasChildWithLocalName(root, "waveformInformation")) return;

  const definitions = [
    { name: "ECG", type: "ecg", triggerChannel: 4, phase: "Acquisition" },
    { name: "PULS", type: "pulse", triggerChannel: 1, phase: "Acquisition" },
    { name: "RESP", type: "respiratory", triggerChannel: 1, phase: "Acquisition" },
    { name: "EXT1", type: "other", triggerChannel: 1, phase: "Acquisition" },
    { name: "EXT2", type: "other", triggerChannel: 1, phase: "Acquisition" },
    { name: "ECG", type: "ecg", triggerChannel: 4, phase: "Learning" },
    { name: "PULS", type: "pulse", triggerChannel: 1, phase: "Learning" },
    { name: "RESP", type: "respiratory", triggerChannel: 1, phase: "Learning" },
    { name: "EXT1", type: "other", triggerChannel: 1, phase: "Learning" },
    { name: "EXT2", type: "other", triggerChannel: 1, phase: "Learning" }
  ];

  for (const definition of definitions) {
    const waveform = doc.createElementNS(ISMRMRD_NS, "waveformInformation");
    appendTextNode(doc, waveform, "waveformName", definition.name);
    appendTextNode(doc, waveform, "waveformType", definition.type);

    const userParameters = doc.createElementNS(ISMRMRD_NS, "userParameters");
    const trigger = doc.createElementNS(ISMRMRD_NS, "userParameterLong");
    appendTextNode(doc, trigger, "name", "TriggerChannel");
    appendTextNode(doc, trigger, "value", String(definition.triggerChannel));
    const phase = doc.createElementNS(ISMRMRD_NS, "userParameterString");
    appendTextNode(doc, phase, "name", "Phase");
    appendTextNode(doc, phase, "value", definition.phase);
    userParameters.append(trigger, phase);

    waveform.appendChild(userParameters);
    root.appendChild(waveform);
  }
}

function flattenEditableFields(doc: XMLDocument): EditableHeaderField[] {
  const root = doc.documentElement;
  if (!root) return [];
  const fields: EditableHeaderField[] = [];
  visitElements(root, (element) => {
    if (hasElementChildren(element)) return;
    const text = element.textContent?.trim() ?? "";
    const xmlPath = buildElementPath(element);
    if (shouldSkipEditableField(xmlPath, text)) return;
    const section = prettifyLabel(getSectionName(element));
    fields.push({
      key: xmlPath,
      label: prettifyLabel(element.localName),
      section,
      value: text,
      source: xmlPath,
      xmlPath
    });
  });
  return fields;
}

function deriveConversionParameters(headerDoc: XMLDocument, sourceDoc: XMLDocument, inspection: TwixInspectionResult): HeaderDraftParameters {
  const dwellTimeNs = parseFloat(getTextByPath(sourceDoc.documentElement, ["MEAS", "sRXSPEC", "alDwellTime"]) ?? "0");
  const receiverChannels = parseInt(
    getFirstTextByLocalName(headerDoc.documentElement, "receiverChannels") ?? getTextByPath(sourceDoc.documentElement, ["YAPS", "iMaxNoOfRxChannels"]) ?? "0",
    10
  );

  return {
    dwellTimeUs: Number.isFinite(dwellTimeNs) ? dwellTimeNs / 1000 : 0,
    availableChannels: Number.isFinite(receiverChannels) && receiverChannels > 0
      ? receiverChannels
      : inspection.measurements[0]?.headerBufferCount ?? 0
  };
}

function getTextByPath(root: Element | null, path: string[]): string | null {
  let current = root;
  for (const segment of path) {
    current = current ? findDirectChild(current, segment) : null;
    if (!current) return null;
  }
  if (!current) return null;
  return current.textContent?.trim() ?? null;
}

function buildElementPath(element: Element): string {
  const segments: string[] = [];
  let current: Element | null = element;
  while (current) {
    const siblings = current.parentElement
      ? getDirectChildrenByLocalName(current.parentElement, current.localName)
      : [current];
    const index = siblings.findIndex((sibling) => sibling === current);
    segments.push(`${current.localName}[${Math.max(index, 0)}]`);
    current = current.parentElement;
  }
  return segments.reverse().join("/");
}

function findElementByPath(root: Element, xmlPath: string): Element | null {
  const segments = xmlPath.split("/");
  let current: Element | null = root;
  if (!current) return null;
  const [rootName] = parsePathSegment(segments[0]);
  if (root.localName !== rootName) return null;

  for (const segment of segments.slice(1)) {
    if (!current) return null;
    const [name, index] = parsePathSegment(segment);
    const children = getDirectChildrenByLocalName(current, name);
    current = children[index] ?? null;
  }

  return current;
}

function parsePathSegment(segment: string): [string, number] {
  const match = /^(.+)\[(\d+)\]$/.exec(segment);
  if (!match) return [segment, 0];
  return [match[1], Number.parseInt(match[2], 10)];
}

function serializeXml(doc: XMLDocument): string {
  const serialized = new XMLSerializer()
    .serializeToString(doc)
    .replace(/^(?:\uFEFF?[\r\n\t ]*<\?xml[^>]*\?>\s*)+/i, "");
  return `${XML_DECLARATION}\n${serialized}`;
}

function normalizeXmlSource(xml: string): string {
  return xml
    .replace(/^(?:\uFEFF?[\r\n\t ]*<\?xml[^>]*\?>\s*)+/i, "");
}

function parseXmlDocument(xml: string, context: string): XMLDocument {
  const normalized = normalizeXmlSource(xml);
  const doc = new DOMParser().parseFromString(normalized, "application/xml");
  const parserError = doc.getElementsByTagName("parsererror")[0];
  if (parserError) {
    throw new Error(`Failed to ${context}: ${parserError.textContent?.trim() ?? "XML parser error"}`);
  }
  return doc;
}

function prettifyLabel(value: string): string {
  return value
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .trim();
}

function getSectionName(element: Element): string {
  const parent = element.parentElement;
  if (!parent || !parent.parentElement) return element.localName;
  if (parent.parentElement === element.ownerDocument?.documentElement) {
    return parent.localName;
  }
  return parent.localName;
}

function shouldSkipEditableField(xmlPath: string, value: string): boolean {
  if (xmlPath.includes("userParameterBase64") && xmlPath.endsWith("/value[0]")) return true;
  if (value.length > 256) return true;
  return false;
}

function getFirstTextByLocalName(root: Element | null, localName: string): string | null {
  if (!root) return null;
  let found: string | null = null;
  visitElements(root, (element) => {
    if (!found && element.localName === localName) {
      found = element.textContent?.trim() ?? null;
    }
  });
  return found;
}

function appendTextNode(doc: XMLDocument, parent: Element, name: string, value: string): void {
  const child = doc.createElementNS(ISMRMRD_NS, name);
  child.textContent = value;
  parent.appendChild(child);
}

function ensureChild(doc: XMLDocument, parent: Element, localName: string, namespaceURI: string): Element {
  const existing = findDirectChild(parent, localName);
  if (existing) return existing;
  const child = doc.createElementNS(namespaceURI, localName);
  parent.appendChild(child);
  return child;
}

function findDirectChild(parent: Element, localName: string): Element | null {
  return getDirectChildrenByLocalName(parent, localName)[0] ?? null;
}

function getDirectChildrenByLocalName(parent: Element, localName: string): Element[] {
  return Array.from(parent.children).filter((child) => child.localName === localName);
}

function hasChildWithLocalName(parent: Element, localName: string): boolean {
  return Array.from(parent.children).some((child) => child.localName === localName);
}

function hasElementChildren(element: Element): boolean {
  return Array.from(element.children).some((child) => child.nodeType === Node.ELEMENT_NODE);
}

function visitElements(root: Element, visitor: (element: Element) => void): void {
  visitor(root);
  for (const child of Array.from(root.children)) {
    visitElements(child, visitor);
  }
}

function encodeBase64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}
