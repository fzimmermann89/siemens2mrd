import type { TwixInspectionResult, TwixMeasurementEntry } from "./twix";

export interface MappingAsset {
  name: string;
  kind: "xml" | "xsl";
  path: string;
}

export interface MappingSelection {
  detectedFlavor: "vb" | "vd" | "nx";
  autoXml: string;
  autoXsl: string;
  selectedXml: string;
  selectedXsl: string;
}

const XML_ASSETS = [
  "IsmrmrdParameterMap.xml",
  "IsmrmrdParameterMap_Siemens.xml",
  "IsmrmrdParameterMap_Siemens_VB17.xml"
] as const;

const XSL_ASSETS = [
  "IsmrmrdParameterMap.xsl",
  "IsmrmrdParameterMap_Siemens.xsl",
  "IsmrmrdParameterMap_Siemens_B0REF.xsl",
  "IsmrmrdParameterMap_Siemens_EPI.xsl",
  "IsmrmrdParameterMap_Siemens_EPI_FLASHREF.xsl",
  "IsmrmrdParameterMap_Siemens_NX.xsl",
  "IsmrmrdParameterMap_Siemens_PreZeros.xsl",
  "IsmrmrdParameterMap_Siemens_T1Mapping_SASHA.xsl"
] as const;

function createParameterMapPath(name: string): string {
  return new URL(`../../siemens_to_ismrmrd/parameter_maps/${name}`, import.meta.url).href;
}

export const mappingAssets: MappingAsset[] = [
  ...XML_ASSETS.map((name) => ({ name, kind: "xml" as const, path: createParameterMapPath(name) })),
  ...XSL_ASSETS.map((name) => ({ name, kind: "xsl" as const, path: createParameterMapPath(name) }))
];

export function getXmlAssets(): MappingAsset[] {
  return mappingAssets.filter((asset) => asset.kind === "xml");
}

export function getXslAssets(): MappingAsset[] {
  return mappingAssets.filter((asset) => asset.kind === "xsl");
}

export function findMappingAsset(name: string, kind?: "xml" | "xsl"): MappingAsset | undefined {
  return mappingAssets.find((asset) => asset.name === name && (kind ? asset.kind === kind : true));
}

export function getDefaultMappingSelection(
  inspection: TwixInspectionResult,
  measurement: TwixMeasurementEntry,
  overrides?: Partial<Pick<MappingSelection, "selectedXml" | "selectedXsl">>
): MappingSelection {
  const detectedFlavor = detectMeasurementFlavor(inspection, measurement);
  const autoXml = detectedFlavor === "vb"
    ? "IsmrmrdParameterMap_Siemens_VB17.xml"
    : "IsmrmrdParameterMap_Siemens.xml";
  const autoXsl = detectedFlavor === "nx"
    ? "IsmrmrdParameterMap_Siemens_NX.xsl"
    : "IsmrmrdParameterMap_Siemens.xsl";

  return {
    detectedFlavor,
    autoXml,
    autoXsl,
    selectedXml: overrides?.selectedXml ?? autoXml,
    selectedXsl: overrides?.selectedXsl ?? autoXsl
  };
}

function detectMeasurementFlavor(
  inspection: TwixInspectionResult,
  measurement: TwixMeasurementEntry
): "vb" | "vd" | "nx" {
  if (inspection.format === "vb") {
    return "vb";
  }

  const searchableText = [
    measurement.protocolName,
    measurement.patientName,
    ...(measurement.buffers ?? []).flatMap((buffer) => [buffer.name, buffer.preview])
  ]
    .join("\n")
    .toUpperCase();

  if (searchableText.includes("NXVA") || searchableText.includes("SYNGO MR XA")) {
    return "nx";
  }

  return "vd";
}
