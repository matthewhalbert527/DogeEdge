import { createHash } from "node:crypto";
import { access, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { familyResearchSupported } from "./family-registry.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const args = parseArgs(process.argv.slice(2));
const dataRoot = path.resolve(args["data-root"] ?? process.env.DOGEEDGE_DATA_ROOT ?? await defaultDataRoot());
const storageDir = path.resolve(args["storage-dir"] ?? process.env.DOGEEDGE_DATA_DIR ?? path.join(dataRoot, "local-worker"));
const outDir = path.resolve(args.out ?? path.join(dataRoot, "archives", `legacy-telemetry-${timestampId()}`));
const resetUnlinkedSupported = Boolean(args["reset-unlinked-supported"]);

await mkdir(outDir, { recursive: true });
const files = [
  "latest.json",
  "app-state.json",
  "paper-trades.jsonl",
  "paper-events.jsonl",
  "shadow-trades.jsonl",
  "shadow-events.jsonl",
  "algorithm-candidates.json",
  "rules-active.json",
  "summary.md",
];
const archived = [];
for (const file of files) {
  const source = path.join(storageDir, file);
  try {
    const bytes = await readFile(source);
    const target = path.join(outDir, file);
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(source, target);
    archived.push({ file, source, target, bytes: bytes.length, sha256: sha256(bytes) });
  } catch {
    // Missing files are recorded in the manifest below.
  }
}

let resetReport = null;
if (resetUnlinkedSupported) {
  resetReport = await resetSupportedUnlinkedExecutableStats(storageDir);
}

const manifest = {
  schemaVersion: "dogeedge.legacy-telemetry-archive.v1",
  generatedAt: new Date().toISOString(),
  storageDir,
  outDir,
  archived,
  missingFiles: files.filter((file) => !archived.some((row) => row.file === file)),
  resetUnlinkedSupported,
  resetReport,
  canPlaceOrders: false,
};
await writeFile(path.join(outDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(`Legacy telemetry archive complete: ${archived.length} files -> ${outDir}`);
if (resetReport) console.log(`Reset supported unlinked executable stats: ${resetReport.removedStats}/${resetReport.originalStats}`);

async function resetSupportedUnlinkedExecutableStats(storageDir) {
  const latestPath = path.join(storageDir, "latest.json");
  const latest = await readJsonMaybe(latestPath);
  const executable = latest?.topTradersExecutable;
  const stats = executable?.stats;
  if (!stats || typeof stats !== "object") return { originalStats: 0, removedStats: 0, keptStats: 0, reason: "top_traders_executable_stats_absent" };
  const nextStats = {};
  let removed = 0;
  for (const [key, row] of Object.entries(stats)) {
    const supported = familyResearchSupported(row?.family);
    const exactLinked = Boolean(row?.researchCandidateId && row?.candidateConfigHash);
    if (supported && !exactLinked) {
      removed += 1;
      continue;
    }
    nextStats[key] = row;
  }
  const next = {
    ...latest,
    topTradersExecutable: {
      ...executable,
      stats: nextStats,
    },
  };
  await writeFile(latestPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return { originalStats: Object.keys(stats).length, removedStats: removed, keptStats: Object.keys(nextStats).length };
}

async function readJsonMaybe(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function timestampId() {
  return new Date().toISOString().replaceAll(":", "-").replace(/\.\d{3}Z$/, "Z");
}

async function defaultDataRoot() {
  if (process.platform === "win32") {
    try {
      await access("D:\\");
      return "D:\\DogeEdge\\data";
    } catch {
      // Fall back to repo-local data.
    }
  }
  return path.join(repoRoot, "data");
}

function parseArgs(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value.startsWith("--")) continue;
    const key = value.slice(2);
    const next = values[index + 1];
    if (!next || next.startsWith("--")) parsed[key] = true;
    else {
      parsed[key] = next;
      index += 1;
    }
  }
  return parsed;
}
