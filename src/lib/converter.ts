import {
  CHANNEL_HEADER_SIZE,
  COMPLEX_FLOAT32_BYTES,
  MDH_DMA_LENGTH_MASK,
  VB_MDH_SIZE,
  VD_SCAN_HEADER_SIZE
} from "./twix/constants";
import type { ConversionParameters, ConverterSettings } from "./headerDraft";
import { BlobCursor, hasEvalMaskBit, toSafeNumber } from "./twix/utils";
import {
  convertVbMdhToScanHeader,
  parseChannelHeaderView,
  parseVbMdh,
  parseVbMdhView,
  parseVdScanHeader
} from "./twix/parsers";
import { readSyncData, type SyncParseState } from "./twix/pmu";
import type { ScanHeaderLike } from "./twix/types";
import type { TwixInspectionResult, TwixMeasurementEntry } from "./twix";
import { EVAL_INFO_BIT, MAX_ACQUISITION_FLOATS } from "./converter/constants";
import { buildAcquisition } from "./converter/build";
import type { ConversionResult, IsmrmrdAcquisitionLike, IsmrmrdWaveformLike } from "./ismrmrd/types";

export interface ConversionSink {
  onAcquisition?: (acquisition: IsmrmrdAcquisitionLike) => void | Promise<void>;
  onWaveform?: (waveform: IsmrmrdWaveformLike) => void | Promise<void>;
  onProgress?: (progress: {
    bytesProcessed: number;
    totalBytes: number;
    scanCounter: number;
  }) => void | Promise<void>;
}

export async function convertMeasurement(
  file: File,
  inspection: TwixInspectionResult,
  measurement: TwixMeasurementEntry,
  settings: ConverterSettings,
  parameters: ConversionParameters,
  sink?: ConversionSink
): Promise<ConversionResult<TwixMeasurementEntry>> {
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
      const scan = convertVbMdhToScanHeader(mdh);
      if (hasEvalMaskBit(scan.aulEvalInfoMask, EVAL_INFO_BIT.syncData)) {
        const skipBytes = Math.max(0, (scan.ulFlagsAndDMALength & MDH_DMA_LENGTH_MASK) - VB_MDH_SIZE);
        cursor.skip(skipBytes);
      } else {
        const acq = await readVbAcquisition(cursor, scan, parameters);
        lastScanCounter = acq.head.scan_counter;
        if (sink?.onAcquisition) {
          await sink.onAcquisition(acq);
        } else {
          acquisitions.push(acq);
        }
      }
      if (hasEvalMaskBit(scan.aulEvalInfoMask, EVAL_INFO_BIT.lastInMeasurement)) break;
      await sink?.onProgress?.({
        bytesProcessed: Math.max(0, cursor.position - measurementStart),
        totalBytes,
        scanCounter: scan.ulScanCounter >>> 0
      });
      continue;
    }

    const scan = parseVdScanHeader(await cursor.readBytes(VD_SCAN_HEADER_SIZE));
    if (hasEvalMaskBit(scan.aulEvalInfoMask, EVAL_INFO_BIT.syncData)) {
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
      const acq = await readVdAcquisition(cursor, scan, parameters);
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

    if (
      hasEvalMaskBit(scan.aulEvalInfoMask, EVAL_INFO_BIT.lastInMeasurement) ||
      hasEvalMaskBit(scan.aulEvalInfoMask, EVAL_INFO_BIT.lastInMeasurementAlt)
    ) {
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
  scan: ScanHeaderLike,
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
    copyVbChannels(data, samples, channels, remainingChannelBytes);
  }

  return buildAcquisition(scan, parameters, data);
}

async function readVdAcquisition(
  cursor: BlobCursor,
  scan: ScanHeaderLike,
  parameters: ConversionParameters
): Promise<IsmrmrdAcquisitionLike> {
  const samples = scan.ushSamplesInScan;
  const channels = scan.ushUsedChannels;
  const totalFloats = samples * channels * 2;
  if (!Number.isFinite(totalFloats) || totalFloats < 0 || totalFloats > MAX_ACQUISITION_FLOATS) {
    throw new Error(`Refusing VD acquisition allocation for samples=${samples}, channels=${channels}, floats=${totalFloats}`);
  }
  const payloadBytes = channels * (CHANNEL_HEADER_SIZE + samples * COMPLEX_FLOAT32_BYTES);
  const payload = await cursor.readBytes(payloadBytes);
  const data = new Float32Array(samples * channels * 2);
  copyVdChannels(data, samples, channels, payload);

  return buildAcquisition(scan, parameters, data);
}

function copyVbChannels(
  destination: Float32Array,
  samples: number,
  channels: number,
  payload: ArrayBuffer
): void {
  const bytesPerChannel = samples * COMPLEX_FLOAT32_BYTES;
  const view = new DataView(payload);
  const bytes = new Uint8Array(payload);
  let offset = 0;

  for (let channel = 1; channel < channels; channel += 1) {
    parseVbMdhView(view, offset);
    offset += VB_MDH_SIZE;
    copyComplexFloatBlock(destination, channel * samples * 2, bytes, offset, samples * 2);
    offset += bytesPerChannel;
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
    parseChannelHeaderView(view, offset);
    offset += CHANNEL_HEADER_SIZE;
    copyComplexFloatBlock(destination, channel * samples * 2, bytes, offset, samples * 2);
    offset += bytesPerChannel;
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
