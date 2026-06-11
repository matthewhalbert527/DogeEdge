import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { familyResearchSupported } from "./family-registry.mjs";

export function deterministicLinkageBackfill({ researchRows = [], executableRows = [] } = {}) {
  const candidatesByKey = new Map();
  for (const candidate of researchRows) {
    for (const key of candidateKeys(candidate)) {
      const rows = candidatesByKey.get(key) ?? [];
      rows.push(candidate);
      candidatesByKey.set(key, rows);
    }
  }
  const linked = [];
  const unresolved = [];
  for (const row of executableRows) {
    if (!familyResearchSupported(row.family)) {
      unresolved.push({ ...row, linkageStatus: "unsupported_unlinked", reasonCodes: ["unsupported_family"] });
      continue;
    }
    if (row.researchCandidateId && row.candidateConfigHash) {
      linked.push({ ...row, linkageStatus: "already_exact_linked", reasonCodes: [] });
      continue;
    }
    const matches = uniqueRows([
      ...executableKeys(row).flatMap((key) => candidatesByKey.get(key) ?? []),
    ]);
    if (matches.length === 1) {
      const candidate = matches[0];
      linked.push({
        ...row,
        researchCandidateId: candidate.researchCandidateId,
        candidateConfigHash: candidate.candidateConfigHash,
        sourceResearchAlgoId: candidate.sourceResearchAlgoId ?? candidate.algoId,
        sourceRunId: candidate.sourceRunId ?? null,
        sourceSnapshotHash: candidate.sourceSnapshotHash ?? null,
        promotionVerdictAtInstall: candidate.promotionVerdict ?? null,
        linkageStatus: "backfilled_exact_link",
        reasonCodes: [],
      });
    } else {
      unresolved.push({
        ...row,
        linkageStatus: matches.length > 1 ? "ambiguous_unresolved" : "missing_exact_link",
        reasonCodes: [matches.length > 1 ? "ambiguous_candidate_match" : "deterministic_match_absent"],
        matchCount: matches.length,
      });
    }
  }
  return {
    schemaVersion: "dogeedge.linkage-backfill.v1",
    generatedAt: new Date().toISOString(),
    researchRows: researchRows.length,
    executableRows: executableRows.length,
    linkedRows: linked.length,
    unresolvedRows: unresolved.length,
    exactLinkedRows: linked.filter((row) => row.researchCandidateId && row.candidateConfigHash).length,
    linked,
    unresolved,
  };
}

async function linkageCli() {
  const args = parseArgs(process.argv.slice(2));
  const input = path.resolve(args.input ?? "review_exports");
  const outDir = path.resolve(args.out ?? path.join(input, "linkage-audit"));
  const auditOnly = Boolean(args["audit-only"]);
  const research = await loadResearchRows(input);
  const executableRows = await loadExecutableRows(input);
  const report = deterministicLinkageBackfill({ researchRows: research, executableRows });
  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, auditOnly ? "linkage-audit.json" : "linkage-backfill.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(path.join(outDir, "unresolved-linkage.tsv"), tsv(["sourceAlgoId", "algoId", "family", "linkageStatus", "matchCount", "reasonCodes"], report.unresolved.map((row) => ({
    ...row,
    reasonCodes: (row.reasonCodes ?? []).join(","),
  }))), "utf8");
  if (!auditOnly) {
    await writeFile(path.join(outDir, "backfilled-executable-rows.json"), `${JSON.stringify(report.linked, null, 2)}\n`, "utf8");
  }
  console.log(`${auditOnly ? "Linkage audit" : "Linkage backfill"} complete`);
  console.log(`Exact-linked/backfilled rows: ${report.exactLinkedRows}/${report.executableRows}`);
  console.log(`Unresolved rows: ${report.unresolvedRows}`);
  console.log(`Output: ${outDir}`);
}

async function loadResearchRows(input) {
  const sweep = await readJsonMaybe(path.join(input, "repo", "latest-sweep.json"))
    ?? await readJsonMaybe(path.join(input, "latest-sweep.json"))
    ?? await readJsonMaybe(path.join(input, "backtests", "latest-sweep.json"))
    ?? {};
  return uniqueRows([...(Array.isArray(sweep.candidates) ? sweep.candidates : []), ...(Array.isArray(sweep.topMetrics) ? sweep.topMetrics : []), ...(Array.isArray(sweep.metrics) ? sweep.metrics : [])]);
}

async function loadExecutableRows(input) {
  const top = await readJsonMaybe(path.join(input, "repo", "top-traders-executable.json"))
    ?? await readJsonMaybe(path.join(input, "top-traders-executable.json"))
    ?? {};
  const stats = top.topTradersExecutable?.stats ?? top.stats ?? {};
  return Object.values(stats).filter(isRecord).map((row) => ({
    sourceAlgoId: row.sourceAlgoId ?? row.algoId ?? "",
    algoId: row.algoId ?? row.sourceAlgoId ?? "",
    displayId: row.displayId ?? "",
    family: row.family ?? "unknown",
    researchCandidateId: row.researchCandidateId ?? "",
    candidateConfigHash: row.candidateConfigHash ?? "",
    sourceResearchAlgoId: row.sourceResearchAlgoId ?? "",
    sourceRunId: row.sourceRunId ?? "",
    sourceSnapshotHash: row.sourceSnapshotHash ?? "",
    promotionVerdictAtInstall: row.promotionVerdictAtInstall ?? "",
    dryRunTotalPnl: row.totalPnl ?? 0,
    acceptedBuys: row.acceptedBuys ?? 0,
    closedExits: row.sells ?? 0,
  }));
}

function candidateKeys(row) {
  return uniqueStrings([
    row.researchCandidateId,
    row.candidateConfigHash,
    row.sourceResearchAlgoId,
    row.algoId,
    row.id,
  ]);
}

function executableKeys(row) {
  return uniqueStrings([
    row.researchCandidateId,
    row.candidateConfigHash,
    row.sourceResearchAlgoId,
    row.sourceAlgoId,
    String(row.algoId ?? "").replace(/^generated:/, ""),
    row.algoId,
  ]);
}

async function readJsonMaybe(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

function uniqueRows(rows) {
  const seen = new Set();
  const output = [];
  for (const row of rows) {
    const key = row?.researchCandidateId ?? row?.candidateConfigHash ?? row?.algoId ?? row?.sourceAlgoId ?? JSON.stringify(row);
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(row);
  }
  return output;
}

function uniqueStrings(values) {
  return [...new Set(values.map((value) => typeof value === "string" ? value.trim() : "").filter(Boolean))];
}

function tsv(columns, rows) {
  return `${columns.join("\t")}\n${rows.map((row) => columns.map((column) => String(row[column] ?? "")).join("\t")).join("\n")}${rows.length ? "\n" : ""}`;
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
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

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  linkageCli().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
