import type { ConversionParameters } from "../headerDraft";
import { ACQUISITION_FLAG_INDEX, ACQUISITION_FLAG_RULES, EVAL_INFO_BIT } from "./constants";
import { ISMRMRD_VERSION_MAJOR } from "../ismrmrd/constants";
import type { IsmrmrdAcquisitionHeaderLike, IsmrmrdAcquisitionLike } from "../ismrmrd/types";
import type { ScanHeaderLike } from "../twix/types";
import { hasEvalMaskBit } from "../twix/utils";

export function buildAcquisition(
  scan: ScanHeaderLike,
  parameters: ConversionParameters,
  data: Float32Array
): IsmrmrdAcquisitionLike {
  const header = buildAcquisitionHeader(scan, parameters);
  applyOrientation(scan, header);

  return {
    head: header,
    traj: new Float32Array(),
    data
  };
}

function buildAcquisitionHeader(
  scan: ScanHeaderLike,
  parameters: ConversionParameters
): IsmrmrdAcquisitionHeaderLike {
  return {
    version: ISMRMRD_VERSION_MAJOR,
    flags: buildAcquisitionFlags(scan.aulEvalInfoMask),
    measurement_uid: scan.lMeasUID >>> 0,
    scan_counter: scan.ulScanCounter >>> 0,
    acquisition_time_stamp: scan.ulTimeStamp >>> 0,
    physiology_time_stamp: [scan.ulPMUTimeStamp >>> 0, 0, 0],
    number_of_samples: scan.ushSamplesInScan,
    available_channels:
      Number.isFinite(parameters.availableChannels) && parameters.availableChannels > 0
        ? parameters.availableChannels
        : scan.ushUsedChannels,
    active_channels: scan.ushUsedChannels,
    channel_mask: buildChannelMask(scan.ushUsedChannels),
    discard_pre: scan.sCutOff?.ushPre ?? 0,
    discard_post: scan.sCutOff?.ushPost ?? 0,
    center_sample: scan.ushKSpaceCentreColumn ?? 0,
    encoding_space_ref: 0,
    trajectory_dimensions: 0,
    sample_time_us: parameters.dwellTimeUs,
    position: [...(scan.sSliceData?.position ?? [0, 0, 0])],
    read_dir: [0, 0, 0],
    phase_dir: [0, 0, 0],
    slice_dir: [0, 0, 0],
    patient_table_position: [scan.lPTABPosX ?? 0, scan.lPTABPosY ?? 0, scan.lPTABPosZ ?? 0],
    idx: {
      kspace_encode_step_1: scan.sLC?.ushLine ?? 0,
      kspace_encode_step_2: scan.sLC?.ushPartition ?? 0,
      average: scan.sLC?.ushAcquisition ?? 0,
      slice: scan.sLC?.ushSlice ?? 0,
      contrast: scan.sLC?.ushEcho ?? 0,
      phase: scan.sLC?.ushPhase ?? 0,
      repetition: scan.sLC?.ushRepetition ?? 0,
      set: scan.sLC?.ushSet ?? 0,
      segment: scan.sLC?.ushSeg ?? 0,
      user: [
        scan.sLC?.ushIda ?? 0,
        scan.sLC?.ushIdb ?? 0,
        scan.sLC?.ushIdc ?? 0,
        scan.sLC?.ushIdd ?? 0,
        scan.sLC?.ushIde ?? 0,
        scan.ushKSpaceCentreLineNo ?? 0,
        scan.ushKSpaceCentrePartitionNo ?? 0,
        0
      ]
    },
    user_int: [
      scan.aushIceProgramPara?.[0] ?? 0,
      scan.aushIceProgramPara?.[1] ?? 0,
      scan.aushIceProgramPara?.[2] ?? 0,
      scan.aushIceProgramPara?.[3] ?? 0,
      scan.aushIceProgramPara?.[4] ?? 0,
      scan.aushIceProgramPara?.[5] ?? 0,
      scan.aushIceProgramPara?.[6] ?? 0,
      scan.ulTimeSinceLastRF ?? 0
    ],
    user_float: [
      scan.aushIceProgramPara?.[8] ?? 0,
      scan.aushIceProgramPara?.[9] ?? 0,
      scan.aushIceProgramPara?.[10] ?? 0,
      scan.aushIceProgramPara?.[11] ?? 0,
      scan.aushIceProgramPara?.[12] ?? 0,
      scan.aushIceProgramPara?.[13] ?? 0,
      scan.aushIceProgramPara?.[14] ?? 0,
      scan.aushIceProgramPara?.[15] ?? 0
    ]
  };
}

function applyOrientation(
  scan: ScanHeaderLike,
  header: IsmrmrdAcquisitionHeaderLike
): void {
  const quaternion: [number, number, number, number] = [
    scan.sSliceData?.quaternion[1] ?? 0,
    scan.sSliceData?.quaternion[2] ?? 0,
    scan.sSliceData?.quaternion[3] ?? 0,
    scan.sSliceData?.quaternion[0] ?? 0
  ];
  quaternionToDirections(quaternion, header.phase_dir, header.read_dir, header.slice_dir);
}

function buildAcquisitionFlags(mask: readonly [number, number]): bigint {
  let flags = 0n;

  for (const [evalBit, flagBit] of ACQUISITION_FLAG_RULES) {
    if (hasEvalMaskBit(mask, evalBit)) {
      flags = setFlag(flags, flagBit);
    }
  }

  if (hasEvalMaskBit(mask, EVAL_INFO_BIT.patRefAndIma)) {
    flags = setFlag(flags, ACQUISITION_FLAG_INDEX.isParallelCalibrationAndImaging);
  } else if (hasEvalMaskBit(mask, EVAL_INFO_BIT.patRef)) {
    flags = setFlag(flags, ACQUISITION_FLAG_INDEX.isParallelCalibration);
  }

  if (
    hasEvalMaskBit(mask, EVAL_INFO_BIT.lastInMeasurement) ||
    hasEvalMaskBit(mask, EVAL_INFO_BIT.lastInMeasurementAlt) ||
    hasEvalMaskBit(mask, EVAL_INFO_BIT.lastInRepetition)
  ) {
    flags = setFlag(flags, ACQUISITION_FLAG_INDEX.lastInMeasurement);
  }

  if (hasEvalMaskBit(mask, EVAL_INFO_BIT.rtFeedback)) {
    flags = setFlag(flags, ACQUISITION_FLAG_INDEX.isNavigation);
    flags = setFlag(flags, ACQUISITION_FLAG_INDEX.isRtFeedback);
  }

  if (hasEvalMaskBit(mask, EVAL_INFO_BIT.dummy) || hasEvalMaskBit(mask, EVAL_INFO_BIT.syncData)) {
    flags = setFlag(flags, ACQUISITION_FLAG_INDEX.isDummyScan);
  }

  return flags;
}

function buildChannelMask(activeChannels: number): bigint[] {
  const mask = Array.from({ length: 16 }, () => 0n);
  for (let channel = 0; channel < activeChannels; channel += 1) {
    const block = Math.floor(channel / 64);
    const bit = channel % 64;
    mask[block] |= 1n << BigInt(bit);
  }
  return mask;
}

function setFlag(flags: bigint, index: number): bigint {
  return flags | (1n << BigInt(index - 1));
}

function quaternionToDirections(
  quaternion: [number, number, number, number],
  phase: number[],
  read: number[],
  slice: number[]
): void {
  const [a, b, c, d] = quaternion;
  read[0] = 1 - 2 * (b * b + c * c);
  phase[0] = 2 * (a * b - c * d);
  slice[0] = 2 * (a * c + b * d);
  read[1] = 2 * (a * b + c * d);
  phase[1] = 1 - 2 * (a * a + c * c);
  slice[1] = 2 * (b * c - a * d);
  read[2] = 2 * (a * c - b * d);
  phase[2] = 2 * (b * c + a * d);
  slice[2] = 1 - 2 * (a * a + b * b);
}
