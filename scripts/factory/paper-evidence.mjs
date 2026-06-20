import { readFile } from "node:fs/promises";
import path from "node:path";
import { detectEvidenceDrift } from "./drift.mjs";
import { average, roundMoney, roundRatio, unique } from "./utils.mjs";

export async function readPaperEvidence({ storageDir, paperTradesPath = null, since = null, until = null } = {}) {
  const sourcePath = path.resolve(paperTradesPath ?? path.join(storageDir ?? ".", "paper-trades.jsonl"));
  const executablePath = path.resolve(storageDir ?? ".", "top-traders-executable.json");
  const tradeRows = await readJsonLines(sourcePath);
  const executableRows = await readExecutablePaperRows(executablePath);
  const rows = dedupeEvidenceRows([...tradeRows, ...executableRows]);
  const filtered = rows.filter((row) => inWindow(row, since, until));
  const byAlgoId = {};
  for (const row of filtered) {
    for (const key of paperAlgoKeys(row)) {
      byAlgoId[key] ??= [];
      byAlgoId[key].push(normalizePaperTrade(row));
    }
  }
  return {
    sourcePath,
    sourcePaths: {
      paperTrades: sourcePath,
      topTradersExecutable: executablePath,
    },
    byAlgoId,
    summary: {
      sourcePath,
      sourcePaths: {
        paperTrades: sourcePath,
        topTradersExecutable: executablePath,
      },
      rawTradeRows: tradeRows.length,
      executablePositionRows: executableRows.length,
      rawEvidenceRows: rows.length,
      usableTradeRows: filtered.length,
      matchedAlgoCount: Object.keys(byAlgoId).length,
      limitations: [
        "Paper trade rows do not include a complete reject stream, so fill-quality drift uses trade/open/closed rates plus any slippage-like fields present.",
        "Top Traders executable positions are used only when exact-linked and paper-only; they remain diagnostic paper evidence and do not make a rejected row promotable.",
      ],
    },
  };
}

export function paperEvidenceForAlgo(algoId, evidence, context = {}) {
  const rows = evidence?.byAlgoId?.[algoId] ?? [];
  if (!rows.length) {
    return {
      available: false,
      source: evidence?.sourcePath ?? null,
      closedMarkets: 0,
      closedTrades: 0,
      status: "missing",
      driftOk: true,
      driftReasons: [],
      driftScore: 0,
      drift: {
        driftOk: true,
        driftReasons: [],
        driftScore: 0,
        components: { paperTradeCount: 0, source: "none" },
      },
    };
  }

  const closed = rows.filter((row) => row.status === "closed" && typeof row.pnl === "number");
  const totalPnl = roundMoney(closed.reduce((total, row) => total + row.pnl, 0));
  const totalCost = roundMoney(closed.reduce((total, row) => total + tradeCost(row), 0));
  const drift = detectEvidenceDrift({
    validationTrades: context.validationTrades ?? [],
    paperTrades: closed,
    validationRegimes: context.validationRegimes ?? {},
    paperRegimes: regimeShareFromTrades(closed),
    validationFill: context.validationFill ?? {},
    paperFill: fillQualityFromPaperTrades(rows),
    thresholds: context.driftThresholds,
  });

  return {
    available: true,
    source: evidence?.sourcePath ?? null,
    status: drift.driftOk ? "ok" : "drift",
    closedMarkets: unique(closed.map((row) => row.marketTicker)).length,
    closedTrades: closed.length,
    openTrades: rows.filter((row) => row.status === "open").length,
    wins: closed.filter((row) => row.pnl > 0).length,
    losses: closed.filter((row) => row.pnl < 0).length,
    totalPnl,
    totalCost,
    roi: totalCost > 0 ? roundRatio(totalPnl / totalCost) : null,
    firstOpenedAt: earliest(rows.map((row) => row.openedAt)),
    lastTransactionAt: latest(rows.flatMap((row) => [row.closedAt, row.openedAt])),
    driftOk: drift.driftOk,
    driftReasons: drift.driftReasons,
    driftScore: drift.driftScore,
    drift,
  };
}

function paperAlgoKeys(row) {
  const keys = new Set();
  const raw = stringOrNull(row?.sourceAlgoId)
    ?? stringOrNull(row?.algoSourceId)
    ?? stringOrNull(row?.sourceResearchAlgoId)
    ?? sourceAlgoIdFromStrategyId(row?.strategyId);
  if (raw) {
    keys.add(raw);
    const withoutActivationSuffix = raw.replace(/:\d{10,}$/, "");
    keys.add(withoutActivationSuffix);
  }
  const strategy = stringOrNull(row?.strategyId);
  if (strategy?.startsWith("generated:")) {
    const source = strategy.slice("generated:".length);
    keys.add(source);
    keys.add(source.replace(/:\d{10,}$/, ""));
  }
  return [...keys].filter(Boolean);
}

function sourceAlgoIdFromStrategyId(strategyId) {
  const normalized = stringOrNull(strategyId);
  if (!normalized) return null;
  return normalized.startsWith("generated:") ? normalized.slice("generated:".length) : normalized;
}

function normalizePaperTrade(row) {
  return {
    id: stringOrNull(row?.id) ?? JSON.stringify(row),
    strategyId: stringOrNull(row?.strategyId),
    sourceAlgoId: stringOrNull(row?.sourceAlgoId) ?? stringOrNull(row?.algoSourceId) ?? stringOrNull(row?.sourceResearchAlgoId),
    researchCandidateId: stringOrNull(row?.researchCandidateId),
    candidateConfigHash: stringOrNull(row?.candidateConfigHash),
    marketTicker: stringOrNull(row?.marketTicker) ?? stringOrNull(row?.ticker) ?? "unknown",
    side: row?.side === "NO" ? "NO" : "YES",
    contracts: numberOrDefault(row?.contracts, 0),
    entryPrice: numberOrDefault(row?.entryPrice, 0),
    exitPrice: numberOrNull(row?.exitPrice),
    openedAt: stringOrNull(row?.openedAt),
    closedAt: stringOrNull(row?.closedAt),
    status: row?.status === "closed" ? "closed" : row?.status === "open" ? "open" : "unknown",
    pnl: numberOrNull(row?.pnl) ?? numberOrNull(row?.realizedPnl),
    feesPaid: numberOrDefault(row?.feesPaid, 0),
    entryContext: isRecord(row?.entryContext) ? row.entryContext : {},
    exitContext: isRecord(row?.exitContext) ? row.exitContext : null,
  };
}

async function readExecutablePaperRows(filePath) {
  const file = await readJsonMaybe(filePath);
  const executable = isRecord(file?.topTradersExecutable) ? file.topTradersExecutable : isRecord(file) ? file : {};
  const stats = isRecord(executable.stats) ? executable.stats : {};
  const positions = Array.isArray(executable.positions) ? executable.positions : [];
  if (!positions.length || !Object.keys(stats).length) return [];
  const exactStats = new Map();
  for (const [key, value] of Object.entries(stats)) {
    if (!isExactLinkedPaperStat(value)) continue;
    const sourceAlgoId = stringOrNull(value.sourceAlgoId) ?? stringOrNull(key);
    if (!sourceAlgoId) continue;
    exactStats.set(sourceAlgoId, value);
    const generatedId = stringOrNull(value.algoId);
    if (generatedId) exactStats.set(generatedId, value);
  }
  return positions
    .map((position) => normalizeExecutablePosition(position, exactStats))
    .filter(Boolean);
}

function normalizeExecutablePosition(position, exactStats) {
  if (!isRecord(position)) return null;
  const sourceAlgoId = stringOrNull(position.algoSourceId)
    ?? stringOrNull(position.sourceAlgoId)
    ?? sourceAlgoIdFromStrategyId(position.algoId)
    ?? sourceAlgoIdFromStrategyId(position.strategyId);
  const stat = exactStats.get(sourceAlgoId) ?? exactStats.get(stringOrNull(position.algoId)) ?? null;
  if (!sourceAlgoId || !stat) return null;
  return {
    id: stringOrNull(position.id) ?? `${sourceAlgoId}:${position.ticker ?? position.marketTicker ?? "unknown"}:${position.openedAt ?? ""}`,
    strategyId: stringOrNull(position.algoId) ?? `generated:${sourceAlgoId}`,
    sourceAlgoId,
    algoSourceId: sourceAlgoId,
    sourceResearchAlgoId: stringOrNull(stat.sourceResearchAlgoId) ?? sourceAlgoId,
    researchCandidateId: stringOrNull(stat.researchCandidateId),
    candidateConfigHash: stringOrNull(stat.candidateConfigHash),
    marketTicker: stringOrNull(position.ticker) ?? stringOrNull(position.marketTicker),
    side: position.side === "NO" ? "NO" : "YES",
    contracts: numberOrDefault(position.contracts, 0),
    entryPrice: numberOrDefault(position.entryPrice, 0),
    exitPrice: numberOrNull(position.exitPrice),
    openedAt: stringOrNull(position.openedAt),
    closedAt: stringOrNull(position.closedAt),
    status: position.status === "closed" ? "closed" : position.status === "open" ? "open" : "unknown",
    pnl: numberOrNull(position.realizedPnl),
    realizedPnl: numberOrNull(position.realizedPnl),
    feesPaid: 0,
    entryContext: {
      source: "top_traders_executable",
      lane: stat.lane ?? null,
      evidenceStatus: stat.evidenceStatus ?? null,
      displayId: stat.displayId ?? position.algoDisplayId ?? null,
      family: stat.family ?? position.algoFamily ?? null,
    },
    exitContext: position.status === "closed" ? { exitReason: position.exitReason ?? null } : null,
  };
}

function isExactLinkedPaperStat(value) {
  if (!isRecord(value)) return false;
  return value.exactLinked === true
    && value.paperOnly === true
    && typeof value.researchCandidateId === "string"
    && typeof value.candidateConfigHash === "string"
    && stringOrNull(value.sourceAlgoId);
}

function dedupeEvidenceRows(rows) {
  const seen = new Set();
  const output = [];
  for (const row of rows) {
    const id = stringOrNull(row?.id) ?? JSON.stringify(row);
    const key = `${stringOrNull(row?.sourceAlgoId) ?? stringOrNull(row?.algoSourceId) ?? stringOrNull(row?.strategyId) ?? ""}:${id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(row);
  }
  return output;
}

function regimeShareFromTrades(trades) {
  const counts = {};
  for (const trade of trades) {
    const key = trade.entryContext?.regime?.timeToClose
      ?? timeToCloseBucket(trade.entryContext?.secondsToClose)
      ?? "unknown";
    counts[key] = (counts[key] ?? 0) + 1;
  }
  const total = Math.max(1, Object.values(counts).reduce((sum, value) => sum + value, 0));
  return Object.fromEntries(Object.entries(counts).map(([key, value]) => [key, roundRatio(value / total)]));
}

function fillQualityFromPaperTrades(rows) {
  const openOrClosed = rows.filter((row) => row.status === "open" || row.status === "closed").length;
  const closed = rows.filter((row) => row.status === "closed").length;
  const slippageValues = rows
    .map((row) => numberOrNull(row.entryContext?.slippage) ?? numberOrNull(row.entryContext?.slippageCents))
    .filter((value) => value !== null);
  return {
    fillRate: openOrClosed > 0 ? roundRatio(closed / openOrClosed) : 0,
    avgSlippage: average(slippageValues) ?? 0,
  };
}

function tradeCost(row) {
  return numberOrDefault(row.entryPrice, 0) * numberOrDefault(row.contracts, 0) + numberOrDefault(row.feesPaid, 0);
}

function timeToCloseBucket(seconds) {
  const value = numberOrNull(seconds);
  if (value === null) return null;
  if (value <= 60) return "final_60s";
  if (value <= 180) return "final_3m";
  if (value <= 600) return "middle";
  return "early";
}

async function readJsonLines(filePath) {
  try {
    const text = await readFile(filePath, "utf8");
    return text
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

async function readJsonMaybe(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

function inWindow(row, since, until) {
  const times = [Date.parse(row?.openedAt ?? ""), Date.parse(row?.closedAt ?? "")].filter(Number.isFinite);
  if (!times.length) return true;
  if (Number.isFinite(since) && times.every((time) => time < since)) return false;
  if (Number.isFinite(until) && times.every((time) => time > until)) return false;
  return true;
}

function earliest(values) {
  const times = values.filter(Boolean).sort((left, right) => Date.parse(left) - Date.parse(right));
  return times[0] ?? null;
}

function latest(values) {
  const times = values.filter(Boolean).sort((left, right) => Date.parse(right) - Date.parse(left));
  return times[0] ?? null;
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stringOrNull(value) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function numberOrDefault(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function numberOrNull(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
