import { createServer } from "node:http";
import { access, appendFile, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import kalshiDogeMarketHandler from "../api/kalshi/doge-market.js";
import kalshiOrderRouterHandler, { routerStatus } from "../api/kalshi/order-router.js";
import kalshiPortfolioHandler from "../api/kalshi/portfolio.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const storageDir = path.resolve(process.env.DOGEEDGE_DATA_DIR ?? await defaultStorageDir());
const dataRoot = path.resolve(process.env.DOGEEDGE_DATA_ROOT ?? path.dirname(storageDir));
const eventsDir = path.join(dataRoot, "events");
const decisionFramesDir = path.join(dataRoot, "features", "decision-frames");
const rawSnapshotsDir = path.join(dataRoot, "raw", "snapshots");
const backtestsDir = path.join(dataRoot, "backtests");
const algosDir = path.resolve(process.env.DOGEEDGE_ALGOS_DIR ?? path.join(path.dirname(dataRoot), "algos"));
const port = Number(process.env.DOGEEDGE_WORKER_PORT ?? 8787);
const host = process.env.DOGEEDGE_WORKER_HOST ?? "127.0.0.1";
const rawSnapshotEveryMs = Math.max(1_000, Number(process.env.DOGEEDGE_RAW_SNAPSHOT_MS ?? 1_000));
const persistBacktestTelemetry = process.env.DOGEEDGE_PERSIST_BACKTEST_TELEMETRY === "1";
const persistPaperEventLog = process.env.DOGEEDGE_PERSIST_PAPER_EVENTS === "1";
const persistShadowTelemetry = process.env.DOGEEDGE_PERSIST_SHADOW === "1";
const autoSweepEnabled = process.env.DOGEEDGE_AUTO_SWEEP === "1";
const sweepIntervalMs = Math.max(5 * 60_000, Number(process.env.DOGEEDGE_SWEEP_INTERVAL_MS ?? 15 * 60_000));
const deepSweepEvery = Math.max(1, Number(process.env.DOGEEDGE_DEEP_SWEEP_EVERY ?? 4));
const seenPath = path.join(storageDir, ".seen.json");
const appStatePath = path.join(storageDir, "app-state.json");
const paperTradesPath = path.join(storageDir, "paper-trades.jsonl");
const factoryBatchesPath = path.join(storageDir, "factory-batches.json");
const realisticArenaArchivesPath = path.join(storageDir, "realistic-arena-archives.json");
const topTradersExecutablePath = path.join(storageDir, "top-traders-executable.json");
const liveSwitchPath = path.join(storageDir, "live-switch.json");
let factorySweepRunning = false;
let lastFactorySweep = null;
let intervalSweepCount = 0;
let paperTradeSummaryCache = null;

await Promise.all([
  storageDir,
  algosDir,
].map((dir) => mkdir(dir, { recursive: true })));

await applyLiveSwitchToEnv(await readLiveSwitch());

const server = createServer(async (request, response) => {
  try {
    setCors(response);

    if (request.method === "OPTIONS") {
      response.writeHead(204);
      response.end();
      return;
    }

    const requestUrl = new URL(request.url ?? "/", `http://${host}:${port}`);

    if (requestUrl.pathname === "/api/kalshi/doge-market") {
      await runApiHandler(kalshiDogeMarketHandler, request, response, requestUrl);
      return;
    }

    if (requestUrl.pathname === "/api/kalshi/portfolio") {
      await runApiHandler(kalshiPortfolioHandler, request, response, requestUrl);
      return;
    }

    if (requestUrl.pathname === "/api/kalshi/order-router") {
      await applyLiveSwitchToEnv(await readLiveSwitch());
      await runApiHandler(kalshiOrderRouterHandler, request, response, requestUrl);
      return;
    }

    if (requestUrl.pathname === "/api/kalshi/live-switch") {
      if (request.method === "GET") {
        const state = await readLiveSwitch();
        await applyLiveSwitchToEnv(state);
        await sendJson(response, 200, liveSwitchResponse(state));
        return;
      }
      if (request.method === "POST") {
        const payload = await readJson(request);
        const current = await readLiveSwitch();
        const state = {
          enabled: typeof payload?.enabled === "boolean" ? payload.enabled : current.enabled,
          dryRun: typeof payload?.dryRun === "boolean" ? payload.dryRun : current.dryRun,
          updatedAt: new Date().toISOString(),
        };
        await writeFile(liveSwitchPath, `${JSON.stringify(state, null, 2)}\n`);
        await applyLiveSwitchToEnv(state);
        await sendJson(response, 200, liveSwitchResponse(state));
        return;
      }
      response.setHeader("Allow", "GET, POST");
      await sendJson(response, 405, { status: "error", error: "Method not allowed" });
      return;
    }

    if (request.method === "GET" && request.url === "/health") {
      await sendJson(response, 200, {
        status: "live",
        message: "Local worker ready",
        storageDir,
        dataRoot,
        eventsDir,
        decisionFramesDir,
        rawSnapshotsDir,
        backtestsDir,
        algosDir,
        factorySweep: {
          enabled: autoSweepEnabled,
          running: factorySweepRunning,
          intervalMs: sweepIntervalMs,
          deepEvery: deepSweepEvery,
          last: lastFactorySweep,
        },
        telemetry: {
          backtest: persistBacktestTelemetry,
          paperEvents: persistPaperEventLog,
          shadow: persistShadowTelemetry,
        },
        liveSwitch: liveSwitchResponse(await readLiveSwitch()),
        checkedAt: new Date().toISOString(),
      });
      return;
    }

    if (request.method === "GET" && request.url === "/factory/sweep/latest") {
      const latestSweep = await readLatestSweep();
      if (!latestSweep) {
        await sendJson(response, 404, {
          status: "missing",
          message: "No sweep results found. Run npm run factory:sweep first.",
          backtestsDir,
        });
        return;
      }
      await sendJson(response, 200, latestSweep);
      return;
    }

    if (request.method === "GET" && request.url === "/app-state/latest") {
      await sendJson(response, 200, await readLatestAppState());
      return;
    }

    if (request.method === "POST" && request.url === "/app-state") {
      const payload = await readJson(request);
      await sendJson(response, 200, await persistAppState(payload, new Date().toISOString()));
      return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/paper-trades") {
      const result = await readPaperTrades(requestUrl.searchParams);
      await sendJson(response, 200, result);
      return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/paper-trades/summary") {
      const result = await readPaperTradeSummary(requestUrl.searchParams);
      await sendJson(response, 200, result);
      return;
    }

    if (request.method === "POST" && request.url === "/ingest") {
      const payload = await readJson(request);
      const writtenAt = new Date().toISOString();
      const result = await persistPayload(payload, writtenAt);
      await sendJson(response, 200, {
        status: "live",
        message: `Stored ${result.appended} new records`,
        storageDir,
        dataRoot,
        decisionFramesDir,
        rawSnapshotsDir,
        writtenAt,
        ...result,
      });
      return;
    }

    await sendJson(response, 404, { error: "Not found" });
  } catch (error) {
    await sendJson(response, 500, {
      error: error instanceof Error ? error.message : "Unknown local worker error",
    });
  }
});

server.on("error", (error) => {
  if (error && typeof error === "object" && "code" in error && error.code === "EADDRINUSE") {
    console.log(`DogeEdge local worker already appears to be running on ${host}:${port}`);
    process.exit(0);
  }
  throw error;
});

server.listen(port, host, () => {
  console.log(`DogeEdge local worker writing to ${storageDir}`);
  console.log(`DogeEdge algo factory data root ${dataRoot}`);
  console.log(`Listening on http://${host}:${port}`);
  scheduleFactorySweeps();
});

async function persistPayload(payload, writtenAt) {
  const seen = await readSeen();
  const paperState = payload?.paperState ?? {};
  const arenaPaperState = payload?.paperArena?.paperState ?? {};
  const topTradersPaperState = payload?.topTradersArena?.paperState ?? {};
  const paperTrades = [
    ...(Array.isArray(paperState.trades) ? paperState.trades : []),
    ...(Array.isArray(arenaPaperState.trades) ? arenaPaperState.trades : []),
    ...(Array.isArray(topTradersPaperState.trades) ? topTradersPaperState.trades : []),
  ];
  const paperEvents = persistPaperEventLog ? [
    ...(Array.isArray(paperState.events) ? paperState.events : []),
    ...(Array.isArray(arenaPaperState.events) ? arenaPaperState.events : []),
    ...(Array.isArray(topTradersPaperState.events) ? topTradersPaperState.events : []),
  ] : [];
  const learningState = persistShadowTelemetry ? payload?.learningState ?? {} : {};
  const shadowTrades = persistShadowTelemetry && Array.isArray(learningState.shadow?.trades) ? learningState.shadow.trades : [];
  const shadowEvents = persistShadowTelemetry && Array.isArray(learningState.shadow?.events) ? learningState.shadow.events : [];
  const decisionFrame = persistBacktestTelemetry ? buildDecisionFrame(payload, writtenAt) : null;
  const rawSnapshot = persistBacktestTelemetry ? buildRawSnapshot(payload, writtenAt, decisionFrame) : null;

  await writeJson("latest.json", buildLiveStatus(payload, writtenAt));
  if (payload?.topTradersExecutable && typeof payload.topTradersExecutable === "object") {
    await writeFile(topTradersExecutablePath, `${JSON.stringify({
      storedAt: writtenAt,
      topTradersExecutable: payload.topTradersExecutable,
    }, null, 2)}\n`);
  }
  await writeJson("rules-active.json", {
    storedAt: writtenAt,
    activeRules: payload?.activeRules ?? null,
    generatedPaperAlgos: slimGeneratedAlgos(payload?.generatedPaperAlgos, 250),
    generatedPaperAlgoArchives: slimGeneratedArchives(payload?.generatedPaperAlgoArchives, 50),
    factoryAutomation: payload?.factoryAutomation ?? null,
    paperArena: slimArena(payload?.paperArena),
    topTradersArena: slimArena(payload?.topTradersArena),
    activeRuleDescriptions: payload?.activeRuleDescriptions ?? [],
  });
  await writeJson("algorithm-candidates.json", buildAlgorithmCandidates(payload, writtenAt));
  await writeMarkdownSummary(payload, writtenAt);

  let appended = await appendUnique("paper-trades.jsonl", paperTrades, seen.paperTrades);
  if (persistPaperEventLog) {
    appended += await appendUnique("paper-events.jsonl", paperEvents, seen.paperEvents);
  }
  if (persistShadowTelemetry) {
    appended += await appendUnique("shadow-trades.jsonl", shadowTrades, seen.shadowTrades);
    appended += await appendUnique("shadow-events.jsonl", shadowEvents, seen.shadowEvents);
  }

  let factoryAppended = 0;
  if (persistBacktestTelemetry) {
    factoryAppended =
      await appendDecisionFrame(decisionFrame, seen)
      + await appendRawSnapshot(rawSnapshot, seen, writtenAt);

    if (shouldWriteSnapshot(seen.lastSnapshotAt, writtenAt)) {
      await mkdir(path.join(storageDir, "snapshots"), { recursive: true });
      const snapshotName = `${writtenAt.replaceAll(":", "-")}.json`;
      await writeFile(path.join(storageDir, "snapshots", snapshotName), `${JSON.stringify({ ...payload, storedAt: writtenAt }, null, 2)}\n`);
      seen.lastSnapshotAt = writtenAt;
    }
  }

  await writeFile(seenPath, `${JSON.stringify(seen, null, 2)}\n`);
  return { appended, factoryAppended };
}

async function readLatestSweep() {
  try {
    return JSON.parse(await readFile(path.join(backtestsDir, "latest-sweep.json"), "utf8"));
  } catch {
    return null;
  }
}

async function readLatestAppState() {
  const stored = await readOptionalJson(appStatePath);
  const storedBatches = Array.isArray(stored?.factoryAlgoBatches) ? stored.factoryAlgoBatches : [];
  const storedArchives = Array.isArray(stored?.realisticArenaAlgoArchives) ? stored.realisticArenaAlgoArchives.filter(isFactoryBatchArchive) : [];
  const storedFactoryAutomation = stored?.factoryAutomation && typeof stored.factoryAutomation === "object" ? stored.factoryAutomation : null;
  const storedTopTradersExecutable = stored?.topTradersExecutable && typeof stored.topTradersExecutable === "object" ? stored.topTradersExecutable : null;
  const batchFile = storedBatches.length > 0 ? null : await readOptionalJson(factoryBatchesPath);
  const archiveFile = storedArchives.length > 0 ? null : await readOptionalJson(realisticArenaArchivesPath);
  const executableFile = await readOptionalJson(topTradersExecutablePath);
  const latestFile = await readOptionalJson(path.join(storageDir, "latest.json"));
  const archiveFileArchives = Array.isArray(archiveFile?.realisticArenaAlgoArchives) ? archiveFile.realisticArenaAlgoArchives.filter(isFactoryBatchArchive) : [];
  const recoveredArchives = storedArchives.length > 0 || archiveFileArchives.length > 0 ? [] : await recoverArenaArchivesFromSnapshots();
  const factoryAlgoBatches = storedBatches.length > 0
    ? storedBatches
    : Array.isArray(batchFile?.factoryAlgoBatches) ? batchFile.factoryAlgoBatches : [];
  const realisticArenaAlgoArchives = mergeArchives([
    ...storedArchives,
    ...archiveFileArchives,
    ...recoveredArchives,
  ]);
  const topTradersExecutable = chooseTopTradersExecutableBackup([
    { storedAt: stored?.storedAt, executable: storedTopTradersExecutable },
    { storedAt: executableFile?.storedAt, executable: executableFile?.topTradersExecutable },
    { storedAt: latestFile?.storedAt, executable: latestFile?.topTradersExecutable },
  ]);
  const factoryAutomation = storedFactoryAutomation
    ?? (latestFile?.factoryAutomation && typeof latestFile.factoryAutomation === "object" ? latestFile.factoryAutomation : null);
  return {
    storedAt: typeof stored?.storedAt === "string"
      ? stored.storedAt
      : typeof archiveFile?.storedAt === "string" ? archiveFile.storedAt : typeof batchFile?.storedAt === "string" ? batchFile.storedAt : null,
    factoryAlgoBatches,
    realisticArenaAlgoArchives,
    factoryAutomation,
    topTradersExecutable,
  };
}

async function readPaperTrades(searchParams) {
  const sourceAlgoId = stringOrNull(searchParams.get("sourceAlgoId"));
  const strategyId = stringOrNull(searchParams.get("strategyId")) ?? (sourceAlgoId ? `generated:${sourceAlgoId}` : null);
  if (!strategyId) {
    return {
      count: 0,
      truncated: false,
      trades: [],
      error: "strategyId or sourceAlgoId is required",
    };
  }

  const sinceMs = parseOptionalTime(searchParams.get("since"));
  const untilMs = parseOptionalTime(searchParams.get("until"));
  const limit = Math.min(1_000, Math.max(1, Math.floor(Number(searchParams.get("limit") ?? 500))));
  const rows = mergeRowsById([
    ...await readJsonLines(paperTradesPath),
    ...await readPaperTradesFromSnapshots(strategyId, sinceMs, untilMs),
  ]);
  const trades = rows
    .filter((trade) => trade?.strategyId === strategyId)
    .filter((trade) => tradeInWindow(trade, sinceMs, untilMs))
    .sort((left, right) => Date.parse(right.openedAt ?? "") - Date.parse(left.openedAt ?? ""));

  return {
    count: trades.length,
    truncated: trades.length > limit,
    trades: trades.slice(0, limit),
  };
}

async function readPaperTradeSummary(searchParams) {
  const batchId = stringOrNull(searchParams.get("batchId"));
  const summaries = await cachedPaperTradeSummaries();
  const filtered = batchId
    ? summaries.filter((summary) => summary.sourceRunId === batchId)
    : summaries;
  return {
    status: "ok",
    batchId,
    count: filtered.length,
    generatedAt: paperTradeSummaryCache?.generatedAt ?? new Date().toISOString(),
    summaries: filtered,
  };
}

async function cachedPaperTradeSummaries() {
  let fileStat;
  try {
    fileStat = await stat(paperTradesPath);
  } catch {
    paperTradeSummaryCache = {
      generatedAt: new Date().toISOString(),
      mtimeMs: 0,
      size: 0,
      summaries: [],
    };
    return [];
  }

  if (
    paperTradeSummaryCache
    && paperTradeSummaryCache.mtimeMs === fileStat.mtimeMs
    && paperTradeSummaryCache.size === fileStat.size
  ) {
    return paperTradeSummaryCache.summaries;
  }

  const rows = mergeRowsById(await readJsonLines(paperTradesPath));
  const groups = new Map();
  for (const trade of rows) {
    const strategyId = stringOrNull(trade?.strategyId);
    if (!strategyId) continue;
    const sourceAlgoId = sourceAlgoIdFromStrategyId(strategyId);
    const sourceRunId = sourceRunIdFromSourceAlgoId(sourceAlgoId);
    if (!sourceAlgoId || !sourceRunId) continue;
    const current = groups.get(strategyId) ?? emptyPaperTradeStrategySummary(strategyId, sourceAlgoId, sourceRunId, trade);
    updatePaperTradeStrategySummary(current, trade);
    groups.set(strategyId, current);
  }

  const summaries = [...groups.values()]
    .map(finalizePaperTradeStrategySummary)
    .sort((left, right) => right.liveStats.sells - left.liveStats.sells
      || right.liveStats.totalPnl - left.liveStats.totalPnl
      || left.strategyId.localeCompare(right.strategyId));
  paperTradeSummaryCache = {
    generatedAt: new Date().toISOString(),
    mtimeMs: fileStat.mtimeMs,
    size: fileStat.size,
    summaries,
  };
  return summaries;
}

function emptyPaperTradeStrategySummary(strategyId, sourceAlgoId, sourceRunId, trade) {
  return {
    strategyId,
    sourceAlgoId,
    sourceRunId,
    strategyName: stringOrNull(trade?.strategyName),
    marketTickers: new Set(),
    firstOpenedAt: null,
    lastTransactionAt: null,
    buys: 0,
    sells: 0,
    open: 0,
    wins: 0,
    losses: 0,
    totalPnl: 0,
    totalCost: 0,
  };
}

function updatePaperTradeStrategySummary(summary, trade) {
  summary.strategyName = summary.strategyName ?? stringOrNull(trade?.strategyName);
  const marketTicker = stringOrNull(trade?.marketTicker);
  if (marketTicker) summary.marketTickers.add(marketTicker);
  const openedAt = stringOrNull(trade?.openedAt);
  const closedAt = stringOrNull(trade?.closedAt);
  summary.firstOpenedAt = earlierIso(summary.firstOpenedAt, openedAt);
  summary.lastTransactionAt = laterIso(summary.lastTransactionAt, closedAt ?? openedAt);
  summary.buys += 1;
  if (trade?.status === "closed" && typeof trade.pnl === "number") {
    summary.sells += 1;
    if (trade.pnl > 0) summary.wins += 1;
    if (trade.pnl < 0) summary.losses += 1;
    summary.totalPnl += trade.pnl;
    summary.totalCost += paperTradeCost(trade);
  } else if (trade?.status === "open") {
    summary.open += 1;
  }
}

function finalizePaperTradeStrategySummary(summary) {
  const totalPnl = roundMoney(summary.totalPnl);
  const totalCost = roundMoney(summary.totalCost);
  return {
    strategyId: summary.strategyId,
    sourceAlgoId: summary.sourceAlgoId,
    sourceRunId: summary.sourceRunId,
    strategyName: summary.strategyName,
    firstOpenedAt: summary.firstOpenedAt,
    lastTransactionAt: summary.lastTransactionAt,
    marketCount: summary.marketTickers.size,
    liveStats: {
      buys: summary.buys,
      sells: summary.sells,
      open: summary.open,
      wins: summary.wins,
      losses: summary.losses,
      totalPnl,
      totalCost,
      roi: totalCost > 0 ? roundRatio(totalPnl / totalCost) : null,
    },
  };
}

function sourceAlgoIdFromStrategyId(strategyId) {
  const normalized = stringOrNull(strategyId);
  if (!normalized) return null;
  return normalized.startsWith("generated:") ? normalized.slice("generated:".length) : normalized;
}

function sourceRunIdFromSourceAlgoId(sourceAlgoId) {
  return /^(factory-batch-batch-[a-z]+-[a-z0-9]+)-\d{4}$/i.exec(sourceAlgoId ?? "")?.[1] ?? null;
}

function earlierIso(current, next) {
  if (!next) return current;
  if (!current) return next;
  return Date.parse(next) < Date.parse(current) ? next : current;
}

function laterIso(current, next) {
  if (!next) return current;
  if (!current) return next;
  return Date.parse(next) > Date.parse(current) ? next : current;
}

async function readPaperTradesFromSnapshots(strategyId, sinceMs, untilMs) {
  const snapshotPaths = await paperTradeSnapshotPaths(sinceMs, untilMs);
  const rows = [];
  for (const snapshotPath of snapshotPaths) {
    const snapshot = await readOptionalJson(snapshotPath);
    const paperStateTrades = Array.isArray(snapshot?.paperState?.trades) ? snapshot.paperState.trades : [];
    const arenaTrades = Array.isArray(snapshot?.paperArena?.paperState?.trades) ? snapshot.paperArena.paperState.trades : [];
    const topTradersTrades = Array.isArray(snapshot?.topTradersArena?.paperState?.trades) ? snapshot.topTradersArena.paperState.trades : [];
    rows.push(...paperStateTrades, ...arenaTrades, ...topTradersTrades);
  }
  return mergeRowsById(rows.filter((trade) => trade?.strategyId === strategyId));
}

async function paperTradeSnapshotPaths(sinceMs, untilMs) {
  const snapshotDir = path.join(storageDir, "snapshots");
  const paths = [path.join(storageDir, "latest.json")];
  try {
    const names = await readdir(snapshotDir);
    const relevant = names
      .filter((name) => name.endsWith(".json"))
      .map((name) => ({ name, time: Date.parse(name.replace(".json", "").replace(/T(\d{2})-(\d{2})-(\d{2}\.\d{3}Z)$/, "T$1:$2:$3")) }))
      .filter(({ time }) => snapshotTimeOverlapsQuery(time, sinceMs, untilMs))
      .sort((left, right) => right.time - left.time)
      .slice(0, 96)
      .map(({ name }) => path.join(snapshotDir, name));
    paths.push(...relevant);
  } catch {
    // Snapshot trade lookup is best effort.
  }
  return paths;
}

function snapshotTimeOverlapsQuery(snapshotMs, sinceMs, untilMs) {
  if (!Number.isFinite(snapshotMs)) return true;
  const paddingMs = 20 * 60_000;
  if (Number.isFinite(sinceMs) && snapshotMs < sinceMs - paddingMs) return false;
  if (Number.isFinite(untilMs) && snapshotMs > untilMs + paddingMs) return false;
  return true;
}

function mergeRowsById(rows) {
  const byId = new Map();
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const id = typeof row.id === "string" ? row.id : JSON.stringify(row);
    const existing = byId.get(id);
    if (!existing || rowRevisionRank(row) >= rowRevisionRank(existing)) byId.set(id, row);
  }
  return [...byId.values()];
}

function rowRevisionRank(row) {
  const statusRank = row?.status === "closed" ? 2 : row?.status === "open" ? 1 : 0;
  const time = Date.parse(row?.closedAt ?? row?.time ?? row?.openedAt ?? "");
  return statusRank * 10_000_000_000_000 + (Number.isFinite(time) ? time : 0);
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
      .filter((row) => row !== null);
  } catch {
    return [];
  }
}

function tradeInWindow(trade, sinceMs, untilMs) {
  const openedMs = Date.parse(trade?.openedAt ?? "");
  const closedMs = Date.parse(trade?.closedAt ?? "");
  const relevantTimes = [openedMs, closedMs].filter(Number.isFinite);
  if (relevantTimes.length === 0) return false;
  if (Number.isFinite(sinceMs) && relevantTimes.every((time) => time < sinceMs)) return false;
  if (Number.isFinite(untilMs) && relevantTimes.every((time) => time > untilMs)) return false;
  return true;
}

function parseOptionalTime(value) {
  if (typeof value !== "string" || value.length === 0) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

async function persistAppState(payload, storedAt) {
  const state = {
    storedAt,
    factoryAlgoBatches: Array.isArray(payload?.factoryAlgoBatches) ? payload.factoryAlgoBatches : [],
    realisticArenaAlgoArchives: Array.isArray(payload?.realisticArenaAlgoArchives) ? payload.realisticArenaAlgoArchives.filter(isFactoryBatchArchive) : [],
    factoryAutomation: payload?.factoryAutomation && typeof payload.factoryAutomation === "object" ? payload.factoryAutomation : null,
    topTradersExecutable: payload?.topTradersExecutable && typeof payload.topTradersExecutable === "object" ? payload.topTradersExecutable : null,
  };
  await writeFile(appStatePath, `${JSON.stringify(state, null, 2)}\n`);
  await writeFile(factoryBatchesPath, `${JSON.stringify({
    storedAt,
    factoryAlgoBatches: state.factoryAlgoBatches,
  }, null, 2)}\n`);
  await writeFile(realisticArenaArchivesPath, `${JSON.stringify({
    storedAt,
    realisticArenaAlgoArchives: state.realisticArenaAlgoArchives,
  }, null, 2)}\n`);
  if (state.topTradersExecutable) {
    await writeFile(topTradersExecutablePath, `${JSON.stringify({
      storedAt,
      topTradersExecutable: state.topTradersExecutable,
    }, null, 2)}\n`);
  }
  return state;
}

function chooseTopTradersExecutableBackup(candidates) {
  return candidates
    .map((candidate) => ({
      executable: candidate?.executable && typeof candidate.executable === "object" ? candidate.executable : null,
      storedAtMs: Date.parse(candidate?.storedAt ?? ""),
      evidenceCount: topTradersExecutableEvidenceCount(candidate?.executable),
    }))
    .filter((candidate) => candidate.executable)
    .sort((left, right) => {
      const leftTime = Number.isFinite(left.storedAtMs) ? left.storedAtMs : 0;
      const rightTime = Number.isFinite(right.storedAtMs) ? right.storedAtMs : 0;
      return right.evidenceCount - left.evidenceCount
        || rightTime - leftTime;
    })[0]?.executable ?? null;
}

function topTradersExecutableEvidenceCount(executable) {
  if (!executable || typeof executable !== "object" || !executable.stats || typeof executable.stats !== "object") return 0;
  const positions = Array.isArray(executable.positions) ? executable.positions.length : 0;
  return Object.values(executable.stats).reduce((total, stats) => (
    total
    + Number(stats?.signals ?? 0)
    + Number(stats?.attempts ?? 0)
    + Number(stats?.acceptedBuys ?? 0)
    + Number(stats?.sells ?? 0)
  ), positions);
}

async function readOptionalJson(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

async function readLiveSwitch() {
  const saved = await readOptionalJson(liveSwitchPath);
  return {
    enabled: saved?.enabled === true,
    dryRun: saved?.dryRun !== false,
    updatedAt: typeof saved?.updatedAt === "string" ? saved.updatedAt : null,
  };
}

async function applyLiveSwitchToEnv(state) {
  const enabled = state?.enabled === true;
  const dryRun = state?.dryRun !== false;
  process.env.DOGEEDGE_LIVE_SWITCH_ENABLED = enabled ? "1" : "0";
  process.env.DOGEEDGE_LIVE_TRADING_ENABLED = "1";
  process.env.DOGEEDGE_LIVE_DRY_RUN = dryRun ? "1" : "0";
}

function liveSwitchResponse(state) {
  return {
    status: "ok",
    enabled: state?.enabled === true,
    dryRun: state?.dryRun !== false,
    updatedAt: typeof state?.updatedAt === "string" ? state.updatedAt : null,
    routerStatus: routerStatus(process.env),
  };
}

async function recoverArenaArchivesFromSnapshots() {
  const snapshotPaths = [path.join(storageDir, "latest.json")];
  try {
    const names = await readdir(path.join(storageDir, "snapshots"));
    snapshotPaths.push(...names
      .filter((name) => name.endsWith(".json"))
      .sort()
      .slice(-24)
      .map((name) => path.join(storageDir, "snapshots", name)));
  } catch {
    // Snapshot recovery is best effort.
  }

  const recovered = [];
  for (const snapshotPath of snapshotPaths) {
    const payload = await readOptionalJson(snapshotPath);
    if (!payload?.paperArena || typeof payload.paperArena !== "object") continue;
    recovered.push(...recoverArenaArchivesFromPayload(payload));
  }
  return mergeArchives(recovered);
}

function recoverArenaArchivesFromPayload(payload) {
  const arena = payload.paperArena;
  const activeBatchIds = uniqueStrings(Array.isArray(arena.activeBatchIds)
    ? arena.activeBatchIds
    : typeof arena.activeBatchId === "string" ? [arena.activeBatchId] : []);
  if (!activeBatchIds.some((id) => /^factory-batch-batch-[a-z]+-[a-z0-9]+$/i.test(id))) return [];
  const paperState = arena.paperState && typeof arena.paperState === "object" ? arena.paperState : {};
  const trades = Array.isArray(paperState.trades) ? paperState.trades : [];
  const events = Array.isArray(paperState.events) ? paperState.events : [];
  const generatedAlgos = generatedAlgosFromPayload(payload);
  const algoByStrategy = new Map(generatedAlgos.map((algo) => [stringOrNull(algo?.id), algo]).filter(([id]) => id));
  const algoBySource = new Map(generatedAlgos.map((algo) => [stringOrNull(algo?.sourceAlgoId), algo]).filter(([id]) => id));
  const selectedIds = uniqueStrings(Array.isArray(arena.selectedAlgoIds)
    ? arena.selectedAlgoIds
    : typeof arena.selectedAlgoId === "string" ? [arena.selectedAlgoId] : []);
  const strategyIds = selectedIds.length > 0
    ? selectedIds
    : uniqueStrings([...trades.map((trade) => trade?.strategyId), ...events.map((event) => event?.strategyId)]);
  const activatedAt = typeof arena.startedAt === "string" ? arena.startedAt : null;
  if (!activatedAt) return [];
  const deactivatedAt = typeof arena.stoppedAt === "string"
    ? arena.stoppedAt
    : typeof payload.exportedAt === "string" ? payload.exportedAt : new Date().toISOString();

  return strategyIds
    .map((strategyId) => {
      if (typeof strategyId !== "string" || !strategyId.startsWith("generated:")) return null;
      const stats = paperSummarySnapshot({ trades, events }, strategyId);
      if (stats.buys <= 0 && stats.sells <= 0 && stats.open <= 0) return null;
      const sourceAlgoId = strategyId.slice("generated:".length);
      const algo = algoByStrategy.get(strategyId) ?? algoBySource.get(sourceAlgoId) ?? null;
      const activity = trades.find((trade) => trade?.strategyId === strategyId)
        ?? events.find((event) => event?.strategyId === strategyId)
        ?? {};
      const name = typeof activity.strategyName === "string" && activity.strategyName.length > 0
        ? activity.strategyName
        : stringOrNull(algo?.name) ?? fallbackFactoryAlgoName(sourceAlgoId);
      const family = stringOrNull(algo?.family) ?? inferFactoryFamily(name);
      return {
        activationId: `${strategyId}:${activatedAt}`,
        displayId: stringOrNull(algo?.displayId) ?? displayIdFromFactorySource(sourceAlgoId) ?? fallbackDisplayId(strategyId, family),
        sourceAlgoId,
        researchCandidateId: stringOrNull(algo?.researchCandidateId),
        candidateConfigHash: stringOrNull(algo?.candidateConfigHash),
        sourceResearchAlgoId: stringOrNull(algo?.sourceResearchAlgoId),
        sourceSnapshotHash: stringOrNull(algo?.sourceSnapshotHash),
        promotionVerdictAtInstall: stringOrNull(algo?.promotionVerdictAtInstall),
        name,
        family,
        params: algo?.params && typeof algo.params === "object" ? algo.params : inferFactoryParams(name),
        sourceRunId: stringOrNull(algo?.sourceRunId) ?? sourceRunIdFromFactorySource(sourceAlgoId),
        activatedAt,
        deactivatedAt,
        sourceMetrics: {
          closed: 0,
          wins: 0,
          losses: 0,
          totalPnl: 0,
          totalCost: 0,
          roi: 0,
          maxDrawdown: 0,
        },
        liveStats: stats,
      };
    })
    .filter(Boolean);
}

function generatedAlgosFromPayload(payload) {
  const direct = Array.isArray(payload?.generatedPaperAlgos) ? payload.generatedPaperAlgos : [];
  const batches = Array.isArray(payload?.factoryAlgoBatches) ? payload.factoryAlgoBatches : [];
  const batchAlgos = batches.flatMap((batch) => Array.isArray(batch?.algos) ? batch.algos : []);
  return [...direct, ...batchAlgos].filter((algo) => algo && typeof algo === "object");
}

function paperSummarySnapshot(paperState, strategyId) {
  const trades = Array.isArray(paperState.trades) ? paperState.trades.filter((trade) => trade?.strategyId === strategyId) : [];
  const events = Array.isArray(paperState.events) ? paperState.events.filter((event) => event?.strategyId === strategyId) : [];
  const closed = trades.filter((trade) => trade?.status === "closed" && typeof trade.pnl === "number");
  const totalPnl = roundMoney(closed.reduce((total, trade) => total + trade.pnl, 0));
  const totalCost = roundMoney(closed.reduce((total, trade) => total + paperTradeCost(trade), 0));
  return {
    buys: events.filter((event) => event?.action === "BUY").length,
    sells: events.filter((event) => event?.action === "SELL").length,
    open: trades.filter((trade) => trade?.status === "open").length,
    wins: closed.filter((trade) => trade.pnl > 0).length,
    losses: closed.filter((trade) => trade.pnl < 0).length,
    totalPnl,
    totalCost,
    roi: totalCost > 0 ? roundRatio(totalPnl / totalCost) : null,
  };
}

function paperTradeCost(trade) {
  return numberOrDefault(trade?.entryPrice, 0) * numberOrDefault(trade?.contracts, 0) + numberOrDefault(trade?.feesPaid, 0);
}

function mergeArchives(archives) {
  const bestById = new Map();
  for (const archive of archives) {
    if (!archive || typeof archive.activationId !== "string") continue;
    const current = bestById.get(archive.activationId);
    if (!current || archiveScore(archive) >= archiveScore(current)) bestById.set(archive.activationId, archive);
  }
  return [...bestById.values()]
    .sort((left, right) => Date.parse(right.deactivatedAt ?? "") - Date.parse(left.deactivatedAt ?? ""))
    .slice(0, 10_000);
}

function isFactoryBatchArchive(archive) {
  return /^[A-Z]-\d{4}$/i.test(String(archive?.displayId ?? ""))
    || /^factory-batch-batch-[a-z]+-[a-z0-9]+-\d{4}$/i.test(String(archive?.sourceAlgoId ?? ""))
    || /^factory-batch-batch-[a-z]+-[a-z0-9]+$/i.test(String(archive?.sourceRunId ?? ""));
}

function archiveScore(archive) {
  const stats = archive.liveStats ?? {};
  return numberOrDefault(stats.buys, 0)
    + numberOrDefault(stats.sells, 0) * 2
    + numberOrDefault(stats.open, 0)
    + Math.max(0, Date.parse(archive.deactivatedAt ?? "") || 0) / 1_000_000_000_000;
}

function displayIdFromFactorySource(sourceAlgoId) {
  const match = /^factory-batch-batch-([a-z]+)-[a-z0-9]+-(\d{4})$/i.exec(sourceAlgoId);
  return match ? `${match[1].toUpperCase()}-${match[2]}` : null;
}

function sourceRunIdFromFactorySource(sourceAlgoId) {
  const match = /^(factory-batch-batch-[a-z]+-[a-z0-9]+)-\d{4}$/i.exec(sourceAlgoId);
  return match ? match[1] : null;
}

function fallbackFactoryAlgoName(sourceAlgoId) {
  return `${displayIdFromFactorySource(sourceAlgoId) ?? sourceAlgoId} Factory Algo`;
}

function fallbackDisplayId(strategyId, family) {
  return `${familyCode(family)}-${shortStableCode(strategyId)}`;
}

function familyCode(family) {
  const normalized = String(family ?? "").replace(/^sweep-/, "").toLowerCase();
  if (normalized.includes("order-flow") || normalized.includes("pressure")) return "OF";
  if (normalized.includes("managed-scalp")) return "MS";
  if (normalized.includes("longshot")) return "CL";
  if (normalized.includes("liquidity")) return "LI";
  if (normalized.includes("favorite")) return "LF";
  if (normalized.includes("momentum")) return "MO";
  if (normalized.includes("revert")) return "TR";
  if (normalized.includes("scalp")) return "SC";
  return "FA";
}

function inferFactoryFamily(name) {
  const value = String(name ?? "").toLowerCase();
  if (value.includes("order flow") || value.includes("pressure")) return "sweep-order-flow-pressure";
  if (value.includes("liquidity")) return "sweep-liquidity-imbalance";
  if (value.includes("late favorite") || value.includes("favorite")) return "sweep-late-favorite";
  if (value.includes("cheap longshot") || value.includes("longshot")) return "sweep-cheap-longshot";
  if (value.includes("managed scalp")) return "sweep-managed-scalp";
  if (value.includes("target revert") || value.includes("revert")) return "sweep-target-revert";
  if (value.includes("momentum trail") || value.includes("trail")) return "sweep-momentum-trail";
  if (value.includes("momentum")) return "sweep-momentum";
  if (value.includes("fade")) return "sweep-fade-model";
  if (value.includes("scalp")) return "sweep-scalp";
  if (value.includes("distance")) return "sweep-distance";
  return "sweep-model";
}

function inferFactoryParams(name) {
  const params = {};
  assignCentsParam(params, "maxSpread", name, /S<=\s*([\d.]+)c/i);
  assignCentsParam(params, "takeProfit", name, /TP\s*([\d.]+)c/i);
  assignCentsParam(params, "stopLoss", name, /SL\s*([\d.]+)c/i);
  assignPercentParam(params, "minEdge", name, /E>=\s*([\d.]+)%/i);
  assignPercentParam(params, "minPressure", name, /P>=\s*([\d.]+)%/i);
  assignNumberParam(params, "maxHoldSeconds", name, /H(\d+)s/i);
  return params;
}

function assignCentsParam(params, key, text, pattern) {
  const value = numberMatch(text, pattern);
  if (value !== null) params[key] = roundRatio(value / 100);
}

function assignPercentParam(params, key, text, pattern) {
  const value = numberMatch(text, pattern);
  if (value !== null) params[key] = roundRatio(value / 100);
}

function assignNumberParam(params, key, text, pattern) {
  const value = numberMatch(text, pattern);
  if (value !== null) params[key] = value;
}

function numberMatch(text, pattern) {
  const match = pattern.exec(String(text ?? ""));
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

function uniqueStrings(values) {
  return [...new Set(values.filter((value) => typeof value === "string" && value.length > 0))];
}

function shortStableCode(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36).toUpperCase().padStart(4, "0").slice(0, 4);
}

async function defaultStorageDir() {
  if (process.platform === "win32") {
    try {
      await access("D:\\");
      return "D:\\DogeEdge\\data\\local-worker";
    } catch {
      // Fall back to the repo-local folder below.
    }
  }
  return path.join(repoRoot, "data", "local-worker");
}

function scheduleFactorySweeps() {
  if (!autoSweepEnabled) {
    console.log("DogeEdge auto factory sweeps disabled. Set DOGEEDGE_AUTO_SWEEP=1 to enable manual legacy sweep automation.");
    return;
  }
  console.log(`DogeEdge auto factory sweeps enabled every ${Math.round(sweepIntervalMs / 60_000)}m; deep sweep every ${deepSweepEvery} interval(s).`);
  setTimeout(async () => {
    const latestSweep = await readLatestSweep();
    if (latestSweepIsFresh(latestSweep)) {
      console.log("DogeEdge startup factory sweep skipped because latest sweep is fresh.");
      return;
    }
    void runFactorySweep("startup");
  }, 30_000);
  setInterval(() => {
    intervalSweepCount += 1;
    const deep = intervalSweepCount % deepSweepEvery === 0;
    void runFactorySweep(deep ? "deep-interval" : "interval", { deep });
  }, sweepIntervalMs);
}

function latestSweepIsFresh(latestSweep) {
  const finishedAt = typeof latestSweep?.finishedAt === "string" ? Date.parse(latestSweep.finishedAt) : Number.NaN;
  if (!Number.isFinite(finishedAt)) return false;
  return Date.now() - finishedAt < sweepIntervalMs;
}

async function runFactorySweep(reason, { deep = false } = {}) {
  if (factorySweepRunning) return;
  factorySweepRunning = true;
  const startedAt = new Date().toISOString();
  lastFactorySweep = {
    status: "running",
    reason,
    deep,
    startedAt,
    finishedAt: null,
    exitCode: null,
  };
  await writeJson("factory-automation.json", {
    storedAt: startedAt,
    autoSweepEnabled,
    sweepIntervalMs,
    lastFactorySweep,
  });

  const childArgs = [path.join(repoRoot, "scripts", "dogeedge-backtest.mjs"), "--sweep", "--data-root", dataRoot];
  if (deep) childArgs.push("--deep");
  const child = spawn(process.execPath, childArgs, {
    cwd: repoRoot,
    env: {
      ...process.env,
      DOGEEDGE_DATA_ROOT: dataRoot,
      DOGEEDGE_DATA_DIR: storageDir,
    },
    windowsHide: true,
  });

  child.stdout.on("data", (chunk) => process.stdout.write(`[factory:sweep] ${chunk}`));
  child.stderr.on("data", (chunk) => process.stderr.write(`[factory:sweep] ${chunk}`));
  child.on("close", async (code) => {
    const finishedAt = new Date().toISOString();
    factorySweepRunning = false;
    lastFactorySweep = {
      status: code === 0 ? "complete" : "failed",
      reason,
      deep,
      startedAt,
      finishedAt,
      exitCode: code,
    };
    await writeJson("factory-automation.json", {
      storedAt: finishedAt,
      autoSweepEnabled,
      sweepIntervalMs,
      lastFactorySweep,
    });
  });
  child.on("error", async (error) => {
    const finishedAt = new Date().toISOString();
    factorySweepRunning = false;
    lastFactorySweep = {
      status: "failed",
      reason,
      deep,
      startedAt,
      finishedAt,
      exitCode: null,
      error: error instanceof Error ? error.message : "Unknown sweep error",
    };
    await writeJson("factory-automation.json", {
      storedAt: finishedAt,
      autoSweepEnabled,
      sweepIntervalMs,
      lastFactorySweep,
    });
  });
}

function buildDecisionFrame(payload, writtenAt) {
  const input = payload?.paperInput;
  if (!input || typeof input !== "object") return null;
  const snapshot = payload?.runtimeSnapshot ?? {};
  const observedAt = typeof input.observedAt === "string" ? input.observedAt : writtenAt;
  const marketTicker = typeof input.ticker === "string" ? input.ticker : payload?.marketTicker ?? null;
  const yesAsk = numberOrNull(input.yesAsk);
  const noAsk = numberOrNull(input.noAsk);
  const yesBid = numberOrNull(input.yesBid);
  const noBid = numberOrNull(input.noBid);
  const spotPrice = numberOrNull(input.spotPrice);
  const oneMinuteChange = numberOrDefault(input.oneMinuteChange, 0);
  const targetPrice = numberOrNull(input.targetPrice);
  const estimate = numberOrNull(input.estimate);
  const frameId = [
    marketTicker ?? "NO_MARKET",
    Date.parse(observedAt) || Date.parse(writtenAt),
    numberOrDefault(input.secondsToClose, -1),
  ].join(":");

  return {
    id: frameId,
    capturedAt: writtenAt,
    observedAt,
    sourceUrl: typeof payload?.sourceUrl === "string" ? payload.sourceUrl : null,
    dataMode: typeof snapshot.dataMode === "string" ? snapshot.dataMode : null,
    activeRulesVersion: typeof payload?.activeRules?.version === "string" ? payload.activeRules.version : null,
    marketLive: Boolean(input.marketLive),
    marketTicker,
    marketTitle: typeof input.title === "string" ? input.title : null,
    marketLabel: typeof snapshot.marketLabel === "string" ? snapshot.marketLabel : null,
    marketCloseTime: typeof snapshot.kalshi?.market?.closeTime === "string" ? snapshot.kalshi.market.closeTime : null,
    kalshiStatus: typeof snapshot.kalshi?.status === "string" ? snapshot.kalshi.status : null,
    feedStatus: typeof snapshot.feed?.status === "string" ? snapshot.feed.status : null,
    targetPrice,
    estimate,
    spotPrice,
    oneMinuteChange,
    oneMinuteMovePercent: spotPrice && spotPrice > 0 ? roundRatio(oneMinuteChange / spotPrice) : 0,
    distanceFromTarget: estimate !== null && targetPrice !== null ? roundMarket(estimate - targetPrice) : null,
    secondsToClose: numberOrDefault(input.secondsToClose, null),
    fairProbability: numberOrNull(input.fairProbability),
    modelAction: typeof input.action === "string" ? input.action : "skip",
    modelConfidence: numberOrDefault(input.confidence, 0),
    modelEdgeAfterFees: numberOrDefault(input.edgeAfterFees, 0),
    modelSizeContracts: numberOrDefault(input.sizeContracts, 0),
    yesAsk,
    noAsk,
    yesBid,
    noBid,
    yesSpread: nullableSpread(yesAsk, yesBid),
    noSpread: nullableSpread(noAsk, noBid),
    yesTopDepth: topDepth(snapshot.orderBook?.yesBids, snapshot.orderBook?.yesAsks),
    noTopDepth: topDepth(snapshot.orderBook?.noBids, snapshot.orderBook?.noAsks),
  };
}

function buildRawSnapshot(payload, writtenAt, decisionFrame) {
  if (!payload?.runtimeSnapshot && !payload?.paperInput) return null;
  return {
    id: decisionFrame?.id ?? `raw:${Date.parse(writtenAt)}`,
    capturedAt: writtenAt,
    sourceUrl: typeof payload?.sourceUrl === "string" ? payload.sourceUrl : null,
    marketTicker: payload?.marketTicker ?? decisionFrame?.marketTicker ?? null,
    paperInput: payload?.paperInput ?? null,
    runtimeSnapshot: payload?.runtimeSnapshot ?? null,
    generatedPaperAlgos: payload?.generatedPaperAlgos ?? [],
    generatedPaperAlgoArchives: payload?.generatedPaperAlgoArchives ?? [],
    factoryAutomation: payload?.factoryAutomation ?? null,
    paperArena: payload?.paperArena ?? null,
    activeRules: payload?.activeRules ?? null,
    activeRuleDescriptions: Array.isArray(payload?.activeRuleDescriptions) ? payload.activeRuleDescriptions : [],
  };
}

async function appendDecisionFrame(frame, seen) {
  if (!frame) return 0;
  const key = `${frame.id}:${frame.capturedAt}`;
  if (seen.lastDecisionFrameKey === key) return 0;
  await appendDatedJsonl(decisionFramesDir, frame.observedAt, frame);
  seen.lastDecisionFrameKey = key;
  return 1;
}

async function appendRawSnapshot(snapshot, seen, writtenAt) {
  if (!snapshot || !shouldWriteRawSnapshot(seen.lastRawSnapshotAt, writtenAt)) return 0;
  const key = `${snapshot.id}:${snapshot.capturedAt}`;
  if (seen.lastRawSnapshotKey === key) return 0;
  await appendDatedJsonl(rawSnapshotsDir, snapshot.capturedAt, snapshot);
  seen.lastRawSnapshotAt = writtenAt;
  seen.lastRawSnapshotKey = key;
  return 1;
}

async function appendDatedJsonl(baseDir, observedAt, row) {
  const dir = path.join(baseDir, datePart(observedAt));
  await mkdir(dir, { recursive: true });
  await appendFile(path.join(dir, "records.jsonl"), `${JSON.stringify(row)}\n`);
}

function buildLiveStatus(payload, writtenAt) {
  const paperState = payload?.paperState && typeof payload.paperState === "object" ? payload.paperState : {};
  const trades = Array.isArray(paperState.trades) ? paperState.trades : [];
  const events = Array.isArray(paperState.events) ? paperState.events : [];
  return {
    storedAt: writtenAt,
    sourceUrl: typeof payload?.sourceUrl === "string" ? payload.sourceUrl : null,
    marketTicker: payload?.marketTicker ?? null,
    paperInput: payload?.paperInput ?? null,
    runtimeSnapshot: payload?.runtimeSnapshot ?? null,
    paperState: {
      tradeCount: trades.length,
      eventCount: events.length,
      latestTrades: trades.slice(0, 50),
    },
    generatedPaperAlgoCount: Array.isArray(payload?.generatedPaperAlgos) ? payload.generatedPaperAlgos.length : 0,
    generatedPaperAlgoArchiveCount: Array.isArray(payload?.generatedPaperAlgoArchives) ? payload.generatedPaperAlgoArchives.length : 0,
    factoryAutomation: payload?.factoryAutomation ?? null,
    paperArena: slimArena(payload?.paperArena),
    topTradersArena: slimArena(payload?.topTradersArena),
    topTradersExecutable: payload?.topTradersExecutable ?? null,
    topTradersExecutableSummary: slimTopTradersExecutable(payload?.topTradersExecutable),
    activeRules: payload?.activeRules ?? null,
    activeRuleDescriptions: payload?.activeRuleDescriptions ?? [],
  };
}

function slimTopTradersExecutable(executable) {
  if (!executable || typeof executable !== "object") return null;
  const stats = executable.stats && typeof executable.stats === "object" ? Object.values(executable.stats) : [];
  const positions = Array.isArray(executable.positions) ? executable.positions : [];
  return stats.reduce((summary, item) => {
    for (const key of ["signals", "attempts", "acceptedBuys", "rejected", "staleRejects", "depthRejects", "gateRejects", "edgeRejects", "priceRejects", "otherRejects", "buys", "sells", "open", "wins", "losses"]) {
      summary[key] += Number(item?.[key] ?? 0);
    }
    for (const key of ["lastSignalAt", "lastAttemptAt", "lastAcceptedAt", "startedAt"]) {
      if (typeof item?.[key] === "string" && (!summary[key] || Date.parse(item[key]) > Date.parse(summary[key]))) summary[key] = item[key];
    }
    if (typeof item?.lastRejectedAt === "string" && (!summary.lastRejectedAt || Date.parse(item.lastRejectedAt) > Date.parse(summary.lastRejectedAt))) {
      summary.lastRejectedAt = item.lastRejectedAt;
      summary.lastRejectedMessage = typeof item.lastRejectedMessage === "string" ? item.lastRejectedMessage : null;
      summary.lastRejectedCategory = typeof item.lastRejectedCategory === "string" ? item.lastRejectedCategory : null;
    }
    return summary;
  }, {
    startedAt: executable.startedAt ?? null,
    stoppedAt: executable.stoppedAt ?? null,
    strategyStats: stats.length,
    positions: positions.length,
    openPositions: positions.filter((position) => position?.status === "open").length,
    closedPositions: positions.filter((position) => position?.status === "closed").length,
    signals: 0,
    attempts: 0,
    acceptedBuys: 0,
    rejected: 0,
    staleRejects: 0,
    depthRejects: 0,
    gateRejects: 0,
    edgeRejects: 0,
    priceRejects: 0,
    otherRejects: 0,
    buys: 0,
    sells: 0,
    open: 0,
    wins: 0,
    losses: 0,
    lastSignalAt: null,
    lastAttemptAt: null,
    lastAcceptedAt: null,
    lastRejectedAt: null,
    lastRejectedMessage: null,
    lastRejectedCategory: null,
  });
}

function slimArena(arena) {
  if (!arena || typeof arena !== "object") return null;
  const paperState = arena.paperState && typeof arena.paperState === "object" ? arena.paperState : {};
  const trades = Array.isArray(paperState.trades) ? paperState.trades : [];
  const events = Array.isArray(paperState.events) ? paperState.events : [];
  const closed = trades.filter((trade) => trade?.status === "closed" && typeof trade.pnl === "number");
  const open = trades.filter((trade) => trade?.status === "open");
  return {
    status: arena.status ?? "idle",
    selectedAlgoId: arena.selectedAlgoId ?? null,
    selectedAlgoCount: Array.isArray(arena.selectedAlgoIds) ? arena.selectedAlgoIds.length : 0,
    activeBatchId: arena.activeBatchId ?? null,
    activeBatchIds: Array.isArray(arena.activeBatchIds) ? arena.activeBatchIds : [],
    startingBalance: arena.startingBalance ?? 0,
    maxBet: arena.maxBet ?? 0,
    allowRepeatBuys: Boolean(arena.allowRepeatBuys),
    startedAt: arena.startedAt ?? null,
    stoppedAt: arena.stoppedAt ?? null,
    paperState: {
      tradeCount: trades.length,
      eventCount: events.length,
      open: open.length,
      closed: closed.length,
      totalPnl: roundMoney(closed.reduce((total, trade) => total + numberOrDefault(trade.pnl, 0), 0)),
      latestTrades: trades.slice(0, 50),
    },
  };
}

function slimGeneratedAlgos(algos, limit) {
  if (!Array.isArray(algos)) return [];
  return algos.slice(0, limit).map((algo) => ({
    id: algo?.id ?? null,
    displayId: algo?.displayId ?? null,
    sourceAlgoId: algo?.sourceAlgoId ?? null,
    researchCandidateId: algo?.researchCandidateId ?? null,
    candidateConfigHash: algo?.candidateConfigHash ?? null,
    sourceResearchAlgoId: algo?.sourceResearchAlgoId ?? null,
    sourceSnapshotHash: algo?.sourceSnapshotHash ?? null,
    promotionVerdictAtInstall: algo?.promotionVerdictAtInstall ?? null,
    name: algo?.name ?? null,
    family: algo?.family ?? null,
    enabled: Boolean(algo?.enabled),
    promotedAt: algo?.promotedAt ?? null,
    sourceRunId: algo?.sourceRunId ?? null,
    sourceMetrics: algo?.sourceMetrics ?? null,
  }));
}

function slimGeneratedArchives(archives, limit) {
  if (!Array.isArray(archives)) return [];
  return archives.slice(0, limit).map((archive) => ({
    activationId: archive?.activationId ?? null,
    displayId: archive?.displayId ?? null,
    sourceAlgoId: archive?.sourceAlgoId ?? null,
    researchCandidateId: archive?.researchCandidateId ?? null,
    candidateConfigHash: archive?.candidateConfigHash ?? null,
    sourceResearchAlgoId: archive?.sourceResearchAlgoId ?? null,
    sourceSnapshotHash: archive?.sourceSnapshotHash ?? null,
    promotionVerdictAtInstall: archive?.promotionVerdictAtInstall ?? null,
    name: archive?.name ?? null,
    family: archive?.family ?? null,
    sourceRunId: archive?.sourceRunId ?? null,
    activatedAt: archive?.activatedAt ?? null,
    deactivatedAt: archive?.deactivatedAt ?? null,
    arenaEntryPolicy: archive?.arenaEntryPolicy ?? null,
    liveStats: archive?.liveStats ?? null,
  }));
}

function buildAlgorithmCandidates(payload, writtenAt) {
  const report = payload?.learningReport ?? {};
  const candidates = [];

  for (const metric of Array.isArray(report.strategyMetrics) ? report.strategyMetrics : []) {
    if (metric.closed >= 3 && metric.totalPnl > 0 && (metric.winRate ?? 0) >= 0.55) {
      candidates.push({
        kind: "paper-strategy",
        id: metric.strategyId,
        name: metric.strategyName,
        closed: metric.closed,
        wins: metric.wins,
        losses: metric.losses,
        winRate: metric.winRate,
        totalPnl: metric.totalPnl,
        averagePnl: metric.averagePnl,
        averageSpread: metric.averageSpread,
        averageEdge: metric.averageEdge,
        totalCost: metric.totalCost,
        roi: metric.roi,
      });
    }
  }

  for (const algo of Array.isArray(payload?.generatedPaperAlgos) ? payload.generatedPaperAlgos : []) {
    if (!algo?.enabled) continue;
    const metrics = algo.sourceMetrics ?? {};
    candidates.push({
      kind: "generated-paper-algo",
      id: algo.displayId ?? algo.sourceAlgoId,
      sourceAlgoId: algo.sourceAlgoId,
      researchCandidateId: algo.researchCandidateId ?? null,
      candidateConfigHash: algo.candidateConfigHash ?? null,
      sourceResearchAlgoId: algo.sourceResearchAlgoId ?? null,
      sourceSnapshotHash: algo.sourceSnapshotHash ?? null,
      promotionVerdictAtInstall: algo.promotionVerdictAtInstall ?? null,
      name: algo.name,
      family: algo.family,
      sourceRunId: algo.sourceRunId ?? null,
      closed: metrics.closed ?? 0,
      wins: metrics.wins ?? 0,
      losses: metrics.losses ?? 0,
      winRate: metrics.closed > 0 ? (metrics.wins ?? 0) / metrics.closed : null,
      totalPnl: metrics.totalPnl ?? 0,
      totalCost: metrics.totalCost ?? 0,
      roi: metrics.roi ?? 0,
    });
  }

  candidates.sort((left, right) => (right.roi ?? 0) - (left.roi ?? 0) || right.totalPnl - left.totalPnl || (right.winRate ?? 0) - (left.winRate ?? 0));

  return {
    storedAt: writtenAt,
    note: "Paper-only candidates generated from active paper strategy results and promoted generated algos. Real orders remain disabled.",
    generatedPaperAlgos: slimGeneratedAlgos(payload?.generatedPaperAlgos, 250),
    generatedPaperAlgoArchives: slimGeneratedArchives(payload?.generatedPaperAlgoArchives, 50),
    factoryAutomation: payload?.factoryAutomation ?? null,
    activeRules: payload?.activeRules ?? null,
    activeRuleDescriptions: payload?.activeRuleDescriptions ?? [],
    candidates,
  };
}

async function writeMarkdownSummary(payload, writtenAt) {
  const lines = [
    "# DogeEdge Local Worker Summary",
    "",
    `Updated: ${writtenAt}`,
    `Market: ${payload?.marketTicker ?? "-"}`,
    `Auto sweeps: ${autoSweepEnabled ? `ON every ${Math.round(sweepIntervalMs / 60_000)}m` : "OFF"}`,
    "",
    "## Active Rules",
    ...(Array.isArray(payload?.activeRuleDescriptions) ? payload.activeRuleDescriptions.map((item) => `- ${item}`) : []),
    "",
    "## Generated Paper Algos",
    ...generatedPaperAlgoLines(payload?.generatedPaperAlgos),
    "",
    "## Factory Automation",
    ...factoryAutomationLines(payload?.factoryAutomation),
    "",
    "## Testing Arena",
    ...paperArenaLines(payload?.paperArena),
    "",
    "## Past Generated Algo Activations",
    ...generatedPaperAlgoArchiveLines(payload?.generatedPaperAlgoArchives),
    "",
    "Files here are for Codex CLI analysis on the local PC. The app remains paper-only.",
    "",
  ];
  await writeFile(path.join(storageDir, "summary.md"), `${lines.join("\n")}\n`);
}

function generatedPaperAlgoLines(algos) {
  if (!Array.isArray(algos) || algos.length === 0) return ["No generated paper algos promoted."];
  const active = algos.filter((algo) => algo?.enabled);
  if (active.length === 0) return ["No generated paper algos active."];
  return active.map((algo) => {
    const metrics = algo?.sourceMetrics ?? {};
    const id = algo?.displayId ? `${algo.displayId} ` : "";
    return `- ${algo?.enabled ? "ON" : "OFF"} ${id}${algo?.name ?? algo?.sourceAlgoId ?? "generated"} (${workerFamilyLabel(algo?.family)}): ${metrics.closed ?? 0} closed, P/L ${money(metrics.totalPnl ?? 0)}, ROI ${((metrics.roi ?? 0) * 100).toFixed(1)}%`;
  });
}

function workerFamilyLabel(value) {
  if (value === "shadow" || value === "paper-variant") return "legacy generated";
  return value ?? "unknown";
}

function generatedPaperAlgoArchiveLines(archives) {
  if (!Array.isArray(archives) || archives.length === 0) return ["No past generated algo activations."];
  return archives.slice(0, 20).map((archive) => {
    const stats = archive?.liveStats ?? {};
    const id = archive?.displayId ? `${archive.displayId} ` : "";
    return `- ${id}${archive?.name ?? archive?.sourceAlgoId ?? "generated"}: ${archive?.activatedAt ?? "-"} to ${archive?.deactivatedAt ?? "-"}, ${stats.buys ?? 0} buys/${stats.sells ?? 0} sells, P/L ${money(stats.totalPnl ?? 0)}, ROI ${stats.roi === null || stats.roi === undefined ? "-" : `${(stats.roi * 100).toFixed(1)}%`}`;
  });
}

function factoryAutomationLines(automation) {
  if (!automation || typeof automation !== "object") return ["Factory automation is collecting state."];
  const lines = [
    `- Mode: ${automation.enabled === false ? "OFF" : "ON"} paper-only`,
    `- Last run: ${automation.lastRunAt ?? "-"}`,
    `- Auto promoted: ${automation.promotedCount ?? 0}`,
    `- Auto demoted: ${automation.demotedCount ?? 0}`,
  ];
  const decisions = Array.isArray(automation.decisions)
    ? automation.decisions.filter((decision) => decision?.type !== "upgrade").slice(0, 8)
    : [];
  if (decisions.length) {
    lines.push(...decisions.map((decision) => `- ${decision.time ?? "-"} ${decision.type ?? "decision"}: ${decision.title ?? "-"} (${decision.detail ?? "-"})`));
  }
  if (lastFactorySweep) {
    lines.push(`- Last scheduled sweep: ${lastFactorySweep.status} at ${lastFactorySweep.finishedAt ?? lastFactorySweep.startedAt}`);
  }
  return lines;
}

function paperArenaLines(arena) {
  if (!arena || typeof arena !== "object") return ["No arena run configured."];
  const paperState = arena.paperState && typeof arena.paperState === "object" ? arena.paperState : {};
  const trades = Array.isArray(paperState.trades) ? paperState.trades : [];
  const closed = trades.filter((trade) => trade?.status === "closed" && typeof trade.pnl === "number");
  const open = trades.filter((trade) => trade?.status === "open");
  const realizedPnl = closed.reduce((total, trade) => total + (trade.pnl ?? 0), 0);
  const openCost = open.reduce((total, trade) => total + Number(trade.entryPrice ?? 0) * Number(trade.contracts ?? 0), 0);
  const startingBalance = Number(arena.startingBalance ?? 0);
  const available = Math.max(0, startingBalance + realizedPnl - openCost);
  const wins = closed.filter((trade) => (trade.pnl ?? 0) > 0).length;
  const losses = closed.filter((trade) => (trade.pnl ?? 0) < 0).length;
  return [
    `- Status: ${arena.status ?? "idle"}`,
    `- Selected algo: ${arena.selectedAlgoId ?? "-"}`,
    `- Bankroll: ${money(startingBalance)}`,
    `- Max per bet: ${money(Number(arena.maxBet ?? 0))}`,
    `- Available: ${money(available)}`,
    `- Open exposure: ${money(openCost)}`,
    `- Closed: ${closed.length}, W/L ${wins}/${losses}, realized P/L ${money(realizedPnl)}`,
  ];
}

function money(value) {
  const number = Number(value);
  return `${number >= 0 ? "+" : "-"}$${Math.abs(number).toFixed(2)}`;
}

async function appendUnique(fileName, rows, seenBucket, mirrorPaths = []) {
  let appended = 0;
  for (const row of rows) {
    const key = recordKey(row);
    if (!key || seenBucket.includes(key)) continue;
    const line = `${JSON.stringify(row)}\n`;
    await appendFile(path.join(storageDir, fileName), line);
    for (const mirrorPath of mirrorPaths) {
      await appendFile(mirrorPath, line);
    }
    seenBucket.push(key);
    appended += 1;
  }
  return appended;
}

function recordKey(row) {
  if (!row || typeof row !== "object" || typeof row.id !== "string") return null;
  return `${row.id}:${row.status ?? row.action ?? "record"}:${row.closedAt ?? row.time ?? ""}`;
}

async function readSeen() {
  try {
    const parsed = JSON.parse(await readFile(seenPath, "utf8"));
    return {
      paperTrades: Array.isArray(parsed.paperTrades) ? parsed.paperTrades : [],
      paperEvents: Array.isArray(parsed.paperEvents) ? parsed.paperEvents : [],
      shadowTrades: Array.isArray(parsed.shadowTrades) ? parsed.shadowTrades : [],
      shadowEvents: Array.isArray(parsed.shadowEvents) ? parsed.shadowEvents : [],
      lastSnapshotAt: typeof parsed.lastSnapshotAt === "string" ? parsed.lastSnapshotAt : null,
      lastDecisionFrameKey: typeof parsed.lastDecisionFrameKey === "string" ? parsed.lastDecisionFrameKey : null,
      lastRawSnapshotAt: typeof parsed.lastRawSnapshotAt === "string" ? parsed.lastRawSnapshotAt : null,
      lastRawSnapshotKey: typeof parsed.lastRawSnapshotKey === "string" ? parsed.lastRawSnapshotKey : null,
    };
  } catch {
    return {
      paperTrades: [],
      paperEvents: [],
      shadowTrades: [],
      shadowEvents: [],
      lastSnapshotAt: null,
      lastDecisionFrameKey: null,
      lastRawSnapshotAt: null,
      lastRawSnapshotKey: null,
    };
  }
}

function shouldWriteSnapshot(previous, current) {
  if (!previous) return true;
  return Date.parse(current) - Date.parse(previous) >= 15 * 60 * 1000;
}

function shouldWriteRawSnapshot(previous, current) {
  if (!previous) return true;
  return Date.parse(current) - Date.parse(previous) >= rawSnapshotEveryMs;
}

function stringOrNull(value) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function datePart(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "unknown-date";
  return date.toISOString().slice(0, 10);
}

function numberOrDefault(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function numberOrNull(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function nullableSpread(ask, bid) {
  if (ask === null || bid === null) return null;
  return roundRatio(Math.max(0, ask - bid));
}

function topDepth(bids, asks) {
  const bidSize = Array.isArray(bids) && typeof bids[0]?.size === "number" ? bids[0].size : null;
  const askSize = Array.isArray(asks) && typeof asks[0]?.size === "number" ? asks[0].size : null;
  return {
    bidSize,
    askSize,
  };
}

function roundMarket(value) {
  return Number(value.toFixed(7));
}

function roundMoney(value) {
  return Number(value.toFixed(2));
}

function roundRatio(value) {
  return Number(value.toFixed(4));
}

async function writeJson(fileName, value) {
  await writeFile(path.join(storageDir, fileName), `${JSON.stringify(value, null, 2)}\n`);
}

async function readJson(request) {
  return JSON.parse(await readRequestText(request));
}

async function readRequestText(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 80 * 1024 * 1024) throw new Error("Payload too large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function runApiHandler(handler, request, response, requestUrl) {
  let statusCode = 200;
  let sent = null;
  const query = Object.fromEntries(requestUrl.searchParams.entries());
  const body = request.method === "GET" || request.method === "HEAD"
    ? undefined
    : await readRequestText(request);
  const apiResponse = {
    setHeader(name, value) {
      response.setHeader(name, value);
    },
    status(code) {
      statusCode = code;
      return apiResponse;
    },
    json(value) {
      sent = sendJson(response, statusCode, value);
      return apiResponse;
    },
  };

  await handler({
    method: request.method,
    query,
    body,
    headers: request.headers,
  }, apiResponse);

  if (sent) {
    await sent;
    return;
  }
  await sendJson(response, statusCode, { status: "ok" });
}

async function sendJson(response, statusCode, value) {
  response.writeHead(statusCode, { "content-type": "application/json" });
  response.end(`${JSON.stringify(value, null, 2)}\n`);
}

function setCors(response) {
  response.setHeader("access-control-allow-origin", "*");
  response.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
  response.setHeader("access-control-allow-headers", "content-type");
  response.setHeader("access-control-allow-private-network", "true");
}
