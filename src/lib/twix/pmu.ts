import { VD_SCAN_HEADER_SIZE } from "./constants";
import { BlobCursor } from "./utils";
import type { ScanHeaderLike } from "./types";
import type { IsmrmrdWaveformHeaderLike, IsmrmrdWaveformLike } from "../ismrmrd/types";
import { ISMRMRD_VERSION_MAJOR } from "../ismrmrd/constants";
import {
  MAX_MALFORMED_SYNC_PACKETS,
  MAX_SYNC_SAMPLE_COUNT,
  PMU_DURATION_TO_US_SCALE,
  PMU_MAGIC,
  PMU_PACKET_ID_BYTES,
  PMU_WAVEFORM_BASE_ID
} from "../converter/constants";
import { MDH_DMA_LENGTH_MASK } from "./constants";

interface PmuSample {
  data: number;
  trigger: number;
}

export interface SyncParseState {
  disabled: boolean;
  malformedPackets: number;
}

export async function readSyncData(
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
  if (packetSize === null) return markMalformedSyncPacket(cursor, targetOffset, syncState);
  void packetSize;

  const packedIdBytes = await readSyncBytes(cursor, targetOffset, PMU_PACKET_ID_BYTES);
  if (!packedIdBytes) return markMalformedSyncPacket(cursor, targetOffset, syncState);
  const packedId = decodeLatin1(new Uint8Array(packedIdBytes));
  if (!packedId.includes("PMU")) {
    cursor.position = targetOffset;
    return [];
  }

  const learningPhase = packedId.includes("PMULearnPhase");
  if ((await readSyncUint32(cursor, targetOffset)) === null) return markMalformedSyncPacket(cursor, targetOffset, syncState);
  if ((await readSyncUint32(cursor, targetOffset)) === null) return markMalformedSyncPacket(cursor, targetOffset, syncState);
  const timestamp = await readSyncUint32(cursor, targetOffset);
  if (timestamp === null) return markMalformedSyncPacket(cursor, targetOffset, syncState);
  if ((await readSyncUint32(cursor, targetOffset)) === null) return markMalformedSyncPacket(cursor, targetOffset, syncState);
  const duration = await readSyncUint32(cursor, targetOffset);
  if (duration === null) return markMalformedSyncPacket(cursor, targetOffset, syncState);
  let magic = await readSyncUint32(cursor, targetOffset);
  if (magic === null) return markMalformedSyncPacket(cursor, targetOffset, syncState);

  const ecgMap = new Map<number, { samples: PmuSample[]; period: number }>();
  const pmuMap = new Map<number, { samples: PmuSample[]; period: number }>();

  while (magic !== PMU_MAGIC.end) {
    const period = await readSyncUint32(cursor, targetOffset);
    if (period === null || period <= 0) {
      return markMalformedSyncPacket(cursor, targetOffset, syncState);
    }

    const sampleCount = Math.floor(duration / period);
    if (!Number.isFinite(sampleCount) || sampleCount < 0 || sampleCount > MAX_SYNC_SAMPLE_COUNT) {
      return markMalformedSyncPacket(cursor, targetOffset, syncState);
    }

    const bytesBuffer = await readSyncBytes(cursor, targetOffset, sampleCount * 4);
    if (!bytesBuffer) return markMalformedSyncPacket(cursor, targetOffset, syncState);
    const bytes = new Uint8Array(bytesBuffer);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const samples: PmuSample[] = [];
    for (let offset = 0; offset < bytes.byteLength; offset += 4) {
      samples.push({ data: view.getUint16(offset, true), trigger: view.getUint16(offset + 2, true) });
    }

    if (magic >= PMU_MAGIC.ecg1 && magic <= PMU_MAGIC.ecg4) {
      ecgMap.set(magic, { samples, period });
    } else {
      pmuMap.set(magic, { samples, period });
    }

    const nextMagic = await readSyncUint32(cursor, targetOffset);
    if (nextMagic === null) return markMalformedSyncPacket(cursor, targetOffset, syncState);
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
      for (let index = 0; index < count; index += 1) {
        data[channelIndex * count + index] = samples[index]?.data ?? 0;
        data[triggerOffset + index] |= samples[index]?.trigger ?? 0;
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
    for (let index = 0; index < count; index += 1) {
      data[index] = samples[index]?.data ?? 0;
      data[count + index] = samples[index]?.trigger ?? 0;
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
  syncState: SyncParseState
): [] {
  cursor.position = targetOffset;
  syncState.malformedPackets += 1;
  if (!syncState.disabled && syncState.malformedPackets >= MAX_MALFORMED_SYNC_PACKETS) {
    syncState.disabled = true;
  }
  return [];
}

async function readSyncUint32(cursor: BlobCursor, targetOffset: number): Promise<number | null> {
  if (cursor.position + 4 > targetOffset) {
    cursor.position = targetOffset;
    return null;
  }
  return cursor.readUint32();
}

async function readSyncBytes(cursor: BlobCursor, targetOffset: number, byteLength: number): Promise<ArrayBuffer | null> {
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
    sample_time_us: samples > 0 ? (duration * PMU_DURATION_TO_US_SCALE) / samples : 0,
    waveform_id: waveformId
  };
}

function waveformTypeOffset(type: number, learningPhase: boolean): number {
  const base = PMU_WAVEFORM_BASE_ID[type] ?? 0;
  return base + (learningPhase ? 5 : 0);
}

function decodeLatin1(bytes: Uint8Array): string {
  return new TextDecoder("latin1").decode(bytes).replaceAll("\u0000", "").trim();
}
