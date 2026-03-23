#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="${ROOT_DIR}/ismrmrd_wasm/out"

EMSDK_ROOT="${EMSDK_ROOT:-${ROOT_DIR}/.tools/emsdk}"
EM_CONFIG_FILE="${EM_CONFIG:-${EMSDK_ROOT}/.emscripten}"
EMCMAKE_BIN="${EMCMAKE_BIN:-${EMSDK_ROOT}/upstream/emscripten/emcmake}"

if [[ ! -x "${EMCMAKE_BIN}" ]]; then
  echo "Missing emcmake at ${EMCMAKE_BIN}" >&2
  echo "Set EMSDK_ROOT or EMCMAKE_BIN to your Emscripten installation." >&2
  exit 1
fi

if [[ ! -f "${EM_CONFIG_FILE}" ]]; then
  echo "Missing Emscripten config at ${EM_CONFIG_FILE}" >&2
  echo "Set EM_CONFIG to your .emscripten file if it lives elsewhere." >&2
  exit 1
fi

export EM_CONFIG="${EM_CONFIG_FILE}"

"${EMCMAKE_BIN}" cmake \
  -S "${ROOT_DIR}/ismrmrd_wasm" \
  -B "${OUT_DIR}" \
  -DCMAKE_BUILD_TYPE=Release

cmake --build "${OUT_DIR}" -j4
