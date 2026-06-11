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
  researchCandidateId?: string | null;
  candidateConfigHash?: string | null;
  sourceResearchAlgoId?: string | null;
  sourceSnapshotHash?: string | null;
  promotionVerdictAtInstall?: string | null;
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
  displayId: string | null;
  researchCandidateId?: string;
  candidateConfigHash?: string;
  sourceResearchAlgoId?: string;
  sourceRunId?: string;
  sourceSnapshotHash?: string;
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
  robustScore: number;
  promotionVerdict: string;
  promotionStage: string;
  labelSource: string;
  settlementSource: string;
  officialResolutionAvailable: boolean;
  officialSettlementCoverage: number;
  nonPromotable: boolean;
  reasonCodes: string[];
  warnings: string[];
  independentClosedMarkets: number;
  daysRepresented: number;
  conservativeTotalPnl: number;
  stressTotalPnl: number;
  foldConsistency: number;
  psr: number;
  dsrApprox: number;
  pboApprox: number;
  realityCheckApproxPValue?: number;
  spaApproxPValue?: number;
  familyAdjustedPValue: number;
  globalAdjustedPValue: number;
  falseDiscoveryRisk: number;
  adjustedConfidence: number;
  costModels: Record<string, unknown>;
  foldSummary: Record<string, unknown>;
  cpcvSummary: Record<string, unknown>;
  walkForwardSummary: Record<string, unknown>;
  holdoutSummary: Record<string, unknown>;
  holdoutPass: boolean;
  holdoutStrictlyLater: boolean;
  holdoutClosed: number;
  holdoutTotalPnl: number;
  holdoutRoi: number;
  holdoutConservativeTotalPnl: number;
  holdoutLowerCi: number | null;
  drift: {
    driftOk: boolean;
    driftReasons: string[];
    driftScore: number;
  };
  executionTelemetry?: Record<string, {
    fillRate?: number;
    averageSlippageCents?: number;
    averagePartialFillRatio?: number;
    averageFillProbability?: number;
    averageFillDepthUtilization?: number;
    staleQuoteRejections?: number;
    queueMisses?: number;
    depthRejections?: number;
  }>;
  paperEvidence: {
    available: boolean;
    status: string;
    closedMarkets: number;
    closedTrades: number;
    totalPnl: number | null;
    roi: number | null;
    driftOk: boolean;
    driftReasons: string[];
    driftScore: number;
  };
}

export interface LocalFactorySweep {
  runId: string;
  mode: "default" | "sweep" | "deep-sweep" | "validate" | "replay-run" | "promote-check";
  runDir: string;
  finishedAt: string;
  dataRoot: string;
  dataQuality?: Record<string, unknown>;
  rowExport?: Record<string, unknown> | null;
  reviewBundleQuality?: string | null;
  bundleCompleteness?: Record<string, unknown> | null;
  rawMarketTickExport?: Record<string, unknown> | null;
  rawTickCoverageSummary?: Record<string, unknown> | null;
  registry?: {
    inputManifestHash?: string;
    dataHash?: string;
    configHash?: string;
  };
  frameCount: number;
  walkForwardFrameCount: number;
  walkForwardRatio: number;
  algoCount: number;
  deepSweepMode: boolean;
  requestedDeepSweepMode: boolean;
  searchBudget: {
    limited: boolean;
    deepSweepAllowed: boolean;
    requestedSweepAlgos: number;
    maxGeneratedAlgos: number;
    officialSettlementCoverage: number;
    reasonCodes: string[];
  } | null;
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
    dataQuality: isRecord(value.dataQuality) ? { ...value.dataQuality } : undefined,
    rowExport: isRecord(value.rowExport) ? { ...value.rowExport } : null,
    reviewBundleQuality: typeof value.reviewBundleQuality === "string" ? value.reviewBundleQuality : null,
    bundleCompleteness: isRecord(value.bundleCompleteness) ? { ...value.bundleCompleteness } : null,
    rawMarketTickExport: isRecord(value.rawMarketTickExport) ? { ...value.rawMarketTickExport } : null,
    rawTickCoverageSummary: isRecord(value.rawTickCoverageSummary) ? { ...value.rawTickCoverageSummary } : null,
    registry: isRecord(value.registry)
      ? {
        inputManifestHash: typeof value.registry.inputManifestHash === "string" ? value.registry.inputManifestHash : undefined,
        dataHash: typeof value.registry.dataHash === "string" ? value.registry.dataHash : undefined,
        configHash: typeof value.registry.configHash === "string" ? value.registry.configHash : undefined,
      }
      : undefined,
    frameCount: numberOrDefault(value.frameCount, 0),
    walkForwardFrameCount: numberOrDefault(value.walkForwardFrameCount, 0),
    walkForwardRatio: numberOrDefault(value.walkForwardRatio, 0.3),
    algoCount: numberOrDefault(value.algoCount, 0),
    deepSweepMode: Boolean(value.deepSweepMode),
    requestedDeepSweepMode: Boolean(value.requestedDeepSweepMode),
    searchBudget: normalizeSearchBudget(value.searchBudget),
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
  if (candidate.robustScore !== current.robustScore) return candidate.robustScore > current.robustScore ? candidate : current;
  if (candidate.candidateScore !== current.candidateScore) return candidate.candidateScore > current.candidateScore ? candidate : current;
  if (candidate.totalPnl !== current.totalPnl) return candidate.totalPnl > current.totalPnl ? candidate : current;
  if (candidate.roi !== current.roi) return candidate.roi > current.roi ? candidate : current;
  return candidate.closed > current.closed ? candidate : current;
}

function normalizeSweepCandidate(value: unknown): LocalFactorySweepCandidate | null {
  if (!isRecord(value)) return null;
  return {
    algoId: stringOrDefault(value.algoId, "unknown"),
    displayId: typeof value.displayId === "string" && value.displayId.length > 0 ? value.displayId : displayIdFromAlgoId(stringOrDefault(value.algoId, "")),
    researchCandidateId: stringOrNullable(value.researchCandidateId) ?? undefined,
    candidateConfigHash: stringOrNullable(value.candidateConfigHash) ?? undefined,
    sourceResearchAlgoId: stringOrNullable(value.sourceResearchAlgoId) ?? undefined,
    sourceRunId: stringOrNullable(value.sourceRunId) ?? undefined,
    sourceSnapshotHash: stringOrNullable(value.sourceSnapshotHash) ?? undefined,
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
    robustScore: numberOrDefault(value.robustScore, numberOrDefault(value.candidateScore, 0)),
    promotionVerdict: stringOrDefault(value.promotionVerdict, "unknown"),
    promotionStage: stringOrDefault(value.promotionStage, "research_candidate"),
    labelSource: stringOrDefault(value.labelSource, isRecord(value.settlementEvidence) ? stringOrDefault(value.settlementEvidence.labelSource, "unknown") : "unknown"),
    settlementSource: stringOrDefault(value.settlementSource, isRecord(value.settlementEvidence) ? stringOrDefault(value.settlementEvidence.settlementSource, "unknown") : "unknown"),
    officialResolutionAvailable: Boolean(value.officialResolutionAvailable || (isRecord(value.settlementEvidence) && value.settlementEvidence.officialResolutionAvailable === true)),
    officialSettlementCoverage: numberOrDefault(value.officialSettlementCoverage, isRecord(value.settlementEvidence) ? numberOrDefault(value.settlementEvidence.officialSettlementCoverage, 0) : 0),
    nonPromotable: Boolean(value.nonPromotable),
    reasonCodes: Array.isArray(value.reasonCodes) ? value.reasonCodes.filter((item): item is string => typeof item === "string") : [],
    warnings: Array.isArray(value.warnings) ? value.warnings.filter((item): item is string => typeof item === "string") : [],
    independentClosedMarkets: numberOrDefault(value.independentClosedMarkets, numberOrDefault(value.closed, 0)),
    daysRepresented: numberOrDefault(value.daysRepresented, 0),
    conservativeTotalPnl: numberOrDefault(value.conservativeTotalPnl, isRecord(value.costModels) && isRecord(value.costModels.conservative) ? numberOrDefault(value.costModels.conservative.totalPnl, 0) : 0),
    stressTotalPnl: numberOrDefault(value.stressTotalPnl, isRecord(value.costModels) && isRecord(value.costModels.stress) ? numberOrDefault(value.costModels.stress.totalPnl, 0) : 0),
    foldConsistency: isRecord(value.foldSummary) ? numberOrDefault(value.foldSummary.foldConsistency, numberOrDefault(value.foldSummary.positiveFoldRate, 0)) : 0,
    psr: numberOrDefault(value.psr, 0),
    dsrApprox: numberOrDefault(value.dsrApprox, numberOrDefault(value.dsr, 0)),
    pboApprox: numberOrDefault(value.pboApprox, numberOrDefault(value.pbo, 1)),
    realityCheckApproxPValue: numberOrNull(value.realityCheckApproxPValue) ?? undefined,
    spaApproxPValue: numberOrNull(value.spaApproxPValue) ?? undefined,
    familyAdjustedPValue: numberOrDefault(value.familyAdjustedPValue, 1),
    globalAdjustedPValue: numberOrDefault(value.globalAdjustedPValue, 1),
    falseDiscoveryRisk: numberOrDefault(value.falseDiscoveryRisk, 1),
    adjustedConfidence: numberOrDefault(value.adjustedConfidence, 0),
    costModels: isRecord(value.costModels) ? { ...value.costModels } : {},
    foldSummary: isRecord(value.foldSummary) ? { ...value.foldSummary } : {},
    cpcvSummary: isRecord(value.cpcvSummary) ? { ...value.cpcvSummary } : {},
    walkForwardSummary: isRecord(value.walkForwardSummary) ? { ...value.walkForwardSummary } : {},
    holdoutSummary: isRecord(value.holdoutSummary) ? { ...value.holdoutSummary } : {},
    holdoutPass: Boolean(value.holdoutPass),
    holdoutStrictlyLater: typeof value.holdoutStrictlyLater === "boolean" ? value.holdoutStrictlyLater : true,
    holdoutClosed: numberOrDefault(value.holdoutClosed, 0),
    holdoutTotalPnl: numberOrDefault(value.holdoutTotalPnl, 0),
    holdoutRoi: numberOrDefault(value.holdoutRoi, 0),
    holdoutConservativeTotalPnl: numberOrDefault(value.holdoutConservativeTotalPnl, 0),
    holdoutLowerCi: numberOrNull(value.holdoutLowerCi),
    drift: normalizeFactoryDrift(value.drift),
    executionTelemetry: isRecord(value.executionTelemetry) ? { ...value.executionTelemetry } as LocalFactorySweepCandidate["executionTelemetry"] : undefined,
    paperEvidence: normalizeFactoryPaperEvidence(value.paperEvidence),
  };
}

function normalizeSearchBudget(value: unknown): LocalFactorySweep["searchBudget"] {
  if (!isRecord(value)) return null;
  return {
    limited: Boolean(value.limited),
    deepSweepAllowed: value.deepSweepAllowed !== false,
    requestedSweepAlgos: numberOrDefault(value.requestedSweepAlgos, 0),
    maxGeneratedAlgos: numberOrDefault(value.maxGeneratedAlgos, 0),
    officialSettlementCoverage: numberOrDefault(value.officialSettlementCoverage, 0),
    reasonCodes: Array.isArray(value.reasonCodes) ? value.reasonCodes.filter((item): item is string => typeof item === "string") : [],
  };
}

function normalizeFactoryDrift(value: unknown): LocalFactorySweepCandidate["drift"] {
  if (!isRecord(value)) return { driftOk: true, driftReasons: [], driftScore: 0 };
  return {
    driftOk: typeof value.driftOk === "boolean" ? value.driftOk : true,
    driftReasons: Array.isArray(value.driftReasons) ? value.driftReasons.filter((item): item is string => typeof item === "string") : [],
    driftScore: numberOrDefault(value.driftScore, 0),
  };
}

function normalizeFactoryPaperEvidence(value: unknown): LocalFactorySweepCandidate["paperEvidence"] {
  if (!isRecord(value)) {
    return { available: false, status: "missing", closedMarkets: 0, closedTrades: 0, totalPnl: null, roi: null, driftOk: true, driftReasons: [], driftScore: 0 };
  }
  return {
    available: Boolean(value.available),
    status: stringOrDefault(value.status, "missing"),
    closedMarkets: numberOrDefault(value.closedMarkets, 0),
    closedTrades: numberOrDefault(value.closedTrades, 0),
    totalPnl: numberOrNull(value.totalPnl),
    roi: numberOrNull(value.roi),
    driftOk: typeof value.driftOk === "boolean" ? value.driftOk : true,
    driftReasons: Array.isArray(value.driftReasons) ? value.driftReasons.filter((item): item is string => typeof item === "string") : [],
    driftScore: numberOrDefault(value.driftScore, 0),
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

function stringOrNullable(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function displayIdFromAlgoId(algoId: string): string | null {
  const match = algoId.match(/(?:batch-)?([a-z])-([a-z0-9]+)?-?(\d{4})$/i)
    ?? algoId.match(/([A-Z])-(\d{4})$/i);
  if (!match) return null;
  const batch = match[1].toUpperCase();
  const serial = match[3] ?? match[2];
  return serial ? `${batch}-${serial.slice(-4).toUpperCase()}` : null;
}

function normalizeSweepMode(value: unknown): LocalFactorySweep["mode"] {
  if (value === "default" || value === "deep-sweep" || value === "validate" || value === "replay-run" || value === "promote-check") return value;
  return "sweep";
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
