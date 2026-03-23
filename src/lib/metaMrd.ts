import type { IsmrmrdAcquisitionLike } from "./converter";
import type { IsmrmrdMetaAcquisition, IsmrmrdMetaSummary } from "./ismrmrdHdf5";

export interface MetaMrdDetails extends IsmrmrdMetaSummary {
  file: File;
}

export function mergeHeaderWithMeta(baseHeaderXml: string, metaHeaderXml: string): string {
  const baseDoc = parseXml(baseHeaderXml, "base header");
  const metaDoc = parseXml(metaHeaderXml, "meta header");
  const baseRoot = requireRoot(baseDoc, "base");
  const metaRoot = requireRoot(metaDoc, "meta");
  const baseEncodings = getDirectChildrenByLocalName(baseRoot, "encoding");
  const metaEncodings = getDirectChildrenByLocalName(metaRoot, "encoding");

  if (metaEncodings.length === 0) {
    throw new Error("Meta MRD header does not contain any encoding elements");
  }

  for (const encoding of baseEncodings) {
    baseRoot.removeChild(encoding);
  }

  for (const encoding of metaEncodings) {
    baseRoot.appendChild(baseDoc.importNode(encoding, true));
  }

  return serializeXml(baseDoc);
}

export function applyMetaTrajectory(
  acquisition: IsmrmrdAcquisitionLike,
  metaAcquisition: IsmrmrdMetaAcquisition,
  index: number
): IsmrmrdAcquisitionLike {
  if (acquisition.head.number_of_samples !== metaAcquisition.numberOfSamples) {
    throw new Error(
      `Meta MRD acquisition ${index + 1} sample count mismatch: data=${acquisition.head.number_of_samples}, meta=${metaAcquisition.numberOfSamples}`
    );
  }

  return {
    ...acquisition,
    head: {
      ...acquisition.head,
      trajectory_dimensions: metaAcquisition.trajectoryDimensions
    },
    traj: metaAcquisition.trajectory
  };
}

function parseXml(xml: string, label: string): XMLDocument {
  const normalized = xml.replace(/^\uFEFF?[\r\n\t ]*/, "");
  const doc = new DOMParser().parseFromString(normalized, "application/xml");
  const parserError = doc.getElementsByTagName("parsererror")[0];
  if (parserError) {
    throw new Error(`Failed to parse ${label}: ${parserError.textContent?.trim() ?? "XML parser error"}`);
  }
  return doc;
}

function requireRoot(doc: XMLDocument, label: string): Element {
  const root = doc.documentElement;
  if (!root) {
    throw new Error(`${label} header is missing a document element`);
  }
  return root;
}

function getDirectChildrenByLocalName(parent: Element, localName: string): Element[] {
  return Array.from(parent.children).filter((child) => child.localName === localName);
}

function serializeXml(doc: XMLDocument): string {
  const serialized = new XMLSerializer()
    .serializeToString(doc)
    .replace(/^(?:\uFEFF?[\r\n\t ]*<\?xml[^>]*\?>\s*)+/i, "");
  return `<?xml version="1.0" encoding="UTF-8"?>\n${serialized}`;
}
