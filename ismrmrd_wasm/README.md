# ISMRMRD wasm wrapper

This directory contains the project-owned WebAssembly wrapper used by the app.

Layout:

- `../ismrmrd`
  clean upstream ISMRMRD source tree, suitable for a git submodule
- `include/ismrmrd/wasm_writer.h`
  narrow C API used by the browser app
- `src/ismrmrd_wasm_writer.c`
  shim implementation for writing and reading ISMRMRD datasets in wasm
- `build/ismrmrd_wasm_writer.js`
- `build/ismrmrd_wasm_writer.wasm`
  current built runtime artifacts consumed by the app

The intent is to keep upstream ISMRMRD source untouched and keep all local
wasm-specific code in this directory.

## Build

The committed files in `build/` are the runtime used by the app. You only need to rebuild them when:

- `ismrmrd_wasm/src/` changes
- `ismrmrd_wasm/include/` changes
- the upstream `../ismrmrd` submodule changes

For normal app builds, Emscripten is not required.

The main app build checks `manifest.json` so source files, submodule revisions,
and committed wasm artifacts cannot silently drift apart.

## Rebuild

From the repository root:

```bash
npm run build:ismrmrd-wasm
```

This script expects Emscripten under `.tools/emsdk` by default. You can override that with `EMSDK_ROOT`, `EMCMAKE_BIN`, or `EM_CONFIG`.

If you want to run CMake directly, the equivalent commands are:

```bash
EM_CONFIG=/path/to/emsdk/.emscripten \
/path/to/emsdk/upstream/emscripten/emcmake cmake \
  -S ismrmrd_wasm \
  -B ismrmrd_wasm/out \
  -DCMAKE_BUILD_TYPE=Release

EM_CONFIG=/path/to/emsdk/.emscripten \
cmake --build ismrmrd_wasm/out -j4
```

The build uses `FetchContent` to download `libhdf5-wasm` automatically. No separate HDF5 installation step is required.

The output files are written to `ismrmrd_wasm/build/`.
