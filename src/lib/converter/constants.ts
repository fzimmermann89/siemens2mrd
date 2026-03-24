export const ACQUISITION_FLAG_INDEX = {
  lastInMeasurement: 25,
  isNoise: 19,
  firstInSlice: 7,
  lastInSlice: 8,
  lastInRepetition: 14,
  isParallelCalibration: 20,
  isParallelCalibrationAndImaging: 21,
  isReverse: 22,
  isNavigation: 23,
  isPhaseCorr: 24,
  isHpFeedback: 26,
  isDummyScan: 27,
  isRtFeedback: 28,
  isSurfaceCoilCorrection: 29,
  isPhaseStabRef: 30,
  isPhaseStab: 31
} as const;

export const EVAL_INFO_BIT = {
  lastInMeasurement: 0,
  rtFeedback: 1,
  hpFeedback: 2,
  syncData: 5,
  surfaceCoil: 10,
  lastInRepetition: 11,
  phaseStabRef: 14,
  phaseStab: 15,
  phaseCorr: 21,
  patRef: 22,
  patRefAndIma: 23,
  reverse: 24,
  noise: 25,
  firstInSlice: 28,
  lastInSlice: 29,
  lastInMeasurementAlt: 46,
  dummy: 51
} as const;

export const ACQUISITION_FLAG_RULES: ReadonlyArray<readonly [number, number]> = [
  [EVAL_INFO_BIT.noise, ACQUISITION_FLAG_INDEX.isNoise],
  [EVAL_INFO_BIT.firstInSlice, ACQUISITION_FLAG_INDEX.firstInSlice],
  [EVAL_INFO_BIT.lastInSlice, ACQUISITION_FLAG_INDEX.lastInSlice],
  [EVAL_INFO_BIT.lastInRepetition, ACQUISITION_FLAG_INDEX.lastInRepetition],
  [EVAL_INFO_BIT.reverse, ACQUISITION_FLAG_INDEX.isReverse],
  [EVAL_INFO_BIT.phaseCorr, ACQUISITION_FLAG_INDEX.isPhaseCorr],
  [EVAL_INFO_BIT.hpFeedback, ACQUISITION_FLAG_INDEX.isHpFeedback],
  [EVAL_INFO_BIT.surfaceCoil, ACQUISITION_FLAG_INDEX.isSurfaceCoilCorrection],
  [EVAL_INFO_BIT.phaseStabRef, ACQUISITION_FLAG_INDEX.isPhaseStabRef],
  [EVAL_INFO_BIT.phaseStab, ACQUISITION_FLAG_INDEX.isPhaseStab]
] as const;

export const PMU_MAGIC = {
  end: 0x01ff0000,
  ecg1: 0x01010000,
  ecg4: 0x01040000,
  puls: 0x01050000,
  resp: 0x01060000,
  ext1: 0x01070000,
  ext2: 0x01080000
} as const;

export const PMU_WAVEFORM_BASE_ID: Record<number, number> = {
  [PMU_MAGIC.puls]: 1,
  [PMU_MAGIC.resp]: 2,
  [PMU_MAGIC.ext1]: 3,
  [PMU_MAGIC.ext2]: 4
};

export const MAX_MALFORMED_SYNC_PACKETS = 8;
export const MAX_SYNC_SAMPLE_COUNT = 16_384;
export const PMU_PACKET_ID_BYTES = 52;
export const PMU_DURATION_TO_US_SCALE = 100;
export const MAX_ACQUISITION_FLOATS = 128 * 1024 * 1024;
