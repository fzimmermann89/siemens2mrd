# siemens_converter_js

Browser-based Siemens Twix to ISMRMRD converter.

This project is split into three parts:

- `src/`: the React and TypeScript application
- `ismrmrd/`: upstream ISMRMRD source
- `ismrmrd_wasm/`: local wasm wrapper used to write and read MRD files in the browser

The XML and XSL parameter maps come from:

- `siemens_to_ismrmrd/parameter_maps`

## Requirements

- Node.js and npm
- Emscripten, only if you want to rebuild the wasm writer

## Install

```bash
git submodule update --init --recursive
npm install
```

## Run the app

```bash
npm run dev
```

## Typecheck

```bash
npm run typecheck
```

## Production build

```bash
npm run build
```

Normal app builds do not require Emscripten. The generated wasm runtime is already committed in:

- `ismrmrd_wasm/build/ismrmrd_wasm_writer.js`
- `ismrmrd_wasm/build/ismrmrd_wasm_writer.wasm`

The standard build also verifies that the committed wasm runtime still matches:

- `ismrmrd_wasm/src/`
- `ismrmrd_wasm/include/`
- the pinned `ismrmrd` and `siemens_to_ismrmrd` submodule revisions

## Rebuild the ISMRMRD wasm wrapper

Only needed if you change files in `ismrmrd_wasm/` or update the upstream `ismrmrd/` source.

```bash
npm run build:ismrmrd-wasm
```

By default the rebuild script expects Emscripten in:

- `.tools/emsdk`

You can override that with:

- `EMSDK_ROOT`
- `EMCMAKE_BIN`
- `EM_CONFIG`

The wrapper build fetches `libhdf5-wasm` automatically via CMake `FetchContent`.
You do not need to vendor or install HDF5 separately for the app. It is only needed when rebuilding the wrapper.

The generated runtime files are written to:

- `ismrmrd_wasm/build/ismrmrd_wasm_writer.js`
- `ismrmrd_wasm/build/ismrmrd_wasm_writer.wasm`
