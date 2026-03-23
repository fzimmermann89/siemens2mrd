import type { ConversionResult, IsmrmrdAcquisitionLike, IsmrmrdWaveformLike } from "./converter";

const GROUP_NAME = "dataset";
const ACQUISITION_HEADER_BYTES = 340;
const WAVEFORM_HEADER_BYTES = 40;
const EXPORT_CHUNK_BYTES = 1024 * 1024;
const FLUSH_EVERY_ACQUISITIONS = 512;
const FLUSH_EVERY_WAVEFORMS = 64;

type IsmrmrdModule = {
  HEAPU8: Uint8Array;
  FS: {
    readFile: (path: string, options?: { encoding?: string }) => Uint8Array;
    writeFile: (path: string, data: Uint8Array) => void;
    unlink: (path: string) => void;
    open: (path: string, mode: string) => unknown;
    read: (stream: unknown, buffer: Uint8Array, offset: number, length: number, position: number) => number;
    close: (stream: unknown) => void;
  };
  UTF8ToString: (ptr: number) => string;
  stringToUTF8: (value: string, ptr: number, maxBytes: number) => void;
  _malloc: (size: number) => number;
  _free: (ptr: number) => void;
  _ismrmrdshim_create_dataset: (filenamePtr: number, groupPtr: number) => number;
  _ismrmrdshim_open_dataset: (filenamePtr: number, groupPtr: number) => number;
  _ismrmrdshim_write_header: (writerPtr: number, xmlPtr: number) => number;
  _ismrmrdshim_read_header: (writerPtr: number) => number;
  _ismrmrdshim_get_number_of_acquisitions: (writerPtr: number) => number;
  _ismrmrdshim_append_acquisition: (writerPtr: number, headerPtr: number, trajPtr: number, dataPtr: number) => number;
  _ismrmrdshim_read_acquisition: (
    writerPtr: number,
    index: number,
    headerPtr: number,
    trajPtr: number,
    trajCapacity: number,
    trajLengthPtr: number
  ) => number;
  _ismrmrdshim_append_waveform: (writerPtr: number, headerPtr: number, dataPtr: number) => number;
  _ismrmrdshim_flush_dataset: (writerPtr: number) => number;
  _ismrmrdshim_close_dataset: (writerPtr: number) => number;
  _ismrmrdshim_destroy_dataset: (writerPtr: number) => void;
  _ismrmrdshim_get_last_error: () => number;
};

export interface IsmrmrdMetaSummary {
  headerXml: string;
  acquisitionCount: number;
}

export interface IsmrmrdMetaAcquisition {
  numberOfSamples: number;
  trajectoryDimensions: number;
  trajectory: Float32Array;
}
type SaveFileHandle = {
  createWritable: () => Promise<{
    write: (data: BufferSource | Blob) => Promise<void>;
    close: () => Promise<void>;
    abort?: (reason?: unknown) => Promise<void>;
  }>;
};

let modulePromise: Promise<IsmrmrdModule> | null = null;

export function preloadHdf5(): Promise<IsmrmrdModule> {
  if (!modulePromise) {
    modulePromise = import("../../ismrmrd_wasm/build/ismrmrd_wasm_writer.js").then(
      async (module) =>
        module.default({
          locateFile(path: string) {
            if (path.endsWith(".wasm")) {
              return new URL("../../ismrmrd_wasm/build/ismrmrd_wasm_writer.wasm", import.meta.url).href;
            }
            return path;
          }
        })
    );
  }
  return modulePromise!;
}

export async function createIsmrmrdWriter(filename: string, headerXml: string): Promise<IsmrmrdWriter> {
  const module = await preloadHdf5();
  const normalizedHeaderXml = normalizeHeaderXml(headerXml);
  validateHeaderXml(normalizedHeaderXml);
  return IsmrmrdWriter.create(module, filename, createInternalFilename(filename), normalizedHeaderXml);
}

export async function readIsmrmrdMetaSummary(file: File): Promise<IsmrmrdMetaSummary> {
  const reader = await createIsmrmrdReader(file);
  try {
    return {
      headerXml: reader.readHeaderXml(),
      acquisitionCount: reader.getAcquisitionCount()
    };
  } finally {
    reader.dispose();
  }
}

export async function createIsmrmrdReader(file: File): Promise<IsmrmrdReader> {
  const module = await preloadHdf5();
  const runtimeFilename = createInternalFilename(file.name.replace(/[^a-zA-Z0-9._-]/g, "_"));
  module.FS.writeFile(runtimeFilename, new Uint8Array(await file.arrayBuffer()));
  try {
    return IsmrmrdReader.create(module, runtimeFilename, GROUP_NAME);
  } catch (error) {
    try {
      module.FS.unlink(runtimeFilename);
    } catch {
      // best-effort cleanup
    }
    throw error;
  }
}

export async function writeIsmrmrdFile(
  filename: string,
  conversions: ConversionResult[],
  headerXml: string
): Promise<Blob> {
  const writer = await createIsmrmrdWriter(filename, headerXml);
  for (const conversion of conversions) {
    await writer.appendConversion(conversion);
  }
  return writer.finalizeToBlob();
}

export class IsmrmrdWriter {
  private acquisitionCount = 0;
  private waveformCount = 0;
  private closed = false;

  private constructor(
    private readonly module: IsmrmrdModule,
    private readonly exportFilename: string,
    private readonly runtimeFilename: string,
    private readonly writerPtr: number
  ) {}

  static create(
    module: IsmrmrdModule,
    exportFilename: string,
    runtimeFilename: string,
    headerXml: string
  ): IsmrmrdWriter {
    const filenamePtr = allocString(module, runtimeFilename);
    const groupPtr = allocString(module, GROUP_NAME);
    const headerPtr = allocString(module, headerXml);
    let writerPtr = 0;

    try {
      writerPtr = module._ismrmrdshim_create_dataset(filenamePtr, groupPtr);
      if (!writerPtr) {
        throw new Error(`create dataset failed: ${getLastError(module)}`);
      }
      const status = module._ismrmrdshim_write_header(writerPtr, headerPtr);
      if (status !== 0) {
        throw new Error(`write header failed: ${getLastError(module)}`);
      }
      return new IsmrmrdWriter(module, exportFilename, runtimeFilename, writerPtr);
    } catch (error) {
      if (writerPtr) {
        try {
          module._ismrmrdshim_destroy_dataset(writerPtr);
        } catch {
          // best-effort cleanup
        }
      }
      try {
        module.FS.unlink(runtimeFilename);
      } catch {
        // best-effort cleanup
      }
      throw error;
    } finally {
      module._free(filenamePtr);
      module._free(groupPtr);
      module._free(headerPtr);
    }
  }

  async appendConversion(conversion: ConversionResult): Promise<void> {
    for (const acquisition of conversion.acquisitions) {
      await this.appendAcquisition(acquisition);
    }
    for (const waveform of conversion.waveforms) {
      await this.appendWaveform(waveform);
    }
  }

  async appendAcquisition(acquisition: IsmrmrdAcquisitionLike): Promise<void> {
    this.ensureOpen();

    const headerPtr = this.module._malloc(ACQUISITION_HEADER_BYTES);
    const dataPtr = copyBytes(this.module, toUint8Array(acquisition.data));
    const trajPtr = acquisition.traj.length > 0 ? copyBytes(this.module, toUint8Array(acquisition.traj)) : 0;

    try {
      writeAcquisitionHeader(this.module, headerPtr, acquisition);
      this.checkStatus(
        this.module._ismrmrdshim_append_acquisition(this.writerPtr, headerPtr, trajPtr, dataPtr),
        "append acquisition"
      );
      this.acquisitionCount += 1;
      if (this.acquisitionCount % FLUSH_EVERY_ACQUISITIONS === 0) {
        this.flush();
      }
    } finally {
      if (trajPtr) {
        this.module._free(trajPtr);
      }
      this.module._free(dataPtr);
      this.module._free(headerPtr);
    }
  }

  async appendWaveform(waveform: IsmrmrdWaveformLike): Promise<void> {
    this.ensureOpen();

    const headerPtr = this.module._malloc(WAVEFORM_HEADER_BYTES);
    const dataPtr = copyBytes(this.module, toUint8Array(waveform.data));

    try {
      writeWaveformHeader(this.module, headerPtr, waveform);
      this.checkStatus(
        this.module._ismrmrdshim_append_waveform(this.writerPtr, headerPtr, dataPtr),
        "append waveform"
      );
      this.waveformCount += 1;
      if (this.waveformCount % FLUSH_EVERY_WAVEFORMS === 0) {
        this.flush();
      }
    } finally {
      this.module._free(dataPtr);
      this.module._free(headerPtr);
    }
  }

  async finalizeToBlob(): Promise<Blob> {
    this.ensureOpen();
    this.finalizeFile();
    const bytes = this.module.FS.readFile(this.runtimeFilename, { encoding: "binary" }) as Uint8Array;
    this.module.FS.unlink(this.runtimeFilename);
    return new Blob([new Uint8Array(bytes)], { type: "application/x-hdf" });
  }

  async saveToFileHandle(handle: SaveFileHandle): Promise<void> {
    this.ensureOpen();
    this.finalizeFile();

    const writable = await handle.createWritable();
    const stream = this.module.FS.open(this.runtimeFilename, "r");
    const buffer = new Uint8Array(EXPORT_CHUNK_BYTES);
    let position = 0;

    try {
      while (true) {
        const read = this.module.FS.read(stream, buffer, 0, buffer.length, position) as number;
        if (read <= 0) break;
        await writable.write(buffer.subarray(0, read));
        position += read;
      }
      await writable.close();
    } catch (error) {
      await writable.abort?.(error);
      throw error;
    } finally {
      this.module.FS.close(stream);
      try {
        this.module.FS.unlink(this.runtimeFilename);
      } catch {
        // best-effort cleanup
      }
    }
  }

  dispose(): void {
    if (this.closed) {
      return;
    }
    try {
      this.module._ismrmrdshim_destroy_dataset(this.writerPtr);
    } catch {
      // best-effort cleanup
    }
    this.closed = true;
    try {
      this.module.FS.unlink(this.runtimeFilename);
    } catch {
      // best-effort cleanup
    }
  }

  private flush(): void {
    this.checkStatus(this.module._ismrmrdshim_flush_dataset(this.writerPtr), "flush dataset");
  }

  private finalizeFile(): void {
    if (this.closed) {
      throw new Error("writer already finalized");
    }
    this.flush();
    this.checkStatus(this.module._ismrmrdshim_close_dataset(this.writerPtr), "close dataset");
    this.closed = true;
  }

  private ensureOpen(): void {
    if (this.closed) {
      throw new Error("writer is already closed");
    }
  }

  private checkStatus(status: number, action: string): void {
    if (status === 0) {
      return;
    }
    throw new Error(`${action} failed: ${this.getLastError()}`);
  }

  private getLastError(): string {
    return getLastError(this.module);
  }
}

export class IsmrmrdReader {
  private closed = false;

  private constructor(
    private readonly module: IsmrmrdModule,
    private readonly runtimeFilename: string,
    private readonly readerPtr: number
  ) {}

  static create(module: IsmrmrdModule, runtimeFilename: string, groupName: string): IsmrmrdReader {
    const filenamePtr = allocString(module, runtimeFilename);
    const groupPtr = allocString(module, groupName);
    let readerPtr = 0;

    try {
      readerPtr = module._ismrmrdshim_open_dataset(filenamePtr, groupPtr);
      if (!readerPtr) {
        throw new Error(`open dataset failed: ${getLastError(module)}`);
      }
      return new IsmrmrdReader(module, runtimeFilename, readerPtr);
    } catch (error) {
      if (readerPtr) {
        try {
          module._ismrmrdshim_destroy_dataset(readerPtr);
        } catch {
          // best-effort cleanup
        }
      }
      throw error;
    } finally {
      module._free(filenamePtr);
      module._free(groupPtr);
    }
  }

  readHeaderXml(): string {
    this.ensureOpen();
    const xmlPtr = this.module._ismrmrdshim_read_header(this.readerPtr);
    if (!xmlPtr) {
      throw new Error(`read header failed: ${this.getLastError()}`);
    }
    try {
      return this.module.UTF8ToString(xmlPtr);
    } finally {
      this.module._free(xmlPtr);
    }
  }

  getAcquisitionCount(): number {
    this.ensureOpen();
    return this.module._ismrmrdshim_get_number_of_acquisitions(this.readerPtr) >>> 0;
  }

  readAcquisition(index: number): IsmrmrdMetaAcquisition {
    this.ensureOpen();
    const headerPtr = this.module._malloc(ACQUISITION_HEADER_BYTES);
    const lengthPtr = this.module._malloc(4);
    const view = new DataView(this.module.HEAPU8.buffer);

    try {
      this.checkStatus(
        this.module._ismrmrdshim_read_acquisition(this.readerPtr, index, headerPtr, 0, 0, lengthPtr),
        "read acquisition"
      );
      const trajectoryLength = view.getUint32(lengthPtr, true);
      const trajectoryPtr = trajectoryLength > 0 ? this.module._malloc(trajectoryLength * 4) : 0;

      try {
        if (trajectoryPtr) {
          this.checkStatus(
            this.module._ismrmrdshim_read_acquisition(
              this.readerPtr,
              index,
              headerPtr,
              trajectoryPtr,
              trajectoryLength,
              lengthPtr
            ),
            "read acquisition trajectory"
          );
        }

        return {
          numberOfSamples: view.getUint16(headerPtr + 34, true),
          trajectoryDimensions: view.getUint16(headerPtr + 176, true),
          trajectory: trajectoryPtr ? copyFloat32(this.module.HEAPU8, trajectoryPtr, trajectoryLength) : new Float32Array()
        };
      } finally {
        if (trajectoryPtr) {
          this.module._free(trajectoryPtr);
        }
      }
    } finally {
      this.module._free(lengthPtr);
      this.module._free(headerPtr);
    }
  }

  dispose(): void {
    if (this.closed) {
      return;
    }
    try {
      this.module._ismrmrdshim_destroy_dataset(this.readerPtr);
    } catch {
      // best-effort cleanup
    }
    this.closed = true;
    try {
      this.module.FS.unlink(this.runtimeFilename);
    } catch {
      // best-effort cleanup
    }
  }

  private ensureOpen(): void {
    if (this.closed) {
      throw new Error("reader is already closed");
    }
  }

  private checkStatus(status: number, action: string): void {
    if (status === 0) {
      return;
    }
    throw new Error(`${action} failed: ${this.getLastError()}`);
  }

  private getLastError(): string {
    return getLastError(this.module);
  }
}

function getLastError(module: IsmrmrdModule): string {
  const ptr = module._ismrmrdshim_get_last_error();
  return ptr ? module.UTF8ToString(ptr) : "unknown wasm error";
}

function allocString(module: IsmrmrdModule, value: string): number {
  const ptr = module._malloc(value.length + 1);
  module.stringToUTF8(value, ptr, value.length + 1);
  return ptr;
}

function copyBytes(module: IsmrmrdModule, bytes: Uint8Array): number {
  const ptr = module._malloc(bytes.byteLength);
  module.HEAPU8.set(bytes, ptr);
  return ptr;
}

function copyFloat32(heap: Uint8Array, ptr: number, length: number): Float32Array {
  const bytes = heap.slice(ptr, ptr + length * 4);
  return new Float32Array(bytes.buffer, bytes.byteOffset, length).slice();
}

function toUint8Array(values: ArrayBufferView): Uint8Array {
  return new Uint8Array(values.buffer, values.byteOffset, values.byteLength);
}

function writeAcquisitionHeader(module: IsmrmrdModule, ptr: number, acquisition: IsmrmrdAcquisitionLike): void {
  module.HEAPU8.fill(0, ptr, ptr + ACQUISITION_HEADER_BYTES);
  const view = new DataView(module.HEAPU8.buffer);
  const { head } = acquisition;

  view.setUint16(ptr + 0, head.version, true);
  view.setBigUint64(ptr + 2, head.flags, true);
  view.setUint32(ptr + 10, head.measurement_uid, true);
  view.setUint32(ptr + 14, head.scan_counter, true);
  view.setUint32(ptr + 18, head.acquisition_time_stamp, true);
  for (let i = 0; i < 3; i += 1) {
    view.setUint32(ptr + 22 + i * 4, head.physiology_time_stamp[i] ?? 0, true);
  }
  view.setUint16(ptr + 34, head.number_of_samples, true);
  view.setUint16(ptr + 36, head.available_channels, true);
  view.setUint16(ptr + 38, head.active_channels, true);
  for (let i = 0; i < 16; i += 1) {
    view.setBigUint64(ptr + 40 + i * 8, head.channel_mask[i] ?? 0n, true);
  }
  view.setUint16(ptr + 168, head.discard_pre, true);
  view.setUint16(ptr + 170, head.discard_post, true);
  view.setUint16(ptr + 172, head.center_sample, true);
  view.setUint16(ptr + 174, head.encoding_space_ref, true);
  view.setUint16(ptr + 176, head.trajectory_dimensions, true);
  view.setFloat32(ptr + 178, head.sample_time_us, true);
  writeFloat32Array(view, ptr + 182, head.position);
  writeFloat32Array(view, ptr + 194, head.read_dir);
  writeFloat32Array(view, ptr + 206, head.phase_dir);
  writeFloat32Array(view, ptr + 218, head.slice_dir);
  writeFloat32Array(view, ptr + 230, head.patient_table_position);

  view.setUint16(ptr + 242, head.idx.kspace_encode_step_1, true);
  view.setUint16(ptr + 244, head.idx.kspace_encode_step_2, true);
  view.setUint16(ptr + 246, head.idx.average, true);
  view.setUint16(ptr + 248, head.idx.slice, true);
  view.setUint16(ptr + 250, head.idx.contrast, true);
  view.setUint16(ptr + 252, head.idx.phase, true);
  view.setUint16(ptr + 254, head.idx.repetition, true);
  view.setUint16(ptr + 256, head.idx.set, true);
  view.setUint16(ptr + 258, head.idx.segment, true);
  for (let i = 0; i < 8; i += 1) {
    view.setUint16(ptr + 260 + i * 2, head.idx.user[i] ?? 0, true);
  }
  for (let i = 0; i < 8; i += 1) {
    view.setInt32(ptr + 276 + i * 4, head.user_int[i] ?? 0, true);
  }
  for (let i = 0; i < 8; i += 1) {
    view.setFloat32(ptr + 308 + i * 4, head.user_float[i] ?? 0, true);
  }
}

function writeWaveformHeader(module: IsmrmrdModule, ptr: number, waveform: IsmrmrdWaveformLike): void {
  module.HEAPU8.fill(0, ptr, ptr + WAVEFORM_HEADER_BYTES);
  const view = new DataView(module.HEAPU8.buffer);
  const { head } = waveform;

  view.setUint16(ptr + 0, head.version, true);
  view.setBigUint64(ptr + 8, head.flags, true);
  view.setUint32(ptr + 16, head.measurement_uid, true);
  view.setUint32(ptr + 20, head.scan_counter, true);
  view.setUint32(ptr + 24, head.time_stamp, true);
  view.setUint16(ptr + 28, head.number_of_samples, true);
  view.setUint16(ptr + 30, head.channels, true);
  view.setFloat32(ptr + 32, head.sample_time_us, true);
  view.setUint16(ptr + 36, head.waveform_id, true);
}

function writeFloat32Array(view: DataView, offset: number, values: number[]): void {
  for (let i = 0; i < values.length; i += 1) {
    view.setFloat32(offset + i * 4, values[i] ?? 0, true);
  }
}

function createInternalFilename(filename: string): string {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `/${safeName}.${suffix}.tmp`;
}

function normalizeHeaderXml(headerXml: string): string {
  return headerXml
    .replace(/^\uFEFF?[\r\n\t ]*/, "")
    .replace(/^(?:<\?xml[^>]*\?>\s*)+/i, '<?xml version="1.0" encoding="UTF-8"?>\n');
}

function validateHeaderXml(headerXml: string): void {
  const declarationMatches = headerXml.match(/<\?xml[^>]*\?>/gi) ?? [];
  if (declarationMatches.length > 1) {
    throw new Error(`Refusing to write malformed XML header: found ${declarationMatches.length} XML declarations`);
  }
  if (/<parsererror\b/i.test(headerXml)) {
    throw new Error("Refusing to write malformed XML header: parsererror present in serialized XML");
  }
}
