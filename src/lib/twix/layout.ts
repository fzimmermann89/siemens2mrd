export const VB_MDH_OFFSETS = {
  flagsAndDmaLength: 0,
  measUid: 4,
  scanCounter: 8,
  timeStamp: 12,
  pmuTimeStamp: 16,
  evalInfoMask0: 20,
  evalInfoMask1: 24,
  samplesInScan: 28,
  usedChannels: 30,
  loopCounters: 32,
  cutOffPre: 60,
  cutOffPost: 62,
  kSpaceCentreColumn: 64,
  coilSelect: 66,
  readOutOffcentre: 68,
  timeSinceLastRf: 72,
  kSpaceCentreLineNo: 76,
  kSpaceCentrePartitionNo: 78,
  iceProgramPara: 80,
  sliceData: 96,
  channelId: 124,
  ptabPosNeg: 126
} as const;

export const VD_SCAN_HEADER_OFFSETS = {
  flagsAndDmaLength: 0,
  measUid: 4,
  scanCounter: 8,
  timeStamp: 12,
  pmuTimeStamp: 16,
  ptabPosX: 24,
  ptabPosY: 28,
  ptabPosZ: 32,
  evalInfoMask0: 40,
  evalInfoMask1: 44,
  samplesInScan: 48,
  usedChannels: 50,
  loopCounters: 52,
  cutOffPre: 80,
  cutOffPost: 82,
  kSpaceCentreColumn: 84,
  coilSelect: 86,
  readOutOffcentre: 88,
  timeSinceLastRf: 92,
  kSpaceCentreLineNo: 96,
  kSpaceCentrePartitionNo: 98,
  sliceData: 100,
  iceProgramPara: 124
} as const;

export const CHANNEL_HEADER_OFFSETS = {
  typeAndChannelLength: 0,
  channelId: 24
} as const;

export const LOOP_COUNTER_OFFSETS = {
  line: 0,
  acquisition: 2,
  slice: 4,
  partition: 6,
  echo: 8,
  phase: 10,
  repetition: 12,
  set: 14,
  segment: 16,
  ida: 18,
  idb: 20,
  idc: 22,
  idd: 24,
  ide: 26
} as const;

export const SLICE_DATA_OFFSETS = {
  positionX: 0,
  positionY: 4,
  positionZ: 8,
  quaternion0: 12,
  quaternion1: 16,
  quaternion2: 20,
  quaternion3: 24
} as const;
