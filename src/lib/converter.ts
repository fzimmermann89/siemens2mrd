import {
  CHANNEL_HEADER_SIZE,
  COMPLEX_FLOAT32_BYTES,
  MDH_DMA_LENGTH_MASK,
  VB_MDH_SIZE,
  VD_SCAN_HEADER_SIZE
} from "./twix/constants";
import type { ConversionParameters, ConverterSettings } from "./headerDraft";
import { BlobCursor, hasEvalMaskBit, toSafeNumber } from "./twix/utils";
import type { TwixInspectionResult, TwixMeasurementEntry } from "./twix";

const ISMRMRD_VERSION_MAJOR = 1;
const FLAG_LAST_IN_MEASUREMENT = 25;
const FLAG_IS_NOISE = 19;
const FLAG_FIRST_IN_SLICE = 7;
const FLAG_LAST_IN_SLICE = 8;
const FLAG_LAST_IN_REPETITION = 14;
const FLAG_IS_PARALLEL_CALIBRATION = 20;
const FLAG_IS_PARALLEL_CALIBRATION_AND_IMAGING = 21;
const FLAG_IS_REVERSE = 22;
const FLAG_IS_PHASECORR = 24;
const FLAG_IS_NAVIGATION = 23;
const FLAG_IS_RTFEEDBACK = 28;
const FLAG_IS_HPFEEDBACK = 26;
const FLAG_IS_DUMMYSCAN = 27;
const FLAG_IS_SURFACECOILCORRECTION = 29;
const FLAG_IS_PHASE_STAB_REF = 30;
const FLAG_IS_PHASE_STAB = 31;
const EVAL_LAST_IN_MEASUREMENT = 0;
const EVAL_RTFEEDBACK = 1;
const EVAL_HPFEEDBACK = 2;
const EVAL_SYNCDATA = 5;
const EVAL_LAST_IN_MEASUREMENT_ALT = 46;
const EVAL_SURFACE_COIL = 10;
const EVAL_LAST_IN_REPETITION = 11;
const EVAL_PHASE_STAB_REF = 14;
const EVAL_PHASE_STAB = 15;
const EVAL_PHASECORR = 21;
const EVAL_PAT_REF = 22;
const EVAL_PAT_REF_AND_IMA = 23;
const EVAL_REVERSE = 24;
const EVAL_NOISE = 25;
const EVAL_FIRST_IN_SLICE = 28;
const EVAL_LAST_IN_SLICE = 29;
const EVAL_DUMMY = 51;
const PMU_END = 0x01ff0000;
const PMU_ECG1 = 0x01010000;
const PMU_ECG4 = 0x01040000;
const PMU_PULS = 0x01050000;
const PMU_RESP = 0x01060000;
const PMU_EXT1 = 0x01070000;
const PMU_EXT2 = 0x01080000;
const MAX_MALFORMED_SYNC_PACKETS = 8;

export interface EncodingCounters {
  kspace_encode_step_1: number;
  kspace_encode_step_2: number;
  average: number;
  slice: number;
  contrast: number;
  phase: number;
  repetition: number;
  set: number;
  segment: number;
  user: number[];
}

export interface IsmrmrdAcquisitionHeaderLike {
  version: number;
  flags: bigint;
  measurement_uid: number;
  scan_counter: number;
  acquisition_time_stamp: number;
  physiology_time_stamp: number[];
  number_of_samples: number;
  available_channels: number;
  active_channels: number;
  channel_mask: bigint[];
  discard_pre: number;
  discard_post: number;
  center_sample: number;
  encoding_space_ref: number;
  trajectory_dimensions: number;
  sample_time_us: number;
  position: number[];
  read_dir: number[];
  phase_dir: number[];
  slice_dir: number[];
  patient_table_position: number[];
  idx: EncodingCounters;
  user_int: number[];
  user_float: number[];
}

export interface IsmrmrdAcquisitionLike {
  head: IsmrmrdAcquisitionHeaderLike;
  traj: Float32Array;
  data: Float32Array;
}

export interface IsmrmrdWaveformHeaderLike {
  version: number;
  flags: bigint;
  measurement_uid: number;
  scan_counter: number;
  time_stamp: number;
  number_of_samples: number;
  channels: number;
  sample_time_us: number;
  waveform_id: number;
}

export interface IsmrmrdWaveformLike {
  head: IsmrmrdWaveformHeaderLike;
  data: Uint32Array;
}

export interface ConversionResult {
  measurement: TwixMeasurementEntry;
  acquisitions: IsmrmrdAcquisitionLike[];
  waveforms: IsmrmrdWaveformLike[];
}

export interface ConversionSink {
  onAcquisition?: (acquisition: IsmrmrdAcquisitionLike) => void | Promise<void>;
  onWaveform?: (waveform: IsmrmrdWaveformLike) => void | Promise<void>;
  onProgress?: (progress: {
    bytesProcessed: number;
    totalBytes: number;
    scanCounter: number;
  }) => void | Promise<void>;
}

interface MdhLike {
  ulFlagsAndDMALength: number;
  lMeasUID: number;
  ulScanCounter: number;
  ulTimeStamp: number;
  ulPMUTimeStamp: number;
  aulEvalInfoMask: [number, number];
  ushSamplesInScan: number;
  ushUsedChannels: number;
  sLC: LoopCounters;
  sCutOff: CutOff;
  ushKSpaceCentreColumn: number;
  ushCoilSelect: number;
  fReadOutOffcentre: number;
  ulTimeSinceLastRF: number;
  ushKSpaceCentreLineNo: number;
  ushKSpaceCentrePartitionNo: number;
  aushIceProgramPara: number[];
  sSliceData: SliceData;
  ushChannelId: number;
  ushPTABPosNeg: number;
}

interface ScanHeaderLike {
  ulFlagsAndDMALength: number;
  lMeasUID: number;
  ulScanCounter: number;
  ulTimeStamp: number;
  ulPMUTimeStamp: number;
  lPTABPosX: number;
  lPTABPosY: number;
  lPTABPosZ: number;
  aulEvalInfoMask: [number, number];
  ushSamplesInScan: number;
  ushUsedChannels: number;
  sLC: LoopCounters;
  sCutOff: CutOff;
  ushKSpaceCentreColumn: number;
  ushCoilSelect: number;
  fReadOutOffcentre: number;
  ulTimeSinceLastRF: number;
  ushKSpaceCentreLineNo: number;
  ushKSpaceCentrePartitionNo: number;
  sSliceData: SliceData;
  aushIceProgramPara: number[];
}

interface ChannelHeaderLike {
  ulTypeAndChannelLength: number;
  ulChannelId: number;
}

interface LoopCounters {
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

interface CutOff {
  ushPre: number;
  ushPost: number;
}

interface SliceData {
  position: [number, number, number];
  quaternion: [number, number, number, number];
}

interface PmuSample {
  data: number;
  trigger: number;
}

interface SyncParseState {
  disabled: boolean;
  malformedPackets: number;
}

export async function convertMeasurement(
  file: File,
  inspection: TwixInspectionResult,
  measurement: TwixMeasurementEntry,
  settings: ConverterSettings,
  parameters: ConversionParameters,
  sink?: ConversionSink
): Promise<ConversionResult> {
  if (measurement.headerAlignedDataOffset === undefined) {
    throw new Error("Measurement header alignment is unavailable");
  }

  const isVB = inspection.format === "vb";
  const cursor = new BlobCursor(file, toSafeNumber(measurement.headerAlignedDataOffset, "measurement start offset"));
  const measurementStart = cursor.position;
  const endOffset = isVB ? BigInt(file.size) : measurement.offset + measurement.length;
  const totalBytes = Math.max(1, toSafeNumber(endOffset - BigInt(measurementStart), "measurement length"));
  const acquisitions: IsmrmrdAcquisitionLike[] = [];
  const waveforms: IsmrmrdWaveformLike[] = [];
  let lastScanCounter = 0;
  const syncState: SyncParseState = {
    disabled: false,
    malformedPackets: 0
  };

  while (BigInt(cursor.position) < endOffset) {
    const remaining = endOffset - BigInt(cursor.position);
    const minHeader = isVB ? BigInt(VB_MDH_SIZE) : BigInt(VD_SCAN_HEADER_SIZE);
    if (remaining < minHeader) break;

    if (isVB) {
      const mdh = parseVbMdh(await cursor.readBytes(VB_MDH_SIZE));
      const scan = convertVbToScanHeader(mdh);
      if (hasEvalMaskBit(scan.aulEvalInfoMask, EVAL_SYNCDATA)) {
        const skipBytes = Math.max(0, (scan.ulFlagsAndDMALength & MDH_DMA_LENGTH_MASK) - VB_MDH_SIZE);
        cursor.skip(skipBytes);
      } else {
        const acq = await readVbAcquisition(cursor, mdh, scan, measurement, parameters);
        lastScanCounter = acq.head.scan_counter;
        if (sink?.onAcquisition) {
          await sink.onAcquisition(acq);
        } else {
          acquisitions.push(acq);
        }
      }
      if (hasEvalMaskBit(scan.aulEvalInfoMask, EVAL_LAST_IN_MEASUREMENT)) break;
      await sink?.onProgress?.({
        bytesProcessed: Math.max(0, cursor.position - measurementStart),
        totalBytes,
        scanCounter: scan.ulScanCounter >>> 0
      });
      continue;
    }

    const scan = parseVdScanHeader(await cursor.readBytes(VD_SCAN_HEADER_SIZE));
      if (hasEvalMaskBit(scan.aulEvalInfoMask, EVAL_SYNCDATA)) {
        const parsed = await readSyncData(cursor, scan, settings.skipSyncData, lastScanCounter, syncState);
        if (sink?.onWaveform) {
          for (const waveform of parsed) {
            await sink.onWaveform(waveform);
          }
        } else {
          waveforms.push(...parsed);
        }
      } else {
        const payloadValidation = validateVdAcquisitionPayload(scan);
        if (!payloadValidation.valid) {
          cursor.skip(payloadValidation.payloadBytes);
          continue;
        }
      const acq = await readVdAcquisition(cursor, scan, measurement, parameters);
      if (acq.head.number_of_samples === 0 || acq.head.active_channels === 0) {
        continue;
      }
      lastScanCounter = acq.head.scan_counter;
      if (sink?.onAcquisition) {
        await sink.onAcquisition(acq);
      } else {
        acquisitions.push(acq);
      }
    }

    if (hasEvalMaskBit(scan.aulEvalInfoMask, EVAL_LAST_IN_MEASUREMENT) || hasEvalMaskBit(scan.aulEvalInfoMask, EVAL_LAST_IN_MEASUREMENT_ALT)) {
      break;
    }

    if (sink?.onProgress) {
      await sink.onProgress({
        bytesProcessed: Math.max(0, cursor.position - measurementStart),
        totalBytes,
        scanCounter: scan.ulScanCounter >>> 0
      });
    }
  }

  return {
    measurement,
    acquisitions,
    waveforms
  };
}

async function readVbAcquisition(
  cursor: BlobCursor,
  firstMdh: MdhLike,
  scan: ScanHeaderLike,
  measurement: TwixMeasurementEntry,
  parameters: ConversionParameters
): Promise<IsmrmrdAcquisitionLike> {
  const samples = scan.ushSamplesInScan;
  const channels = scan.ushUsedChannels;
  const dataBytesPerChannel = samples * COMPLEX_FLOAT32_BYTES;
  const firstChannelBytes = await cursor.readBytes(dataBytesPerChannel);
  const remainingChannelBytes = channels > 1
    ? await cursor.readBytes((channels - 1) * (VB_MDH_SIZE + dataBytesPerChannel))
    : new ArrayBuffer(0);
  const data = new Float32Array(samples * channels * 2);

  copyComplexFloatBlock(data, 0, firstChannelBytes, 0, samples * 2);
  if (channels > 1) {
    copyVbChannels(data, samples, channels, remainingChannelBytes, firstMdh);
  }

  return buildAcquisition(scan, measurement, parameters, data);
}

async function readVdAcquisition(
  cursor: BlobCursor,
  scan: ScanHeaderLike,
  measurement: TwixMeasurementEntry,
  parameters: ConversionParameters
): Promise<IsmrmrdAcquisitionLike> {
  const samples = scan.ushSamplesInScan;
  const channels = scan.ushUsedChannels;
  const totalFloats = samples * channels * 2;
  if (!Number.isFinite(totalFloats) || totalFloats < 0 || totalFloats > 128 * 1024 * 1024) {
    throw new Error(`Refusing VD acquisition allocation for samples=${samples}, channels=${channels}, floats=${totalFloats}`);
  }
  const payloadBytes = channels * (CHANNEL_HEADER_SIZE + samples * COMPLEX_FLOAT32_BYTES);
  const payload = await cursor.readBytes(payloadBytes);
  const data = new Float32Array(samples * channels * 2);
  copyVdChannels(data, samples, channels, payload);

  return buildAcquisition(scan, measurement, parameters, data);
}

function copyVbChannels(
  destination: Float32Array,
  samples: number,
  channels: number,
  payload: ArrayBuffer,
  firstMdh: MdhLike
): void {
  const bytesPerChannel = samples * COMPLEX_FLOAT32_BYTES;
  const view = new DataView(payload);
  const bytes = new Uint8Array(payload);
  let offset = 0;

  for (let channel = 1; channel < channels; channel += 1) {
    const mdh = parseVbMdhView(view, offset);
    offset += VB_MDH_SIZE;
    copyComplexFloatBlock(destination, channel * samples * 2, bytes, offset, samples * 2);
    offset += bytesPerChannel;
    if (mdh.ushChannelId >= 0 || firstMdh.ushChannelId >= 0) {
      // keep decode behavior aligned with existing parser expectations
    }
  }
}

function copyVdChannels(
  destination: Float32Array,
  samples: number,
  channels: number,
  payload: ArrayBuffer
): void {
  const bytesPerChannel = samples * COMPLEX_FLOAT32_BYTES;
  const view = new DataView(payload);
  const bytes = new Uint8Array(payload);
  let offset = 0;

  for (let channel = 0; channel < channels; channel += 1) {
    const header = parseChannelHeaderView(view, offset);
    offset += CHANNEL_HEADER_SIZE;
    copyComplexFloatBlock(destination, channel * samples * 2, bytes, offset, samples * 2);
    offset += bytesPerChannel;
    if (header.ulChannelId >= 0) {
      // keep decode behavior aligned with existing parser expectations
    }
  }
}

function copyComplexFloatBlock(
  destination: Float32Array,
  destinationOffsetFloats: number,
  source: ArrayBuffer | Uint8Array,
  sourceOffsetBytes: number,
  floatCount: number
): void {
  const sourceBytes = source instanceof Uint8Array ? source : new Uint8Array(source);
  const sourceFloats = new Float32Array(
    sourceBytes.buffer,
    sourceBytes.byteOffset + sourceOffsetBytes,
    floatCount
  );
  destination.set(sourceFloats, destinationOffsetFloats);
}

function buildAcquisition(
  scan: ScanHeaderLike,
  measurement: TwixMeasurementEntry,
  parameters: ConversionParameters,
  data: Float32Array
): IsmrmrdAcquisitionLike {
  const header: IsmrmrdAcquisitionHeaderLike = {
    version: ISMRMRD_VERSION_MAJOR,
    flags: buildAcquisitionFlags(scan.aulEvalInfoMask),
    measurement_uid: scan.lMeasUID >>> 0,
    scan_counter: scan.ulScanCounter >>> 0,
    acquisition_time_stamp: scan.ulTimeStamp >>> 0,
    physiology_time_stamp: [scan.ulPMUTimeStamp >>> 0, 0, 0],
    number_of_samples: scan.ushSamplesInScan,
    available_channels: Number.isFinite(parameters.availableChannels) && parameters.availableChannels > 0
      ? parameters.availableChannels
      : scan.ushUsedChannels,
    active_channels: scan.ushUsedChannels,
    channel_mask: buildChannelMask(scan.ushUsedChannels),
    discard_pre: scan.sCutOff.ushPre,
    discard_post: scan.sCutOff.ushPost,
    center_sample: scan.ushKSpaceCentreColumn,
    encoding_space_ref: 0,
    trajectory_dimensions: 0,
    sample_time_us: parameters.dwellTimeUs,
    position: [...scan.sSliceData.position],
    read_dir: [0, 0, 0],
    phase_dir: [0, 0, 0],
    slice_dir: [0, 0, 0],
    patient_table_position: [scan.lPTABPosX, scan.lPTABPosY, scan.lPTABPosZ],
    idx: {
      kspace_encode_step_1: scan.sLC.ushLine,
      kspace_encode_step_2: scan.sLC.ushPartition,
      average: scan.sLC.ushAcquisition,
      slice: scan.sLC.ushSlice,
      contrast: scan.sLC.ushEcho,
      phase: scan.sLC.ushPhase,
      repetition: scan.sLC.ushRepetition,
      set: scan.sLC.ushSet,
      segment: scan.sLC.ushSeg,
      user: [scan.sLC.ushIda, scan.sLC.ushIdb, scan.sLC.ushIdc, scan.sLC.ushIdd, scan.sLC.ushIde, scan.ushKSpaceCentreLineNo, scan.ushKSpaceCentrePartitionNo, 0]
    },
    user_int: [
      scan.aushIceProgramPara[0] ?? 0,
      scan.aushIceProgramPara[1] ?? 0,
      scan.aushIceProgramPara[2] ?? 0,
      scan.aushIceProgramPara[3] ?? 0,
      scan.aushIceProgramPara[4] ?? 0,
      scan.aushIceProgramPara[5] ?? 0,
      scan.aushIceProgramPara[6] ?? 0,
      scan.ulTimeSinceLastRF
    ],
    user_float: [
      scan.aushIceProgramPara[8] ?? 0,
      scan.aushIceProgramPara[9] ?? 0,
      scan.aushIceProgramPara[10] ?? 0,
      scan.aushIceProgramPara[11] ?? 0,
      scan.aushIceProgramPara[12] ?? 0,
      scan.aushIceProgramPara[13] ?? 0,
      scan.aushIceProgramPara[14] ?? 0,
      scan.aushIceProgramPara[15] ?? 0
    ]
  };

  const quat: [number, number, number, number] = [
    scan.sSliceData.quaternion[1],
    scan.sSliceData.quaternion[2],
    scan.sSliceData.quaternion[3],
    scan.sSliceData.quaternion[0]
  ];
  quaternionToDirections(quat, header.phase_dir, header.read_dir, header.slice_dir);

  return {
    head: header,
    traj: new Float32Array(),
    data
  };
}

async function readSyncData(
  cursor: BlobCursor,
  scan: ScanHeaderLike,
  skipSyncData: boolean,
  lastScanCounter: number,
  syncState: SyncParseState
): Promise<IsmrmrdWaveformLike[]> {
  const payloadLength = (scan.ulFlagsAndDMALength & MDH_DMA_LENGTH_MASK) - VD_SCAN_HEADER_SIZE;
  if (payloadLength <= 0) return [];

  const targetOffset = cursor.position + payloadLength;
  if (skipSyncData || syncState.disabled) {
    cursor.position = targetOffset;
    return [];
  }
  const packetSize = await readSyncUint32(cursor, targetOffset);
  if (packetSize === null) return markMalformedSyncPacket(cursor, targetOffset, syncState, "truncated packet header");
  void packetSize;
  const packedIdBytes = await readSyncBytes(cursor, targetOffset, 52);
  if (!packedIdBytes) return markMalformedSyncPacket(cursor, targetOffset, syncState, "truncated packet id");
  const packedId = decodeAscii(new Uint8Array(packedIdBytes));
  if (!packedId.includes("PMU")) {
    cursor.position = targetOffset;
    return [];
  }

  const learningPhase = packedId.includes("PMULearnPhase");
  if ((await readSyncUint32(cursor, targetOffset)) === null) return markMalformedSyncPacket(cursor, targetOffset, syncState, "truncated reserved0");
  if ((await readSyncUint32(cursor, targetOffset)) === null) return markMalformedSyncPacket(cursor, targetOffset, syncState, "truncated reserved1");
  const timestamp = await readSyncUint32(cursor, targetOffset);
  if (timestamp === null) return markMalformedSyncPacket(cursor, targetOffset, syncState, "truncated timestamp");
  if ((await readSyncUint32(cursor, targetOffset)) === null) return markMalformedSyncPacket(cursor, targetOffset, syncState, "truncated reserved2");
  const duration = await readSyncUint32(cursor, targetOffset);
  if (duration === null) return markMalformedSyncPacket(cursor, targetOffset, syncState, "truncated duration");
  let magic = await readSyncUint32(cursor, targetOffset);
  if (magic === null) return markMalformedSyncPacket(cursor, targetOffset, syncState, "truncated magic");

  const ecgMap = new Map<number, { samples: PmuSample[]; period: number }>();
  const pmuMap = new Map<number, { samples: PmuSample[]; period: number }>();

  while (magic !== PMU_END) {
    const period = await readSyncUint32(cursor, targetOffset);
    if (period === null) return markMalformedSyncPacket(cursor, targetOffset, syncState, "truncated period");
    if (period <= 0) {
      return markMalformedSyncPacket(cursor, targetOffset, syncState, "invalid period");
    }
    const sampleCount = Math.floor(duration / period);
    if (!Number.isFinite(sampleCount) || sampleCount < 0 || sampleCount > 16384) {
      return markMalformedSyncPacket(cursor, targetOffset, syncState, "unreasonable sample count");
    }
    const bytesBuffer = await readSyncBytes(cursor, targetOffset, sampleCount * 4);
    if (!bytesBuffer) return markMalformedSyncPacket(cursor, targetOffset, syncState, "truncated samples");
    const bytes = new Uint8Array(bytesBuffer);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const samples: PmuSample[] = [];
    for (let offset = 0; offset < bytes.byteLength; offset += 4) {
      samples.push({ data: view.getUint16(offset, true), trigger: view.getUint16(offset + 2, true) });
    }
    if (magic >= PMU_ECG1 && magic <= PMU_ECG4) {
      ecgMap.set(magic, { samples, period });
    } else {
      pmuMap.set(magic, { samples, period });
    }
    const nextMagic = await readSyncUint32(cursor, targetOffset);
    if (nextMagic === null) return markMalformedSyncPacket(cursor, targetOffset, syncState, "truncated next magic");
    magic = nextMagic;
  }

  cursor.position = targetOffset;
  const waveforms: IsmrmrdWaveformLike[] = [];

  if (ecgMap.size > 0) {
    const channels = ecgMap.size + 1;
    const first = ecgMap.values().next().value as { samples: PmuSample[] };
    const count = first.samples.length;
    const data = new Uint32Array(count * channels);
    let channelIndex = 0;
    const triggerOffset = count * ecgMap.size;
    for (const { samples } of ecgMap.values()) {
      for (let i = 0; i < count; i += 1) {
        data[channelIndex * count + i] = samples[i]?.data ?? 0;
        data[triggerOffset + i] |= samples[i]?.trigger ?? 0;
      }
      channelIndex += 1;
    }
    waveforms.push({
      head: buildWaveformHeader(scan.lMeasUID, lastScanCounter, timestamp, count, channels, duration, learningPhase ? 5 : 0),
      data
    });
  }

  for (const [type, { samples }] of pmuMap.entries()) {
    const count = samples.length;
    const data = new Uint32Array(count * 2);
    for (let i = 0; i < count; i += 1) {
      data[i] = samples[i]?.data ?? 0;
      data[count + i] = samples[i]?.trigger ?? 0;
    }
    waveforms.push({
      head: buildWaveformHeader(scan.lMeasUID, lastScanCounter, timestamp, count, 2, duration, waveformTypeOffset(type, learningPhase)),
      data
    });
  }

  return waveforms;
}

function markMalformedSyncPacket(
  cursor: BlobCursor,
  targetOffset: number,
  syncState: SyncParseState,
  reason: string
): [] {
  cursor.position = targetOffset;
  syncState.malformedPackets += 1;
  if (!syncState.disabled && syncState.malformedPackets >= MAX_MALFORMED_SYNC_PACKETS) {
    syncState.disabled = true;
  }
  return [];
}

async function readSyncUint32(
  cursor: BlobCursor,
  targetOffset: number
): Promise<number | null> {
  if (cursor.position + 4 > targetOffset) {
    cursor.position = targetOffset;
    return null;
  }
  return cursor.readUint32();
}

async function readSyncBytes(
  cursor: BlobCursor,
  targetOffset: number,
  byteLength: number
): Promise<ArrayBuffer | null> {
  if (cursor.position + byteLength > targetOffset) {
    cursor.position = targetOffset;
    return null;
  }
  return cursor.readBytes(byteLength);
}

function buildWaveformHeader(
  measurementUid: number,
  scanCounter: number,
  timeStamp: number,
  samples: number,
  channels: number,
  duration: number,
  waveformId: number
): IsmrmrdWaveformHeaderLike {
  return {
    version: ISMRMRD_VERSION_MAJOR,
    flags: 0n,
    measurement_uid: measurementUid >>> 0,
    scan_counter: scanCounter >>> 0,
    time_stamp: timeStamp >>> 0,
    number_of_samples: samples,
    channels,
    sample_time_us: samples > 0 ? (duration * 100) / samples : 0,
    waveform_id: waveformId
  };
}

function waveformTypeOffset(type: number, learningPhase: boolean): number {
  const base = type === PMU_PULS ? 1 : type === PMU_RESP ? 2 : type === PMU_EXT1 ? 3 : type === PMU_EXT2 ? 4 : 0;
  return base + (learningPhase ? 5 : 0);
}

function buildAcquisitionFlags(mask: readonly [number, number]): bigint {
  let flags = 0n;
  if (hasEvalMaskBit(mask, EVAL_NOISE)) flags = setFlag(flags, FLAG_IS_NOISE);
  if (hasEvalMaskBit(mask, EVAL_FIRST_IN_SLICE)) flags = setFlag(flags, FLAG_FIRST_IN_SLICE);
  if (hasEvalMaskBit(mask, EVAL_LAST_IN_SLICE)) flags = setFlag(flags, FLAG_LAST_IN_SLICE);
  if (hasEvalMaskBit(mask, EVAL_LAST_IN_REPETITION)) flags = setFlag(flags, FLAG_LAST_IN_REPETITION);
  if (hasEvalMaskBit(mask, EVAL_PAT_REF_AND_IMA)) flags = setFlag(flags, FLAG_IS_PARALLEL_CALIBRATION_AND_IMAGING);
  else if (hasEvalMaskBit(mask, EVAL_PAT_REF)) flags = setFlag(flags, FLAG_IS_PARALLEL_CALIBRATION);
  if (hasEvalMaskBit(mask, EVAL_REVERSE)) flags = setFlag(flags, FLAG_IS_REVERSE);
  if (hasEvalMaskBit(mask, EVAL_LAST_IN_MEASUREMENT) || hasEvalMaskBit(mask, EVAL_LAST_IN_MEASUREMENT_ALT) || hasEvalMaskBit(mask, EVAL_LAST_IN_REPETITION)) {
    flags = setFlag(flags, FLAG_LAST_IN_MEASUREMENT);
  }
  if (hasEvalMaskBit(mask, EVAL_PHASECORR)) flags = setFlag(flags, FLAG_IS_PHASECORR);
  if (hasEvalMaskBit(mask, EVAL_RTFEEDBACK)) {
    flags = setFlag(flags, FLAG_IS_NAVIGATION);
    flags = setFlag(flags, FLAG_IS_RTFEEDBACK);
  }
  if (hasEvalMaskBit(mask, EVAL_HPFEEDBACK)) flags = setFlag(flags, FLAG_IS_HPFEEDBACK);
  if (hasEvalMaskBit(mask, EVAL_DUMMY) || hasEvalMaskBit(mask, EVAL_SYNCDATA)) flags = setFlag(flags, FLAG_IS_DUMMYSCAN);
  if (hasEvalMaskBit(mask, EVAL_SURFACE_COIL)) flags = setFlag(flags, FLAG_IS_SURFACECOILCORRECTION);
  if (hasEvalMaskBit(mask, EVAL_PHASE_STAB_REF)) flags = setFlag(flags, FLAG_IS_PHASE_STAB_REF);
  if (hasEvalMaskBit(mask, EVAL_PHASE_STAB)) flags = setFlag(flags, FLAG_IS_PHASE_STAB);
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

function quaternionToDirections(quat: [number, number, number, number], phase: number[], read: number[], slice: number[]): void {
  const [a, b, c, d] = quat;
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

function parseVbMdh(buffer: ArrayBuffer): MdhLike {
  return parseVbMdhView(new DataView(buffer), 0);
}

function parseVbMdhView(view: DataView, offset: number): MdhLike {
  return {
    ulFlagsAndDMALength: view.getUint32(offset + 0, true),
    lMeasUID: view.getInt32(offset + 4, true),
    ulScanCounter: view.getUint32(offset + 8, true),
    ulTimeStamp: view.getUint32(offset + 12, true),
    ulPMUTimeStamp: view.getUint32(offset + 16, true),
    aulEvalInfoMask: [view.getUint32(offset + 20, true), view.getUint32(offset + 24, true)],
    ushSamplesInScan: view.getUint16(offset + 28, true),
    ushUsedChannels: view.getUint16(offset + 30, true),
    sLC: parseLoopCounters(view, offset + 32),
    sCutOff: { ushPre: view.getUint16(offset + 60, true), ushPost: view.getUint16(offset + 62, true) },
    ushKSpaceCentreColumn: view.getUint16(offset + 64, true),
    ushCoilSelect: view.getUint16(offset + 66, true),
    fReadOutOffcentre: view.getFloat32(offset + 68, true),
    ulTimeSinceLastRF: view.getUint32(offset + 72, true),
    ushKSpaceCentreLineNo: view.getUint16(offset + 76, true),
    ushKSpaceCentrePartitionNo: view.getUint16(offset + 78, true),
    aushIceProgramPara: Array.from({ length: 4 }, (_, index) => view.getUint16(offset + 80 + index * 2, true)),
    sSliceData: parseSliceData(view, offset + 96),
    ushChannelId: view.getUint16(offset + 124, true),
    ushPTABPosNeg: view.getUint16(offset + 126, true)
  };
}

function convertVbToScanHeader(mdh: MdhLike): ScanHeaderLike {
  return {
    ulFlagsAndDMALength: mdh.ulFlagsAndDMALength,
    lMeasUID: mdh.lMeasUID,
    ulScanCounter: mdh.ulScanCounter,
    ulTimeStamp: mdh.ulTimeStamp,
    ulPMUTimeStamp: mdh.ulPMUTimeStamp,
    lPTABPosX: 0,
    lPTABPosY: 0,
    lPTABPosZ: mdh.ushPTABPosNeg,
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
    aushIceProgramPara: [...mdh.aushIceProgramPara, ...Array.from({ length: 20 }, () => 0)]
  };
}

function parseVdScanHeader(buffer: ArrayBuffer): ScanHeaderLike {
  const view = new DataView(buffer);
  return {
    ulFlagsAndDMALength: view.getUint32(0, true),
    lMeasUID: view.getInt32(4, true),
    ulScanCounter: view.getUint32(8, true),
    ulTimeStamp: view.getUint32(12, true),
    ulPMUTimeStamp: view.getUint32(16, true),
    lPTABPosX: view.getInt32(24, true),
    lPTABPosY: view.getInt32(28, true),
    lPTABPosZ: view.getInt32(32, true),
    aulEvalInfoMask: [view.getUint32(40, true), view.getUint32(44, true)],
    ushSamplesInScan: view.getUint16(48, true),
    ushUsedChannels: view.getUint16(50, true),
    sLC: parseLoopCounters(view, 52),
    sCutOff: { ushPre: view.getUint16(80, true), ushPost: view.getUint16(82, true) },
    ushKSpaceCentreColumn: view.getUint16(84, true),
    ushCoilSelect: view.getUint16(86, true),
    fReadOutOffcentre: view.getFloat32(88, true),
    ulTimeSinceLastRF: view.getUint32(92, true),
    ushKSpaceCentreLineNo: view.getUint16(96, true),
    ushKSpaceCentrePartitionNo: view.getUint16(98, true),
    sSliceData: parseSliceData(view, 100),
    aushIceProgramPara: Array.from({ length: 24 }, (_, index) => view.getUint16(124 + index * 2, true))
  };
}

function parseChannelHeader(buffer: ArrayBuffer): ChannelHeaderLike {
  return parseChannelHeaderView(new DataView(buffer), 0);
}

function parseChannelHeaderView(view: DataView, offset: number): ChannelHeaderLike {
  return {
    ulTypeAndChannelLength: view.getUint32(offset + 0, true),
    ulChannelId: view.getUint16(offset + 24, true)
  };
}

function validateVdAcquisitionPayload(scan: ScanHeaderLike): {
  valid: boolean;
  reason?: string;
  dmaLength: number;
  payloadBytes: number;
  expectedBytes: number;
} {
  const dmaLength = scan.ulFlagsAndDMALength & MDH_DMA_LENGTH_MASK;
  const payloadBytes = Math.max(0, dmaLength - VD_SCAN_HEADER_SIZE);
  const samples = scan.ushSamplesInScan;
  const channels = scan.ushUsedChannels;

  if (samples === 0 || channels === 0) {
    return {
      valid: false,
      reason: "zero-sized acquisition payload",
      dmaLength,
      payloadBytes,
      expectedBytes: 0
    };
  }

  const bytesPerChannel = CHANNEL_HEADER_SIZE + samples * COMPLEX_FLOAT32_BYTES;
  const expectedBytes = channels * bytesPerChannel;

  if (!Number.isFinite(expectedBytes) || expectedBytes <= 0) {
    return {
      valid: false,
      reason: "non-finite expected payload size",
      dmaLength,
      payloadBytes,
      expectedBytes
    };
  }

  if (expectedBytes > payloadBytes) {
    return {
      valid: false,
      reason: "declared samples/channels exceed DMA payload",
      dmaLength,
      payloadBytes,
      expectedBytes
    };
  }

  if (expectedBytes < payloadBytes) {
    return {
      valid: false,
      reason: "DMA payload larger than expected acquisition layout",
      dmaLength,
      payloadBytes,
      expectedBytes
    };
  }

  return {
    valid: true,
    dmaLength,
    payloadBytes,
    expectedBytes
  };
}

function parseLoopCounters(view: DataView, offset: number): LoopCounters {
  return {
    ushLine: view.getUint16(offset + 0, true),
    ushAcquisition: view.getUint16(offset + 2, true),
    ushSlice: view.getUint16(offset + 4, true),
    ushPartition: view.getUint16(offset + 6, true),
    ushEcho: view.getUint16(offset + 8, true),
    ushPhase: view.getUint16(offset + 10, true),
    ushRepetition: view.getUint16(offset + 12, true),
    ushSet: view.getUint16(offset + 14, true),
    ushSeg: view.getUint16(offset + 16, true),
    ushIda: view.getUint16(offset + 18, true),
    ushIdb: view.getUint16(offset + 20, true),
    ushIdc: view.getUint16(offset + 22, true),
    ushIdd: view.getUint16(offset + 24, true),
    ushIde: view.getUint16(offset + 26, true)
  };
}

function parseSliceData(view: DataView, offset: number): SliceData {
  return {
    position: [view.getFloat32(offset + 0, true), view.getFloat32(offset + 4, true), view.getFloat32(offset + 8, true)],
    quaternion: [view.getFloat32(offset + 12, true), view.getFloat32(offset + 16, true), view.getFloat32(offset + 20, true), view.getFloat32(offset + 24, true)]
  };
}

function decodeAscii(bytes: Uint8Array): string {
  return new TextDecoder("latin1").decode(bytes).replaceAll("\u0000", "").trim();
}
