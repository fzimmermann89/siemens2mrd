import type { TwixMeasurementEntry } from "./types";

const CURSOR_CACHE_BYTES = 4 * 1024 * 1024;

export async function readBlobSlice(file: Blob, start: number, end: number): Promise<ArrayBuffer> {
  return file.slice(start, end).arrayBuffer();
}

export function decodeBufferText(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("latin1").decode(bytes);
  }
}

export function readCString(view: DataView, offset: number, byteLength: number): string {
  const bytes = new Uint8Array(view.buffer, view.byteOffset + offset, byteLength);
  let end = bytes.indexOf(0);
  if (end === -1) {
    end = bytes.length;
  }

  return decodeBufferText(bytes.subarray(0, end)).trim();
}

export function summarizePreview(bytes: Uint8Array): string {
  if (bytes.length === 0) {
    return "";
  }

  const text = decodeBufferText(bytes)
    .replaceAll("\u0000", " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!text) {
    return `[binary preview: ${bytes.length} bytes]`;
  }

  return text.length > 160 ? `${text.slice(0, 157)}...` : text;
}

export function hasEvalMaskBit(mask: readonly [number, number], bit: number): boolean {
  if (bit < 32) {
    return (mask[0] & (1 << bit)) !== 0;
  }

  return (mask[1] & (1 << (bit - 32))) !== 0;
}

export function toSafeNumber(value: bigint, label: string): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`${label} exceeds the browser safe integer range`);
  }

  return Number(value);
}

export function formatBigInt(value: bigint): string {
  if (value <= BigInt(Number.MAX_SAFE_INTEGER)) {
    return new Intl.NumberFormat("en-US").format(Number(value));
  }

  return value.toString();
}

export class BlobCursor {
  readonly file: Blob;
  position: number;
  private cacheStart = 0;
  private cacheEnd = 0;
  private cacheBytes = new Uint8Array(0);

  constructor(file: Blob, start: number) {
    this.file = file;
    this.position = start;
  }

  async readUint32(): Promise<number> {
    const buffer = await this.readBytes(4);
    return new DataView(buffer).getUint32(0, true);
  }

  async readNullTerminatedString(maxBytes: number): Promise<string> {
    const buffer = await this.peekBytes(maxBytes);
    const end = buffer.indexOf(0);
    const consumed = end === -1 ? buffer.length : end + 1;
    this.position += consumed;
    return decodeBufferText(buffer.subarray(0, end === -1 ? buffer.length : end)).trim();
  }

  async readBytes(byteLength: number): Promise<ArrayBuffer> {
    const start = this.position;
    const end = start + byteLength;
    const buffer = await this.readWindow(start, end);
    this.position = end;
    return buffer;
  }

  async peekBytes(byteLength: number): Promise<Uint8Array> {
    const buffer = await this.readWindow(this.position, this.position + byteLength);
    return new Uint8Array(buffer);
  }

  skip(byteLength: number): void {
    this.position += byteLength;
  }

  private async readWindow(start: number, end: number): Promise<ArrayBuffer> {
    const byteLength = end - start;
    if (byteLength <= 0) {
      return new ArrayBuffer(0);
    }

    if (byteLength > CURSOR_CACHE_BYTES / 2) {
      return readBlobSlice(this.file, start, end);
    }

    await this.ensureCache(start, end);
    const offset = start - this.cacheStart;
    return this.cacheBytes.buffer.slice(
      this.cacheBytes.byteOffset + offset,
      this.cacheBytes.byteOffset + offset + byteLength
    );
  }

  private async ensureCache(start: number, end: number): Promise<void> {
    if (start >= this.cacheStart && end <= this.cacheEnd) {
      return;
    }

    const cacheStart = start;
    const cacheEnd = Math.min(this.file.size, cacheStart + CURSOR_CACHE_BYTES);
    const buffer = await readBlobSlice(this.file, cacheStart, cacheEnd);
    this.cacheStart = cacheStart;
    this.cacheEnd = cacheEnd;
    this.cacheBytes = new Uint8Array(buffer);
  }
}

export function makePlaceholderMeasurement(file: File): TwixMeasurementEntry {
  return {
    measurementId: 1,
    fileId: 0,
    offset: 0n,
    length: BigInt(file.size),
    patientName: "",
    protocolName: "VB measurement"
  };
}
