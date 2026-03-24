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

export interface MdhLike {
  ulFlagsAndDMALength: number;
  lMeasUID: number;
  ulScanCounter: number;
  ulTimeStamp: number;
  ulPMUTimeStamp: number;
  aulEvalInfoMask: [number, number];
  ushSamplesInScan: number;
  ushUsedChannels: number;
  sLC?: LoopCounters;
  sCutOff?: CutOff;
  ushKSpaceCentreColumn?: number;
  ushCoilSelect?: number;
  fReadOutOffcentre?: number;
  ulTimeSinceLastRF?: number;
  ushKSpaceCentreLineNo?: number;
  ushKSpaceCentrePartitionNo?: number;
  aushIceProgramPara?: number[];
  sSliceData?: SliceData;
  ushChannelId: number;
  ushPTABPosNeg?: number;
}

export interface ScanHeaderLike {
  ulFlagsAndDMALength: number;
  lMeasUID: number;
  ulScanCounter: number;
  ulTimeStamp: number;
  ulPMUTimeStamp: number;
  lPTABPosX?: number;
  lPTABPosY?: number;
  lPTABPosZ?: number;
  aulEvalInfoMask: [number, number];
  ushSamplesInScan: number;
  ushUsedChannels: number;
  sLC?: LoopCounters;
  sCutOff?: CutOff;
  ushKSpaceCentreColumn?: number;
  ushCoilSelect?: number;
  fReadOutOffcentre?: number;
  ulTimeSinceLastRF?: number;
  ushKSpaceCentreLineNo?: number;
  ushKSpaceCentrePartitionNo?: number;
  sSliceData?: SliceData;
  aushIceProgramPara?: number[];
}

export interface ChannelHeaderLike {
  ulTypeAndChannelLength?: number;
  ulChannelId: number;
}

export interface LoopCounters {
  ushLine: number;
  ushAcquisition: number;
  ushSlice: number;
  ushPartition: number;
  ushEcho: number;
  ushPhase: number;
  ushRepetition: number;
  ushSet: number;
  ushSeg: number;
  ushIda: number;
  ushIdb: number;
  ushIdc: number;
  ushIdd: number;
  ushIde: number;
}

export interface CutOff {
  ushPre: number;
  ushPost: number;
}

export interface SliceData {
  position: [number, number, number];
  quaternion: [number, number, number, number];
}
