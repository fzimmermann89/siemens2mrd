import {
  BUFFER_NAME_FIELD_LIMIT,
  BUFFER_PREVIEW_BYTES,
  CHANNEL_HEADER_SIZE,
  COMPLEX_FLOAT32_BYTES,
  EVAL_INFO_LAST_SCAN_IN_MEASUREMENT,
  EVAL_INFO_SYNCDATA,
  MAX_RAID_MEASUREMENTS,
  MDH_DMA_LENGTH_MASK,
  RAID_FILE_ENTRY_SIZE,
  RAID_FILE_HEADER_SIZE,
  RAID_NAME_FIELD_SIZE,
  VB_MDH_SIZE,
  VD_SCAN_HEADER_SIZE
} from "./twix/constants";
import type {
  TwixInspectionResult,
  TwixMeasurementEntry,
  TwixMeasurementHeaderBufferInfo,
  TwixRaidHeader
} from "./twix/types";
import { formatBigInt, makePlaceholderMeasurement, readBlobSlice, readCString, summarizePreview, toSafeNumber } from "./twix/utils";
import {
  decodeBufferText,
  hasEvalMaskBit,
  BlobCursor
} from "./twix/utils";

export type {
  TwixFormat,
  TwixInspectionResult,
  TwixMeasurementEntry,
  TwixMeasurementHeaderBufferInfo,
  TwixRaidHeader
} from "./twix/types";
export { formatBigInt } from "./twix/utils";

export async function inspectTwixFile(file: File): Promise<TwixInspectionResult> {
  const headerBuffer = await readBlobSlice(file, 0, RAID_FILE_HEADER_SIZE);
  const headerView = new DataView(headerBuffer);

  const raidHeader: TwixRaidHeader = {
    hdSize: headerView.getUint32(0, true),
    count: headerView.getUint32(4, true)
  };

  if (raidHeader.hdSize !== 0) {
    const measurement = await readMeasurementHeaderInfo(file, makePlaceholderMeasurement(file));
    return {
      format: "vb",
      size: BigInt(file.size),
      raidHeader: null,
      measurements: [measurement]
    };
  }

  const measurements = await readRaidEntries(file, raidHeader);

  return {
    format: "vd",
    size: BigInt(file.size),
    raidHeader,
    measurements
  };
}

async function readRaidEntries(file: File, header: TwixRaidHeader): Promise<TwixMeasurementEntry[]> {
  const clampedCount = Math.max(0, Math.min(header.count, MAX_RAID_MEASUREMENTS));
  const tableByteLength = clampedCount * RAID_FILE_ENTRY_SIZE;
  const tableBuffer = await readBlobSlice(file, RAID_FILE_HEADER_SIZE, RAID_FILE_HEADER_SIZE + tableByteLength);
  const view = new DataView(tableBuffer);
  const entries: TwixMeasurementEntry[] = [];

  for (let index = 0; index < clampedCount; index += 1) {
    const offset = index * RAID_FILE_ENTRY_SIZE;
    const entry: TwixMeasurementEntry = {
      measurementId: view.getUint32(offset, true),
      fileId: view.getUint32(offset + 4, true),
      offset: view.getBigUint64(offset + 8, true),
      length: view.getBigUint64(offset + 16, true),
      patientName: readCString(view, offset + 24, RAID_NAME_FIELD_SIZE),
      protocolName: readCString(view, offset + 88, RAID_NAME_FIELD_SIZE)
    };

    entries.push(await readMeasurementHeaderInfo(file, entry));
  }

  return entries;
}

async function readMeasurementHeaderInfo(file: File, entry: TwixMeasurementEntry): Promise<TwixMeasurementEntry> {
  const measurementOffset = toSafeNumber(entry.offset, "measurement offset");
  const prefixBuffer = await readBlobSlice(file, measurementOffset, measurementOffset + 8);
  const prefixView = new DataView(prefixBuffer);
  const headerDmaLength = prefixView.getUint32(0, true);
  const headerBufferCount = prefixView.getUint32(4, true);
  const cursor = new BlobCursor(file, measurementOffset + 8);
  const buffers: TwixMeasurementHeaderBufferInfo[] = [];

  for (let index = 0; index < headerBufferCount; index += 1) {
    const name = await cursor.readNullTerminatedString(BUFFER_NAME_FIELD_LIMIT);
    const length = await cursor.readUint32();
    const startOffset = BigInt(cursor.position);
    const rawBuffer = length > 0 ? new Uint8Array(await cursor.readBytes(length)) : new Uint8Array();
    const preview = summarizePreview(rawBuffer.subarray(0, Math.min(length, BUFFER_PREVIEW_BYTES)));
    const text = decodeMeasurementBuffer(rawBuffer);

    buffers.push({
      name,
      length,
      startOffset,
      preview,
      text
    });
  }

  const relativeOffset = cursor.position - measurementOffset;
  if (relativeOffset % 32 !== 0) cursor.skip(32 - (relativeOffset % 32));

  return {
    ...entry,
    headerDmaLength,
    headerBufferCount,
    headerAlignedDataOffset: BigInt(cursor.position),
    buffers
  };
}

function decodeMeasurementBuffer(bytes: Uint8Array): string | undefined {
  if (bytes.length === 0) return undefined;
  const text = decodeBufferText(bytes).replaceAll("\u0000", " ").trim();
  if (!text) return undefined;
  return text;
}
