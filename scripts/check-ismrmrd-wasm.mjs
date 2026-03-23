import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const manifestPath = new URL("../ismrmrd_wasm/manifest.json", import.meta.url);
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function getGitHead(path) {
  return execFileSync("git", ["-C", path, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message}\nexpected: ${expected}\nactual:   ${actual}`);
  }
}

for (const [path, expectedHash] of Object.entries(manifest.sources)) {
  if (!existsSync(path)) {
    throw new Error(`Missing wasm source file: ${path}`);
  }
  assertEqual(sha256(path), expectedHash, `Wasm source changed without refreshing manifest: ${path}`);
}

for (const [path, expectedHash] of Object.entries(manifest.artifacts)) {
  if (!existsSync(path)) {
    throw new Error(`Missing committed wasm artifact: ${path}`);
  }
  assertEqual(sha256(path), expectedHash, `Committed wasm artifact drifted: ${path}`);
}

assertEqual(getGitHead("ismrmrd"), manifest.ismrmrdCommit, "ismrmrd submodule commit changed without rebuilding wasm");
assertEqual(
  getGitHead("siemens_to_ismrmrd"),
  manifest.siemensToIsmrmrdCommit,
  "siemens_to_ismrmrd submodule commit changed without refreshing wasm manifest"
);
