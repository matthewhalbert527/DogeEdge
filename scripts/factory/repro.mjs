import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { hashJson } from "./utils.mjs";

export async function decisionFrameInputManifest(framesDir) {
  const files = (await listFiles(framesDir)).filter((file) => file.endsWith(".jsonl")).sort();
  const entries = [];
  for (const file of files) {
    const bytes = await readFile(file);
    const fileStat = await stat(file);
    entries.push({
      path: file,
      relativePath: path.relative(framesDir, file),
      byteSize: fileStat.size,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
  }
  return {
    framesDir,
    files: entries,
    manifestHash: hashJson(entries.map(({ relativePath, byteSize, sha256 }) => ({ relativePath, byteSize, sha256 }))),
  };
}

export async function assertReplayInputManifest(framesDir, savedRegistry, { permissiveDebug = false } = {}) {
  const current = await decisionFrameInputManifest(framesDir);
  const check = compareInputManifest(savedRegistry, current);
  if (!check.matches && !permissiveDebug) {
    throw new Error(`Replay input manifest mismatch: ${check.reasonCodes.join(", ")}`);
  }
  return {
    ...check,
    currentManifestHash: current.manifestHash,
  };
}

export function compareInputManifest(savedRegistry, currentManifest) {
  const expectedHash = savedRegistry?.inputManifestHash ?? savedRegistry?.dataHash ?? null;
  const expectedFiles = Array.isArray(savedRegistry?.inputFiles) ? savedRegistry.inputFiles : [];
  const currentFiles = Array.isArray(currentManifest?.files) ? currentManifest.files : [];
  const reasonCodes = [];
  if (!expectedHash) reasonCodes.push("missing_saved_input_manifest_hash");
  if (expectedHash && expectedHash !== currentManifest?.manifestHash) reasonCodes.push("input_manifest_hash_changed");
  const expectedByPath = new Map(expectedFiles.map((file) => [file.relativePath ?? file.path, file]));
  const currentByPath = new Map(currentFiles.map((file) => [file.relativePath ?? file.path, file]));
  for (const [relativePath, expected] of expectedByPath) {
    const actual = currentByPath.get(relativePath);
    if (!actual) {
      reasonCodes.push(`missing_input_file:${relativePath}`);
      continue;
    }
    if (expected.byteSize !== actual.byteSize || expected.sha256 !== actual.sha256) {
      reasonCodes.push(`input_file_changed:${relativePath}`);
    }
  }
  for (const relativePath of currentByPath.keys()) {
    if (!expectedByPath.has(relativePath)) reasonCodes.push(`extra_input_file:${relativePath}`);
  }
  return {
    matches: reasonCodes.length === 0,
    expectedManifestHash: expectedHash,
    reasonCodes,
    expectedFileCount: expectedFiles.length,
    currentFileCount: currentFiles.length,
  };
}

async function listFiles(dir) {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    const nested = await Promise.all(entries.map(async (entry) => {
      const fullPath = path.join(dir, entry.name);
      return entry.isDirectory() ? listFiles(fullPath) : [fullPath];
    }));
    return nested.flat();
  } catch {
    return [];
  }
}
