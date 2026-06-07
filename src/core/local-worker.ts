import type { LearningReport, LearningState } from "./learning";
import type { GeneratedPaperAlgo, PaperEngineInput, PaperState, PaperTrade } from "./paper";
import type { RuntimeSnapshot } from "../data/runtime";

export type LocalWorkerState = "checking" | "live" | "offline";

export interface LocalWorkerStatus {
  state: LocalWorkerState;
  message: string;
  storageDir: string | null;
  lastSyncAt: string | null;
}

export interface LocalWorkerExportPayload {
  exportedAt: string;
  sourceUrl: string;
  marketTicker: string | null;
  paperInput: PaperEngineInput;
  runtimeSnapshot: RuntimeSnapshot;
  paperState: PaperState;
  learningState: LearningState;
  learningReport: LearningReport;
  generatedPaperAlgos: GeneratedPaperAlgo[];
  generatedPaperAlgoArchives: unknown[];
  factoryAutomation: unknown;
  paperArena: unknown;
  topTradersArena?: unknown;
  topTradersExecutable?: unknown;
  activeRules: unknown;
  activeRuleDescriptions: string[];
}

export interface LocalWorkerAppStatePayload {
  factoryAlgoBatches: unknown[];
  realisticArenaAlgoArchives: unknown[];
  factoryAutomation?: unknown;
  topTradersExecutable?: unknown;
}

export interface LocalWorkerAppState extends LocalWorkerAppStatePayload {
  storedAt: string | null;
  factoryAutomation: unknown;
  topTradersExecutable: unknown;
}

export interface LocalPaperTradesResponse {
  count: number;
  truncated: boolean;
  trades: PaperTrade[];
}

export interface LocalPaperTradeStrategySummary {
  strategyId: string;
  sourceAlgoId: string;
  sourceRunId: string;
  strategyName: string | null;
  firstOpenedAt: string | null;
  lastTransactionAt: string | null;
  marketCount: number;
  liveStats: {
    buys: number;
    sells: number;
    open: number;
    wins: number;
    losses: number;
    totalPnl: number;
    totalCost: number;
    roi: number | null;
  };
}

export interface LocalPaperTradeSummaryResponse {
  status: string;
  batchId: string | null;
  count: number;
  generatedAt: string | null;
  summaries: LocalPaperTradeStrategySummary[];
}

export interface LocalFactorySweepCandidate {
  algoId: string;
  algoName: string;
  family: string;
  params: Record<string, unknown>;
  closed: number;
  open: number;
  wins: number;
  losses: number;
  winRate: number | null;
  averagePnl: number | null;
  totalPnl: number;
  totalCost: number;
  roi: number;
  maxDrawdown: number;
  averageEntryEdge: number | null;
  averageEntrySpread: number | null;
  averageSecondsToClose: number | null;
  walkForwardPass: boolean;
  walkForwardClosed: number;
  walkForwardWins: number;
  walkForwardLosses: number;
  walkForwardWinRate: number | null;
  walkForwardTotalPnl: number;
  walkForwardRoi: number;
  walkForwardMaxDrawdown: number;
  candidateScore: number;
}

export interface LocalFactorySweep {
  runId: string;
  mode: "sweep" | "deep-sweep";
  runDir: string;
  finishedAt: string;
  dataRoot: string;
  frameCount: number;
  walkForwardFrameCount: number;
  walkForwardRatio: number;
  algoCount: number;
  deepSweepMode: boolean;
  minCandidateClosed: number;
  minWalkForwardClosed: number;
  candidates: LocalFactorySweepCandidate[];
  topMetrics: LocalFactorySweepCandidate[];
}

const localWorkerBaseUrl = "http://127.0.0.1:8787";

export const initialLocalWorkerStatus: LocalWorkerStatus = {
  state: "checking",
  message: "Checking local worker",
  storageDir: null,
  lastSyncAt: null,
};

export function canUseLocalWorker() {
  if (typeof window === "undefined") return false;
  const host = window.location.hostname;
  const protocol = window.location.protocol;
  return host === "127.0.0.1"
    || host === "localhost"
    || host.endsWith(".localhost")
    || protocol.startsWith("tauri")
    || "__TAURI_INTERNALS__" in window;
}

export function localApiUrl(path: string) {
  return canUseLocalWorker() ? `${localWorkerBaseUrl}${path}` : path;
}

export function localWorkerRequiresPreviewStatus(): LocalWorkerStatus {
  return {
    state: "offline",
    message: "Run the PC preview to write local files",
    storageDir: null,
    lastSyncAt: null,
  };
}

export async function pushLocalWorkerExport(payload: LocalWorkerExportPayload): Promise<LocalWorkerStatus> {
  const response = await fetch(`${localWorkerBaseUrl}/ingest`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(`Local worker returned ${response.status}`);
  const result = await response.json() as { storageDir?: string; writtenAt?: string; message?: string };
  return {
    state: "live",
    message: result.message ?? "Local worker synced",
    storageDir: result.storageDir ?? null,
    lastSyncAt: result.writtenAt ?? payload.exportedAt,
  };
}

export async function pingLocalWorker(): Promise<LocalWorkerStatus> {
  const response = await fetch(`${localWorkerBaseUrl}/health`, { cache: "no-store" });
  if (!response.ok) throw new Error(`Local worker returned ${response.status}`);
  const result = await response.json() as { storageDir?: string; message?: string; checkedAt?: string };
  return {
    state: "live",
    message: result.message ?? "Local worker ready",
    storageDir: result.storageDir ?? null,
    lastSyncAt: result.checkedAt ?? null,
  };
}

export async function fetchLatestAppState(): Promise<LocalWorkerAppState | null> {
  const response = await fetch(`${localWorkerBaseUrl}/app-state/latest`, { cache: "no-store" });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Local worker returned ${response.status}`);
  const result = await response.json() as Partial<LocalWorkerAppState>;
  return {
    storedAt: typeof result.storedAt === "string" ? result.storedAt : null,
    factoryAlgoBatches: Array.isArray(result.factoryAlgoBatches) ? result.factoryAlgoBatches : [],
    realisticArenaAlgoArchives: Array.isArray(result.realisticArenaAlgoArchives) ? result.realisticArenaAlgoArchives : [],
    factoryAutomation: result.factoryAutomation ?? null,
    topTradersExecutable: result.topTradersExecutable ?? null,
  };
}

export async function pushLatestAppState(payload: LocalWorkerAppStatePayload): Promise<LocalWorkerAppState> {
  const response = await fetch(`${localWorkerBaseUrl}/app-state`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(`Local worker returned ${response.status}`);
  const result = await response.json() as Partial<LocalWorkerAppState>;
  return {
    storedAt: typeof result.storedAt === "string" ? result.storedAt : null,
    factoryAlgoBatches: Array.isArray(result.factoryAlgoBatches) ? result.factoryAlgoBatches : [],
    realisticArenaAlgoArchives: Array.isArray(result.realisticArenaAlgoArchives) ? result.realisticArenaAlgoArchives : [],
    factoryAutomation: result.factoryAutomation ?? null,
    topTradersExecutable: result.topTradersExecutable ?? null,
  };
}

export async function fetchLatestFactorySweep(): Promise<LocalFactorySweep | null> {
  const response = await fetch(`${localWorkerBaseUrl}/factory/sweep/latest`, { cache: "no-store" });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Local worker returned ${response.status}`);
  return normalizeFactorySweep(await response.json());
}

export async function fetchPaperTrades(params: {
  strategyId?: string;
  sourceAlgoId?: string;
  since?: string;
  until?: string;
  limit?: number;
}): Promise<LocalPaperTradesResponse> {
  const search = new URLSearchParams();
  if (params.strategyId) search.set("strategyId", params.strategyId);
  if (params.sourceAlgoId) search.set("sourceAlgoId", params.sourceAlgoId);
  if (params.since) search.set("since", params.since);
  if (params.until) search.set("until", params.until);
  if (params.limit) search.set("limit", String(params.limit));
  const response = await fetch(`${localWorkerBaseUrl}/paper-trades?${search.toString()}`, { cache: "no-store" });
  if (response.status === 404) throw new Error("Local worker needs restart to enable saved trade history.");
  if (!response.ok) throw new Error(`Local worker returned ${response.status}`);
  const result = await response.json() as Partial<LocalPaperTradesResponse>;
  return {
    count: typeof result.count === "number" ? result.count : Array.isArray(result.trades) ? result.trades.length : 0,
    truncated: Boolean(result.truncated),
    trades: Array.isArray(result.trades) ? result.trades as PaperTrade[] : [],
  };
}

export async function fetchPaperTradeSummary(params: { batchId?: string } = {}): Promise<LocalPaperTradeSummaryResponse> {
  const search = new URLSearchParams();
  if (params.batchId) search.set("batchId", params.batchId);
  const query = search.toString();
  const response = await fetch(`${localWorkerBaseUrl}/paper-trades/summary${query ? `?${query}` : ""}`, { cache: "no-store" });
  if (response.status === 404) throw new Error("Local worker needs restart to enable saved trade summaries.");
  if (!response.ok) throw new Error(`Local worker returned ${response.status}`);
  const result = await response.json() as Partial<LocalPaperTradeSummaryResponse>;
  return {
    status: typeof result.status === "string" ? result.status : "ok",
    batchId: typeof result.batchId === "string" ? result.batchId : null,
    count: typeof result.count === "number" ? result.count : Array.isArray(result.summaries) ? result.summaries.length : 0,
    generatedAt: typeof result.generatedAt === "string" ? result.generatedAt : null,
    summaries: Array.isArray(result.summaries) ? result.summaries.map(normalizePaperTradeStrategySummary).filter((item): item is LocalPaperTradeStrategySummary => item !== null) : [],
  };
}

export function offlineLocalWorkerStatus(error: unknown): LocalWorkerStatus {
  return {
    state: "offline",
    message: error instanceof Error ? error.message : "Local worker offline",
    storageDir: null,
    lastSyncAt: null,
  };
}

function normalizeFactorySweep(value: unknown): LocalFactorySweep | null {
  if (!isRecord(value)) return null;
  return {
    runId: stringOrDefault(value.runId, "unknown"),
    mode: normalizeSweepMode(value.mode),
    runDir: stringOrDefault(value.runDir, ""),
    finishedAt: stringOrDefault(value.finishedAt, ""),
    dataRoot: stringOrDefault(value.dataRoot, ""),
    frameCount: numberOrDefault(value.frameCount, 0),
    walkForwardFrameCount: numberOrDefault(value.walkForwardFrameCount, 0),
    walkForwardRatio: numberOrDefault(value.walkForwardRatio, 0.3),
    algoCount: numberOrDefault(value.algoCount, 0),
    deepSweepMode: Boolean(value.deepSweepMode),
    minCandidateClosed: numberOrDefault(value.minCandidateClosed, 3),
    minWalkForwardClosed: numberOrDefault(value.minWalkForwardClosed, 2),
    candidates: normalizeSweepCandidates(value.candidates),
    topMetrics: normalizeSweepCandidates(value.topMetrics),
  };
}

function normalizeSweepCandidates(value: unknown): LocalFactorySweepCandidate[] {
  if (!Array.isArray(value)) return [];
  const bestById = new Map<string, LocalFactorySweepCandidate>();
  for (const candidate of value.map(normalizeSweepCandidate).filter((item): item is LocalFactorySweepCandidate => item !== null)) {
    const current = bestById.get(candidate.algoId);
    if (!current || betterSweepCandidate(candidate, current) === candidate) {
      bestById.set(candidate.algoId, candidate);
    }
  }
  return [...bestById.values()];
}

function betterSweepCandidate(candidate: LocalFactorySweepCandidate, current: LocalFactorySweepCandidate) {
  if (candidate.candidateScore !== current.candidateScore) return candidate.candidateScore > current.candidateScore ? candidate : current;
  if (candidate.totalPnl !== current.totalPnl) return candidate.totalPnl > current.totalPnl ? candidate : current;
  if (candidate.roi !== current.roi) return candidate.roi > current.roi ? candidate : current;
  return candidate.closed > current.closed ? candidate : current;
}

function normalizeSweepCandidate(value: unknown): LocalFactorySweepCandidate | null {
  if (!isRecord(value)) return null;
  return {
    algoId: stringOrDefault(value.algoId, "unknown"),
    algoName: stringOrDefault(value.algoName, "Unknown algo"),
    family: stringOrDefault(value.family, "unknown"),
    params: isRecord(value.params) ? { ...value.params } : {},
    closed: numberOrDefault(value.closed, 0),
    open: numberOrDefault(value.open, 0),
    wins: numberOrDefault(value.wins, 0),
    losses: numberOrDefault(value.losses, 0),
    winRate: numberOrNull(value.winRate),
    averagePnl: numberOrNull(value.averagePnl),
    totalPnl: numberOrDefault(value.totalPnl, 0),
    totalCost: numberOrDefault(value.totalCost, 0),
    roi: numberOrDefault(value.roi, 0),
    maxDrawdown: numberOrDefault(value.maxDrawdown, 0),
    averageEntryEdge: numberOrNull(value.averageEntryEdge),
    averageEntrySpread: numberOrNull(value.averageEntrySpread),
    averageSecondsToClose: numberOrNull(value.averageSecondsToClose),
    walkForwardPass: Boolean(value.walkForwardPass),
    walkForwardClosed: numberOrDefault(value.walkForwardClosed, 0),
    walkForwardWins: numberOrDefault(value.walkForwardWins, 0),
    walkForwardLosses: numberOrDefault(value.walkForwardLosses, 0),
    walkForwardWinRate: numberOrNull(value.walkForwardWinRate),
    walkForwardTotalPnl: numberOrDefault(value.walkForwardTotalPnl, 0),
    walkForwardRoi: numberOrDefault(value.walkForwardRoi, 0),
    walkForwardMaxDrawdown: numberOrDefault(value.walkForwardMaxDrawdown, 0),
    candidateScore: numberOrDefault(value.candidateScore, 0),
  };
}

function normalizePaperTradeStrategySummary(value: unknown): LocalPaperTradeStrategySummary | null {
  if (!isRecord(value) || !isRecord(value.liveStats)) return null;
  const strategyId = stringOrDefault(value.strategyId, "");
  const sourceAlgoId = stringOrDefault(value.sourceAlgoId, "");
  const sourceRunId = stringOrDefault(value.sourceRunId, "");
  if (!strategyId || !sourceAlgoId || !sourceRunId) return null;
  const totalCost = numberOrDefault(value.liveStats.totalCost, 0);
  const totalPnl = numberOrDefault(value.liveStats.totalPnl, 0);
  return {
    strategyId,
    sourceAlgoId,
    sourceRunId,
    strategyName: typeof value.strategyName === "string" ? value.strategyName : null,
    firstOpenedAt: typeof value.firstOpenedAt === "string" ? value.firstOpenedAt : null,
    lastTransactionAt: typeof value.lastTransactionAt === "string" ? value.lastTransactionAt : null,
    marketCount: numberOrDefault(value.marketCount, 0),
    liveStats: {
      buys: numberOrDefault(value.liveStats.buys, 0),
      sells: numberOrDefault(value.liveStats.sells, 0),
      open: numberOrDefault(value.liveStats.open, 0),
      wins: numberOrDefault(value.liveStats.wins, 0),
      losses: numberOrDefault(value.liveStats.losses, 0),
      totalPnl,
      totalCost,
      roi: numberOrNull(value.liveStats.roi) ?? (totalCost > 0 ? totalPnl / totalCost : null),
    },
  };
}

function stringOrDefault(value: unknown, fallback: string) {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function normalizeSweepMode(value: unknown): LocalFactorySweep["mode"] {
  return value === "deep-sweep" ? "deep-sweep" : "sweep";
}

function numberOrDefault(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function numberOrNull(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
