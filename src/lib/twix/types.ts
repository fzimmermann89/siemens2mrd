export type TwixFormat = "vb" | "vd";

export interface TwixRaidHeader {
  hdSize: number;
  count: number;
}

export interface TwixMeasurementHeaderBufferInfo {
  name: string;
  length: number;
  startOffset: bigint;
  preview: string;
  text?: string;
}

export interface TwixMeasurementEntry {
  measurementId: number;
  fileId: number;
  offset: bigint;
  length: bigint;
  patientName: string;
  protocolName: string;
  headerDmaLength?: number;
  headerBufferCount?: number;
  headerAlignedDataOffset?: bigint;
  buffers?: TwixMeasurementHeaderBufferInfo[];
}

export interface TwixInspectionResult {
  format: TwixFormat;
  size: bigint;
  raidHeader: TwixRaidHeader | null;
  measurements: TwixMeasurementEntry[];
}

export interface TwixScanSummary {
  index: number;
  offset: bigint;
  nextOffset: bigint;
  dmaLength: number;
  scanCounter: number;
  timeStamp: number;
  pmuTimeStamp: number;
  usedChannels: number;
  samplesInScan: number;
  evalInfoMask: readonly [number, number];
  kind: "acquisition" | "syncdata";
  isLastScanInMeasurement: boolean;
  channelIds: number[];
}

export interface ParsedTwixMeasurement {
  format: TwixFormat;
  measurement: TwixMeasurementEntry;
  startOffset: bigint;
  endOffset: bigint;
  scans: TwixScanSummary[];
}

export interface MdhLike {
  ulFlagsAndDMALength: number;
  lMeasUID: number;
  ulScanCounter: number;
  ulTimeStamp: number;
  ulPMUTimeStamp: number;
  aulEvalInfoMask: [number, number];
  ushSamplesInScan: number;
  ushUsedChannels: number;
  ushChannelId: number;
}

export interface ScanHeaderLike {
  ulFlagsAndDMALength: number;
  lMeasUID: number;
  ulScanCounter: number;
  ulTimeStamp: number;
  ulPMUTimeStamp: number;
  aulEvalInfoMask: [number, number];
  ushSamplesInScan: number;
  ushUsedChannels: number;
}

export interface ChannelHeaderLike {
  ulChannelId: number;
}
