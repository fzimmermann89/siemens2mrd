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
  ChannelHeaderLike,
  MdhLike,
  ParsedTwixMeasurement,
  ScanHeaderLike,
  TwixInspectionResult,
  TwixMeasurementEntry,
  TwixMeasurementHeaderBufferInfo,
  TwixRaidHeader,
  TwixScanSummary
} from "./twix/types";
import {
  BlobCursor,
  decodeBufferText,
  formatBigInt,
  hasEvalMaskBit,
  makePlaceholderMeasurement,
  readBlobSlice,
  readCString,
  summarizePreview,
  toSafeNumber
} from "./twix/utils";

export type {
  ParsedTwixMeasurement,
  TwixFormat,
  TwixInspectionResult,
  TwixMeasurementEntry,
  TwixMeasurementHeaderBufferInfo,
  TwixRaidHeader,
  TwixScanSummary
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

export async function parseMeasurement(
  file: File,
  inspection: TwixInspectionResult,
  measurementIndex: number
): Promise<ParsedTwixMeasurement> {
  const measurement = inspection.measurements[measurementIndex];
  if (!measurement) {
    throw new Error(`Measurement index out of range: ${measurementIndex}`);
  }

  if (measurement.headerAlignedDataOffset === undefined) {
    throw new Error("Measurement header alignment is unavailable");
  }

  const startOffset = measurement.headerAlignedDataOffset;
  const endOffset = inspection.format === "vb" ? BigInt(file.size) : measurement.offset + measurement.length;
  const cursor = new BlobCursor(file, toSafeNumber(startOffset, "measurement start offset"));
  const scans: TwixScanSummary[] = [];
  let index = 0;

  while (BigInt(cursor.position) < endOffset) {
    const remaining = endOffset - BigInt(cursor.position);
    const minimumHeaderSize = inspection.format === "vb" ? BigInt(VB_MDH_SIZE) : BigInt(VD_SCAN_HEADER_SIZE);
    if (remaining < minimumHeaderSize) break;

    const scanOffset = BigInt(cursor.position);

    if (inspection.format === "vb") {
      const firstMdh = parseVbMdh(await cursor.readBytes(VB_MDH_SIZE));
      const scanHeader = convertVbMdhToScanHeader(firstMdh);
      const summary = await parseScanPayload(cursor, inspection.format, scanHeader, firstMdh, scanOffset, index);
      scans.push(summary);
      index += 1;
      if (summary.isLastScanInMeasurement) break;
      continue;
    }

    const scanHeader = parseVdScanHeader(await cursor.readBytes(VD_SCAN_HEADER_SIZE));
    const summary = await parseScanPayload(cursor, inspection.format, scanHeader, null, scanOffset, index);
    scans.push(summary);
    index += 1;
    if (summary.isLastScanInMeasurement) break;
  }

  return {
    format: inspection.format,
    measurement,
    startOffset,
    endOffset,
    scans
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

async function parseScanPayload(
  cursor: BlobCursor,
  format: "vb" | "vd",
  scanHeader: ScanHeaderLike,
  firstMdh: MdhLike | null,
  scanOffset: bigint,
  index: number
): Promise<TwixScanSummary> {
  const dmaLength = scanHeader.ulFlagsAndDMALength & MDH_DMA_LENGTH_MASK;
  const kind = hasEvalMaskBit(scanHeader.aulEvalInfoMask, EVAL_INFO_SYNCDATA) ? "syncdata" : "acquisition";
  const channelIds: number[] = [];

  if (kind === "syncdata") {
    const headerBytes = format === "vb" ? VB_MDH_SIZE : VD_SCAN_HEADER_SIZE;
    cursor.skip(Math.max(0, dmaLength - headerBytes));
  } else {
    for (let channelIndex = 0; channelIndex < scanHeader.ushUsedChannels; channelIndex += 1) {
      if (format === "vb") {
        const mdh = channelIndex === 0 && firstMdh ? firstMdh : parseVbMdh(await cursor.readBytes(VB_MDH_SIZE));
        channelIds.push(mdh.ushChannelId);
      } else {
        const header = parseChannelHeader(await cursor.readBytes(CHANNEL_HEADER_SIZE));
        channelIds.push(header.ulChannelId);
      }

      cursor.skip(scanHeader.ushSamplesInScan * COMPLEX_FLOAT32_BYTES);
    }
  }

  return {
    index,
    offset: scanOffset,
    nextOffset: BigInt(cursor.position),
    dmaLength,
    scanCounter: scanHeader.ulScanCounter,
    timeStamp: scanHeader.ulTimeStamp,
    pmuTimeStamp: scanHeader.ulPMUTimeStamp,
    usedChannels: scanHeader.ushUsedChannels,
    samplesInScan: scanHeader.ushSamplesInScan,
    evalInfoMask: scanHeader.aulEvalInfoMask,
    kind,
    isLastScanInMeasurement: hasEvalMaskBit(scanHeader.aulEvalInfoMask, EVAL_INFO_LAST_SCAN_IN_MEASUREMENT),
    channelIds
  };
}

function parseVbMdh(buffer: ArrayBuffer): MdhLike {
  const view = new DataView(buffer);
  return {
    ulFlagsAndDMALength: view.getUint32(0, true),
    lMeasUID: view.getInt32(4, true),
    ulScanCounter: view.getUint32(8, true),
    ulTimeStamp: view.getUint32(12, true),
    ulPMUTimeStamp: view.getUint32(16, true),
    aulEvalInfoMask: [view.getUint32(20, true), view.getUint32(24, true)],
    ushSamplesInScan: view.getUint16(28, true),
    ushUsedChannels: view.getUint16(30, true),
    ushChannelId: view.getUint16(124, true)
  };
}

function convertVbMdhToScanHeader(mdh: MdhLike): ScanHeaderLike {
  return {
    ulFlagsAndDMALength: mdh.ulFlagsAndDMALength,
    lMeasUID: mdh.lMeasUID,
    ulScanCounter: mdh.ulScanCounter,
    ulTimeStamp: mdh.ulTimeStamp,
    ulPMUTimeStamp: mdh.ulPMUTimeStamp,
    aulEvalInfoMask: mdh.aulEvalInfoMask,
    ushSamplesInScan: mdh.ushSamplesInScan,
    ushUsedChannels: mdh.ushUsedChannels
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
    aulEvalInfoMask: [view.getUint32(40, true), view.getUint32(44, true)],
    ushSamplesInScan: view.getUint16(48, true),
    ushUsedChannels: view.getUint16(50, true)
  };
}

function parseChannelHeader(buffer: ArrayBuffer): ChannelHeaderLike {
  const view = new DataView(buffer);
  return {
    ulChannelId: view.getUint16(24, true)
  };
}
