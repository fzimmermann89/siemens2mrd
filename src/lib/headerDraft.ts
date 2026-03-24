import type { MappingSelection } from "./mappings";
import type { TwixInspectionResult, TwixMeasurementEntry } from "./twix";
import {
  applyHeaderFieldEditsToXml,
  buildHeaderDraftDocument,
  extractEditableFieldsFromXml,
  ensureWaveformInformationInXml,
  type HeaderDraftDocument,
  type HeaderDraftParameters
} from "./headerXml";

export interface ConverterSettings {
  measNum: number;
  allMeas: boolean;
  skipSyncData: boolean;
  bufferAppend: boolean;
}

export interface EditableHeaderField {
  key: string;
  label: string;
  section: string;
  value: string;
  source: string;
  xmlPath: string;
  primaryValue: string | null;
  secondaryValue: string | null;
  isRemoved: boolean;
}

export interface ConversionParameters {
  dwellTimeUs: number;
  availableChannels: number;
}

export interface HeaderDraft {
  xml: string;
  sourceXml: string;
  fields: EditableHeaderField[];
  parameters: ConversionParameters;
}

export function createDefaultSettings(inspection: TwixInspectionResult): ConverterSettings {
  return {
    measNum: inspection.measurements.length > 0 ? inspection.measurements.length : 1,
    allMeas: true,
    skipSyncData: false,
    bufferAppend: false
  };
}

export async function buildEditableHeader(
  inspection: TwixInspectionResult,
  measurement: TwixMeasurementEntry,
  selection: MappingSelection,
  settings: ConverterSettings
): Promise<HeaderDraft> {
  const draft = await buildHeaderDraftDocument(inspection, measurement, selection, settings);
  return {
    xml: draft.xml,
    sourceXml: draft.sourceXml,
    fields: draft.fields,
    parameters: draft.parameters
  };
}

export function applyHeaderFieldEdits(xml: string, fields: EditableHeaderField[]): string {
  return applyHeaderFieldEditsToXml(xml, fields);
}

export function buildEditableHeaderFromXml(xml: string): HeaderDraft {
  return {
    xml,
    sourceXml: xml,
    fields: extractEditableFieldsFromXml(xml),
    parameters: {
      dwellTimeUs: 0,
      availableChannels: 0
    }
  };
}

export function ensureWaveformInformation(xml: string): string {
  return ensureWaveformInformationInXml(xml);
}

export function extractEditableFields(xml: string): EditableHeaderField[] {
  return extractEditableFieldsFromXml(xml);
}

export function mergeHeaderFieldsWithSecondary(
  primaryFields: EditableHeaderField[],
  mergedFields: EditableHeaderField[],
  secondaryFields: EditableHeaderField[]
): EditableHeaderField[] {
  const primaryByPath = new Map(primaryFields.map((field) => [field.xmlPath, field]));
  const secondaryPaths = new Set(secondaryFields.map((field) => field.xmlPath));

  return mergedFields.map((field) => {
    const primary = primaryByPath.get(field.xmlPath);
    const fromSecondary = secondaryPaths.has(field.xmlPath);
    return {
      ...field,
      primaryValue: primary?.primaryValue ?? primary?.value ?? null,
      secondaryValue: fromSecondary ? field.value : null,
      isRemoved: false
    };
  });
}

export function isFieldManuallyEdited(field: EditableHeaderField): boolean {
  if (field.isRemoved) {
    return false;
  }
  if (field.primaryValue !== null && field.value === field.primaryValue) {
    return false;
  }
  if (field.secondaryValue !== null && field.value === field.secondaryValue) {
    return false;
  }
  return true;
}

export function isFieldFromSecondary(field: EditableHeaderField): boolean {
  return !field.isRemoved && field.secondaryValue !== null && field.value === field.secondaryValue;
}

export function canRestoreFieldToPrimary(field: EditableHeaderField): boolean {
  return !field.isRemoved && field.primaryValue !== null && isFieldManuallyEdited(field);
}

export function isFieldDeletable(field: EditableHeaderField): boolean {
  if (field.xmlPath.endsWith("/H1resonanceFrequency_Hz[0]")) {
    return false;
  }
  return !field.xmlPath.includes("/encodedSpace[") && !field.xmlPath.includes("/reconSpace[");
}

export function deriveEditedConversionParameters(
  base: ConversionParameters,
  fields: EditableHeaderField[]
): ConversionParameters {
  const receiverChannels = fields.find((field) => !field.isRemoved && field.xmlPath.endsWith("/receiverChannels[0]"));
  const parsedChannels = receiverChannels ? Number.parseInt(receiverChannels.value, 10) : NaN;
  return {
    dwellTimeUs: base.dwellTimeUs,
    availableChannels: Number.isFinite(parsedChannels) && parsedChannels > 0 ? parsedChannels : base.availableChannels
  };
}

export type { HeaderDraftDocument, HeaderDraftParameters };
