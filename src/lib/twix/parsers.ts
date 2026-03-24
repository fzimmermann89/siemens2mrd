import { CHANNEL_HEADER_OFFSETS, LOOP_COUNTER_OFFSETS, SLICE_DATA_OFFSETS, VB_MDH_OFFSETS, VD_SCAN_HEADER_OFFSETS } from "./layout";
import type { ChannelHeaderLike, CutOff, LoopCounters, MdhLike, ScanHeaderLike, SliceData } from "./types";

export function parseVbMdh(buffer: ArrayBuffer): MdhLike {
  return parseVbMdhView(new DataView(buffer), 0);
}

export function parseVbMdhView(view: DataView, offset: number): MdhLike {
  return {
    ulFlagsAndDMALength: view.getUint32(offset + VB_MDH_OFFSETS.flagsAndDmaLength, true),
    lMeasUID: view.getInt32(offset + VB_MDH_OFFSETS.measUid, true),
    ulScanCounter: view.getUint32(offset + VB_MDH_OFFSETS.scanCounter, true),
    ulTimeStamp: view.getUint32(offset + VB_MDH_OFFSETS.timeStamp, true),
    ulPMUTimeStamp: view.getUint32(offset + VB_MDH_OFFSETS.pmuTimeStamp, true),
    aulEvalInfoMask: [
      view.getUint32(offset + VB_MDH_OFFSETS.evalInfoMask0, true),
      view.getUint32(offset + VB_MDH_OFFSETS.evalInfoMask1, true)
    ],
    ushSamplesInScan: view.getUint16(offset + VB_MDH_OFFSETS.samplesInScan, true),
    ushUsedChannels: view.getUint16(offset + VB_MDH_OFFSETS.usedChannels, true),
    sLC: parseLoopCounters(view, offset + VB_MDH_OFFSETS.loopCounters),
    sCutOff: parseCutOff(view, offset + VB_MDH_OFFSETS.cutOffPre, offset + VB_MDH_OFFSETS.cutOffPost),
    ushKSpaceCentreColumn: view.getUint16(offset + VB_MDH_OFFSETS.kSpaceCentreColumn, true),
    ushCoilSelect: view.getUint16(offset + VB_MDH_OFFSETS.coilSelect, true),
    fReadOutOffcentre: view.getFloat32(offset + VB_MDH_OFFSETS.readOutOffcentre, true),
    ulTimeSinceLastRF: view.getUint32(offset + VB_MDH_OFFSETS.timeSinceLastRf, true),
    ushKSpaceCentreLineNo: view.getUint16(offset + VB_MDH_OFFSETS.kSpaceCentreLineNo, true),
    ushKSpaceCentrePartitionNo: view.getUint16(offset + VB_MDH_OFFSETS.kSpaceCentrePartitionNo, true),
    aushIceProgramPara: Array.from({ length: 4 }, (_, index) =>
      view.getUint16(offset + VB_MDH_OFFSETS.iceProgramPara + index * 2, true)
    ),
    sSliceData: parseSliceData(view, offset + VB_MDH_OFFSETS.sliceData),
    ushChannelId: view.getUint16(offset + VB_MDH_OFFSETS.channelId, true),
    ushPTABPosNeg: view.getUint16(offset + VB_MDH_OFFSETS.ptabPosNeg, true)
  };
}

export function convertVbMdhToScanHeader(mdh: MdhLike): ScanHeaderLike {
  return {
    ulFlagsAndDMALength: mdh.ulFlagsAndDMALength,
    lMeasUID: mdh.lMeasUID,
    ulScanCounter: mdh.ulScanCounter,
    ulTimeStamp: mdh.ulTimeStamp,
    ulPMUTimeStamp: mdh.ulPMUTimeStamp,
    lPTABPosX: 0,
    lPTABPosY: 0,
    lPTABPosZ: mdh.ushPTABPosNeg ?? 0,
    aulEvalInfoMask: mdh.aulEvalInfoMask,
    ushSamplesInScan: mdh.ushSamplesInScan,
    ushUsedChannels: mdh.ushUsedChannels,
    sLC: mdh.sLC,
    sCutOff: mdh.sCutOff,
    ushKSpaceCentreColumn: mdh.ushKSpaceCentreColumn,
    ushCoilSelect: mdh.ushCoilSelect,
    fReadOutOffcentre: mdh.fReadOutOffcentre,
    ulTimeSinceLastRF: mdh.ulTimeSinceLastRF,
    ushKSpaceCentreLineNo: mdh.ushKSpaceCentreLineNo,
    ushKSpaceCentrePartitionNo: mdh.ushKSpaceCentrePartitionNo,
    sSliceData: mdh.sSliceData,
    aushIceProgramPara: [...(mdh.aushIceProgramPara ?? []), ...Array.from({ length: 20 }, () => 0)]
  };
}

export function parseVdScanHeader(buffer: ArrayBuffer): ScanHeaderLike {
  return parseVdScanHeaderView(new DataView(buffer), 0);
}

export function parseVdScanHeaderView(view: DataView, offset: number): ScanHeaderLike {
  return {
    ulFlagsAndDMALength: view.getUint32(offset + VD_SCAN_HEADER_OFFSETS.flagsAndDmaLength, true),
    lMeasUID: view.getInt32(offset + VD_SCAN_HEADER_OFFSETS.measUid, true),
    ulScanCounter: view.getUint32(offset + VD_SCAN_HEADER_OFFSETS.scanCounter, true),
    ulTimeStamp: view.getUint32(offset + VD_SCAN_HEADER_OFFSETS.timeStamp, true),
    ulPMUTimeStamp: view.getUint32(offset + VD_SCAN_HEADER_OFFSETS.pmuTimeStamp, true),
    lPTABPosX: view.getInt32(offset + VD_SCAN_HEADER_OFFSETS.ptabPosX, true),
    lPTABPosY: view.getInt32(offset + VD_SCAN_HEADER_OFFSETS.ptabPosY, true),
    lPTABPosZ: view.getInt32(offset + VD_SCAN_HEADER_OFFSETS.ptabPosZ, true),
    aulEvalInfoMask: [
      view.getUint32(offset + VD_SCAN_HEADER_OFFSETS.evalInfoMask0, true),
      view.getUint32(offset + VD_SCAN_HEADER_OFFSETS.evalInfoMask1, true)
    ],
    ushSamplesInScan: view.getUint16(offset + VD_SCAN_HEADER_OFFSETS.samplesInScan, true),
    ushUsedChannels: view.getUint16(offset + VD_SCAN_HEADER_OFFSETS.usedChannels, true),
    sLC: parseLoopCounters(view, offset + VD_SCAN_HEADER_OFFSETS.loopCounters),
    sCutOff: parseCutOff(view, offset + VD_SCAN_HEADER_OFFSETS.cutOffPre, offset + VD_SCAN_HEADER_OFFSETS.cutOffPost),
    ushKSpaceCentreColumn: view.getUint16(offset + VD_SCAN_HEADER_OFFSETS.kSpaceCentreColumn, true),
    ushCoilSelect: view.getUint16(offset + VD_SCAN_HEADER_OFFSETS.coilSelect, true),
    fReadOutOffcentre: view.getFloat32(offset + VD_SCAN_HEADER_OFFSETS.readOutOffcentre, true),
    ulTimeSinceLastRF: view.getUint32(offset + VD_SCAN_HEADER_OFFSETS.timeSinceLastRf, true),
    ushKSpaceCentreLineNo: view.getUint16(offset + VD_SCAN_HEADER_OFFSETS.kSpaceCentreLineNo, true),
    ushKSpaceCentrePartitionNo: view.getUint16(offset + VD_SCAN_HEADER_OFFSETS.kSpaceCentrePartitionNo, true),
    sSliceData: parseSliceData(view, offset + VD_SCAN_HEADER_OFFSETS.sliceData),
    aushIceProgramPara: Array.from({ length: 24 }, (_, index) =>
      view.getUint16(offset + VD_SCAN_HEADER_OFFSETS.iceProgramPara + index * 2, true)
    )
  };
}

export function parseChannelHeader(buffer: ArrayBuffer): ChannelHeaderLike {
  return parseChannelHeaderView(new DataView(buffer), 0);
}

export function parseChannelHeaderView(view: DataView, offset: number): ChannelHeaderLike {
  return {
    ulTypeAndChannelLength: view.getUint32(offset + CHANNEL_HEADER_OFFSETS.typeAndChannelLength, true),
    ulChannelId: view.getUint16(offset + CHANNEL_HEADER_OFFSETS.channelId, true)
  };
}

export function parseLoopCounters(view: DataView, offset: number): LoopCounters {
  return {
    ushLine: view.getUint16(offset + LOOP_COUNTER_OFFSETS.line, true),
    ushAcquisition: view.getUint16(offset + LOOP_COUNTER_OFFSETS.acquisition, true),
    ushSlice: view.getUint16(offset + LOOP_COUNTER_OFFSETS.slice, true),
    ushPartition: view.getUint16(offset + LOOP_COUNTER_OFFSETS.partition, true),
    ushEcho: view.getUint16(offset + LOOP_COUNTER_OFFSETS.echo, true),
    ushPhase: view.getUint16(offset + LOOP_COUNTER_OFFSETS.phase, true),
    ushRepetition: view.getUint16(offset + LOOP_COUNTER_OFFSETS.repetition, true),
    ushSet: view.getUint16(offset + LOOP_COUNTER_OFFSETS.set, true),
    ushSeg: view.getUint16(offset + LOOP_COUNTER_OFFSETS.segment, true),
    ushIda: view.getUint16(offset + LOOP_COUNTER_OFFSETS.ida, true),
    ushIdb: view.getUint16(offset + LOOP_COUNTER_OFFSETS.idb, true),
    ushIdc: view.getUint16(offset + LOOP_COUNTER_OFFSETS.idc, true),
    ushIdd: view.getUint16(offset + LOOP_COUNTER_OFFSETS.idd, true),
    ushIde: view.getUint16(offset + LOOP_COUNTER_OFFSETS.ide, true)
  };
}

export function parseSliceData(view: DataView, offset: number): SliceData {
  return {
    position: [
      view.getFloat32(offset + SLICE_DATA_OFFSETS.positionX, true),
      view.getFloat32(offset + SLICE_DATA_OFFSETS.positionY, true),
      view.getFloat32(offset + SLICE_DATA_OFFSETS.positionZ, true)
    ],
    quaternion: [
      view.getFloat32(offset + SLICE_DATA_OFFSETS.quaternion0, true),
      view.getFloat32(offset + SLICE_DATA_OFFSETS.quaternion1, true),
      view.getFloat32(offset + SLICE_DATA_OFFSETS.quaternion2, true),
      view.getFloat32(offset + SLICE_DATA_OFFSETS.quaternion3, true)
    ]
  };
}

function parseCutOff(view: DataView, preOffset: number, postOffset: number): CutOff {
  return {
    ushPre: view.getUint16(preOffset, true),
    ushPost: view.getUint16(postOffset, true)
  };
}
