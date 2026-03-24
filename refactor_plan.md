# Refactor Plan

Goal: improve code clarity and separation of concerns without changing runtime behavior.

## Principles

- Keep types in dedicated type modules.
- Keep binary layout offsets and protocol constants in constant/layout modules.
- Keep binary parsing as pure `DataView -> struct` functions.
- Keep conversion/mapping logic separate from file I/O orchestration.
- Keep PMU/syncdata parsing in its own module.
- Reduce duplicated parser logic and limit public exports.

## Priority Order

### 1. Twix parsing layer

Refactor:

- `src/lib/converter.ts`
- `src/lib/twix.ts`
- `src/lib/twix/types.ts`
- `src/lib/twix/constants.ts`

Planned modules:

- `src/lib/twix/layout.ts`
  - VB/VD/channel binary field offsets
- `src/lib/twix/parsers.ts`
  - shared parsers for VB MDH, VD scan header, channel header, loop counters, slice data
- `src/lib/twix/pmu.ts`
  - PMU/syncdata parsing and waveform ID mapping

Main tasks:

- Remove duplicated parsers from `twix.ts`
- Move full parser implementations out of `converter.ts`
- Replace magic offsets with named layout constants
- Replace flag/type if-chains with small tables where it improves readability

### 2. ISMRMRD wrapper layer

Refactor:

- `src/lib/ismrmrdHdf5.ts`

Planned modules:

- `src/lib/ismrmrd/types.ts`
- `src/lib/ismrmrd/wasm.ts`
- `src/lib/ismrmrd/io.ts`

Main tasks:

- Separate types from wasm runtime helpers
- Separate reader/writer/copy orchestration from low-level module loading
- Keep public API stable

### 3. Header editing layer

Refactor:

- `src/lib/headerDraft.ts`
- `src/lib/headerXml.ts`
- `src/lib/metaMrd.ts`

Planned modules:

- `src/lib/header/types.ts`
- `src/lib/header/state.ts`
- `src/lib/header/xml.ts`
- `src/lib/header/merge.ts`

Main tasks:

- Separate editor field state/types from XML transform logic
- Keep current behavior for field provenance, restore, and delete

### 4. App/UI orchestration

Refactor:

- `src/main.tsx`

Planned extractions:

- header tree/editor component logic
- conversion controller helpers
- file mode branching helpers

Main tasks:

- Reduce component size
- Keep behavior unchanged
- Avoid mixing tree rendering, conversion orchestration, and file-loading flow

## Guardrails

- Refactor in small slices
- Verify with `npm run typecheck` and `npm run build` after each stage
- Prefer extraction and reuse over rewriting logic
- Do not change behavior unless required to preserve correctness
