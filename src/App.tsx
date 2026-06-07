import {
  Activity,
  BrainCircuit,
  CheckCircle2,
  ChevronDown,
  CircleDollarSign,
  Clock3,
  Database,
  Gauge,
  LineChart,
  ListChecks,
  Lock,
  Pause,
  Play,
  Radio,
  RotateCcw,
  ShieldAlert,
  SlidersHorizontal,
  Square,
  Star,
  Target,
  Trash2,
  ToggleRight,
} from "lucide-react";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import "./App.css";
import dogeEdgeLogo from "./assets/dogeedge-logo.png";
import {
  formatCountdown,
  formatTime,
  makeRuntimeSnapshot,
  type Candle,
  type LiveMarketData,
  type MarketFeedStatus,
  type RuntimeSnapshot,
} from "./data/runtime";
import {
  emptyKalshiMarket,
  emptyKalshiPortfolio,
  normalizeKalshiMarketPayload,
  normalizeKalshiPortfolioPayload,
  type KalshiMarketData,
  type KalshiPortfolioSummary,
} from "./core/kalshi";
import {
  buildLearningReport,
  emptyLearningState,
  learningStorageKey,
  type LearningReport,
  type LearningState,
} from "./core/learning";
import {
  canUseLocalWorker,
  fetchLatestAppState,
  fetchLatestFactorySweep,
  fetchPaperTradeSummary,
  fetchPaperTrades,
  initialLocalWorkerStatus,
  localApiUrl,
  localWorkerRequiresPreviewStatus,
  offlineLocalWorkerStatus,
  pushLatestAppState,
  pushLocalWorkerExport,
  type LocalFactorySweep,
  type LocalFactorySweepCandidate,
  type LocalPaperTradeStrategySummary,
  type LocalWorkerExportPayload,
  type LocalWorkerStatus,
} from "./core/local-worker";
import {
  advancePaperStrategies,
  activePaperRuleDescriptions,
  activePaperRules,
  defaultPaperAlgoUpgrades,
  defaultPaperStrategies,
  emptyPaperState,
  generatedPaperAlgoSignalPreview,
  generatedPaperFamilyCode,
  generatedPaperAlgoStorageKey,
  generatedPaperAlgoSupportsFamily,
  legacyPaperStorageKey,
  normalizeGeneratedPaperAlgos,
  normalizeEnabledStrategies,
  normalizePaperState,
  paperStorageKey,
  paperStrategyDefinitions,
  paperStrategyStorageKey,
  type BuiltInPaperStrategyId,
  type EnabledPaperStrategies,
  type GeneratedPaperAlgo,
  type PaperEngineInput,
  type PaperState,
  type PaperTrade,
} from "./core/paper";

type NavItem = "Now" | "Factory" | "Arena" | "Top Traders" | "Activated Algos" | "Account" | "Settings";
type IndicatorKey = "movingAverage" | "volatilityBand" | "momentumLine" | "edgeLine";
type LayerKey = "targetLine" | "finalWindow" | "volumeBars" | "kalshiPrice" | "signalMarkers";
type ChartRangeKey = "1m" | "5m" | "15m" | "1H" | "4H" | "1D";
type ChartMenu = "indicators" | "layers" | null;
type ChartHistoryStatus = "idle" | "loading" | "ready" | "error";
type UpdateState = "checking" | "current" | "reloading";

type OrderFlowInputSample = {
  ticker: string | null;
  observedAt: string;
  yesAsk: number | null;
  noAsk: number | null;
  yesBid: number | null;
  noBid: number | null;
  yesAskDepth: number | null;
  noAskDepth: number | null;
  yesBidDepth: number | null;
  noBidDepth: number | null;
};

type OrderFlowInputHistory = {
  current: OrderFlowInputSample | null;
};

const appOrderFlowInputHistory: OrderFlowInputHistory = { current: null };
const liveOrderFlowInputHistory: OrderFlowInputHistory = { current: null };

type ArenaEntryPolicy = "single-entry" | "repeat-entry" | "legacy" | "top-traders-dry-run";

type GeneratedPaperAlgoArchive = {
  activationId: string;
  displayId: string;
  sourceAlgoId: string;
  name: string;
  family: string;
  params: Record<string, unknown>;
  sourceRunId: string | null;
  activatedAt: string;
  deactivatedAt: string;
  arenaEntryPolicy: ArenaEntryPolicy;
  sourceMetrics: GeneratedPaperAlgo["sourceMetrics"];
  liveStats: PaperSummarySnapshot;
};

type ActivatedAlgoRow = Omit<GeneratedPaperAlgoArchive, "deactivatedAt"> & {
  deactivatedAt: string | null;
  isActive: boolean;
  sampleCount?: number;
  cycleCount?: number;
  fullCycleCount?: number;
  lastTransactionAt?: string | null;
};

type TopTraderBucket = "champion" | "prospect" | "wildcard" | "standby";

type TopTraderRow = ActivatedAlgoRow & {
  rank: number;
  bucket: TopTraderBucket;
  runnerStats: PaperSummarySnapshot;
  isInTopRoster: boolean;
  score: number;
  reliabilityScore: number;
  prospectScore: number;
};

type TopTraderSortKey = "rank" | "bucket" | "id" | "type" | "allTrades" | "topRun" | "winLoss" | "reliability" | "trades15" | "avgProfitTrade" | "pnl15" | "roi" | "status";

type TopTraderSort = {
  key: TopTraderSortKey;
  direction: "asc" | "desc";
};

type TopTraderSortChain = TopTraderSort[];

type ExecutableTopTraderScore = {
  row: TopTraderRow;
  stats: TopTraderExecutableStats | undefined;
  summary: PaperSummarySnapshot;
  execRow: ActivatedAlgoRow;
  score: number;
  reliabilityScore: number;
  acceptanceRate: number;
  pnlPerCycle: number;
  winRate: number;
  hasDryEvidence: boolean;
};

type ActivatedTradeViewerState = {
  row: ActivatedAlgoRow | null;
  status: "idle" | "loading" | "ready" | "error";
  trades: PaperTrade[];
  count: number;
  truncated: boolean;
  message: string | null;
};

type TopTraderTradeViewerState = {
  sourceAlgoId: string | null;
};

type PaperSummarySnapshot = {
  buys: number;
  sells: number;
  open: number;
  wins: number;
  losses: number;
  totalPnl: number;
  totalCost: number;
  roi: number | null;
};

type FactoryAutomationDecision = {
  id: string;
  time: string;
  type: "promote" | "demote" | "flag" | "hold";
  title: string;
  detail: string;
  tone: "positive" | "negative" | "warning" | "neutral";
};

type FactoryAutomationState = {
  enabled: boolean;
  lastRunAt: string | null;
  lastScheduledBatchSlot: string | null;
  lastScheduledBatchAt: string | null;
  promotedCount: number;
  demotedCount: number;
  decisions: FactoryAutomationDecision[];
};

type FactoryBatchScheduleSlot = {
  id: string;
  scheduledAt: string;
  scheduledAtMs: number;
  hour: number;
  label: string;
};

type FactoryEvolutionSummary = {
  generation: number;
  eliteCount: number;
  mutationCount: number;
  crossoverCount: number;
  explorationCount: number;
  avoidedFailureZones: number;
  trainingSampleCount: number;
  quarantinedSampleCount: number;
  winnerCount: number;
  failureCount: number;
  parentBatchIds: string[];
};

type FactoryAlgoBatch = {
  id: string;
  name: string;
  createdAt: string;
  source: string;
  generation: number;
  parentBatchIds: string[];
  summary: FactoryEvolutionSummary;
  algos: GeneratedPaperAlgo[];
};

type PaperArenaStatus = "idle" | "running" | "paused";

type PaperArenaState = {
  status: PaperArenaStatus;
  selectedAlgoId: string | null;
  selectedAlgoIds: string[];
  activeBatchId: string | null;
  activeBatchIds: string[];
  startingBalance: number;
  maxBet: number;
  allowRepeatBuys: boolean;
  startedAt: string | null;
  stoppedAt: string | null;
  paperState: PaperState;
};

type LiveOrderRouterStatus = {
  state: "checking" | "ready" | "error";
  configured: boolean;
  liveEnabled: boolean;
  dryRun: boolean;
  liveSwitchEnabled: boolean;
  sellExitsEnabled: boolean;
  allowedSeries: string;
  maxOrderDollars: number;
  maxExposureDollars: number;
  executionMinEdgeAfterFees: number;
  conservativeMode: boolean;
  conservative: {
    minConfidence: number;
    minEdgeAfterFees: number;
    minSideProbability: number;
    maxSpreadCents: number;
    minSecondsToClose: number;
    maxSecondsToClose: number;
  };
  error: string | null;
};

type LiveOrderSubmitState = {
  status: "idle" | "submitting" | "accepted" | "rejected";
  message: string | null;
  clientOrderId: string | null;
  dryRun: boolean;
};

type LiveExecutionLogEntry = {
  id: string;
  time: string;
  event: "ARMED" | "STOPPED" | "SUBMITTED" | "SOLD" | "REJECTED" | "LIVE ON" | "LIVE OFF" | "DRY RUN" | "REAL MODE" | "PROBATION PASS" | "PROBATION FAIL";
  orderAction: "BUY" | "SELL" | null;
  algo: string;
  ticker: string | null;
  side: string | null;
  contracts: number | null;
  cost: number | null;
  profit?: number | null;
  message: string;
};

type DryLiveProbationRecord = {
  sourceAlgoId: string;
  displayId: string;
  status: "testing" | "passed" | "failed";
  startedAt: string;
  reviewedAt: string | null;
  reason: string | null;
  attempts: number;
  rejects: number;
  closedExits: number;
  totalPnl: number;
  avgTrade: number | null;
  rejectRate: number | null;
};

type LiveRunnerState = {
  status: PaperArenaStatus;
  selectedAlgoId: string | null;
  selectedAlgoIds: string[];
  maxBet: number;
  allowRepeatBuys: boolean;
  autoDryLiveEnabled: boolean;
  dryLiveProbation: Record<string, DryLiveProbationRecord>;
  startedAt: string | null;
  stoppedAt: string | null;
};

type LiveManagedPosition = {
  id: string;
  status: "open" | "closed";
  algoId: string;
  algoDisplayId: string;
  algoName: string;
  algoFamily: string;
  algoSourceId: string;
  algoParams: Record<string, unknown>;
  ticker: string;
  side: "YES" | "NO";
  contracts: number;
  entryPrice: number;
  openedAt: string;
  closedAt: string | null;
  exitPrice: number | null;
  bestExitPrice?: number | null;
  realizedPnl: number | null;
  exitReason: string | null;
};

type NowLiveAlgoPnlRow = {
  key: string;
  displayId: string;
  name: string | null;
  family: string | null;
  realizedPnl: number;
  openPnl: number | null;
  totalPnl: number | null;
  buys: number;
  sells: number;
  rejects: number;
  openPositions: number;
  openContracts: number;
  lastAt: string | null;
};

type LiveOrderCandidate = {
  algo: GeneratedPaperAlgo;
  signal: ReturnType<typeof generatedPaperAlgoSignalPreview>;
  observedAt: string;
  signalAction: "buy_yes" | "buy_no" | null;
  signalSide: "YES" | "NO" | null;
  priceCents: number | null;
  orderCount: number;
  estimatedCost: number;
  orderKey: string | null;
  ready: boolean;
};

type TopTraderRejectionKey = "staleRejects" | "depthRejects" | "gateRejects" | "edgeRejects" | "priceRejects" | "otherRejects";

type TopTraderExecutableStats = {
  sourceAlgoId: string;
  algoId: string;
  displayId: string;
  family: string;
  startedAt: string | null;
  lastSignalAt: string | null;
  lastAttemptAt: string | null;
  lastAcceptedAt: string | null;
  lastRejectedAt: string | null;
  lastRejectedMessage: string | null;
  lastRejectedCategory: TopTraderRejectionKey | null;
  signals: number;
  attempts: number;
  acceptedBuys: number;
  rejected: number;
  staleRejects: number;
  depthRejects: number;
  gateRejects: number;
  edgeRejects: number;
  priceRejects: number;
  otherRejects: number;
  buys: number;
  sells: number;
  open: number;
  wins: number;
  losses: number;
  totalPnl: number;
  totalCost: number;
};

type TopTraderExecutableState = {
  startedAt: string | null;
  stoppedAt: string | null;
  stats: Record<string, TopTraderExecutableStats>;
  positions: LiveManagedPosition[];
};

const localWorkerSyncMs = 10_000;
const heavyStateSaveMs = 30_000;
const learningReportRefreshMs = 15_000;
const visibleEngineRefreshMs = 5_000;
const uiClockRefreshMs = 5_000;
const arenaEngineChunkMs = 250;
const arenaEngineChunkSize = 100;
const topTradersChampionSlots = 100;
const topTradersProspectSlots = 300;
const topTradersWildcardSlots = 200;
const topTradersRosterSize = topTradersChampionSlots + topTradersProspectSlots + topTradersWildcardSlots;
const topTradersMinClosedTrades = 3;
const topTradersChampionMinClosedTrades = 25;
const topTradersChampionMinPnlPerCycle = 0.10;
const topTradersChampionMinReliabilityScore = 75;
const topTradersChampionMinWinRate = 0.55;
const topTradersProspectMinClosedTrades = 1;
const topTradersEngineChunkMs = 1_000;
const topTradersRosterRefreshMs = 15_000;
const topTradersExecutableMaxBuyRequestsPerTick = 10;
const topTradersExecutableMaxSellRequestsPerTick = 8;
const topTradersExecutableSignalConfirmMs = 1_000;
const topTradersExecutableRetryDelayMs = 5_000;
const dryLivePromotionMaxAlgos = 5;
const dryLivePromotionMinAttempts = 20;
const dryLivePromotionMinAcceptedBuys = 5;
const dryLivePromotionMinClosedExits = 5;
const dryLivePromotionMinAcceptanceRate = 0.15;
const dryLivePromotionMaxHardRejectRate = 0.75;
const dryLiveProbationMaxLogRows = 500;
const dryLiveProbationMinAttempts = 25;
const dryLiveProbationMinClosedExits = 10;
const dryLiveProbationMinElapsedMs = 2 * 60 * 60 * 1000;
const dryLiveProbationMaxRejectRate = 0.75;
const factoryBatchScheduleCheckMs = 60_000;
const scheduledFactoryArenaStartingBalance = 100;
const scheduledFactoryArenaMaxBet = 10;
const scheduledTopTradersStartingBalance = 1000;
const scheduledTopTradersMaxBet = 10;
const localWorkerPaperHistoryLimit = 5_000;
const localWorkerArchiveLimit = 500;
const generatedPaperAlgoArchiveStorageKey = "dogeedge.generatedPaperAlgoArchives.v1";
const realisticArenaAlgoArchiveStorageKey = "dogeedge.realisticArenaAlgoArchives.v1";
const factoryAlgoBatchStorageKey = "dogeedge.factoryAlgoBatches.v1";
const factoryAutomationStorageKey = "dogeedge.factoryAutomation.v1";
const paperArenaStorageKey = "dogeedge.executableArena.v2";
const topTradersArenaStorageKey = "dogeedge.topTradersArena.v2";
const topTradersExecutableStorageKey = "dogeedge.topTradersExecutable.v2";
const liveExecutionLogStorageKey = "dogeedge.liveExecutionLog.v1";
const liveRunnerStorageKey = "dogeedge.liveRunner.v1";
const liveManagedPositionsStorageKey = "dogeedge.liveManagedPositions.v1";
const favoriteAlgoStorageKey = "dogeedge.favoriteAlgos.v1";
const factoryBatchSResetBatchId = "factory-batch-batch-s-mq2d1r40";
const factoryBatchSResetAt = "2026-06-06T17:02:26.567Z";
const arenaBatchMax = 3000;
const factoryBatchSize = 1000;
const factoryBatchAlgoPreviewLimit = 80;
const activatedAlgoTopLimit = 100;
const liveRetryDelayMs = 3_000;
const liveSellRetryDelayMs = 5_000;
const liveOrderRequestTimeoutMs = 10_000;
const liveSignalConfirmMs = 750;
const liveSignalMaxAgeMs = 2_500;
const liveExecutableMinEdgeAfterFees = 0.01;

const navItems: Array<{ label: NavItem; icon: typeof Activity; badge?: string }> = [
  { label: "Now", icon: Activity },
  { label: "Top Traders", icon: Gauge },
  { label: "Activated Algos", icon: ListChecks },
  { label: "Factory", icon: BrainCircuit },
  { label: "Account", icon: CircleDollarSign },
];

function normalizeActiveView(view: NavItem): NavItem {
  if (view === "Arena") return "Factory";
  if (view === "Settings") return "Account";
  return navItems.some((item) => item.label === view) ? view : "Now";
}

const disabledPaperStrategies: EnabledPaperStrategies = {
  final60: false,
  thresholdDistance: false,
  orderbookScalp: false,
  momentumFlip: false,
  noTradeSentinel: false,
};

const indicatorOptions: Array<{ id: IndicatorKey; label: string; metric: string }> = [
  { id: "movingAverage", label: "8-candle average", metric: "trend" },
  { id: "volatilityBand", label: "Volatility band", metric: "range" },
  { id: "momentumLine", label: "Momentum", metric: "pressure" },
  { id: "edgeLine", label: "Target edge", metric: "distance" },
];

const layerOptions: Array<{ id: LayerKey; label: string; metric: string }> = [
  { id: "targetLine", label: "Target line", metric: "contract" },
  { id: "finalWindow", label: "Final minute window", metric: "settlement" },
  { id: "volumeBars", label: "Volume bars", metric: "liquidity" },
  { id: "kalshiPrice", label: "YES price model", metric: "market" },
  { id: "signalMarkers", label: "Threshold crosses", metric: "spot" },
];

const chartRangeOptions: Array<{ id: ChartRangeKey; label: string; durationMs: number; granularitySeconds: 60 | 300; refreshMs: number }> = [
  { id: "1m", label: "1m", durationMs: 60_000, granularitySeconds: 60, refreshMs: 15_000 },
  { id: "5m", label: "5m", durationMs: 5 * 60_000, granularitySeconds: 60, refreshMs: 15_000 },
  { id: "15m", label: "15m", durationMs: 15 * 60_000, granularitySeconds: 60, refreshMs: 30_000 },
  { id: "1H", label: "1H", durationMs: 60 * 60_000, granularitySeconds: 60, refreshMs: 60_000 },
  { id: "4H", label: "4H", durationMs: 4 * 60 * 60_000, granularitySeconds: 60, refreshMs: 60_000 },
  { id: "1D", label: "1D", durationMs: 24 * 60 * 60_000, granularitySeconds: 300, refreshMs: 120_000 },
];

const defaultIndicatorState: Record<IndicatorKey, boolean> = {
  movingAverage: true,
  volatilityBand: false,
  momentumLine: false,
  edgeLine: true,
};

const defaultLayerState: Record<LayerKey, boolean> = {
  targetLine: true,
  finalWindow: true,
  volumeBars: true,
  kalshiPrice: true,
  signalMarkers: false,
};

function paperStateForLocalWorker(state: PaperState): PaperState {
  if (state.trades.length <= localWorkerPaperHistoryLimit && state.events.length <= localWorkerPaperHistoryLimit) {
    return state;
  }
  return {
    trades: state.trades.slice(0, localWorkerPaperHistoryLimit),
    events: state.events.slice(0, localWorkerPaperHistoryLimit),
  };
}

function paperArenaForLocalWorker(arena: PaperArenaState): PaperArenaState {
  return {
    ...arena,
    paperState: paperStateForLocalWorker(arena.paperState),
  };
}

function generatedAlgoArchivesForLocalWorker(archives: GeneratedPaperAlgoArchive[]) {
  return archives.slice(0, localWorkerArchiveLimit);
}

const coinbaseProductId = "DOGE-USD";
const coinbaseRestBase = "https://api.exchange.coinbase.com";
const coinbaseWsUrl = "wss://ws-feed.exchange.coinbase.com";

type StateUpdater<T> = T | ((current: T) => T);

function resolveStateUpdater<T>(current: T, updater: StateUpdater<T>): T {
  return typeof updater === "function" ? (updater as (current: T) => T)(current) : updater;
}

function App() {
  const [activeView, setActiveView] = useState<NavItem>("Now");
  const [clock, setClock] = useState(() => new Date());
  const liveMarket = useCoinbaseDogeFeed();
  const kalshiMarket = useKalshiDogeMarket();
  const kalshiPortfolio = useKalshiPortfolioSummary(kalshiMarket.market?.ticker ?? null);
  const { setDryRunMode: setLiveDryRunMode, setLiveSwitch: setLiveTradingSwitch, status: liveOrderRouterStatus } = useKalshiOrderRouterStatus();
  const snapshot = useMemo(() => makeRuntimeSnapshot(clock, liveMarket, kalshiMarket), [clock, kalshiMarket, liveMarket]);
  const paperInput = useMemo(() => paperInputFromSnapshot(snapshot, appOrderFlowInputHistory), [snapshot]);
  const paperInputRef = useRef(paperInput);
  const [paperState, setPaperState] = useState<PaperState>(() => loadPaperState());
  const [learningState] = useState<LearningState>(() => emptyLearningState);
  const [enabledPaperStrategies] = useState<EnabledPaperStrategies>(() => loadEnabledPaperStrategies());
  const [generatedPaperAlgos, setGeneratedPaperAlgos] = useState<GeneratedPaperAlgo[]>(() => loadGeneratedPaperAlgos());
  const [generatedPaperAlgoArchives, setGeneratedPaperAlgoArchives] = useState<GeneratedPaperAlgoArchive[]>(() => loadGeneratedPaperAlgoArchives());
  const [realisticArenaAlgoArchives, setRealisticArenaAlgoArchives] = useState<GeneratedPaperAlgoArchive[]>(() => loadRealisticArenaAlgoArchives());
  const [factoryAlgoBatches, setFactoryAlgoBatches] = useState<FactoryAlgoBatch[]>(() => loadFactoryAlgoBatches());
  const [factoryAutomation, setFactoryAutomation] = useState<FactoryAutomationState>(() => loadFactoryAutomationState());
  const [paperArena, setPaperArena] = useState<PaperArenaState>(() => loadPaperArenaState());
  const [topTradersArena, setTopTradersArena] = useState<PaperArenaState>(() => loadTopTradersArenaState());
  const [topTradersExecutable, setTopTradersExecutable] = useState<TopTraderExecutableState>(() => loadTopTradersExecutableState());
  const [nowLiveRunnerStatus, setNowLiveRunnerStatus] = useState<PaperArenaStatus>(() => loadLiveRunnerState().status);
  const [favoriteAlgoSourceIds, setFavoriteAlgoSourceIds] = useState<string[]>(() => loadFavoriteAlgoSourceIds());
  const [latestSweep, setLatestSweep] = useState<LocalFactorySweep | null>(null);
  const [savedTradeSummaries, setSavedTradeSummaries] = useState<LocalPaperTradeStrategySummary[]>([]);
  const [activatedDataClearToken, setActivatedDataClearToken] = useState(0);
  const [learningReport, setLearningReport] = useState<LearningReport>(() => buildLearningReport(paperState, learningState));
  const liveMarketRef = useRef(liveMarket);
  const kalshiMarketRef = useRef(kalshiMarket);
  const snapshotRef = useRef(snapshot);
  const paperStateRef = useRef(paperState);
  const learningStateRef = useRef(learningState);
  const learningReportRef = useRef(learningReport);
  const paperArenaRef = useRef(paperArena);
  const topTradersArenaRef = useRef(topTradersArena);
  const topTradersExecutableRef = useRef(topTradersExecutable);
  const nowLiveRunnerStatusRef = useRef(nowLiveRunnerStatus);
  const enabledPaperStrategiesRef = useRef(enabledPaperStrategies);
  const generatedPaperAlgosRef = useRef(generatedPaperAlgos);
  const generatedPaperAlgoArchivesRef = useRef(generatedPaperAlgoArchives);
  const realisticArenaAlgoArchivesRef = useRef(realisticArenaAlgoArchives);
  const savedTradeSummariesRef = useRef(savedTradeSummaries);
  const factoryAlgoBatchesRef = useRef(factoryAlgoBatches);
  const factoryAutomationRef = useRef(factoryAutomation);
  const latestSweepRef = useRef<LocalFactorySweep | null>(latestSweep);
  const factoryAutomationSignatureRef = useRef<string | null>(null);
  const arenaEngineCursorRef = useRef(0);
  const topTradersEngineCursorRef = useRef(0);
  const topTradersRosterIdsRef = useRef<string[]>([]);
  const topTradersRosterRefreshAtRef = useRef(0);
  const topTradersExecutableSignalSeenRef = useRef<Record<string, { fingerprint: string; firstSeenAt: number; lastSeenAt: number }>>({});
  const topTradersExecutableBlockedUntilRef = useRef<Record<string, number>>({});
  const topTradersExecutableInFlightRef = useRef(0);
  const [, setLocalWorkerStatus] = useState<LocalWorkerStatus>(() => canUseLocalWorker() ? initialLocalWorkerStatus : localWorkerRequiresPreviewStatus());
  const [appStateBackupReady, setAppStateBackupReady] = useState(() => !canUseLocalWorker());
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [updateState, setUpdateState] = useState<UpdateState>("checking");
  const visibleActiveView = normalizeActiveView(activeView);
  const visibleArenaAlgos = useMemo(() => arenaAlgosForArena(paperArena, generatedPaperAlgos, latestSweep, factoryAlgoBatches), [factoryAlgoBatches, generatedPaperAlgos, latestSweep, paperArena]);
  const topTraderCandidateAlgos = useMemo(() => topTraderCandidateAlgosForFactory(generatedPaperAlgos, factoryAlgoBatches), [factoryAlgoBatches, generatedPaperAlgos]);
  const baseLiveTopTraderRows = useMemo(() => buildTopTraderRows(
      topTraderCandidateAlgos,
      realisticArenaAlgoArchives,
      topTradersArena,
      clock.toISOString(),
      paperArena,
      visibleArenaAlgos,
      savedTradeSummaries,
    ), [clock, paperArena, realisticArenaAlgoArchives, savedTradeSummaries, topTraderCandidateAlgos, topTradersArena, visibleArenaAlgos]);
  const liveTopTraderRows = useMemo(
    () => rankTopTraderRowsByExecutableStats(baseLiveTopTraderRows, topTradersExecutable, clock.toISOString()),
    [baseLiveTopTraderRows, clock, topTradersExecutable],
  );

  const syncVisibleEngineState = useCallback(() => {
    setPaperState((current) => current === paperStateRef.current ? current : paperStateRef.current);
    setPaperArena((current) => current === paperArenaRef.current ? current : paperArenaRef.current);
    setTopTradersArena((current) => current === topTradersArenaRef.current ? current : topTradersArenaRef.current);
  }, []);

  const commitPaperArena = useCallback((updater: StateUpdater<PaperArenaState>) => {
    const next = resolveStateUpdater(paperArenaRef.current, updater);
    paperArenaRef.current = next;
    setPaperArena((current) => current === next ? current : next);
    return next;
  }, []);

  const commitTopTradersArena = useCallback((updater: StateUpdater<PaperArenaState>) => {
    const next = resolveStateUpdater(topTradersArenaRef.current, updater);
    topTradersArenaRef.current = next;
    setTopTradersArena((current) => current === next ? current : next);
    return next;
  }, []);

  const commitTopTradersExecutable = useCallback((updater: StateUpdater<TopTraderExecutableState>) => {
    const next = resolveStateUpdater(topTradersExecutableRef.current, updater);
    topTradersExecutableRef.current = next;
    setTopTradersExecutable((current) => current === next ? current : next);
    return next;
  }, []);

  const handleLiveRunnerStatusChange = useCallback((status: PaperArenaStatus) => {
    nowLiveRunnerStatusRef.current = status;
    setNowLiveRunnerStatus((current) => current === status ? current : status);
  }, []);

  const selectView = useCallback((view: NavItem) => {
    setActiveView(normalizeActiveView(view));
  }, []);

  const toggleFavoriteAlgoSourceId = useCallback((sourceAlgoId: string) => {
    setFavoriteAlgoSourceIds((current) => (
      current.includes(sourceAlgoId)
        ? current.filter((id) => id !== sourceAlgoId)
        : uniqueStringList([sourceAlgoId, ...current])
    ));
  }, []);

  useEffect(() => {
    liveMarketRef.current = liveMarket;
  }, [liveMarket]);

  useEffect(() => {
    kalshiMarketRef.current = kalshiMarket;
  }, [kalshiMarket]);

  useEffect(() => {
    snapshotRef.current = snapshot;
  }, [snapshot]);

  useEffect(() => {
    paperInputRef.current = paperInput;
  }, [paperInput]);

  useEffect(() => {
    paperStateRef.current = paperState;
  }, [paperState]);

  useEffect(() => {
    learningStateRef.current = learningState;
  }, [learningState]);

  useEffect(() => {
    learningReportRef.current = learningReport;
  }, [learningReport]);

  useEffect(() => {
    paperArenaRef.current = paperArena;
  }, [paperArena]);

  useEffect(() => {
    topTradersArenaRef.current = topTradersArena;
  }, [topTradersArena]);

  useEffect(() => {
    topTradersExecutableRef.current = topTradersExecutable;
  }, [topTradersExecutable]);

  useEffect(() => {
    enabledPaperStrategiesRef.current = enabledPaperStrategies;
  }, [enabledPaperStrategies]);

  useEffect(() => {
    generatedPaperAlgosRef.current = generatedPaperAlgos;
  }, [generatedPaperAlgos]);

  useEffect(() => {
    generatedPaperAlgoArchivesRef.current = generatedPaperAlgoArchives;
  }, [generatedPaperAlgoArchives]);

  useEffect(() => {
    realisticArenaAlgoArchivesRef.current = realisticArenaAlgoArchives;
  }, [realisticArenaAlgoArchives]);

  useEffect(() => {
    savedTradeSummariesRef.current = savedTradeSummaries;
  }, [savedTradeSummaries]);

  useEffect(() => {
    const id = window.setTimeout(() => setGeneratedPaperAlgos((current) => {
      const filtered = filterFactoryBatchGeneratedAlgos(current);
      return filtered.length === current.length ? current : filtered;
    }), 0);
    return () => window.clearTimeout(id);
  }, []);

  useEffect(() => {
    factoryAlgoBatchesRef.current = factoryAlgoBatches;
  }, [factoryAlgoBatches]);

  useEffect(() => {
    latestSweepRef.current = latestSweep;
  }, [latestSweep]);

  useEffect(() => {
    factoryAutomationRef.current = factoryAutomation;
  }, [factoryAutomation]);

  useEffect(() => {
    saveFavoriteAlgoSourceIds(favoriteAlgoSourceIds);
  }, [favoriteAlgoSourceIds]);

  useEffect(() => {
    const id = window.setTimeout(() => commitPaperArena((current) => {
      const storedActiveBatchIds = activeArenaBatchIds(current);
      if (storedActiveBatchIds.length > 0 && factoryAlgoBatchesRef.current.length === 0) {
        return current;
      }
      const availableBatchIds = new Set(factoryAlgoBatchesRef.current.map((batch) => batch.id));
      const activeBatchIds = storedActiveBatchIds.filter((batchId) => availableBatchIds.has(batchId));
      const normalizedArena = {
        ...current,
        activeBatchId: activeBatchIds[0] ?? null,
        activeBatchIds,
      };
      const availableIds = new Set<string>(arenaAlgosForArena(normalizedArena, generatedPaperAlgosRef.current, latestSweepRef.current, factoryAlgoBatchesRef.current).map((algo) => algo.id));
      const storedIds = uniqueStringList(current.selectedAlgoIds.length > 0
        ? current.selectedAlgoIds
        : current.selectedAlgoId ? [current.selectedAlgoId] : []);
      const selectedAlgoIds = storedIds.filter((id) => availableIds.has(id)).slice(0, arenaBatchMax);
      const selectedAlgoId = selectedAlgoIds[0] ?? null;
      const unchanged = current.selectedAlgoId === selectedAlgoId
        && current.activeBatchId === normalizedArena.activeBatchId
        && current.activeBatchIds.length === activeBatchIds.length
        && current.activeBatchIds.every((id, index) => id === activeBatchIds[index])
        && current.selectedAlgoIds.length === selectedAlgoIds.length
        && current.selectedAlgoIds.every((id, index) => id === selectedAlgoIds[index]);
      return unchanged ? current : { ...normalizedArena, selectedAlgoId, selectedAlgoIds };
    }), 0);
    return () => window.clearTimeout(id);
  }, [commitPaperArena, factoryAlgoBatches, generatedPaperAlgos, latestSweep]);

  useEffect(() => {
    const refreshEngineInput = () => {
      const engineSnapshot = makeRuntimeSnapshot(new Date(), liveMarketRef.current, kalshiMarketRef.current);
      snapshotRef.current = engineSnapshot;
      paperInputRef.current = paperInputFromSnapshot(engineSnapshot, appOrderFlowInputHistory);
    };
    refreshEngineInput();
    const id = window.setInterval(refreshEngineInput, 1_000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const runArenaEngineChunk = () => {
      const current = paperArenaRef.current;
      const currentMetrics = paperArenaMetrics(current);
      const pausedForCashWithOpenTrades = current.status === "paused" && currentMetrics.available <= 0 && currentMetrics.open > 0;
      if (current.status !== "running" && !pausedForCashWithOpenTrades) return;
      const selectedIds = uniqueStringList(current.selectedAlgoIds.length > 0
        ? current.selectedAlgoIds
        : current.selectedAlgoId ? [current.selectedAlgoId] : []);
      if (selectedIds.length === 0) return;
      const selectedIdSet = new Set(selectedIds.slice(0, arenaBatchMax));
      const selectedAlgos = arenaAlgosForArena(current, generatedPaperAlgosRef.current, latestSweepRef.current, factoryAlgoBatchesRef.current)
        .filter((algo) => selectedIdSet.has(algo.id))
        .slice(0, arenaBatchMax);
      if (selectedAlgos.length === 0) return;
      const cursor = arenaEngineCursorRef.current % selectedAlgos.length;
      const chunk = selectedAlgos.slice(cursor, cursor + arenaEngineChunkSize);
      if (chunk.length < arenaEngineChunkSize && selectedAlgos.length > chunk.length) {
        chunk.push(...selectedAlgos.slice(0, arenaEngineChunkSize - chunk.length));
      }
      arenaEngineCursorRef.current = (cursor + arenaEngineChunkSize) % selectedAlgos.length;
      paperArenaRef.current = advancePaperArena(current, paperInputRef.current, chunk, { preserveSelection: true });
    };
    const firstRun = window.setTimeout(runArenaEngineChunk, 0);
    const id = window.setInterval(runArenaEngineChunk, arenaEngineChunkMs);
    return () => {
      window.clearTimeout(firstRun);
      window.clearInterval(id);
    };
  }, []);

  const submitTopTraderExecutableBuy = useCallback(async (candidate: LiveOrderCandidate, input: PaperEngineInput, ticker: string, maxBet: number) => {
    if (!candidate.ready || !candidate.signalAction || !candidate.signalSide || candidate.priceCents === null || candidate.orderCount <= 0) return;
    const now = new Date().toISOString();
    commitTopTradersExecutable((current) => updateTopTraderExecutableStats(current, candidate.algo, now, (stats) => ({
      ...stats,
      attempts: stats.attempts + 1,
      lastAttemptAt: now,
    })));
    try {
      const controller = new AbortController();
      const timeoutId = window.setTimeout(() => controller.abort(), liveOrderRequestTimeoutMs);
      const response = await fetch(localApiUrl("/api/kalshi/order-router"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          algoId: candidate.algo.id,
          algoDisplayId: candidate.algo.displayId,
          algoName: candidate.algo.name,
          algoFamily: candidate.algo.family,
          algoSourceId: candidate.algo.sourceAlgoId,
          algoParams: candidate.algo.params,
          paperInput: input,
          ticker,
          side: candidate.signalSide.toLowerCase(),
          action: "buy",
          signalAction: candidate.signalAction,
          count: candidate.orderCount,
          priceCents: candidate.priceCents,
          maxTradeDollars: maxBet,
          maxSlippageCents: 1,
          executionProfile: "standard",
        }),
      });
      window.clearTimeout(timeoutId);
      const payload = await response.json() as unknown;
      const accepted = isRecord(payload) && payload.accepted === true;
      const message = isRecord(payload)
        ? stringOrNull(payload.message) ?? stringOrNull(payload.error) ?? (accepted ? "Dry-run buy accepted." : "Dry-run buy rejected.")
        : "Order router returned an unreadable response.";
      if (!accepted) {
        if (candidate.orderKey) {
          topTradersExecutableBlockedUntilRef.current[candidate.orderKey] = Date.now() + liveBuyRejectionCooldownMs(message);
          delete topTradersExecutableSignalSeenRef.current[candidate.orderKey];
        }
        const rejectedAt = new Date().toISOString();
        commitTopTradersExecutable((current) => updateTopTraderExecutableStats(current, candidate.algo, rejectedAt, (stats) => topTraderRejectedStats(stats, message, rejectedAt)));
        return;
      }

      const filledOrders = liveSubmittedOrders(isRecord(payload) ? payload.submittedOrders : null);
      const filledContracts = filledOrders.reduce((total, order) => total + order.count, 0);
      if (filledContracts <= 0) return;
      const costCents = filledOrders.reduce((total, order) => total + order.count * order.priceCents, 0);
      const averageEntryPrice = costCents > 0 ? costCents / filledContracts / 100 : candidate.priceCents / 100;
      const side = liveSideLabel(isRecord(payload) && isRecord(payload.execution) ? stringOrNull(payload.execution.side) : null) ?? candidate.signalSide;
      const positionId = `${candidate.algo.id}:${ticker}:${side}`;
      const acceptedAt = new Date().toISOString();
      commitTopTradersExecutable((current) => {
        const existing = current.positions.find((position) => position.id === positionId && position.status === "open");
        const nextPositions = existing
          ? current.positions.map((position) => {
            if (position.id !== existing.id) return position;
            const totalContracts = position.contracts + filledContracts;
            const entryPrice = totalContracts > 0
              ? roundDisplayRatio(((position.entryPrice * position.contracts) + (averageEntryPrice * filledContracts)) / totalContracts)
              : position.entryPrice;
            return { ...position, contracts: totalContracts, entryPrice };
          })
          : [{
            id: positionId,
            status: "open" as const,
            algoId: candidate.algo.id,
            algoDisplayId: candidate.algo.displayId,
            algoName: candidate.algo.name,
            algoFamily: candidate.algo.family,
            algoSourceId: candidate.algo.sourceAlgoId,
            algoParams: candidate.algo.params,
            ticker,
            side,
            contracts: filledContracts,
            entryPrice: roundDisplayRatio(averageEntryPrice),
            openedAt: acceptedAt,
            closedAt: null,
            exitPrice: null,
            bestExitPrice: null,
            realizedPnl: null,
            exitReason: null,
          }, ...current.positions].slice(0, 1_000);
        return updateTopTraderExecutableStats({ ...current, positions: nextPositions }, candidate.algo, acceptedAt, (stats) => ({
          ...stats,
          acceptedBuys: stats.acceptedBuys + 1,
          buys: stats.buys + 1,
          open: stats.open + (existing ? 0 : 1),
          totalCost: stats.totalCost + costCents / 100,
          lastAcceptedAt: acceptedAt,
        }));
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Dry-run buy request failed";
      if (candidate.orderKey) {
        topTradersExecutableBlockedUntilRef.current[candidate.orderKey] = Date.now() + 30_000;
        delete topTradersExecutableSignalSeenRef.current[candidate.orderKey];
      }
      const rejectedAt = new Date().toISOString();
      commitTopTradersExecutable((current) => updateTopTraderExecutableStats(current, candidate.algo, rejectedAt, (stats) => topTraderRejectedStats(stats, message, rejectedAt)));
      console.warn(message);
    }
  }, [commitTopTradersExecutable]);

  const submitTopTraderExecutableSell = useCallback(async (position: LiveManagedPosition, priceCents: number, reason: string, input: PaperEngineInput) => {
    try {
      const controller = new AbortController();
      const timeoutId = window.setTimeout(() => controller.abort(), liveOrderRequestTimeoutMs);
      const response = await fetch(localApiUrl("/api/kalshi/order-router"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          algoId: position.algoId,
          algoDisplayId: position.algoDisplayId,
          algoName: position.algoName,
          algoFamily: position.algoFamily,
          algoSourceId: position.algoSourceId,
          algoParams: position.algoParams,
          paperInput: input,
          ticker: position.ticker,
          side: position.side.toLowerCase(),
          action: "sell",
          count: Math.max(1, Math.floor(position.contracts)),
          priceCents,
          maxTradeDollars: 10,
          maxSlippageCents: 1,
          executionProfile: "standard",
        }),
      });
      window.clearTimeout(timeoutId);
      const payload = await response.json() as unknown;
      const accepted = isRecord(payload) && payload.accepted === true;
      if (!accepted) return;
      const filledOrders = liveSubmittedOrders(isRecord(payload) ? payload.submittedOrders : null);
      const filledContracts = Math.min(position.contracts, filledOrders.reduce((total, order) => total + order.count, 0));
      if (filledContracts <= 0) return;
      const saleCents = filledOrders.reduce((total, order) => total + order.count * order.priceCents, 0);
      const exitPrice = saleCents > 0 ? saleCents / filledContracts / 100 : priceCents / 100;
      const pnl = roundDisplayMoney((exitPrice - position.entryPrice) * filledContracts);
      const closedAt = new Date().toISOString();
      const algo = {
        id: position.algoId as GeneratedPaperAlgo["id"],
        displayId: position.algoDisplayId,
        sourceAlgoId: position.algoSourceId,
        name: position.algoName,
        family: position.algoFamily,
        params: position.algoParams,
        enabled: true,
        promotedAt: position.openedAt,
        sourceRunId: sourceRunIdFromFactorySource(position.algoSourceId),
        sourceMetrics: emptyArenaSourceMetrics(),
      } satisfies GeneratedPaperAlgo;
      commitTopTradersExecutable((current) => {
        const nextPositions = current.positions.map((item) => (
          item.id === position.id
            ? {
              ...item,
              status: "closed" as const,
              closedAt,
              exitPrice: roundDisplayRatio(exitPrice),
              realizedPnl: pnl,
              exitReason: reason,
            }
            : item
        ));
        return updateTopTraderExecutableStats({ ...current, positions: nextPositions }, algo, closedAt, (stats) => ({
          ...stats,
          sells: stats.sells + 1,
          open: Math.max(0, stats.open - 1),
          wins: stats.wins + (pnl > 0 ? 1 : 0),
          losses: stats.losses + (pnl < 0 ? 1 : 0),
          totalPnl: stats.totalPnl + pnl,
        }));
      });
    } catch {
      // Dry-run sell will be retried on the next eligible tick.
    }
  }, [commitTopTradersExecutable]);

  useEffect(() => {
    const runTopTradersEngineChunk = () => {
      const current = topTradersArenaRef.current;
      if (current.status !== "running") return;
      if (!liveOrderRouterStatus.dryRun || !liveOrderRouterStatus.liveSwitchEnabled) return;
      if (nowLiveRunnerStatusRef.current === "running" || isLiveRunnerActive()) return;
      const availableAlgos = topTraderCandidateAlgosForFactory(generatedPaperAlgosRef.current, factoryAlgoBatchesRef.current);
      const availableIds = new Set<string>(availableAlgos.map((algo) => algo.id));
      const nowMs = Date.now();
      const nowIso = new Date(nowMs).toISOString();
      let rosterIds = topTradersRosterIdsRef.current.filter((id) => availableIds.has(id));
      if (rosterIds.length === 0 || nowMs >= topTradersRosterRefreshAtRef.current) {
        const sourceRankedRows = buildTopTraderRows(
          availableAlgos,
          realisticArenaAlgoArchivesRef.current,
          current,
          new Date(nowMs).toISOString(),
          paperArenaRef.current,
          arenaAlgosForArena(paperArenaRef.current, generatedPaperAlgosRef.current, latestSweepRef.current, factoryAlgoBatchesRef.current),
          savedTradeSummariesRef.current,
        );
        const rankedRows = rankTopTraderRowsByExecutableStats(sourceRankedRows, topTradersExecutableRef.current, new Date(nowMs).toISOString());
        rosterIds = rankedRows
          .filter((row) => row.bucket !== "standby")
          .slice(0, topTradersRosterSize)
          .map(paperStrategyIdForActivatedRow);
        topTradersRosterIdsRef.current = rosterIds;
        topTradersRosterRefreshAtRef.current = nowMs + topTradersRosterRefreshMs;
        commitTopTradersArena((state) => ({
          ...state,
          selectedAlgoId: rosterIds[0] ?? null,
          selectedAlgoIds: rosterIds,
          stoppedAt: null,
          paperState: emptyPaperState,
        }));
      }
      if (rosterIds.length === 0) return;
      const selectedIdSet = new Set(rosterIds);
      const rosterAlgos = availableAlgos.filter((algo) => selectedIdSet.has(algo.id)).slice(0, topTradersRosterSize);
      if (rosterAlgos.length === 0) return;
      const snapshot = snapshotRef.current;
      const input = paperInputRef.current;
      const activeTicker = snapshot.kalshi.market?.ticker ?? null;
      if (!activeTicker) return;
      const maxBet = Math.min(current.maxBet, liveOrderRouterStatus.maxOrderDollars);
      if (maxBet <= 0) return;

      let sellRequests = 0;
      const openPositions = topTradersExecutableRef.current.positions.filter((position) => position.status === "open" && position.contracts > 0);
      for (const position of openPositions) {
        if (sellRequests >= topTradersExecutableMaxSellRequestsPerTick) break;
        if (topTradersExecutableInFlightRef.current >= topTradersExecutableMaxBuyRequestsPerTick + topTradersExecutableMaxSellRequestsPerTick) break;
        const attemptKey = `sell:${position.id}`;
        const blockedUntil = topTradersExecutableBlockedUntilRef.current[attemptKey] ?? 0;
        if (nowMs < blockedUntil) continue;
        const bid = liveBidForSide(position.side, snapshot);
        if (bid === null || bid <= 0) continue;
        const algo = availableAlgos.find((item) => item.id === position.algoId) ?? null;
        const positionSignal = algo ? generatedPaperAlgoSignalPreview(input, algo) : null;
        const reason = liveExitReason(position, bid, snapshot, positionSignal);
        if (!reason) continue;
        topTradersExecutableBlockedUntilRef.current[attemptKey] = nowMs + topTradersExecutableRetryDelayMs;
        topTradersExecutableInFlightRef.current += 1;
        sellRequests += 1;
        void submitTopTraderExecutableSell(position, Math.max(1, Math.min(99, Math.floor(bid * 100))), reason, input)
          .finally(() => {
            topTradersExecutableInFlightRef.current = Math.max(0, topTradersExecutableInFlightRef.current - 1);
          });
      }

      let buyRequests = 0;
      const cursor = topTradersEngineCursorRef.current % rosterAlgos.length;
      for (let offset = 0; offset < rosterAlgos.length; offset += 1) {
        if (buyRequests >= topTradersExecutableMaxBuyRequestsPerTick) break;
        if (topTradersExecutableInFlightRef.current >= topTradersExecutableMaxBuyRequestsPerTick + topTradersExecutableMaxSellRequestsPerTick) break;
        const index = (cursor + offset) % rosterAlgos.length;
        const algo = rosterAlgos[index];
        const signal = generatedPaperAlgoSignalPreview(input, algo);
        const signalAction = signal.action === "buy_yes" || signal.action === "buy_no" ? signal.action : null;
        const signalSide = signal.side ?? null;
        const ask = signal.selectedAsk ?? null;
        const priceCents = ask === null ? null : Math.ceil(ask * 100);
        const orderCount = priceCents !== null && priceCents > 0 ? Math.min(5_000, Math.floor((maxBet * 100) / priceCents)) : 0;
        const orderKey = signalAction && signalSide && priceCents !== null && orderCount > 0
          ? `${algo.id}:${activeTicker}`
          : null;
        const hasOpenPosition = openPositions.some((position) => position.algoId === algo.id && position.ticker === activeTicker);
        if (!orderKey || hasOpenPosition || !signalAction || !signalSide || priceCents === null || orderCount <= 0) continue;
        const blockedUntil = topTradersExecutableBlockedUntilRef.current[orderKey] ?? 0;
        if (nowMs < blockedUntil) continue;
        const fingerprint = `${signalAction}:${signalSide}:${priceCents}:${orderCount}`;
        const seen = topTradersExecutableSignalSeenRef.current[orderKey];
        if (!seen || seen.fingerprint !== fingerprint) {
          topTradersExecutableSignalSeenRef.current[orderKey] = { fingerprint, firstSeenAt: nowMs, lastSeenAt: nowMs };
          commitTopTradersExecutable((state) => updateTopTraderExecutableStats(state, algo, nowIso, (stats) => ({
            ...stats,
            signals: stats.signals + 1,
            lastSignalAt: nowIso,
          })));
          continue;
        }
        seen.lastSeenAt = nowMs;
        if (nowMs - seen.firstSeenAt < topTradersExecutableSignalConfirmMs) continue;
        const stats = topTradersExecutableRef.current.stats[algo.sourceAlgoId];
        const lastAttemptAt = stats?.lastAttemptAt ? Date.parse(stats.lastAttemptAt) : 0;
        if (Number.isFinite(lastAttemptAt) && nowMs - lastAttemptAt < topTradersExecutableRetryDelayMs) continue;
        const preflightMessage = topTraderExecutablePreflightRejectionMessage(
          algo,
          signal,
          signalAction,
          signalSide,
          priceCents,
          orderCount,
          input,
          liveOrderRouterStatus.executionMinEdgeAfterFees,
        );
        if (preflightMessage) {
          const cooldownMs = Math.max(topTradersExecutableRetryDelayMs, liveBuyRejectionCooldownMs(preflightMessage));
          topTradersExecutableBlockedUntilRef.current[orderKey] = nowMs + cooldownMs;
          delete topTradersExecutableSignalSeenRef.current[orderKey];
          commitTopTradersExecutable((state) => updateTopTraderExecutableStats(state, algo, nowIso, (currentStats) => topTraderRejectedStats({
            ...currentStats,
            attempts: currentStats.attempts + 1,
            lastAttemptAt: nowIso,
          }, preflightMessage, nowIso)));
          buyRequests += 1;
          topTradersEngineCursorRef.current = index + 1;
          continue;
        }
        const candidate: LiveOrderCandidate = {
          algo,
          signal,
          observedAt: input.observedAt,
          signalAction,
          signalSide,
          priceCents,
          orderCount,
          estimatedCost: roundDisplayMoney((orderCount * priceCents) / 100),
          orderKey,
          ready: true,
        };
        topTradersExecutableInFlightRef.current += 1;
        buyRequests += 1;
        topTradersEngineCursorRef.current = index + 1;
        void submitTopTraderExecutableBuy(candidate, input, activeTicker, maxBet)
          .finally(() => {
            topTradersExecutableInFlightRef.current = Math.max(0, topTradersExecutableInFlightRef.current - 1);
          });
      }
    };
    const firstRun = window.setTimeout(runTopTradersEngineChunk, 0);
    const id = window.setInterval(runTopTradersEngineChunk, topTradersEngineChunkMs);
    return () => {
      window.clearTimeout(firstRun);
      window.clearInterval(id);
    };
  }, [commitTopTradersArena, commitTopTradersExecutable, liveOrderRouterStatus.dryRun, liveOrderRouterStatus.executionMinEdgeAfterFees, liveOrderRouterStatus.liveSwitchEnabled, liveOrderRouterStatus.maxOrderDollars, submitTopTraderExecutableBuy, submitTopTraderExecutableSell]);

  useEffect(() => {
    const id = window.setInterval(syncVisibleEngineState, visibleEngineRefreshMs);
    return () => window.clearInterval(id);
  }, [syncVisibleEngineState]);

  useEffect(() => {
    saveEnabledPaperStrategies(enabledPaperStrategies);
  }, [enabledPaperStrategies]);

  useEffect(() => {
    saveGeneratedPaperAlgos(generatedPaperAlgos);
  }, [generatedPaperAlgos]);

  useEffect(() => {
    saveGeneratedPaperAlgoArchives(generatedPaperAlgoArchives);
  }, [generatedPaperAlgoArchives]);

  useEffect(() => {
    saveRealisticArenaAlgoArchives(realisticArenaAlgoArchives);
  }, [realisticArenaAlgoArchives]);

  useEffect(() => {
    saveFactoryAlgoBatches(factoryAlgoBatches);
  }, [factoryAlgoBatches]);

  useEffect(() => {
    saveFactoryAutomationState(factoryAutomation);
  }, [factoryAutomation]);

  useEffect(() => {
    const refreshLearningReport = () => {
      setLearningReport(buildLearningReport(paperStateRef.current, learningStateRef.current));
    };
    const id = window.setInterval(refreshLearningReport, learningReportRefreshMs);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const saveHeavyState = () => {
      savePaperState(paperStateRef.current);
      saveLearningState(learningStateRef.current);
      savePaperArenaState(paperArenaRef.current);
      saveTopTradersArenaState(topTradersArenaRef.current);
      saveTopTradersExecutableState(topTradersExecutableRef.current);
    };
    const id = window.setInterval(saveHeavyState, heavyStateSaveMs);
    window.addEventListener("beforeunload", saveHeavyState);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("beforeunload", saveHeavyState);
      saveHeavyState();
    };
  }, []);

  const buildLocalWorkerPayload = (): LocalWorkerExportPayload => {
    const currentSnapshot = snapshotRef.current;
    return {
      exportedAt: new Date().toISOString(),
      sourceUrl: window.location.href,
      marketTicker: currentSnapshot.kalshi.market?.ticker ?? null,
      paperInput: paperInputRef.current,
      runtimeSnapshot: currentSnapshot,
      paperState: paperStateForLocalWorker(paperStateRef.current),
      learningState: emptyLearningState,
      learningReport: learningReportRef.current,
      generatedPaperAlgos: generatedPaperAlgosRef.current,
      generatedPaperAlgoArchives: generatedAlgoArchivesForLocalWorker(generatedPaperAlgoArchivesRef.current),
      factoryAutomation: factoryAutomationRef.current,
      paperArena: paperArenaForLocalWorker(paperArenaRef.current),
      topTradersArena: paperArenaForLocalWorker(topTradersArenaRef.current),
      topTradersExecutable: topTradersExecutableRef.current,
      activeRules: activePaperRules,
      activeRuleDescriptions: activePaperRuleDescriptions,
    };
  };

  useEffect(() => {
    if (!appStateBackupReady || !canUseLocalWorker()) {
      return undefined;
    }

    let active = true;

    const syncLocalWorker = async () => {
      try {
        const payload = buildLocalWorkerPayload();
        const status = await pushLocalWorkerExport(payload);
        if (active) setLocalWorkerStatus(status);
      } catch (error) {
        if (active) setLocalWorkerStatus(offlineLocalWorkerStatus(error));
      }
    };

    void syncLocalWorker();
    const id = window.setInterval(syncLocalWorker, localWorkerSyncMs);
    return () => {
      active = false;
      window.clearInterval(id);
    };
  }, [appStateBackupReady]);

  useEffect(() => {
    if (!canUseLocalWorker()) {
      return undefined;
    }

    let active = true;
    let retryId: number | null = null;
    const loadAppStateBackup = async () => {
      try {
        const backup = await fetchLatestAppState();
        if (!active || !backup) return;
        const backupBatches = normalizeFactoryAlgoBatches(backup.factoryAlgoBatches);
        const backupArchives = filterFactoryBatchActivatedRows(normalizeGeneratedPaperAlgoArchives(backup.realisticArenaAlgoArchives));
        if (backupBatches.length > 0) {
          setFactoryAlgoBatches((current) => mergeFactoryAlgoBatches(current, backupBatches));
        }
        if (backupArchives.length > 0) {
          setRealisticArenaAlgoArchives((current) => normalizeGeneratedPaperAlgoArchives([...backupArchives, ...current]));
        }
        setFactoryAutomation((current) => richerFactoryAutomationState(current, normalizeFactoryAutomationState(backup.factoryAutomation)));
        const backupTopTradersExecutable = normalizeTopTradersExecutableState(backup.topTradersExecutable);
        if (topTradersExecutableEvidenceCount(backupTopTradersExecutable) > 0) {
          commitTopTradersExecutable((current) => richerTopTradersExecutableState(current, backupTopTradersExecutable));
        }
        if (active) setAppStateBackupReady(true);
        if (retryId !== null) {
          window.clearInterval(retryId);
          retryId = null;
        }
      } catch {
        // Keep retrying; the local worker may still be restarting.
      }
    };

    void loadAppStateBackup();
    retryId = window.setInterval(loadAppStateBackup, 5_000);
    return () => {
      active = false;
      if (retryId !== null) window.clearInterval(retryId);
    };
  }, []);

  useEffect(() => {
    if (!appStateBackupReady || !canUseLocalWorker()) return undefined;
    const id = window.setTimeout(() => {
      void pushLatestAppState({
        factoryAlgoBatches: factoryAlgoBatches.filter(isSingleLetterFactoryBatch),
        realisticArenaAlgoArchives: filterFactoryBatchActivatedRows(realisticArenaAlgoArchives),
        factoryAutomation: factoryAutomationRef.current,
        topTradersExecutable: topTradersExecutableRef.current,
      }).catch(() => {
        // Local backup failures should not block the live UI.
      });
    }, 750);
    return () => window.clearTimeout(id);
  }, [appStateBackupReady, factoryAlgoBatches, factoryAutomation, realisticArenaAlgoArchives]);

  useEffect(() => {
    if (!appStateBackupReady) return undefined;
    const id = window.setTimeout(() => {
      setFactoryAlgoBatches((current) => (
        current.every(isSingleLetterFactoryBatch)
          ? current
          : current.filter(isSingleLetterFactoryBatch)
      ));
    }, 0);
    return () => window.clearTimeout(id);
  }, [appStateBackupReady]);

  useEffect(() => {
    if (!canUseLocalWorker()) {
      return undefined;
    }

    let active = true;
    const loadSweep = async () => {
      try {
        const sweep = await fetchLatestFactorySweep();
        if (!active) return;
        setLatestSweep(sweep);
      } catch {
        if (active) setLatestSweep(null);
      }
    };

    void loadSweep();
    const id = window.setInterval(loadSweep, 15_000);
    return () => {
      active = false;
      window.clearInterval(id);
    };
  }, []);

  useEffect(() => {
    if (!canUseLocalWorker()) {
      return undefined;
    }

    let active = true;
    const loadSavedTradeSummaries = async () => {
      try {
        const result = await fetchPaperTradeSummary();
        if (active) setSavedTradeSummaries(result.summaries);
      } catch {
        if (active) setSavedTradeSummaries([]);
      }
    };

    void loadSavedTradeSummaries();
    const id = window.setInterval(loadSavedTradeSummaries, 30_000);
    return () => {
      active = false;
      window.clearInterval(id);
    };
  }, []);

  const playPaperArena = (config: { selectedAlgoIds: string[]; startingBalance: number; maxBet: number; allowRepeatBuys: boolean; reset: boolean }) => {
    const startedAt = new Date().toISOString();
    const selectedAlgoIds = uniqueStringList(config.selectedAlgoIds).slice(0, arenaBatchMax);
    commitPaperArena((current) => {
      if (config.reset) {
        const archiveRows = archiveRealisticArenaAlgos(current, arenaAlgosForArena(current, generatedPaperAlgosRef.current, latestSweepRef.current, factoryAlgoBatchesRef.current), startedAt);
        if (archiveRows.length > 0) {
          setRealisticArenaAlgoArchives((archives) => normalizeGeneratedPaperAlgoArchives([...archiveRows, ...archives]));
        }
      }
      return {
        status: "running",
        selectedAlgoId: selectedAlgoIds[0] ?? null,
        selectedAlgoIds,
        activeBatchId: current.activeBatchId,
        activeBatchIds: current.activeBatchIds,
        startingBalance: config.startingBalance,
        maxBet: config.maxBet,
        allowRepeatBuys: config.allowRepeatBuys,
        startedAt: config.reset ? startedAt : current.startedAt ?? startedAt,
        stoppedAt: null,
        paperState: config.reset ? emptyPaperState : current.paperState,
      };
    });
  };

  const pausePaperArena = () => {
    const stoppedAt = new Date().toISOString();
    commitPaperArena((current) => ({ ...current, status: current.status === "running" ? "paused" : current.status, stoppedAt }));
  };

  const resetPaperArena = () => {
    const stoppedAt = new Date().toISOString();
    commitPaperArena((current) => {
      const archiveRows = archiveRealisticArenaAlgos(current, arenaAlgosForArena(current, generatedPaperAlgosRef.current, latestSweepRef.current, factoryAlgoBatchesRef.current), stoppedAt);
      if (archiveRows.length > 0) {
        setRealisticArenaAlgoArchives((archives) => normalizeGeneratedPaperAlgoArchives([...archiveRows, ...archives]));
      }
      return defaultPaperArenaState();
    });
  };

  const playTopTraders = (config: { startingBalance: number; maxBet: number; reset: boolean }) => {
    const startedAt = new Date().toISOString();
    const availableAlgos = topTraderCandidateAlgosForFactory(generatedPaperAlgosRef.current, factoryAlgoBatchesRef.current);
    const mainArena = paperArenaRef.current;
    const mainArenaAlgos = arenaAlgosForArena(mainArena, generatedPaperAlgosRef.current, latestSweepRef.current, factoryAlgoBatchesRef.current);
    commitTopTradersArena((current) => {
      const archiveRows = config.reset ? archiveRealisticArenaAlgos(current, availableAlgos, startedAt) : [];
      const archivesForRanking = archiveRows.length > 0
        ? normalizeGeneratedPaperAlgoArchives([...archiveRows, ...realisticArenaAlgoArchivesRef.current])
        : realisticArenaAlgoArchivesRef.current;
      if (archiveRows.length > 0) {
        setRealisticArenaAlgoArchives((archives) => normalizeGeneratedPaperAlgoArchives([...archiveRows, ...archives]));
      }
      const rankingArena = config.reset ? defaultPaperArenaState() : current;
      const selectedAlgoIds = rankTopTraderRowsByExecutableStats(
        buildTopTraderRows(availableAlgos, archivesForRanking, rankingArena, startedAt, mainArena, mainArenaAlgos, savedTradeSummariesRef.current),
        config.reset ? defaultTopTradersExecutableState() : topTradersExecutableRef.current,
        startedAt,
      )
        .filter((row) => row.bucket !== "standby")
        .slice(0, topTradersRosterSize)
        .map(paperStrategyIdForActivatedRow);
      if (selectedAlgoIds.length === 0) return current;
      topTradersRosterIdsRef.current = selectedAlgoIds;
      topTradersRosterRefreshAtRef.current = 0;
      topTradersEngineCursorRef.current = 0;
      topTradersExecutableSignalSeenRef.current = {};
      topTradersExecutableBlockedUntilRef.current = {};
      if (config.reset || topTradersExecutableRef.current.startedAt === null) {
        commitTopTradersExecutable({
          startedAt,
          stoppedAt: null,
          stats: {},
          positions: [],
        });
      } else {
        commitTopTradersExecutable((state) => ({ ...state, stoppedAt: null }));
      }
      return {
        status: "running",
        selectedAlgoId: selectedAlgoIds[0] ?? null,
        selectedAlgoIds,
        activeBatchId: null,
        activeBatchIds: [],
        startingBalance: config.startingBalance,
        maxBet: config.maxBet,
        allowRepeatBuys: false,
        startedAt: config.reset ? startedAt : current.startedAt ?? startedAt,
        stoppedAt: null,
        paperState: emptyPaperState,
      };
    });
  };

  const pauseTopTraders = () => {
    const stoppedAt = new Date().toISOString();
    commitTopTradersArena((current) => ({ ...current, status: current.status === "running" ? "paused" : current.status, stoppedAt }));
    commitTopTradersExecutable((current) => ({ ...current, stoppedAt }));
  };

  const resetTopTraders = () => {
    const stoppedAt = new Date().toISOString();
    commitTopTradersArena((current) => {
      const archiveRows = archiveRealisticArenaAlgos(current, topTraderCandidateAlgosForFactory(generatedPaperAlgosRef.current, factoryAlgoBatchesRef.current), stoppedAt);
      if (archiveRows.length > 0) {
        setRealisticArenaAlgoArchives((archives) => normalizeGeneratedPaperAlgoArchives([...archiveRows, ...archives]));
      }
      topTradersRosterIdsRef.current = [];
      topTradersRosterRefreshAtRef.current = 0;
      topTradersEngineCursorRef.current = 0;
      topTradersExecutableSignalSeenRef.current = {};
      topTradersExecutableBlockedUntilRef.current = {};
      commitTopTradersExecutable(defaultTopTradersExecutableState());
      return defaultPaperArenaState();
    });
  };

  const clearActivatedAlgoData = () => {
    const now = new Date().toISOString();
    setRealisticArenaAlgoArchives([]);
    commitPaperArena((current) => (
      current.status === "running"
        ? { ...current, paperState: emptyPaperState, startedAt: now, stoppedAt: null }
        : defaultPaperArenaState()
    ));
    commitTopTradersArena(() => defaultPaperArenaState());
    commitTopTradersExecutable(defaultTopTradersExecutableState());
    topTradersRosterIdsRef.current = [];
    topTradersRosterRefreshAtRef.current = 0;
    saveLiveManagedPositions(loadLiveManagedPositions().filter((position) => position.status === "open"));
    setActivatedDataClearToken((current) => current + 1);
  };

  const createFactoryBatchFromCurrentEvidence = useCallback((createdAt: string) => {
    const retainedBatches = factoryAlgoBatchesRef.current.filter(isSingleLetterFactoryBatch);
    const currentArena = paperArenaRef.current;
    const candidateAlgos = topTraderCandidateAlgosForFactory(generatedPaperAlgosRef.current, retainedBatches);
    const topTraderDryRunRows = topTraderExecutableArchivesForFactory(topTradersExecutableRef.current, candidateAlgos, createdAt);
    const activeArenaRows = archiveRealisticArenaAlgos(
      currentArena,
      arenaAlgosForArena(currentArena, generatedPaperAlgosRef.current, latestSweepRef.current, retainedBatches),
      createdAt,
    );
    const evolutionHistory = normalizeGeneratedPaperAlgoArchives([
      ...topTraderDryRunRows,
      ...filterFactoryBatchActivatedRows(activeArenaRows),
      ...filterFactoryBatchActivatedRows(realisticArenaAlgoArchivesRef.current),
    ]);
    const batchIndex = nextFactoryBatchIndex(retainedBatches, evolutionHistory, currentArena);
    const batch = createFactoryAlgoBatch(retainedBatches, evolutionHistory, createdAt, batchIndex);
    const nextBatches = [batch, ...retainedBatches].slice(0, 12);
    factoryAlgoBatchesRef.current = nextBatches;
    setFactoryAlgoBatches(nextBatches);
    return batch;
  }, []);

  const generateFactoryBatch = () => {
    createFactoryBatchFromCurrentEvidence(new Date().toISOString());
  };

  const loadFactoryBatchIntoArena = (batchId: string) => {
    loadFactoryBatchesIntoArena(batchId ? [batchId] : []);
  };

  const loadFactoryBatchesIntoArena = (batchIds: string[], options: {
    loadedAt?: string;
    startTesting?: boolean;
    startingBalance?: number;
    maxBet?: number;
    allowRepeatBuys?: boolean;
  } = {}) => {
    const loadedAt = options.loadedAt ?? new Date().toISOString();
    const startTesting = Boolean(options.startTesting);
    const requestedIds = uniqueStringList(batchIds);
    const batches = requestedIds
      .map((id) => factoryAlgoBatchesRef.current.find((item) => item.id === id) ?? null)
      .filter((batch): batch is FactoryAlgoBatch => batch !== null);
    if (batches.length === 0) {
      const defaultAlgos = factoryBatchUserAlgos(generatedPaperAlgosRef.current);
      commitPaperArena((current) => ({
        ...current,
        status: "idle",
        selectedAlgoId: defaultAlgos[0]?.id ?? null,
        selectedAlgoIds: defaultAlgos.slice(0, 12).map((algo) => algo.id),
        activeBatchId: null,
        activeBatchIds: [],
        startedAt: null,
        stoppedAt: null,
        paperState: emptyPaperState,
      }));
      return;
    }
    commitPaperArena((current) => {
      const archiveRows = archiveRealisticArenaAlgos(current, arenaAlgosForArena(current, generatedPaperAlgosRef.current, latestSweepRef.current, factoryAlgoBatchesRef.current), loadedAt);
      if (archiveRows.length > 0) {
        setRealisticArenaAlgoArchives((archives) => normalizeGeneratedPaperAlgoArchives([...archiveRows, ...archives]));
      }
      const activeBatchIds = batches.map((item) => item.id);
      const selectedAlgoIds = batches.flatMap((item) => item.algos.map((algo) => algo.id)).slice(0, arenaBatchMax);
      return {
        ...current,
        status: startTesting ? "running" : "idle",
        selectedAlgoId: selectedAlgoIds[0] ?? null,
        selectedAlgoIds,
        activeBatchId: activeBatchIds[0] ?? null,
        activeBatchIds,
        startingBalance: startTesting ? options.startingBalance ?? scheduledFactoryArenaStartingBalance : current.startingBalance,
        maxBet: startTesting ? options.maxBet ?? scheduledFactoryArenaMaxBet : current.maxBet,
        allowRepeatBuys: startTesting ? options.allowRepeatBuys ?? false : current.allowRepeatBuys,
        startedAt: startTesting ? loadedAt : null,
        stoppedAt: null,
        paperState: emptyPaperState,
      };
    });
  };

  useEffect(() => {
    if (!appStateBackupReady || !factoryAutomation.enabled) return undefined;

    let active = true;
    const runScheduledFactoryBatch = () => {
      if (!active) return;
      const automation = factoryAutomationRef.current;
      if (!automation.enabled) return;
      const slot = latestFactoryBatchScheduleSlot(new Date());
      if (automation.lastScheduledBatchSlot === slot.id) return;

      const existingBatch = latestFactoryBatchForScheduleSlot(factoryAlgoBatchesRef.current, slot);
      const batch = existingBatch ?? createFactoryBatchFromCurrentEvidence(slot.scheduledAt);
      const runAt = new Date().toISOString();
      const arenaAlreadyRunningBatch = paperArenaRef.current.status === "running"
        && activeArenaBatchIds(paperArenaRef.current).includes(batch.id);
      if (!arenaAlreadyRunningBatch) {
        loadFactoryBatchesIntoArena([batch.id], {
          loadedAt: runAt,
          startTesting: true,
          startingBalance: scheduledFactoryArenaStartingBalance,
          maxBet: scheduledFactoryArenaMaxBet,
          allowRepeatBuys: false,
        });
      }

      if (topTradersArenaRef.current.status === "running") {
        topTradersRosterRefreshAtRef.current = 0;
        topTradersEngineCursorRef.current = 0;
      } else {
        playTopTraders({
          startingBalance: scheduledTopTradersStartingBalance,
          maxBet: scheduledTopTradersMaxBet,
          reset: false,
        });
      }

      const decision = automationDecision(
        runAt,
        "promote",
        "positive",
        `Factory ${slot.label} batch running`,
        `${existingBatch ? "Reused" : "Created"} ${batch.name} with ${batch.algos.length.toLocaleString()} algos, loaded it into Arena testing, and queued Top Traders roster rotation.`,
      );
      setFactoryAutomation((current) => {
        const next = {
          ...current,
          lastRunAt: runAt,
          lastScheduledBatchSlot: slot.id,
          lastScheduledBatchAt: slot.scheduledAt,
          decisions: mergeAutomationDecisions([decision], current.decisions),
        };
        factoryAutomationRef.current = next;
        return next;
      });
    };

    const firstRun = window.setTimeout(runScheduledFactoryBatch, 0);
    const id = window.setInterval(runScheduledFactoryBatch, factoryBatchScheduleCheckMs);
    return () => {
      active = false;
      window.clearTimeout(firstRun);
      window.clearInterval(id);
    };
  }, [appStateBackupReady, createFactoryBatchFromCurrentEvidence, factoryAutomation.enabled]);

  const pushActivatedAlgoToLive = (archive: GeneratedPaperAlgoArchive) => {
    const promotedAt = new Date().toISOString();
    setGeneratedPaperAlgos((current) => {
      const exists = current.some((algo) => algo.sourceAlgoId === archive.sourceAlgoId || algo.id === archive.activationId);
      if (exists) return current;
      const algo: GeneratedPaperAlgo = {
        id: generatedActivationId(archive.sourceAlgoId, promotedAt),
        displayId: nextGeneratedPaperDisplayId(archive.family, archive.name, archive.sourceAlgoId, current, generatedPaperAlgoArchives),
        sourceAlgoId: archive.sourceAlgoId,
        name: archive.name,
        family: archive.family,
        params: archive.params,
        enabled: true,
        promotedAt,
        sourceRunId: archive.sourceRunId,
        sourceMetrics: {
          closed: archive.liveStats.sells,
          wins: archive.liveStats.wins,
          losses: archive.liveStats.losses,
          totalPnl: archive.liveStats.totalPnl,
          totalCost: archive.liveStats.totalCost,
          roi: archive.liveStats.roi ?? 0,
          maxDrawdown: archive.sourceMetrics.maxDrawdown,
        },
      };
      return normalizeGeneratedPaperAlgos([algo, ...current]);
    });
  };

  useEffect(() => {
    if (!factoryAutomation.enabled) return;
    const now = new Date().toISOString();
    const currentPaperState = paperStateRef.current;
    const plan = buildFactoryAutomationPlan({
      archives: generatedPaperAlgoArchives,
      generatedPaperAlgos,
      learningReport,
      paperState: currentPaperState,
      sweep: latestSweep,
      now,
    });
    const signature = factoryAutomationPlanSignature(latestSweep?.runId ?? null, plan);
    if (signature === factoryAutomationSignatureRef.current) return;
    factoryAutomationSignatureRef.current = signature;
    if (plan.decisions.length === 0) return;

    const updateId = window.setTimeout(() => {
      if (plan.demoteIds.length > 0) {
        const demoteSet = new Set(plan.demoteIds);
        const archivesToAdd = generatedPaperAlgos
          .filter((algo) => algo.enabled && demoteSet.has(algo.id))
          .map((algo) => archiveGeneratedPaperAlgo(algo, currentPaperState, now));
        setGeneratedPaperAlgoArchives((current) => normalizeGeneratedPaperAlgoArchives([...archivesToAdd, ...current]));
        setGeneratedPaperAlgos((current) => normalizeGeneratedPaperAlgos(current.map((algo) => (
          demoteSet.has(algo.id) ? { ...algo, enabled: false } : algo
        ))));
      }

      if (plan.promotions.length > 0 && latestSweep) {
        setGeneratedPaperAlgos((current) => {
          const promoted = plan.promotions.map((candidate) => generatedPaperAlgoFromCandidate(
            candidate,
            latestSweep.runId,
            now,
            nextGeneratedPaperDisplayId(candidate.family, candidate.algoName, candidate.algoId, current, generatedPaperAlgoArchives),
          ));
          return normalizeGeneratedPaperAlgos([...promoted, ...current]);
        });
      }

      setFactoryAutomation((current) => ({
        ...current,
        lastRunAt: now,
        promotedCount: current.promotedCount + plan.promotions.length,
        demotedCount: current.demotedCount + plan.demoteIds.length,
        decisions: mergeAutomationDecisions(plan.decisions, current.decisions),
      }));
    }, 0);
    return () => window.clearTimeout(updateId);
  }, [factoryAutomation.enabled, generatedPaperAlgoArchives, generatedPaperAlgos, latestSweep, learningReport]);

  useEffect(() => {
    if (!autoRefresh) return undefined;
    const id = window.setInterval(() => setClock(new Date()), uiClockRefreshMs);
    return () => window.clearInterval(id);
  }, [autoRefresh]);

  useEffect(() => {
    let active = true;
    let currentVersion: string | null = null;
    let reloadQueued = false;

    const checkForHostedUpdate = async () => {
      try {
        const response = await fetch(`/version.json?check=${Date.now()}`, { cache: "no-store" });
        const payload = await response.json() as { version?: string };
        if (!active || !payload.version) return;
        if (currentVersion === null) {
          currentVersion = payload.version;
          setUpdateState("current");
          return;
        }
        if (payload.version !== currentVersion && !reloadQueued) {
          if (isLiveRunnerActive()) {
            currentVersion = payload.version;
            setUpdateState("current");
            return;
          }
          reloadQueued = true;
          setUpdateState("reloading");
          window.setTimeout(() => window.location.reload(), 2000);
        }
      } catch {
        if (active) setUpdateState("current");
      }
    };

    void checkForHostedUpdate();
    const id = window.setInterval(checkForHostedUpdate, 5_000);
    return () => {
      active = false;
      window.clearInterval(id);
    };
  }, []);

  return (
    <div className="app-shell">
      <Sidebar activeView={visibleActiveView} onSelect={selectView} routerStatus={liveOrderRouterStatus} snapshot={snapshot} />
      <main className="workspace">
        <Topbar snapshot={snapshot} autoRefresh={autoRefresh} updateState={updateState} routerStatus={liveOrderRouterStatus} onToggleRefresh={() => setAutoRefresh((value) => !value)} />
        <div className="main-live-shell" hidden={visibleActiveView !== "Now"}>
          <NowView
            snapshot={snapshot}
          />
          <LiveTradingView
            activatedDataClearToken={activatedDataClearToken}
            favoriteSourceIds={favoriteAlgoSourceIds}
            generatedPaperAlgos={factoryBatchUserAlgos(generatedPaperAlgos)}
            lookupPaperAlgos={topTraderCandidateAlgos}
            kalshiPortfolio={kalshiPortfolio}
            onSetDryRunMode={setLiveDryRunMode}
            onSetLiveSwitch={setLiveTradingSwitch}
            onRunnerStatusChange={handleLiveRunnerStatusChange}
            onToggleFavorite={toggleFavoriteAlgoSourceId}
            routerStatus={liveOrderRouterStatus}
            snapshot={snapshot}
            topTradersExecutable={topTradersExecutable}
            topTraderRows={liveTopTraderRows}
          />
        </div>
        {visibleActiveView === "Factory" && (
          <FactoryArenaView
            arena={paperArena}
            arenaArchives={realisticArenaAlgoArchives}
            asOf={clock.toISOString()}
            factoryAlgoBatches={factoryAlgoBatches}
            generatedPaperAlgos={generatedPaperAlgos}
            latestSweep={latestSweep}
            onGenerateFactoryBatch={generateFactoryBatch}
            onLoadFactoryBatch={loadFactoryBatchIntoArena}
            onLoadFactoryBatches={loadFactoryBatchesIntoArena}
            onPause={pausePaperArena}
            onPlay={playPaperArena}
            onReset={resetPaperArena}
            savedTradeSummaries={savedTradeSummaries}
          />
        )}
        {visibleActiveView === "Activated Algos" && (
          <ActivatedAlgosView
            arena={paperArena}
            arenaAlgos={visibleArenaAlgos}
            arenaArchives={realisticArenaAlgoArchives}
            onClearActivatedData={clearActivatedAlgoData}
            onPushToLive={pushActivatedAlgoToLive}
          />
        )}
        {visibleActiveView === "Top Traders" && (
          <TopTradersView
            arena={topTradersArena}
            arenaArchives={realisticArenaAlgoArchives}
            asOf={clock.toISOString()}
            candidateAlgos={topTraderCandidateAlgos}
            executableState={topTradersExecutable}
            favoriteSourceIds={favoriteAlgoSourceIds}
            latestSweep={latestSweep}
            mainArena={paperArena}
            mainArenaAlgos={visibleArenaAlgos}
            onPause={pauseTopTraders}
            onPlay={playTopTraders}
            onReset={resetTopTraders}
            onToggleFavorite={toggleFavoriteAlgoSourceId}
            savedTradeSummaries={savedTradeSummaries}
          />
        )}
        {visibleActiveView === "Account" && <AccountSettingsView snapshot={snapshot} kalshiPortfolio={kalshiPortfolio} routerStatus={liveOrderRouterStatus} />}
      </main>
    </div>
  );
}

function paperInputFromSnapshot(snapshot: RuntimeSnapshot, orderFlowHistory?: OrderFlowInputHistory): PaperEngineInput {
  const observedAt = snapshot.kalshi.fetchedAt ?? snapshot.orderBook.observedAt ?? snapshot.generatedAt;
  const current: OrderFlowInputSample = {
    ticker: snapshot.kalshi.market?.ticker ?? null,
    observedAt,
    yesAsk: snapshot.yesPrice,
    noAsk: snapshot.noPrice,
    yesBid: snapshot.orderBook.yesBids[0]?.price ?? null,
    noBid: snapshot.orderBook.noBids[0]?.price ?? null,
    yesAskDepth: snapshot.orderBook.yesAsks[0]?.size ?? null,
    noAskDepth: snapshot.orderBook.noAsks[0]?.size ?? null,
    yesBidDepth: snapshot.orderBook.yesBids[0]?.size ?? null,
    noBidDepth: snapshot.orderBook.noBids[0]?.size ?? null,
  };
  const previous = orderFlowHistory?.current ?? null;
  const canCompare = previous !== null && previous.ticker === current.ticker && previous.observedAt !== current.observedAt;
  if (orderFlowHistory && (!previous || previous.observedAt !== current.observedAt || previous.ticker !== current.ticker)) {
    orderFlowHistory.current = current;
  }
  const delta = (key: keyof Omit<OrderFlowInputSample, "ticker" | "observedAt">) => (
    canCompare && current[key] !== null && previous[key] !== null ? roundDisplayRatio((current[key] ?? 0) - (previous[key] ?? 0)) : 0
  );
  return {
    observedAt,
    marketLive: snapshot.kalshi.status === "live" && snapshot.kalshi.market !== null,
    ticker: current.ticker,
    title: snapshot.kalshi.market?.title ?? snapshot.marketLabel,
    targetPrice: snapshot.targetPrice,
    estimate: snapshot.settlement.estimate,
    spotPrice: snapshot.price,
    oneMinuteChange: snapshot.oneMinuteChange,
    fairProbability: snapshot.decision.fairProbability,
    action: snapshot.decision.action,
    confidence: snapshot.decision.confidence,
    edgeAfterFees: snapshot.decision.edgeAfterFees,
    sizeContracts: snapshot.decision.sizeContracts,
    secondsToClose: snapshot.secondsToClose,
    finalMinuteAverageSoFar: snapshot.settlement.averageSoFar,
    finalMinuteCompletedSeconds: snapshot.settlement.completedSeconds,
    finalMinuteRemainingSeconds: snapshot.settlement.remainingSeconds,
    requiredRemainingAverageForYes: snapshot.settlement.requiredRemainingAverageForYes,
    settlementCouldStillFlip: snapshot.settlement.couldStillFlip,
    settlementConfidence: snapshot.settlement.confidence,
    yesAsk: current.yesAsk,
    noAsk: current.noAsk,
    yesBid: current.yesBid,
    noBid: current.noBid,
    yesAskDepth: current.yesAskDepth,
    noAskDepth: current.noAskDepth,
    yesBidDepth: current.yesBidDepth,
    noBidDepth: current.noBidDepth,
    yesAskDepthDelta: delta("yesAskDepth"),
    noAskDepthDelta: delta("noAskDepth"),
    yesBidDepthDelta: delta("yesBidDepth"),
    noBidDepthDelta: delta("noBidDepth"),
    yesAskPriceDelta: delta("yesAsk"),
    noAskPriceDelta: delta("noAsk"),
    yesBidPriceDelta: delta("yesBid"),
    noBidPriceDelta: delta("noBid"),
  };
}

function advancePaperArena(
  current: PaperArenaState,
  input: PaperEngineInput,
  generatedPaperAlgos: GeneratedPaperAlgo[],
  options: { preserveSelection?: boolean } = {},
): PaperArenaState {
  const pausedForCashWithOpenTrades = current.status === "paused" && (() => {
    const currentMetrics = paperArenaMetrics(current);
    return currentMetrics.available <= 0 && currentMetrics.open > 0;
  })();
  if (current.status !== "running" && !pausedForCashWithOpenTrades) return current;
  const selectedAlgoIds = current.selectedAlgoIds.length > 0
    ? current.selectedAlgoIds
    : current.selectedAlgoId ? [current.selectedAlgoId] : [];
  const selectedIdSet = new Set(selectedAlgoIds.slice(0, arenaBatchMax));
  const selectedAlgos = generatedPaperAlgos.filter((algo) => selectedIdSet.has(algo.id)).slice(0, arenaBatchMax);
  if (selectedAlgos.length === 0) return current;
  const nextPaperState = advancePaperStrategies(
    current.paperState,
    input,
    disabledPaperStrategies,
    defaultPaperAlgoUpgrades,
    selectedAlgos.map((algo) => ({ ...algo, enabled: true })),
    {
      startingBalance: current.startingBalance,
      maxCostPerTrade: current.maxBet,
      stakeMode: "max-cost",
      executionMode: "executable",
      feeRate: 0.07,
      maxEntrySpread: 0.02,
      minEdgeAfterFees: 0.08,
      maxDepthShare: 0.25,
      minExitDepthContracts: 1,
      maxEntriesPerMarket: current.allowRepeatBuys ? 10 : 1,
      allowMultipleOpenEntriesPerMarket: current.allowRepeatBuys,
      accountScope: "strategy",
      blockReentryAfterLoss: false,
    },
  );
  if (nextPaperState === current.paperState) {
    return pausedForCashWithOpenTrades ? { ...current, status: "running", stoppedAt: null } : current;
  }
  const nextArena = {
    ...current,
    status: "running" as const,
    stoppedAt: null,
    selectedAlgoId: options.preserveSelection ? current.selectedAlgoId : selectedAlgos[0]?.id ?? null,
    selectedAlgoIds: options.preserveSelection ? current.selectedAlgoIds : selectedAlgos.map((algo) => algo.id),
    paperState: nextPaperState,
  };
  return nextArena;
}

function loadPaperState(): PaperState {
  if (typeof window === "undefined") return emptyPaperState;
  try {
    const storedState = window.localStorage.getItem(paperStorageKey) ?? window.localStorage.getItem(legacyPaperStorageKey);
    return normalizePaperState(JSON.parse(storedState ?? "null"));
  } catch {
    return emptyPaperState;
  }
}

function saveLearningState(state: LearningState) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(learningStorageKey, JSON.stringify(state));
  } catch {
    // Ignore private-mode or storage quota failures; the in-memory lab still runs.
  }
}

function savePaperState(state: PaperState) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(paperStorageKey, JSON.stringify(state));
  } catch {
    // Ignore private-mode or storage quota failures; the in-memory session still runs.
  }
}

function loadEnabledPaperStrategies(): EnabledPaperStrategies {
  if (typeof window === "undefined") return defaultPaperStrategies;
  try {
    return normalizeEnabledStrategies(JSON.parse(window.localStorage.getItem(paperStrategyStorageKey) ?? "null"));
  } catch {
    return defaultPaperStrategies;
  }
}

function loadGeneratedPaperAlgos(): GeneratedPaperAlgo[] {
  if (typeof window === "undefined") return [];
  try {
    return filterFactoryBatchGeneratedAlgos(normalizeGeneratedPaperAlgos(JSON.parse(window.localStorage.getItem(generatedPaperAlgoStorageKey) ?? "null")));
  } catch {
    return [];
  }
}

function loadGeneratedPaperAlgoArchives(): GeneratedPaperAlgoArchive[] {
  if (typeof window === "undefined") return [];
  try {
    return normalizeGeneratedPaperAlgoArchives(JSON.parse(window.localStorage.getItem(generatedPaperAlgoArchiveStorageKey) ?? "null"));
  } catch {
    return [];
  }
}

function loadRealisticArenaAlgoArchives(): GeneratedPaperAlgoArchive[] {
  if (typeof window === "undefined") return [];
  try {
    return normalizeGeneratedPaperAlgoArchives(JSON.parse(window.localStorage.getItem(realisticArenaAlgoArchiveStorageKey) ?? "null"));
  } catch {
    return [];
  }
}

function loadFactoryAlgoBatches(): FactoryAlgoBatch[] {
  if (typeof window === "undefined") return [];
  try {
    return normalizeFactoryAlgoBatches(JSON.parse(window.localStorage.getItem(factoryAlgoBatchStorageKey) ?? "null"));
  } catch {
    return [];
  }
}

function loadFactoryAutomationState(): FactoryAutomationState {
  if (typeof window === "undefined") return defaultFactoryAutomationState();
  try {
    return normalizeFactoryAutomationState(JSON.parse(window.localStorage.getItem(factoryAutomationStorageKey) ?? "null"));
  } catch {
    return defaultFactoryAutomationState();
  }
}

function loadPaperArenaState(): PaperArenaState {
  if (typeof window === "undefined") return defaultPaperArenaState();
  try {
    return normalizePaperArenaState(JSON.parse(window.localStorage.getItem(paperArenaStorageKey) ?? "null"));
  } catch {
    return defaultPaperArenaState();
  }
}

function loadTopTradersArenaState(): PaperArenaState {
  if (typeof window === "undefined") return defaultPaperArenaState();
  try {
    return normalizePaperArenaState(JSON.parse(window.localStorage.getItem(topTradersArenaStorageKey) ?? "null"));
  } catch {
    return defaultPaperArenaState();
  }
}

function saveEnabledPaperStrategies(strategies: EnabledPaperStrategies) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(paperStrategyStorageKey, JSON.stringify(strategies));
  } catch {
    // Ignore storage failures; toggles keep working for the current session.
  }
}

function saveGeneratedPaperAlgos(algos: GeneratedPaperAlgo[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(generatedPaperAlgoStorageKey, JSON.stringify(filterFactoryBatchGeneratedAlgos(normalizeGeneratedPaperAlgos(algos))));
  } catch {
    // Ignore storage failures; generated paper algos keep working for the current session.
  }
}

function saveGeneratedPaperAlgoArchives(archives: GeneratedPaperAlgoArchive[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(generatedPaperAlgoArchiveStorageKey, JSON.stringify(normalizeGeneratedPaperAlgoArchives(archives)));
  } catch {
    // Ignore storage failures; past activation stats remain in memory for this session.
  }
}

function saveRealisticArenaAlgoArchives(archives: GeneratedPaperAlgoArchive[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(realisticArenaAlgoArchiveStorageKey, JSON.stringify(normalizeGeneratedPaperAlgoArchives(archives)));
  } catch {
    // Ignore storage failures; realistic arena history remains in memory for this session.
  }
}

function saveFactoryAlgoBatches(batches: FactoryAlgoBatch[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(factoryAlgoBatchStorageKey, JSON.stringify(normalizeFactoryAlgoBatches(batches.filter(isSingleLetterFactoryBatch))));
  } catch {
    // Ignore storage failures; generated batches remain in memory for this session.
  }
}

function saveFactoryAutomationState(state: FactoryAutomationState) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(factoryAutomationStorageKey, JSON.stringify(normalizeFactoryAutomationState(state)));
  } catch {
    // Ignore storage failures; automation keeps working for the current session.
  }
}

function savePaperArenaState(state: PaperArenaState) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(paperArenaStorageKey, JSON.stringify(normalizePaperArenaState(state)));
  } catch {
    // Ignore storage failures; the arena keeps running for the current session.
  }
}

function saveTopTradersArenaState(state: PaperArenaState) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(topTradersArenaStorageKey, JSON.stringify(normalizePaperArenaState(state)));
  } catch {
    // Ignore storage failures; the top-trader runner keeps working for the current session.
  }
}

function loadLiveExecutionLog(): LiveExecutionLogEntry[] {
  if (typeof window === "undefined") return [];
  try {
    return normalizeLiveExecutionLog(JSON.parse(window.localStorage.getItem(liveExecutionLogStorageKey) ?? "null"));
  } catch {
    return [];
  }
}

function saveLiveExecutionLog(log: LiveExecutionLogEntry[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(liveExecutionLogStorageKey, JSON.stringify(normalizeLiveExecutionLog(log)));
  } catch {
    // Ignore storage failures; the live ticker keeps working for the current session.
  }
}

function loadLiveManagedPositions(): LiveManagedPosition[] {
  if (typeof window === "undefined") return [];
  try {
    return normalizeLiveManagedPositions(JSON.parse(window.localStorage.getItem(liveManagedPositionsStorageKey) ?? "null"));
  } catch {
    return [];
  }
}

function saveLiveManagedPositions(positions: LiveManagedPosition[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(liveManagedPositionsStorageKey, JSON.stringify(normalizeLiveManagedPositions(positions)));
  } catch {
    // Ignore storage failures; the in-memory live position ledger still works for the current session.
  }
}

function loadTopTradersExecutableState(): TopTraderExecutableState {
  if (typeof window === "undefined") return defaultTopTradersExecutableState();
  try {
    return normalizeTopTradersExecutableState(JSON.parse(window.localStorage.getItem(topTradersExecutableStorageKey) ?? "null"));
  } catch {
    return defaultTopTradersExecutableState();
  }
}

function saveTopTradersExecutableState(state: TopTraderExecutableState) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(topTradersExecutableStorageKey, JSON.stringify(normalizeTopTradersExecutableState(state)));
  } catch {
    // Ignore storage failures; executable top-trader stats remain in memory for this session.
  }
}

function loadLiveRunnerState(): LiveRunnerState {
  if (typeof window === "undefined") return defaultLiveRunnerState();
  try {
    return normalizeLiveRunnerState(JSON.parse(window.localStorage.getItem(liveRunnerStorageKey) ?? "null"));
  } catch {
    return defaultLiveRunnerState();
  }
}

function saveLiveRunnerState(state: LiveRunnerState) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(liveRunnerStorageKey, JSON.stringify(normalizeLiveRunnerState(state)));
  } catch {
    // Ignore storage failures; the live runner keeps working for the current session.
  }
}

function loadFavoriteAlgoSourceIds() {
  if (typeof window === "undefined") return [];
  try {
    return normalizeFavoriteAlgoSourceIds(JSON.parse(window.localStorage.getItem(favoriteAlgoStorageKey) ?? "null"));
  } catch {
    return [];
  }
}

function saveFavoriteAlgoSourceIds(sourceAlgoIds: string[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(favoriteAlgoStorageKey, JSON.stringify(normalizeFavoriteAlgoSourceIds(sourceAlgoIds)));
  } catch {
    // Ignore storage failures; favorites keep working for the current session.
  }
}

function isLiveRunnerActive() {
  return loadLiveRunnerState().status === "running";
}

function useCoinbaseDogeFeed() {
  const [market, setMarket] = useState<LiveMarketData>(() => emptyMarket("connecting"));
  const reconnectAttempt = useRef(0);

  useEffect(() => {
    let active = true;
    let socket: WebSocket | null = null;
    let reconnectId: number | undefined;

    const loadRestSnapshot = async () => {
      try {
        const [tickerResponse, bookResponse, candleResponse] = await Promise.all([
          fetch(`${coinbaseRestBase}/products/${coinbaseProductId}/ticker`, { cache: "no-store" }),
          fetch(`${coinbaseRestBase}/products/${coinbaseProductId}/book?level=1`, { cache: "no-store" }),
          fetch(`${coinbaseRestBase}/products/${coinbaseProductId}/candles?granularity=60`, { cache: "no-store" }),
        ]);
        if (!active) return;
        if (!tickerResponse.ok || !bookResponse.ok || !candleResponse.ok) {
          throw new Error("Coinbase REST snapshot failed");
        }
        const ticker = await tickerResponse.json() as CoinbaseRestTicker;
        const book = await bookResponse.json() as CoinbaseBook;
        const candles = await candleResponse.json() as CoinbaseCandle[];
        const receivedAt = new Date().toISOString();
        setMarket((current) => applyRestSnapshot(current, ticker, book, candles, receivedAt));
      } catch (error) {
        if (!active) return;
        setMarket((current) => ({
          ...current,
          status: current.price ? "stale" : "error",
          error: error instanceof Error ? error.message : "Coinbase REST snapshot failed",
        }));
      }
    };

    const connect = () => {
      socket = new WebSocket(coinbaseWsUrl);
      socket.addEventListener("open", () => {
        reconnectAttempt.current = 0;
        socket?.send(JSON.stringify({
          type: "subscribe",
          product_ids: [coinbaseProductId],
          channels: ["ticker", "heartbeat"],
        }));
      });
      socket.addEventListener("message", (event) => {
        try {
          const payload = JSON.parse(String(event.data)) as CoinbaseWsMessage;
          if (!active) return;
          if (payload.type === "ticker" && payload.product_id === coinbaseProductId) {
            setMarket((current) => applyTickerMessage(current, payload, new Date()));
          }
          if (payload.type === "heartbeat" && payload.product_id === coinbaseProductId) {
            setMarket((current) => current.status === "connecting" ? { ...current, status: "rest" } : current);
          }
        } catch {
          setMarket((current) => ({ ...current, status: current.price ? "stale" : "error", error: "Coinbase WebSocket payload parse failed" }));
        }
      });
      socket.addEventListener("error", () => {
        if (!active) return;
        setMarket((current) => ({ ...current, status: current.price ? "stale" : "error", error: "Coinbase WebSocket error" }));
      });
      socket.addEventListener("close", () => {
        if (!active) return;
        setMarket((current) => ({ ...current, status: current.price ? "stale" : "connecting" }));
        reconnectAttempt.current += 1;
        const delay = Math.min(12_000, 1_500 * reconnectAttempt.current);
        reconnectId = window.setTimeout(connect, delay);
      });
    };

    void loadRestSnapshot();
    const connectId = window.setTimeout(connect, 100);
    const restId = window.setInterval(loadRestSnapshot, 60_000);

    return () => {
      active = false;
      window.clearInterval(restId);
      if (connectId) window.clearTimeout(connectId);
      if (reconnectId) window.clearTimeout(reconnectId);
      if (socket?.readyState === WebSocket.OPEN) socket.close();
    };
  }, []);

  return market;
}

function useKalshiDogeMarket() {
  const [market, setMarket] = useState<KalshiMarketData>(() => emptyKalshiMarket);

  useEffect(() => {
    let active = true;

    const loadMarket = async () => {
      try {
        const response = await fetch(localApiUrl(`/api/kalshi/doge-market?ts=${Date.now()}`), { cache: "no-store" });
        const payload = await response.json() as unknown;
        if (!active) return;
        setMarket((current) => normalizeKalshiMarketPayload(response.ok ? payload : { status: "error", ...(typeof payload === "object" && payload !== null ? payload : {}) }, current));
      } catch (error) {
        if (!active) return;
        setMarket((current) => normalizeKalshiMarketPayload({
          status: "error",
          error: error instanceof Error ? error.message : "Kalshi market fetch failed",
          fetchedAt: new Date().toISOString(),
        }, current));
      }
    };

    void loadMarket();
    const id = window.setInterval(loadMarket, 2_000);
    return () => {
      active = false;
      window.clearInterval(id);
    };
  }, []);

  return market;
}

function useKalshiPortfolioSummary(ticker: string | null) {
  const [portfolio, setPortfolio] = useState<KalshiPortfolioSummary>(() => emptyKalshiPortfolio);

  useEffect(() => {
    let active = true;

    const loadPortfolio = async () => {
      try {
        const query = ticker ? `?ticker=${encodeURIComponent(ticker)}&ts=${Date.now()}` : `?ts=${Date.now()}`;
        const response = await fetch(localApiUrl(`/api/kalshi/portfolio${query}`), { cache: "no-store" });
        const payload = await response.json() as unknown;
        if (!active) return;
        setPortfolio((current) => normalizeKalshiPortfolioPayload(response.ok ? payload : { status: "error", configured: current.configured, ...(typeof payload === "object" && payload !== null ? payload : {}) }, current));
      } catch (error) {
        if (!active) return;
        setPortfolio((current) => normalizeKalshiPortfolioPayload({
          configured: current.configured,
          status: "error",
          error: error instanceof Error ? error.message : "Kalshi portfolio fetch failed",
          fetchedAt: new Date().toISOString(),
        }, current));
      }
    };

    void loadPortfolio();
    const id = window.setInterval(loadPortfolio, 15_000);
    return () => {
      active = false;
      window.clearInterval(id);
    };
  }, [ticker]);

  return portfolio;
}

function useKalshiOrderRouterStatus() {
  const [status, setStatus] = useState<LiveOrderRouterStatus>(() => defaultLiveOrderRouterStatus());

  const loadStatus = useCallback(async () => {
    try {
      const response = await fetch(localApiUrl(`/api/kalshi/order-router?ts=${Date.now()}`), { cache: "no-store" });
      const payload = await response.json() as unknown;
      const next = normalizeLiveOrderRouterStatus(response.ok ? payload : { state: "error", ...(typeof payload === "object" && payload !== null ? payload : {}) });
      setStatus(next);
      return next;
    } catch (error) {
      const nextError = error instanceof Error ? error.message : "Kalshi order router status failed";
      setStatus((current) => ({
        ...current,
        state: "error",
        error: nextError,
      }));
      throw error;
    }
  }, []);

  const setLiveSwitch = useCallback(async (enabled: boolean) => {
    const response = await fetch(localApiUrl("/api/kalshi/live-switch"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
      cache: "no-store",
    });
    const payload = await response.json() as unknown;
    const routerPayload = isRecord(payload) && isRecord(payload.routerStatus) ? payload.routerStatus : payload;
    const next = normalizeLiveOrderRouterStatus(response.ok ? routerPayload : { state: "error", ...(isRecord(routerPayload) ? routerPayload : {}) });
    setStatus(next);
    return next;
  }, []);

  const setDryRunMode = useCallback(async (dryRun: boolean) => {
    const response = await fetch(localApiUrl("/api/kalshi/live-switch"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dryRun }),
      cache: "no-store",
    });
    const payload = await response.json() as unknown;
    const routerPayload = isRecord(payload) && isRecord(payload.routerStatus) ? payload.routerStatus : payload;
    const next = normalizeLiveOrderRouterStatus(response.ok ? routerPayload : { state: "error", ...(isRecord(routerPayload) ? routerPayload : {}) });
    setStatus(next);
    return next;
  }, []);

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const next = await loadStatus();
        if (!active) return;
        setStatus(next);
      } catch {
        // loadStatus already moved the hook into an error state.
      }
    };
    const initialId = window.setTimeout(refresh, 0);
    const id = window.setInterval(refresh, 5_000);
    return () => {
      active = false;
      window.clearTimeout(initialId);
      window.clearInterval(id);
    };
  }, [loadStatus]);

  return { refresh: loadStatus, setDryRunMode, setLiveSwitch, status };
}

type CoinbaseRestTicker = {
  price?: string;
  bid?: string;
  ask?: string;
  volume?: string;
  time?: string;
};

type CoinbaseBook = {
  bids?: Array<[string, string, number]>;
  asks?: Array<[string, string, number]>;
};

type CoinbaseCandle = [number, number, number, number, number, number];

type CoinbaseWsMessage = {
  type?: string;
  product_id?: string;
  price?: string;
  best_bid?: string;
  best_ask?: string;
  best_bid_size?: string;
  best_ask_size?: string;
  open_24h?: string;
  high_24h?: string;
  low_24h?: string;
  volume_24h?: string;
  time?: string;
};

function emptyMarket(status: MarketFeedStatus): LiveMarketData {
  return {
    status,
    sourceLabel: "Coinbase Exchange",
    productId: coinbaseProductId,
    price: null,
    bid: null,
    ask: null,
    bidSize: null,
    askSize: null,
    open24h: null,
    high24h: null,
    low24h: null,
    volume24h: null,
    lastTradeAt: null,
    receivedAt: null,
    latencyMs: null,
    candles: [],
    samples: [],
    error: null,
  };
}

function applyRestSnapshot(current: LiveMarketData, ticker: CoinbaseRestTicker, book: CoinbaseBook, candles: CoinbaseCandle[], receivedAt: string): LiveMarketData {
  const price = numeric(ticker.price) ?? current.price;
  const bid = numeric(ticker.bid) ?? numeric(book.bids?.[0]?.[0]) ?? current.bid;
  const ask = numeric(ticker.ask) ?? numeric(book.asks?.[0]?.[0]) ?? current.ask;
  const observedAt = ticker.time ?? receivedAt;
  const sample = price === null ? [] : [{
    observedAt,
    price,
    source: "coinbase:doge-usd",
    latencyMs: latencyFromIso(observedAt, receivedAt),
  }];

  return {
    ...current,
    status: current.status === "live" ? "live" : "rest",
    sourceLabel: "Coinbase Exchange",
    productId: coinbaseProductId,
    price,
    bid,
    ask,
    bidSize: numeric(book.bids?.[0]?.[1]) ?? current.bidSize,
    askSize: numeric(book.asks?.[0]?.[1]) ?? current.askSize,
    volume24h: numeric(ticker.volume) ?? current.volume24h,
    lastTradeAt: observedAt,
    receivedAt,
    latencyMs: latencyFromIso(observedAt, receivedAt),
    candles: normalizeCoinbaseCandles(candles),
    samples: [...current.samples, ...sample].slice(-240),
    error: null,
  };
}

function applyTickerMessage(current: LiveMarketData, payload: CoinbaseWsMessage, receivedAtDate: Date): LiveMarketData {
  const receivedAt = receivedAtDate.toISOString();
  const observedAt = payload.time ?? receivedAt;
  const price = numeric(payload.price) ?? current.price;
  const nextCandles = price === null ? current.candles : mergeTickCandle(current.candles, price, observedAt);
  const sample = price === null ? [] : [{
    observedAt,
    price,
    source: "coinbase:doge-usd",
    latencyMs: latencyFromIso(observedAt, receivedAt),
  }];

  return {
    ...current,
    status: "live",
    sourceLabel: "Coinbase Exchange",
    productId: coinbaseProductId,
    price,
    bid: numeric(payload.best_bid) ?? current.bid,
    ask: numeric(payload.best_ask) ?? current.ask,
    bidSize: numeric(payload.best_bid_size) ?? current.bidSize,
    askSize: numeric(payload.best_ask_size) ?? current.askSize,
    open24h: numeric(payload.open_24h) ?? current.open24h,
    high24h: numeric(payload.high_24h) ?? current.high24h,
    low24h: numeric(payload.low_24h) ?? current.low24h,
    volume24h: numeric(payload.volume_24h) ?? current.volume24h,
    lastTradeAt: observedAt,
    receivedAt,
    latencyMs: latencyFromIso(observedAt, receivedAt),
    candles: nextCandles,
    samples: [...current.samples, ...sample].slice(-240),
    error: null,
  };
}

function normalizeCoinbaseCandles(rows: CoinbaseCandle[], limit = 300): Candle[] {
  return rows
    .map(([time, low, high, open, close, volume]) => ({
      time: new Date(time * 1000).toISOString(),
      open,
      high,
      low,
      close,
      volume,
    }))
    .sort((a, b) => Date.parse(a.time) - Date.parse(b.time))
    .slice(-limit);
}

function mergeTickCandle(candles: Candle[], price: number, observedAt: string): Candle[] {
  const minuteStart = Math.floor(Date.parse(observedAt) / 60_000) * 60_000;
  const time = new Date(minuteStart).toISOString();
  const latest = candles.at(-1);
  if (!latest || latest.time !== time) {
    return [...candles, { time, open: latest?.close ?? price, high: price, low: price, close: price, volume: 0 }].slice(-300);
  }
  return candles.slice(0, -1).concat({
    ...latest,
    high: Math.max(latest.high, price),
    low: Math.min(latest.low, price),
    close: price,
  });
}

function numeric(value: string | number | undefined) {
  if (value === undefined) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function latencyFromIso(observedAt: string, receivedAt: string) {
  const latency = Date.parse(receivedAt) - Date.parse(observedAt);
  return Number.isFinite(latency) ? Math.max(0, latency) : 0;
}

function Sidebar({
  activeView,
  onSelect,
  routerStatus,
  snapshot,
}: {
  activeView: NavItem;
  onSelect: (view: NavItem) => void;
  routerStatus: LiveOrderRouterStatus;
  snapshot: RuntimeSnapshot;
}) {
  return (
    <aside className="sidebar">
      <div className="brand-row">
        <div className="brand-mark" aria-hidden="true">
          <img src={dogeEdgeLogo} alt="" />
        </div>
        <div>
          <strong>DogeEdge</strong>
          <span>LOCAL</span>
        </div>
      </div>

      <nav className="nav-list" aria-label="Primary">
        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.label}
              className={item.label === activeView ? "nav-button active" : "nav-button"}
              type="button"
              onClick={() => onSelect(item.label)}
            >
              <Icon size={19} />
              <span>{item.label}</span>
              {item.badge && <small>{item.badge}</small>}
            </button>
          );
        })}
      </nav>

      <div className="system-card">
        <div className="card-title">System Health <span className="dot ok" /></div>
        <HealthLine label="DOGE spot" value={feedStatusLabel(snapshot.feed.status)} ok={snapshot.feed.status === "live" || snapshot.feed.status === "rest"} />
        <HealthLine label="Feed latency" value={formatLatency(snapshot.feed.latencyMs)} ok={snapshot.feed.status === "live"} />
        <HealthLine label="Kalshi API" value={kalshiStatusLabel(snapshot.kalshi.status)} ok={snapshot.kalshi.status === "live" || snapshot.kalshi.status === "stale"} />
        <HealthLine label="Order router" value={orderRouterLabel(routerStatus)} ok={routerStatus.dryRun || (routerStatus.configured && (routerStatus.liveEnabled || routerStatus.sellExitsEnabled))} />
        <HealthLine label="CF RTI" value={snapshot.kalshi.market ? "Rules ref" : "Pending"} />
      </div>

      <div className="version-row">
        <span>v0.1.0</span>
        <ChevronDown size={15} />
      </div>
    </aside>
  );
}

function HealthLine({ label, value, ok = false }: { label: string; value: string; ok?: boolean }) {
  return (
    <div className="health-line">
      <span>{label}</span>
      <strong className={ok ? "positive" : "muted"}>{value}</strong>
    </div>
  );
}

function Topbar({
  snapshot,
  autoRefresh,
  updateState,
  routerStatus,
  onToggleRefresh,
}: {
  snapshot: RuntimeSnapshot;
  autoRefresh: boolean;
  updateState: UpdateState;
  routerStatus: LiveOrderRouterStatus;
  onToggleRefresh: () => void;
}) {
  const updateLabel = updateState === "checking" ? "Checking Updates" : updateState === "reloading" ? "Updating" : "Auto Update";
  const feedTone = snapshot.feed.status === "live" || snapshot.feed.status === "rest" ? "good" : snapshot.feed.status === "error" ? "bad" : "warn";
  const kalshiTone = snapshot.kalshi.status === "live" ? "good" : snapshot.kalshi.status === "error" ? "bad" : "warn";
  const liveOrdersReady = routerStatus.configured && !routerStatus.dryRun && routerStatus.liveEnabled;
  const liveTone = liveOrdersReady ? "bad" : routerStatus.dryRun || routerStatus.configured ? "warn" : "info";
  const liveLabel = liveOrdersReady ? "Live Orders" : routerStatus.dryRun ? "Dry Run" : routerStatus.configured ? routerStatus.liveSwitchEnabled ? "Router Blocked" : "Live Off" : "Read Only";
  return (
    <header className="topbar">
      <div className="market-select">
        <span>Market</span>
        <strong>DOGE-USD + Kalshi</strong>
      </div>
      <div className="market-select wide">
        <span>Active Contract</span>
        <strong>{snapshot.kalshi.market?.ticker ?? `DOGE >= $${snapshot.targetPrice.toFixed(4)} in next 15m`}</strong>
      </div>
      <div className="top-badges">
        <Badge tone={liveTone} icon={<CircleDollarSign size={14} />}>{liveLabel}</Badge>
        <Badge tone={liveOrdersReady ? "bad" : "warn"} icon={<Lock size={14} />}>{routerStatus.liveSwitchEnabled ? "Live Switch On" : "Live Switch Off"}</Badge>
        <Badge tone={feedTone} icon={<Radio size={14} />}>{feedBadgeLabel(snapshot.feed.status)}</Badge>
        <Badge tone={kalshiTone} icon={<Database size={14} />}>{kalshiBadgeLabel(snapshot.kalshi.status)}</Badge>
        <Badge tone={updateState === "reloading" ? "warn" : "good"} icon={<CheckCircle2 size={14} />}>{updateLabel}</Badge>
        <span className="freshness">{feedAgeLabel(snapshot)}</span>
      </div>
      <button className={autoRefresh ? "icon-button active" : "icon-button"} type="button" onClick={onToggleRefresh} aria-label="Toggle auto refresh">
        <ToggleRight size={20} />
      </button>
      <div className="clock-block">
        <span>Local Time</span>
        <strong>{formatTime(new Date(snapshot.generatedAt))}</strong>
      </div>
    </header>
  );
}

function Badge({ children, icon, tone }: { children: ReactNode; icon?: ReactNode; tone: "info" | "warn" | "good" | "bad" | "neutral" }) {
  return <span className={`badge ${tone}`}>{icon}{children}</span>;
}

function NowView({
  snapshot,
}: {
  snapshot: RuntimeSnapshot;
}) {
  return (
    <section className="now-grid compact-now-grid">
      <ContractPanel snapshot={snapshot} />
    </section>
  );
}

function Chart({ candles, generatedAt, targetPrice, yesPrice, noPrice, kalshiLive }: { candles: Candle[]; generatedAt: string; targetPrice: number; yesPrice: number; noPrice: number; kalshiLive: boolean }) {
  const [selectedRange, setSelectedRange] = useState<ChartRangeKey>("15m");
  const [historyByRange, setHistoryByRange] = useState<Partial<Record<ChartRangeKey, Candle[]>>>({});
  const [historyStatus, setHistoryStatus] = useState<ChartHistoryStatus>("idle");
  const [openMenu, setOpenMenu] = useState<ChartMenu>(null);
  const [indicators, setIndicators] = useState<Record<IndicatorKey, boolean>>(() => ({ ...defaultIndicatorState }));
  const [layers, setLayers] = useState<Record<LayerKey, boolean>>(() => ({ ...defaultLayerState }));
  const displayCandles = useMemo(
    () => candlesForChartRange(selectedRange, historyByRange[selectedRange] ?? [], candles, generatedAt),
    [candles, generatedAt, historyByRange, selectedRange],
  );
  const geometry = useMemo(() => chartGeometry(displayCandles, targetPrice, selectedRange), [displayCandles, selectedRange, targetPrice]);

  useEffect(() => {
    let active = true;
    const config = chartRangeConfig(selectedRange);

    const loadRange = async () => {
      setHistoryStatus("loading");
      try {
        const loaded = await fetchCoinbaseCandlesForRange(selectedRange);
        if (!active) return;
        setHistoryByRange((current) => ({ ...current, [selectedRange]: loaded }));
        setHistoryStatus("ready");
      } catch {
        if (active) setHistoryStatus("error");
      }
    };

    void loadRange();
    const refreshId = window.setInterval(loadRange, config.refreshMs);
    return () => {
      active = false;
      window.clearInterval(refreshId);
    };
  }, [selectedRange]);

  const toggleIndicator = (id: IndicatorKey) => {
    setIndicators((current) => ({ ...current, [id]: !current[id] }));
  };

  const toggleLayer = (id: LayerKey) => {
    setLayers((current) => ({ ...current, [id]: !current[id] }));
  };

  return (
    <div className="chart-wrap">
      <div className="chart-controls">
        {chartRangeOptions.map((item) => (
          <button
            aria-pressed={item.id === selectedRange}
            className={item.id === selectedRange ? "selected" : ""}
            data-testid={`chart-range-${item.id}`}
            key={item.id}
            title={historyStatus === "error" && item.id === selectedRange ? "Using locally cached live candles" : undefined}
            type="button"
            onClick={() => setSelectedRange(item.id)}
          >
            {item.label}
          </button>
        ))}
        <span className="divider" />
        <div className="chart-menu">
          <button
            aria-controls="indicator-menu"
            aria-expanded={openMenu === "indicators"}
            className={openMenu === "indicators" ? "selected" : ""}
            data-testid="indicators-button"
            type="button"
            onClick={() => setOpenMenu((current) => current === "indicators" ? null : "indicators")}
          >
            <LineChart size={15} /> Indicators
          </button>
          {openMenu === "indicators" && (
            <div className="chart-popover" data-testid="indicators-menu" id="indicator-menu">
              {indicatorOptions.map((item) => (
                <label className="chart-toggle-row" key={item.id}>
                  <input checked={indicators[item.id]} type="checkbox" onChange={() => toggleIndicator(item.id)} />
                  <span>{item.label}</span>
                  <small>{item.metric}</small>
                </label>
              ))}
            </div>
          )}
        </div>
        <div className="chart-menu">
          <button
            aria-controls="layers-menu"
            aria-expanded={openMenu === "layers"}
            className={openMenu === "layers" ? "selected" : ""}
            data-testid="layers-button"
            type="button"
            onClick={() => setOpenMenu((current) => current === "layers" ? null : "layers")}
          >
            <SlidersHorizontal size={15} /> Layers
          </button>
          {openMenu === "layers" && (
            <div className="chart-popover" data-testid="layers-menu" id="layers-menu">
              {layerOptions.map((item) => (
                <label className="chart-toggle-row" key={item.id}>
                  <input checked={layers[item.id]} type="checkbox" onChange={() => toggleLayer(item.id)} />
                  <span>{item.label}</span>
                  <small>{item.metric}</small>
                </label>
              ))}
            </div>
          )}
        </div>
      </div>
      <svg viewBox="0 0 900 360" role="img" aria-label={`Live DOGE chart, ${selectedRange} range`}>
        <defs>
          <linearGradient id="finalBand" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#f6b64b" stopOpacity="0.28" />
            <stop offset="100%" stopColor="#f6b64b" stopOpacity="0.08" />
          </linearGradient>
          <linearGradient id="volatilityBand" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#7c5cff" stopOpacity="0.13" />
            <stop offset="100%" stopColor="#7c5cff" stopOpacity="0.03" />
          </linearGradient>
        </defs>
        {geometry.grid.map(({ key, ...line }) => <line key={key} {...line} className="grid-line" />)}
        {layers.finalWindow && (
          <>
            <rect className="final-window" x={geometry.finalWindowX} y="28" width={geometry.finalWindowWidth} height="250" />
            {geometry.finalWindowWidth >= 72 && (
              <>
                <text x={geometry.finalWindowLabelX} y="55" className="chart-label">FINAL MINUTE</text>
                <text x={geometry.finalWindowLabelX} y="72" className="chart-label">AVG WINDOW</text>
              </>
            )}
          </>
        )}
        {layers.targetLine && <line x1="26" x2="872" y1={geometry.targetY} y2={geometry.targetY} className="target-line" />}
        {indicators.volatilityBand && (
          <>
            <path d={geometry.volatilityBandPath} className="volatility-fill" />
            <path d={geometry.volatilityUpperPath} className="indicator-line volatility" />
            <path d={geometry.volatilityLowerPath} className="indicator-line volatility" />
          </>
        )}
        {geometry.candles.map((candle) => (
          <g key={candle.key}>
            <line x1={candle.x} x2={candle.x} y1={candle.highY} y2={candle.lowY} className={candle.up ? "wick up" : "wick down"} />
            <rect x={candle.x - 2.8} y={Math.min(candle.openY, candle.closeY)} width="5.6" height={Math.max(2, Math.abs(candle.openY - candle.closeY))} className={candle.up ? "candle up" : "candle down"} />
          </g>
        ))}
        {indicators.movingAverage && <path d={geometry.movingAveragePath} className="indicator-line average" />}
        {indicators.edgeLine && <path d={geometry.edgePath} className="indicator-line edge" />}
        {layers.kalshiPrice && (
          <>
            <path d={geometry.kalshiPath} className="indicator-line kalshi" />
            <text x="698" y="312" className="chart-label kalshi-label">{kalshiLive ? "YES PRICE MODEL" : "YES UNAVAILABLE"}</text>
          </>
        )}
        {indicators.momentumLine && (
          <>
            <line x1="26" x2="872" y1="314" y2="314" className="momentum-zero" />
            <path d={geometry.momentumPath} className="indicator-line momentum" />
            <text x="32" y="305" className="chart-label momentum-label">MOMENTUM</text>
          </>
        )}
        {layers.signalMarkers && geometry.signals.map((signal) => (
          <g className="signal-marker" key={signal.key}>
            <circle cx={signal.x} cy={signal.y} r="6" />
            <text x={signal.x + 9} y={signal.y + 4}>{signal.label}</text>
          </g>
        ))}
        {layers.volumeBars && geometry.volume.map((bar) => <rect key={bar.key} x={bar.x} y={bar.y} width="4" height={bar.h} className={bar.up ? "volume up" : "volume down"} />)}
        {layers.targetLine && <text x="800" y={geometry.targetY - 8} className="price-tag">target {money(targetPrice, 4)}</text>}
      </svg>
      <div className="mini-lines">
        <span className="positive">YES {percent(yesPrice)}</span>
        <span className="negative">NO {percent(noPrice)}</span>
      </div>
    </div>
  );
}

function OrderBookPanel({ snapshot }: { snapshot: RuntimeSnapshot }) {
  const liveKalshi = snapshot.kalshi.status === "live" && snapshot.kalshi.market !== null;
  const mid = midpoint(snapshot.orderBook);
  const spread = bookSpread(snapshot.orderBook);
  const topDepth = topBookDepth(snapshot.orderBook);
  return (
    <section className="panel orderbook-panel">
      <div className="panel-heading compact">
        <div>
          <h2>{liveKalshi ? "Kalshi Order Book" : "Kalshi Book Unavailable"}</h2>
          <span className="panel-subtitle">{snapshot.kalshi.market?.ticker ?? "Waiting for active DOGE ticker"}</span>
        </div>
        <Gauge size={17} />
      </div>
      <div className="book-sides">
        <BookSide label="YES" levels={snapshot.orderBook.yesBids} side="yes" />
        <BookSide label="NO" levels={snapshot.orderBook.noBids} side="no" />
      </div>
      <div className="book-footer">
        <Stat label="Spread" value={spread === null ? "-" : formatSpread(spread)} />
        <Stat label="Mid" value={mid === null ? "-" : `${(mid * 100).toFixed(1)}c`} />
        <Stat label="Top Depth" value={contractsLabel(topDepth)} />
      </div>
    </section>
  );
}

function BookSide({ label, levels, side }: { label: string; levels: Array<{ price: number; size: number }>; side: "yes" | "no" }) {
  const topPrice = levels[0]?.price;
  return (
    <div className={`book-side ${side}`}>
      <div className="book-title">
        <strong>{label}</strong>
        <span>{topPrice === undefined ? "-" : `${(topPrice * 100).toFixed(1)}c`}</span>
      </div>
      <div className="book-header"><span>Size</span><span>Bid</span></div>
      {levels.slice(0, 7).map((level) => (
        <div className="book-row" key={`${label}-${level.price}`}>
          <span>{level.size.toLocaleString()}</span>
          <strong>{(level.price * 100).toFixed(1)}</strong>
        </div>
      ))}
    </div>
  );
}

function ContractPanel({ snapshot }: { snapshot: RuntimeSnapshot }) {
  const targetLabel = snapshot.kalshi.market?.yesSubTitle ?? `>= $${snapshot.targetPrice.toFixed(4)}`;
  const closeLabel = snapshot.kalshi.market?.closeTime ? `Closes ${formatTime(new Date(snapshot.kalshi.market.closeTime))}` : "Ends at next 15m close";
  return (
    <section className="side-stack">
      <div className="panel clock-panel">
        <div className="panel-heading compact"><h2>Contract Clock</h2><Clock3 size={16} /></div>
        <span>Time Remaining</span>
        <strong>{formatCountdown(snapshot.secondsToClose)}</strong>
        <div className="progress-bar"><i style={{ width: `${100 - (snapshot.secondsToClose / 900) * 100}%` }} /></div>
        <small>{closeLabel}</small>
      </div>
      <div className="panel target-panel">
        <div className="panel-heading compact"><h2>Target</h2><Target size={16} /></div>
        <strong>{targetLabel.replace("Target Price: ", "")}</strong>
        <span>Settlement source</span>
        <small>{snapshot.kalshi.market ? "Kalshi CF Benchmarks rules; Coinbase estimate feed" : `${snapshot.settlement.sourceLabel}; real Kalshi ticker pending`}</small>
      </div>
    </section>
  );
}

function EdgeBreakdown({ snapshot }: { snapshot: RuntimeSnapshot }) {
  const spread = bookSpread(snapshot.orderBook);
  return (
    <section className="panel edge-panel">
      <div className="panel-heading compact"><h2>Edge Breakdown</h2><ListChecks size={17} /></div>
      <div className="stat-grid">
        <Stat label="Settlement Estimate" value={money(snapshot.settlement.estimate, 5)} />
        <Stat label="Model Probability" value={percent(snapshot.decision.fairProbability)} />
        <Stat label="Implied Probability" value={percent(snapshot.decision.impliedProbability)} />
        <Stat label="Edge After Costs" value={signedPercent(snapshot.decision.edgeAfterFees)} tone={snapshot.decision.edgeAfterFees >= 0 ? "positive" : "negative"} />
        <Stat label="Fees" value="0.8c" />
        <Stat label="Spread" value={spread === null ? formatSpread(snapshot.gate.spread) : formatSpread(spread)} />
        <Stat label="Latency" value={formatLatency(snapshot.feed.latencyMs)} tone={snapshot.feed.latencyMs !== null && snapshot.feed.latencyMs < 1000 ? "positive" : undefined} />
        <Stat label="Confidence" value={`${snapshot.decision.confidence} / 100`} />
      </div>
    </section>
  );
}

function TradeGatePanel({ snapshot }: { snapshot: RuntimeSnapshot }) {
  return (
    <section className="panel gate-panel">
      <div className="panel-heading compact">
        <h2>Trade Gate</h2>
        <strong className={snapshot.gate.status === "allowed" ? "gate-state good" : "gate-state bad"}>
          {snapshot.gate.status === "allowed" ? <CheckCircle2 size={18} /> : <ShieldAlert size={18} />}
          {snapshot.gate.status.toUpperCase()}
        </strong>
      </div>
      <div className="gate-body">
        <span>Reasons</span>
        <ul>
          {(snapshot.gate.reasons.length ? snapshot.gate.reasons : ["all read-only checks passed"]).map((reason) => <li key={reason}>{reason}</li>)}
        </ul>
      </div>
    </section>
  );
}

function AccountStatusPanel({ kalshiPortfolio }: { kalshiPortfolio: KalshiPortfolioSummary }) {
  const totalPnl = kalshiPortfolio.totalPnlDollars;
  return (
    <section className="panel account-panel">
      <div className="panel-heading compact">
        <h2>Kalshi Account</h2>
        <CircleDollarSign size={16} />
      </div>
      <div className="account-grid">
        <Stat label="Connection" value={portfolioModeLabel(kalshiPortfolio)} tone={kalshiPortfolio.status === "live" ? "positive" : undefined} />
        <Stat label="Orders" value={countOrDash(kalshiPortfolio.orderCount)} />
        <Stat label="Wins" value={countOrDash(kalshiPortfolio.wins)} tone="positive" />
        <Stat label="Losses" value={countOrDash(kalshiPortfolio.losses)} tone="negative" />
        <Stat label="Total P/L" value={totalPnl === null ? "-" : signedMoney(totalPnl)} tone={totalPnl === null ? undefined : totalPnl >= 0 ? "positive" : "negative"} />
        <Stat label="Open Positions" value={kalshiPortfolio.configured ? String(kalshiPortfolio.openPositions) : "-"} />
      </div>
      <p className="panel-note">
        {kalshiPortfolio.configured
          ? `Read-only backend portfolio status: ${kalshiPortfolio.status}. DOGE series: ${kalshiPortfolio.seriesTicker ?? "KXDOGE15M"}.`
          : "Real fills, positions, balances, and true P/L require backend Kalshi credentials. No browser secrets are used."}
      </p>
    </section>
  );
}

function QuickStats({ snapshot }: { snapshot: RuntimeSnapshot }) {
  const notionalVolume = snapshot.feed.volume24h === null ? null : snapshot.feed.volume24h * snapshot.price;
  return (
    <section className="panel quick-panel">
      <div className="panel-heading compact"><h2>Market Quick Stats</h2><Database size={16} /></div>
      <StatLine label="DOGE 24h Vol" value={snapshot.feed.volume24h === null ? "-" : compactNumber(snapshot.feed.volume24h)} />
      <StatLine label="DOGE Notional" value={notionalVolume === null ? "-" : compactMoney(notionalVolume)} />
      <StatLine label="Kalshi 24h Vol" value={snapshot.kalshi.market?.volume24h === null || snapshot.kalshi.market?.volume24h === undefined ? "-" : contractsLabel(snapshot.kalshi.market.volume24h)} />
      <StatLine label="Open Interest" value={snapshot.kalshi.market?.openInterest === null || snapshot.kalshi.market?.openInterest === undefined ? "-" : contractsLabel(snapshot.kalshi.market.openInterest)} />
      <StatLine label="YES Ask" value={`${(snapshot.yesPrice * 100).toFixed(1)}c`} tone="positive" />
      <StatLine label="NO Ask" value={`${(snapshot.noPrice * 100).toFixed(1)}c`} tone="negative" />
      <StatLine label="Avg So Far" value={snapshot.settlement.averageSoFar ? money(snapshot.settlement.averageSoFar, 5) : "-"} />
    </section>
  );
}

const hiddenNowDiagnosticCards = [Chart, OrderBookPanel, EdgeBreakdown, TradeGatePanel, AccountStatusPanel, QuickStats];
void hiddenNowDiagnosticCards;

function FactoryArenaView({
  arena,
  arenaArchives,
  asOf,
  factoryAlgoBatches,
  generatedPaperAlgos,
  latestSweep,
  onGenerateFactoryBatch,
  onLoadFactoryBatch,
  onLoadFactoryBatches,
  onPlay,
  onPause,
  onReset,
  savedTradeSummaries,
}: {
  arena: PaperArenaState;
  arenaArchives: GeneratedPaperAlgoArchive[];
  asOf: string;
  factoryAlgoBatches: FactoryAlgoBatch[];
  generatedPaperAlgos: GeneratedPaperAlgo[];
  latestSweep: LocalFactorySweep | null;
  onGenerateFactoryBatch: () => void;
  onLoadFactoryBatch: (batchId: string) => void;
  onLoadFactoryBatches: (batchIds: string[]) => void;
  onPlay: (config: { selectedAlgoIds: string[]; startingBalance: number; maxBet: number; allowRepeatBuys: boolean; reset: boolean }) => void;
  onPause: () => void;
  onReset: () => void;
  savedTradeSummaries: LocalPaperTradeStrategySummary[];
}) {
  return (
    <section className="view-grid factory-arena-view">
      <PanelTitle title="Factory & Arena" icon={<BrainCircuit size={18} />} />
      <div className="factory-grid">
        <FactoryBatchPanel arena={arena} arenaArchives={arenaArchives} asOf={asOf} batches={factoryAlgoBatches} onGenerateFactoryBatch={onGenerateFactoryBatch} savedTradeSummaries={savedTradeSummaries} />
        <FactoryResearchEvidencePanel latestSweep={latestSweep} />
      </div>
      <TestingArenaView
        arena={arena}
        embedded
        factoryBatches={factoryAlgoBatches}
        generatedPaperAlgos={generatedPaperAlgos}
        latestSweep={latestSweep}
        onLoadFactoryBatch={onLoadFactoryBatch}
        onLoadFactoryBatches={onLoadFactoryBatches}
        onPause={onPause}
        onPlay={onPlay}
        onReset={onReset}
      />
    </section>
  );
}

function FactoryBatchPanel({
  arena,
  arenaArchives,
  asOf,
  batches,
  onGenerateFactoryBatch,
  savedTradeSummaries,
}: {
  arena: PaperArenaState;
  arenaArchives: GeneratedPaperAlgoArchive[];
  asOf: string;
  batches: FactoryAlgoBatch[];
  onGenerateFactoryBatch: () => void;
  savedTradeSummaries: LocalPaperTradeStrategySummary[];
}) {
  return (
    <section className="panel factory-panel full generated-algos-panel">
      <div className="panel-heading compact">
        <div>
          <h2>Factory Arena Batches</h2>
          <span className="panel-subtitle">Generate 1000 variants from Arena evidence</span>
        </div>
        <div className="heading-actions">
          <button className="primary-action" type="button" onClick={onGenerateFactoryBatch}>
            <BrainCircuit size={14} /> Generate 1000
          </button>
          <Badge tone={batches.length > 0 ? "good" : "neutral"}>{batches.length} batches</Badge>
        </div>
      </div>
      <div className="upgrade-table-wrap">
        <table className="factory-batch-table">
          <colgroup>
            <col className="factory-col-batch" />
            <col className="factory-col-gen" />
            <col className="factory-col-created" />
            <col className="factory-col-source" />
            <col className="factory-col-algos" />
            <col className="factory-col-qualified" />
            <col className="factory-col-time" />
            <col className="factory-col-pnl" />
            <col className="factory-col-evolution" />
            <col className="factory-col-families" />
          </colgroup>
          <thead>
            <tr>
              <th>Batch</th>
              <th>Gen</th>
              <th>Created</th>
              <th>Source</th>
              <th>Algos</th>
              <th>3+ Closed</th>
              <th>Arena Time</th>
              <th>P/L / 15m</th>
              <th>Evolution</th>
              <th>Families</th>
            </tr>
          </thead>
          <tbody>
            {batches.length === 0 ? (
              <tr>
                <td className="empty-cell" colSpan={10}>No 1000-algo Arena batches yet.</td>
              </tr>
            ) : batches.map((batch) => {
              const families = [...new Set(batch.algos.map((algo) => familyLabel(algo.family)))].slice(0, 5).join(", ");
              const runtime = factoryBatchArenaRuntime(batch, arena, arenaArchives, asOf, savedTradeSummaries);
              return (
                <tr key={batch.id}>
                  <td><span className="algo-id-pill">{batch.name}</span></td>
                  <td>{batch.generation}</td>
                  <td>{formatTime(new Date(batch.createdAt))}</td>
                  <td>{factoryBatchSourceLabel(batch.source)}</td>
                  <td>{countOrDash(batch.algos.length)}</td>
                  <td>
                    <div className="factory-runtime-cell">
                      <strong>{runtime.threeTradeAlgos} / {batch.algos.length}</strong>
                      <span>sample count only</span>
                    </div>
                  </td>
                  <td>
                    <div className="factory-runtime-cell">
                      <strong>{durationLabelFromMs(runtime.totalMs)}</strong>
                      <span>{runtime.sessions} {runtime.sessions === 1 ? "run" : "runs"}</span>
                      <span>{runtime.fullCycles} elapsed 15m{runtime.active ? " / running" : runtime.loaded ? " / loaded" : ""}</span>
                    </div>
                  </td>
                  <td className={runtime.pnlPer15m === null ? "muted" : runtime.pnlPer15m >= 0 ? "positive" : "negative"}>
                    <div className="factory-pnl-cell">
                      <strong>{runtime.pnlPer15m === null ? "-" : signedMoney(runtime.pnlPer15m)}</strong>
                      <span>{runtime.bestFamilyCount > 0 ? `Top types ${signedMoney(runtime.bestFamilyPnlPer15m)}` : "Top types -"}</span>
                      <span>{signedMoney(runtime.totalPnl)} total</span>
                      <span>{runtime.closed} closed</span>
                    </div>
                  </td>
                  <td>
                    E{batch.summary.eliteCount} / M{batch.summary.mutationCount} / C{batch.summary.crossoverCount} / X{batch.summary.explorationCount}
                    <br />
                    <span className="muted">{countOrDash(batch.summary.trainingSampleCount)} training samples</span>
                    <br />
                    <span className="muted">avoided {countOrDash(batch.summary.avoidedFailureZones)} loser zones</span>
                  </td>
                  <td>{families}{batch.algos.length > 0 ? "" : "-"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="panel-note">Each generation trains on Arena results that match the current testing mode. Older and repeat-buy samples stay visible in Activated Algos but are skipped for parent selection.</p>
    </section>
  );
}

function FactoryResearchEvidencePanel({ latestSweep }: { latestSweep: LocalFactorySweep | null }) {
  const rows = useMemo(() => {
    if (!latestSweep) return [];
    const byId = new Map<string, LocalFactorySweepCandidate>();
    for (const candidate of [...latestSweep.topMetrics, ...latestSweep.candidates]) {
      const current = byId.get(candidate.algoId);
      byId.set(candidate.algoId, current ? betterSweepCandidate(candidate, current) : candidate);
    }
    return bestSweepCandidateByFamily([...byId.values()]).slice(0, 12).map((row) => row.best);
  }, [latestSweep]);
  const promotableCount = rows.filter((row) => !row.nonPromotable).length;
  const holdoutPassCount = rows.filter((row) => row.holdoutPass).length;
  const driftOkCount = rows.filter((row) => row.paperEvidence.available && row.paperEvidence.driftOk).length;
  const paperEvidenceCount = rows.filter((row) => row.paperEvidence.available).length;

  return (
    <section className="panel factory-panel full generated-algos-panel">
      <div className="panel-heading compact">
        <div>
          <h2>Factory Research Evidence</h2>
          <span className="panel-subtitle">Top family rows ranked by robust validation score</span>
        </div>
        <div className="heading-actions">
          <Badge tone={latestSweep ? "info" : "neutral"}>{latestSweep?.mode ?? "no run"}</Badge>
          <Badge tone={promotableCount > 0 ? "good" : "neutral"}>{promotableCount} promotable</Badge>
        </div>
      </div>
      {latestSweep && (
        <div className="stat-row compact">
          <Stat label="Algos" value={countOrDash(latestSweep.algoCount)} />
          <Stat label="Families" value={countOrDash(rows.length)} />
          <Stat label="Holdout Pass" value={`${holdoutPassCount} / ${rows.length}`} tone={holdoutPassCount > 0 ? "positive" : undefined} />
          <Stat label="Paper Proof" value={`${paperEvidenceCount} / ${rows.length}`} tone={paperEvidenceCount > 0 ? "positive" : undefined} />
          <Stat label="Drift OK" value={`${driftOkCount} / ${rows.length}`} tone={driftOkCount === rows.length && rows.length > 0 ? "positive" : undefined} />
        </div>
      )}
      <div className="upgrade-table-wrap">
        <table className="factory-batch-table">
          <thead>
            <tr>
              <th>Algo</th>
              <th>Verdict</th>
              <th>Robust</th>
              <th>Adj Conf</th>
              <th>WF</th>
              <th>CPCV</th>
              <th>Holdout</th>
              <th>Paper</th>
              <th>Cost P/L</th>
              <th>Reasons</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td className="empty-cell" colSpan={10}>No factory sweep evidence has been loaded yet.</td>
              </tr>
            ) : rows.map((row) => {
              const cpcvPositive = recordNumber(row.cpcvSummary, "positiveFoldRate", 0);
              const cpcvMedian = recordNumber(row.cpcvSummary, "medianFoldPnl", 0);
              const reasons = row.reasonCodes.length ? row.reasonCodes.slice(0, 4).join(", ") : "none";
              return (
                <tr key={row.algoId}>
                  <td>
                    <div className="factory-runtime-cell">
                      <strong>{shortAlgoName(row.algoName)}</strong>
                      <span>{familyLabel(row.family)}</span>
                    </div>
                  </td>
                  <td><Badge tone={factoryVerdictTone(row)}>{row.promotionVerdict.replaceAll("_", " ")}</Badge></td>
                  <td>{row.robustScore.toFixed(1)}</td>
                  <td>{percent(row.adjustedConfidence)}</td>
                  <td><Badge tone={row.walkForwardPass ? "good" : "bad"}>{row.walkForwardPass ? "pass" : "fail"}</Badge></td>
                  <td>
                    <div className="factory-runtime-cell">
                      <strong>{percent(cpcvPositive)}</strong>
                      <span>{signedMoney(cpcvMedian)} median</span>
                    </div>
                  </td>
                  <td>
                    <div className="factory-runtime-cell">
                      <Badge tone={row.holdoutPass && row.holdoutStrictlyLater ? "good" : "bad"}>{row.holdoutPass ? "pass" : "fail"}</Badge>
                      <span>{signedMoney(row.holdoutConservativeTotalPnl)} cons</span>
                      <span>{row.holdoutLowerCi === null ? "CI -" : `${signedMoney(row.holdoutLowerCi)} CI`}</span>
                    </div>
                  </td>
                  <td>
                    <div className="factory-runtime-cell">
                      <Badge tone={!row.paperEvidence.available ? "neutral" : row.paperEvidence.driftOk ? "good" : "warn"}>{row.paperEvidence.available ? row.paperEvidence.status : "missing"}</Badge>
                      <span>{row.paperEvidence.available ? `${countOrDash(row.paperEvidence.closedMarkets)} markets` : "needs live paper"}</span>
                      <span>{row.paperEvidence.available && row.paperEvidence.totalPnl !== null ? signedMoney(row.paperEvidence.totalPnl) : ""}</span>
                    </div>
                  </td>
                  <td>
                    <div className="factory-runtime-cell">
                      <strong className={row.conservativeTotalPnl >= 0 ? "positive" : "negative"}>{signedMoney(row.conservativeTotalPnl)}</strong>
                      <span className={row.stressTotalPnl >= 0 ? "positive" : "negative"}>{signedMoney(row.stressTotalPnl)} stress</span>
                    </div>
                  </td>
                  <td>{reasons}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="panel-note">Promotion is blocked unless walk-forward, CPCV consistency, and the strictly later conservative holdout all pass. Real orders remain disabled unless explicitly enabled outside the Factory.</p>
    </section>
  );
}

function factoryVerdictTone(row: LocalFactorySweepCandidate): "info" | "warn" | "good" | "bad" | "neutral" {
  if (row.promotionVerdict === "tiny_live_eligible" || row.promotionVerdict === "paper_only") return "good";
  if (row.promotionVerdict === "insufficient_data") return "warn";
  if (row.promotionVerdict === "reject") return "bad";
  return "neutral";
}

function recordNumber(record: Record<string, unknown>, key: string, fallback: number) {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function TestingArenaView({
  arena,
  embedded = false,
  factoryBatches,
  generatedPaperAlgos,
  latestSweep,
  onLoadFactoryBatch,
  onLoadFactoryBatches,
  onPlay,
  onPause,
  onReset,
}: {
  arena: PaperArenaState;
  embedded?: boolean;
  factoryBatches: FactoryAlgoBatch[];
  generatedPaperAlgos: GeneratedPaperAlgo[];
  latestSweep: LocalFactorySweep | null;
  onLoadFactoryBatch: (batchId: string) => void;
  onLoadFactoryBatches: (batchIds: string[]) => void;
  onPlay: (config: { selectedAlgoIds: string[]; startingBalance: number; maxBet: number; allowRepeatBuys: boolean; reset: boolean }) => void;
  onPause: () => void;
  onReset: () => void;
}) {
  const activeBatches = activeArenaBatches(arena, factoryBatches);
  const activeBatch = activeBatches[0] ?? null;
  const activeBatchLabel = activeBatches.length > 1 ? activeBatches.map((batch) => batch.name.replace("Batch ", "")).join("+") : activeBatch?.name ?? "";
  const hijBatchIds = ["Batch H", "Batch I", "Batch J"]
    .map((name) => factoryBatches.find((batch) => batch.name === name)?.id ?? null)
    .filter((id): id is string => id !== null);
  const arenaAlgos = useMemo(() => arenaAlgosForArena(arena, generatedPaperAlgos, latestSweep, factoryBatches), [arena, factoryBatches, generatedPaperAlgos, latestSweep]);
  const defaultAlgoId = defaultArenaAlgoId(arenaAlgos);
  const [selectedAlgoIds, setSelectedAlgoIds] = useState<string[]>(() => initialArenaSelectedAlgoIds(arena, arenaAlgos, defaultAlgoId));
  const [startingBalance, setStartingBalance] = useState(String(arena.startingBalance));
  const [maxBet, setMaxBet] = useState(String(arena.maxBet));
  const [allowRepeatBuys, setAllowRepeatBuys] = useState(arena.allowRepeatBuys);
  const availableAlgoIds = useMemo(() => new Set<string>(arenaAlgos.map((algo) => algo.id)), [arenaAlgos]);
  const effectiveSelectedAlgoIds = selectedAlgoIds.filter((id) => availableAlgoIds.has(id)).slice(0, arenaBatchMax);
  const effectiveSelectedIdSet = new Set(effectiveSelectedAlgoIds);
  const selectedAlgos = arenaAlgos.filter((algo) => effectiveSelectedIdSet.has(algo.id));
  const selectedPreview = selectedAlgos.slice(0, 5).map((algo) => algo.displayId).join(", ");
  const metrics = paperArenaMetrics(arena);
  const rows = arena.paperState.events.slice(0, 12);
  const canPlay = selectedAlgos.length > 0 && numberFromInput(startingBalance) > 0 && numberFromInput(maxBet) > 0;
  const playLabel = arena.status === "paused" ? "Resume" : "Play";
  const controlsLocked = arena.status === "running";
  const canLoadHij = hijBatchIds.length === 3 && !controlsLocked;
  const toggleAlgo = (id: string) => {
    setSelectedAlgoIds((current) => {
      if (current.includes(id)) return current.filter((item) => item !== id);
      return uniqueStringList([...current, id]).slice(0, arenaBatchMax);
    });
  };
  const selectFirst = (count: number) => {
    setSelectedAlgoIds(arenaAlgos.slice(0, Math.min(count, arenaBatchMax)).map((algo) => algo.id));
  };
  const loadBatch = (batchId: string) => {
    onLoadFactoryBatch(batchId);
    const batch = factoryBatches.find((item) => item.id === batchId);
    setSelectedAlgoIds(batch ? batch.algos.map((algo) => algo.id).slice(0, arenaBatchMax) : factoryBatchUserAlgos(generatedPaperAlgos).slice(0, 12).map((algo) => algo.id));
    setAllowRepeatBuys(false);
  };

  const loadHij = () => {
    if (hijBatchIds.length !== 3) return;
    onLoadFactoryBatches(hijBatchIds);
    const ids = hijBatchIds
      .flatMap((id) => factoryBatches.find((batch) => batch.id === id)?.algos.map((algo) => algo.id) ?? [])
      .slice(0, arenaBatchMax);
    setSelectedAlgoIds(ids);
    setAllowRepeatBuys(false);
  };

  const reset = () => {
    setAllowRepeatBuys(false);
    onReset();
  };

  const play = (reset: boolean) => {
    if (!canPlay) return;
    onPlay({
      selectedAlgoIds: effectiveSelectedAlgoIds,
      startingBalance: numberFromInput(startingBalance),
      maxBet: numberFromInput(maxBet),
      allowRepeatBuys,
      reset,
    });
  };

  return (
    <section className={embedded ? "arena-view embedded-arena-view" : "view-grid arena-view"}>
      {!embedded && <PanelTitle title="Executable Arena" icon={<Target size={18} />} />}
      <div className="arena-grid">
        <section className="panel arena-control-panel">
          <div className="panel-heading compact">
            <div>
              <h2>Run Setup</h2>
              <span className="panel-subtitle">Liquidity-aware paper sandbox</span>
            </div>
            <Badge tone={arena.status === "running" ? "good" : arena.status === "paused" ? "warn" : "neutral"}>{arena.status.toUpperCase()}</Badge>
          </div>
          <div className="arena-form">
            <div className="arena-batch-field">
              <span>Factory Batch</span>
              <select disabled={controlsLocked} value={arena.activeBatchId ?? ""} onChange={(event) => loadBatch(event.target.value)}>
                <option value="">Manual / defaults</option>
                {factoryBatches.map((batch) => (
                  <option key={batch.id} value={batch.id}>{batch.name} - {countOrDash(batch.algos.length)} algos</option>
                ))}
              </select>
            </div>
            <div className="arena-batch-field">
              <span>Algo Selection</span>
              <div className="arena-batch-toolbar">
                <button className="ghost-button mini-button" disabled={controlsLocked} type="button" onClick={() => selectFirst(12)}>Top 12</button>
                <button className="ghost-button mini-button" disabled={controlsLocked} type="button" onClick={() => selectFirst(arenaBatchMax)}>All Active</button>
                <button className="ghost-button mini-button" disabled={!canLoadHij} type="button" onClick={loadHij}>Load H/I/J</button>
                <button className="ghost-button mini-button" disabled={controlsLocked} type="button" onClick={() => setSelectedAlgoIds([])}>Clear</button>
              </div>
              <div className="arena-algo-picker" role="group" aria-label="Arena algorithm batch">
                {arenaAlgos.length === 0 ? (
                  <span className="muted">No arena algos available</span>
                ) : arenaAlgos.slice(0, factoryBatchAlgoPreviewLimit).map((algo) => (
                  <label key={algo.id} className="arena-algo-option">
                    <input checked={effectiveSelectedIdSet.has(algo.id)} disabled={controlsLocked} type="checkbox" onChange={() => toggleAlgo(algo.id)} />
                    <span className="algo-id-pill">{algo.displayId}</span>
                    <div>
                      <strong>{shortAlgoName(algo.name)}</strong>
                      <small>{familyLabel(algo.family)} / {percent(algo.sourceMetrics.roi)} replay ROI</small>
                    </div>
                  </label>
                ))}
                {arenaAlgos.length > factoryBatchAlgoPreviewLimit && (
                  <div className="arena-picker-note">Showing first {factoryBatchAlgoPreviewLimit}; All Active arms up to {arenaBatchMax.toLocaleString()} algos from loaded batches.</div>
                )}
              </div>
            </div>
            <label>
              <span>Bankroll</span>
              <input disabled={controlsLocked} min="1" step="1" type="number" value={startingBalance} onChange={(event) => setStartingBalance(event.target.value)} />
            </label>
            <label>
              <span>Max Per Bet</span>
              <input disabled={controlsLocked} min="1" step="1" type="number" value={maxBet} onChange={(event) => setMaxBet(event.target.value)} />
            </label>
            <label className="arena-switch-row">
              <input checked={allowRepeatBuys} disabled={controlsLocked} type="checkbox" onChange={(event) => setAllowRepeatBuys(event.target.checked)} />
              <span>Repeat buys</span>
              <small>{allowRepeatBuys ? "Scale test: up to 10 buys per active contract; skipped by Factory training." : "One-entry test: one buy per active contract, eligible for Factory training."}</small>
            </label>
          </div>
          <div className="arena-actions">
            {arena.status === "running" ? (
              <button className="ghost-button arena-action" type="button" onClick={onPause}>
                <Pause size={14} /> Pause
              </button>
            ) : (
              <button className="primary-action arena-action" disabled={!canPlay} type="button" onClick={() => play(arena.status !== "paused")}>
                <Play size={14} /> {playLabel}
              </button>
            )}
            <button className="ghost-button arena-action" disabled={!canPlay} type="button" onClick={() => play(true)}>
              <Square size={14} /> New Run
            </button>
            <button className="ghost-button arena-action" type="button" onClick={reset}>
              <RotateCcw size={14} /> Reset
            </button>
          </div>
          <div className="arena-selected">
            {selectedAlgos.length > 0 ? (
              <>
                <span className="algo-id-pill">{selectedAlgos.length} armed</span>
                <div>
                  <strong>{selectedPreview}{selectedAlgos.length > 5 ? ` +${selectedAlgos.length - 5}` : ""}</strong>
                  <small>{activeBatchLabel ? `${activeBatchLabel} / ` : ""}{money(numberFromInput(startingBalance))} bankroll per algo / max {money(numberFromInput(maxBet))} per fillable entry</small>
                </div>
              </>
            ) : (
              <span className="muted">Select at least one algo to run the batch.</span>
            )}
          </div>
          <p className="panel-note">Paper-only. Runs selected algos simultaneously against visible Kalshi depth, estimated fees, 2c max spread, +8% minimum edge, {allowRepeatBuys ? "repeat entries for scale testing only" : "one entry per contract"}, and a cash gate that blocks new buys while exits keep running.</p>
        </section>

        <section className="panel arena-status-panel">
          <div className="panel-heading compact">
            <div>
              <h2>Executable Status</h2>
              <span className="panel-subtitle">{arena.startedAt ? `Started ${formatTime(new Date(arena.startedAt))}` : "No active run"}</span>
            </div>
            <Gauge size={16} />
          </div>
          <div className="factory-summary arena-summary">
            <Stat label="Bankroll" value={`${money(arena.startingBalance)} ea`} />
            <Stat label="Total Available" value={money(metrics.available)} tone={metrics.available <= 0 ? "negative" : "positive"} />
            <Stat label="Locked" value={money(metrics.openCost)} />
            <Stat label="Realized P/L" value={signedMoney(metrics.realizedPnl)} tone={metrics.realizedPnl >= 0 ? "positive" : "negative"} />
            <Stat label="ROI" value={metrics.roi === null ? "-" : percent(metrics.roi)} tone={metrics.roi === null ? undefined : metrics.roi >= 0 ? "positive" : "negative"} />
          </div>
          <div className="factory-summary arena-summary">
            <Stat label="Buys" value={countOrDash(metrics.buys)} />
            <Stat label="Sells" value={countOrDash(metrics.sells)} />
            <Stat label="Open" value={countOrDash(metrics.open)} />
            <Stat label="W / L" value={`${metrics.wins} / ${metrics.losses}`} />
            <Stat label="Armed / Candidates" value={`${selectedAlgos.length} / ${arenaAlgos.length}`} />
          </div>
          <div className="automation-policy-grid arena-rules">
            <div>
              <strong>Funding</strong>
              <span>{money(arena.startingBalance)} fake bankroll per algo; each algo is accounted independently.</span>
            </div>
            <div>
              <strong>Bet Cap</strong>
              <span>Up to {money(arena.maxBet)} cost per executable entry.</span>
            </div>
            <div>
              <strong>Depth Rule</strong>
              <span>Uses up to 25% of visible entry and exit depth.</span>
            </div>
            <div>
              <strong>Entry Rule</strong>
              <span>{arena.allowRepeatBuys ? "Repeat buys allowed; this run is skipped by Factory training." : "One buy per algo per active contract; this run can train the Factory."}</span>
            </div>
            <div>
              <strong>Breaker</strong>
              <span>Blocks new buys when available balance is depleted; open positions can still sell.</span>
            </div>
          </div>
        </section>

        <section className="panel arena-history-panel full">
          <div className="panel-heading compact">
            <div>
              <h2>Executable Fills</h2>
              <span className="panel-subtitle">Most recent fillable paper events</span>
            </div>
            <ListChecks size={16} />
          </div>
          <div className="paper-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Action</th>
                  <th>Algo</th>
                  <th>Side</th>
                  <th>Market</th>
                  <th>Price</th>
                  <th>Contracts</th>
                  <th>Cost</th>
                  <th>Sale</th>
                  <th>Result</th>
                  <th>P/L</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td className="empty-cell" colSpan={11}>No arena fills yet.</td>
                  </tr>
                ) : rows.map((event) => (
                  <tr key={event.id}>
                    <td>{formatTime(new Date(event.time))}</td>
                    <td><span className={event.action === "BUY" ? "status-pill paper-fill" : "status-pill settled"}>{event.action}</span></td>
                    <td>{event.strategyName}</td>
                    <td><span className={event.side === "YES" ? "side yes" : "side no"}>{event.side}</span></td>
                    <td>{event.marketTicker}</td>
                    <td>{contractPrice(event.price)}</td>
                    <td>{event.contracts.toLocaleString()}</td>
                    <td>{event.action === "BUY" ? money(event.price * event.contracts) : "-"}</td>
                    <td>{event.action === "SELL" ? money(event.price * event.contracts) : "-"}</td>
                    <td className={event.result === "Win" ? "positive" : event.result === "Loss" ? "negative" : "muted"}>{event.result}</td>
                    <td className={event.pnl === null ? "muted" : event.pnl >= 0 ? "positive" : "negative"}>{event.pnl === null ? "-" : signedMoney(event.pnl)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </section>
  );
}

function TopTradersView({
  arena,
  arenaArchives,
  asOf,
  candidateAlgos,
  executableState,
  favoriteSourceIds,
  latestSweep,
  mainArena,
  mainArenaAlgos,
  onPlay,
  onPause,
  onReset,
  onToggleFavorite,
  savedTradeSummaries,
}: {
  arena: PaperArenaState;
  arenaArchives: GeneratedPaperAlgoArchive[];
  asOf: string;
  candidateAlgos: GeneratedPaperAlgo[];
  executableState: TopTraderExecutableState;
  favoriteSourceIds: string[];
  latestSweep: LocalFactorySweep | null;
  mainArena: PaperArenaState;
  mainArenaAlgos: GeneratedPaperAlgo[];
  onPlay: (config: { startingBalance: number; maxBet: number; reset: boolean }) => void;
  onPause: () => void;
  onReset: () => void;
  onToggleFavorite: (sourceAlgoId: string) => void;
  savedTradeSummaries: LocalPaperTradeStrategySummary[];
}) {
  const [startingBalance, setStartingBalance] = useState(String(arena.startingBalance));
  const [maxBet, setMaxBet] = useState(String(arena.maxBet));
  const [topTraderSorts, setTopTraderSorts] = useState<TopTraderSortChain>([{ key: "rank", direction: "asc" }]);
  const [tradeViewer, setTradeViewer] = useState<TopTraderTradeViewerState>({ sourceAlgoId: null });
  const sourceRows = useMemo(
    () => buildTopTraderRows(candidateAlgos, arenaArchives, arena, asOf, mainArena, mainArenaAlgos, savedTradeSummaries),
    [arena, arenaArchives, asOf, candidateAlgos, mainArena, mainArenaAlgos, savedTradeSummaries],
  );
  const rows = useMemo(
    () => rankTopTraderRowsByExecutableStats(sourceRows, executableState, asOf),
    [asOf, executableState, sourceRows],
  );
  const rosterRows = rows.filter((row) => row.bucket !== "standby").slice(0, topTradersRosterSize);
  const eligibleBatchCounts = useMemo(() => topTraderEligibleBatchCounts(rosterRows), [rosterRows]);
  const championRows = rosterRows.filter((row) => row.bucket === "champion");
  const prospectRows = rosterRows.filter((row) => row.bucket === "prospect");
  const wildcardRows = rosterRows.filter((row) => row.bucket === "wildcard");
  const executableStats = executableState.stats;
  const executableSummaries = useMemo(() => Object.values(executableStats).map(topTraderExecutableSummary), [executableStats]);
  const executableSummary = useMemo(() => aggregatePaperSummarySnapshots(executableSummaries), [executableSummaries]);
  const executableAttempts = useMemo(() => Object.values(executableStats).reduce((total, stats) => total + stats.attempts, 0), [executableStats]);
  const executableAccepted = useMemo(() => Object.values(executableStats).reduce((total, stats) => total + stats.acceptedBuys, 0), [executableStats]);
  const executableRejected = useMemo(() => Object.values(executableStats).reduce((total, stats) => total + stats.rejected, 0), [executableStats]);
  const executableRejectReasons = useMemo(() => topTraderRejectReasonRows(Object.values(executableStats)), [executableStats]);
  const executableAcceptanceRate = executableAttempts > 0 ? executableAccepted / executableAttempts : null;
  const sourcePoolCount = sourceRows.length;
  const sourceProspectPoolCount = sourceRows.filter(topTraderProspectEligible).length;
  const selectedIdList = useMemo(() => uniqueStringList(arena.selectedAlgoIds.length > 0 ? arena.selectedAlgoIds : arena.selectedAlgoId ? [arena.selectedAlgoId] : []), [arena.selectedAlgoId, arena.selectedAlgoIds]);
  const selectedIds = useMemo(() => new Set(selectedIdList), [selectedIdList]);
  const selectedIdSignature = selectedIdList.join("|");
  const favoriteSourceSet = useMemo(() => new Set(favoriteSourceIds), [favoriteSourceIds]);
  const factoryEvidenceBySource = useMemo(() => factoryResearchEvidenceBySource(latestSweep), [latestSweep]);
  const sortedRosterRows = sortTopTraderRows(
    rosterRows,
    topTraderSorts,
    asOf,
    arena.status,
    new Set(selectedIdSignature.split("|").filter(Boolean)),
    executableStats,
    executableState.startedAt,
  );
  const activeRosterCount = rosterRows.filter((row) => selectedIds.has(paperStrategyIdForActivatedRow(row))).length;
  const canPlay = rosterRows.length > 0 && numberFromInput(startingBalance) > 0 && numberFromInput(maxBet) > 0;
  const controlsLocked = arena.status === "running";
  const playLabel = arena.status === "paused" ? "Resume" : "Start";
  const changeSort = (key: TopTraderSortKey, additive: boolean) => {
    setTopTraderSorts((current) => nextTopTraderSortChain(current, key, additive));
  };
  const closeTradeViewer = () => setTradeViewer({ sourceAlgoId: null });
  const toggleTradeViewer = (sourceAlgoId: string) => {
    setTradeViewer((current) => ({ sourceAlgoId: current.sourceAlgoId === sourceAlgoId ? null : sourceAlgoId }));
  };
  const play = (reset: boolean) => {
    if (!canPlay) return;
    onPlay({
      startingBalance: numberFromInput(startingBalance),
      maxBet: numberFromInput(maxBet),
      reset,
    });
  };

  return (
    <section className="view-grid arena-view">
      <PanelTitle title="Top Traders" icon={<Gauge size={18} />} />
      <div className="arena-grid">
        <section className="panel arena-control-panel">
          <div className="panel-heading compact">
            <div>
              <h2>Executable Top 600</h2>
              <span className="panel-subtitle">Dry-run ranking with source-seeded watch slots</span>
            </div>
            <Badge tone={arena.status === "running" ? "good" : arena.status === "paused" ? "warn" : "neutral"}>{arena.status.toUpperCase()}</Badge>
          </div>
          <div className="arena-form">
            <label>
              <span>Bankroll Per Algo</span>
              <input disabled={controlsLocked} min="1" step="1" type="number" value={startingBalance} onChange={(event) => setStartingBalance(event.target.value)} />
            </label>
            <label>
              <span>Max Per Bet</span>
              <input disabled={controlsLocked} min="1" step="1" type="number" value={maxBet} onChange={(event) => setMaxBet(event.target.value)} />
            </label>
          </div>
          <div className="arena-actions">
            {arena.status === "running" ? (
              <button className="ghost-button arena-action" type="button" onClick={onPause}>
                <Pause size={14} /> Pause
              </button>
            ) : (
              <button className="primary-action arena-action" disabled={!canPlay} type="button" onClick={() => play(arena.status !== "paused")}>
                <Play size={14} /> {playLabel}
              </button>
            )}
            <button className="ghost-button arena-action" disabled={!canPlay} type="button" onClick={() => play(true)}>
              <Square size={14} /> New Run
            </button>
            <button className="ghost-button arena-action" type="button" onClick={onReset}>
              <RotateCcw size={14} /> Reset
            </button>
          </div>
          <div className="arena-selected">
            {rosterRows.length > 0 ? (
              <>
                <span className="algo-id-pill">{rosterRows.length} eligible</span>
                <div>
                  <strong>{rosterRows.slice(0, 5).map((row) => row.displayId).join(", ")}{rosterRows.length > 5 ? ` +${rosterRows.length - 5}` : ""}</strong>
                  <small>{money(numberFromInput(startingBalance))} bankroll per algo / max {money(numberFromInput(maxBet))} per fillable entry / one entry per contract</small>
                </div>
              </>
            ) : (
              <span className="muted">No promising factory algos have realistic single-entry arena evidence yet.</span>
            )}
          </div>
          <p className="panel-note">This runner sources candidates from all generated algos, but its stats are fresh executable dry-run stats. It scans the full roster locally and throttles router checks so live controls stay responsive.</p>
        </section>

        <section className="panel arena-status-panel">
          <div className="panel-heading compact">
            <div>
              <h2>Roster Status</h2>
              <span className="panel-subtitle">{arena.startedAt ? `Started ${formatTime(new Date(arena.startedAt))}` : "No top-trader run active"}</span>
            </div>
            <ListChecks size={16} />
          </div>
          <div className="factory-summary arena-summary">
            <Stat label="Source Pool" value={countOrDash(sourcePoolCount)} />
            <Stat label="Active Roster" value={`${activeRosterCount} / ${topTradersRosterSize}`} tone={arena.status === "running" && activeRosterCount > 0 ? "positive" : undefined} />
            <Stat label="Source Prospects" value={countOrDash(sourceProspectPoolCount)} />
            <Stat label="Dry Attempts" value={`${countOrDash(executableAccepted)} / ${countOrDash(executableAttempts)}`} tone={executableAccepted > 0 ? "positive" : undefined} />
            <Stat label="Dry P/L" value={signedMoney(executableSummary.totalPnl)} tone={executableSummary.totalPnl >= 0 ? "positive" : "negative"} />
          </div>
          <div className="factory-summary arena-summary">
            <Stat label="Champions" value={`${championRows.length} / ${topTradersChampionSlots}`} />
            <Stat label="Prospects" value={`${prospectRows.length} / ${topTradersProspectSlots}`} />
            <Stat label="Watch Queue" value={countOrDash(wildcardRows.length)} />
            <Stat label="Dry Rejects" value={countOrDash(executableRejected)} />
            <Stat label="Accept Rate" value={executableAcceptanceRate === null ? "-" : percent(executableAcceptanceRate)} tone={executableAcceptanceRate === null ? undefined : executableAcceptanceRate >= 0.35 ? "positive" : "negative"} />
          </div>
          <div className="top-trader-batch-summary">
            <strong>Reject Reasons</strong>
            {executableRejectReasons.length > 0 ? (
              <div className="top-trader-batch-pills">
                {executableRejectReasons.map((reason) => (
                  <span key={reason.key}>{reason.label} ({reason.count})</span>
                ))}
              </div>
            ) : (
              <span className="muted">No dry-run rejects yet.</span>
            )}
          </div>
          <div className="top-trader-batch-summary">
            <strong>Eligible Batches</strong>
            {eligibleBatchCounts.length > 0 ? (
              <div className="top-trader-batch-pills">
                {eligibleBatchCounts.map((batch) => (
                  <span key={batch.key}>{batch.label} ({batch.count})</span>
                ))}
              </div>
            ) : (
              <span className="muted">No eligible batch rows yet.</span>
            )}
          </div>
          <div className="automation-policy-grid arena-rules">
            <div>
              <strong>Champion Slots</strong>
              <span>{topTradersChampionSlots} slots only for mature executable dry-run winners with at least 15 router attempts, 8 accepted buys, {topTradersChampionMinClosedTrades} closed exits, positive P/L per 15m, {percent(topTradersChampionMinWinRate)}+ win rate, and a non-early-spike confidence state.</span>
            </div>
            <div>
              <strong>Prospect Slots</strong>
              <span>{topTradersProspectSlots} reserved slots for lower-tested algos with accepted dry-run buys, at least {topTradersProspectMinClosedTrades} closed exit, positive dry score, non-negative dry-run P/L, and 10%+ accept rate.</span>
            </div>
            <div>
              <strong>Watch Queue</strong>
              <span>Untested or weak dry-run algos stay below dry-run winners and are only queued so they can earn executable evidence.</span>
            </div>
            <div>
              <strong>Rotation</strong>
              <span>Runs only while the Now live runner is stopped. Refreshes every {Math.round(topTradersRosterRefreshMs / 1000)} seconds, scans locally every second, and dry-routes up to {topTradersExecutableMaxBuyRequestsPerTick} buys plus {topTradersExecutableMaxSellRequestsPerTick} exits per tick after {Math.round(topTradersExecutableSignalConfirmMs / 1000)}s confirmation and {Math.round(topTradersExecutableRetryDelayMs / 1000)}s retry spacing.</span>
            </div>
          </div>
        </section>

        <section className="panel arena-history-panel full">
          <div className="panel-heading compact">
            <div>
              <h2>Current Ranked Roster</h2>
              <span className="panel-subtitle">Roster is sourced from all algos; performance columns are executable dry-run only</span>
            </div>
            <Gauge size={16} />
          </div>
          <div className="upgrade-table-wrap">
            <table className="activated-table top-traders-table">
              <colgroup>
                <col className="top-col-fav" />
                <col className="top-col-rank" />
                <col className="top-col-slot" />
                <col className="top-col-id" />
                <col className="top-col-type" />
                <col className="top-col-trades" />
                <col className="top-col-attempts" />
                <col className="top-col-wl" />
                <col className="top-col-money" />
                <col className="top-col-money" />
                <col className="top-col-roi" />
                <col className="top-col-status" />
              </colgroup>
              <thead>
                <tr>
                  <th>Fav</th>
                  <SortableTopTraderHeader sortKey="rank" sorts={topTraderSorts} onSort={changeSort}>Rank</SortableTopTraderHeader>
                  <SortableTopTraderHeader sortKey="bucket" sorts={topTraderSorts} onSort={changeSort}>Slot</SortableTopTraderHeader>
                  <SortableTopTraderHeader sortKey="id" sorts={topTraderSorts} onSort={changeSort}>ID</SortableTopTraderHeader>
                  <SortableTopTraderHeader sortKey="type" sorts={topTraderSorts} onSort={changeSort}>Type</SortableTopTraderHeader>
                  <SortableTopTraderHeader sortKey="allTrades" sorts={topTraderSorts} onSort={changeSort}>Buys / Exits</SortableTopTraderHeader>
                  <SortableTopTraderHeader sortKey="topRun" sorts={topTraderSorts} onSort={changeSort}>Accepted / Attempts</SortableTopTraderHeader>
                  <SortableTopTraderHeader sortKey="winLoss" sorts={topTraderSorts} onSort={changeSort}>W / L</SortableTopTraderHeader>
                  <SortableTopTraderHeader sortKey="avgProfitTrade" sorts={topTraderSorts} onSort={changeSort}>Avg / Trade</SortableTopTraderHeader>
                  <SortableTopTraderHeader sortKey="pnl15" sorts={topTraderSorts} onSort={changeSort}>P/L / 15m</SortableTopTraderHeader>
                  <SortableTopTraderHeader sortKey="roi" sorts={topTraderSorts} onSort={changeSort}>ROI</SortableTopTraderHeader>
                  <SortableTopTraderHeader sortKey="status" sorts={topTraderSorts} onSort={changeSort}>Status</SortableTopTraderHeader>
                </tr>
              </thead>
              <tbody>
                {rosterRows.length === 0 ? (
                  <tr>
                    <td className="empty-cell" colSpan={12}>No top-trader roster yet. Let batch tests produce realistic single-entry evidence first.</td>
                  </tr>
                ) : sortedRosterRows.map((row) => {
                  const strategyId = paperStrategyIdForActivatedRow(row);
                  const isActive = arena.status === "running" && selectedIds.has(strategyId);
                  const isFavorite = favoriteSourceSet.has(row.sourceAlgoId);
                  const execStats = executableStats[row.sourceAlgoId];
                  const execSummary = topTraderExecutableSummary(execStats);
                  const execRow = executableActivatedRow(row, execSummary, execStats, executableState.startedAt, asOf);
                  const pnlPerCycle = activatedPnlPerCycle(execRow, asOf);
                  const avgProfitPerTrade = topTraderAverageProfitPerTrade(execRow);
                  const acceptanceRate = topTraderExecutableAcceptanceRate(execStats);
                  const confidence = activatedConfidence(execRow, asOf);
                  const research = factoryEvidenceForTopTraderRow(row, factoryEvidenceBySource);
                  const expanded = tradeViewer.sourceAlgoId === row.sourceAlgoId;
                  const executablePositions = expanded ? topTraderExecutablePositionsForSource(executableState.positions, row.sourceAlgoId) : [];
                  return (
                    <Fragment key={row.sourceAlgoId}>
                      <tr className={expanded ? "activated-row-expanded" : undefined}>
                        <td>
                          <button
                            aria-label={isFavorite ? `Remove ${row.displayId} from favorites` : `Favorite ${row.displayId}`}
                            className={isFavorite ? "favorite-button active" : "favorite-button"}
                            title={isFavorite ? "Remove from favorites" : "Add to favorites"}
                            type="button"
                            onClick={() => onToggleFavorite(row.sourceAlgoId)}
                          >
                            <Star fill={isFavorite ? "currentColor" : "none"} size={14} />
                          </button>
                        </td>
                        <td>#{row.rank}</td>
                        <td>
                          <div className="confidence-cell">
                            <Badge tone={topTraderBucketTone(row.bucket)}>{topTraderBucketLabel(row.bucket)}</Badge>
                            {row.bucket === "champion" && (!research || research.nonPromotable) && (
                              <Badge tone="warn">Dry-run champ</Badge>
                            )}
                          </div>
                        </td>
                        <td><span className="algo-id-pill">{row.displayId}</span></td>
                        <td>
                          <div className="candidate-name compact-name">
                            <strong>{familyLabel(row.family)}</strong>
                            <span>{activatedBatchLabel(row)}</span>
                          </div>
                        </td>
                        <td>
                          <div className="metric-cell">
                            <strong>{row.liveStats.buys} / {row.liveStats.sells}</strong>
                            <span>{row.liveStats.open} open</span>
                            <span>buys / exits</span>
                            <span>{row.lastTransactionAt ? `Last ${formatTime(new Date(row.lastTransactionAt))}` : "No tx yet"}</span>
                          </div>
                        </td>
                        <td>
                          <div className="metric-cell">
                            <strong>{execStats ? `${execStats.acceptedBuys} / ${execStats.attempts}` : "0 / 0"}</strong>
                            <span>accepted / total tries</span>
                            <span>{execStats ? `${execStats.rejected} rejects` : "0 rejects"}</span>
                            <span>{acceptanceRate === null ? "accept -" : `${percent(acceptanceRate)} accept`}</span>
                          </div>
                        </td>
                        <td>{execSummary.wins} / {execSummary.losses}</td>
                        <td className={avgProfitPerTrade === null ? "muted" : avgProfitPerTrade >= 0 ? "positive" : "negative"}>{avgProfitPerTrade === null ? "-" : signedMoney(avgProfitPerTrade)}</td>
                        <td className={pnlPerCycle >= 0 ? "positive" : "negative"}>{signedMoney(pnlPerCycle)}</td>
                        <td>{execSummary.roi === null ? "-" : percent(execSummary.roi)}</td>
                        <td>
                          <div className="confidence-cell">
                            <Badge tone={isActive ? "good" : arena.status === "running" ? "info" : "neutral"}>{isActive ? "ACTIVE" : arena.status === "running" ? "QUEUED" : "READY"}</Badge>
                            <Badge tone={confidence.tone}>{confidence.label}</Badge>
                            <Badge tone={topTraderResearchTone(research)}>{topTraderResearchLabel(research)}</Badge>
                            {research && (
                              <>
                                <Badge tone={research.holdoutPass && research.holdoutStrictlyLater ? "good" : "bad"}>{research.holdoutPass ? "Holdout ok" : "Holdout fail"}</Badge>
                                <Badge tone={!research.paperEvidence.available ? "neutral" : research.paperEvidence.driftOk ? "good" : "warn"}>{research.paperEvidence.available ? `Paper ${research.paperEvidence.status}` : "Paper req"}</Badge>
                              </>
                            )}
                            <button className="ghost-button table-button" type="button" onClick={() => toggleTradeViewer(row.sourceAlgoId)}>
                              {expanded ? "Hide Trades" : "Trades"}
                            </button>
                          </div>
                        </td>
                      </tr>
                      {expanded && (
                        <tr className="activated-trade-detail-row">
                          <td colSpan={12}>
                            <TopTraderExecutableTradeHistoryPanel row={execRow} positions={executablePositions} onClose={closeTradeViewer} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </section>
  );
}

function TopTraderExecutableTradeHistoryPanel({
  row,
  positions,
  onClose,
}: {
  row: ActivatedAlgoRow;
  positions: LiveManagedPosition[];
  onClose: () => void;
}) {
  const closedPositions = positions.filter((position) => position.status === "closed" && position.realizedPnl !== null);
  const detailedOpenCount = positions.filter((position) => position.status === "open").length;
  const aggregate = row.liveStats;
  const totalPnl = roundDisplayMoney(aggregate.totalPnl);
  const roi = aggregate.roi ?? (aggregate.totalCost > 0 ? roundDisplayRatio(totalPnl / aggregate.totalCost) : null);
  const detailDiffers = positions.length > 0
    && (positions.length !== aggregate.buys || detailedOpenCount !== aggregate.open || closedPositions.length !== aggregate.sells);
  const message = positions.length === 0 && (row.liveStats.buys > 0 || row.liveStats.sells > 0)
    ? "This algo has aggregate executable stats, but detailed rows were not available from older Top Traders data."
    : detailDiffers
      ? "Detailed position rows are partial or legacy; headline stats use the aggregate executable totals shown in the roster."
    : null;
  const executionDescription = algoExecutionDescription(row);

  return (
    <div className="activated-trade-panel top-trader-trade-panel">
      <div className="activated-trade-heading">
        <div>
          <h3>{row.displayId} Top Traders Trades</h3>
          <span>{shortAlgoName(row.name)} / {activatedBatchLabel(row)} / {activationDuration(row.activatedAt, row.deactivatedAt ?? new Date().toISOString())}</span>
        </div>
        <div className="activated-trade-metrics">
          <StatLine label="Entries" value={countOrDash(aggregate.buys)} />
          <StatLine label="Open" value={countOrDash(aggregate.open)} />
          <StatLine label="W / L" value={`${countOrDash(aggregate.wins)} / ${countOrDash(aggregate.losses)}`} />
          <StatLine label="P/L" value={signedMoney(totalPnl)} tone={totalPnl >= 0 ? "positive" : "negative"} />
          <StatLine label="ROI" value={roi === null ? "-" : percent(roi)} tone={roi === null ? undefined : roi >= 0 ? "positive" : "negative"} />
        </div>
        <button className="ghost-button" type="button" onClick={onClose}>Close</button>
      </div>
      {message && <p className="table-note">{message}</p>}
      <p className="table-note">Buys / exits means accepted buy fills versus closed exits. Accepted / attempts means accepted buys versus every live-like router try, including rejects.</p>
      <p className="table-note">{executionDescription}</p>
      {positions.length === 0 ? (
        <p className="table-note">No executable dry-run trade rows found for this algo yet.</p>
      ) : (
        <div className="paper-table-wrap activated-trades-wrap top-trader-trades-wrap">
          <table>
            <thead>
              <tr>
                <th>Opened</th>
                <th>Closed</th>
                <th>Market</th>
                <th>Side</th>
                <th>Contracts</th>
                <th>Entry</th>
                <th>Exit</th>
                <th>Cost</th>
                <th>Status</th>
                <th>P/L</th>
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>
              {positions.map((position) => (
                <tr key={`${position.id}:${position.openedAt}:${position.closedAt ?? "open"}`}>
                  <td>{formatTime(new Date(position.openedAt))}</td>
                  <td>{position.closedAt ? formatTime(new Date(position.closedAt)) : "-"}</td>
                  <td>{position.ticker}</td>
                  <td><span className={position.side === "YES" ? "side yes" : "side no"}>{position.side}</span></td>
                  <td>{countOrDash(position.contracts)}</td>
                  <td>{contractPrice(position.entryPrice)}</td>
                  <td>{position.exitPrice === null ? "-" : contractPrice(position.exitPrice)}</td>
                  <td>{money(topTraderExecutablePositionCost(position))}</td>
                  <td>{position.status}</td>
                  <td className={position.realizedPnl === null ? "muted" : position.realizedPnl >= 0 ? "positive" : "negative"}>{position.realizedPnl === null ? "-" : signedMoney(position.realizedPnl)}</td>
                  <td><div className="trade-reason" title={position.exitReason ?? undefined}>{position.exitReason ?? (position.status === "open" ? "Open position" : "-")}</div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function topTraderExecutablePositionsForSource(positions: LiveManagedPosition[], sourceAlgoId: string) {
  return positions
    .filter((position) => position.algoSourceId === sourceAlgoId)
    .sort((left, right) => Date.parse(right.openedAt) - Date.parse(left.openedAt));
}

function topTraderExecutablePositionCost(position: LiveManagedPosition) {
  return roundDisplayMoney(position.entryPrice * position.contracts);
}

function algoExecutionDescription(row: Pick<ActivatedAlgoRow, "family" | "params">) {
  const params = row.params;
  const maxSpread = ratioParamLabel(params, "maxSpread");
  const minEdge = ratioParamLabel(params, "minEdge");
  const feeBuffer = ratioParamLabel(params, "feeBuffer");
  const maxAsk = ratioParamLabel(params, "maxAsk");
  const takeProfit = ratioParamLabel(params, "takeProfit");
  const stopLoss = ratioParamLabel(params, "stopLoss");
  const maxHold = secondsParamLabel(params, "maxHoldSeconds");
  const exitParts = [
    takeProfit ? `take profit around ${takeProfit}` : null,
    stopLoss ? `stop loss around ${stopLoss}` : null,
    maxHold ? `max hold ${maxHold}` : null,
  ].filter(Boolean).join(", ");
  const exitText = exitParts ? ` It exits on ${exitParts}, or near contract close.` : " It exits when the live managed-exit rules see profit, loss, a flip, or the close window.";

  if (row.family === "sweep-scalp") {
    return `Execution profile: scalp. It buys the side with the best estimated edge when spread is at most ${maxSpread ?? "the algo limit"} and edge after fees is at least ${minEdge ?? "the algo limit"}.${exitText}`;
  }
  if (row.family === "sweep-managed-scalp") {
    return `Execution profile: managed scalp. It buys the best side only when spread, fees, and model edge all fit the algo limits${minEdge ? `, including at least ${minEdge} edge` : ""}.${exitText}`;
  }
  if (row.family === "sweep-momentum" || row.family === "sweep-momentum-trail") {
    const minMove = ratioParamLabel(params, "minMovePercent");
    return `Execution profile: momentum. It buys with the current DOGE move when the one-minute move is strong enough${minMove ? `, at least ${minMove}` : ""}, the spread is acceptable${maxSpread ? `, at most ${maxSpread}` : ""}, and edge remains positive after fees.${exitText}`;
  }
  if (row.family === "sweep-fade-momentum") {
    const minMove = ratioParamLabel(params, "minMovePercent");
    return `Execution profile: momentum fade. It buys against a recent DOGE move when the move is large enough${minMove ? `, at least ${minMove}` : ""}, the spread is acceptable, and the contract price still leaves edge after fees.${exitText}`;
  }
  if (row.family === "sweep-distance") {
    const minDistance = decimalParamLabel(params, "minDistance");
    return `Execution profile: distance. It compares the DOGE estimate to the target line and buys the side implied by that distance once the gap is large enough${minDistance ? `, about ${minDistance}` : ""}, with positive edge after fees.${exitText}`;
  }
  if (row.family === "sweep-target-revert") {
    const maxDistance = decimalParamLabel(params, "maxDistance");
    return `Execution profile: target reversion. It looks for DOGE close to the target line${maxDistance ? `, within about ${maxDistance}` : ""}, then buys the side that benefits from a reversion toward the line if price and spread still leave edge.${exitText}`;
  }
  if (row.family === "sweep-late-lock" || row.family === "sweep-kalshi-lag-lock") {
    const minSeconds = secondsParamLabel(params, "minSecondsToClose");
    const maxSeconds = secondsParamLabel(params, "maxSecondsToClose");
    return `Execution profile: late lock. It waits for the final window${minSeconds || maxSeconds ? ` (${minSeconds ?? "0s"} to ${maxSeconds ?? "the algo max"} remaining)` : ""}, then buys only when DOGE appears far enough from the line or Kalshi price has not caught up. It also checks ask price, spread, edge, and book depth before buying.${exitText}`;
  }
  if (row.family === "sweep-late-favorite") {
    return `Execution profile: late favorite. It waits until late in the contract, then buys the side with high fair probability if the ask is not too expensive${maxAsk ? `, at most ${maxAsk}` : ""}, spread is acceptable, and edge is positive.${exitText}`;
  }
  if (row.family === "sweep-cheap-longshot") {
    return `Execution profile: cheap longshot. It looks for a low ask price${maxAsk ? `, at most ${maxAsk}` : ""}, enough estimated edge after fees, and enough time left before close.${exitText}`;
  }
  if (row.family === "sweep-liquidity-imbalance") {
    const minImbalance = ratioParamLabel(params, "minImbalance");
    return `Execution profile: liquidity imbalance. It buys the side where order-book depth is leaning hardest${minImbalance ? `, at least ${minImbalance} imbalance` : ""}, while spread and edge stay inside the algo limits.${exitText}`;
  }
  if (row.family === "sweep-order-flow-pressure") {
    const minPressure = ratioParamLabel(params, "minPressure");
    return `Execution profile: order-flow pressure. It buys when bid/ask pressure favors one side${minPressure ? `, at least ${minPressure}` : ""}, with enough visible depth, acceptable spread, and enough edge after fees.${exitText}`;
  }
  if (row.family === "sweep-model" || row.family === "sweep-fade-model") {
    return `Execution profile: model window. It follows or fades the model signal depending on the family, then requires acceptable spread${maxSpread ? `, at most ${maxSpread}` : ""}, confidence, and edge after fees${feeBuffer ? ` after a ${feeBuffer} fee buffer` : ""}.${exitText}`;
  }
  return `Execution profile: ${familyLabel(row.family)}. It executes only when its generated signal selects a side, the live-like router can fill at the allowed price, and the edge remains positive after fees.${exitText}`;
}

function ratioParamLabel(params: Record<string, unknown>, key: string) {
  const value = numberOrNull(params[key]);
  if (value === null) return null;
  if (key === "maxSpread" || key === "takeProfit" || key === "stopLoss" || key === "trailingStop" || key === "trailAfterProfit" || key === "maxAsk") {
    return `${(value * 100).toFixed(value * 100 < 10 ? 1 : 0)}c`;
  }
  return percent(value);
}

function decimalParamLabel(params: Record<string, unknown>, key: string) {
  const value = numberOrNull(params[key]);
  if (value === null) return null;
  return value.toFixed(5);
}

function secondsParamLabel(params: Record<string, unknown>, key: string) {
  const value = numberOrNull(params[key]);
  if (value === null) return null;
  return `${Math.round(value)}s`;
}

function SortableTopTraderHeader({
  children,
  onSort,
  sortKey,
  sorts,
}: {
  children: ReactNode;
  onSort: (key: TopTraderSortKey, additive: boolean) => void;
  sortKey: TopTraderSortKey;
  sorts: TopTraderSortChain;
}) {
  const activeIndex = sorts.findIndex((sort) => sort.key === sortKey);
  const active = activeIndex >= 0;
  const direction = active ? sorts[activeIndex].direction : null;
  return (
    <th>
      <button
        className={active ? "sortable-header active" : "sortable-header"}
        title="Click to sort only. Shift-click to sort by this first and keep current sorts as tie-breakers."
        type="button"
        onClick={(event) => onSort(sortKey, event.shiftKey)}
      >
        <span>{children}</span>
        <b>{active && direction ? `${activeIndex + 1}${direction === "asc" ? "^" : "v"}` : ""}</b>
      </button>
    </th>
  );
}

function nextTopTraderSortChain(current: TopTraderSortChain, key: TopTraderSortKey, additive: boolean): TopTraderSortChain {
  const existingIndex = current.findIndex((sort) => sort.key === key);
  const existing = existingIndex >= 0 ? current[existingIndex] : null;
  const nextDirection = existing ? existing.direction === "asc" ? "desc" : "asc" : defaultTopTraderSortDirection(key);
  if (!additive) {
    return [{ key, direction: existingIndex === 0 ? nextDirection : defaultTopTraderSortDirection(key) }];
  }
  if (existingIndex >= 0) {
    return [
      { key, direction: nextDirection },
      ...current.filter((_, index) => index !== existingIndex),
    ];
  }
  return [
    { key, direction: defaultTopTraderSortDirection(key) },
    ...current,
  ];
}

function defaultTopTraderSortDirection(key: TopTraderSortKey): TopTraderSort["direction"] {
  if (key === "rank" || key === "bucket" || key === "id" || key === "type") return "asc";
  return "desc";
}

function sortTopTraderRows(
  rows: TopTraderRow[],
  sorts: TopTraderSortChain,
  asOf: string,
  status: PaperArenaStatus,
  selectedIds: Set<string>,
  executableStats: Record<string, TopTraderExecutableStats> = {},
  executableStartedAt: string | null = null,
) {
  const chain = sorts.length > 0 ? sorts : [{ key: "rank", direction: "asc" } satisfies TopTraderSort];
  return rows.slice().sort((left, right) => {
    for (const sort of chain) {
      const comparison = compareTopTraderRowsForSort(left, right, sort.key, asOf, status, selectedIds, executableStats, executableStartedAt);
      if (comparison !== 0) return sort.direction === "asc" ? comparison : -comparison;
    }
    return left.rank - right.rank;
  });
}

function compareTopTraderRowsForSort(
  left: TopTraderRow,
  right: TopTraderRow,
  key: TopTraderSortKey,
  asOf: string,
  status: PaperArenaStatus,
  selectedIds: Set<string>,
  executableStats: Record<string, TopTraderExecutableStats> = {},
  executableStartedAt: string | null = null,
) {
  const leftExec = topTraderExecutableSortRow(left, executableStats, executableStartedAt, asOf);
  const rightExec = topTraderExecutableSortRow(right, executableStats, executableStartedAt, asOf);
  if (key === "rank") return left.rank - right.rank;
  if (key === "bucket") return topTraderBucketOrder(left.bucket) - topTraderBucketOrder(right.bucket);
  if (key === "id") return left.displayId.localeCompare(right.displayId, undefined, { numeric: true, sensitivity: "base" });
  if (key === "type") return familyLabel(left.family).localeCompare(familyLabel(right.family), undefined, { numeric: true, sensitivity: "base" });
  if (key === "allTrades") return numericSortValue(left.liveStats.sells, right.liveStats.sells)
    || numericSortValue(left.liveStats.buys, right.liveStats.buys);
  if (key === "topRun") return numericSortValue(executableStats[left.sourceAlgoId]?.acceptedBuys ?? 0, executableStats[right.sourceAlgoId]?.acceptedBuys ?? 0)
    || numericSortValue(executableStats[left.sourceAlgoId]?.attempts ?? 0, executableStats[right.sourceAlgoId]?.attempts ?? 0);
  if (key === "winLoss") return numericSortValue(topTraderWinRate(leftExec), topTraderWinRate(rightExec))
    || numericSortValue(leftExec.liveStats.wins - leftExec.liveStats.losses, rightExec.liveStats.wins - rightExec.liveStats.losses);
  if (key === "reliability") return numericSortValue(left.reliabilityScore, right.reliabilityScore);
  if (key === "trades15") return numericSortValue(topTraderClosedTradesPerCycle(leftExec, asOf), topTraderClosedTradesPerCycle(rightExec, asOf));
  if (key === "avgProfitTrade") return numericSortValue(topTraderAverageProfitPerTrade(leftExec) ?? Number.NEGATIVE_INFINITY, topTraderAverageProfitPerTrade(rightExec) ?? Number.NEGATIVE_INFINITY);
  if (key === "pnl15") return numericSortValue(activatedPnlPerCycle(leftExec, asOf), activatedPnlPerCycle(rightExec, asOf));
  if (key === "roi") return numericSortValue(leftExec.liveStats.roi ?? Number.NEGATIVE_INFINITY, rightExec.liveStats.roi ?? Number.NEGATIVE_INFINITY);
  return numericSortValue(topTraderStatusOrder(left, status, selectedIds), topTraderStatusOrder(right, status, selectedIds));
}

function topTraderExecutableSortRow(row: TopTraderRow, executableStats: Record<string, TopTraderExecutableStats>, executableStartedAt: string | null, asOf: string) {
  const stats = executableStats[row.sourceAlgoId];
  return executableActivatedRow(row, topTraderExecutableSummary(stats), stats, executableStartedAt, asOf);
}

function rankTopTraderRowsByExecutableStats(rows: TopTraderRow[], executableState: TopTraderExecutableState, asOf: string): TopTraderRow[] {
  const scored = rows.map((row) => executableTopTraderScore(row, executableState, asOf));
  const selected = new Set<string>();
  const pickRows = (
    candidates: ExecutableTopTraderScore[],
    limit: number,
    bucket: TopTraderBucket,
  ) => {
    const picked: TopTraderRow[] = [];
    for (const item of candidates.sort(compareExecutableTopTraderScores)) {
      if (picked.length >= limit) break;
      if (selected.has(item.row.sourceAlgoId)) continue;
      selected.add(item.row.sourceAlgoId);
      picked.push(executableRankedTopTraderRow(item, bucket));
    }
    return picked;
  };

  const champions = pickRows(
    scored.filter((item) => executableChampionEligible(item, asOf)),
    topTradersChampionSlots,
    "champion",
  );
  const prospects = pickRows(
    scored.filter((item) => executableProspectEligible(item, asOf) && !selected.has(item.row.sourceAlgoId)),
    topTradersProspectSlots,
    "prospect",
  );
  const watchLimit = Math.max(0, topTradersRosterSize - champions.length - prospects.length);
  const watchQueue = pickRows(
    scored.filter((item) => item.row.bucket !== "standby" && !selected.has(item.row.sourceAlgoId)),
    watchLimit,
    "wildcard",
  );
  const standby = scored
    .filter((item) => !selected.has(item.row.sourceAlgoId))
    .sort(compareExecutableTopTraderScores)
    .map((item) => executableRankedTopTraderRow(item, "standby"));

  return [...champions, ...prospects, ...watchQueue, ...standby].map((row, index) => ({
    ...row,
    rank: index + 1,
    isInTopRoster: row.bucket !== "standby",
  }));
}

function executableRankedTopTraderRow(item: ExecutableTopTraderScore, bucket: TopTraderBucket): TopTraderRow {
  return {
    ...item.row,
    bucket,
    runnerStats: item.summary,
    liveStats: item.summary,
    activatedAt: item.execRow.activatedAt,
    deactivatedAt: item.execRow.deactivatedAt,
    lastTransactionAt: item.execRow.lastTransactionAt,
    cycleCount: item.execRow.cycleCount,
    fullCycleCount: item.execRow.fullCycleCount,
    reliabilityScore: item.reliabilityScore,
    score: item.score,
    prospectScore: item.score,
  };
}

function executableTopTraderScore(row: TopTraderRow, executableState: TopTraderExecutableState, asOf: string): ExecutableTopTraderScore {
  const stats = executableState.stats[row.sourceAlgoId];
  const summary = topTraderExecutableSummary(stats);
  const execRow = executableActivatedRow(row, summary, stats, executableState.startedAt, asOf);
  const attempts = stats?.attempts ?? 0;
  const accepted = stats?.acceptedBuys ?? 0;
  const rejected = stats?.rejected ?? 0;
  const acceptanceRate = attempts > 0 ? accepted / attempts : 0;
  const resolved = Math.max(1, summary.wins + summary.losses);
  const winRate = summary.wins / resolved;
  const pnlPerCycle = activatedPnlPerCycle(execRow, asOf);
  const avgProfit = topTraderAverageProfitPerTrade(execRow) ?? 0;
  const roi = summary.roi ?? 0;
  const rejectRate = attempts > 0 ? rejected / attempts : 0;
  const staleRejects = stats?.staleRejects ?? 0;
  const depthRejects = stats?.depthRejects ?? 0;
  const gateRejects = stats?.gateRejects ?? 0;
  const edgeRejects = stats?.edgeRejects ?? 0;
  const priceRejects = stats?.priceRejects ?? 0;
  const hasDryEvidence = attempts > 0 || accepted > 0 || summary.sells > 0;
  const confidence = activatedConfidence(execRow, asOf);
  const rawScore = hasDryEvidence
    ? accepted * 3
    + summary.sells * 4
    + Math.min(80, Math.max(-80, pnlPerCycle * 350))
    + Math.min(45, Math.max(-45, avgProfit * 180))
    + Math.min(35, Math.max(-35, roi * 75))
    + acceptanceRate * 35
    + winRate * 20
    - rejectRate * 35
    - staleRejects * 2.5
    - depthRejects * 1.5
    - gateRejects * 2
    - edgeRejects * 3
    - priceRejects
    : -10_000;
  const score = hasDryEvidence
    ? roundDisplayRatio(rawScore > 0 ? rawScore * confidence.scoreMultiplier : rawScore)
    : -10_000;
  return {
    row,
    stats,
    summary,
    execRow,
    score,
    reliabilityScore: hasDryEvidence ? score : 0,
    acceptanceRate,
    pnlPerCycle,
    winRate,
    hasDryEvidence,
  };
}

function executableChampionEligible(item: ExecutableTopTraderScore, asOf: string) {
  const confidence = activatedConfidence(item.execRow, asOf);
  return item.hasDryEvidence
    && (item.stats?.attempts ?? 0) >= 15
    && (item.stats?.acceptedBuys ?? 0) >= 8
    && item.summary.sells >= topTradersChampionMinClosedTrades
    && item.summary.totalPnl > 0
    && item.pnlPerCycle > 0
    && item.winRate >= topTradersChampionMinWinRate
    && confidence.liveEligible;
}

function executableProspectEligible(item: ExecutableTopTraderScore, asOf: string) {
  return item.hasDryEvidence
    && !executableChampionEligible(item, asOf)
    && (item.stats?.acceptedBuys ?? 0) > 0
    && item.summary.sells >= topTradersProspectMinClosedTrades
    && item.score > 0
    && item.summary.totalPnl >= 0
    && item.pnlPerCycle >= 0
    && item.acceptanceRate >= 0.1;
}

function compareExecutableTopTraderScores(left: ExecutableTopTraderScore, right: ExecutableTopTraderScore) {
  return right.score - left.score
    || Number(right.hasDryEvidence) - Number(left.hasDryEvidence)
    || (right.stats?.acceptedBuys ?? 0) - (left.stats?.acceptedBuys ?? 0)
    || (right.stats?.attempts ?? 0) - (left.stats?.attempts ?? 0)
    || left.row.displayId.localeCompare(right.row.displayId, undefined, { numeric: true, sensitivity: "base" });
}

function numericSortValue(left: number, right: number) {
  return left - right;
}

function topTraderBucketOrder(bucket: TopTraderBucket) {
  if (bucket === "champion") return 0;
  if (bucket === "prospect") return 1;
  if (bucket === "wildcard") return 2;
  return 3;
}

function topTraderWinRate(row: { liveStats: PaperSummarySnapshot }) {
  const resolved = row.liveStats.wins + row.liveStats.losses;
  return resolved > 0 ? row.liveStats.wins / resolved : -1;
}

function topTraderClosedTradesPerCycle(row: { activatedAt: string; deactivatedAt: string | null; liveStats: PaperSummarySnapshot; cycleCount?: number }, fallbackEnd: string) {
  const cycles = activatedCycleCountForRow(row, fallbackEnd);
  return roundDisplayRatio(row.liveStats.sells / cycles);
}

function topTraderAverageProfitPerTrade(row: { liveStats: PaperSummarySnapshot }) {
  return row.liveStats.sells > 0 ? roundDisplayMoney(row.liveStats.totalPnl / row.liveStats.sells) : null;
}

function topTraderStatusOrder(row: TopTraderRow, status: PaperArenaStatus, selectedIds: Set<string>) {
  if (status === "running" && selectedIds.has(paperStrategyIdForActivatedRow(row))) return 2;
  if (status === "running") return 1;
  return 0;
}

function LiveTradingView({
  activatedDataClearToken,
  favoriteSourceIds,
  generatedPaperAlgos,
  kalshiPortfolio,
  lookupPaperAlgos = [],
  onSetDryRunMode,
  onSetLiveSwitch,
  onRunnerStatusChange,
  onToggleFavorite,
  routerStatus,
  snapshot,
  topTradersExecutable,
  topTraderRows,
}: {
  activatedDataClearToken: number;
  favoriteSourceIds: string[];
  generatedPaperAlgos: GeneratedPaperAlgo[];
  kalshiPortfolio: KalshiPortfolioSummary;
  lookupPaperAlgos?: GeneratedPaperAlgo[];
  onSetDryRunMode: (dryRun: boolean) => Promise<LiveOrderRouterStatus>;
  onSetLiveSwitch: (enabled: boolean) => Promise<LiveOrderRouterStatus>;
  onRunnerStatusChange: (status: PaperArenaStatus) => void;
  onToggleFavorite: (sourceAlgoId: string) => void;
  routerStatus: LiveOrderRouterStatus;
  snapshot: RuntimeSnapshot;
  topTradersExecutable: TopTraderExecutableState;
  topTraderRows: TopTraderRow[];
}) {
  const availableLiveAlgos = useMemo(() => mergeLiveAlgoLists(generatedPaperAlgos, lookupPaperAlgos), [generatedPaperAlgos, lookupPaperAlgos]);
  const [liveRunner, setLiveRunner] = useState<LiveRunnerState>(() => loadLiveRunnerState());
  const [selectedAlgoId, setSelectedAlgoId] = useState<string>(liveRunner.selectedAlgoId ?? "");
  const [selectedLiveAlgoIds, setSelectedLiveAlgoIds] = useState<string[]>(() => uniqueStringList(liveRunner.selectedAlgoIds.length > 0
    ? liveRunner.selectedAlgoIds
    : liveRunner.selectedAlgoId ? [liveRunner.selectedAlgoId] : []));
  const [lookupAlgoId, setLookupAlgoId] = useState("");
  const [maxBet, setMaxBet] = useState(String(liveRunner.maxBet));
  const [allowLiveRepeatBuys, setAllowLiveRepeatBuys] = useState(liveRunner.allowRepeatBuys);
  const [liveLog, setLiveLog] = useState<LiveExecutionLogEntry[]>(() => loadLiveExecutionLog());
  const [livePositions, setLivePositions] = useState<LiveManagedPosition[]>(() => loadLiveManagedPositions());
  const [liveRetryTick, setLiveRetryTick] = useState(0);
  const [submitState, setSubmitState] = useState<LiveOrderSubmitState>({
    status: "idle",
    message: null,
    clientOrderId: null,
    dryRun: true,
  });
  const [liveSwitchSubmitting, setLiveSwitchSubmitting] = useState(false);
  const [liveModeSubmitting, setLiveModeSubmitting] = useState(false);
  const completedLiveOrderKeysRef = useRef<Set<string>>(new Set());
  const lastLiveOrderAttemptAtRef = useRef<Record<string, number>>({});
  const lastLiveSellAttemptAtRef = useRef<Record<string, number>>({});
  const liveSignalSeenRef = useRef<Record<string, { fingerprint: string; firstSeenAt: number; lastSeenAt: number }>>({});
  const liveExecutionBlockedUntilRef = useRef<Record<string, number>>({});
  const liveRosterCursorRef = useRef(0);
  const liveSubmittingRef = useRef(false);
  const runStatus = liveRunner.status;
  const selectedAlgoIsAvailable = selectedAlgoId ? availableLiveAlgos.some((algo) => algo.id === selectedAlgoId) : false;
  const effectiveSelectedAlgoId = selectedAlgoIsAvailable ? selectedAlgoId : "";
  const selectedAlgo = availableLiveAlgos.find((algo) => algo.id === effectiveSelectedAlgoId) ?? null;
  const selectedLiveAlgos = useMemo(() => {
    const selectedIds = uniqueStringList(selectedLiveAlgoIds);
    return selectedIds
      .map((id) => availableLiveAlgos.find((algo) => algo.id === id) ?? null)
      .filter((algo): algo is GeneratedPaperAlgo => algo !== null);
  }, [availableLiveAlgos, selectedLiveAlgoIds]);
  const runnableLiveAlgos = selectedLiveAlgos;
  const liveRosterLabel = `${runnableLiveAlgos.length} algo${runnableLiveAlgos.length === 1 ? "" : "s"}`;
  const liveAlgoLookup = useMemo(() => liveAlgoLookupMap(availableLiveAlgos), [availableLiveAlgos]);
  const lookupMatchedAlgo = useMemo(() => findLiveAlgoByTypedId(liveAlgoLookup, lookupAlgoId), [liveAlgoLookup, lookupAlgoId]);
  const nowLivePnlRows = useMemo(() => buildNowLiveAlgoPnlRows(liveLog, livePositions, availableLiveAlgos, snapshot), [availableLiveAlgos, liveLog, livePositions, snapshot]);
  const nowLivePnlBySource = useMemo(() => new Map(nowLivePnlRows
    .filter((row) => row.key.startsWith("source:"))
    .map((row) => [row.key.slice("source:".length), row])), [nowLivePnlRows]);
  const dryLiveProbationCounts = useMemo(() => Object.values(liveRunner.dryLiveProbation).reduce<{ testing: number; passed: number; failed: number }>((counts, record) => {
    counts[record.status] += 1;
    return counts;
  }, { testing: 0, passed: 0, failed: 0 }), [liveRunner.dryLiveProbation]);
  const favoriteLiveAlgos = useMemo(() => favoriteAlgosForLive(availableLiveAlgos, favoriteSourceIds), [availableLiveAlgos, favoriteSourceIds]);
  const favoriteStatsBySource = useMemo(() => new Map(topTraderRows.map((row) => [row.sourceAlgoId, row])), [topTraderRows]);
  const dryLiveReadyRows = useMemo(() => topTraderRows
    .filter((row) => liveRunner.dryLiveProbation[row.sourceAlgoId] === undefined)
    .filter((row) => topTraderDryLiveReady(row, topTradersExecutable.stats[row.sourceAlgoId], snapshot.generatedAt))
    .slice(0, dryLivePromotionMaxAlgos), [liveRunner.dryLiveProbation, snapshot.generatedAt, topTraderRows, topTradersExecutable.stats]);
  const dryLiveReadyAlgos = useMemo(() => {
    const bySource = new Map(availableLiveAlgos.map((algo) => [algo.sourceAlgoId, algo]));
    return dryLiveReadyRows
      .map((row) => bySource.get(row.sourceAlgoId) ?? null)
      .filter((algo): algo is GeneratedPaperAlgo => algo !== null);
  }, [availableLiveAlgos, dryLiveReadyRows]);
  const dryLiveReadySignature = dryLiveReadyAlgos.map((algo) => algo.id).join("|");
  const dryLiveProbationRows = useMemo(() => Object.values(liveRunner.dryLiveProbation)
    .map((record) => {
      const liveRow = nowLivePnlBySource.get(record.sourceAlgoId) ?? null;
      const testing = record.status === "testing";
      const attempts = testing && liveRow ? liveRow.buys + liveRow.rejects : record.attempts;
      const rejects = testing && liveRow ? liveRow.rejects : record.rejects;
      const closedExits = testing && liveRow ? liveRow.sells : record.closedExits;
      const totalPnl = testing && liveRow ? liveRow.totalPnl ?? liveRow.realizedPnl : record.totalPnl;
      const avgTrade = testing
        ? closedExits > 0 ? roundDisplayMoney((liveRow?.realizedPnl ?? 0) / closedExits) : null
        : record.avgTrade;
      const rejectRate = testing
        ? attempts > 0 ? roundDisplayRatio(rejects / attempts) : null
        : record.rejectRate;
      const lastAt = liveRow?.lastAt ?? record.reviewedAt ?? record.startedAt;
      return {
        record,
        attempts,
        rejects,
        closedExits,
        totalPnl,
        avgTrade,
        rejectRate,
        openPositions: liveRow?.openPositions ?? 0,
        lastAt,
      };
    })
    .sort((left, right) => dryLiveProbationStatusSort(left.record.status) - dryLiveProbationStatusSort(right.record.status)
      || nowLiveRowSortMs(right) - nowLiveRowSortMs(left)
      || left.record.displayId.localeCompare(right.record.displayId)), [liveRunner.dryLiveProbation, nowLivePnlBySource]);
  const dropdownAlgos = useMemo(() => liveAlgoDropdownRows(selectedAlgo, availableLiveAlgos, dryLiveProbationRows), [availableLiveAlgos, dryLiveProbationRows, selectedAlgo]);
  const livePaperInput = useMemo(() => paperInputFromSnapshot(snapshot, liveOrderFlowInputHistory), [snapshot]);
  const signal = selectedAlgo ? generatedPaperAlgoSignalPreview(livePaperInput, selectedAlgo) : null;
  const activeTicker = snapshot.kalshi.market?.ticker ?? null;
  const openLivePositions = livePositions.filter((position) => position.status === "open" && position.contracts > 0);
  const hasOpenLivePositionForActiveTicker = activeTicker !== null && openLivePositions.some((position) => position.ticker === activeTicker);
  const signalSide = signal?.side ?? null;
  const signalAction = signal?.action === "buy_yes" || signal?.action === "buy_no" ? signal.action : null;
  const signalAsk = signal?.selectedAsk ?? null;
  const priceCents = signalAsk === null ? null : Math.ceil(signalAsk * 100);
  const betCap = useMemo(() => numberFromInput(maxBet), [maxBet]);
  const liveCashDollars = kalshiPortfolio.balanceCents === null ? null : roundDisplayMoney(kalshiPortfolio.balanceCents / 100);
  const championRowsForLive = topTraderRows.filter((row) => row.bucket === "champion").slice(0, topTradersChampionSlots);
  const currentChampionCashNeed = roundDisplayMoney(championRowsForLive.length * betCap);
  const fullChampionCashNeed = roundDisplayMoney(topTradersChampionSlots * betCap);
  const championCashShortfall = liveCashDollars === null ? null : roundDisplayMoney(Math.max(0, fullChampionCashNeed - liveCashDollars));
  const routerOnline = routerStatus.state === "ready";
  const routerAvailable = routerOnline && (routerStatus.configured || routerStatus.dryRun);
  const liveEntriesEnabled = routerAvailable && routerStatus.liveSwitchEnabled && (routerStatus.dryRun || routerStatus.liveEnabled);
  const liveSellExitsEnabled = routerOnline && routerStatus.sellExitsEnabled && !routerStatus.dryRun;
  const championCashFeasible = routerStatus.dryRun
    || (liveCashDollars !== null
    && liveCashDollars >= fullChampionCashNeed
    && betCap > 0
    && betCap <= routerStatus.maxOrderDollars
    && liveEntriesEnabled);
  const championCashStatus = routerStatus.dryRun
    ? "Dry run"
    : liveCashDollars === null
    ? "-"
    : betCap <= 0
      ? "Set max trade"
      : betCap > routerStatus.maxOrderDollars
        ? "Order cap block"
        : championCashShortfall && championCashShortfall > 0
          ? `Need ${money(championCashShortfall)}`
          : liveEntriesEnabled
            ? "Cash OK"
            : routerStatus.dryRun ? "Dry run" : routerStatus.liveSwitchEnabled ? "Router blocked" : "Live off";
  const affordableContracts = priceCents !== null && priceCents > 0 ? Math.floor((betCap * 100) / priceCents) : 0;
  const orderCount = Math.min(affordableContracts, 5_000);
  const estimatedCost = priceCents !== null ? (orderCount * priceCents) / 100 : 0;
  const liveOrderCandidates = useMemo<LiveOrderCandidate[]>(() => runnableLiveAlgos.map((algo) => {
    const candidateSignal = generatedPaperAlgoSignalPreview(livePaperInput, algo);
    const candidateSignalAction = candidateSignal.action === "buy_yes" || candidateSignal.action === "buy_no" ? candidateSignal.action : null;
    const candidateSignalSide = candidateSignal.side ?? null;
    const candidateAsk = candidateSignal.selectedAsk ?? null;
    const candidatePriceCents = candidateAsk === null ? null : Math.ceil(candidateAsk * 100);
    const candidateContracts = candidatePriceCents !== null && candidatePriceCents > 0 ? Math.floor((betCap * 100) / candidatePriceCents) : 0;
    const candidateOrderCount = Math.min(candidateContracts, 5_000);
    const candidateEstimatedCost = candidatePriceCents !== null ? (candidateOrderCount * candidatePriceCents) / 100 : 0;
    const candidateOrderKey = activeTicker && candidateSignalAction && candidateSignalSide && candidatePriceCents !== null && candidateOrderCount > 0
      ? `${algo.id}:${activeTicker}`
      : null;
    const hasOpenPositionForAlgo = activeTicker !== null && openLivePositions.some((position) => position.algoId === algo.id && position.ticker === activeTicker);
    return {
      algo,
      signal: candidateSignal,
      observedAt: livePaperInput.observedAt,
      signalAction: candidateSignalAction,
      signalSide: candidateSignalSide,
      priceCents: candidatePriceCents,
      orderCount: candidateOrderCount,
      estimatedCost: candidateEstimatedCost,
      orderKey: candidateOrderKey,
      ready: activeTicker !== null
        && betCap > 0
        && liveEntriesEnabled
        && (allowLiveRepeatBuys || !hasOpenPositionForAlgo)
        && candidateSignalAction !== null
        && candidateSignalSide !== null
        && candidatePriceCents !== null
        && candidateOrderCount > 0,
    };
  }), [activeTicker, allowLiveRepeatBuys, betCap, liveEntriesEnabled, livePaperInput, openLivePositions, runnableLiveAlgos]);
  const readyLiveOrderCandidates = useMemo(() => liveOrderCandidates.filter((candidate) => candidate.ready), [liveOrderCandidates]);
  const primaryLiveOrderCandidate = selectedAlgo ? liveOrderCandidates.find((candidate) => candidate.algo.id === selectedAlgo.id) ?? null : null;
  const setupGates = [
    { label: "Kalshi Account", value: routerStatus.dryRun ? "Not required" : portfolioModeLabel(kalshiPortfolio), pass: routerStatus.dryRun || kalshiPortfolio.status === "live" },
    { label: "Order Router", value: routerAvailable ? "Backend ready" : routerStatus.state === "checking" ? "Checking" : "Unavailable", pass: routerAvailable },
    { label: "Live Switch", value: routerStatus.liveSwitchEnabled ? "On" : "Off", pass: routerStatus.liveSwitchEnabled },
    { label: "Order Mode", value: routerStatus.dryRun ? "Dry run" : routerStatus.liveEnabled ? "Real orders" : liveSellExitsEnabled ? "Exits only" : "Locked", pass: routerStatus.dryRun || liveEntriesEnabled || liveSellExitsEnabled },
    { label: "Selected Algo", value: selectedAlgo ? selectedAlgo.displayId : "None", pass: selectedAlgo !== null },
    { label: "Max Per Trade", value: betCap > 0 ? money(betCap) : "-", pass: betCap > 0 && betCap <= routerStatus.maxOrderDollars },
    { label: "Execution Mode", value: routerStatus.conservativeMode ? "Conservative" : "Standard", pass: true },
  ];
  const executionGates = [
    { label: "Algo Signal", value: signalAction ? `${signalSide} buy` : "Waiting", pass: signalAction !== null && signalSide !== null },
    { label: "Order Size", value: orderCount > 0 && priceCents !== null ? `${orderCount} @ ${priceCents}c` : "-", pass: orderCount > 0 && priceCents !== null },
  ];
  const canStart = runnableLiveAlgos.length > 0 && betCap > 0 && betCap <= routerStatus.maxOrderDollars;
  const readyToOrder = readyLiveOrderCandidates.length > 0 || primaryLiveOrderCandidate?.ready === true;
  const gates = [...setupGates, ...executionGates];
  const confirmLiveSignal = useCallback((candidate: LiveOrderCandidate, now: number) => {
    if (!candidate.orderKey || !candidate.signalAction || !candidate.signalSide || candidate.priceCents === null) return false;
    const fingerprint = `${candidate.signalAction}:${candidate.signalSide}:${candidate.priceCents}:${candidate.orderCount}`;
    const current = liveSignalSeenRef.current[candidate.orderKey];
    if (!current || current.fingerprint !== fingerprint) {
      liveSignalSeenRef.current[candidate.orderKey] = { fingerprint, firstSeenAt: now, lastSeenAt: now };
      return false;
    }
    current.lastSeenAt = now;
    return now - current.firstSeenAt >= liveSignalConfirmMs;
  }, []);
  const addLiveLog = useCallback((entry: Omit<LiveExecutionLogEntry, "id" | "time">) => {
    setLiveLog((current) => [{
      ...entry,
      id: `live-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      time: new Date().toISOString(),
    }, ...current].slice(0, dryLiveProbationMaxLogRows));
  }, []);
  const removeNowLivePnlRow = useCallback((row: NowLiveAlgoPnlRow) => {
    if (row.openPositions > 0) return;
    const algoById = new Map<string, GeneratedPaperAlgo>(availableLiveAlgos.map((algo) => [algo.id, algo]));
    const algoBySource = new Map<string, GeneratedPaperAlgo>(availableLiveAlgos.map((algo) => [algo.sourceAlgoId, algo]));
    setLiveLog((current) => current.filter((entry) => nowLiveAlgoRowKeyFromLogEntry(entry, liveAlgoLookup) !== row.key));
    setLivePositions((current) => current.filter((position) => (
      position.status === "open"
      || nowLiveAlgoRowKeyFromPosition(position, algoById, algoBySource, liveAlgoLookup) !== row.key
    )));
  }, [availableLiveAlgos, liveAlgoLookup]);
  const selectLiveAlgo = useCallback((next: string) => {
    setSelectedAlgoId(next);
    setLiveRunner((current) => ({ ...current, selectedAlgoId: next || null }));
    const algo = availableLiveAlgos.find((item) => item.id === next) ?? null;
    if (algo) setLookupAlgoId(algo.displayId);
  }, [availableLiveAlgos]);
  const addLiveRosterAlgo = useCallback((algoId: string) => {
    const nextIds = uniqueStringList([...selectedLiveAlgoIds, algoId]).slice(0, 100);
    setSelectedLiveAlgoIds(nextIds);
    setLiveRunner((current) => ({
      ...current,
      selectedAlgoId: algoId || current.selectedAlgoId,
      selectedAlgoIds: nextIds,
    }));
  }, [selectedLiveAlgoIds]);
  const removeLiveRosterAlgo = useCallback((algoId: string) => {
    const nextIds = selectedLiveAlgoIds.filter((id) => id !== algoId);
    setSelectedLiveAlgoIds(nextIds);
    if (nextIds.length === 0) setSelectedAlgoId("");
    setLiveRunner((current) => ({
      ...current,
      selectedAlgoId: nextIds[0] ?? null,
      selectedAlgoIds: nextIds,
    }));
  }, [selectedLiveAlgoIds]);
  const selectedAlgoInRoster = selectedAlgo ? selectedLiveAlgoIds.includes(selectedAlgo.id) : false;
  const applyLookupAlgo = () => {
    if (!lookupMatchedAlgo) return;
    selectLiveAlgo(lookupMatchedAlgo.id);
  };
  const toggleLiveSwitch = async () => {
    if (liveSwitchSubmitting) return;
    const nextEnabled = !routerStatus.liveSwitchEnabled;
    setLiveSwitchSubmitting(true);
    try {
      const nextStatus = await onSetLiveSwitch(nextEnabled);
      const message = nextStatus.liveSwitchEnabled
        ? "Live trading switch is ON. New buys may fire when the selected algo signal passes."
        : "Live trading switch is OFF. New buys are blocked; planned sell exits remain allowed.";
      setSubmitState({
        status: nextStatus.liveSwitchEnabled ? "accepted" : "idle",
        message,
        clientOrderId: null,
        dryRun: nextStatus.dryRun,
      });
      addLiveLog({
        event: nextStatus.liveSwitchEnabled ? "LIVE ON" : "LIVE OFF",
        orderAction: null,
        algo: selectedAlgo?.displayId ?? "-",
        ticker: activeTicker,
        side: null,
        contracts: null,
        cost: null,
        message,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Live switch update failed";
      setSubmitState({
        status: "rejected",
        message,
        clientOrderId: null,
        dryRun: routerStatus.dryRun,
      });
      addLiveLog({
        event: "REJECTED",
        orderAction: null,
        algo: selectedAlgo?.displayId ?? "-",
        ticker: activeTicker,
        side: null,
        contracts: null,
        cost: null,
        message,
      });
    } finally {
      setLiveSwitchSubmitting(false);
    }
  };
  const toggleLiveOrderMode = async () => {
    if (liveModeSubmitting) return;
    const nextDryRun = !routerStatus.dryRun;
    setLiveModeSubmitting(true);
    try {
      const nextStatus = await onSetDryRunMode(nextDryRun);
      const message = nextStatus.dryRun
        ? "Dry run mode is ON. Router checks will run, but no real Kalshi orders will be sent."
        : "Real order mode is ON. The Live switch still controls new buys; turning it off leaves sell exits allowed.";
      setSubmitState({
        status: nextStatus.dryRun ? "idle" : "accepted",
        message,
        clientOrderId: null,
        dryRun: nextStatus.dryRun,
      });
      addLiveLog({
        event: nextStatus.dryRun ? "DRY RUN" : "REAL MODE",
        orderAction: null,
        algo: selectedAlgo?.displayId ?? "-",
        ticker: activeTicker,
        side: null,
        contracts: null,
        cost: null,
        message,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Order mode update failed";
      setSubmitState({
        status: "rejected",
        message,
        clientOrderId: null,
        dryRun: routerStatus.dryRun,
      });
      addLiveLog({
        event: "REJECTED",
        orderAction: null,
        algo: selectedAlgo?.displayId ?? "-",
        ticker: activeTicker,
        side: null,
        contracts: null,
        cost: null,
        message,
      });
    } finally {
      setLiveModeSubmitting(false);
    }
  };
  const recordLiveBuyFill = useCallback((algo: GeneratedPaperAlgo, payload: unknown, fallbackTicker: string, fallbackSide: string, fallbackPriceCents: number) => {
    if (!isRecord(payload)) return;
    const filledOrders = liveSubmittedOrders(payload.submittedOrders);
    const filledContracts = filledOrders.reduce((total, order) => total + order.count, 0);
    if (filledContracts <= 0) return;
    const costCents = filledOrders.reduce((total, order) => total + order.count * order.priceCents, 0);
    const executionTicker = isRecord(payload.execution) ? stringOrNull(payload.execution.ticker) : null;
    const side = liveSideLabel(isRecord(payload.execution) ? stringOrNull(payload.execution.side) : null) ?? liveSideLabel(fallbackSide);
    if (!side) return;
    const ticker = executionTicker ?? fallbackTicker;
    const averageEntryPrice = costCents > 0 ? costCents / filledContracts / 100 : fallbackPriceCents / 100;
    const openedAt = new Date().toISOString();
    const positionId = `${algo.id}:${ticker}:${side}`;
    setLivePositions((current) => {
      const existing = current.find((position) => position.id === positionId && position.status === "open");
      if (!existing) {
        const nextPosition: LiveManagedPosition = {
          id: positionId,
          status: "open",
          algoId: algo.id,
          algoDisplayId: algo.displayId,
          algoName: algo.name,
          algoFamily: algo.family,
          algoSourceId: algo.sourceAlgoId,
          algoParams: algo.params,
          ticker,
          side,
          contracts: filledContracts,
          entryPrice: roundDisplayRatio(averageEntryPrice),
          openedAt,
          closedAt: null,
          exitPrice: null,
          bestExitPrice: liveBidForSide(side, snapshot) ?? roundDisplayRatio(averageEntryPrice),
          realizedPnl: null,
          exitReason: null,
        };
        return [nextPosition, ...current].slice(0, 120);
      }
      const totalContracts = existing.contracts + filledContracts;
      const entryPrice = totalContracts > 0
        ? roundDisplayRatio(((existing.entryPrice * existing.contracts) + (averageEntryPrice * filledContracts)) / totalContracts)
        : existing.entryPrice;
      return current.map((position) => (
        position.id === existing.id
          ? { ...position, contracts: totalContracts, entryPrice }
          : position
      ));
    });
  }, [snapshot]);
  const liveExitCandidate = useMemo(() => {
    const position = openLivePositions.find((item) => item.ticker === activeTicker) ?? null;
    if (!position) return null;
    const bid = liveBidForSide(position.side, snapshot);
    if (bid === null || bid <= 0) return null;
    const positionAlgo = availableLiveAlgos.find((algo) => algo.id === position.algoId) ?? null;
    const positionSignal = positionAlgo ? generatedPaperAlgoSignalPreview(livePaperInput, positionAlgo) : signal;
    const reason = liveExitReason(position, bid, snapshot, positionSignal);
    if (!reason) return null;
    return {
      position,
      bid,
      priceCents: Math.max(1, Math.min(99, Math.floor(bid * 100))),
      reason,
    };
  }, [activeTicker, availableLiveAlgos, livePaperInput, openLivePositions, signal, snapshot]);
  const submitLiveSell = useCallback(async () => {
    if (!liveExitCandidate || liveSubmittingRef.current) return;
    liveSubmittingRef.current = true;
    const { position, priceCents: exitPriceCents, reason } = liveExitCandidate;
    const exitContracts = Math.max(1, Math.floor(position.contracts));
    setSubmitState({ status: "submitting", message: reason, clientOrderId: null, dryRun: routerStatus.dryRun });
    try {
      const controller = new AbortController();
      const timeoutId = window.setTimeout(() => controller.abort(), liveOrderRequestTimeoutMs);
      const response = await fetch(localApiUrl("/api/kalshi/order-router"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          algoId: position.algoId,
          algoDisplayId: position.algoDisplayId,
          algoName: position.algoName,
          algoFamily: position.algoFamily,
          algoSourceId: position.algoSourceId,
          algoParams: position.algoParams,
          paperInput: livePaperInput,
          ticker: position.ticker,
          side: position.side.toLowerCase(),
          action: "sell",
          count: exitContracts,
          priceCents: exitPriceCents,
          maxTradeDollars: betCap || routerStatus.maxOrderDollars,
          maxSlippageCents: 1,
          executionProfile: "standard",
          exitReason: reason,
        }),
      });
      window.clearTimeout(timeoutId);
      const payload = await response.json() as unknown;
      const accepted = isRecord(payload) && payload.accepted === true;
      const message = isRecord(payload)
        ? stringOrNull(payload.message) ?? stringOrNull(payload.error) ?? (accepted ? "Sell accepted." : "Sell rejected.")
        : "Order router returned an unreadable response.";
      const soldContracts = isRecord(payload) ? numberOrNull(payload.submittedContracts) ?? 0 : 0;
      const proceeds = isRecord(payload) ? centsToDollars(numberOrNull(payload.submittedCostCents)) : null;
      const averageExitPrice = soldContracts > 0 && proceeds !== null ? proceeds / soldContracts : exitPriceCents / 100;
      setSubmitState({
        status: accepted ? "accepted" : "rejected",
        message,
        clientOrderId: isRecord(payload) ? stringOrNull(payload.clientOrderId) : null,
        dryRun: routerStatus.dryRun,
      });
      if (accepted && soldContracts > 0) {
        const saleProfit = roundDisplayMoney((averageExitPrice - position.entryPrice) * soldContracts);
        if (allowLiveRepeatBuys && soldContracts >= position.contracts) {
          completedLiveOrderKeysRef.current.delete(`${position.algoId}:${position.ticker}`);
        }
        setLivePositions((current) => current.map((item) => {
          if (item.id !== position.id || item.status !== "open") return item;
          const remainingContracts = Math.max(0, item.contracts - soldContracts);
          if (remainingContracts > 0) {
            return {
              ...item,
              contracts: remainingContracts,
              exitPrice: roundDisplayRatio(averageExitPrice),
              realizedPnl: roundDisplayMoney((item.realizedPnl ?? 0) + saleProfit),
              exitReason: reason,
            };
          }
          return {
            ...item,
            status: "closed",
            contracts: 0,
            closedAt: new Date().toISOString(),
            exitPrice: roundDisplayRatio(averageExitPrice),
            realizedPnl: roundDisplayMoney((item.realizedPnl ?? 0) + saleProfit),
            exitReason: reason,
          };
        }));
        addLiveLog({
          event: "SOLD",
          orderAction: "SELL",
          algo: position.algoDisplayId,
          ticker: position.ticker,
          side: position.side,
          contracts: soldContracts,
          cost: proceeds,
          profit: saleProfit,
          message,
        });
      } else {
        addLiveLog({
          event: "REJECTED",
          orderAction: "SELL",
          algo: position.algoDisplayId,
          ticker: position.ticker,
          side: position.side,
          contracts: exitContracts,
          cost: roundDisplayMoney((exitContracts * exitPriceCents) / 100),
          message,
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Live sell request failed";
      setSubmitState({
        status: "rejected",
        message,
        clientOrderId: null,
        dryRun: routerStatus.dryRun,
      });
      addLiveLog({
        event: "REJECTED",
        orderAction: "SELL",
        algo: position.algoDisplayId,
        ticker: position.ticker,
        side: position.side,
        contracts: exitContracts,
        cost: roundDisplayMoney((exitContracts * exitPriceCents) / 100),
        message,
      });
    } finally {
      liveSubmittingRef.current = false;
    }
  }, [addLiveLog, allowLiveRepeatBuys, betCap, liveExitCandidate, livePaperInput, routerStatus.dryRun, routerStatus.maxOrderDollars]);
  const submitLiveOrder = useCallback(async (candidate: LiveOrderCandidate) => {
    if (!candidate.ready || !activeTicker || !candidate.signalAction || !candidate.signalSide || candidate.priceCents === null || candidate.orderCount <= 0) return;
    if (liveSubmittingRef.current) return;
    liveSubmittingRef.current = true;
    setSubmitState({ status: "submitting", message: null, clientOrderId: null, dryRun: routerStatus.dryRun });
    try {
      const controller = new AbortController();
      const timeoutId = window.setTimeout(() => controller.abort(), liveOrderRequestTimeoutMs);
      const response = await fetch(localApiUrl("/api/kalshi/order-router"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          algoId: candidate.algo.id,
          algoDisplayId: candidate.algo.displayId,
          algoName: candidate.algo.name,
          algoFamily: candidate.algo.family,
          algoSourceId: candidate.algo.sourceAlgoId,
          algoParams: candidate.algo.params,
          paperInput: livePaperInput,
          ticker: activeTicker,
          side: candidate.signalSide.toLowerCase(),
          action: "buy",
          signalAction: candidate.signalAction,
          count: candidate.orderCount,
          priceCents: candidate.priceCents,
          maxTradeDollars: betCap,
          maxSlippageCents: 1,
          executionProfile: "standard",
        }),
      });
      window.clearTimeout(timeoutId);
      const payload = await response.json() as unknown;
      const accepted = isRecord(payload) && payload.accepted === true;
      const message = isRecord(payload)
        ? stringOrNull(payload.message) ?? stringOrNull(payload.error) ?? (accepted ? "Order accepted." : "Order rejected.")
        : "Order router returned an unreadable response.";
      const submittedContracts = isRecord(payload) ? numberOrNull(payload.submittedContracts) ?? 0 : 0;
      const submittedCost = isRecord(payload) ? centsToDollars(numberOrNull(payload.submittedCostCents)) : null;
      const finalSide = isRecord(payload) && isRecord(payload.execution)
        ? stringOrNull(payload.execution.side) ?? candidate.signalSide
        : candidate.signalSide;
      const logContracts = accepted ? submittedContracts : candidate.orderCount;
      const logCost = accepted ? submittedCost ?? candidate.estimatedCost : candidate.estimatedCost;
      setSubmitState({
        status: accepted ? "accepted" : "rejected",
        message,
        clientOrderId: isRecord(payload) ? stringOrNull(payload.clientOrderId) : null,
        dryRun: routerStatus.dryRun,
      });
      if (accepted) {
        if (candidate.orderKey && !allowLiveRepeatBuys) completedLiveOrderKeysRef.current.add(candidate.orderKey);
        if (candidate.orderKey) {
          delete liveExecutionBlockedUntilRef.current[candidate.orderKey];
          delete liveSignalSeenRef.current[candidate.orderKey];
        }
        recordLiveBuyFill(candidate.algo, payload, activeTicker, finalSide, candidate.priceCents);
        addLiveLog({
          event: "SUBMITTED",
          orderAction: "BUY",
          algo: candidate.algo.displayId,
          ticker: activeTicker,
          side: finalSide,
          contracts: logContracts,
          cost: logCost,
          message,
        });
      } else {
        const cooldownMs = liveBuyRejectionCooldownMs(message);
        if (candidate.orderKey && cooldownMs > 0) {
          liveExecutionBlockedUntilRef.current[candidate.orderKey] = Date.now() + cooldownMs;
          delete liveSignalSeenRef.current[candidate.orderKey];
        }
        addLiveLog({
          event: "REJECTED",
          orderAction: "BUY",
          algo: candidate.algo.displayId,
          ticker: activeTicker,
          side: finalSide,
          contracts: logContracts,
          cost: logCost,
          message,
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Order router request failed";
      if (candidate.orderKey) {
        liveExecutionBlockedUntilRef.current[candidate.orderKey] = Date.now() + 30_000;
        delete liveSignalSeenRef.current[candidate.orderKey];
      }
      setSubmitState({
        status: "rejected",
        message,
        clientOrderId: null,
        dryRun: routerStatus.dryRun,
      });
      addLiveLog({
        event: "REJECTED",
        orderAction: "BUY",
        algo: candidate.algo.displayId,
        ticker: activeTicker,
        side: candidate.signalSide,
        contracts: candidate.orderCount,
        cost: candidate.estimatedCost,
        message,
      });
    } finally {
      liveSubmittingRef.current = false;
    }
  }, [activeTicker, addLiveLog, allowLiveRepeatBuys, betCap, livePaperInput, recordLiveBuyFill, routerStatus.dryRun]);

  useEffect(() => {
    saveLiveExecutionLog(liveLog);
  }, [liveLog]);

  useEffect(() => {
    saveLiveRunnerState(liveRunner);
    onRunnerStatusChange(liveRunner.status);
  }, [liveRunner, onRunnerStatusChange]);

  useEffect(() => {
    saveLiveManagedPositions(livePositions);
  }, [livePositions]);

  useEffect(() => {
    if (activatedDataClearToken === 0) return undefined;
    const clearId = window.setTimeout(() => {
      setLivePositions((current) => current.filter((position) => position.status === "open"));
    }, 0);
    return () => window.clearTimeout(clearId);
  }, [activatedDataClearToken]);

  useEffect(() => {
    const updateId = window.setTimeout(() => {
      setLivePositions((current) => {
        let changed = false;
        const next = current.map((position) => {
          if (position.status !== "open") return position;
          const bid = liveBidForSide(position.side, snapshot);
          if (bid === null || bid <= 0) return position;
          const bestExitPrice = roundDisplayRatio(Math.max(position.bestExitPrice ?? bid, bid));
          if (bestExitPrice === (position.bestExitPrice ?? null)) return position;
          changed = true;
          return { ...position, bestExitPrice };
        });
        return changed ? next : current;
      });
    }, 0);
    return () => window.clearTimeout(updateId);
  }, [snapshot]);

  useEffect(() => {
    if (kalshiPortfolio.status !== "live") return;
    if (kalshiPortfolio.openPositions > 0) return;
    const now = Date.now();
    setLivePositions((current) => current.map((position) => {
      if (position.status !== "open") return position;
      if (now - Date.parse(position.openedAt) < 15_000) return position;
      if (allowLiveRepeatBuys) completedLiveOrderKeysRef.current.delete(`${position.algoId}:${position.ticker}`);
      return {
        ...position,
        status: "closed",
        closedAt: new Date().toISOString(),
        exitReason: position.exitReason ?? "Kalshi no longer reports this position open.",
      };
    }));
  }, [allowLiveRepeatBuys, kalshiPortfolio.openPositions, kalshiPortfolio.status]);

  useEffect(() => {
    completedLiveOrderKeysRef.current = new Set();
    lastLiveOrderAttemptAtRef.current = {};
    lastLiveSellAttemptAtRef.current = {};
    liveSignalSeenRef.current = {};
    liveExecutionBlockedUntilRef.current = {};
    liveRosterCursorRef.current = 0;
  }, [activeTicker, selectedLiveAlgoIds]);

  useEffect(() => {
    if (runStatus !== "running") return undefined;
    const id = window.setInterval(() => setLiveRetryTick((current) => current + 1), 1_000);
    return () => window.clearInterval(id);
  }, [runStatus]);

  useEffect(() => {
    const readyKeys = new Set(readyLiveOrderCandidates.map((candidate) => candidate.orderKey).filter((key): key is string => key !== null));
    for (const key of Object.keys(liveSignalSeenRef.current)) {
      if (!readyKeys.has(key)) delete liveSignalSeenRef.current[key];
    }
  }, [readyLiveOrderCandidates]);

  useEffect(() => {
    if (runStatus !== "running" || readyLiveOrderCandidates.length === 0) return;
    const now = Date.now();
    const startIndex = liveRosterCursorRef.current % readyLiveOrderCandidates.length;
    for (let offset = 0; offset < readyLiveOrderCandidates.length; offset += 1) {
      const index = (startIndex + offset) % readyLiveOrderCandidates.length;
      const candidate = readyLiveOrderCandidates[index];
      if (!candidate.orderKey) continue;
      if (!candidate.signalAction || !candidate.signalSide || candidate.priceCents === null || candidate.orderCount <= 0) continue;
      if (!allowLiveRepeatBuys && completedLiveOrderKeysRef.current.has(candidate.orderKey)) continue;
      const blockedUntil = liveExecutionBlockedUntilRef.current[candidate.orderKey] ?? 0;
      if (now < blockedUntil) continue;
      const observedMs = Date.parse(candidate.observedAt);
      if (!Number.isFinite(observedMs) || now - observedMs > liveSignalMaxAgeMs) {
        delete liveSignalSeenRef.current[candidate.orderKey];
        continue;
      }
      const preflightMessage = topTraderExecutablePreflightRejectionMessage(
        candidate.algo,
        candidate.signal,
        candidate.signalAction,
        candidate.signalSide,
        candidate.priceCents,
        candidate.orderCount,
        livePaperInput,
        routerStatus.executionMinEdgeAfterFees,
      );
      if (preflightMessage) {
        liveExecutionBlockedUntilRef.current[candidate.orderKey] = now + livePreflightCooldownMs(preflightMessage);
        delete liveSignalSeenRef.current[candidate.orderKey];
        continue;
      }
      if (!confirmLiveSignal(candidate, now)) continue;
      const lastAttemptAt = lastLiveOrderAttemptAtRef.current[candidate.orderKey] ?? 0;
      if (now - lastAttemptAt < liveRetryDelayMs) continue;
      lastLiveOrderAttemptAtRef.current[candidate.orderKey] = now;
      liveRosterCursorRef.current = index + 1;
      void submitLiveOrder(candidate);
      break;
    }
  }, [allowLiveRepeatBuys, confirmLiveSignal, livePaperInput, liveRetryTick, readyLiveOrderCandidates, routerStatus.executionMinEdgeAfterFees, runStatus, submitLiveOrder]);

  useEffect(() => {
    if (runStatus !== "running" || !liveExitCandidate) return;
    const attemptKey = liveExitCandidate.position.id;
    const lastAttemptAt = lastLiveSellAttemptAtRef.current[attemptKey] ?? 0;
    const now = Date.now();
    if (now - lastAttemptAt < liveSellRetryDelayMs) return;
    lastLiveSellAttemptAtRef.current[attemptKey] = now;
    void submitLiveSell();
  }, [liveExitCandidate, liveRetryTick, runStatus, submitLiveSell]);

  const startLiveAlgo = () => {
    completedLiveOrderKeysRef.current = new Set();
    lastLiveOrderAttemptAtRef.current = {};
    lastLiveSellAttemptAtRef.current = {};
    liveSignalSeenRef.current = {};
    liveExecutionBlockedUntilRef.current = {};
    liveRosterCursorRef.current = 0;
    const rosterIds = runnableLiveAlgos.map((algo) => algo.id);
    const startedAt = new Date().toISOString();
    setLiveRunner({
      status: "running",
      selectedAlgoId: rosterIds[0] ?? null,
      selectedAlgoIds: rosterIds,
      maxBet: numberFromInput(maxBet),
      allowRepeatBuys: allowLiveRepeatBuys,
      autoDryLiveEnabled: liveRunner.autoDryLiveEnabled,
      dryLiveProbation: liveRunner.dryLiveProbation,
      startedAt,
      stoppedAt: null,
    });
    const message = `${liveRosterLabel} running and will buy whenever each algo's own signal fires.`;
    setSubmitState({ status: "idle", message, clientOrderId: null, dryRun: routerStatus.dryRun });
    addLiveLog({
      event: "ARMED",
      orderAction: null,
      algo: runnableLiveAlgos.length === 1 ? runnableLiveAlgos[0].displayId : liveRosterLabel,
      ticker: activeTicker,
      side: null,
      contracts: null,
      cost: null,
      message,
    });
  };
  const stopLiveAlgo = () => {
    const stoppedAt = new Date().toISOString();
    setLiveRunner((current) => ({
      ...current,
      status: "idle",
      selectedAlgoId: selectedLiveAlgoIds[0] ?? null,
      selectedAlgoIds: selectedLiveAlgoIds,
      maxBet: numberFromInput(maxBet),
      allowRepeatBuys: allowLiveRepeatBuys,
      autoDryLiveEnabled: false,
      dryLiveProbation: current.dryLiveProbation,
      stoppedAt,
    }));
    addLiveLog({
      event: "STOPPED",
      orderAction: null,
      algo: runnableLiveAlgos.length === 1 ? runnableLiveAlgos[0].displayId : liveRosterLabel,
      ticker: activeTicker,
      side: null,
      contracts: null,
      cost: null,
      message: "Live algo stopped.",
    });
    setSubmitState((current) => ({
      ...current,
      message: current.message ?? "Live algo stopped.",
    }));
  };

  useEffect(() => {
    if (!liveRunner.autoDryLiveEnabled) return;
    if (runStatus !== "idle") return;
    if (!routerStatus.dryRun || !liveEntriesEnabled) return;
    if (betCap <= 0 || betCap > routerStatus.maxOrderDollars) return;
    if (dryLiveReadyAlgos.length === 0) return;

    const timeoutId = window.setTimeout(() => {
      const rosterIds = dryLiveReadyAlgos.map((algo) => algo.id);
      completedLiveOrderKeysRef.current = new Set();
      lastLiveOrderAttemptAtRef.current = {};
      lastLiveSellAttemptAtRef.current = {};
      liveSignalSeenRef.current = {};
      liveExecutionBlockedUntilRef.current = {};
      liveRosterCursorRef.current = 0;
      setSelectedLiveAlgoIds(rosterIds);
      setSelectedAlgoId(rosterIds[0] ?? "");
      if (dryLiveReadyAlgos[0]) setLookupAlgoId(dryLiveReadyAlgos[0].displayId);
      const startedAt = new Date().toISOString();
      setLiveRunner((current) => ({
        ...current,
        status: "running",
        selectedAlgoId: rosterIds[0] ?? null,
        selectedAlgoIds: rosterIds,
        maxBet: betCap,
        allowRepeatBuys: allowLiveRepeatBuys,
        autoDryLiveEnabled: true,
        dryLiveProbation: dryLiveReadyAlgos.reduce((records, algo) => {
          const currentRecord = records[algo.sourceAlgoId];
          if (currentRecord && currentRecord.status !== "failed") return records;
          return {
            ...records,
            [algo.sourceAlgoId]: defaultDryLiveProbationRecord(algo, startedAt),
          };
        }, current.dryLiveProbation),
        startedAt,
        stoppedAt: null,
      }));
      const message = `${dryLiveReadyAlgos.length} dry-live ready algo${dryLiveReadyAlgos.length === 1 ? "" : "s"} auto-armed from Top Traders.`;
      setSubmitState({ status: "idle", message, clientOrderId: null, dryRun: true });
      addLiveLog({
        event: "ARMED",
        orderAction: null,
        algo: dryLiveReadyAlgos.length === 1 ? dryLiveReadyAlgos[0].displayId : `${dryLiveReadyAlgos.length} algos`,
        ticker: activeTicker,
        side: null,
        contracts: null,
        cost: null,
        message,
      });
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [activeTicker, addLiveLog, allowLiveRepeatBuys, betCap, dryLiveReadyAlgos, dryLiveReadySignature, liveEntriesEnabled, liveRunner.autoDryLiveEnabled, routerStatus.dryRun, routerStatus.maxOrderDollars, runStatus]);

  useEffect(() => {
    if (!liveRunner.autoDryLiveEnabled) return;
    if (runStatus !== "running") return;
    if (!routerStatus.dryRun || !liveEntriesEnabled) return;
    if (betCap <= 0 || betCap > routerStatus.maxOrderDollars) return;
    if (selectedLiveAlgoIds.length >= dryLivePromotionMaxAlgos) return;
    const selectedIdSet = new Set(selectedLiveAlgoIds);
    const additions = dryLiveReadyAlgos
      .filter((algo) => !selectedIdSet.has(algo.id))
      .slice(0, dryLivePromotionMaxAlgos - selectedLiveAlgoIds.length);
    if (additions.length === 0) return;
    const timeoutId = window.setTimeout(() => {
      const nextIds = uniqueStringList([...selectedLiveAlgoIds, ...additions.map((algo) => algo.id)]).slice(0, dryLivePromotionMaxAlgos);
      const startedAt = new Date().toISOString();
      setSelectedLiveAlgoIds(nextIds);
      if (!selectedAlgoId && nextIds[0]) setSelectedAlgoId(nextIds[0]);
      setLiveRunner((current) => ({
        ...current,
        selectedAlgoId: current.selectedAlgoId ?? nextIds[0] ?? null,
        selectedAlgoIds: nextIds,
        maxBet: betCap,
        allowRepeatBuys: allowLiveRepeatBuys,
        autoDryLiveEnabled: true,
        dryLiveProbation: additions.reduce((records, algo) => ({
          ...records,
          [algo.sourceAlgoId]: records[algo.sourceAlgoId] ?? defaultDryLiveProbationRecord(algo, startedAt),
        }), current.dryLiveProbation),
      }));
      const message = `${additions.length} newly eligible algo${additions.length === 1 ? "" : "s"} added to dry-live probation; ${nextIds.length} of ${dryLivePromotionMaxAlgos} slots filled.`;
      setSubmitState({ status: "accepted", message, clientOrderId: null, dryRun: true });
      addLiveLog({
        event: "ARMED",
        orderAction: null,
        algo: additions.length === 1 ? additions[0].displayId : `${additions.length} algos`,
        ticker: activeTicker,
        side: null,
        contracts: null,
        cost: null,
        message,
      });
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [activeTicker, addLiveLog, allowLiveRepeatBuys, betCap, dryLiveReadyAlgos, dryLiveReadySignature, liveEntriesEnabled, liveRunner.autoDryLiveEnabled, routerStatus.dryRun, routerStatus.maxOrderDollars, runStatus, selectedAlgoId, selectedLiveAlgoIds]);

  useEffect(() => {
    if (!routerStatus.dryRun) return;
    const testingRecords = Object.values(liveRunner.dryLiveProbation).filter((record) => record.status === "testing");
    if (testingRecords.length === 0) return;
    const reviewedAt = new Date().toISOString();
    const algoBySource = new Map(availableLiveAlgos.map((algo) => [algo.sourceAlgoId, algo]));
    const nextRecords: Record<string, DryLiveProbationRecord> = { ...liveRunner.dryLiveProbation };
    let nextSelectedIds = selectedLiveAlgoIds;
    const decisions: DryLiveProbationRecord[] = [];

    for (const record of testingRecords) {
      const row = nowLivePnlBySource.get(record.sourceAlgoId);
      if (!row) continue;
      const decision = dryLiveProbationReview(record, row, reviewedAt);
      if (!decision) continue;
      nextRecords[record.sourceAlgoId] = decision;
      decisions.push(decision);
      const algo = algoBySource.get(record.sourceAlgoId);
      if (algo) nextSelectedIds = nextSelectedIds.filter((id) => id !== algo.id);
    }

    if (decisions.length === 0) return;
    const timeoutId = window.setTimeout(() => {
      setSelectedLiveAlgoIds(nextSelectedIds);
      setSelectedAlgoId(nextSelectedIds[0] ?? "");
      setLiveRunner((current) => ({
        ...current,
        status: runStatus === "running" && nextSelectedIds.length === 0 ? "idle" : current.status,
        selectedAlgoId: nextSelectedIds[0] ?? null,
        selectedAlgoIds: nextSelectedIds,
        autoDryLiveEnabled: current.autoDryLiveEnabled,
        dryLiveProbation: nextRecords,
        stoppedAt: runStatus === "running" && nextSelectedIds.length === 0 ? reviewedAt : current.stoppedAt,
      }));
      for (const decision of decisions) {
        addLiveLog({
          event: decision.status === "passed" ? "PROBATION PASS" : "PROBATION FAIL",
          orderAction: null,
          algo: decision.displayId,
          ticker: activeTicker,
          side: null,
          contracts: null,
          cost: null,
          profit: decision.totalPnl,
          message: decision.reason ?? `Dry-live probation ${decision.status}.`,
        });
      }
      const failed = decisions.filter((decision) => decision.status === "failed").length;
      const passed = decisions.filter((decision) => decision.status === "passed").length;
      setSubmitState({
        status: failed > 0 ? "rejected" : "accepted",
        message: `Dry-live review: ${passed} passed, ${failed} failed.`,
        clientOrderId: null,
        dryRun: true,
      });
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [activeTicker, addLiveLog, availableLiveAlgos, liveRunner.dryLiveProbation, nowLivePnlBySource, routerStatus.dryRun, runStatus, selectedLiveAlgoIds]);

  const runLabel = runStatus === "running"
    ? liveExitCandidate
      ? submitState.status === "submitting" ? "Selling" : "Exit Firing"
      : hasOpenLivePositionForActiveTicker && !allowLiveRepeatBuys
        ? "Managing Exit"
        : !liveEntriesEnabled
          ? routerStatus.liveSwitchEnabled ? "Router Blocked" : "Live Off"
        : readyToOrder
      ? submitState.status === "submitting" ? "Submitting" : "Signal Firing"
      : "Waiting For Algo"
    : "Stopped";
  const liveBalance = kalshiPortfolio.balanceCents === null ? "-" : centsMoney(kalshiPortfolio.balanceCents);
  const livePortfolioValue = kalshiPortfolio.portfolioValueCents === null ? "-" : centsMoney(kalshiPortfolio.portfolioValueCents);
  const liveTotalPnl = kalshiPortfolio.totalPnlDollars;
  const liveFees = kalshiPortfolio.feesPaidDollars;
  const routerLabel = routerAvailable
    ? routerStatus.dryRun
      ? routerStatus.liveSwitchEnabled ? "Dry run entries" : "Dry run off"
      : routerStatus.liveSwitchEnabled
      ? routerStatus.liveEnabled ? "Live entries" : "Locked"
      : liveSellExitsEnabled ? "Exits only" : "Live off"
    : "Unavailable";
  const signalLabel = signalAction ? `${signalSide} @ ${priceCents}c` : "Waiting for algo";
  const favoriteLiveAlgosSection = (
    <section className="panel arena-history-panel full live-favorites-panel">
      <div className="panel-heading compact">
        <div>
          <h2>Favorite Algos</h2>
          <span className="panel-subtitle">Top Traders evidence plus current Now runner P/L</span>
        </div>
        <Badge tone={favoriteLiveAlgos.length > 0 ? "good" : "neutral"}>{favoriteLiveAlgos.length} saved</Badge>
      </div>
      <div className="live-favorites">
        {favoriteLiveAlgos.length === 0 ? (
          <p className="muted">Star algos in Top Traders to keep them here.</p>
        ) : (
          <div className="live-favorite-list">
            {favoriteLiveAlgos.map((algo) => {
              const activeFavorite = selectedAlgo?.sourceAlgoId === algo.sourceAlgoId;
              const stats = favoriteStatsBySource.get(algo.sourceAlgoId) ?? null;
              const confidence = stats ? activatedConfidence(stats, snapshot.generatedAt) : null;
              const pnlPerCycle = stats ? activatedPnlPerCycle(stats, snapshot.generatedAt) : null;
              const tradesPerCycle = stats ? topTraderClosedTradesPerCycle(stats, snapshot.generatedAt) : null;
              const avgProfitPerTrade = stats ? topTraderAverageProfitPerTrade(stats) : null;
              const nowPnl = nowLivePnlBySource.get(algo.sourceAlgoId) ?? null;
              const nowTotalPnl = nowPnl?.totalPnl ?? nowPnl?.realizedPnl ?? null;
              return (
                <div className={activeFavorite ? "live-favorite-row active" : "live-favorite-row"} key={algo.sourceAlgoId}>
                  <button className="live-favorite-select" type="button" onClick={() => selectLiveAlgo(algo.id)}>
                    <span className="algo-id-pill">{algo.displayId}</span>
                    <span className="live-favorite-name">
                      <strong>{familyLabel(algo.family)}</strong>
                      <small>{shortAlgoName(algo.name)}</small>
                    </span>
                    <span className="live-favorite-stats">
                      <span>
                        <b>{stats ? `#${stats.rank}` : "-"}</b>
                        <small>{stats ? topTraderBucketLabel(stats.bucket) : "No rank"}</small>
                      </span>
                      <span>
                        <b>{stats ? stats.reliabilityScore.toFixed(1) : "-"}</b>
                        <small>Top Score</small>
                      </span>
                      <span>
                        <b className={nowTotalPnl === null ? "" : nowTotalPnl >= 0 ? "positive" : "negative"}>{nowTotalPnl === null ? "-" : signedMoney(nowTotalPnl)}</b>
                        <small>Now P/L</small>
                      </span>
                      <span>
                        <b className={pnlPerCycle === null ? "" : pnlPerCycle >= 0 ? "positive" : "negative"}>{pnlPerCycle === null ? "-" : signedMoney(pnlPerCycle)}</b>
                        <small>Top / 15m</small>
                      </span>
                      <span>
                        <b>{tradesPerCycle === null ? "-" : tradesPerCycle.toFixed(2)}</b>
                        <small>Top Trades</small>
                      </span>
                      <span>
                        <b>{nowPnl ? `${nowPnl.buys} / ${nowPnl.sells}` : "-"}</b>
                        <small>Now B / S</small>
                      </span>
                      <span>
                        <b className={avgProfitPerTrade === null ? "" : avgProfitPerTrade >= 0 ? "positive" : "negative"}>{avgProfitPerTrade === null ? "-" : signedMoney(avgProfitPerTrade)}</b>
                        <small>Top Avg</small>
                      </span>
                      <span>
                        <b>{nowPnl ? countOrDash(nowPnl.rejects) : "-"}</b>
                        <small>Now Rejects</small>
                      </span>
                      <span>
                        <b>{stats ? `${stats.liveStats.wins} / ${stats.liveStats.losses}` : "-"}</b>
                        <small>Top W / L</small>
                      </span>
                      <span>
                        <b>{stats?.liveStats.roi === null || !stats ? "-" : percent(stats.liveStats.roi)}</b>
                        <small>Top ROI</small>
                      </span>
                      <span>
                        <b>{confidence?.label ?? "-"}</b>
                        <small>Status</small>
                      </span>
                    </span>
                  </button>
                  <button
                    aria-label={`Remove ${algo.displayId} from favorites`}
                    className="favorite-button active"
                    title="Remove from favorites"
                    type="button"
                    onClick={() => onToggleFavorite(algo.sourceAlgoId)}
                  >
                    <Star fill="currentColor" size={14} />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );

  return (
    <section className="view-grid live-trading-view">
      <PanelTitle title="Live Trading" icon={<ShieldAlert size={18} />} />
      <div className="arena-grid live-trading-grid">
        <section className="panel arena-control-panel">
          <div className="panel-heading compact">
            <div>
              <h2>Live Setup</h2>
              <span className="panel-subtitle">Algo-controlled live execution</span>
            </div>
            <div className="heading-actions">
              <button
                className={routerStatus.liveSwitchEnabled ? "live-switch-button active" : "live-switch-button"}
                disabled={liveSwitchSubmitting}
                type="button"
                onClick={toggleLiveSwitch}
              >
                <ToggleRight size={14} /> {liveSwitchSubmitting ? "Updating" : routerStatus.liveSwitchEnabled ? "Live On" : "Live Off"}
              </button>
              <button
                className={routerStatus.dryRun ? "live-mode-button dry-run" : "live-mode-button real"}
                disabled={liveModeSubmitting}
                type="button"
                onClick={toggleLiveOrderMode}
              >
                <ToggleRight size={14} /> {liveModeSubmitting ? "Updating" : routerStatus.dryRun ? "Dry Run" : "Real Orders"}
              </button>
              <Badge tone={runStatus === "running" ? "good" : liveEntriesEnabled ? "bad" : routerStatus.dryRun ? "warn" : "neutral"}>
                {runStatus === "running" ? "RUNNING" : liveEntriesEnabled ? routerStatus.dryRun ? "DRY RUN READY" : "LIVE READY" : routerStatus.liveSwitchEnabled ? "ROUTER BLOCKED" : "OFF"}
              </Badge>
            </div>
          </div>
          <div className="arena-form">
            <label>
              <span>Algo</span>
              <select value={effectiveSelectedAlgoId} onChange={(event) => selectLiveAlgo(event.target.value)}>
                <option value="">Top dry-live results</option>
                {dropdownAlgos.map((algo) => (
                  <option key={algo.id} value={algo.id}>{algo.displayId} - {shortAlgoName(algo.name)}</option>
                ))}
              </select>
              <small className="muted">Dropdown shows the top 20 Now dry-live results. Use ID search for any generated algo.</small>
            </label>
            <label className="live-id-lookup-field">
              <span>Type Algo ID</span>
              <div className="live-id-lookup-row">
                <input
                  placeholder="M-0101"
                  spellCheck={false}
                  type="text"
                  value={lookupAlgoId}
                  onChange={(event) => setLookupAlgoId(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") applyLookupAlgo();
                  }}
                />
                <button className="ghost-button mini-button" disabled={!lookupMatchedAlgo} type="button" onClick={applyLookupAlgo}>
                  Use ID
                </button>
              </div>
              <small className={lookupAlgoId.trim() && !lookupMatchedAlgo ? "negative" : "muted"}>
                {lookupAlgoId.trim()
                  ? lookupMatchedAlgo ? `Found ${lookupMatchedAlgo.displayId} - ${shortAlgoName(lookupMatchedAlgo.name)}` : "No matching generated algo ID."
                  : `Search ${availableLiveAlgos.length.toLocaleString()} generated algos by ID.`}
              </small>
            </label>
            <label>
              <span>Max Per Trade</span>
              <input min="1" max={routerStatus.maxOrderDollars} step="1" type="number" value={maxBet} onChange={(event) => {
                const next = event.target.value;
                setMaxBet(next);
                setLiveRunner((current) => ({ ...current, maxBet: Math.max(1, numberFromInput(next)) }));
              }} />
            </label>
            <label className="arena-switch-row">
              <input checked={allowLiveRepeatBuys} disabled={runStatus === "running"} type="checkbox" onChange={(event) => {
                const next = event.target.checked;
                setAllowLiveRepeatBuys(next);
                setLiveRunner((current) => ({ ...current, allowRepeatBuys: next }));
              }} />
              <span>Repeat buys</span>
              <small>{allowLiveRepeatBuys ? "The live runner may add more buys in the same active contract." : "The live runner buys only once per active contract."}</small>
            </label>
            <label className="arena-switch-row">
              <input checked={liveRunner.autoDryLiveEnabled} disabled={runStatus === "running"} type="checkbox" onChange={(event) => {
                const next = event.target.checked;
                setLiveRunner((current) => ({ ...current, autoDryLiveEnabled: next }));
              }} />
              <span>Auto dry-live</span>
              <small>{routerStatus.dryRun ? dryLiveReadyAlgos.length > 0 ? `${dryLiveReadyAlgos.length} ready from Top Traders` : "Waiting for Top Traders proof" : "Paused in Real Orders mode"}</small>
            </label>
          </div>
          <div className="arena-actions live-actions">
            <button className="ghost-button arena-action" disabled={!selectedAlgo || selectedAlgoInRoster || runStatus === "running"} type="button" onClick={() => selectedAlgo && addLiveRosterAlgo(selectedAlgo.id)}>
              <ListChecks size={14} /> Add Selected
            </button>
            <button className="primary-action arena-action" disabled={!canStart || runStatus === "running"} type="button" onClick={startLiveAlgo}>
              <Play size={14} /> Play Live {runnableLiveAlgos.length > 1 ? "Roster" : "Algo"}
            </button>
            <button className="ghost-button arena-action" disabled={runStatus !== "running"} type="button" onClick={stopLiveAlgo}>
              <Square size={14} /> Stop
            </button>
            <button className="ghost-button arena-action" disabled={submitState.message === null} type="button" onClick={() => setSubmitState({ status: "idle", message: null, clientOrderId: null, dryRun: routerStatus.dryRun })}>
              <RotateCcw size={14} /> Clear
            </button>
          </div>
          <div className="arena-selected">
            {selectedAlgo ? (
              <>
                <span className="algo-id-pill">{selectedAlgo.displayId}</span>
                <div>
                  <strong>{shortAlgoName(selectedAlgo.name)}</strong>
                  <small>{familyLabel(selectedAlgo.family)} / {runLabel} / {signalAction ? `${signalSide} signal at ${priceCents}c` : "no buy signal"} / replay {selectedAlgo.sourceMetrics.closed} closed / {percent(selectedAlgo.sourceMetrics.roi)} ROI</small>
                </div>
              </>
            ) : (
              <span className="muted">Select an arena algo before live arming.</span>
            )}
          </div>
          <div className="live-roster">
            <div className="live-roster-heading">
              <strong>Live Roster</strong>
              <span>{liveRosterLabel}</span>
            </div>
            {runnableLiveAlgos.length === 0 ? (
              <p className="muted">Add one or more algos before pressing Play.</p>
            ) : (
              <div className="live-roster-list">
                {runnableLiveAlgos.map((algo) => {
                  const candidate = liveOrderCandidates.find((item) => item.algo.id === algo.id) ?? null;
                  return (
                    <div className="live-roster-row" key={algo.id}>
                      <span className="algo-id-pill">{algo.displayId}</span>
                      <strong>{familyLabel(algo.family)}</strong>
                      <small>{candidate?.ready ? "ready" : candidate?.signalAction && candidate.priceCents !== null ? `${candidate.signalSide} @ ${candidate.priceCents}c` : candidate?.signalAction ? "no ask" : "waiting"}</small>
                      <button className="ghost-button mini-button" disabled={runStatus === "running"} type="button" onClick={() => removeLiveRosterAlgo(algo.id)}>
                        Remove
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          {submitState.message && (
            <p className={`panel-note ${submitState.status === "accepted" ? "positive" : "negative"}`}>
              {submitState.message}{submitState.clientOrderId ? ` Client order: ${submitState.clientOrderId}.` : ""}
            </p>
          )}
          <p className="panel-note">Live Trading orders use standard execution: {money(routerStatus.maxOrderDollars)} max per order, fresh order book routing, 1c max slippage, and at least {edgeCentsLabel(routerStatus.executionMinEdgeAfterFees)} edge after costs at the slippage limit. Conservative confidence, probability, spread, time-window, and exposure-budget gates are off.</p>
        </section>

        <section className="panel arena-status-panel">
          <div className="panel-heading compact">
            <div>
              <h2>Live Status</h2>
              <span className="panel-subtitle">{activeTicker ?? "No active market"}</span>
            </div>
            <Gauge size={16} />
          </div>
          <div className="factory-summary arena-summary live-account-summary">
            <Stat label="Account" value={portfolioModeLabel(kalshiPortfolio)} tone={kalshiPortfolio.status === "live" ? "positive" : "negative"} />
            <Stat label="Balance" value={liveBalance} tone={kalshiPortfolio.balanceCents !== null && kalshiPortfolio.balanceCents > 0 ? "positive" : undefined} />
            <Stat label="Portfolio" value={livePortfolioValue} />
            <Stat label="Open" value={kalshiPortfolio.configured ? countOrDash(kalshiPortfolio.openPositions) : "-"} />
            <Stat label="Total P/L" value={liveTotalPnl === null ? "-" : signedMoney(liveTotalPnl)} tone={liveTotalPnl === null ? undefined : liveTotalPnl >= 0 ? "positive" : "negative"} />
            <Stat label="Fees" value={liveFees === null ? "-" : money(liveFees)} />
          </div>
          <div className="factory-summary arena-summary">
            <Stat label="Run State" value={runLabel} tone={runStatus === "running" ? "positive" : undefined} />
            <Stat label="Roster" value={liveRosterLabel} />
            <Stat label="Orders" value={countOrDash(kalshiPortfolio.orderCount)} />
            <Stat label="Fills" value={kalshiPortfolio.configured ? countOrDash(kalshiPortfolio.recentFills) : "-"} />
            <Stat label="W / L" value={`${countOrDash(kalshiPortfolio.wins)} / ${countOrDash(kalshiPortfolio.losses)}`} />
          </div>
          <div className="factory-summary arena-summary">
            <Stat label="Champions" value={`${championRowsForLive.length} / ${topTradersChampionSlots}`} />
            <Stat label="Cash For 100" value={money(fullChampionCashNeed)} />
            <Stat label="Current Champs" value={money(currentChampionCashNeed)} />
            <Stat label="Cash Check" value={championCashStatus} tone={championCashFeasible ? "positive" : liveCashDollars === null ? undefined : "negative"} />
            <Stat label="Dry-Live Ready" value={`${dryLiveReadyAlgos.length} / ${dryLivePromotionMaxAlgos}`} tone={dryLiveReadyAlgos.length > 0 ? "positive" : undefined} />
            <Stat label="Multi-Run" value="Enabled" tone="positive" />
          </div>
          <div className="automation-policy-grid arena-rules">
            <div>
              <strong>Funding</strong>
              <span>{liveBalance} Kalshi cash balance available to the router.</span>
            </div>
            <div>
              <strong>Order Cap</strong>
              <span>Up to {money(betCap)} cost per live order.</span>
            </div>
            <div>
              <strong>Next Entry</strong>
              <span>{signalLabel}; estimated cost {money(estimatedCost)} for {countOrDash(orderCount)} contracts.</span>
            </div>
            <div>
              <strong>Entry Rule</strong>
              <span>{allowLiveRepeatBuys ? "Repeat buys are allowed in the same active contract." : "One buy per algo per active contract."}</span>
            </div>
            <div>
              <strong>Router</strong>
              <span>{routerLabel}; {liveEntriesEnabled ? "new buys enabled" : liveSellExitsEnabled ? "new buys blocked, sell exits allowed" : "not sending real orders"}.</span>
            </div>
            <div>
              <strong>100 Champions</strong>
              <span>{money(fullChampionCashNeed)} covers one max-size entry for each champion. Actual fillability still depends on Kalshi volume at the algo prices.</span>
            </div>
          </div>
          <div className="live-gate-list">
            {gates.map((gate) => (
              <div className="live-gate-row" key={gate.label}>
                <span className={gate.pass ? "status-pill paper-fill" : "status-pill rejected"}>{gate.pass ? "PASS" : "BLOCK"}</span>
                <strong>{gate.label}</strong>
                <small>{gate.value}</small>
              </div>
            ))}
          </div>
          <p className="panel-note">Dry run simulates router submissions without sending Kalshi orders. Real orders require backend credentials, Real Orders mode, and the Live switch on for new buys.</p>
        </section>

        {favoriteLiveAlgosSection}

        <section className="panel arena-history-panel full">
          <div className="panel-heading compact">
            <div>
              <h2>Now Algo P/L</h2>
              <span className="panel-subtitle">Current Now runner results only; Top Traders history is separate</span>
            </div>
            <Badge tone={nowLivePnlRows.length > 0 ? "good" : "neutral"}>{nowLivePnlRows.length} algos</Badge>
          </div>
          <div className="paper-table-wrap now-live-pnl-wrap">
            <table>
              <thead>
                <tr>
                  <th>Algo</th>
                  <th>Type</th>
                  <th>Realized</th>
                  <th>Open</th>
                  <th>Total</th>
                  <th>Buys</th>
                  <th>Sells</th>
                  <th>Rejects</th>
                  <th>Open Ct</th>
                  <th>Last</th>
                  <th>Remove</th>
                </tr>
              </thead>
              <tbody>
                {nowLivePnlRows.length === 0 ? (
                  <tr>
                    <td className="empty-cell" colSpan={11}>Run an algo on the Now page to start tracking its P/L here.</td>
                  </tr>
                ) : nowLivePnlRows.slice(0, 40).map((row) => (
                  <tr key={row.key}>
                    <td>
                      <span className="algo-id-pill">{row.displayId}</span>
                    </td>
                    <td>
                      <strong>{row.family ? familyLabel(row.family) : "Unknown"}</strong>
                      {row.name ? <small className="muted block-small">{shortAlgoName(row.name)}</small> : null}
                    </td>
                    <td className={row.realizedPnl >= 0 ? "positive" : "negative"}>{signedMoney(row.realizedPnl)}</td>
                    <td className={row.openPnl === null ? "muted" : row.openPnl >= 0 ? "positive" : "negative"}>{row.openPnl === null ? "-" : signedMoney(row.openPnl)}</td>
                    <td className={row.totalPnl === null ? "muted" : row.totalPnl >= 0 ? "positive" : "negative"}>{row.totalPnl === null ? "-" : signedMoney(row.totalPnl)}</td>
                    <td>{countOrDash(row.buys)}</td>
                    <td>{countOrDash(row.sells)}</td>
                    <td>{countOrDash(row.rejects)}</td>
                    <td>{row.openContracts > 0 ? `${countOrDash(row.openContracts)} / ${countOrDash(row.openPositions)}` : "-"}</td>
                    <td>{row.lastAt ? formatTime(new Date(row.lastAt)) : "-"}</td>
                    <td>
                      <button
                        aria-label={`Remove ${row.displayId} from Now Algo P/L`}
                        className="ghost-button mini-button icon-only-button"
                        disabled={row.openPositions > 0}
                        title={row.openPositions > 0 ? "Close open managed positions before removing this row." : `Remove ${row.displayId} from this card`}
                        type="button"
                        onClick={() => removeNowLivePnlRow(row)}
                      >
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="panel arena-history-panel full">
          <div className="panel-heading compact">
            <div>
              <h2>Dry-Live Results</h2>
              <span className="panel-subtitle">Auto probation results from the Now dry-live runner</span>
            </div>
            <Badge tone={dryLiveProbationCounts.testing > 0 ? "warn" : dryLiveProbationCounts.passed > 0 ? "good" : "neutral"}>
              {dryLiveProbationCounts.testing} testing / {dryLiveProbationCounts.passed} passed / {dryLiveProbationCounts.failed} failed
            </Badge>
          </div>
          <div className="paper-table-wrap dry-live-results-wrap">
            <table>
              <thead>
                <tr>
                  <th>Algo</th>
                  <th>Status</th>
                  <th>Duration</th>
                  <th>Attempts</th>
                  <th>Rejects</th>
                  <th>Exits</th>
                  <th>Open</th>
                  <th>P/L</th>
                  <th>Avg / Exit</th>
                  <th>Reject Rate</th>
                  <th>Last</th>
                  <th>Reason</th>
                </tr>
              </thead>
              <tbody>
                {dryLiveProbationRows.length === 0 ? (
                  <tr>
                    <td className="empty-cell" colSpan={12}>Turn on Auto dry-live to start probation testing Top Traders winners through the live-like Now router.</td>
                  </tr>
                ) : dryLiveProbationRows.slice(0, 60).map(({ record, attempts, rejects, closedExits, totalPnl, avgTrade, rejectRate, openPositions, lastAt }) => (
                  <tr key={record.sourceAlgoId}>
                    <td><span className="algo-id-pill">{record.displayId}</span></td>
                    <td>
                      <span className={record.status === "passed" ? "status-pill paper-fill" : record.status === "failed" ? "status-pill rejected" : "status-pill queued"}>
                        {record.status.toUpperCase()}
                      </span>
                    </td>
                    <td>{activationDuration(record.startedAt, record.reviewedAt ?? snapshot.generatedAt)}</td>
                    <td>{countOrDash(attempts)}</td>
                    <td>{countOrDash(rejects)}</td>
                    <td>{countOrDash(closedExits)}</td>
                    <td>{openPositions > 0 ? countOrDash(openPositions) : "-"}</td>
                    <td className={totalPnl >= 0 ? "positive" : "negative"}>{signedMoney(totalPnl)}</td>
                    <td className={avgTrade === null ? "muted" : avgTrade >= 0 ? "positive" : "negative"}>{avgTrade === null ? "-" : signedMoney(avgTrade)}</td>
                    <td>{rejectRate === null ? "-" : percent(rejectRate)}</td>
                    <td>{lastAt ? formatTime(new Date(lastAt)) : "-"}</td>
                    <td><div className="trade-reason" title={record.reason ?? undefined}>{record.reason ?? (record.status === "testing" ? "Testing until the minimum time and sample are met." : "-")}</div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="panel-note">When dry-live probation is running, Top Traders executable testing pauses so both systems do not compete for the same simulated live-order stream.</p>
        </section>

        <section className="panel arena-history-panel full">
          <div className="panel-heading compact">
            <div>
              <h2>Live Ticker</h2>
              <span className="panel-subtitle">Armed orders and router responses</span>
            </div>
            <Badge tone={runStatus === "running" ? "good" : "neutral"}>{runStatus === "running" ? "RUNNING" : "STOPPED"}</Badge>
          </div>
          <div className="paper-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Event</th>
                  <th>Algo</th>
                  <th>Ticker</th>
                  <th>Side</th>
                  <th>Contracts</th>
                  <th>Cost</th>
                  <th>Sale</th>
                  <th>Profit</th>
                  <th>Message</th>
                </tr>
              </thead>
              <tbody>
                {liveLog.length === 0 ? (
                  <tr>
                    <td className="empty-cell" colSpan={10}>Press Play Live Algo to start the live ticker.</td>
                  </tr>
                ) : liveLog.slice(0, 16).map((entry) => {
                  const isBuyEntry = entry.orderAction === "BUY" || entry.event === "SUBMITTED";
                  const isSaleEntry = entry.orderAction === "SELL" || entry.event === "SOLD";
                  const profit = entry.profit ?? null;
                  return (
                    <tr key={entry.id}>
                      <td>{formatTime(new Date(entry.time))}</td>
                      <td><span className={entry.event === "SUBMITTED" || entry.event === "SOLD" ? "status-pill paper-fill" : entry.event === "REJECTED" ? "status-pill rejected" : "status-pill"}>{entry.event}</span></td>
                      <td>{entry.algo}</td>
                      <td>{entry.ticker ?? "-"}</td>
                      <td>{entry.side ?? "-"}</td>
                      <td>{entry.contracts === null ? "-" : countOrDash(entry.contracts)}</td>
                      <td>{entry.cost === null || !isBuyEntry ? "-" : money(entry.cost)}</td>
                      <td>{entry.cost === null || !isSaleEntry ? "-" : money(entry.cost)}</td>
                      <td className={profit === null ? "muted" : profit >= 0 ? "positive" : "negative"}>{profit === null ? "-" : signedMoney(profit)}</td>
                      <td>{entry.message}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </section>
  );
}

function ActivatedAlgosView({
  arena,
  arenaAlgos,
  arenaArchives,
  onClearActivatedData,
  onPushToLive,
}: {
  arena: PaperArenaState;
  arenaAlgos: GeneratedPaperAlgo[];
  arenaArchives: GeneratedPaperAlgoArchive[];
  onClearActivatedData: () => void;
  onPushToLive: (archive: GeneratedPaperAlgoArchive) => void;
}) {
  const [activeTab, setActiveTab] = useState<"arena" | "live">("arena");
  const [arenaBatchFilter, setArenaBatchFilter] = useState("");
  const [tradeViewer, setTradeViewer] = useState<ActivatedTradeViewerState>({
    row: null,
    status: "idle",
    trades: [],
    count: 0,
    truncated: false,
    message: null,
  });
  const tradeViewerActivationId = tradeViewer.row?.activationId ?? null;
  const closeTradeViewer = () => setTradeViewer({ row: null, status: "idle", trades: [], count: 0, truncated: false, message: null });
  const {
    activeArenaRowKeys,
    activeBatchFilter,
    arenaActiveCount,
    arenaClosed,
    arenaPnl,
    batchFilterOptions,
    bestCyclePnl,
    cleanSampleCount,
    earlySpikeCount,
    filteredSampleCount,
    filteredUniqueAlgoCount,
    metricsNow,
    qualifiedRows,
    quarantinedSampleCount,
    sampleLabel,
    topQualifiedProvenPnl15,
    topRows,
  } = useMemo(() => {
    const arenaAlgoById = new Map<string, GeneratedPaperAlgo>(arenaAlgos.map((algo) => [algo.id, algo]));
    const summaryByStrategy = paperSummarySnapshotMap(arena.paperState);
    const lastTransactionByStrategy = paperLastTransactionMap(arena.paperState);
    const arenaSelectedIds = uniqueStringList(arena.selectedAlgoIds.length > 0
      ? arena.selectedAlgoIds
      : arena.selectedAlgoId ? [arena.selectedAlgoId] : []);
    const activeArenaEntryPolicy: ArenaEntryPolicy = arena.allowRepeatBuys ? "repeat-entry" : "single-entry";
    const arenaRows: ActivatedAlgoRow[] = arenaSelectedIds
      .map((id) => arenaAlgoById.get(id) ?? null)
      .filter((algo): algo is GeneratedPaperAlgo => algo !== null)
      .map((algo) => ({
        activationId: algo.id,
        displayId: algo.displayId,
        sourceAlgoId: algo.sourceAlgoId,
        name: algo.name,
        family: algo.family,
        params: algo.params,
        sourceRunId: algo.sourceRunId,
        activatedAt: arena.startedAt ?? algo.promotedAt,
        deactivatedAt: arena.status === "running" ? null : arena.stoppedAt,
        arenaEntryPolicy: activeArenaEntryPolicy,
        sourceMetrics: algo.sourceMetrics,
        liveStats: summaryByStrategy.get(algo.id) ?? emptyPaperSummarySnapshot(),
        lastTransactionAt: lastTransactionByStrategy.get(algo.id) ?? null,
        isActive: true,
      }))
      .filter(isFactoryBatchActivatedRow);
    const activeArenaRowKeys = new Set(arenaRows.flatMap(activatedRowIdentityKeys));
    const archivedRows: ActivatedAlgoRow[] = arenaArchives
      .slice()
      .filter(isFactoryBatchActivatedRow)
      .sort(compareActivatedArchiveRows)
      .map((archive) => ({ ...archive, isActive: false }));
    const rows = [...arenaRows, ...archivedRows];
    const metricsNow = new Date().toISOString();
    const batchFilterOptions = activatedBatchFilterOptions(rows);
    const activeBatchFilter = batchFilterOptions.some((option) => option.key === arenaBatchFilter)
      ? arenaBatchFilter
      : newestActivatedBatchFilterKey(batchFilterOptions);
    const filteredRows = activeBatchFilter
      ? rows.filter((row) => activatedBatchFilterKey(row) === activeBatchFilter)
      : [];
    const filteredUniqueAlgoCount = activatedUniqueAlgoCount(filteredRows);
    const cleanSampleRows = filteredRows.filter(factoryArchiveCanTrain);
    const aggregatedRows = aggregateActivatedRows(cleanSampleRows, arena.paperState, metricsNow);
    const quarantinedSampleCount = filteredRows.length - cleanSampleRows.length;
    const topRows = aggregatedRows
      .slice()
      .sort((left, right) => activatedTrainingSortScore(right) - activatedTrainingSortScore(left)
        || activatedRankingScore(right, metricsNow) - activatedRankingScore(left, metricsNow)
        || activatedPnlPerCycle(right, metricsNow) - activatedPnlPerCycle(left, metricsNow)
        || right.liveStats.totalPnl - left.liveStats.totalPnl
        || (right.liveStats.roi ?? -Infinity) - (left.liveStats.roi ?? -Infinity)
        || right.liveStats.sells - left.liveStats.sells)
      .slice(0, activatedAlgoTopLimit);
    const qualifiedRows = aggregatedRows.filter((row) => activatedConfidence(row, metricsNow).liveEligible);
    const earlySpikeCount = aggregatedRows.filter((row) => activatedConfidence(row, metricsNow).label === "EARLY SPIKE").length;
    const topQualifiedProvenRows = topRows.filter((row) => {
      const label = activatedConfidence(row, metricsNow).label;
      return label === "QUALIFIED" || label === "PROVEN";
    });
    const topQualifiedProvenPnl15 = topQualifiedProvenRows.length > 0
      ? roundDisplayMoney(topQualifiedProvenRows.reduce((total, row) => total + activatedPnlPerCycle(row, metricsNow), 0))
      : null;
    const arenaActiveCount = arena.status === "running" ? arenaRows.length : 0;
    const filteredActiveRows = activeBatchFilter
      ? arenaRows.filter((row) => activatedBatchFilterKey(row) === activeBatchFilter)
      : [];
    const arenaClosed = filteredActiveRows.reduce((total, row) => total + row.liveStats.sells, 0);
    const arenaPnl = roundDisplayMoney(filteredActiveRows.reduce((total, row) => total + row.liveStats.totalPnl, 0));
    const sampleLabel = "Batch Samples";
    const bestCyclePnl = qualifiedRows.length > 0
      ? activatedPnlPerCycle(qualifiedRows.slice().sort((left, right) => activatedPnlPerCycle(right, metricsNow) - activatedPnlPerCycle(left, metricsNow))[0], metricsNow)
      : null;
    return {
      activeArenaRowKeys,
      activeBatchFilter,
      arenaActiveCount,
      arenaClosed,
      arenaPnl,
      batchFilterOptions,
      bestCyclePnl,
      cleanSampleCount: cleanSampleRows.length,
      earlySpikeCount,
      filteredSampleCount: filteredRows.length,
      filteredUniqueAlgoCount,
      metricsNow,
      qualifiedRows,
      quarantinedSampleCount,
      sampleLabel,
      topQualifiedProvenPnl15,
      topRows,
    };
  }, [arena, arenaAlgos, arenaArchives, arenaBatchFilter]);
  const { bestLive, liveClosed, liveOpen, livePnl, liveRows } = useMemo(() => {
    const liveRows = loadLiveManagedPositions();
    const liveClosed = liveRows.filter((row) => row.status === "closed" && row.realizedPnl !== null);
    const liveOpen = liveRows.filter((row) => row.status === "open");
    const livePnl = roundDisplayMoney(liveClosed.reduce((total, row) => total + (row.realizedPnl ?? 0), 0));
    const bestLive = liveClosed
      .slice()
      .sort((left, right) => (right.realizedPnl ?? -Infinity) - (left.realizedPnl ?? -Infinity))[0] ?? null;
    return { bestLive, liveClosed, liveOpen, livePnl, liveRows };
  }, []);
  const openTradeViewer = async (row: ActivatedAlgoRow) => {
    const until = row.deactivatedAt ?? new Date().toISOString();
    setTradeViewer({ row, status: "loading", trades: [], count: 0, truncated: false, message: null });
    try {
      const result = await fetchPaperTrades({
        sourceAlgoId: row.sourceAlgoId,
        since: row.activatedAt,
        until,
        limit: 500,
      });
      const fallbackTrades = result.trades.length === 0 ? activatedTradesFromPaperState(arena.paperState, row, until) : [];
      const trades = result.trades.length > 0 ? result.trades : fallbackTrades;
      const expectedTradeCount = row.liveStats.buys + row.liveStats.sells;
      const missingSavedDetails = trades.length === 0 && expectedTradeCount > 0;
      setTradeViewer({
        row,
        status: "ready",
        trades,
        count: Math.max(result.count, trades.length),
        truncated: result.truncated,
        message: result.truncated
          ? `Showing latest ${result.trades.length} of ${result.count} saved trades.`
          : fallbackTrades.length > 0
            ? "Saved trade endpoint had no rows yet; showing current in-memory arena trades."
            : missingSavedDetails
              ? "This run has aggregate stats, but detailed trade rows were not persisted by the older worker. New runs will save details again."
              : null,
      });
    } catch (error) {
      const fallbackTrades = activatedTradesFromPaperState(arena.paperState, row, until);
      const expectedTradeCount = row.liveStats.buys + row.liveStats.sells;
      setTradeViewer({
        row,
        status: fallbackTrades.length > 0 ? "ready" : "error",
        trades: fallbackTrades,
        count: fallbackTrades.length,
        truncated: false,
        message: fallbackTrades.length > 0
          ? "Local worker trade endpoint is unavailable; showing current in-memory arena trades."
          : expectedTradeCount > 0
            ? "This run has aggregate stats, but detailed trade rows were not persisted by the older worker. New runs will save details again."
          : error instanceof Error ? error.message : "Could not load saved trades.",
      });
    }
  };

  return (
    <section className="view-grid">
      <PanelTitle title="Activated Algos" icon={<ListChecks size={18} />} />
      <section className="panel factory-panel full">
        <div className="panel-heading compact">
          <div>
            <h2>Activation History</h2>
            <span className="panel-subtitle">Realistic arena and live algo periods tracked separately</span>
          </div>
          <div className="heading-actions">
            <button className="ghost-button" type="button" onClick={onClearActivatedData}>
              <RotateCcw size={14} /> Clear Data
            </button>
            <Badge tone={activeTab === "arena" ? arenaActiveCount > 0 ? "good" : "neutral" : liveOpen.length > 0 ? "good" : "neutral"}>
              {activeTab === "arena" ? `${arenaActiveCount} arena active` : `${liveOpen.length} live open`}
            </Badge>
          </div>
        </div>
        <div className="tabs activated-tabs">
          <button className={activeTab === "arena" ? "active" : ""} type="button" onClick={() => setActiveTab("arena")}>Arena</button>
          <button className={activeTab === "live" ? "active" : ""} type="button" onClick={() => setActiveTab("live")}>Live</button>
        </div>
        {activeTab === "arena" ? (
          <>
            <div className="factory-summary activated-summary">
              <Stat label="Active Runs" value={countOrDash(arenaActiveCount)} />
              <Stat label="Unique Algos" value={countOrDash(filteredUniqueAlgoCount)} />
              <Stat label={sampleLabel} value={countOrDash(filteredSampleCount)} />
              <Stat label="Training Samples" value={countOrDash(cleanSampleCount)} />
              <Stat label="Qualified" value={countOrDash(qualifiedRows.length)} />
              <Stat label="Early Spikes" value={countOrDash(earlySpikeCount)} />
              <Stat label="Skipped Samples" value={countOrDash(quarantinedSampleCount)} />
              <Stat label="Arena Sells" value={countOrDash(arenaClosed)} />
              <Stat label="Arena P/L" value={signedMoney(arenaPnl)} tone={arenaPnl >= 0 ? "positive" : "negative"} />
              <Stat label="Best Qualified / 15m" value={bestCyclePnl === null ? "-" : signedMoney(bestCyclePnl)} tone={bestCyclePnl === null ? undefined : bestCyclePnl >= 0 ? "positive" : "negative"} />
              <Stat label="Top 100 Q/P / 15m" value={topQualifiedProvenPnl15 === null ? "-" : signedMoney(topQualifiedProvenPnl15)} tone={topQualifiedProvenPnl15 === null ? undefined : topQualifiedProvenPnl15 >= 0 ? "positive" : "negative"} />
            </div>
            <div className="activated-filter-row">
              <span>Batch</span>
              <div className="segmented-control">
                {batchFilterOptions.map((option) => (
                  <button className={activeBatchFilter === option.key ? "active" : ""} key={option.key} type="button" onClick={() => setArenaBatchFilter(option.key)}>
                    {option.label}
                    <small>{countOrDash(option.uniqueAlgoCount)} algos / {countOrDash(option.sampleCount)} samples</small>
                  </button>
                ))}
              </div>
            </div>
            <div className="upgrade-table-wrap">
              <table className="activated-table">
                <colgroup>
                  <col className="activated-col-id" />
                  <col className="activated-col-algo" />
                  <col className="activated-col-run" />
                  <col className="activated-col-trades" />
                  <col className="activated-col-wl" />
                  <col className="activated-col-confidence" />
                  <col className="activated-col-pnl" />
                  <col className="activated-col-roi" />
                  <col className="activated-col-cycles" />
                  <col className="activated-col-action" />
                </colgroup>
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Algo</th>
                    <th>Run</th>
                    <th>Trades</th>
                    <th>W / L</th>
                    <th>Confidence</th>
                    <th>P/L / 15m</th>
                    <th>ROI</th>
                    <th>Elapsed 15m</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {topRows.length === 0 ? (
                    <tr>
                      <td className="empty-cell" colSpan={10}>No realistic arena algo data yet.</td>
                    </tr>
                  ) : topRows.map((row) => {
                    const rowKey = `${row.activationId}:${row.activatedAt}`;
                    const expanded = tradeViewerActivationId === row.activationId;
                    const end = row.deactivatedAt ?? metricsNow;
                    const cycleCount = activatedCycleCountForRow(row, end);
                    const pnlPerCycle = activatedPnlPerCycle(row, metricsNow);
                    const confidence = activatedConfidence(row, metricsNow);
                    const confidenceShortDetail = activatedConfidenceShortDetail(row, metricsNow);
                    const trainingStatus = activatedTrainingStatus(row);
                    const canPushToLive = confidence.liveEligible && trainingStatus.factoryEligible;
                    const runningAgain = !row.isActive && activatedRowMatchesActiveSet(row, activeArenaRowKeys);
                    const algoDetail = [row.name, generatedAlgoParamSummaryFromParams(row.params)].filter(Boolean).join(" / ");
                    const lastTransactionAt = row.lastTransactionAt ?? activatedFallbackLastTransactionAt(arena.paperState, row, end);
                    const runDetail = row.sampleCount && row.sampleCount > 1
                      ? `${activatedBatchLabel(row)} / ${row.sampleCount} sessions`
                      : `${activatedBatchLabel(row)} / ${activationDuration(row.activatedAt, end)}`;
                    return (
                      <Fragment key={rowKey}>
                        <tr className={expanded ? "activated-row-expanded" : undefined}>
                          <td><span className="algo-id-pill">{row.displayId}</span></td>
                          <td title={algoDetail}>
                            <div className="candidate-name compact-name">
                              <strong>{familyLabel(row.family)}</strong>
                            </div>
                          </td>
                          <td>
                            <div className="candidate-name compact-name">
                              <strong>{row.isActive ? "Active now" : runningAgain ? "Running again" : "Historical sample"}</strong>
                              <span>{runDetail}</span>
                              <span>{trainingStatus.detail}</span>
                            </div>
                          </td>
                          <td>
                            <div className="metric-cell">
                              <strong>{row.liveStats.buys} / {row.liveStats.sells}</strong>
                              <span>{row.liveStats.open} open</span>
                              <span>{lastTransactionAt ? `Last ${formatTime(new Date(lastTransactionAt))}` : "No tx yet"}</span>
                            </div>
                          </td>
                          <td>{row.liveStats.wins} / {row.liveStats.losses}</td>
                          <td>
                            <div className="confidence-cell">
                              <Badge tone={confidence.tone}>{confidence.label}</Badge>
                              <Badge tone={trainingStatus.tone}>{trainingStatus.label}</Badge>
                              <span title={confidence.detail}>{confidenceShortDetail}</span>
                            </div>
                          </td>
                          <td className={pnlPerCycle >= 0 ? "positive" : "negative"}>
                            <div className="metric-cell money-metric">
                              <strong>{signedMoney(pnlPerCycle)}</strong>
                              <span>{signedMoney(row.liveStats.totalPnl)} total</span>
                            </div>
                          </td>
                          <td>{row.liveStats.roi === null ? "-" : percent(row.liveStats.roi)}</td>
                          <td>{activatedFullCycleCountForRow(row, end)} full / {cycleCount} elapsed</td>
                          <td>
                            <div className="table-action-stack">
                              <button className="ghost-button table-button" type="button" onClick={() => expanded ? closeTradeViewer() : void openTradeViewer(row)}>
                                {expanded ? "Hide Trades" : "Trades"}
                              </button>
                              <button className="ghost-button table-button" type="button" disabled={!canPushToLive} title={canPushToLive ? "Qualified sample for live watchlist" : trainingStatus.factoryEligible ? confidence.detail : trainingStatus.detail} onClick={() => onPushToLive(activatedRowToArchive(row))}>
                                {canPushToLive ? "Push to Live" : trainingStatus.factoryEligible ? "Watch Only" : "Retest First"}
                              </button>
                            </div>
                          </td>
                        </tr>
                        {expanded && (
                          <tr className="activated-trade-detail-row">
                            <td colSpan={10}>
                              <ActivatedTradeHistoryPanel state={tradeViewer} onClose={closeTradeViewer} />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="panel-note">Elapsed 15m is wall-clock time since activation, not a count of buy opportunities. Low trade counts over many elapsed windows mean the algo rarely found a signal that passed spread, edge, depth, bankroll, and one-entry gates.</p>
          </>
        ) : (
          <>
            <div className="factory-summary">
              <Stat label="Open Live" value={countOrDash(liveOpen.length)} />
              <Stat label="Closed Live" value={countOrDash(liveClosed.length)} />
              <Stat label="Live P/L" value={signedMoney(livePnl)} tone={livePnl >= 0 ? "positive" : "negative"} />
              <Stat label="Best Live P/L" value={bestLive?.realizedPnl === null || !bestLive ? "-" : signedMoney(bestLive.realizedPnl)} />
              <Stat label="Stored Positions" value={countOrDash(liveRows.length)} />
            </div>
            <div className="upgrade-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Algo</th>
                    <th>Family</th>
                    <th>Live Period</th>
                    <th>Side</th>
                    <th>Contracts</th>
                    <th>Entry</th>
                    <th>Exit</th>
                    <th>Status</th>
                    <th>P/L</th>
                  </tr>
                </thead>
                <tbody>
                  {liveRows.length === 0 ? (
                    <tr>
                      <td className="empty-cell" colSpan={10}>No live algo positions have been recorded yet.</td>
                    </tr>
                  ) : liveRows.map((row) => (
                    <tr key={row.id}>
                      <td><span className="algo-id-pill">{row.algoDisplayId}</span></td>
                      <td>
                        <div className="candidate-name">
                          <strong>{shortAlgoName(row.algoName)}</strong>
                          <span>{row.exitReason ?? generatedAlgoParamSummaryFromParams(row.algoParams)}</span>
                        </div>
                      </td>
                      <td>{familyLabel(row.algoFamily)}</td>
                      <td>
                        <div className="candidate-name compact-name">
                          <strong>{formatTime(new Date(row.openedAt))} - {row.closedAt === null ? "Live" : formatTime(new Date(row.closedAt))}</strong>
                          <span>{activationDuration(row.openedAt, row.closedAt ?? new Date().toISOString())}</span>
                        </div>
                      </td>
                      <td><span className={row.side === "YES" ? "side yes" : "side no"}>{row.side}</span></td>
                      <td>{countOrDash(row.contracts)}</td>
                      <td>{contractPrice(row.entryPrice)}</td>
                      <td>{row.exitPrice === null ? "-" : contractPrice(row.exitPrice)}</td>
                      <td>{row.status}</td>
                      <td className={row.realizedPnl === null ? "muted" : row.realizedPnl >= 0 ? "positive" : "negative"}>{row.realizedPnl === null ? "-" : signedMoney(row.realizedPnl)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="panel-note">Live records are based on positions tracked by the live runner and backend order-router responses.</p>
          </>
        )}
      </section>
    </section>
  );
}

function ActivatedTradeHistoryPanel({ state, onClose }: { state: ActivatedTradeViewerState; onClose: () => void }) {
  const row = state.row;
  if (!row) return null;
  const closedTrades = state.trades.filter((trade) => trade.status === "closed" && trade.pnl !== null);
  const totalPnl = roundDisplayMoney(closedTrades.reduce((total, trade) => total + (trade.pnl ?? 0), 0));
  const totalCost = roundDisplayMoney(closedTrades.reduce((total, trade) => total + paperTradeCost(trade), 0));
  const winCount = closedTrades.filter((trade) => (trade.pnl ?? 0) > 0).length;
  const lossCount = closedTrades.filter((trade) => (trade.pnl ?? 0) < 0).length;
  const roi = totalCost > 0 ? roundDisplayRatio(totalPnl / totalCost) : null;

  return (
    <div className="activated-trade-panel">
      <div className="activated-trade-heading">
        <div>
          <h3>{row.displayId} Trades</h3>
          <span>{shortAlgoName(row.name)} / {activatedBatchLabel(row)} / {activationDuration(row.activatedAt, row.deactivatedAt ?? new Date().toISOString())}</span>
        </div>
        <div className="activated-trade-metrics">
          <StatLine label="Trades" value={state.status === "loading" ? "Loading" : countOrDash(state.count)} />
          <StatLine label="W / L" value={`${countOrDash(winCount)} / ${countOrDash(lossCount)}`} />
          <StatLine label="P/L" value={signedMoney(totalPnl)} tone={totalPnl >= 0 ? "positive" : "negative"} />
          <StatLine label="ROI" value={roi === null ? "-" : percent(roi)} tone={roi === null ? undefined : roi >= 0 ? "positive" : "negative"} />
        </div>
        <button className="ghost-button" type="button" onClick={onClose}>Close</button>
      </div>
      {state.message && <p className={state.status === "error" ? "panel-note negative" : "table-note"}>{state.message}</p>}
      {state.status === "loading" ? (
        <p className="table-note">Loading saved trades...</p>
      ) : state.trades.length === 0 ? (
        <p className="table-note">No saved trades found for this algo in this activation window.</p>
      ) : (
        <div className="paper-table-wrap activated-trades-wrap">
          <table>
            <thead>
              <tr>
                <th>Opened</th>
                <th>Closed</th>
                <th>Market</th>
                <th>Side</th>
                <th>Contracts</th>
                <th>Entry</th>
                <th>Exit</th>
                <th>Edge</th>
                <th>Spread</th>
                <th>Status</th>
                <th>P/L</th>
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>
              {state.trades.map((trade) => (
                <tr key={trade.id}>
                  <td>{formatTime(new Date(trade.openedAt))}</td>
                  <td>{trade.closedAt ? formatTime(new Date(trade.closedAt)) : "-"}</td>
                  <td>{trade.marketTicker}</td>
                  <td><span className={trade.side === "YES" ? "side yes" : "side no"}>{trade.side}</span></td>
                  <td>{countOrDash(trade.contracts)}</td>
                  <td>{contractPrice(trade.entryPrice)}</td>
                  <td>{trade.exitPrice === null ? "-" : contractPrice(trade.exitPrice)}</td>
                  <td>{percent(trade.entryContext.edgeAfterFees)}</td>
                  <td>{trade.entryContext.selectedSpread === null ? "-" : contractPrice(trade.entryContext.selectedSpread)}</td>
                  <td>{trade.status}</td>
                  <td className={trade.pnl === null ? "muted" : trade.pnl >= 0 ? "positive" : "negative"}>{trade.pnl === null ? "-" : signedMoney(trade.pnl)}</td>
                  <td><div className="trade-reason" title={trade.reason}>{trade.reason}</div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function AccountSettingsView({
  snapshot,
  kalshiPortfolio,
  routerStatus,
}: {
  snapshot: RuntimeSnapshot;
  kalshiPortfolio: KalshiPortfolioSummary;
  routerStatus: LiveOrderRouterStatus;
}) {
  return (
    <section className="view-grid account-settings-view">
      <PanelTitle title="Account & Settings" icon={<CircleDollarSign size={18} />} />
      <AccountPanels kalshiPortfolio={kalshiPortfolio} />
      <SettingsPanels snapshot={snapshot} kalshiPortfolio={kalshiPortfolio} routerStatus={routerStatus} />
    </section>
  );
}

function AccountPanels({ kalshiPortfolio }: { kalshiPortfolio: KalshiPortfolioSummary }) {
  const totalPnl = kalshiPortfolio.totalPnlDollars;
  return (
    <div className="account-wide">
      <div className="panel">
        <h3>Read-Only Portfolio</h3>
        <StatLine label="Connection" value={portfolioModeLabel(kalshiPortfolio)} tone={kalshiPortfolio.status === "live" ? "positive" : "negative"} />
        <StatLine label="Balance" value={kalshiPortfolio.balanceCents === null ? "-" : centsMoney(kalshiPortfolio.balanceCents)} />
        <StatLine label="Portfolio Value" value={kalshiPortfolio.portfolioValueCents === null ? "-" : centsMoney(kalshiPortfolio.portfolioValueCents)} />
        <StatLine label="Total P/L" value={totalPnl === null ? "-" : signedMoney(totalPnl)} tone={totalPnl === null ? undefined : totalPnl >= 0 ? "positive" : "negative"} />
        <StatLine label="Realized P/L" value={kalshiPortfolio.realizedPnlDollars === null ? "-" : signedMoney(kalshiPortfolio.realizedPnlDollars)} tone={kalshiPortfolio.realizedPnlDollars === null ? undefined : kalshiPortfolio.realizedPnlDollars >= 0 ? "positive" : "negative"} />
      </div>
      <div className="panel">
        <h3>Activity</h3>
        <StatLine label="Orders" value={countOrDash(kalshiPortfolio.orderCount)} />
        <StatLine label="Wins" value={countOrDash(kalshiPortfolio.wins)} tone="positive" />
        <StatLine label="Losses" value={countOrDash(kalshiPortfolio.losses)} tone="negative" />
        <StatLine label="Open Positions" value={kalshiPortfolio.configured ? String(kalshiPortfolio.openPositions) : "-"} />
        <StatLine label="Recent Fills" value={kalshiPortfolio.configured ? String(kalshiPortfolio.recentFills) : "-"} />
        <StatLine label="Series" value={kalshiPortfolio.seriesTicker ?? "KXDOGE15M"} />
        <StatLine label="Last Fetch" value={kalshiPortfolio.fetchedAt ? formatTime(new Date(kalshiPortfolio.fetchedAt)) : "-"} />
        <StatLine label="Credentials" value={kalshiPortfolio.configured ? "Backend only" : "Not configured"} tone={kalshiPortfolio.configured ? "positive" : "negative"} />
      </div>
    </div>
  );
}

function SettingsPanels({
  snapshot,
  kalshiPortfolio,
  routerStatus,
}: {
  snapshot: RuntimeSnapshot;
  kalshiPortfolio: KalshiPortfolioSummary;
  routerStatus: LiveOrderRouterStatus;
}) {
  return (
    <div className="settings-grid">
      <div className="panel">
        <h3>Data Sources</h3>
        <StatLine label="Primary estimate" value="Coinbase DOGE-USD spot" />
        <StatLine label="Kalshi series" value={snapshot.kalshi.seriesTicker ?? "KXDOGE15M pending"} />
        <StatLine label="Active ticker" value={snapshot.kalshi.market?.ticker ?? "Pending"} />
        <StatLine label="CF RTI adapter" value={snapshot.kalshi.market ? "Rule source only" : "Pending"} />
        <StatLine label="Kalshi portfolio" value={portfolioModeLabel(kalshiPortfolio)} tone={kalshiPortfolio.status === "live" ? "positive" : "negative"} />
      </div>
      <div className="panel">
        <h3>Trading</h3>
        <StatLine label="Order router" value={routerStatus.configured ? orderRouterLabel(routerStatus) : "Not configured"} tone={routerStatus.configured ? "positive" : "negative"} />
        <StatLine label="Max order" value={money(routerStatus.maxOrderDollars)} />
        <StatLine label="Executor mode" value={routerStatus.conservativeMode ? "Conservative" : "Standard"} tone={routerStatus.conservativeMode ? "negative" : "positive"} />
        <StatLine label="Browser credentials" value="Never used" tone="positive" />
        <StatLine label="Live entry switch" value={routerStatus.liveSwitchEnabled ? "On" : "Off"} tone={routerStatus.liveSwitchEnabled ? "positive" : "negative"} />
        <StatLine label="Order mode" value={routerStatus.dryRun ? "Dry run" : "Real orders"} tone={routerStatus.dryRun ? undefined : "negative"} />
      </div>
    </div>
  );
}

type SweepFamilyBestRow = {
  family: string;
  count: number;
  best: LocalFactorySweepCandidate;
};

type PaperFamilyBaseline = {
  label: string;
  closed: number;
  totalPnl: number;
  roi: number | null;
};

function bestSweepCandidateByFamily(candidates: LocalFactorySweepCandidate[]): SweepFamilyBestRow[] {
  const families = new Map<string, SweepFamilyBestRow>();
  for (const candidate of candidates) {
    const current = families.get(candidate.family);
    if (!current) {
      families.set(candidate.family, {
        family: candidate.family,
        count: 1,
        best: candidate,
      });
      continue;
    }
    families.set(candidate.family, {
      family: candidate.family,
      count: current.count + 1,
      best: betterSweepCandidate(candidate, current.best),
    });
  }
  return [...families.values()].sort((left, right) => right.best.robustScore - left.best.robustScore || right.best.candidateScore - left.best.candidateScore || right.best.totalPnl - left.best.totalPnl);
}

function factoryResearchEvidenceBySource(latestSweep: LocalFactorySweep | null) {
  const map = new Map<string, LocalFactorySweepCandidate>();
  if (!latestSweep) return map;
  for (const candidate of [...latestSweep.topMetrics, ...latestSweep.candidates]) {
    const current = map.get(candidate.algoId);
    map.set(candidate.algoId, current ? betterSweepCandidate(candidate, current) : candidate);
  }
  return map;
}

function factoryEvidenceForTopTraderRow(row: TopTraderRow, evidence: Map<string, LocalFactorySweepCandidate>) {
  return evidence.get(row.sourceAlgoId) ?? evidence.get(row.displayId) ?? null;
}

function topTraderResearchTone(candidate: LocalFactorySweepCandidate | null): "info" | "warn" | "good" | "bad" | "neutral" {
  if (!candidate) return "neutral";
  if (candidate.nonPromotable) return candidate.promotionVerdict === "insufficient_data" ? "warn" : "bad";
  if (candidate.promotionVerdict === "paper_only" || candidate.promotionVerdict === "tiny_live_eligible") return "good";
  if (candidate.promotionVerdict === "insufficient_data") return "warn";
  return "bad";
}

function topTraderResearchLabel(candidate: LocalFactorySweepCandidate | null) {
  if (!candidate) return "Research -";
  if (candidate.nonPromotable && candidate.promotionVerdict === "insufficient_data") return "Insufficient";
  if (candidate.nonPromotable) return "No promo";
  if (candidate.promotionVerdict === "paper_only") return "Research ok";
  if (candidate.promotionVerdict === "tiny_live_eligible") return "Tiny gated";
  return candidate.promotionVerdict.replaceAll("_", " ");
}

function betterSweepCandidate(candidate: LocalFactorySweepCandidate, current: LocalFactorySweepCandidate) {
  if (candidate.robustScore !== current.robustScore) return candidate.robustScore > current.robustScore ? candidate : current;
  if (candidate.candidateScore !== current.candidateScore) return candidate.candidateScore > current.candidateScore ? candidate : current;
  if (candidate.totalPnl !== current.totalPnl) return candidate.totalPnl > current.totalPnl ? candidate : current;
  if (candidate.roi !== current.roi) return candidate.roi > current.roi ? candidate : current;
  return candidate.closed > current.closed ? candidate : current;
}

function activePaperBaselineForCandidate(
  candidate: LocalFactorySweepCandidate,
  generatedPaperAlgos: GeneratedPaperAlgo[],
  learningReport: LearningReport,
  paperState: PaperState,
): PaperFamilyBaseline {
  const generatedBaselines = generatedPaperAlgos
    .filter((algo) => algo.enabled && algo.family === candidate.family)
    .map((algo) => paperBaselineFromTrades(`${algo.displayId} ${shortAlgoName(algo.name)}`, paperState, algo.id))
    .filter((baseline) => baseline.closed > 0)
    .sort((left, right) => (right.roi ?? -Infinity) - (left.roi ?? -Infinity) || right.totalPnl - left.totalPnl);
  if (generatedBaselines[0]) return generatedBaselines[0];

  const strategyId = builtInBaselineForSweepCandidate(candidate);
  if (!strategyId) {
    return { label: "No active paper baseline", closed: 0, totalPnl: 0, roi: null };
  }
  const metric = learningReport.strategyMetrics.find((item) => item.strategyId === strategyId);
  const definition = paperStrategyDefinitions.find((strategy) => strategy.id === strategyId);
  return {
    label: definition?.shortName ?? definition?.name ?? "Paper baseline",
    closed: metric?.closed ?? 0,
    totalPnl: metric?.totalPnl ?? 0,
    roi: metric?.roi ?? null,
  };
}

function builtInBaselineForSweepFamily(family: string): BuiltInPaperStrategyId | null {
  if (family === "sweep-model" || family === "shadow" || family === "paper-variant" || family === "paper") return "final60";
  if (family === "sweep-scalp" || family === "sweep-managed-scalp" || family === "sweep-liquidity-imbalance") return "orderbookScalp";
  if (family === "sweep-momentum" || family === "sweep-fade-momentum") return "momentumFlip";
  if (family === "sweep-distance" || family === "sweep-target-revert" || family === "sweep-late-favorite" || family === "sweep-late-lock" || family === "sweep-kalshi-lag-lock") return "thresholdDistance";
  return null;
}

function builtInBaselineForSweepCandidate(candidate: LocalFactorySweepCandidate): BuiltInPaperStrategyId | null {
  const text = `${candidate.family} ${candidate.algoName} ${candidate.algoId}`.toLowerCase();
  if (text.includes("momentum")) return "momentumFlip";
  if (text.includes("scalp") || text.includes("spread")) return "orderbookScalp";
  if (text.includes("distance") || text.includes("threshold") || text.includes("longshot") || text.includes("favorite") || text.includes("late lock") || text.includes("kalshi lag")) return "thresholdDistance";
  if (text.includes("final") || text.includes("model")) return "final60";
  return builtInBaselineForSweepFamily(candidate.family);
}

function paperBaselineFromTrades(label: string, paperState: PaperState, strategyId: string): PaperFamilyBaseline {
  const closed = paperState.trades.filter((trade) => trade.strategyId === strategyId && trade.status === "closed" && trade.pnl !== null);
  const totalPnl = roundDisplayMoney(closed.reduce((total, trade) => total + (trade.pnl ?? 0), 0));
  const totalCost = roundDisplayMoney(closed.reduce((total, trade) => total + trade.entryPrice * trade.contracts, 0));
  return {
    label,
    closed: closed.length,
    totalPnl,
    roi: totalCost > 0 ? roundDisplayRatio(totalPnl / totalCost) : null,
  };
}

type FactoryAutomationPlan = {
  decisions: FactoryAutomationDecision[];
  demoteIds: string[];
  promotions: LocalFactorySweepCandidate[];
};

function buildFactoryAutomationPlan({
  archives,
  generatedPaperAlgos,
  learningReport,
  paperState,
  sweep,
  now,
}: {
  archives: GeneratedPaperAlgoArchive[];
  generatedPaperAlgos: GeneratedPaperAlgo[];
  learningReport: LearningReport;
  paperState: PaperState;
  sweep: LocalFactorySweep | null;
  now: string;
}): FactoryAutomationPlan {
  const decisions: FactoryAutomationDecision[] = [];
  const demoteIds: string[] = [];

  for (const algo of generatedPaperAlgos.filter((item) => item.enabled)) {
    const stats = paperSummarySnapshot(paperState, algo.id);
    const demotion = generatedAlgoAutomationReview(algo, stats);
    if (demotion.type === "demote") {
      demoteIds.push(algo.id);
      decisions.push(automationDecision(now, "demote", "negative", `Demoted ${algo.displayId}`, demotion.detail));
    } else if (demotion.type === "flag") {
      decisions.push(automationDecision(now, "flag", "warning", `Flagged ${algo.displayId}`, demotion.detail));
    }
  }

  const promotions: LocalFactorySweepCandidate[] = [];
  if (sweep) {
    const activeGeneratedAfterDemotion = generatedPaperAlgos.filter((algo) => algo.enabled && !demoteIds.includes(algo.id));
    for (const row of bestSweepCandidateByFamily(sweep.candidates)) {
      if (promotions.length >= 3) break;
      const candidate = row.best;
      const review = sweepCandidateAutomationReview(candidate, activeGeneratedAfterDemotion, archives, learningReport, paperState);
      if (review.type === "promote") {
        promotions.push(candidate);
        decisions.push(automationDecision(now, "promote", "positive", `Promoted ${shortAlgoName(candidate.algoName)}`, review.detail));
      } else if (review.type === "flag") {
        decisions.push(automationDecision(now, "flag", "warning", `${familyLabel(candidate.family)} watch`, review.detail));
      }
    }
  }

  return { decisions, demoteIds, promotions };
}

function generatedAlgoAutomationReview(algo: GeneratedPaperAlgo, stats: PaperSummarySnapshot) {
  const closed = stats.sells;
  const roi = stats.roi ?? 0;
  if (algo.family === "sweep-managed-scalp" && closed >= 8 && (stats.totalPnl < 0 || roi < 0.03)) {
    return { type: "demote" as const, detail: `${closed} closed live paper trades, ${signedMoney(stats.totalPnl)} P/L, ${nullableSignedPercent(stats.roi)} ROI. Managed scalp is treated cautiously after live weakness.` };
  }
  if (closed >= 12 && (stats.totalPnl < -0.25 || roi < -0.1)) {
    return { type: "demote" as const, detail: `${closed} closed live paper trades, ${signedMoney(stats.totalPnl)} P/L, ${nullableSignedPercent(stats.roi)} ROI.` };
  }
  if (closed >= 20 && roi < 0.05) {
    return { type: "demote" as const, detail: `${closed} closed live paper trades with ROI below the 5% keep threshold.` };
  }
  if (closed >= 6 && stats.totalPnl < 0) {
    return { type: "flag" as const, detail: `${closed} closed live paper trades and currently negative at ${signedMoney(stats.totalPnl)}.` };
  }
  return { type: "hold" as const, detail: "No automation action." };
}

function sweepCandidateAutomationReview(
  candidate: LocalFactorySweepCandidate,
  activeGeneratedAlgos: GeneratedPaperAlgo[],
  archives: GeneratedPaperAlgoArchive[],
  learningReport: LearningReport,
  paperState: PaperState,
) {
  if (candidate.nonPromotable) {
    return { type: "hold" as const, detail: `Factory marked this candidate non-promotable: ${candidate.reasonCodes.join(", ") || candidate.promotionVerdict}.` };
  }
  if (!generatedPaperAlgoSupportsFamily(candidate.family)) return { type: "hold" as const, detail: "Family is not supported by the generated paper runner." };
  if (!isFocusedSweepCandidate(candidate)) return { type: "hold" as const, detail: "Outside the current focus families." };
  if (candidate.family === "sweep-managed-scalp") {
    return { type: "flag" as const, detail: "Managed scalp is watch-only until it proves positive live paper performance after prior weakness." };
  }
  if (!walkForwardValidated(candidate)) return { type: "hold" as const, detail: "Waiting for a positive walk-forward result on unseen frames." };
  if (activeGeneratedAlgos.some((algo) => algo.sourceAlgoId === candidate.algoId)) return { type: "hold" as const, detail: "Candidate is already active." };
  const builtInBaseline = activePaperBaselineForCandidate(candidate, activeGeneratedAlgos, learningReport, paperState);
  const hasActiveFamilyAlgo = activeGeneratedAlgos.some((algo) => algo.family === candidate.family);
  if (hasActiveFamilyAlgo || builtInBaseline.closed >= 8) {
    const liveProof = bestLiveProofForSource(candidate.algoId, activeGeneratedAlgos, archives, paperState);
    const activeFamily = bestActiveGeneratedFamilyStats(candidate.family, activeGeneratedAlgos, paperState) ?? builtInBaseline;
    if (!liveProof || liveProof.sells < 5 || liveProof.roi === null) {
      return { type: "hold" as const, detail: "Replacement waits for this candidate to have at least 5 closed live paper trades." };
    }
    const activeRoi = activeFamily.roi ?? -Infinity;
    if (liveProof.totalPnl <= activeFamily.totalPnl || liveProof.roi <= activeRoi + 0.02) {
      return { type: "hold" as const, detail: "Candidate live proof does not beat the active family algo yet." };
    }
  }
  return {
    type: "promote" as const,
    detail: builtInBaseline.closed < 8
      ? `${candidate.closed} replay closed and ${candidate.walkForwardClosed} walk-forward closed; starting live paper tracking while the active baseline is still under-sampled.`
      : `${candidate.closed} replay closed, ${candidate.walkForwardClosed} walk-forward closed, and live paper proof beats ${builtInBaseline.label}.`,
  };
}

function isFocusedSweepCandidate(candidate: LocalFactorySweepCandidate) {
  const name = candidate.algoName.toLowerCase();
  return candidate.family === "sweep-momentum"
    || candidate.family === "sweep-distance"
    || candidate.family === "sweep-target-revert"
    || candidate.family === "sweep-cheap-longshot"
    || name.includes("momentum")
    || name.includes("threshold")
    || name.includes("target revert")
    || name.includes("longshot");
}

function walkForwardValidated(candidate: LocalFactorySweepCandidate) {
  return candidate.walkForwardPass
    && candidate.walkForwardClosed >= 2
    && candidate.walkForwardTotalPnl > 0
    && candidate.walkForwardRoi > 0;
}

function bestLiveProofForSource(
  sourceAlgoId: string,
  activeGeneratedAlgos: GeneratedPaperAlgo[],
  archives: GeneratedPaperAlgoArchive[],
  paperState: PaperState,
) {
  const active = activeGeneratedAlgos
    .filter((algo) => algo.sourceAlgoId === sourceAlgoId)
    .map((algo) => paperSummarySnapshot(paperState, algo.id));
  const archived = archives
    .filter((archive) => archive.sourceAlgoId === sourceAlgoId)
    .map((archive) => archive.liveStats);
  return [...active, ...archived]
    .filter((stats) => stats.sells > 0)
    .sort((left, right) => (right.roi ?? -Infinity) - (left.roi ?? -Infinity) || right.totalPnl - left.totalPnl)[0] ?? null;
}

function bestActiveGeneratedFamilyStats(family: string, activeGeneratedAlgos: GeneratedPaperAlgo[], paperState: PaperState) {
  return activeGeneratedAlgos
    .filter((algo) => algo.family === family)
    .map((algo) => paperSummarySnapshot(paperState, algo.id))
    .filter((stats) => stats.sells > 0)
    .sort((left, right) => (right.roi ?? -Infinity) - (left.roi ?? -Infinity) || right.totalPnl - left.totalPnl)[0] ?? null;
}

function automationDecision(
  time: string,
  type: FactoryAutomationDecision["type"],
  tone: FactoryAutomationDecision["tone"],
  title: string,
  detail: string,
): FactoryAutomationDecision {
  return {
    id: `${type}:${title}:${time}`,
    time,
    type,
    title,
    detail,
    tone,
  };
}

function factoryAutomationPlanSignature(runId: string | null, plan: FactoryAutomationPlan) {
  return JSON.stringify({
    runId,
    demote: plan.demoteIds.slice().sort(),
    promotions: plan.promotions.map((candidate) => candidate.algoId).sort(),
    flags: plan.decisions.filter((decision) => decision.type === "flag").map((decision) => decision.title).sort(),
  });
}

function mergeAutomationDecisions(incoming: FactoryAutomationDecision[], existing: FactoryAutomationDecision[]) {
  const seen = new Set<string>();
  const rows: FactoryAutomationDecision[] = [];
  for (const decision of [...incoming, ...existing]) {
    const key = `${decision.type}:${decision.title}:${decision.detail}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push(decision);
  }
  return rows.slice(0, 40);
}

function latestFactoryBatchScheduleSlot(now: Date): FactoryBatchScheduleSlot {
  const slot = new Date(now);
  slot.setMinutes(0, 0, 0);
  if (slot.getHours() >= 20) {
    slot.setHours(20);
  } else if (slot.getHours() >= 8) {
    slot.setHours(8);
  } else {
    slot.setDate(slot.getDate() - 1);
    slot.setHours(20);
  }
  const hour = slot.getHours();
  const label = `${hour === 8 ? "8am" : "8pm"} ${slot.getMonth() + 1}/${slot.getDate()}`;
  return {
    id: `${slot.getFullYear()}-${pad2(slot.getMonth() + 1)}-${pad2(slot.getDate())}-${pad2(hour)}`,
    scheduledAt: slot.toISOString(),
    scheduledAtMs: slot.getTime(),
    hour,
    label,
  };
}

function latestFactoryBatchForScheduleSlot(batches: FactoryAlgoBatch[], slot: FactoryBatchScheduleSlot) {
  const nextSlotMs = slot.scheduledAtMs + 12 * 60 * 60_000;
  return batches
    .filter(isSingleLetterFactoryBatch)
    .filter((batch) => {
      const createdMs = Date.parse(batch.createdAt);
      return Number.isFinite(createdMs) && createdMs >= slot.scheduledAtMs && createdMs < nextSlotMs;
    })
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))[0] ?? null;
}

function richerFactoryAutomationState(current: FactoryAutomationState, backup: FactoryAutomationState): FactoryAutomationState {
  const backupScheduleMs = Date.parse(backup.lastScheduledBatchAt ?? "");
  const currentScheduleMs = Date.parse(current.lastScheduledBatchAt ?? "");
  const useBackupSchedule = Boolean(backup.lastScheduledBatchSlot)
    && (!current.lastScheduledBatchSlot
      || (Number.isFinite(backupScheduleMs) && (!Number.isFinite(currentScheduleMs) || backupScheduleMs > currentScheduleMs)));
  const next: FactoryAutomationState = {
    ...current,
    lastRunAt: latestIsoString(current.lastRunAt, backup.lastRunAt),
    lastScheduledBatchSlot: useBackupSchedule ? backup.lastScheduledBatchSlot : current.lastScheduledBatchSlot,
    lastScheduledBatchAt: useBackupSchedule ? backup.lastScheduledBatchAt : current.lastScheduledBatchAt,
    promotedCount: Math.max(current.promotedCount, backup.promotedCount),
    demotedCount: Math.max(current.demotedCount, backup.demotedCount),
    decisions: mergeAutomationDecisions(current.decisions, backup.decisions),
  };
  return factoryAutomationStatesEqual(current, next) ? current : next;
}

function latestIsoString(left: string | null, right: string | null) {
  const leftMs = Date.parse(left ?? "");
  const rightMs = Date.parse(right ?? "");
  if (!Number.isFinite(leftMs)) return Number.isFinite(rightMs) ? right : left;
  if (!Number.isFinite(rightMs)) return left;
  return rightMs > leftMs ? right : left;
}

function factoryAutomationStatesEqual(left: FactoryAutomationState, right: FactoryAutomationState) {
  return left.enabled === right.enabled
    && left.lastRunAt === right.lastRunAt
    && left.lastScheduledBatchSlot === right.lastScheduledBatchSlot
    && left.lastScheduledBatchAt === right.lastScheduledBatchAt
    && left.promotedCount === right.promotedCount
    && left.demotedCount === right.demotedCount
    && left.decisions.length === right.decisions.length
    && left.decisions.every((decision, index) => decision.id === right.decisions[index]?.id);
}

function pad2(value: number) {
  return String(value).padStart(2, "0");
}

function familyLabel(value: string) {
  if (value === "shadow" || value === "paper-variant") return "Legacy Generated";
  return value
    .replace(/^sweep-/, "")
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function factoryBatchSourceLabel(value: string) {
  const cleaned = value
    .replace(/clean single-entry champions/gi, "Arena champions")
    .replace(/clean single-entry Arena evidence/gi, "Arena evidence")
    .replace(/Clean generation reset/gi, "Generation reset")
    .replace(/;\s*quarantined \d+ legacy\/repeat-buy samples/gi, "")
    .replace(/quarantined \d+ legacy\/repeat-buy samples;?\s*/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  const evolved = /Evolved from (\d+) Arena champions across (\d+) tested generations and (\d+) mature failures; ignored (\d+) early positive spikes; includes (\d+) realistic probes with late-lock variants and (\d+) order-flow pressure variants/i.exec(cleaned);
  if (evolved) {
    return `Evolved: ${evolved[1]} champions / ${evolved[2]} gens / ${evolved[3]} failures / ${evolved[5]} probes / ${evolved[6]} order-flow`;
  }
  const reset = /Generation reset from default Arena algos; ignored (\d+) early positive spikes; includes (\d+) realistic probes with late-lock variants and (\d+) order-flow pressure variants/i.exec(cleaned);
  if (reset) {
    return `Reset: defaults / ${reset[2]} probes / ${reset[3]} order-flow`;
  }
  const aggressive = /Aggressive convergence generation from (\d+) Arena champions across (\d+) tested generations and (\d+) mature failures; ignored (\d+) early positive spikes; includes (\d+) late-lock, Kalshi-lag, and order-flow probes plus (\d+) strategic seed mutations/i.exec(cleaned);
  if (aggressive) {
    return `Aggressive: ${aggressive[1]} champions / ${aggressive[2]} gens / ${aggressive[5]} probes / ${aggressive[6]} seeds`;
  }
  const aggressiveReset = /Aggressive convergence reset from default Arena algos; ignored (\d+) early positive spikes; includes (\d+) late-lock, Kalshi-lag, and order-flow probes plus (\d+) strategic seed mutations/i.exec(cleaned);
  if (aggressiveReset) {
    return `Aggressive reset: ${aggressiveReset[2]} probes / ${aggressiveReset[3]} seeds`;
  }
  const dryRun = /Dry-run optimized generation from (\d+) winners, including (\d+) Top Traders dry-run winners, across (\d+) tested sources and (\d+) mature failures; trained on (\d+) executable dry-run samples; ignored (\d+) early positive spikes; includes (\d+) late-lock, Kalshi-lag, and order-flow probes plus (\d+) strategic seed mutations/i.exec(cleaned);
  if (dryRun) {
    return `Dry-run: ${dryRun[1]} winners / ${dryRun[2]} exec / ${dryRun[5]} samples / ${dryRun[7]} probes`;
  }
  const dryRunReset = /Dry-run optimized reset from default executable algos; trained on (\d+) executable dry-run samples; ignored (\d+) early positive spikes; includes (\d+) late-lock, Kalshi-lag, and order-flow probes plus (\d+) strategic seed mutations/i.exec(cleaned);
  if (dryRunReset) {
    return `Dry-run reset: ${dryRunReset[1]} samples / ${dryRunReset[3]} probes / ${dryRunReset[4]} seeds`;
  }
  return cleaned;
}

function generatedAlgoParamSummaryFromParams(paramsValue: Record<string, unknown>) {
  const params = Object.entries(paramsValue)
    .slice(0, 5)
    .map(([key, value]) => `${key}=${formatParamValue(value)}`);
  return params.length ? params.join(" / ") : "No parameters";
}

function formatParamValue(value: unknown) {
  if (typeof value === "number") {
    if (Math.abs(value) < 0.01 && value !== 0) return value.toFixed(5);
    return value.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
  }
  if (typeof value === "string") return value;
  if (typeof value === "boolean") return value ? "true" : "false";
  return "-";
}

function shortAlgoName(value: string) {
  return value
    .replace("Sweep ", "")
    .replace("Momentum M>=", "Mom >= ")
    .replace("Scalp S<=", "Scalp <= ")
    .replace("Fade ", "Fade ");
}

function generatedActivationId(sourceAlgoId: string, activatedAt: string) {
  return `generated:${sourceAlgoId}:${Date.parse(activatedAt)}` as const;
}

function generatedPaperAlgoFromCandidate(
  candidate: LocalFactorySweepCandidate,
  runId: string,
  promotedAt: string,
  displayId: string,
): GeneratedPaperAlgo {
  return {
    id: generatedActivationId(candidate.algoId, promotedAt),
    displayId,
    sourceAlgoId: candidate.algoId,
    name: candidate.algoName,
    family: candidate.family,
    params: candidate.params,
    enabled: true,
    promotedAt,
    sourceRunId: runId,
    sourceMetrics: {
      closed: candidate.closed,
      wins: candidate.wins,
      losses: candidate.losses,
      totalPnl: candidate.totalPnl,
      totalCost: candidate.totalCost,
      roi: candidate.roi,
      maxDrawdown: candidate.maxDrawdown,
    },
  };
}

function createFactoryAlgoBatch(existingBatches: FactoryAlgoBatch[], arenaArchives: GeneratedPaperAlgoArchive[], createdAt: string, batchIndex = existingBatches.length): FactoryAlgoBatch {
  const name = `Batch ${batchNameForIndex(batchIndex)}`;
  const id = `factory-batch-${name.toLowerCase().replace(/\s+/g, "-")}-${Date.parse(createdAt).toString(36)}`;
  const trainingArchives = arenaArchives
    .filter(factoryArchiveCanTrain)
    .filter((archive) => factoryFamilyCanGenerate(archive.family));
  const quarantinedSampleCount = arenaArchives.length - trainingArchives.length;
  const rng = seededRandom(`${id}:${trainingArchives.length}:${quarantinedSampleCount}`);
  const generation = Math.max(1, ...existingBatches.map((batch) => batch.generation + 1));
  const positiveArchives = trainingArchives
    .slice()
    .filter((archive) => archive.liveStats.sells > 0 && archive.liveStats.totalPnl > 0);
  const qualifiedWinners = trainingArchives
    .slice()
    .filter((archive) => factoryArchiveIsQualifiedWinner(archive, createdAt))
    .sort((left, right) => factoryArchiveFitness(right, createdAt) - factoryArchiveFitness(left, createdAt));
  const winners = selectFactoryChampionMemory(qualifiedWinners, createdAt);
  const failures = trainingArchives
    .slice()
    .filter((archive) => factoryArchiveHasUsableSample(archive, createdAt) && archive.liveStats.sells > 0 && (archive.liveStats.totalPnl < 0 || (archive.liveStats.roi ?? 0) < 0))
    .sort((left, right) => factoryArchiveFitness(left, createdAt) - factoryArchiveFitness(right, createdAt))
    .slice(0, 250);
  const dryRunTrainingCount = trainingArchives.filter(factoryArchiveIsTopTraderDryRun).length;
  const dryRunWinnerCount = winners.filter(factoryArchiveIsTopTraderDryRun).length;
  const strategicSeedArchives = defaultArenaAlgos
    .filter((algo) => factoryFamilyCanGenerate(algo.family))
    .filter((algo) => isHighConvictionFactoryFamily(algo.family))
    .map((algo) => archiveFromSeedAlgo(algo, createdAt));
  const fallbackSeedAlgos = defaultArenaAlgos.filter((algo) => factoryFamilyCanGenerate(algo.family));
  const winnerSeeds = winners.length > 0
    ? [...winners, ...strategicSeedArchives]
    : strategicSeedArchives.length > 0 ? strategicSeedArchives : fallbackSeedAlgos.map((algo) => archiveFromSeedAlgo(algo, createdAt));
  const parentBatchIds = uniqueStringList(winners.map((archive) => archive.sourceRunId).filter((item): item is string => item !== null));
  const algos: GeneratedPaperAlgo[] = [];
  let avoidedFailureZones = 0;

  const appendAlgo = (
    family: string,
    params: Record<string, unknown>,
    sourceMetrics: GeneratedPaperAlgo["sourceMetrics"],
    lineage: {
      kind: "elite" | "mutation" | "crossover" | "explore";
      parentArchives: GeneratedPaperAlgoArchive[];
      avoidanceApplied: boolean;
    },
  ) => {
    const realisticParams = constrainFactoryParamsForRealisticArena(family, params);
    const variantNumber = algos.length + 1;
    const sourceAlgoId = `${id}-${String(variantNumber).padStart(4, "0")}`;
    const displayId = `${batchNameForIndex(batchIndex)}-${String(variantNumber).padStart(4, "0")}`;
    algos.push({
      id: `generated:${sourceAlgoId}` as GeneratedPaperAlgo["id"],
      displayId,
      sourceAlgoId,
      name: factoryAlgoName(family, realisticParams),
      family,
      params: withFactoryLineage(realisticParams, {
        batchId: id,
        batchName: name,
        generation,
        kind: lineage.kind,
        parentIds: lineage.parentArchives.map((archive) => archive.sourceAlgoId),
        parentDisplayIds: lineage.parentArchives.map((archive) => archive.displayId),
        parentBatchIds: uniqueStringList(lineage.parentArchives.map((archive) => archive.sourceRunId).filter((item): item is string => item !== null)),
        avoidanceApplied: lineage.avoidanceApplied,
      }),
      enabled: true,
      promotedAt: createdAt,
      sourceRunId: id,
      sourceMetrics,
    });
  };

  const eliteCount = Math.min(50, winners.length);
  for (const archive of winners.slice(0, eliteCount)) {
    appendAlgo(archive.family, archive.params, sourceMetricsFromArchive(archive), {
      kind: "elite",
      parentArchives: [archive],
      avoidanceApplied: false,
    });
  }

  const targetProbeCount = Math.min(winners.length > 0 ? 430 : 760, Math.max(0, factoryBatchSize - algos.length));
  const probeLimit = Math.min(factoryBatchSize, algos.length + targetProbeCount);
  while (algos.length < probeLimit) {
    const probe = createRealisticFactoryProbeParams(rng, algos.length);
    const resolved = resolveFailureAvoidance(probe.family, probe.params, failures, rng, algos.length, 0.75);
    if (resolved.avoidanceApplied) avoidedFailureZones += 1;
    appendAlgo(probe.family, resolved.params, emptyArenaSourceMetrics(), {
      kind: "explore",
      parentArchives: [],
      avoidanceApplied: resolved.avoidanceApplied,
    });
  }

  const targetStrategicSeedCount = Math.min(winners.length > 0 ? 120 : 180, Math.max(0, factoryBatchSize - algos.length));
  const strategicSeedLimit = Math.min(factoryBatchSize, algos.length + targetStrategicSeedCount);
  while (strategicSeedArchives.length > 0 && algos.length < strategicSeedLimit) {
    const seed = strategicSeedArchives[algos.length % strategicSeedArchives.length];
    const resolved = resolveFailureAvoidance(seed.family, seed.params, failures, rng, algos.length, 1.35);
    if (resolved.avoidanceApplied) avoidedFailureZones += 1;
    appendAlgo(seed.family, resolved.params, sourceMetricsFromArchive(seed), {
      kind: "explore",
      parentArchives: [seed],
      avoidanceApplied: resolved.avoidanceApplied,
    });
  }

  const targetCrossoverCount = winners.length >= 2 ? 200 : 0;
  const targetMutationCount = winners.length > 0 ? 640 : 0;
  const crossoverLimit = Math.min(factoryBatchSize, algos.length + targetCrossoverCount);
  while (algos.length < crossoverLimit) {
    const parentA = pickWeightedArchive(winnerSeeds, rng);
    const parentB = pickCompatibleParent(parentA, winnerSeeds, rng);
    const crossed = crossoverFactoryParams(parentA.params, parentB.params, rng);
    const resolved = resolveFailureAvoidance(parentA.family, crossed, failures, rng, algos.length, 0.55);
    if (resolved.avoidanceApplied) avoidedFailureZones += 1;
    appendAlgo(parentA.family, resolved.params, mergedSourceMetrics(parentA, parentB), {
      kind: "crossover",
      parentArchives: [parentA, parentB],
      avoidanceApplied: resolved.avoidanceApplied,
    });
  }

  const mutationLimit = Math.min(factoryBatchSize, algos.length + targetMutationCount);
  while (algos.length < mutationLimit) {
    const parent = pickWeightedArchive(winnerSeeds, rng);
    const resolved = resolveFailureAvoidance(parent.family, parent.params, failures, rng, algos.length, 1);
    if (resolved.avoidanceApplied) avoidedFailureZones += 1;
    appendAlgo(parent.family, resolved.params, sourceMetricsFromArchive(parent), {
      kind: "mutation",
      parentArchives: [parent],
      avoidanceApplied: resolved.avoidanceApplied,
    });
  }

  while (algos.length < factoryBatchSize) {
    const seedAlgo = fallbackSeedAlgos[algos.length % Math.max(1, fallbackSeedAlgos.length)] ?? defaultArenaAlgos[0];
    const seed = archiveFromSeedAlgo(seedAlgo, createdAt);
    const resolved = resolveFailureAvoidance(seed.family, seed.params, failures, rng, algos.length, 1.4);
    if (resolved.avoidanceApplied) avoidedFailureZones += 1;
    appendAlgo(seed.family, resolved.params, sourceMetricsFromArchive(seed), {
      kind: "explore",
      parentArchives: [seed],
      avoidanceApplied: resolved.avoidanceApplied,
    });
  }

  const summary: FactoryEvolutionSummary = {
    generation,
    eliteCount,
    mutationCount: algos.filter((algo) => lineageKind(algo.params) === "mutation").length,
    crossoverCount: algos.filter((algo) => lineageKind(algo.params) === "crossover").length,
    explorationCount: algos.filter((algo) => lineageKind(algo.params) === "explore").length,
    avoidedFailureZones,
    trainingSampleCount: trainingArchives.length,
    quarantinedSampleCount,
    winnerCount: winners.length,
    failureCount: failures.length,
    parentBatchIds,
  };
  const skippedEarlyWinners = Math.max(0, positiveArchives.length - winners.length);
  const championSourceCount = uniqueStringList(winners.map((archive) => archive.sourceRunId ?? archive.sourceAlgoId)).length;
  const source = winners.length > 0
    ? `Dry-run optimized generation from ${winners.length} winners, including ${dryRunWinnerCount} Top Traders dry-run winners, across ${championSourceCount} tested sources and ${failures.length} mature failures; trained on ${dryRunTrainingCount} executable dry-run samples; ignored ${skippedEarlyWinners} early positive spikes; includes ${targetProbeCount} late-lock, Kalshi-lag, and order-flow probes plus ${targetStrategicSeedCount} strategic seed mutations`
    : `Dry-run optimized reset from default executable algos; trained on ${dryRunTrainingCount} executable dry-run samples; ignored ${skippedEarlyWinners} early positive spikes; includes ${targetProbeCount} late-lock, Kalshi-lag, and order-flow probes plus ${targetStrategicSeedCount} strategic seed mutations`;
  return { id, name, createdAt, source, generation, parentBatchIds, summary, algos };
}

function topTraderExecutableArchivesForFactory(
  state: TopTraderExecutableState,
  candidateAlgos: GeneratedPaperAlgo[],
  asOf: string,
): GeneratedPaperAlgoArchive[] {
  const algoBySource = new Map(candidateAlgos.map((algo) => [algo.sourceAlgoId, algo]));
  return Object.values(state.stats)
    .map((stats) => {
      const algo = algoBySource.get(stats.sourceAlgoId);
      if (!algo || !factoryFamilyCanGenerate(algo.family)) return null;
      const liveStats = topTraderExecutableSummary(stats);
      const hasActivity = stats.attempts > 0 || stats.acceptedBuys > 0 || liveStats.buys > 0 || liveStats.sells > 0 || liveStats.open > 0;
      if (!hasActivity) return null;
      const activatedAt = stats.startedAt ?? state.startedAt ?? algo.promotedAt;
      const deactivatedAt = state.stoppedAt ?? stats.lastAttemptAt ?? stats.lastAcceptedAt ?? stats.lastSignalAt ?? asOf;
      const archive: GeneratedPaperAlgoArchive = {
        activationId: `top-traders-dry-run:${stats.sourceAlgoId}:${activatedAt}`,
        displayId: algo.displayId,
        sourceAlgoId: algo.sourceAlgoId,
        name: algo.name,
        family: algo.family,
        params: algo.params,
        sourceRunId: algo.sourceRunId,
        activatedAt,
        deactivatedAt,
        arenaEntryPolicy: "top-traders-dry-run" as const,
        sourceMetrics: {
          closed: liveStats.sells,
          wins: liveStats.wins,
          losses: liveStats.losses,
          totalPnl: liveStats.totalPnl,
          totalCost: liveStats.totalCost,
          roi: liveStats.roi ?? 0,
          maxDrawdown: algo.sourceMetrics.maxDrawdown,
        },
        liveStats,
      };
      return archive;
    })
    .filter((archive): archive is GeneratedPaperAlgoArchive => archive !== null);
}

function selectFactoryChampionMemory(qualifiedWinners: GeneratedPaperAlgoArchive[], asOf: string) {
  const bySource = new Map<string, GeneratedPaperAlgoArchive[]>();
  for (const archive of qualifiedWinners) {
    const source = archive.sourceRunId ?? archive.sourceAlgoId;
    bySource.set(source, [...(bySource.get(source) ?? []), archive]);
  }
  const groups = [...bySource.values()]
    .map((group) => group.sort((left, right) => factoryArchiveFitness(right, asOf) - factoryArchiveFitness(left, asOf)))
    .sort((left, right) => factoryArchiveFitness(right[0], asOf) - factoryArchiveFitness(left[0], asOf));

  const interleavedChampions: GeneratedPaperAlgoArchive[] = [];
  const perGenerationChampionLimit = 25;
  for (let rank = 0; rank < perGenerationChampionLimit; rank += 1) {
    for (const group of groups) {
      const archive = group[rank];
      if (archive) interleavedChampions.push(archive);
    }
  }

  const seen = new Set<string>();
  const remembered: GeneratedPaperAlgoArchive[] = [];
  for (const archive of [
    ...interleavedChampions,
    ...qualifiedWinners,
  ]) {
    if (seen.has(archive.activationId)) continue;
    seen.add(archive.activationId);
    remembered.push(archive);
  }
  return remembered.slice(0, 600);
}

function isHighConvictionFactoryFamily(family: string) {
  return [
    "sweep-late-lock",
    "sweep-kalshi-lag-lock",
    "sweep-order-flow-pressure",
    "sweep-liquidity-imbalance",
    "sweep-momentum-trail",
  ].includes(family);
}

function factoryFamilyCanGenerate(family: string) {
  return family !== "sweep-cheap-longshot";
}

function factoryArchiveIsQualifiedWinner(archive: GeneratedPaperAlgoArchive, asOf: string) {
  return factoryArchiveCanTrain(archive)
    && archive.liveStats.sells > 0
    && archive.liveStats.totalPnl > 0
    && activatedConfidence(archive, asOf).liveEligible;
}

function factoryArchiveCanTrain(archive: { arenaEntryPolicy: ArenaEntryPolicy }) {
  return archive.arenaEntryPolicy === "single-entry" || archive.arenaEntryPolicy === "top-traders-dry-run";
}

function factoryArchiveIsTopTraderDryRun(archive: { arenaEntryPolicy: ArenaEntryPolicy }) {
  return archive.arenaEntryPolicy === "top-traders-dry-run";
}

function factoryArchiveHasUsableSample(archive: GeneratedPaperAlgoArchive, asOf: string) {
  void asOf;
  return archive.liveStats.sells >= 15;
}

function factoryArchiveFitness(archive: GeneratedPaperAlgoArchive, asOf?: string) {
  const closed = archive.liveStats.sells;
  const roi = archive.liveStats.roi ?? 0;
  const winRate = closed > 0 ? archive.liveStats.wins / Math.max(1, archive.liveStats.wins + archive.liveStats.losses) : 0;
  const costEfficiency = archive.liveStats.totalCost > 0 ? archive.liveStats.totalPnl / archive.liveStats.totalCost : 0;
  const cycles = activatedCycleCount(archive.activatedAt, archive.deactivatedAt ?? asOf ?? archive.activatedAt);
  const pnlPerCycle = archive.liveStats.totalPnl / Math.max(1, cycles);
  const sampleScore = Math.min(80, closed) / 80;
  const score = pnlPerCycle * 180
    + archive.liveStats.totalPnl * 12
    + roi * 30
    + costEfficiency * 20
    + winRate * 10
    + sampleScore * 14;
  return score * strategicFamilyFitnessMultiplier(archive.family);
}

function strategicFamilyFitnessMultiplier(family: string) {
  if (family === "sweep-kalshi-lag-lock") return 1.26;
  if (family === "sweep-late-lock") return 1.22;
  if (family === "sweep-order-flow-pressure") return 1.14;
  if (family === "sweep-liquidity-imbalance") return 1.08;
  if (family === "sweep-momentum-trail") return 1.06;
  if (family === "sweep-managed-scalp") return 0.86;
  return 1;
}

function archiveFromSeedAlgo(algo: GeneratedPaperAlgo, timestamp: string): GeneratedPaperAlgoArchive {
  return {
    activationId: `${algo.id}:${timestamp}`,
    displayId: algo.displayId,
    sourceAlgoId: algo.sourceAlgoId,
    name: algo.name,
    family: algo.family,
    params: algo.params,
    sourceRunId: algo.sourceRunId,
    activatedAt: timestamp,
    deactivatedAt: timestamp,
    arenaEntryPolicy: "legacy",
    sourceMetrics: algo.sourceMetrics,
    liveStats: {
      buys: 0,
      sells: 0,
      open: 0,
      wins: 0,
      losses: 0,
      totalPnl: 0,
      totalCost: 0,
      roi: 0,
    },
  };
}

function sourceMetricsFromArchive(archive: GeneratedPaperAlgoArchive): GeneratedPaperAlgo["sourceMetrics"] {
  return {
    closed: archive.liveStats.sells,
    wins: archive.liveStats.wins,
    losses: archive.liveStats.losses,
    totalPnl: archive.liveStats.totalPnl,
    totalCost: archive.liveStats.totalCost,
    roi: archive.liveStats.roi ?? 0,
    maxDrawdown: archive.sourceMetrics.maxDrawdown,
  };
}

function mergedSourceMetrics(left: GeneratedPaperAlgoArchive, right: GeneratedPaperAlgoArchive): GeneratedPaperAlgo["sourceMetrics"] {
  const better = factoryArchiveFitness(left) >= factoryArchiveFitness(right) ? left : right;
  return sourceMetricsFromArchive(better);
}

function pickWeightedArchive(archives: GeneratedPaperAlgoArchive[], rng: () => number) {
  const limited = archives.slice(0, Math.min(120, archives.length));
  return limited[Math.min(limited.length - 1, Math.floor((rng() ** 2) * limited.length))] ?? archives[0];
}

function pickCompatibleParent(parent: GeneratedPaperAlgoArchive, archives: GeneratedPaperAlgoArchive[], rng: () => number) {
  const compatible = archives.filter((archive) => archive.family === parent.family && archive.sourceAlgoId !== parent.sourceAlgoId);
  if (compatible.length > 0) return pickWeightedArchive(compatible, rng);
  return pickWeightedArchive(archives.filter((archive) => archive.sourceAlgoId !== parent.sourceAlgoId), rng) ?? parent;
}

function crossoverFactoryParams(left: Record<string, unknown>, right: Record<string, unknown>, rng: () => number) {
  const params: Record<string, unknown> = {};
  const keys = new Set([...Object.keys(left), ...Object.keys(right)].filter((key) => key !== "factoryLineage"));
  for (const key of keys) {
    const leftValue = left[key];
    const rightValue = right[key];
    if (typeof leftValue === "number" && typeof rightValue === "number" && Number.isFinite(leftValue) && Number.isFinite(rightValue)) {
      params[key] = rng() < 0.45 ? roundFactoryParamValue(key, (leftValue + rightValue) / 2) : rng() < 0.5 ? leftValue : rightValue;
    } else {
      params[key] = rng() < 0.5 ? leftValue ?? rightValue : rightValue ?? leftValue;
    }
  }
  return params;
}

function resolveFailureAvoidance(
  family: string,
  baseParams: Record<string, unknown>,
  failures: GeneratedPaperAlgoArchive[],
  rng: () => number,
  index: number,
  intensity: number,
) {
  let avoidanceApplied = false;
  for (let attempt = 0; attempt < 7; attempt += 1) {
    const params = mutateFactoryParams(family, baseParams, rng, index + attempt * factoryBatchSize, intensity);
    if (!isNearFailureZone(family, params, failures)) {
      return { params, avoidanceApplied };
    }
    avoidanceApplied = true;
  }
  return {
    params: nudgeAwayFromFailureZones(family, mutateFactoryParams(family, baseParams, rng, index + 9 * factoryBatchSize, intensity), failures, rng),
    avoidanceApplied: true,
  };
}

function isNearFailureZone(family: string, params: Record<string, unknown>, failures: GeneratedPaperAlgoArchive[]) {
  return failures
    .filter((failure) => failure.family === family)
    .slice(0, 80)
    .some((failure) => factoryParamDistance(params, failure.params) < 0.13);
}

function factoryParamDistance(left: Record<string, unknown>, right: Record<string, unknown>) {
  const keys = new Set([...Object.keys(left), ...Object.keys(right)].filter((key) => key !== "factoryLineage"));
  let count = 0;
  let total = 0;
  for (const key of keys) {
    const leftValue = left[key];
    const rightValue = right[key];
    if (typeof leftValue !== "number" || typeof rightValue !== "number" || !Number.isFinite(leftValue) || !Number.isFinite(rightValue)) continue;
    const bounds = factoryParamBounds(key, Math.max(leftValue, rightValue, 1));
    const range = Math.max(0.000001, bounds.max - bounds.min);
    total += Math.min(1, Math.abs(leftValue - rightValue) / range);
    count += 1;
  }
  return count === 0 ? Number.POSITIVE_INFINITY : total / count;
}

function nudgeAwayFromFailureZones(family: string, params: Record<string, unknown>, failures: GeneratedPaperAlgoArchive[], rng: () => number) {
  const nearest = failures
    .filter((failure) => failure.family === family)
    .map((failure) => ({ failure, distance: factoryParamDistance(params, failure.params) }))
    .sort((left, right) => left.distance - right.distance)[0]?.failure ?? null;
  if (!nearest) return params;
  const next = { ...params };
  for (const key of Object.keys(next)) {
    const value = next[key];
    const failedValue = nearest.params[key];
    if (typeof value !== "number" || typeof failedValue !== "number" || !Number.isFinite(value) || !Number.isFinite(failedValue)) continue;
    const bounds = factoryParamBounds(key, value);
    const direction = value >= failedValue ? 1 : -1;
    const magnitude = (bounds.max - bounds.min) * (0.1 + rng() * 0.18);
    next[key] = roundFactoryParamValue(key, clamp(value + direction * magnitude, bounds.min, bounds.max));
  }
  return next;
}

function withFactoryLineage(
  params: Record<string, unknown>,
  lineage: {
    batchId: string;
    batchName: string;
    generation: number;
    kind: "elite" | "mutation" | "crossover" | "explore";
    parentIds: string[];
    parentDisplayIds: string[];
    parentBatchIds: string[];
    avoidanceApplied: boolean;
  },
) {
  return {
    ...params,
    factoryLineage: lineage,
  };
}

function lineageKind(params: Record<string, unknown>) {
  const lineage = isRecord(params.factoryLineage) ? params.factoryLineage : {};
  const kind = stringOrNull(lineage.kind);
  return kind === "elite" || kind === "mutation" || kind === "crossover" || kind === "explore" ? kind : null;
}

function batchNameForIndex(index: number) {
  let value = index;
  let label = "";
  do {
    label = String.fromCharCode(65 + (value % 26)) + label;
    value = Math.floor(value / 26) - 1;
  } while (value >= 0);
  return label;
}

function nextFactoryBatchIndex(existingBatches: FactoryAlgoBatch[], arenaArchives: GeneratedPaperAlgoArchive[], arena: PaperArenaState) {
  const indexes = [
    ...existingBatches.flatMap((batch) => factoryBatchIndexesFromText(`${batch.id} ${batch.name}`)),
    ...arenaArchives.flatMap((archive) => factoryBatchIndexesFromText([
      archive.displayId,
      archive.sourceAlgoId,
      archive.sourceRunId ?? "",
      archive.activationId,
    ].join(" "))),
    ...factoryBatchIndexesFromText([
      arena.activeBatchId ?? "",
      ...arena.activeBatchIds,
      arena.selectedAlgoId ?? "",
      ...arena.selectedAlgoIds,
      ...arena.paperState.trades.map((trade) => trade.strategyId),
      ...arena.paperState.events.map((event) => event.strategyId),
    ].join(" ")),
  ];
  const nextFromHistory = indexes.length > 0 ? Math.max(...indexes) + 1 : 0;
  return Math.max(existingBatches.length, nextFromHistory);
}

function factoryBatchIndexesFromText(text: string) {
  const indexes: number[] = [];
  for (const match of text.matchAll(/\bBatch\s+([A-Z]+)\b/g)) {
    indexes.push(batchIndexFromName(match[1]));
  }
  for (const match of text.matchAll(/\bfactory-batch-batch-([a-z]+)-/gi)) {
    indexes.push(batchIndexFromName(match[1].toUpperCase()));
  }
  for (const match of text.matchAll(/\b([A-Z]+)-\d{4}\b/g)) {
    indexes.push(batchIndexFromName(match[1]));
  }
  return indexes.filter((index) => Number.isFinite(index) && index >= 0);
}

function batchIndexFromName(name: string) {
  return name
    .toUpperCase()
    .split("")
    .reduce((total, char) => total * 26 + (char.charCodeAt(0) - 64), 0) - 1;
}

function seededRandom(seed: string) {
  let state = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    state ^= seed.charCodeAt(index);
    state = Math.imul(state, 16777619);
  }
  return () => {
    state += 0x6D2B79F5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function createRealisticFactoryProbeParams(rng: () => number, index: number): { family: string; params: Record<string, unknown> } {
  const pick = <T,>(values: T[]) => values[Math.min(values.length - 1, Math.floor(rng() * values.length))];
  const cents = (min: number, max: number) => roundDisplayRatio(randomBetween(rng, min, max));
  const seconds = (min: number, max: number) => Math.round(randomBetween(rng, min, max));
  const variantIndex = index + 1;
  const roll = rng();

  if (roll < 0.34) {
    return {
      family: "sweep-late-lock",
      params: {
        maxSecondsToClose: seconds(20, 75),
        minSecondsToClose: seconds(8, 18),
        minDistance: roundDisplayRatio(randomBetween(rng, 0.00006, 0.00034)),
        minRequiredGap: roundDisplayRatio(randomBetween(rng, 0.00005, 0.00028)),
        minCompletedSeconds: seconds(4, 24),
        minSettlementConfidence: seconds(62, 90),
        requireConvergence: rng() > 0.18,
        volatilityMultiple: roundDisplayRatio(randomBetween(rng, 1.0, 2.6)),
        minFairProbability: roundDisplayRatio(randomBetween(rng, 0.82, 0.98)),
        maxAsk: cents(0.68, 0.96),
        maxSpread: cents(0.005, 0.02),
        minEdge: cents(0.06, 0.16),
        minConfidence: seconds(76, 94),
        minBidDepth: Math.round(randomBetween(rng, 1, 8)),
        minAskDepth: Math.round(randomBetween(rng, 1, 5)),
        feeBuffer: cents(0.006, 0.016),
        variantIndex,
      },
    };
  }

  if (roll < 0.62) {
    return {
      family: "sweep-kalshi-lag-lock",
      params: {
        maxSecondsToClose: seconds(25, 140),
        minSecondsToClose: seconds(8, 24),
        minMovePercent: roundDisplayRatio(randomBetween(rng, 0.00003, 0.00032)),
        minRequiredGap: roundDisplayRatio(randomBetween(rng, 0.00004, 0.00024)),
        minSettlementConfidence: seconds(58, 88),
        minFairProbability: roundDisplayRatio(randomBetween(rng, 0.78, 0.96)),
        maxAsk: cents(0.55, 0.94),
        maxSpread: cents(0.005, 0.02),
        minEdge: cents(0.06, 0.16),
        feeBuffer: cents(0.006, 0.018),
        maxCatchupDelta: cents(0, 0.025),
        minConfidence: seconds(70, 90),
        minBidDepth: Math.round(randomBetween(rng, 1, 8)),
        minAskDepth: Math.round(randomBetween(rng, 1, 5)),
        requireFinalWindow: rng() > 0.45,
        takeProfit: cents(0.018, 0.065),
        stopLoss: cents(0.014, 0.06),
        trailingStop: cents(0.006, 0.026),
        trailAfterProfit: cents(0.008, 0.04),
        minHoldSeconds: seconds(0, 8),
        maxHoldSeconds: seconds(20, 150),
        exitBeforeClose: seconds(6, 35),
        exitOnMomentumFlip: rng() > 0.05,
        momentumExitMovePercent: roundDisplayRatio(randomBetween(rng, 0.00003, 0.00014)),
        variantIndex,
      },
    };
  }

  if (roll < 0.84) {
    return {
      family: "sweep-order-flow-pressure",
      params: {
        minPressure: roundDisplayRatio(randomBetween(rng, 0.12, 0.42)),
        maxSpread: cents(0.005, 0.02),
        minEdge: cents(0.06, 0.16),
        feeBuffer: cents(0.006, 0.018),
        minBidDepth: Math.round(randomBetween(rng, 1, 10)),
        minAskDepth: Math.round(randomBetween(rng, 1, 6)),
        minSecondsToClose: seconds(10, 120),
        minMovePercent: roundDisplayRatio(randomBetween(rng, 0, 0.00018)),
        sideMode: pick(["hybrid", "pressure", "edge", "yes-only", "no-only"]),
        yesMode: pick(["loose", "strict"]),
        requireMomentumConfirm: rng() > 0.62,
        takeProfit: cents(0.012, 0.075),
        stopLoss: cents(0.012, 0.07),
        trailingStop: cents(0.006, 0.035),
        trailAfterProfit: cents(0.008, 0.055),
        minHoldSeconds: seconds(0, 10),
        maxHoldSeconds: seconds(25, 240),
        exitBeforeClose: seconds(8, 55),
        exitOnMomentumFlip: rng() > 0.12,
        momentumExitMovePercent: roundDisplayRatio(randomBetween(rng, 0.00003, 0.00016)),
        variantIndex,
      },
    };
  }

  if (roll < 0.9) {
    return {
      family: "sweep-liquidity-imbalance",
      params: {
        maxSpread: cents(0.005, 0.02),
        minBidDepth: Math.round(randomBetween(rng, 1, 10)),
        minImbalance: roundDisplayRatio(randomBetween(rng, 0.08, 0.44)),
        minEdge: cents(0.06, 0.15),
        yesMode: pick(["loose", "strict"]),
        variantIndex,
      },
    };
  }

  if (roll < 0.98) {
    return {
      family: "sweep-momentum-trail",
      params: {
        minMovePercent: roundDisplayRatio(randomBetween(rng, 0.00004, 0.00045)),
        maxSpread: cents(0.005, 0.02),
        feeBuffer: cents(0.006, 0.018),
        boostMultiplier: seconds(110, 220),
        minEdge: cents(0.08, 0.16),
        minSecondsToClose: seconds(20, 180),
        takeProfit: cents(0.012, 0.09),
        stopLoss: cents(0.012, 0.08),
        trailingStop: cents(0.006, 0.04),
        trailAfterProfit: cents(0.008, 0.065),
        minHoldSeconds: seconds(0, 12),
        maxHoldSeconds: seconds(25, 300),
        exitBeforeClose: seconds(8, 70),
        exitOnMomentumFlip: rng() > 0.08,
        momentumExitMovePercent: roundDisplayRatio(randomBetween(rng, 0.00003, 0.00018)),
        yesMode: pick(["loose", "strict"]),
        variantIndex,
      },
    };
  }

  return {
    family: "sweep-kalshi-lag-lock",
    params: {
      maxSecondsToClose: seconds(20, 90),
      minSecondsToClose: seconds(8, 18),
      minMovePercent: roundDisplayRatio(randomBetween(rng, 0.00002, 0.00018)),
      minRequiredGap: roundDisplayRatio(randomBetween(rng, 0.00003, 0.00018)),
      minSettlementConfidence: seconds(55, 82),
      minFairProbability: roundDisplayRatio(randomBetween(rng, 0.76, 0.92)),
      maxAsk: cents(0.45, 0.9),
      maxSpread: cents(0.005, 0.02),
      minEdge: cents(0.06, 0.14),
      feeBuffer: cents(0.006, 0.016),
      maxCatchupDelta: cents(0, 0.02),
      minConfidence: seconds(68, 88),
      minBidDepth: Math.round(randomBetween(rng, 1, 8)),
      minAskDepth: Math.round(randomBetween(rng, 1, 5)),
      requireFinalWindow: rng() > 0.35,
      takeProfit: cents(0.012, 0.05),
      stopLoss: cents(0.012, 0.05),
      trailingStop: cents(0.006, 0.02),
      trailAfterProfit: cents(0.008, 0.035),
      minHoldSeconds: seconds(0, 6),
      maxHoldSeconds: seconds(18, 120),
      exitBeforeClose: seconds(6, 28),
      exitOnMomentumFlip: true,
      momentumExitMovePercent: roundDisplayRatio(randomBetween(rng, 0.00002, 0.00012)),
      variantIndex,
    },
  };
}

function constrainFactoryParamsForRealisticArena(family: string, params: Record<string, unknown>) {
  const next = { ...params };
  const spread = numberOrNull(next.maxSpread);
  if (spread !== null) next.maxSpread = roundDisplayRatio(clamp(spread, 0.005, 0.02));
  const edge = numberOrNull(next.minEdge);
  if (edge !== null) next.minEdge = roundDisplayRatio(clamp(edge, 0.08, 0.18));

  if (family.includes("order-flow") || family.includes("pressure")) {
    next.minPressure = roundDisplayRatio(clamp(numberOrDefault(next.minPressure, 0.18), 0.06, 0.42));
    next.minBidDepth = Math.round(clamp(numberOrDefault(next.minBidDepth, 2), 1, 10));
    next.minAskDepth = Math.round(clamp(numberOrDefault(next.minAskDepth, 1), 1, 6));
  }

  if (family.includes("liquidity")) {
    next.minBidDepth = Math.round(clamp(numberOrDefault(next.minBidDepth, 1), 1, 10));
    next.minImbalance = roundDisplayRatio(clamp(numberOrDefault(next.minImbalance, 0.18), 0.02, 0.48));
  }

  if (family.includes("cheap") || family.includes("longshot")) {
    next.maxAsk = roundDisplayRatio(clamp(numberOrDefault(next.maxAsk, 0.18), 0.01, 0.32));
  }

  if (family.includes("late-lock")) {
    next.maxSecondsToClose = Math.round(clamp(numberOrDefault(next.maxSecondsToClose, 60), 20, 100));
    next.minSecondsToClose = Math.round(clamp(numberOrDefault(next.minSecondsToClose, 10), 8, 24));
    next.minDistance = roundDisplayRatio(clamp(numberOrDefault(next.minDistance, 0.00018), 0.00006, 0.00045));
    next.minRequiredGap = roundDisplayRatio(clamp(numberOrDefault(next.minRequiredGap, 0.00012), 0.00003, 0.00032));
    next.minCompletedSeconds = Math.round(clamp(numberOrDefault(next.minCompletedSeconds, 8), 0, 35));
    next.minSettlementConfidence = Math.round(clamp(numberOrDefault(next.minSettlementConfidence, 74), 45, 95));
    next.volatilityMultiple = roundDisplayRatio(clamp(numberOrDefault(next.volatilityMultiple, 1.4), 0.9, 3));
    next.minFairProbability = roundDisplayRatio(clamp(numberOrDefault(next.minFairProbability, 0.9), 0.78, 0.98));
    next.maxAsk = roundDisplayRatio(clamp(numberOrDefault(next.maxAsk, 0.88), 0.55, 0.95));
    next.minConfidence = Math.round(clamp(numberOrDefault(next.minConfidence, 84), 70, 98));
    next.minBidDepth = Math.round(clamp(numberOrDefault(next.minBidDepth, 1), 1, 12));
    next.minAskDepth = Math.round(clamp(numberOrDefault(next.minAskDepth, 1), 1, 8));
  }

  if (family.includes("kalshi-lag") || family.includes("lag-lock")) {
    next.maxSecondsToClose = Math.round(clamp(numberOrDefault(next.maxSecondsToClose, 90), 20, 160));
    next.minSecondsToClose = Math.round(clamp(numberOrDefault(next.minSecondsToClose, 10), 8, 35));
    next.minMovePercent = roundDisplayRatio(clamp(numberOrDefault(next.minMovePercent, 0.00008), 0.00002, 0.00045));
    next.minRequiredGap = roundDisplayRatio(clamp(numberOrDefault(next.minRequiredGap, 0.0001), 0.00003, 0.0003));
    next.minSettlementConfidence = Math.round(clamp(numberOrDefault(next.minSettlementConfidence, 68), 45, 95));
    next.minFairProbability = roundDisplayRatio(clamp(numberOrDefault(next.minFairProbability, 0.84), 0.68, 0.98));
    next.maxAsk = roundDisplayRatio(clamp(numberOrDefault(next.maxAsk, 0.88), 0.35, 0.96));
    next.maxCatchupDelta = roundDisplayRatio(clamp(numberOrDefault(next.maxCatchupDelta, 0.015), 0, 0.04));
    next.minConfidence = Math.round(clamp(numberOrDefault(next.minConfidence, 78), 55, 96));
    next.minBidDepth = Math.round(clamp(numberOrDefault(next.minBidDepth, 1), 1, 12));
    next.minAskDepth = Math.round(clamp(numberOrDefault(next.minAskDepth, 1), 1, 8));
    next.takeProfit = roundDisplayRatio(clamp(numberOrDefault(next.takeProfit, 0.035), 0.01, 0.09));
    next.stopLoss = roundDisplayRatio(clamp(numberOrDefault(next.stopLoss, 0.035), 0.01, 0.08));
    next.trailingStop = roundDisplayRatio(clamp(numberOrDefault(next.trailingStop, 0.012), 0.005, 0.04));
    next.trailAfterProfit = roundDisplayRatio(clamp(numberOrDefault(next.trailAfterProfit, 0.018), 0.006, 0.06));
    next.minHoldSeconds = Math.round(clamp(numberOrDefault(next.minHoldSeconds, 0), 0, 12));
    next.maxHoldSeconds = Math.round(clamp(numberOrDefault(next.maxHoldSeconds, 90), 15, 180));
    next.exitBeforeClose = Math.round(clamp(numberOrDefault(next.exitBeforeClose, 8), 5, 45));
  }

  return next;
}

function randomBetween(rng: () => number, min: number, max: number) {
  return min + rng() * (max - min);
}

function mutateFactoryParams(family: string, baseParams: Record<string, unknown>, rng: () => number, index: number, intensity = 1) {
  const params = { ...baseParams };
  const jitter = (key: string, fallback: number, min: number, max: number, spread = 0.35) => {
    const base = numberOrDefault(params[key], fallback);
    params[key] = roundFactoryParamValue(key, clamp(base * (1 + (rng() - 0.5) * spread * intensity * 2), min, max));
  };
  const choose = <T,>(values: T[]) => values[Math.min(values.length - 1, Math.floor(rng() * values.length))];

  if (family.includes("late-lock")) {
    jitter("maxSecondsToClose", 60, 25, 100, 0.55);
    jitter("minSecondsToClose", 10, 8, 22, 0.45);
    jitter("minDistance", 0.00018, 0.00006, 0.0004, 1.1);
    jitter("minRequiredGap", 0.00012, 0.00003, 0.00032, 1.1);
    jitter("minCompletedSeconds", 8, 0, 35, 0.8);
    jitter("minSettlementConfidence", 74, 45, 95, 0.35);
    jitter("volatilityMultiple", 1.4, 0.9, 2.8, 0.75);
    jitter("minFairProbability", 0.9, 0.78, 0.98, 0.28);
    jitter("maxAsk", 0.88, 0.55, 0.95, 0.45);
    jitter("maxSpread", 0.02, 0.005, 0.04, 0.45);
    jitter("minEdge", 0.08, 0.04, 0.18, 0.5);
    jitter("feeBuffer", 0.01, 0.004, 0.02, 0.45);
    jitter("minConfidence", 84, 70, 98, 0.25);
    params.minBidDepth = Math.round(clamp(numberOrDefault(params.minBidDepth, 1) + (rng() - 0.5) * 6 * intensity, 1, 12));
    params.minAskDepth = Math.round(clamp(numberOrDefault(params.minAskDepth, 1) + (rng() - 0.5) * 4 * intensity, 1, 8));
    params.requireConvergence = rng() > 0.22;
  } else if (family.includes("kalshi-lag") || family.includes("lag-lock")) {
    jitter("maxSecondsToClose", 90, 20, 160, 0.7);
    jitter("minSecondsToClose", 10, 8, 35, 0.55);
    jitter("minMovePercent", 0.00008, 0.00002, 0.00045, 1.2);
    jitter("minRequiredGap", 0.0001, 0.00003, 0.0003, 1.15);
    jitter("minSettlementConfidence", 68, 45, 95, 0.45);
    jitter("minFairProbability", 0.84, 0.68, 0.98, 0.35);
    jitter("maxAsk", 0.88, 0.35, 0.96, 0.45);
    jitter("maxSpread", 0.018, 0.005, 0.04, 0.55);
    jitter("minEdge", 0.08, 0.04, 0.18, 0.65);
    jitter("feeBuffer", 0.012, 0.004, 0.025, 0.55);
    jitter("maxCatchupDelta", 0.015, 0, 0.04, 1.2);
    jitter("minConfidence", 78, 55, 96, 0.3);
    jitter("takeProfit", 0.035, 0.01, 0.09, 0.8);
    jitter("stopLoss", 0.035, 0.01, 0.08, 0.8);
    jitter("trailingStop", 0.012, 0.005, 0.04, 0.9);
    jitter("trailAfterProfit", 0.018, 0.006, 0.06, 0.9);
    params.minBidDepth = Math.round(clamp(numberOrDefault(params.minBidDepth, 1) + (rng() - 0.5) * 7 * intensity, 1, 12));
    params.minAskDepth = Math.round(clamp(numberOrDefault(params.minAskDepth, 1) + (rng() - 0.5) * 5 * intensity, 1, 8));
    params.minHoldSeconds = Math.round(clamp(numberOrDefault(params.minHoldSeconds, 0) + (rng() - 0.5) * 8 * intensity, 0, 12));
    params.maxHoldSeconds = Math.round(clamp(numberOrDefault(params.maxHoldSeconds, 90) * (0.45 + rng() * 1.5), 15, 180));
    params.exitBeforeClose = Math.round(clamp(numberOrDefault(params.exitBeforeClose, 8) + (rng() - 0.5) * 25 * intensity, 5, 45));
    params.momentumExitMovePercent = roundDisplayRatio(clamp(numberOrDefault(params.momentumExitMovePercent, 0.00005) * (0.5 + rng() * 1.8), 0.00002, 0.00016));
    params.requireFinalWindow = rng() > 0.48;
    params.exitOnMomentumFlip = rng() > 0.05;
  } else if (family.includes("order-flow") || family.includes("pressure")) {
    jitter("minPressure", 0.24, 0.08, 0.65, 0.9);
    jitter("maxSpread", 0.02, 0.005, 0.05, 0.75);
    jitter("minEdge", 0.08, 0.02, 0.18, 0.8);
    jitter("feeBuffer", 0.014, 0.004, 0.03, 0.55);
    jitter("minMovePercent", 0.00005, 0, 0.00035, 1.2);
    jitter("takeProfit", 0.055, 0.015, 0.14, 0.8);
    jitter("stopLoss", 0.04, 0.012, 0.1, 0.75);
    jitter("trailingStop", 0.018, 0.006, 0.06, 0.85);
    jitter("trailAfterProfit", 0.028, 0.008, 0.09, 0.85);
    params.minBidDepth = Math.round(clamp(numberOrDefault(params.minBidDepth, 2) + (rng() - 0.5) * 8 * intensity, 1, 20));
    params.minAskDepth = Math.round(clamp(numberOrDefault(params.minAskDepth, 1) + (rng() - 0.5) * 5 * intensity, 1, 12));
    params.minHoldSeconds = Math.round(clamp(numberOrDefault(params.minHoldSeconds, 4) + (rng() - 0.5) * 12 * intensity, 0, 24));
    params.maxHoldSeconds = Math.round(clamp(numberOrDefault(params.maxHoldSeconds, 120) * (0.45 + rng() * 1.8), 25, 420));
    params.exitBeforeClose = Math.round(clamp(numberOrDefault(params.exitBeforeClose, 20) + (rng() - 0.5) * 35 * intensity, 8, 90));
    params.minSecondsToClose = Math.round(clamp(numberOrDefault(params.minSecondsToClose, 35) + (rng() - 0.5) * 80 * intensity, 5, 240));
    params.momentumExitMovePercent = roundDisplayRatio(clamp(numberOrDefault(params.momentumExitMovePercent, 0.00006) * (0.6 + rng() * 1.5), 0.00003, 0.00018));
    params.requireMomentumConfirm = rng() > 0.55;
    params.exitOnMomentumFlip = rng() > 0.08;
    params.sideMode = choose(["hybrid", "pressure", "edge"]);
    params.yesMode = choose(["loose", "strict"]);
  } else if (family.includes("momentum")) {
    jitter("minMovePercent", 0.00025, 0.00005, 0.0012, 0.8);
    jitter("maxSpread", 0.02, 0.005, 0.06, 0.7);
    jitter("minEdge", 0.05, 0.0, 0.16, 0.9);
    jitter("takeProfit", 0.05, 0.01, 0.2, 0.9);
    jitter("stopLoss", 0.04, 0.01, 0.14, 0.8);
    jitter("trailingStop", 0.02, 0.005, 0.08, 1);
    jitter("trailAfterProfit", 0.03, 0.005, 0.12, 1);
    params.minHoldSeconds = Math.round(clamp(numberOrDefault(params.minHoldSeconds, 6) + (rng() - 0.5) * 14, 0, 30));
    params.maxHoldSeconds = Math.round(clamp(numberOrDefault(params.maxHoldSeconds, 180) * (0.35 + rng() * 1.8), 30, 720));
    params.exitBeforeClose = Math.round(clamp(numberOrDefault(params.exitBeforeClose, 35) + (rng() - 0.5) * 50, 10, 120));
    params.exitOnMomentumFlip = rng() > 0.12;
    params.yesMode = choose(["loose", "strict"]);
  } else if (family.includes("managed-scalp") || family.includes("scalp") || family.includes("liquidity")) {
    jitter("maxSpread", 0.025, 0.005, 0.07, 0.9);
    jitter("minEdge", 0.035, 0.0, 0.14, 1);
    jitter("feeBuffer", 0.012, 0.002, 0.03, 0.7);
    jitter("takeProfit", 0.06, 0.01, 0.18, 1);
    jitter("stopLoss", 0.045, 0.01, 0.12, 0.9);
    params.maxHoldSeconds = Math.round(clamp(numberOrDefault(params.maxHoldSeconds, 240) * (0.35 + rng() * 1.9), 30, 720));
    params.minBidDepth = Math.round(clamp(numberOrDefault(params.minBidDepth, 2) + (rng() - 0.5) * 8, 1, 20));
    params.minImbalance = roundDisplayRatio(clamp(numberOrDefault(params.minImbalance, 0.2) + (rng() - 0.5) * 0.5, 0.02, 0.75));
    params.yesMode = choose(["loose", "strict"]);
    params.sideMode = choose(["best", "fair"]);
  } else if (family.includes("cheap") || family.includes("longshot")) {
    jitter("maxAsk", 0.18, 0.01, 0.45, 1.2);
    jitter("minEdge", 0.04, 0.0, 0.18, 1);
    jitter("maxSpread", 0.04, 0.005, 0.09, 0.8);
    params.minSecondsToClose = Math.round(clamp(numberOrDefault(params.minSecondsToClose, 90) * (0.3 + rng() * 2.4), 10, 600));
    params.sideMode = choose(["best", "fair"]);
  } else if (family.includes("distance") || family.includes("target") || family.includes("favorite")) {
    jitter("minDistance", 0.00014, 0, 0.0007, 1.4);
    jitter("maxDistance", 0.00016, 0.00002, 0.0006, 1.2);
    jitter("maxSpread", 0.03, 0.005, 0.08, 0.8);
    jitter("minConfidence", 55, 35, 90, 0.45);
    jitter("minFairProbability", 0.68, 0.52, 0.9, 0.3);
    jitter("maxAsk", 0.75, 0.1, 0.95, 0.5);
    params.yesMode = choose(["loose", "strict"]);
    params.sideMode = choose(["best", "fair"]);
  } else {
    jitter("maxSpread", 0.03, 0.005, 0.08, 0.8);
    jitter("minEdge", 0.04, 0.0, 0.16, 1);
    jitter("feeBuffer", 0.014, 0.002, 0.035, 0.8);
  }

  params.variantIndex = index + 1;
  return params;
}

function factoryParamBounds(key: string, fallback: number) {
  const bounds: Record<string, { min: number; max: number }> = {
    minMovePercent: { min: 0.00005, max: 0.0012 },
    maxSpread: { min: 0.005, max: 0.09 },
    minEdge: { min: 0, max: 0.18 },
    feeBuffer: { min: 0.002, max: 0.035 },
    takeProfit: { min: 0.01, max: 0.2 },
    stopLoss: { min: 0.01, max: 0.14 },
    trailingStop: { min: 0.005, max: 0.08 },
    trailAfterProfit: { min: 0.005, max: 0.12 },
    minHoldSeconds: { min: 0, max: 30 },
    maxHoldSeconds: { min: 30, max: 720 },
    exitBeforeClose: { min: 10, max: 120 },
    momentumExitMovePercent: { min: 0.00004, max: 0.0002 },
    minBidDepth: { min: 1, max: 20 },
    minImbalance: { min: 0.02, max: 0.75 },
    minPressure: { min: 0.08, max: 0.65 },
    maxAsk: { min: 0.01, max: 0.96 },
    maxSecondsToClose: { min: 20, max: 160 },
    minSecondsToClose: { min: 8, max: 600 },
    volatilityMultiple: { min: 0.9, max: 2.8 },
    minAskDepth: { min: 1, max: 12 },
    minDistance: { min: 0, max: 0.0007 },
    minRequiredGap: { min: 0.00003, max: 0.00032 },
    minCompletedSeconds: { min: 0, max: 35 },
    minSettlementConfidence: { min: 45, max: 95 },
    maxCatchupDelta: { min: 0, max: 0.04 },
    maxDistance: { min: 0.00002, max: 0.0006 },
    minConfidence: { min: 35, max: 98 },
    minFairProbability: { min: 0.52, max: 0.98 },
    boostMultiplier: { min: 80, max: 220 },
  };
  return bounds[key] ?? { min: 0, max: Math.max(1, fallback * 2) };
}

function roundFactoryParamValue(key: string, value: number) {
  if (["minHoldSeconds", "maxHoldSeconds", "exitBeforeClose", "minBidDepth", "minAskDepth", "minSecondsToClose", "maxSecondsToClose", "minConfidence", "minCompletedSeconds", "minSettlementConfidence", "variantIndex"].includes(key)) {
    return Math.round(value);
  }
  return roundDisplayRatio(value);
}

function factoryAlgoName(family: string, params: Record<string, unknown>) {
  const prefix = familyLabel(family);
  const spread = numberOrNull(params.maxSpread);
  const edge = numberOrNull(params.minEdge);
  const move = numberOrNull(params.minMovePercent);
  const pressure = numberOrNull(params.minPressure);
  const minDistance = numberOrNull(params.minDistance);
  const minRequiredGap = numberOrNull(params.minRequiredGap);
  const minSettlementConfidence = numberOrNull(params.minSettlementConfidence);
  const minFairProbability = numberOrNull(params.minFairProbability);
  const maxSecondsToClose = numberOrNull(params.maxSecondsToClose);
  const maxAsk = numberOrNull(params.maxAsk);
  const takeProfit = numberOrNull(params.takeProfit);
  const stopLoss = numberOrNull(params.stopLoss);
  const parts = [
    pressure !== null ? `P>=${percent(pressure)}` : null,
    move !== null ? `M>=${percent(move)}` : null,
    minDistance !== null ? `D>=${minDistance.toFixed(5)}` : null,
    minRequiredGap !== null ? `G>=${minRequiredGap.toFixed(5)}` : null,
    maxSecondsToClose !== null ? `T<=${Math.round(maxSecondsToClose)}s` : null,
    minSettlementConfidence !== null ? `C>=${Math.round(minSettlementConfidence)}` : null,
    minFairProbability !== null ? `P>=${percent(minFairProbability)}` : null,
    maxAsk !== null ? `A<=${contractPrice(maxAsk)}` : null,
    spread !== null ? `S<=${contractPrice(spread)}` : null,
    edge !== null ? `E>=${percent(edge)}` : null,
    takeProfit !== null ? `TP ${contractPrice(takeProfit)}` : null,
    stopLoss !== null ? `SL ${contractPrice(stopLoss)}` : null,
  ].filter(Boolean);
  return `${prefix} ${parts.join(" ")}`.trim();
}

function nextGeneratedPaperDisplayId(
  family: string,
  name: string,
  sourceAlgoId: string,
  activeAlgos: GeneratedPaperAlgo[],
  archives: GeneratedPaperAlgoArchive[],
) {
  const prefix = generatedPaperFamilyCode(family, `${name} ${sourceAlgoId}`);
  const usedIds = new Set([
    ...activeAlgos.map((algo) => algo.displayId),
    ...archives.map((archive) => archive.displayId),
  ].filter(Boolean));
  const prefixPattern = new RegExp(`^${escapeRegExp(prefix)}-(\\d+)$`);
  const highest = [...usedIds].reduce((max, value) => {
    const match = prefixPattern.exec(value);
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);
  let next = highest + 1;
  let displayId = `${prefix}-${String(next).padStart(3, "0")}`;
  while (usedIds.has(displayId)) {
    next += 1;
    displayId = `${prefix}-${String(next).padStart(3, "0")}`;
  }
  return displayId;
}

function fallbackArchiveDisplayId(activationId: string, family: string, nameOrSource: string) {
  return `${generatedPaperFamilyCode(family, nameOrSource)}-${shortStableCode(activationId)}`;
}

function shortStableCode(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36).toUpperCase().padStart(4, "0").slice(0, 4);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function archiveGeneratedPaperAlgo(algo: GeneratedPaperAlgo, paperState: PaperState, deactivatedAt: string): GeneratedPaperAlgoArchive {
  return {
    activationId: algo.id,
    displayId: algo.displayId,
    sourceAlgoId: algo.sourceAlgoId,
    name: algo.name,
    family: algo.family,
    params: algo.params,
    sourceRunId: algo.sourceRunId,
    activatedAt: algo.promotedAt,
    deactivatedAt,
    arenaEntryPolicy: "legacy",
    sourceMetrics: algo.sourceMetrics,
    liveStats: paperSummarySnapshot(paperState, algo.id),
  };
}

function archiveRealisticArenaAlgos(arena: PaperArenaState, arenaAlgos: GeneratedPaperAlgo[], deactivatedAt: string): GeneratedPaperAlgoArchive[] {
  if (!arena.startedAt) return [];
  const arenaAlgoById = new Map<string, GeneratedPaperAlgo>(arenaAlgos.map((algo) => [algo.id, algo]));
  const selectedIds = uniqueStringList(arena.selectedAlgoIds.length > 0
    ? arena.selectedAlgoIds
    : arena.selectedAlgoId ? [arena.selectedAlgoId] : []);
  return selectedIds
    .map((id) => {
      const algo = arenaAlgoById.get(id) ?? fallbackArenaAlgoFromPaperActivity(arena, id);
      if (!algo) return null;
      const liveStats = paperSummarySnapshot(arena.paperState, algo.id);
      const hasRealisticActivity = liveStats.buys > 0 || liveStats.sells > 0 || liveStats.open > 0;
      if (!hasRealisticActivity) return null;
      return {
        activationId: `${algo.id}:${arena.startedAt}`,
        displayId: algo.displayId,
        sourceAlgoId: algo.sourceAlgoId,
        name: algo.name,
        family: algo.family,
        params: algo.params,
        sourceRunId: algo.sourceRunId,
        activatedAt: arena.startedAt,
        deactivatedAt,
        arenaEntryPolicy: arena.allowRepeatBuys ? "repeat-entry" : "single-entry",
        sourceMetrics: algo.sourceMetrics,
        liveStats,
      };
    })
    .filter((archive): archive is GeneratedPaperAlgoArchive => archive !== null);
}

function fallbackArenaAlgoFromPaperActivity(arena: PaperArenaState, strategyId: string): GeneratedPaperAlgo | null {
  if (!strategyId.startsWith("generated:")) return null;
  const activity = arena.paperState.trades.find((trade) => trade.strategyId === strategyId)
    ?? arena.paperState.events.find((event) => event.strategyId === strategyId);
  const sourceAlgoId = strategyId.slice("generated:".length);
  const name = activity?.strategyName ?? fallbackFactoryAlgoName(sourceAlgoId);
  const family = inferFactoryFamilyFromName(name);
  return {
    id: strategyId as GeneratedPaperAlgo["id"],
    displayId: displayIdFromFactorySource(sourceAlgoId) ?? fallbackArchiveDisplayId(strategyId, family, `${name} ${sourceAlgoId}`),
    sourceAlgoId,
    name,
    family,
    params: inferFactoryParamsFromName(name),
    enabled: true,
    promotedAt: arena.startedAt ?? new Date(0).toISOString(),
    sourceRunId: sourceRunIdFromFactorySource(sourceAlgoId),
    sourceMetrics: {
      closed: 0,
      wins: 0,
      losses: 0,
      totalPnl: 0,
      totalCost: 0,
      roi: 0,
      maxDrawdown: 0,
    },
  };
}

function displayIdFromFactorySource(sourceAlgoId: string) {
  const match = /^factory-batch-batch-([a-z]+)-[a-z0-9]+-(\d{4})$/i.exec(sourceAlgoId);
  return match ? `${match[1].toUpperCase()}-${match[2]}` : null;
}

function sourceRunIdFromFactorySource(sourceAlgoId: string) {
  return /^(factory-batch-batch-[a-z]+-[a-z0-9]+)-\d{4}$/i.exec(sourceAlgoId)?.[1] ?? null;
}

function sourceRunIdFromActivatedRow(row: { sourceAlgoId: string; sourceRunId: string | null }) {
  return row.sourceRunId ?? sourceRunIdFromFactorySource(row.sourceAlgoId);
}

function factoryBatchArenaRuntime(
  batch: FactoryAlgoBatch,
  arena: PaperArenaState,
  archives: GeneratedPaperAlgoArchive[],
  asOf: string,
  savedTradeSummaries: LocalPaperTradeStrategySummary[] = [],
) {
  const periods = new Map<string, { startMs: number; endMs: number; active: boolean }>();
  const batchAlgoByStrategyId = new Map<string, GeneratedPaperAlgo>(batch.algos.map((algo) => [algo.id, algo]));
  const activeAlgoIds = new Set<string>(batchAlgoByStrategyId.keys());
  const savedSummaries = savedTradeSummaries.filter((summary) => activeAlgoIds.has(summary.strategyId));
  const hasSavedSummaries = savedSummaries.length > 0;
  const algoRuntime = new Map<string, {
    family: string;
    totalPnl: number;
    closed: number;
    periods: Map<string, { startMs: number; endMs: number }>;
  }>();
  const threeTradeClosedByAlgo = new Map<string, number>();
  let totalPnl = 0;
  let closed = 0;
  const addPeriod = (start: string | null, end: string | null, active: boolean) => {
    if (!start || !end) return;
    const startMs = Date.parse(start);
    const endMs = Date.parse(end);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return;
    periods.set(`${start}|${end}`, { startMs, endMs, active });
  };
  const addAlgoRuntime = (strategyId: string, family: string, start: string | null, end: string | null, pnl: number, sells: number) => {
    if (!start || !end) return;
    const startMs = Date.parse(start);
    const endMs = Date.parse(end);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return;
    const current = algoRuntime.get(strategyId) ?? {
      family,
      totalPnl: 0,
      closed: 0,
      periods: new Map<string, { startMs: number; endMs: number }>(),
    };
    current.family = current.family || family;
    current.totalPnl += pnl;
    current.closed += sells;
    current.periods.set(`${start}|${end}`, { startMs, endMs });
    algoRuntime.set(strategyId, current);
  };
  const addThreeTradeClosed = (strategyId: string, sells: number) => {
    if (sells <= 0) return;
    threeTradeClosedByAlgo.set(strategyId, (threeTradeClosedByAlgo.get(strategyId) ?? 0) + sells);
  };

  for (const archive of archives) {
    if (sourceRunIdFromActivatedRow(archive) !== batch.id) continue;
    addPeriod(archive.activatedAt, archive.deactivatedAt, false);
    if (!hasSavedSummaries) {
      addAlgoRuntime(`generated:${archive.sourceAlgoId}`, archive.family, archive.activatedAt, archive.deactivatedAt, archive.liveStats.totalPnl, archive.liveStats.sells);
      if (factoryArchiveCanTrain(archive)) addThreeTradeClosed(`generated:${archive.sourceAlgoId}`, archive.liveStats.sells);
      totalPnl += archive.liveStats.totalPnl;
      closed += archive.liveStats.sells;
    }
  }

  const loaded = activeArenaBatchIds(arena).includes(batch.id);
  const active = loaded && arena.status === "running";
  if (loaded && arena.startedAt) {
    const activeEnd = active ? asOf : arena.stoppedAt ?? asOf;
    addPeriod(arena.startedAt, activeEnd, active);
    const activeSummaries = paperSummarySnapshotMap(arena.paperState);
    for (const algoId of activeAlgoIds) {
      const summary = activeSummaries.get(algoId);
      if (!summary) continue;
      if (hasSavedSummaries) continue;
      const algo = batchAlgoByStrategyId.get(algoId);
      addAlgoRuntime(algoId, algo?.family ?? "sweep-model", arena.startedAt, activeEnd, summary.totalPnl, summary.sells);
      if (!arena.allowRepeatBuys) addThreeTradeClosed(algoId, summary.sells);
      totalPnl += summary.totalPnl;
      closed += summary.sells;
    }
  }

  if (hasSavedSummaries) {
    const savedStarts: string[] = [];
    const savedEnds: string[] = [];
    for (const summary of savedSummaries) {
      const algo = batchAlgoByStrategyId.get(summary.strategyId);
      const liveStats = paperSummaryFromSavedTradeSummary(summary);
      const start = summary.firstOpenedAt ?? batch.createdAt;
      const end = summary.lastTransactionAt ?? asOf;
      if (start) savedStarts.push(start);
      if (end) savedEnds.push(end);
      addAlgoRuntime(summary.strategyId, algo?.family ?? "sweep-model", start, end, liveStats.totalPnl, liveStats.sells);
      addThreeTradeClosed(summary.strategyId, liveStats.sells);
      totalPnl += liveStats.totalPnl;
      closed += liveStats.sells;
    }
    if (periods.size === 0) {
      addPeriod(earliestIso(savedStarts), latestIso(savedEnds), active);
    }
  }

  const values = [...periods.values()];
  const totalMs = values.reduce((total, period) => total + period.endMs - period.startMs, 0);
  const elapsed15m = totalMs > 0 ? totalMs / (15 * 60_000) : 0;
  const pnlPer15m = elapsed15m > 0 ? roundDisplayMoney(totalPnl / Math.max(1, elapsed15m)) : null;
  const bestByFamily = new Map<string, number>();
  for (const stats of algoRuntime.values()) {
    const algoMs = [...stats.periods.values()].reduce((total, period) => total + period.endMs - period.startMs, 0);
    if (algoMs <= 0 || stats.closed <= 0) continue;
    const algoPnlPer15m = roundDisplayMoney(stats.totalPnl / Math.max(1, algoMs / (15 * 60_000)));
    if (algoPnlPer15m <= 0) continue;
    bestByFamily.set(stats.family, Math.max(bestByFamily.get(stats.family) ?? 0, algoPnlPer15m));
  }
  const bestFamilyPnlPer15m = roundDisplayMoney([...bestByFamily.values()].reduce((total, pnl) => total + pnl, 0));
  return {
    active,
    loaded,
    fullCycles: values.reduce((total, period) => total + Math.floor((period.endMs - period.startMs) / (15 * 60_000)), 0),
    sessions: values.length,
    bestFamilyCount: bestByFamily.size,
    bestFamilyPnlPer15m,
    totalMs,
    totalPnl: roundDisplayMoney(totalPnl),
    closed,
    threeTradeAlgos: [...threeTradeClosedByAlgo.values()].filter((value) => value >= topTradersMinClosedTrades).length,
    pnlPer15m,
  };
}

function fallbackFactoryAlgoName(sourceAlgoId: string) {
  return `${displayIdFromFactorySource(sourceAlgoId) ?? sourceAlgoId} Factory Algo`;
}

function inferFactoryFamilyFromName(name: string) {
  const value = name.toLowerCase();
  if (value.includes("kalshi lag") || value.includes("lag lock") || value.includes("lag-lock")) return "sweep-kalshi-lag-lock";
  if (value.includes("order flow") || value.includes("pressure")) return "sweep-order-flow-pressure";
  if (value.includes("liquidity")) return "sweep-liquidity-imbalance";
  if (value.includes("late lock") || value.includes("no-return")) return "sweep-late-lock";
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

function inferFactoryParamsFromName(name: string) {
  const params: Record<string, unknown> = {};
  assignCentsParam(params, "maxSpread", name, /S<=\s*([\d.]+)c/i);
  assignCentsParam(params, "maxAsk", name, /A<=\s*([\d.]+)c/i);
  assignCentsParam(params, "takeProfit", name, /TP\s*([\d.]+)c/i);
  assignCentsParam(params, "stopLoss", name, /SL\s*([\d.]+)c/i);
  assignPercentParam(params, "minEdge", name, /E>=\s*([\d.]+)%/i);
  assignPercentParam(params, "minPressure", name, /P>=\s*([\d.]+)%/i);
  assignPercentParam(params, "minFairProbability", name, /P>=\s*([\d.]+)%/i);
  assignNumberParam(params, "minDistance", name, /D>=\s*([\d.]+)/i);
  assignNumberParam(params, "minRequiredGap", name, /G>=\s*([\d.]+)/i);
  assignNumberParam(params, "minSettlementConfidence", name, /C>=\s*(\d+)/i);
  assignNumberParam(params, "maxSecondsToClose", name, /T<=\s*(\d+)s/i);
  assignNumberParam(params, "maxHoldSeconds", name, /H(\d+)s/i);
  return params;
}

function assignCentsParam(params: Record<string, unknown>, key: string, text: string, pattern: RegExp) {
  const value = numberMatch(text, pattern);
  if (value !== null) params[key] = roundDisplayRatio(value / 100);
}

function assignPercentParam(params: Record<string, unknown>, key: string, text: string, pattern: RegExp) {
  const value = numberMatch(text, pattern);
  if (value !== null) params[key] = roundDisplayRatio(value / 100);
}

function assignNumberParam(params: Record<string, unknown>, key: string, text: string, pattern: RegExp) {
  const value = numberMatch(text, pattern);
  if (value !== null) params[key] = value;
}

function numberMatch(text: string, pattern: RegExp) {
  const value = Number(pattern.exec(text)?.[1]);
  return Number.isFinite(value) ? value : null;
}

function compareActivatedArchiveRows(left: GeneratedPaperAlgoArchive, right: GeneratedPaperAlgoArchive) {
  return right.liveStats.totalPnl - left.liveStats.totalPnl
    || (right.liveStats.roi ?? -Infinity) - (left.liveStats.roi ?? -Infinity)
    || right.liveStats.sells - left.liveStats.sells
    || Date.parse(right.deactivatedAt) - Date.parse(left.deactivatedAt);
}

function activatedRowToArchive(row: Omit<GeneratedPaperAlgoArchive, "deactivatedAt"> & { deactivatedAt: string | null }) {
  return {
    ...row,
    deactivatedAt: row.deactivatedAt ?? new Date().toISOString(),
  };
}

function aggregateActivatedRows(rows: ActivatedAlgoRow[], paperState: PaperState, fallbackEnd: string): ActivatedAlgoRow[] {
  const groups = new Map<string, ActivatedAlgoRow[]>();
  for (const row of rows) {
    const key = row.sourceAlgoId || row.displayId;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }

  return [...groups.values()].map((group) => {
    const sorted = group.slice().sort((left, right) => {
      if (left.isActive !== right.isActive) return left.isActive ? -1 : 1;
      return Date.parse(right.deactivatedAt ?? right.activatedAt) - Date.parse(left.deactivatedAt ?? left.activatedAt);
    });
    const base = sorted[0];
    const activatedAt = earliestIso(group.map((row) => row.activatedAt)) ?? base.activatedAt;
    const isActive = group.some((row) => row.isActive);
    const latestEnd = latestIso(group.map((row) => row.deactivatedAt).filter((value): value is string => value !== null));
    const liveStats = aggregatePaperSummarySnapshots(group.map((row) => row.liveStats));
    const cycleCount = group.reduce((total, row) => total + activatedCycleCount(row.activatedAt, row.deactivatedAt ?? fallbackEnd), 0);
    const fullCycleCount = group.reduce((total, row) => total + activatedFullCycleCount(row.activatedAt, row.deactivatedAt ?? fallbackEnd), 0);
    const lastTransactionAt = latestIso(group
      .map((row) => row.lastTransactionAt ?? activatedFallbackLastTransactionAt(paperState, row, row.deactivatedAt ?? fallbackEnd))
      .filter((value): value is string => value !== null));

    return {
      ...base,
      activationId: `aggregate:${base.sourceAlgoId}`,
      activatedAt,
      deactivatedAt: isActive ? null : latestEnd,
      isActive,
      sampleCount: group.length,
      cycleCount,
      fullCycleCount,
      lastTransactionAt,
      liveStats,
    };
  });
}

function aggregatePaperSummarySnapshots(snapshots: PaperSummarySnapshot[]): PaperSummarySnapshot {
  const total = snapshots.reduce((current, snapshot) => ({
    buys: current.buys + snapshot.buys,
    sells: current.sells + snapshot.sells,
    open: current.open + snapshot.open,
    wins: current.wins + snapshot.wins,
    losses: current.losses + snapshot.losses,
    totalPnl: current.totalPnl + snapshot.totalPnl,
    totalCost: current.totalCost + snapshot.totalCost,
  }), {
    buys: 0,
    sells: 0,
    open: 0,
    wins: 0,
    losses: 0,
    totalPnl: 0,
    totalCost: 0,
  });
  const totalPnl = roundDisplayMoney(total.totalPnl);
  const totalCost = roundDisplayMoney(total.totalCost);
  return {
    ...total,
    totalPnl,
    totalCost,
    roi: totalCost > 0 ? roundDisplayRatio(totalPnl / totalCost) : null,
  };
}

function paperSummaryFromSavedTradeSummary(summary: LocalPaperTradeStrategySummary): PaperSummarySnapshot {
  const totalPnl = roundDisplayMoney(summary.liveStats.totalPnl);
  const totalCost = roundDisplayMoney(summary.liveStats.totalCost);
  return {
    buys: summary.liveStats.buys,
    sells: summary.liveStats.sells,
    open: summary.liveStats.open,
    wins: summary.liveStats.wins,
    losses: summary.liveStats.losses,
    totalPnl,
    totalCost,
    roi: totalCost > 0 ? roundDisplayRatio(totalPnl / totalCost) : summary.liveStats.roi,
  };
}

function activatedFallbackLastTransactionAt(paperState: PaperState, row: ActivatedAlgoRow, until: string) {
  if (!row.isActive) {
    return row.liveStats.buys + row.liveStats.sells > 0 ? row.deactivatedAt ?? until : null;
  }
  return activatedLastTransactionAt(paperState, row, until);
}

function earliestIso(values: string[]) {
  const times = values.map((value) => Date.parse(value)).filter(Number.isFinite);
  return times.length > 0 ? new Date(Math.min(...times)).toISOString() : null;
}

function latestIso(values: string[]) {
  const times = values.map((value) => Date.parse(value)).filter(Number.isFinite);
  return times.length > 0 ? new Date(Math.max(...times)).toISOString() : null;
}

function paperSummarySnapshot(paperState: PaperState, strategyId: string): PaperSummarySnapshot {
  const trades = paperState.trades.filter((trade) => trade.strategyId === strategyId);
  const events = paperState.events.filter((event) => event.strategyId === strategyId);
  const closed = trades.filter((trade) => trade.status === "closed" && trade.pnl !== null);
  const totalPnl = roundDisplayMoney(closed.reduce((total, trade) => total + (trade.pnl ?? 0), 0));
  const totalCost = roundDisplayMoney(closed.reduce((total, trade) => total + paperTradeCost(trade), 0));
  return {
    buys: events.filter((event) => event.action === "BUY").length,
    sells: events.filter((event) => event.action === "SELL").length,
    open: trades.filter((trade) => trade.status === "open").length,
    wins: closed.filter((trade) => (trade.pnl ?? 0) > 0).length,
    losses: closed.filter((trade) => (trade.pnl ?? 0) < 0).length,
    totalPnl,
    totalCost,
    roi: totalCost > 0 ? roundDisplayRatio(totalPnl / totalCost) : null,
  };
}

function emptyPaperSummarySnapshot(): PaperSummarySnapshot {
  return {
    buys: 0,
    sells: 0,
    open: 0,
    wins: 0,
    losses: 0,
    totalPnl: 0,
    totalCost: 0,
    roi: null,
  };
}

function paperSummarySnapshotMap(paperState: PaperState) {
  const normalized = normalizePaperState(paperState);
  const summaries = new Map<string, PaperSummarySnapshot>();
  const ensureSummary = (strategyId: string) => {
    const existing = summaries.get(strategyId);
    if (existing) return existing;
    const created = emptyPaperSummarySnapshot();
    summaries.set(strategyId, created);
    return created;
  };

  for (const event of normalized.events) {
    const summary = ensureSummary(event.strategyId);
    if (event.action === "BUY") summary.buys += 1;
    if (event.action === "SELL") summary.sells += 1;
  }

  for (const trade of normalized.trades) {
    const summary = ensureSummary(trade.strategyId);
    if (trade.status === "open") {
      summary.open += 1;
      continue;
    }
    if (trade.status !== "closed" || trade.pnl === null) continue;
    if (trade.pnl > 0) summary.wins += 1;
    if (trade.pnl < 0) summary.losses += 1;
    summary.totalPnl += trade.pnl;
    summary.totalCost += paperTradeCost(trade);
  }

  for (const summary of summaries.values()) {
    summary.totalPnl = roundDisplayMoney(summary.totalPnl);
    summary.totalCost = roundDisplayMoney(summary.totalCost);
    summary.roi = summary.totalCost > 0 ? roundDisplayRatio(summary.totalPnl / summary.totalCost) : null;
  }

  return summaries;
}

function paperLastTransactionMap(paperState: PaperState) {
  const normalized = normalizePaperState(paperState);
  const latestByStrategy = new Map<string, number>();
  for (const event of normalized.events) {
    const time = Date.parse(event.time);
    if (!Number.isFinite(time)) continue;
    const current = latestByStrategy.get(event.strategyId) ?? Number.NEGATIVE_INFINITY;
    if (time > current) latestByStrategy.set(event.strategyId, time);
  }
  return new Map([...latestByStrategy.entries()].map(([strategyId, time]) => [strategyId, new Date(time).toISOString()]));
}

function paperArenaMetrics(arena: PaperArenaState) {
  const trades = normalizePaperState(arena.paperState).trades;
  const closed = trades.filter((trade) => trade.status === "closed" && trade.pnl !== null);
  const open = trades.filter((trade) => trade.status === "open");
  const buys = trades.length;
  const sells = closed.length;
  const wins = closed.filter((trade) => (trade.pnl ?? 0) > 0).length;
  const losses = closed.filter((trade) => (trade.pnl ?? 0) < 0).length;
  const realizedPnl = roundDisplayMoney(closed.reduce((total, trade) => total + (trade.pnl ?? 0), 0));
  const closedCost = roundDisplayMoney(closed.reduce((total, trade) => total + paperTradeCost(trade), 0));
  const openCost = roundDisplayMoney(open.reduce((total, trade) => total + paperTradeCost(trade), 0));
  const selectedIds = arena.selectedAlgoIds.length > 0
    ? arena.selectedAlgoIds
    : arena.selectedAlgoId ? [arena.selectedAlgoId] : [];
  const strategyIds = selectedIds.length > 0 ? selectedIds : uniqueStringList(trades.map((trade) => trade.strategyId));
  const available = roundDisplayMoney(strategyIds.reduce((total, strategyId) => {
    const strategyClosedPnl = closed
      .filter((trade) => trade.strategyId === strategyId)
      .reduce((sum, trade) => sum + (trade.pnl ?? 0), 0);
    const strategyOpenCost = open
      .filter((trade) => trade.strategyId === strategyId)
      .reduce((sum, trade) => sum + paperTradeCost(trade), 0);
    return total + Math.max(0, arena.startingBalance + strategyClosedPnl - strategyOpenCost);
  }, 0));
  return {
    buys,
    sells,
    open: open.length,
    wins,
    losses,
    realizedPnl,
    closedCost,
    openCost,
    available,
    totalBankroll: roundDisplayMoney(arena.startingBalance * Math.max(1, strategyIds.length)),
    roi: closedCost > 0 ? roundDisplayRatio(realizedPnl / closedCost) : null,
    averageBet: buys > 0 ? roundDisplayMoney((closedCost + openCost) / buys) : null,
  };
}

function paperTradeCost(trade: PaperState["trades"][number]) {
  return trade.entryPrice * trade.contracts + trade.feesPaid;
}

function activatedTradesFromPaperState(paperState: PaperState, row: ActivatedAlgoRow, until: string) {
  const strategyId = paperStrategyIdForActivatedRow(row);
  return normalizePaperState(paperState).trades
    .filter((trade) => trade.strategyId === strategyId)
    .filter((trade) => paperTradeInWindow(trade, row.activatedAt, until))
    .sort((left, right) => Date.parse(right.openedAt) - Date.parse(left.openedAt));
}

function paperStrategyIdForActivatedRow(row: { sourceAlgoId: string }) {
  return `generated:${row.sourceAlgoId}`;
}

function buildTopTraderRows(
  candidateAlgos: GeneratedPaperAlgo[],
  arenaArchives: GeneratedPaperAlgoArchive[],
  topTradersArena: PaperArenaState,
  asOf: string,
  mainArena?: PaperArenaState,
  mainArenaAlgos: GeneratedPaperAlgo[] = [],
  savedTradeSummaries: LocalPaperTradeStrategySummary[] = [],
): TopTraderRow[] {
  const candidateBySource = new Map(candidateAlgos.map((algo) => [algo.sourceAlgoId, algo]));
  const topSummaryByStrategy = paperSummarySnapshotMap(topTradersArena.paperState);
  const savedRows: ActivatedAlgoRow[] = [];
  for (const summary of savedTradeSummaries) {
    const algo = candidateBySource.get(summary.sourceAlgoId);
    if (!algo) continue;
    const activatedAt = summary.firstOpenedAt ?? algo.promotedAt;
    const deactivatedAt = summary.lastTransactionAt;
    const cycleEnd = deactivatedAt ?? asOf;
    const liveStats = paperSummaryFromSavedTradeSummary(summary);
    savedRows.push({
      activationId: `saved:${summary.strategyId}`,
      displayId: algo.displayId,
      sourceAlgoId: algo.sourceAlgoId,
      name: algo.name,
      family: algo.family,
      params: algo.params,
      sourceRunId: algo.sourceRunId,
      activatedAt,
      deactivatedAt,
      arenaEntryPolicy: "single-entry",
      sourceMetrics: algo.sourceMetrics,
      liveStats,
      lastTransactionAt: summary.lastTransactionAt,
      isActive: false,
      sampleCount: Math.max(1, summary.marketCount),
      cycleCount: activatedCycleCount(activatedAt, cycleEnd),
      fullCycleCount: activatedFullCycleCount(activatedAt, cycleEnd),
    });
  }
  const savedSourceIds = new Set(savedRows.map((row) => row.sourceAlgoId));
  const topRows = activeArenaRowsForTopTraderEvidence(topTradersArena, candidateAlgos, asOf);
  const mainRows = mainArena ? activeArenaRowsForTopTraderEvidence(mainArena, mainArenaAlgos, asOf) : [];
  const archivedRows: ActivatedAlgoRow[] = arenaArchives
    .filter(isFactoryBatchActivatedRow)
    .filter(factoryArchiveCanTrain)
    .filter((archive) => candidateBySource.has(archive.sourceAlgoId))
    .map((archive) => ({ ...archive, isActive: false }));
  const rows = [
    ...savedRows,
    ...archivedRows.filter((row) => !savedSourceIds.has(row.sourceAlgoId)),
    ...mainRows.filter((row) => !savedSourceIds.has(row.sourceAlgoId)),
    ...topRows.filter((row) => !savedSourceIds.has(row.sourceAlgoId)),
  ]
    .filter((row) => candidateBySource.has(row.sourceAlgoId));
  const aggregatedBySource = new Map(aggregateActivatedRows(rows, topTradersArena.paperState, asOf)
    .filter((row) => candidateBySource.has(row.sourceAlgoId))
    .map((row) => [row.sourceAlgoId, row]));
  const candidateRows: TopTraderRow[] = candidateAlgos.map((algo) => {
    const aggregated = aggregatedBySource.get(algo.sourceAlgoId);
    const base: ActivatedAlgoRow = aggregated ?? {
      activationId: `top-candidate:${algo.sourceAlgoId}`,
      displayId: algo.displayId,
      sourceAlgoId: algo.sourceAlgoId,
      name: algo.name,
      family: algo.family,
      params: algo.params,
      sourceRunId: algo.sourceRunId,
      activatedAt: algo.promotedAt,
      deactivatedAt: null,
      arenaEntryPolicy: "single-entry",
      sourceMetrics: algo.sourceMetrics,
      liveStats: emptyPaperSummarySnapshot(),
      lastTransactionAt: null,
      isActive: false,
    };
    const strategyId = paperStrategyIdForActivatedRow(base);
    const runnerStats = topSummaryByStrategy.get(strategyId) ?? emptyPaperSummarySnapshot();
    const row: TopTraderRow = {
      ...base,
      rank: 0,
      bucket: "standby",
      runnerStats,
      isInTopRoster: false,
      score: activatedRankingScore(base, asOf),
      reliabilityScore: 0,
      prospectScore: topTraderProspectScore(base, asOf),
    };
    return {
      ...row,
      reliabilityScore: topTraderReliabilityScore(row, asOf),
    };
  });
  return assignTopTraderRosterBuckets(candidateRows, asOf);
}

function assignTopTraderRosterBuckets(rows: TopTraderRow[], asOf: string): TopTraderRow[] {
  const selected = new Set<string>();
  const matureChampionRows = rows
    .filter((row) => topTraderChampionEligible(row, asOf))
    .sort(compareTopTraderChampionRows(asOf))
    .slice(0, topTradersChampionSlots);
  const championRows = matureChampionRows;
  for (const row of championRows) selected.add(row.sourceAlgoId);

  const prospectRows = selectDiverseTopTraderRows(
    rows
      .filter((row) => !selected.has(row.sourceAlgoId))
      .filter(topTraderProspectEligible)
      .sort(compareTopTraderProspectRows(asOf)),
    selected,
    topTradersProspectSlots,
    { batchCap: 18, familyCap: 22 },
  );
  for (const row of prospectRows) selected.add(row.sourceAlgoId);

  const wildcardRows = selectDiverseTopTraderRows(
    rows
      .filter((row) => !selected.has(row.sourceAlgoId))
      .sort(compareTopTraderWildcardRows(asOf)),
    selected,
    topTradersWildcardSlots,
    { batchCap: 12, familyCap: 18 },
  );
  for (const row of wildcardRows) selected.add(row.sourceAlgoId);

  const roster = [
    ...championRows.map((row) => ({ ...row, bucket: "champion" as const })),
    ...prospectRows.map((row) => ({ ...row, bucket: "prospect" as const })),
    ...wildcardRows.map((row) => ({ ...row, bucket: "wildcard" as const })),
  ];
  const standby = rows
    .filter((row) => !selected.has(row.sourceAlgoId))
    .sort(compareTopTraderChampionRows(asOf))
    .map((row) => ({ ...row, bucket: "standby" as const }));

  return [...roster, ...standby].map((row, index) => ({
    ...row,
    rank: index + 1,
    isInTopRoster: row.bucket !== "standby",
  }));
}

function selectDiverseTopTraderRows(
  rows: TopTraderRow[],
  selected: Set<string>,
  limit: number,
  caps: { batchCap: number; familyCap: number },
) {
  const picked: TopTraderRow[] = [];
  const batchCounts = new Map<string, number>();
  const familyCounts = new Map<string, number>();
  for (const row of rows) {
    if (picked.length >= limit) break;
    if (selected.has(row.sourceAlgoId)) continue;
    const batchKey = activatedBatchFilterKey(row);
    const familyKey = row.family;
    if ((batchCounts.get(batchKey) ?? 0) >= caps.batchCap) continue;
    if ((familyCounts.get(familyKey) ?? 0) >= caps.familyCap) continue;
    picked.push(row);
    batchCounts.set(batchKey, (batchCounts.get(batchKey) ?? 0) + 1);
    familyCounts.set(familyKey, (familyCounts.get(familyKey) ?? 0) + 1);
  }
  if (picked.length >= limit) return picked;
  const pickedSources = new Set(picked.map((row) => row.sourceAlgoId));
  for (const row of rows) {
    if (picked.length >= limit) break;
    if (selected.has(row.sourceAlgoId) || pickedSources.has(row.sourceAlgoId)) continue;
    picked.push(row);
    pickedSources.add(row.sourceAlgoId);
  }
  return picked;
}

function topTraderProspectEligible(row: TopTraderRow | ActivatedAlgoRow) {
  const closed = row.liveStats.sells;
  return closed >= topTradersProspectMinClosedTrades
    && closed < 25
    && row.liveStats.totalPnl > 0
    && (row.liveStats.roi ?? 0) > 0;
}

function topTraderChampionEligible(row: TopTraderRow, asOf: string) {
  const confidence = activatedConfidence(row, asOf);
  const resolved = Math.max(1, row.liveStats.wins + row.liveStats.losses);
  const winRate = row.liveStats.wins / resolved;
  const pnlPerCycle = activatedPnlPerCycle(row, asOf);
  return row.liveStats.sells >= topTradersChampionMinClosedTrades
    && row.liveStats.totalPnl > 0
    && (row.liveStats.roi ?? 0) > 0
    && pnlPerCycle >= topTradersChampionMinPnlPerCycle
    && winRate >= topTradersChampionMinWinRate
    && row.reliabilityScore >= topTradersChampionMinReliabilityScore
    && confidence.liveEligible;
}

function compareTopTraderChampionRows(asOf: string) {
  return (left: TopTraderRow, right: TopTraderRow) => topTraderReliabilityScore(right, asOf) - topTraderReliabilityScore(left, asOf)
    || activatedRankingScore(right, asOf) - activatedRankingScore(left, asOf)
    || activatedPnlPerCycle(right, asOf) - activatedPnlPerCycle(left, asOf)
    || right.liveStats.totalPnl - left.liveStats.totalPnl
    || (right.liveStats.roi ?? -Infinity) - (left.liveStats.roi ?? -Infinity)
    || right.liveStats.sells - left.liveStats.sells;
}

function compareTopTraderProspectRows(asOf: string) {
  return (left: TopTraderRow, right: TopTraderRow) => topTraderProspectScore(right, asOf) - topTraderProspectScore(left, asOf)
    || activatedPnlPerCycle(right, asOf) - activatedPnlPerCycle(left, asOf)
    || right.liveStats.totalPnl - left.liveStats.totalPnl
    || topTraderBatchIndex(right) - topTraderBatchIndex(left);
}

function compareTopTraderWildcardRows(asOf: string) {
  return (left: TopTraderRow, right: TopTraderRow) => topTraderWildcardScore(right, asOf) - topTraderWildcardScore(left, asOf)
    || topTraderBatchIndex(right) - topTraderBatchIndex(left)
    || topTraderProspectScore(right, asOf) - topTraderProspectScore(left, asOf);
}

function topTraderProspectScore(row: ActivatedAlgoRow, asOf: string) {
  const closed = row.liveStats.sells;
  if (closed <= 0) return Number.NEGATIVE_INFINITY;
  const resolved = Math.max(1, row.liveStats.wins + row.liveStats.losses);
  const winRate = row.liveStats.wins / resolved;
  const roi = row.liveStats.roi ?? 0;
  const underTestedBonus = Math.max(0, 25 - closed) / 25;
  const batchBonus = topTraderBatchIndex(row) * 0.02;
  return activatedPnlPerCycle(row, asOf) * 8
    + row.liveStats.totalPnl * 0.08
    + roi * 2
    + winRate
    + underTestedBonus
    + batchBonus;
}

function topTraderReliabilityScore(row: ActivatedAlgoRow & { runnerStats?: PaperSummarySnapshot }, asOf: string) {
  const closed = row.liveStats.sells;
  const resolved = Math.max(1, row.liveStats.wins + row.liveStats.losses);
  const winRate = row.liveStats.wins / resolved;
  const roi = row.liveStats.roi ?? 0;
  const pnlPerCycle = activatedPnlPerCycle(row, asOf);
  const cycles = activatedCycleCountForRow(row, asOf);
  const confidence = activatedConfidence(row, asOf);

  if (closed <= 0 || row.liveStats.totalPnl <= 0 || roi <= 0 || pnlPerCycle <= 0) {
    return -10_000 + row.liveStats.totalPnl;
  }

  const evidenceScore = Math.min(1, closed / 60) * 25
    + Math.min(1, cycles / 6) * 15
    + Math.min(1, (row.sampleCount ?? 1) / 3) * 10;
  const profitScore = Math.min(40, pnlPerCycle * 320)
    + Math.min(30, roi * 180)
    + Math.min(20, row.liveStats.totalPnl * 2);
  const consistencyScore = (winRate - 0.5) * 120;
  const confidenceScore = confidence.label === "PROVEN" ? 20 : confidence.label === "QUALIFIED" ? 10 : 0;
  const weakSamplePenalty = closed < topTradersChampionMinClosedTrades ? (topTradersChampionMinClosedTrades - closed) * 4 : 0;
  const lossSkewPenalty = row.liveStats.losses > row.liveStats.wins ? (row.liveStats.losses - row.liveStats.wins) * 5 : 0;
  const recent = row.runnerStats ?? emptyPaperSummarySnapshot();
  const recentResolved = Math.max(1, recent.wins + recent.losses);
  const recentWinRate = recent.wins / recentResolved;
  const recentPenalty = recent.sells >= 3 && recent.totalPnl < 0
    ? Math.min(45, Math.abs(recent.totalPnl) * 18 + Math.max(0, 0.5 - recentWinRate) * 20)
    : 0;
  const recentBonus = recent.sells >= 3 && recent.totalPnl > 0
    ? Math.min(18, recent.totalPnl * 8 + Math.max(0, recentWinRate - 0.5) * 12)
    : 0;
  const tinyProfitPenalty = pnlPerCycle < topTradersChampionMinPnlPerCycle
    ? Math.min(45, (topTradersChampionMinPnlPerCycle - pnlPerCycle) * 400)
    : 0;

  return roundDisplayRatio(evidenceScore
    + profitScore
    + consistencyScore
    + confidenceScore
    + recentBonus
    - weakSamplePenalty
    - lossSkewPenalty
    - recentPenalty
    - tinyProfitPenalty);
}

function topTraderWildcardScore(row: ActivatedAlgoRow, asOf: string) {
  const closed = row.liveStats.sells;
  const noSampleBonus = closed === 0 ? 2 : Math.max(0, 3 - closed) * 0.4;
  const positiveEarlyBonus = row.liveStats.totalPnl > 0 ? 2 : 0;
  return topTraderBatchIndex(row) * 3
    + noSampleBonus
    + positiveEarlyBonus
    + Math.max(0, topTraderProspectScore(row, asOf)) * 0.15
    - Math.max(0, closed - 3) * 0.05;
}

function topTraderBatchIndex(row: { displayId: string; sourceRunId: string | null; sourceAlgoId: string }) {
  const batch = /^batch-([A-Z]+)$/i.exec(activatedBatchFilterKey(row))?.[1];
  return batch ? batchIndexFromName(batch) : -1;
}

function topTraderBucketLabel(bucket: TopTraderBucket) {
  if (bucket === "champion") return "Champion";
  if (bucket === "prospect") return "Prospect";
  if (bucket === "wildcard") return "Watch";
  return "Standby";
}

function topTraderBucketTone(bucket: TopTraderBucket): "info" | "warn" | "good" | "bad" | "neutral" {
  if (bucket === "champion") return "good";
  if (bucket === "prospect") return "info";
  if (bucket === "wildcard") return "warn";
  return "neutral";
}

function activeArenaRowsForTopTraderEvidence(arena: PaperArenaState, arenaAlgos: GeneratedPaperAlgo[], asOf: string): ActivatedAlgoRow[] {
  const startedAt = arena.startedAt;
  if (!startedAt || arena.allowRepeatBuys) return [];
  const arenaAlgoById = new Map<string, GeneratedPaperAlgo>(arenaAlgos.map((algo) => [algo.id, algo]));
  const summaryByStrategy = paperSummarySnapshotMap(arena.paperState);
  const lastTransactionByStrategy = paperLastTransactionMap(arena.paperState);
  const selectedIds = uniqueStringList(arena.selectedAlgoIds.length > 0
    ? arena.selectedAlgoIds
    : arena.selectedAlgoId ? [arena.selectedAlgoId] : []);
  return selectedIds
    .map((id) => {
      const algo = arenaAlgoById.get(id) ?? fallbackArenaAlgoFromPaperActivity(arena, id);
      if (!algo) return null;
      const liveStats = summaryByStrategy.get(algo.id) ?? emptyPaperSummarySnapshot();
      const hasActivity = liveStats.buys > 0 || liveStats.sells > 0 || liveStats.open > 0;
      if (!hasActivity && arena.status !== "running") return null;
      const row: ActivatedAlgoRow = {
        activationId: `${algo.id}:${startedAt}`,
        displayId: algo.displayId,
        sourceAlgoId: algo.sourceAlgoId,
        name: algo.name,
        family: algo.family,
        params: algo.params,
        sourceRunId: algo.sourceRunId,
        activatedAt: startedAt,
        deactivatedAt: arena.status === "running" ? null : arena.stoppedAt ?? asOf,
        arenaEntryPolicy: "single-entry",
        sourceMetrics: algo.sourceMetrics,
        liveStats,
        lastTransactionAt: lastTransactionByStrategy.get(algo.id) ?? null,
        isActive: arena.status === "running",
      };
      return row;
    })
    .filter((row): row is ActivatedAlgoRow => row !== null)
    .filter(isFactoryBatchActivatedRow);
}

function activatedLastTransactionAt(paperState: PaperState, row: ActivatedAlgoRow, until: string) {
  const strategyId = paperStrategyIdForActivatedRow(row);
  const sinceMs = Date.parse(row.activatedAt);
  const untilMs = Date.parse(until);
  const eventTimes = normalizePaperState(paperState).events
    .filter((event) => event.strategyId === strategyId)
    .map((event) => Date.parse(event.time))
    .filter((time) => Number.isFinite(time)
      && (!Number.isFinite(sinceMs) || time >= sinceMs)
      && (!Number.isFinite(untilMs) || time <= untilMs));
  if (eventTimes.length > 0) return new Date(Math.max(...eventTimes)).toISOString();
  if (row.liveStats.buys + row.liveStats.sells <= 0) return null;
  return row.deactivatedAt ?? until;
}

function paperTradeInWindow(trade: PaperTrade, since: string, until: string) {
  const sinceMs = Date.parse(since);
  const untilMs = Date.parse(until);
  const relevantTimes = [Date.parse(trade.openedAt), Date.parse(trade.closedAt ?? "")].filter(Number.isFinite);
  if (relevantTimes.length === 0) return false;
  if (Number.isFinite(sinceMs) && relevantTimes.every((time) => time < sinceMs)) return false;
  if (Number.isFinite(untilMs) && relevantTimes.every((time) => time > untilMs)) return false;
  return true;
}

const defaultArenaAlgos: GeneratedPaperAlgo[] = [
  {
    id: "generated:arena-ms-001",
    displayId: "MS-001",
    sourceAlgoId: "arena-ms-001",
    name: "Managed Scalp S <=4.0c E>=5.0% TP 12.0c SL 8.0c H420s loose",
    family: "sweep-managed-scalp",
    params: {
      maxSpread: 0.04,
      minEdge: 0.05,
      feeBuffer: 0.014,
      takeProfit: 0.12,
      stopLoss: 0.08,
      maxHoldSeconds: 420,
      yesMode: "loose",
    },
    enabled: true,
    promotedAt: "2026-06-01T00:00:00.000Z",
    sourceRunId: "arena-default",
    sourceMetrics: emptyArenaSourceMetrics(),
  },
  {
    id: "generated:arena-mo-001",
    displayId: "MO-001",
    sourceAlgoId: "arena-mo-001",
    name: "Momentum M>=0.02% S<=4.0c loose",
    family: "sweep-momentum",
    params: { minMovePercent: 0.0002, maxSpread: 0.04, feeBuffer: 0.018, boostMultiplier: 140, yesMode: "loose" },
    enabled: true,
    promotedAt: "2026-06-01T00:00:00.000Z",
    sourceRunId: "arena-default",
    sourceMetrics: emptyArenaSourceMetrics(),
  },
  {
    id: "generated:arena-mt-001",
    displayId: "MT-001",
    sourceAlgoId: "arena-mt-001",
    name: "Momentum Trail Fast M>=0.02% S<=2.0c TP 4.0c TR 2.0c H90s",
    family: "sweep-momentum-trail",
    params: {
      minMovePercent: 0.0002,
      maxSpread: 0.02,
      feeBuffer: 0.018,
      boostMultiplier: 150,
      minEdge: 0.04,
      minSecondsToClose: 45,
      takeProfit: 0.04,
      stopLoss: 0.04,
      trailingStop: 0.02,
      trailAfterProfit: 0.025,
      minHoldSeconds: 6,
      maxHoldSeconds: 90,
      exitBeforeClose: 30,
      exitOnMomentumFlip: true,
      momentumExitMovePercent: 0.00008,
      yesMode: "loose",
    },
    enabled: true,
    promotedAt: "2026-06-01T00:00:00.000Z",
    sourceRunId: "arena-default",
    sourceMetrics: emptyArenaSourceMetrics(),
  },
  {
    id: "generated:arena-mt-002",
    displayId: "MT-002",
    sourceAlgoId: "arena-mt-002",
    name: "Momentum Trail Standard M>=0.03% S<=2.0c TP 6.0c TR 2.5c H180s",
    family: "sweep-momentum-trail",
    params: {
      minMovePercent: 0.0003,
      maxSpread: 0.02,
      feeBuffer: 0.018,
      boostMultiplier: 165,
      minEdge: 0.06,
      minSecondsToClose: 60,
      takeProfit: 0.06,
      stopLoss: 0.05,
      trailingStop: 0.025,
      trailAfterProfit: 0.035,
      minHoldSeconds: 8,
      maxHoldSeconds: 180,
      exitBeforeClose: 35,
      exitOnMomentumFlip: true,
      momentumExitMovePercent: 0.00008,
      yesMode: "loose",
    },
    enabled: true,
    promotedAt: "2026-06-01T00:00:00.000Z",
    sourceRunId: "arena-default",
    sourceMetrics: emptyArenaSourceMetrics(),
  },
  {
    id: "generated:arena-mt-003",
    displayId: "MT-003",
    sourceAlgoId: "arena-mt-003",
    name: "Momentum Trail Runner M>=0.05% S<=2.0c TP 10.0c TR 3.0c H300s",
    family: "sweep-momentum-trail",
    params: {
      minMovePercent: 0.0005,
      maxSpread: 0.02,
      feeBuffer: 0.018,
      boostMultiplier: 180,
      minEdge: 0.08,
      minSecondsToClose: 90,
      takeProfit: 0.1,
      stopLoss: 0.06,
      trailingStop: 0.03,
      trailAfterProfit: 0.05,
      minHoldSeconds: 10,
      maxHoldSeconds: 300,
      exitBeforeClose: 45,
      exitOnMomentumFlip: true,
      momentumExitMovePercent: 0.0001,
      yesMode: "loose",
    },
    enabled: true,
    promotedAt: "2026-06-01T00:00:00.000Z",
    sourceRunId: "arena-default",
    sourceMetrics: emptyArenaSourceMetrics(),
  },
  {
    id: "generated:arena-mt-004",
    displayId: "MT-004",
    sourceAlgoId: "arena-mt-004",
    name: "Momentum Trail Micro M>=0.015% S<=1.0c TP 2.5c TR 1.0c H60s",
    family: "sweep-momentum-trail",
    params: {
      minMovePercent: 0.00015,
      maxSpread: 0.01,
      feeBuffer: 0.014,
      boostMultiplier: 130,
      minEdge: 0.03,
      minSecondsToClose: 40,
      takeProfit: 0.025,
      stopLoss: 0.025,
      trailingStop: 0.01,
      trailAfterProfit: 0.015,
      minHoldSeconds: 5,
      maxHoldSeconds: 60,
      exitBeforeClose: 25,
      exitOnMomentumFlip: true,
      momentumExitMovePercent: 0.00006,
      yesMode: "loose",
    },
    enabled: true,
    promotedAt: "2026-06-01T00:00:00.000Z",
    sourceRunId: "arena-default",
    sourceMetrics: emptyArenaSourceMetrics(),
  },
  {
    id: "generated:arena-td-001",
    displayId: "TD-001",
    sourceAlgoId: "arena-td-001",
    name: "Threshold Distance D>=0.00016 S<=3.0c loose",
    family: "sweep-distance",
    params: { minDistance: 0.00016, maxSpread: 0.03, minConfidence: 55, feeBuffer: 0.014, yesMode: "loose" },
    enabled: true,
    promotedAt: "2026-06-01T00:00:00.000Z",
    sourceRunId: "arena-default",
    sourceMetrics: emptyArenaSourceMetrics(),
  },
  {
    id: "generated:arena-sc-001",
    displayId: "SC-001",
    sourceAlgoId: "arena-sc-001",
    name: "Spread Scalp S<=2.0c E>=2.0% loose",
    family: "sweep-scalp",
    params: { maxSpread: 0.02, feeBuffer: 0.006, minEdge: 0.02, sideMode: "best", yesMode: "loose" },
    enabled: true,
    promotedAt: "2026-06-01T00:00:00.000Z",
    sourceRunId: "arena-default",
    sourceMetrics: emptyArenaSourceMetrics(),
  },
  {
    id: "generated:arena-tr-001",
    displayId: "TR-001",
    sourceAlgoId: "arena-tr-001",
    name: "Target Reversion D<=0.00012 S<=3.0c loose",
    family: "sweep-target-revert",
    params: { minDistance: 0, maxDistance: 0.00012, maxSpread: 0.03, feeBuffer: 0.014, yesMode: "loose" },
    enabled: true,
    promotedAt: "2026-06-01T00:00:00.000Z",
    sourceRunId: "arena-default",
    sourceMetrics: emptyArenaSourceMetrics(),
  },
  {
    id: "generated:arena-li-001",
    displayId: "LI-001",
    sourceAlgoId: "arena-li-001",
    name: "Liquidity Imbalance I>=25% S<=4.0c E>=2.0%",
    family: "sweep-liquidity-imbalance",
    params: { maxSpread: 0.04, minBidDepth: 2, minImbalance: 0.25, minEdge: 0.02, yesMode: "loose" },
    enabled: true,
    promotedAt: "2026-06-01T00:00:00.000Z",
    sourceRunId: "arena-default",
    sourceMetrics: emptyArenaSourceMetrics(),
  },
  {
    id: "generated:arena-of-001",
    displayId: "OF-001",
    sourceAlgoId: "arena-of-001",
    name: "Order Flow Pressure Tight P>=24% S<=2.0c E>=8.0% H90s",
    family: "sweep-order-flow-pressure",
    params: {
      minPressure: 0.24,
      maxSpread: 0.02,
      minEdge: 0.08,
      feeBuffer: 0.014,
      minBidDepth: 2,
      minAskDepth: 1,
      minSecondsToClose: 30,
      minMovePercent: 0.00003,
      sideMode: "hybrid",
      yesMode: "loose",
      requireMomentumConfirm: false,
      takeProfit: 0.05,
      stopLoss: 0.04,
      trailingStop: 0.018,
      trailAfterProfit: 0.025,
      minHoldSeconds: 4,
      maxHoldSeconds: 90,
      exitBeforeClose: 20,
      exitOnMomentumFlip: true,
      momentumExitMovePercent: 0.00006,
    },
    enabled: true,
    promotedAt: "2026-06-01T00:00:00.000Z",
    sourceRunId: "arena-default",
    sourceMetrics: emptyArenaSourceMetrics(),
  },
  {
    id: "generated:arena-of-002",
    displayId: "OF-002",
    sourceAlgoId: "arena-of-002",
    name: "Order Flow Pressure Confirmed P>=32% S<=3.0c E>=10.0% H180s",
    family: "sweep-order-flow-pressure",
    params: {
      minPressure: 0.32,
      maxSpread: 0.03,
      minEdge: 0.1,
      feeBuffer: 0.014,
      minBidDepth: 3,
      minAskDepth: 1,
      minSecondsToClose: 45,
      minMovePercent: 0.00008,
      sideMode: "pressure",
      yesMode: "loose",
      requireMomentumConfirm: true,
      takeProfit: 0.07,
      stopLoss: 0.045,
      trailingStop: 0.02,
      trailAfterProfit: 0.035,
      minHoldSeconds: 6,
      maxHoldSeconds: 180,
      exitBeforeClose: 25,
      exitOnMomentumFlip: true,
      momentumExitMovePercent: 0.00008,
    },
    enabled: true,
    promotedAt: "2026-06-01T00:00:00.000Z",
    sourceRunId: "arena-default",
    sourceMetrics: emptyArenaSourceMetrics(),
  },
  {
    id: "generated:arena-of-003",
    displayId: "OF-003",
    sourceAlgoId: "arena-of-003",
    name: "Order Flow Pressure Edge P>=18% S<=2.0c E>=12.0% H120s",
    family: "sweep-order-flow-pressure",
    params: {
      minPressure: 0.18,
      maxSpread: 0.02,
      minEdge: 0.12,
      feeBuffer: 0.012,
      minBidDepth: 2,
      minAskDepth: 2,
      minSecondsToClose: 35,
      minMovePercent: 0,
      sideMode: "edge",
      yesMode: "loose",
      requireMomentumConfirm: false,
      takeProfit: 0.055,
      stopLoss: 0.035,
      trailingStop: 0.015,
      trailAfterProfit: 0.025,
      minHoldSeconds: 4,
      maxHoldSeconds: 120,
      exitBeforeClose: 20,
      exitOnMomentumFlip: true,
      momentumExitMovePercent: 0.00006,
    },
    enabled: true,
    promotedAt: "2026-06-01T00:00:00.000Z",
    sourceRunId: "arena-default",
    sourceMetrics: emptyArenaSourceMetrics(),
  },
  {
    id: "generated:arena-ll-001",
    displayId: "LL-001",
    sourceAlgoId: "arena-ll-001",
    name: "Late Lock D>=0.00018 T<=60s P>=90.0% A<=90.0c S<=2.0c",
    family: "sweep-late-lock",
    params: {
      maxSecondsToClose: 60,
      minSecondsToClose: 10,
      minDistance: 0.00018,
      volatilityMultiple: 1.4,
      minFairProbability: 0.9,
      maxAsk: 0.9,
      maxSpread: 0.02,
      minEdge: 0.08,
      minConfidence: 84,
      minBidDepth: 1,
      minAskDepth: 1,
      feeBuffer: 0.01,
    },
    enabled: true,
    promotedAt: "2026-06-01T00:00:00.000Z",
    sourceRunId: "arena-default",
    sourceMetrics: emptyArenaSourceMetrics(),
  },
  {
    id: "generated:arena-ll-002",
    displayId: "LL-002",
    sourceAlgoId: "arena-ll-002",
    name: "Late Lock Fast D>=0.00012 T<=35s P>=88.0% A<=88.0c S<=1.5c",
    family: "sweep-late-lock",
    params: {
      maxSecondsToClose: 35,
      minSecondsToClose: 9,
      minDistance: 0.00012,
      volatilityMultiple: 1.8,
      minFairProbability: 0.88,
      maxAsk: 0.88,
      maxSpread: 0.015,
      minEdge: 0.08,
      minConfidence: 86,
      minBidDepth: 1,
      minAskDepth: 1,
      feeBuffer: 0.01,
    },
    enabled: true,
    promotedAt: "2026-06-01T00:00:00.000Z",
    sourceRunId: "arena-default",
    sourceMetrics: emptyArenaSourceMetrics(),
  },
  {
    id: "generated:arena-kl-001",
    displayId: "KL-001",
    sourceAlgoId: "arena-kl-001",
    name: "Kalshi Lag Lock M>=0.008% G>=0.00010 T<=90s P>=84.0% S<=2.0c",
    family: "sweep-kalshi-lag-lock",
    params: {
      maxSecondsToClose: 90,
      minSecondsToClose: 8,
      minMovePercent: 0.00008,
      minRequiredGap: 0.0001,
      minSettlementConfidence: 68,
      minFairProbability: 0.84,
      maxAsk: 0.9,
      maxSpread: 0.02,
      minEdge: 0.08,
      feeBuffer: 0.012,
      maxCatchupDelta: 0.015,
      minConfidence: 78,
      minBidDepth: 1,
      minAskDepth: 1,
      requireFinalWindow: false,
      takeProfit: 0.035,
      stopLoss: 0.035,
      trailingStop: 0.012,
      trailAfterProfit: 0.018,
      minHoldSeconds: 0,
      maxHoldSeconds: 90,
      exitBeforeClose: 8,
      exitOnMomentumFlip: true,
      momentumExitMovePercent: 0.00005,
    },
    enabled: true,
    promotedAt: "2026-06-01T00:00:00.000Z",
    sourceRunId: "arena-default",
    sourceMetrics: emptyArenaSourceMetrics(),
  },
  {
    id: "generated:arena-kl-002",
    displayId: "KL-002",
    sourceAlgoId: "arena-kl-002",
    name: "Kalshi Lag Lock Final G>=0.00008 T<=60s C>=72 P>=86.0% S<=1.5c",
    family: "sweep-kalshi-lag-lock",
    params: {
      maxSecondsToClose: 60,
      minSecondsToClose: 8,
      minMovePercent: 0.00004,
      minRequiredGap: 0.00008,
      minSettlementConfidence: 72,
      minFairProbability: 0.86,
      maxAsk: 0.92,
      maxSpread: 0.015,
      minEdge: 0.08,
      feeBuffer: 0.01,
      maxCatchupDelta: 0.012,
      minConfidence: 80,
      minBidDepth: 1,
      minAskDepth: 1,
      requireFinalWindow: true,
      takeProfit: 0.025,
      stopLoss: 0.03,
      trailingStop: 0.01,
      trailAfterProfit: 0.014,
      minHoldSeconds: 0,
      maxHoldSeconds: 60,
      exitBeforeClose: 6,
      exitOnMomentumFlip: true,
      momentumExitMovePercent: 0.00004,
    },
    enabled: true,
    promotedAt: "2026-06-01T00:00:00.000Z",
    sourceRunId: "arena-default",
    sourceMetrics: emptyArenaSourceMetrics(),
  },
  {
    id: "generated:arena-lf-001",
    displayId: "LF-001",
    sourceAlgoId: "arena-lf-001",
    name: "Late Favorite P>=72% A<=85.0c S<=6.0c",
    family: "sweep-late-favorite",
    params: { maxSecondsToClose: 120, minFairProbability: 0.72, maxAsk: 0.85, maxSpread: 0.06, sideMode: "fair" },
    enabled: true,
    promotedAt: "2026-06-01T00:00:00.000Z",
    sourceRunId: "arena-default",
    sourceMetrics: emptyArenaSourceMetrics(),
  },
];

function factoryBatchUserAlgos(generatedPaperAlgos: GeneratedPaperAlgo[], batchAlgos: GeneratedPaperAlgo[] = []) {
  const candidates = [
    ...filterFactoryBatchGeneratedAlgos(batchAlgos),
    ...filterFactoryBatchGeneratedAlgos(generatedPaperAlgos),
  ];
  const seenSources = new Set<string>();
  const seenDisplays = new Set<string>();
  const rows: GeneratedPaperAlgo[] = [];
  for (const algo of candidates) {
    if (seenSources.has(algo.sourceAlgoId) || seenDisplays.has(algo.displayId)) continue;
    seenSources.add(algo.sourceAlgoId);
    seenDisplays.add(algo.displayId);
    rows.push(algo);
  }
  return rows.slice(0, arenaBatchMax);
}

function mergeLiveAlgoLists(primary: GeneratedPaperAlgo[], lookup: GeneratedPaperAlgo[]) {
  const rows: GeneratedPaperAlgo[] = [];
  const seenSources = new Set<string>();
  const seenDisplays = new Set<string>();
  for (const algo of [...primary, ...lookup]) {
    if (seenSources.has(algo.sourceAlgoId) || seenDisplays.has(algo.displayId)) continue;
    seenSources.add(algo.sourceAlgoId);
    seenDisplays.add(algo.displayId);
    rows.push(algo);
  }
  return rows;
}

function favoriteAlgosForLive(available: GeneratedPaperAlgo[], favoriteSourceIds: string[]) {
  const bySource = new Map(available.map((algo) => [algo.sourceAlgoId, algo]));
  return favoriteSourceIds
    .map((sourceAlgoId) => bySource.get(sourceAlgoId) ?? null)
    .filter((algo): algo is GeneratedPaperAlgo => algo !== null);
}

type DryLiveProbationBoardRow = {
  record: DryLiveProbationRecord;
  attempts: number;
  rejects: number;
  closedExits: number;
  totalPnl: number;
  avgTrade: number | null;
  rejectRate: number | null;
  openPositions: number;
  lastAt: string | null;
};

function liveAlgoDropdownRows(selectedAlgo: GeneratedPaperAlgo | null, available: GeneratedPaperAlgo[], dryLiveRows: DryLiveProbationBoardRow[]) {
  const bySource = new Map(available.map((algo) => [algo.sourceAlgoId, algo]));
  const base = dryLiveRows
    .slice()
    .sort((left, right) => dryLiveDropdownScore(right) - dryLiveDropdownScore(left)
      || nowLiveRowSortMs(right) - nowLiveRowSortMs(left)
      || left.record.displayId.localeCompare(right.record.displayId))
    .map((row) => bySource.get(row.record.sourceAlgoId) ?? null)
    .filter((algo): algo is GeneratedPaperAlgo => algo !== null)
    .slice(0, 20);
  const rows = selectedAlgo ? [selectedAlgo, ...base] : base;
  const seen = new Set<string>();
  return rows.filter((algo) => {
    if (seen.has(algo.id)) return false;
    seen.add(algo.id);
    return true;
  });
}

function dryLiveDropdownScore(row: DryLiveProbationBoardRow) {
  const statusScore = row.record.status === "passed" ? 1_000_000 : row.record.status === "testing" ? 500_000 : 0;
  return statusScore
    + row.totalPnl * 10_000
    + (row.avgTrade ?? 0) * 5_000
    + row.closedExits * 100
    - row.rejects
    - (row.rejectRate ?? 0) * 100;
}

function dryLiveProbationStatusSort(status: DryLiveProbationRecord["status"]) {
  if (status === "testing") return 0;
  if (status === "passed") return 1;
  return 2;
}

function liveAlgoLookupMap(algos: GeneratedPaperAlgo[]) {
  const lookup = new Map<string, GeneratedPaperAlgo>();
  for (const algo of algos) {
    for (const key of liveAlgoLookupKeys(algo)) {
      if (!lookup.has(key)) lookup.set(key, algo);
    }
  }
  return lookup;
}

function findLiveAlgoByTypedId(lookup: Map<string, GeneratedPaperAlgo>, value: string) {
  for (const key of liveAlgoTypedLookupKeys(value)) {
    const algo = lookup.get(key);
    if (algo) return algo;
  }
  return null;
}

function liveAlgoLookupKeys(algo: GeneratedPaperAlgo) {
  return uniqueStringList([
    ...liveAlgoTypedLookupKeys(algo.displayId),
    ...liveAlgoTypedLookupKeys(algo.sourceAlgoId),
    ...liveAlgoTypedLookupKeys(algo.id),
  ]);
}

function liveAlgoTypedLookupKeys(value: string) {
  const normalized = value.trim().toUpperCase();
  if (!normalized) return [];
  const compact = normalized.replace(/[^A-Z0-9]/g, "");
  const compactWithoutLeadingZeros = compact.replace(/^([A-Z]+)0+(\d+)$/, "$1$2");
  return uniqueStringList([normalized, compact, compactWithoutLeadingZeros].filter(Boolean));
}

function topTraderCandidateAlgosForFactory(generatedPaperAlgos: GeneratedPaperAlgo[], batches: FactoryAlgoBatch[]) {
  const candidates = [
    ...batches.flatMap((batch) => filterFactoryBatchGeneratedAlgos(batch.algos)),
    ...filterFactoryBatchGeneratedAlgos(generatedPaperAlgos),
  ].filter((algo) => algo.family !== "sweep-cheap-longshot");
  const seenSources = new Set<string>();
  const seenDisplays = new Set<string>();
  const rows: GeneratedPaperAlgo[] = [];
  for (const algo of candidates) {
    if (seenSources.has(algo.sourceAlgoId) || seenDisplays.has(algo.displayId)) continue;
    seenSources.add(algo.sourceAlgoId);
    seenDisplays.add(algo.displayId);
    rows.push(algo);
  }
  return rows;
}

function arenaAlgosForArena(arena: PaperArenaState, generatedPaperAlgos: GeneratedPaperAlgo[], latestSweep: LocalFactorySweep | null, factoryBatches: FactoryAlgoBatch[]) {
  const activeBatches = activeArenaBatches(arena, factoryBatches);
  void latestSweep;
  return factoryBatchUserAlgos(generatedPaperAlgos, activeBatches.flatMap((batch) => batch.algos));
}

function activeArenaBatchIds(arena: { activeBatchId: string | null; activeBatchIds: string[] }) {
  return uniqueStringList(arena.activeBatchIds.length > 0
    ? arena.activeBatchIds
    : arena.activeBatchId ? [arena.activeBatchId] : []);
}

function activeArenaBatches(arena: PaperArenaState, factoryBatches: FactoryAlgoBatch[]) {
  return activeArenaBatchIds(arena)
    .map((id) => factoryBatches.find((batch) => batch.id === id) ?? null)
    .filter((batch): batch is FactoryAlgoBatch => batch !== null);
}

function emptyArenaSourceMetrics(): GeneratedPaperAlgo["sourceMetrics"] {
  return {
    closed: 0,
    wins: 0,
    losses: 0,
    totalPnl: 0,
    totalCost: 0,
    roi: 0,
    maxDrawdown: 0,
  };
}

function defaultArenaAlgoId(generatedPaperAlgos: GeneratedPaperAlgo[]) {
  return generatedPaperAlgos[0]?.id ?? null;
}

function initialArenaSelectedAlgoIds(arena: PaperArenaState, arenaAlgos: GeneratedPaperAlgo[], defaultAlgoId: string | null) {
  const availableIds = new Set<string>(arenaAlgos.map((algo) => algo.id));
  const stored = arena.selectedAlgoIds.length > 0 ? arena.selectedAlgoIds : arena.selectedAlgoId ? [arena.selectedAlgoId] : [];
  const validStored = uniqueStringList(stored).filter((id) => availableIds.has(id)).slice(0, arenaBatchMax);
  if (validStored.length > 0) return validStored;
  const defaultBatch = arenaAlgos.slice(0, Math.min(12, arenaBatchMax)).map((algo) => algo.id);
  return defaultBatch.length > 0 ? defaultBatch : defaultAlgoId ? [defaultAlgoId] : [];
}

function uniqueStringList(values: unknown[]) {
  const seen = new Set<string>();
  const rows: string[] = [];
  for (const value of values) {
    const text = stringOrNull(value);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    rows.push(text);
  }
  return rows;
}

function normalizeFavoriteAlgoSourceIds(value: unknown) {
  return uniqueStringList(Array.isArray(value) ? value : []).slice(0, 200);
}

function numberFromInput(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

function centsToDollars(cents: number | null) {
  return cents === null ? null : roundDisplayMoney(cents / 100);
}

function liveBuyRejectionCooldownMs(message: string) {
  const value = message.toLowerCase();
  if (
    value.includes("chasing the old")
    || value.includes("signal is skip")
    || value.includes("signal changed")
    || value.includes("waiting instead of chasing")
  ) return 180_000;
  if (value.includes("would not keep") && value.includes("positive edge")) return 180_000;
  if (value.includes("positive edge")) return 180_000;
  if (value.includes("algo gate failed") || value.includes("stable executable signal") || value.includes("own entry rules")) return 180_000;
  if (
    value.includes("no visible")
    || value.includes("ask is unavailable")
    || value.includes("bid is unavailable")
    || value.includes("tradable book")
    || value.includes("exit liquidity")
  ) return 120_000;
  if (value.includes("too_many_requests") || value.includes("429")) return 120_000;
  if (value.includes("filled 0 contracts") || value.includes("0 contracts")) return 120_000;
  if (value.includes("ask moved") || value.includes("bid moved") || value.includes("slippage")) return 90_000;
  if (value.includes("order cost") || value.includes("max per trade") || value.includes("max-order cap")) return 15_000;
  return 0;
}

function livePreflightCooldownMs(message: string) {
  const value = message.toLowerCase();
  if (value.includes("chasing the old") || value.includes("signal is skip") || value.includes("waiting instead of chasing")) return 30_000;
  if (value.includes("no visible") || value.includes("ask is unavailable") || value.includes("tradable book")) return 30_000;
  if (value.includes("positive edge")) return 30_000;
  if (value.includes("algo gate failed") || value.includes("stable executable signal") || value.includes("own entry rules")) return 30_000;
  if (value.includes("ask moved") || value.includes("slippage")) return 20_000;
  return 3_000;
}

function defaultTopTraderExecutableStats(algo: GeneratedPaperAlgo, now: string): TopTraderExecutableStats {
  return {
    sourceAlgoId: algo.sourceAlgoId,
    algoId: algo.id,
    displayId: algo.displayId,
    family: algo.family,
    startedAt: now,
    lastSignalAt: null,
    lastAttemptAt: null,
    lastAcceptedAt: null,
    lastRejectedAt: null,
    lastRejectedMessage: null,
    lastRejectedCategory: null,
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
    totalPnl: 0,
    totalCost: 0,
  };
}

function topTraderExecutablePreflightRejectionMessage(
  algo: GeneratedPaperAlgo,
  signal: ReturnType<typeof generatedPaperAlgoSignalPreview>,
  signalAction: "buy_yes" | "buy_no",
  signalSide: "YES" | "NO",
  priceCents: number,
  orderCount: number,
  input: PaperEngineInput,
  minEdgeAfterFees = liveExecutableMinEdgeAfterFees,
): string | null {
  if (signal.action !== signalAction || signal.side !== signalSide) {
    return `Current ${algo.displayId} signal is ${signal.action}; waiting instead of chasing the old ${signalAction} signal.`;
  }
  if (priceCents < 1 || priceCents > 99) return "Limit price must be 1-99 cents.";
  if (orderCount < 1) return "Order count must be a whole number from 1 to 5000.";
  const ask = topTraderAskForSide(signalSide, input);
  if (ask === null || ask <= 0) return `Current ${signalSide} ask is unavailable; waiting for a tradable book.`;
  const localAskCents = Math.ceil(ask * 100);
  const limitPriceCents = Math.min(99, priceCents + 1);
  if (localAskCents > limitPriceCents) {
    return `Current ${signalSide} ask moved to ${localAskCents}c, above allowed ${limitPriceCents}c.`;
  }
  const limitInput = topTraderInputWithSideAsk(input, signalSide, limitPriceCents / 100);
  const limitSignal = generatedPaperAlgoSignalPreview(limitInput, algo);
  if (limitSignal.edgeAfterFees < minEdgeAfterFees) {
    return `Current ${signalSide} order would not keep the required ${edgeCentsLabel(minEdgeAfterFees)} positive edge at ${limitPriceCents}c; edge is ${edgeCentsLabel(limitSignal.edgeAfterFees)}.`;
  }
  if (limitSignal.action === "skip" || !limitSignal.side) {
    return `Current ${algo.displayId} algo gate failed at ${limitPriceCents}c; it no longer passes its own entry rules. Edge is ${edgeCentsLabel(limitSignal.edgeAfterFees)}.`;
  }
  if (limitSignal.action !== signalAction || limitSignal.side !== signalSide) {
    return `Current ${algo.displayId} side changed to ${limitSignal.side} at ${limitPriceCents}c; waiting for a stable executable signal. Edge is ${edgeCentsLabel(limitSignal.edgeAfterFees)}.`;
  }
  const askDepth = topTraderAskDepthForSide(signalSide, input);
  if (askDepth === null || askDepth <= 0) {
    return `No visible ${signalSide} ask depth is available at ${limitPriceCents}c or better.`;
  }
  return null;
}

function topTraderAskForSide(side: "YES" | "NO", input: PaperEngineInput) {
  return side === "YES" ? input.yesAsk : input.noAsk;
}

function topTraderAskDepthForSide(side: "YES" | "NO", input: PaperEngineInput) {
  return side === "YES" ? input.yesAskDepth ?? null : input.noAskDepth ?? null;
}

function topTraderInputWithSideAsk(input: PaperEngineInput, side: "YES" | "NO", ask: number): PaperEngineInput {
  return side === "YES" ? { ...input, yesAsk: ask } : { ...input, noAsk: ask };
}

function updateTopTraderExecutableStats(
  state: TopTraderExecutableState,
  algo: GeneratedPaperAlgo,
  now: string,
  updater: (stats: TopTraderExecutableStats) => TopTraderExecutableStats,
): TopTraderExecutableState {
  const current = state.stats[algo.sourceAlgoId] ?? defaultTopTraderExecutableStats(algo, now);
  const nextStats = updater({
    ...current,
    algoId: algo.id,
    displayId: algo.displayId,
    family: algo.family,
    sourceAlgoId: algo.sourceAlgoId,
    startedAt: current.startedAt ?? now,
  });
  return {
    ...state,
    stats: {
      ...state.stats,
      [algo.sourceAlgoId]: {
        ...nextStats,
        totalPnl: roundDisplayMoney(nextStats.totalPnl),
        totalCost: roundDisplayMoney(nextStats.totalCost),
      },
    },
  };
}

function topTraderRejectionKey(message: string): TopTraderRejectionKey {
  const value = message.toLowerCase();
  if (
    value.includes("chasing the old")
    || value.includes("signal is skip")
    || value.includes("signal changed")
    || value.includes("waiting instead of chasing")
  ) return "staleRejects";
  if (
    value.includes("no visible")
    || value.includes("ask is unavailable")
    || value.includes("bid is unavailable")
    || value.includes("tradable book")
    || value.includes("exit liquidity")
  ) return "depthRejects";
  if (
    value.includes("algo gate failed")
    || value.includes("own entry rules")
    || value.includes("stable executable signal")
    || value.includes("executable signal changed")
  ) return "gateRejects";
  if (value.includes("positive edge") || value.includes("waiting for edge")) return "edgeRejects";
  if (value.includes("ask moved") || value.includes("bid moved") || value.includes("slippage") || value.includes("spread")) return "priceRejects";
  return "otherRejects";
}

function topTraderNormalizedRejectionKey(value: unknown): TopTraderRejectionKey | null {
  return value === "staleRejects"
    || value === "depthRejects"
    || value === "gateRejects"
    || value === "edgeRejects"
    || value === "priceRejects"
    || value === "otherRejects"
    ? value
    : null;
}

function topTraderRejectedStats(stats: TopTraderExecutableStats, message: string, rejectedAt: string): TopTraderExecutableStats {
  const rejectionKey = topTraderRejectionKey(message);
  return {
    ...stats,
    rejected: stats.rejected + 1,
    [rejectionKey]: stats[rejectionKey] + 1,
    lastRejectedAt: rejectedAt,
    lastRejectedMessage: message,
    lastRejectedCategory: rejectionKey,
  };
}

function topTraderExecutableSummary(stats: TopTraderExecutableStats | undefined): PaperSummarySnapshot {
  if (!stats) return emptyPaperSummarySnapshot();
  return {
    buys: stats.buys,
    sells: stats.sells,
    open: stats.open,
    wins: stats.wins,
    losses: stats.losses,
    totalPnl: stats.totalPnl,
    totalCost: stats.totalCost,
    roi: stats.totalCost > 0 ? roundDisplayRatio(stats.totalPnl / stats.totalCost) : null,
  };
}

function topTraderExecutableAcceptanceRate(stats: TopTraderExecutableStats | undefined) {
  if (!stats || stats.attempts <= 0) return null;
  return stats.acceptedBuys / stats.attempts;
}

function topTraderDryLiveReady(row: TopTraderRow, stats: TopTraderExecutableStats | undefined, asOf: string) {
  if (!stats) return false;
  if (row.bucket !== "champion" && row.bucket !== "prospect") return false;
  const acceptanceRate = topTraderExecutableAcceptanceRate(stats) ?? 0;
  const hardRejectRate = stats.attempts > 0
    ? (stats.edgeRejects + stats.gateRejects + stats.depthRejects) / stats.attempts
    : 1;
  const confidence = activatedConfidence(row, asOf);
  const avgProfit = topTraderAverageProfitPerTrade(row) ?? 0;
  return stats.attempts >= dryLivePromotionMinAttempts
    && stats.acceptedBuys >= dryLivePromotionMinAcceptedBuys
    && row.liveStats.sells >= dryLivePromotionMinClosedExits
    && row.liveStats.totalPnl > 0
    && avgProfit > 0
    && acceptanceRate >= dryLivePromotionMinAcceptanceRate
    && hardRejectRate <= dryLivePromotionMaxHardRejectRate
    && confidence.label !== "EARLY SPIKE"
    && confidence.label !== "LOSING"
    && confidence.label !== "NO SAMPLE";
}

function defaultDryLiveProbationRecord(algo: GeneratedPaperAlgo, startedAt: string): DryLiveProbationRecord {
  return {
    sourceAlgoId: algo.sourceAlgoId,
    displayId: algo.displayId,
    status: "testing",
    startedAt,
    reviewedAt: null,
    reason: null,
    attempts: 0,
    rejects: 0,
    closedExits: 0,
    totalPnl: 0,
    avgTrade: null,
    rejectRate: null,
  };
}

function dryLiveProbationReview(record: DryLiveProbationRecord, row: NowLiveAlgoPnlRow, reviewedAt: string): DryLiveProbationRecord | null {
  const startedMs = Date.parse(record.startedAt);
  const reviewedMs = Date.parse(reviewedAt);
  const elapsedMs = Number.isFinite(startedMs) && Number.isFinite(reviewedMs) ? reviewedMs - startedMs : 0;
  const attempts = Math.max(0, row.buys + row.rejects);
  const rejects = Math.max(0, row.rejects);
  const closedExits = Math.max(0, row.sells);
  const totalPnl = roundDisplayMoney(row.realizedPnl);
  const avgTrade = closedExits > 0 ? roundDisplayMoney(totalPnl / closedExits) : null;
  const rejectRate = attempts > 0 ? roundDisplayRatio(row.rejects / attempts) : null;
  if (row.openPositions > 0) return null;
  if (elapsedMs < dryLiveProbationMinElapsedMs) return null;
  if (attempts < dryLiveProbationMinAttempts && closedExits < dryLiveProbationMinClosedExits) return null;

  const passed = closedExits >= dryLivePromotionMinClosedExits
    && totalPnl > 0
    && (avgTrade ?? 0) > 0
    && (rejectRate ?? 1) <= dryLiveProbationMaxRejectRate;
  const sample = `${attempts} attempts, ${closedExits} exits, ${signedMoney(totalPnl)} P/L`;
  const reason = passed
    ? `Passed dry-live probation with ${sample}, ${avgTrade === null ? "-" : signedMoney(avgTrade)} avg, ${rejectRate === null ? "-" : percent(rejectRate)} rejects.`
    : `Failed dry-live probation with ${sample}, ${avgTrade === null ? "-" : signedMoney(avgTrade)} avg, ${rejectRate === null ? "-" : percent(rejectRate)} rejects.`;
  return {
    ...record,
    status: passed ? "passed" : "failed",
    reviewedAt,
    reason,
    attempts,
    rejects,
    closedExits,
    totalPnl,
    avgTrade,
    rejectRate,
  };
}

function executableActivatedRow(
  row: ActivatedAlgoRow,
  liveStats: PaperSummarySnapshot,
  stats: TopTraderExecutableStats | undefined,
  startedAt: string | null,
  fallbackEnd: string,
): ActivatedAlgoRow {
  const activatedAt = stats?.startedAt ?? startedAt ?? fallbackEnd;
  return {
    ...row,
    activationId: `exec:${row.sourceAlgoId}`,
    activatedAt,
    deactivatedAt: null,
    liveStats,
    lastTransactionAt: stats?.lastAcceptedAt ?? stats?.lastAttemptAt ?? stats?.lastSignalAt ?? null,
    cycleCount: activatedCycleCount(activatedAt, fallbackEnd),
    fullCycleCount: activatedFullCycleCount(activatedAt, fallbackEnd),
    isActive: true,
  };
}

function buildNowLiveAlgoPnlRows(
  liveLog: LiveExecutionLogEntry[],
  livePositions: LiveManagedPosition[],
  availableLiveAlgos: GeneratedPaperAlgo[],
  snapshot: RuntimeSnapshot,
): NowLiveAlgoPnlRow[] {
  type NowLiveAlgoPnlAccumulator = NowLiveAlgoPnlRow & {
    openPnlValue: number;
    sortMs: number;
    unpricedOpen: boolean;
  };

  const algoLookup = liveAlgoLookupMap(availableLiveAlgos);
  const algoById = new Map<string, GeneratedPaperAlgo>(availableLiveAlgos.map((algo) => [algo.id, algo]));
  const algoBySource = new Map<string, GeneratedPaperAlgo>(availableLiveAlgos.map((algo) => [algo.sourceAlgoId, algo]));
  const rows = new Map<string, NowLiveAlgoPnlAccumulator>();

  const ensureRow = (key: string, displayId: string, name: string | null, family: string | null) => {
    const existing = rows.get(key);
    if (existing) {
      existing.displayId = existing.displayId || displayId;
      existing.name = existing.name ?? name;
      existing.family = existing.family ?? family;
      return existing;
    }
    const created: NowLiveAlgoPnlAccumulator = {
      key,
      displayId,
      name,
      family,
      realizedPnl: 0,
      openPnl: null,
      totalPnl: null,
      buys: 0,
      sells: 0,
      rejects: 0,
      openPositions: 0,
      openContracts: 0,
      lastAt: null,
      openPnlValue: 0,
      sortMs: Number.NEGATIVE_INFINITY,
      unpricedOpen: false,
    };
    rows.set(key, created);
    return created;
  };

  const ensureAlgoRow = (algo: GeneratedPaperAlgo) => ensureRow(nowLiveAlgoRowKeyForAlgo(algo), algo.displayId, algo.name, algo.family);
  const ensureLogRow = (entry: LiveExecutionLogEntry) => {
    const algo = findLiveAlgoByTypedId(algoLookup, entry.algo);
    if (algo) return ensureAlgoRow(algo);
    const key = nowLiveAlgoRowKeyFromLogEntry(entry, algoLookup);
    if (!key) return null;
    const displayId = entry.algo.trim().toUpperCase();
    return ensureRow(key, displayId, null, null);
  };
  const ensurePositionRow = (position: LiveManagedPosition) => {
    const algo = algoBySource.get(position.algoSourceId)
      ?? algoById.get(position.algoId)
      ?? findLiveAlgoByTypedId(algoLookup, position.algoDisplayId);
    if (algo) return ensureAlgoRow(algo);
    const key = nowLiveAlgoRowKeyFromPosition(position, algoById, algoBySource, algoLookup);
    const displayId = position.algoDisplayId.trim().toUpperCase();
    return ensureRow(key, displayId, position.algoName, position.algoFamily);
  };
  const markLast = (row: NowLiveAlgoPnlAccumulator, value: string | null) => {
    const ms = Date.parse(value ?? "");
    if (!Number.isFinite(ms) || ms <= row.sortMs) return;
    row.sortMs = ms;
    row.lastAt = new Date(ms).toISOString();
  };

  for (const entry of liveLog) {
    const row = ensureLogRow(entry);
    if (!row) continue;
    if (entry.event === "SUBMITTED") row.buys += 1;
    if (entry.event === "SOLD") row.sells += 1;
    if (entry.event === "REJECTED") row.rejects += 1;
    markLast(row, entry.time);
  }

  for (const position of livePositions) {
    const row = ensurePositionRow(position);
    row.realizedPnl += position.realizedPnl ?? 0;
    if (position.status === "open" && position.contracts > 0) {
      row.openPositions += 1;
      row.openContracts += position.contracts;
      const openPnl = nowLivePositionOpenPnl(position, snapshot);
      if (openPnl === null) {
        row.unpricedOpen = true;
      } else {
        row.openPnlValue += openPnl;
      }
    }
    markLast(row, position.openedAt);
    markLast(row, position.closedAt);
  }

  return [...rows.values()]
    .map((row) => {
      const realizedPnl = roundDisplayMoney(row.realizedPnl);
      const openPnl = row.unpricedOpen ? null : roundDisplayMoney(row.openPnlValue);
      const totalPnl = openPnl === null ? null : roundDisplayMoney(realizedPnl + openPnl);
      return {
        key: row.key,
        displayId: row.displayId,
        name: row.name,
        family: row.family,
        realizedPnl,
        openPnl,
        totalPnl,
        buys: row.buys,
        sells: row.sells,
        rejects: row.rejects,
        openPositions: row.openPositions,
        openContracts: row.openContracts,
        lastAt: row.lastAt,
      };
    })
    .sort((left, right) => nowLiveRowSortMs(right) - nowLiveRowSortMs(left)
      || (right.totalPnl ?? right.realizedPnl) - (left.totalPnl ?? left.realizedPnl)
      || right.realizedPnl - left.realizedPnl
      || left.displayId.localeCompare(right.displayId));
}

function nowLiveRowSortMs(row: Pick<NowLiveAlgoPnlRow, "lastAt">) {
  const ms = Date.parse(row.lastAt ?? "");
  return Number.isFinite(ms) ? ms : Number.NEGATIVE_INFINITY;
}

function nowLiveAlgoRowKeyForAlgo(algo: GeneratedPaperAlgo) {
  return `source:${algo.sourceAlgoId}`;
}

function nowLiveAlgoRowKeyForDisplay(displayId: string) {
  return `display:${displayId.trim().toUpperCase()}`;
}

function nowLiveAlgoRowKeyFromLogEntry(entry: LiveExecutionLogEntry, algoLookup: Map<string, GeneratedPaperAlgo>) {
  const algo = findLiveAlgoByTypedId(algoLookup, entry.algo);
  if (algo) return nowLiveAlgoRowKeyForAlgo(algo);
  return nowLiveAlgoDisplayLooksLikeAlgo(entry.algo) ? nowLiveAlgoRowKeyForDisplay(entry.algo) : null;
}

function nowLiveAlgoRowKeyFromPosition(
  position: LiveManagedPosition,
  algoById: Map<string, GeneratedPaperAlgo>,
  algoBySource: Map<string, GeneratedPaperAlgo>,
  algoLookup: Map<string, GeneratedPaperAlgo>,
) {
  const algo = algoBySource.get(position.algoSourceId)
    ?? algoById.get(position.algoId)
    ?? findLiveAlgoByTypedId(algoLookup, position.algoDisplayId);
  return algo ? nowLiveAlgoRowKeyForAlgo(algo) : nowLiveAlgoRowKeyForDisplay(position.algoDisplayId);
}

function nowLiveAlgoDisplayLooksLikeAlgo(value: string) {
  return /^[A-Z][A-Z0-9]*-\d{1,6}$/i.test(value.trim());
}

function nowLivePositionOpenPnl(position: LiveManagedPosition, snapshot: RuntimeSnapshot) {
  if (position.status !== "open" || position.contracts <= 0) return 0;
  if (position.ticker !== snapshot.kalshi.market?.ticker) return null;
  const bid = liveBidForSide(position.side, snapshot);
  if (bid === null || bid <= 0) return null;
  return roundDisplayMoney((bid - position.entryPrice) * position.contracts);
}

function liveSubmittedOrders(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!isRecord(item)) return null;
      const count = numberOrNull(item.count);
      const priceCents = numberOrNull(item.priceCents);
      if (count === null || count <= 0 || priceCents === null || priceCents <= 0) return null;
      return {
        count: Math.floor(count),
        priceCents,
      };
    })
    .filter((item): item is { count: number; priceCents: number } => item !== null);
}

function liveSideLabel(value: unknown): "YES" | "NO" | null {
  if (typeof value !== "string") return null;
  const normalized = value.toUpperCase();
  return normalized === "YES" || normalized === "NO" ? normalized : null;
}

function liveBidForSide(side: "YES" | "NO", snapshot: RuntimeSnapshot) {
  return side === "YES"
    ? snapshot.orderBook.yesBids[0]?.price ?? null
    : snapshot.orderBook.noBids[0]?.price ?? null;
}

function liveExitReason(
  position: LiveManagedPosition,
  bid: number,
  snapshot: RuntimeSnapshot,
  currentSignal: { side: "YES" | "NO" | null; edgeAfterFees: number } | null,
) {
  const takeProfit = liveParamNumber(position.algoParams, "takeProfit", 0.04);
  const stopLoss = liveParamNumber(position.algoParams, "stopLoss", 0.04);
  const maxHoldSeconds = liveParamNumber(position.algoParams, "maxHoldSeconds", 180);
  const trailingStop = liveParamNumber(position.algoParams, "trailingStop", 0);
  const trailAfterProfit = liveParamNumber(position.algoParams, "trailAfterProfit", 0);
  const minHoldSeconds = liveParamNumber(position.algoParams, "minHoldSeconds", 0);
  const exitBeforeClose = liveParamNumber(position.algoParams, "exitBeforeClose", 2);
  const exitOnMomentumFlip = booleanOrDefault(position.algoParams.exitOnMomentumFlip, true);
  const momentumExitMovePercent = liveParamNumber(position.algoParams, "momentumExitMovePercent", 0.00008);
  const unitPnl = bid - position.entryPrice;
  const ageSeconds = Math.max(0, (Date.parse(snapshot.generatedAt) - Date.parse(position.openedAt)) / 1000);
  const bestExitPrice = Math.max(position.bestExitPrice ?? bid, bid);
  const bestUnitPnl = bestExitPrice - position.entryPrice;
  const movePercent = snapshot.price > 0 ? snapshot.oneMinuteChange / snapshot.price : 0;
  const adverseMomentum = position.side === "YES"
    ? movePercent <= -momentumExitMovePercent
    : movePercent >= momentumExitMovePercent;

  if (trailingStop > 0 && bestUnitPnl >= trailAfterProfit && bestExitPrice - bid >= trailingStop && ageSeconds >= minHoldSeconds) return `${position.algoDisplayId} trailing pullback exit.`;
  if (exitOnMomentumFlip && adverseMomentum && unitPnl > 0 && ageSeconds >= minHoldSeconds) return `${position.algoDisplayId} momentum turn exit.`;
  if (unitPnl >= takeProfit) return `${position.algoDisplayId} managed take-profit.`;
  if (unitPnl <= -stopLoss) return `${position.algoDisplayId} managed stop-loss.`;
  if (ageSeconds >= maxHoldSeconds) return `${position.algoDisplayId} managed max-hold exit.`;
  if (currentSignal?.side && currentSignal.side !== position.side && currentSignal.edgeAfterFees > 0 && ageSeconds >= 10) {
    return `${position.algoDisplayId} flipped to the opposite side.`;
  }
  if (snapshot.secondsToClose <= exitBeforeClose) return `${position.algoDisplayId} close-window exit.`;
  return null;
}

function liveParamNumber(params: Record<string, unknown>, key: string, fallback: number) {
  const value = params[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function normalizeGeneratedPaperAlgoArchives(value: unknown): GeneratedPaperAlgoArchive[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const archives: GeneratedPaperAlgoArchive[] = [];
  for (const item of value) {
    const archive = normalizeGeneratedPaperAlgoArchive(item);
    if (!archive || seen.has(archive.activationId)) continue;
    if (factoryArchiveIsBeforeBatchReset(archive)) continue;
    seen.add(archive.activationId);
    archives.push(archive);
  }
  return archives
    .sort((left, right) => Date.parse(right.deactivatedAt) - Date.parse(left.deactivatedAt))
    .slice(0, 10_000);
}

function normalizeFactoryAlgoBatches(value: unknown): FactoryAlgoBatch[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(normalizeFactoryAlgoBatch)
    .filter((batch): batch is FactoryAlgoBatch => batch !== null)
    .filter(isSingleLetterFactoryBatch)
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
    .slice(0, 12);
}

function mergeFactoryAlgoBatches(current: FactoryAlgoBatch[], incoming: FactoryAlgoBatch[]) {
  const byId = new Map<string, FactoryAlgoBatch>();
  for (const batch of [...incoming, ...current].filter(isSingleLetterFactoryBatch)) {
    byId.set(batch.id, batch);
  }
  return normalizeFactoryAlgoBatches([...byId.values()]);
}

function isSingleLetterFactoryBatch(batch: FactoryAlgoBatch) {
  return /^Batch [A-Z]$/i.test(batch.name)
    && /^factory-batch-batch-[a-z]-[a-z0-9]+$/i.test(batch.id);
}

function filterFactoryBatchGeneratedAlgos(algos: GeneratedPaperAlgo[]) {
  return algos.filter(isFactoryBatchGeneratedAlgo);
}

function isFactoryBatchGeneratedAlgo(algo: { displayId: string; sourceAlgoId: string; sourceRunId: string | null }) {
  return /^[A-Z]-\d{4}$/i.test(algo.displayId)
    || /^factory-batch-batch-[a-z]+-[a-z0-9]+-\d{4}$/i.test(algo.sourceAlgoId)
    || /^factory-batch-batch-[a-z]+-[a-z0-9]+$/i.test(algo.sourceRunId ?? "");
}

function filterFactoryBatchActivatedRows<T extends { displayId: string; sourceAlgoId: string; sourceRunId: string | null }>(rows: T[]) {
  return rows.filter(isFactoryBatchActivatedRow);
}

function isFactoryBatchActivatedRow(row: { displayId: string; sourceAlgoId: string; sourceRunId: string | null }) {
  return /^[A-Z]-\d{4}$/i.test(row.displayId)
    || /^factory-batch-batch-[a-z]+-[a-z0-9]+-\d{4}$/i.test(row.sourceAlgoId)
    || /^factory-batch-batch-[a-z]+-[a-z0-9]+$/i.test(row.sourceRunId ?? "");
}

function factoryArchiveIsBeforeBatchReset(archive: { sourceAlgoId: string; sourceRunId: string | null; activatedAt: string; deactivatedAt: string | null }) {
  if (sourceRunIdFromActivatedRow(archive) !== factoryBatchSResetBatchId) return false;
  const resetMs = Date.parse(factoryBatchSResetAt);
  const endMs = Date.parse(archive.deactivatedAt ?? archive.activatedAt);
  return Number.isFinite(resetMs) && Number.isFinite(endMs) && endMs < resetMs;
}

function resetBatchSArenaStateIfNeeded(arena: PaperArenaState): PaperArenaState {
  if (!activeArenaBatchIds(arena).includes(factoryBatchSResetBatchId)) return arena;
  const resetMs = Date.parse(factoryBatchSResetAt);
  const startedMs = Date.parse(arena.startedAt ?? "");
  if (!Number.isFinite(resetMs) || (Number.isFinite(startedMs) && startedMs >= resetMs)) return arena;
  return {
    ...arena,
    status: arena.status === "idle" ? "running" : arena.status,
    activeBatchId: factoryBatchSResetBatchId,
    activeBatchIds: uniqueStringList([...arena.activeBatchIds, factoryBatchSResetBatchId]),
    startedAt: factoryBatchSResetAt,
    stoppedAt: null,
    paperState: emptyPaperState,
  };
}

function normalizeFactoryAlgoBatch(value: unknown): FactoryAlgoBatch | null {
  if (!isRecord(value)) return null;
  const id = stringOrNull(value.id);
  const name = stringOrNull(value.name);
  const createdAt = stringOrNull(value.createdAt);
  if (!id || !name || !createdAt) return null;
  const generation = Math.max(1, Math.floor(numberOrDefault(value.generation, 1)));
  const parentBatchIds = uniqueStringList(Array.isArray(value.parentBatchIds) ? value.parentBatchIds : []);
  return {
    id,
    name,
    createdAt,
    source: stringOrNull(value.source) ?? "Generated variants",
    generation,
    parentBatchIds,
    summary: normalizeFactoryEvolutionSummary(value.summary, generation, parentBatchIds),
    algos: normalizeGeneratedPaperAlgos(value.algos).slice(0, factoryBatchSize),
  };
}

function normalizeFactoryEvolutionSummary(value: unknown, generation: number, parentBatchIds: string[]): FactoryEvolutionSummary {
  const summary = isRecord(value) ? value : {};
  return {
    generation: Math.max(1, Math.floor(numberOrDefault(summary.generation, generation))),
    eliteCount: Math.max(0, Math.floor(numberOrDefault(summary.eliteCount, 0))),
    mutationCount: Math.max(0, Math.floor(numberOrDefault(summary.mutationCount, 0))),
    crossoverCount: Math.max(0, Math.floor(numberOrDefault(summary.crossoverCount, 0))),
    explorationCount: Math.max(0, Math.floor(numberOrDefault(summary.explorationCount, 0))),
    avoidedFailureZones: Math.max(0, Math.floor(numberOrDefault(summary.avoidedFailureZones, 0))),
    trainingSampleCount: Math.max(0, Math.floor(numberOrDefault(summary.trainingSampleCount, 0))),
    quarantinedSampleCount: Math.max(0, Math.floor(numberOrDefault(summary.quarantinedSampleCount, 0))),
    winnerCount: Math.max(0, Math.floor(numberOrDefault(summary.winnerCount, 0))),
    failureCount: Math.max(0, Math.floor(numberOrDefault(summary.failureCount, 0))),
    parentBatchIds: uniqueStringList(Array.isArray(summary.parentBatchIds) ? summary.parentBatchIds : parentBatchIds),
  };
}

function normalizeGeneratedPaperAlgoArchive(value: unknown): GeneratedPaperAlgoArchive | null {
  if (!isRecord(value)) return null;
  const activationId = stringOrNull(value.activationId);
  const displayId = stringOrNull(value.displayId);
  const sourceAlgoId = stringOrNull(value.sourceAlgoId);
  const name = stringOrNull(value.name);
  const rawFamily = stringOrNull(value.family);
  const family = rawFamily === "shadow" ? "paper-variant" : rawFamily;
  const activatedAt = stringOrNull(value.activatedAt);
  const deactivatedAt = stringOrNull(value.deactivatedAt);
  if (!activationId || !sourceAlgoId || !name || !family || !activatedAt || !deactivatedAt) return null;
  return {
    activationId,
    displayId: displayId ?? fallbackArchiveDisplayId(activationId, family, `${name} ${sourceAlgoId}`),
    sourceAlgoId,
    name,
    family,
    params: isRecord(value.params) ? { ...value.params } : {},
    sourceRunId: typeof value.sourceRunId === "string" ? value.sourceRunId : null,
    activatedAt,
    deactivatedAt,
    arenaEntryPolicy: normalizeArenaEntryPolicy(value.arenaEntryPolicy),
    sourceMetrics: normalizeGeneratedSourceMetrics(value.sourceMetrics),
    liveStats: normalizePaperSummarySnapshot(value.liveStats),
  };
}

function normalizeArenaEntryPolicy(value: unknown): ArenaEntryPolicy {
  return value === "single-entry" || value === "repeat-entry" || value === "legacy" || value === "top-traders-dry-run" ? value : "legacy";
}

function normalizeGeneratedSourceMetrics(value: unknown): GeneratedPaperAlgo["sourceMetrics"] {
  const metrics = isRecord(value) ? value : {};
  return {
    closed: numberOrDefault(metrics.closed, 0),
    wins: numberOrDefault(metrics.wins, 0),
    losses: numberOrDefault(metrics.losses, 0),
    totalPnl: numberOrDefault(metrics.totalPnl, 0),
    totalCost: numberOrDefault(metrics.totalCost, 0),
    roi: numberOrDefault(metrics.roi, 0),
    maxDrawdown: numberOrDefault(metrics.maxDrawdown, 0),
  };
}

function normalizePaperSummarySnapshot(value: unknown): PaperSummarySnapshot {
  const stats = isRecord(value) ? value : {};
  return {
    buys: numberOrDefault(stats.buys, 0),
    sells: numberOrDefault(stats.sells, 0),
    open: numberOrDefault(stats.open, 0),
    wins: numberOrDefault(stats.wins, 0),
    losses: numberOrDefault(stats.losses, 0),
    totalPnl: numberOrDefault(stats.totalPnl, 0),
    totalCost: numberOrDefault(stats.totalCost, 0),
    roi: numberOrNull(stats.roi),
  };
}

function defaultFactoryAutomationState(): FactoryAutomationState {
  return {
    enabled: true,
    lastRunAt: null,
    lastScheduledBatchSlot: null,
    lastScheduledBatchAt: null,
    promotedCount: 0,
    demotedCount: 0,
    decisions: [],
  };
}

function normalizeFactoryAutomationState(value: unknown): FactoryAutomationState {
  if (!isRecord(value)) return defaultFactoryAutomationState();
  return {
    enabled: typeof value.enabled === "boolean" ? value.enabled : true,
    lastRunAt: stringOrNull(value.lastRunAt),
    lastScheduledBatchSlot: stringOrNull(value.lastScheduledBatchSlot),
    lastScheduledBatchAt: stringOrNull(value.lastScheduledBatchAt),
    promotedCount: numberOrDefault(value.promotedCount, 0),
    demotedCount: numberOrDefault(value.demotedCount, 0),
    decisions: Array.isArray(value.decisions)
      ? value.decisions.map(normalizeFactoryAutomationDecision).filter((item): item is FactoryAutomationDecision => item !== null).slice(0, 40)
      : [],
  };
}

function normalizeFactoryAutomationDecision(value: unknown): FactoryAutomationDecision | null {
  if (!isRecord(value)) return null;
  const time = stringOrNull(value.time);
  const type = normalizeAutomationDecisionType(value.type);
  const title = stringOrNull(value.title);
  const detail = stringOrNull(value.detail);
  const tone = normalizeAutomationDecisionTone(value.tone);
  if (!time || !type || !title || !detail || !tone) return null;
  return {
    id: stringOrNull(value.id) ?? `${type}:${title}:${time}`,
    time,
    type,
    title,
    detail,
    tone,
  };
}

function normalizeAutomationDecisionType(value: unknown): FactoryAutomationDecision["type"] | null {
  return value === "promote" || value === "demote" || value === "flag" || value === "hold" ? value : null;
}

function normalizeAutomationDecisionTone(value: unknown): FactoryAutomationDecision["tone"] | null {
  return value === "positive" || value === "negative" || value === "warning" || value === "neutral" ? value : null;
}

function booleanOrDefault(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

function defaultPaperArenaState(): PaperArenaState {
  return {
    status: "idle",
    selectedAlgoId: null,
    selectedAlgoIds: [],
    activeBatchId: null,
    activeBatchIds: [],
    startingBalance: 50,
    maxBet: 10,
    allowRepeatBuys: false,
    startedAt: null,
    stoppedAt: null,
    paperState: emptyPaperState,
  };
}

function normalizePaperArenaState(value: unknown): PaperArenaState {
  if (!isRecord(value)) return defaultPaperArenaState();
  const defaultState = defaultPaperArenaState();
  const status = normalizePaperArenaStatus(value.status);
  const selectedAlgoIds = uniqueStringList(Array.isArray(value.selectedAlgoIds)
    ? value.selectedAlgoIds
    : stringOrNull(value.selectedAlgoId) ? [value.selectedAlgoId] : []);
  const activeBatchIds = uniqueStringList(Array.isArray(value.activeBatchIds)
    ? value.activeBatchIds
    : stringOrNull(value.activeBatchId) ? [value.activeBatchId] : []);
  return resetBatchSArenaStateIfNeeded({
    status,
    selectedAlgoId: selectedAlgoIds[0] ?? stringOrNull(value.selectedAlgoId),
    selectedAlgoIds,
    activeBatchId: activeBatchIds[0] ?? stringOrNull(value.activeBatchId),
    activeBatchIds,
    startingBalance: Math.max(1, numberOrDefault(value.startingBalance, defaultState.startingBalance)),
    maxBet: Math.max(1, numberOrDefault(value.maxBet, defaultState.maxBet)),
    allowRepeatBuys: status === "idle" ? defaultState.allowRepeatBuys : booleanOrDefault(value.allowRepeatBuys, defaultState.allowRepeatBuys),
    startedAt: stringOrNull(value.startedAt),
    stoppedAt: stringOrNull(value.stoppedAt),
    paperState: normalizePaperState(value.paperState),
  });
}

function normalizePaperArenaStatus(value: unknown): PaperArenaStatus {
  return value === "running" || value === "paused" || value === "idle" ? value : "idle";
}

function normalizeLiveExecutionLog(value: unknown): LiveExecutionLogEntry[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(normalizeLiveExecutionLogEntry)
    .filter((entry): entry is LiveExecutionLogEntry => entry !== null)
    .slice(0, dryLiveProbationMaxLogRows);
}

function normalizeLiveExecutionLogEntry(value: unknown): LiveExecutionLogEntry | null {
  if (!isRecord(value)) return null;
  const id = stringOrNull(value.id);
  const time = stringOrNull(value.time);
  const event = normalizeLiveExecutionEvent(value.event);
  const algo = stringOrNull(value.algo);
  const message = stringOrNull(value.message);
  if (!id || !time || !event || !algo || !message) return null;
  const orderAction = normalizeLiveLogOrderAction(value.orderAction) ?? inferLiveLogOrderAction(event);
  return {
    id,
    time,
    event,
    orderAction,
    algo,
    ticker: stringOrNull(value.ticker),
    side: stringOrNull(value.side),
    contracts: numberOrNull(value.contracts),
    cost: numberOrNull(value.cost),
    profit: numberOrNull(value.profit),
    message,
  };
}

function normalizeLiveExecutionEvent(value: unknown): LiveExecutionLogEntry["event"] | null {
  return value === "ARMED"
    || value === "STOPPED"
    || value === "SUBMITTED"
    || value === "SOLD"
    || value === "REJECTED"
    || value === "LIVE ON"
    || value === "LIVE OFF"
    || value === "DRY RUN"
    || value === "REAL MODE"
    || value === "PROBATION PASS"
    || value === "PROBATION FAIL"
    ? value
    : null;
}

function normalizeLiveLogOrderAction(value: unknown): LiveExecutionLogEntry["orderAction"] {
  return value === "BUY" || value === "SELL" ? value : null;
}

function inferLiveLogOrderAction(event: LiveExecutionLogEntry["event"]): LiveExecutionLogEntry["orderAction"] {
  if (event === "SUBMITTED") return "BUY";
  if (event === "SOLD") return "SELL";
  return null;
}

function normalizeLiveManagedPositions(value: unknown): LiveManagedPosition[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(normalizeLiveManagedPosition)
    .filter((position): position is LiveManagedPosition => position !== null)
    .slice(0, 1_000);
}

function normalizeLiveManagedPosition(value: unknown): LiveManagedPosition | null {
  if (!isRecord(value)) return null;
  const id = stringOrNull(value.id);
  const algoId = stringOrNull(value.algoId);
  const algoDisplayId = stringOrNull(value.algoDisplayId);
  const algoName = stringOrNull(value.algoName);
  const algoFamily = stringOrNull(value.algoFamily);
  const algoSourceId = stringOrNull(value.algoSourceId);
  const ticker = stringOrNull(value.ticker);
  const side = value.side === "YES" || value.side === "NO" ? value.side : null;
  const openedAt = stringOrNull(value.openedAt);
  if (!id || !algoId || !algoDisplayId || !algoName || !algoFamily || !algoSourceId || !ticker || !side || !openedAt) return null;
  return {
    id,
    status: value.status === "closed" ? "closed" : "open",
    algoId,
    algoDisplayId,
    algoName,
    algoFamily,
    algoSourceId,
    algoParams: isRecord(value.algoParams) ? { ...value.algoParams } : {},
    ticker,
    side,
    contracts: Math.max(0, Math.floor(numberOrDefault(value.contracts, 0))),
    entryPrice: numberOrDefault(value.entryPrice, 0),
    openedAt,
    closedAt: stringOrNull(value.closedAt),
    exitPrice: numberOrNull(value.exitPrice),
    bestExitPrice: numberOrNull(value.bestExitPrice),
    realizedPnl: numberOrNull(value.realizedPnl),
    exitReason: stringOrNull(value.exitReason),
  };
}

function defaultTopTradersExecutableState(): TopTraderExecutableState {
  return {
    startedAt: null,
    stoppedAt: null,
    stats: {},
    positions: [],
  };
}

function normalizeTopTradersExecutableState(value: unknown): TopTraderExecutableState {
  if (!isRecord(value)) return defaultTopTradersExecutableState();
  const stats: Record<string, TopTraderExecutableStats> = {};
  if (isRecord(value.stats)) {
    for (const [key, item] of Object.entries(value.stats)) {
      const normalized = normalizeTopTraderExecutableStats(item);
      if (normalized) stats[key] = normalized;
    }
  }
  return {
    startedAt: stringOrNull(value.startedAt),
    stoppedAt: stringOrNull(value.stoppedAt),
    stats,
    positions: normalizeLiveManagedPositions(value.positions),
  };
}

function richerTopTradersExecutableState(current: TopTraderExecutableState, backup: TopTraderExecutableState): TopTraderExecutableState {
  return topTradersExecutableEvidenceCount(backup) > topTradersExecutableEvidenceCount(current) ? backup : current;
}

function topTradersExecutableEvidenceCount(state: TopTraderExecutableState) {
  return Object.values(state.stats).reduce((total, stats) => (
    total
    + stats.signals
    + stats.attempts
    + stats.acceptedBuys
    + stats.rejected
    + stats.buys
    + stats.sells
  ), state.positions.length);
}

function normalizeTopTraderExecutableStats(value: unknown): TopTraderExecutableStats | null {
  if (!isRecord(value)) return null;
  const sourceAlgoId = stringOrNull(value.sourceAlgoId);
  const algoId = stringOrNull(value.algoId);
  const displayId = stringOrNull(value.displayId);
  const family = stringOrNull(value.family);
  if (!sourceAlgoId || !algoId || !displayId || !family) return null;
  const totalPnl = roundDisplayMoney(numberOrDefault(value.totalPnl, 0));
  const totalCost = roundDisplayMoney(numberOrDefault(value.totalCost, 0));
  const rawLastRejectedMessage = stringOrNull(value.lastRejectedMessage);
  const rawLastRejectedCategory = topTraderNormalizedRejectionKey(value.lastRejectedCategory);
  const rawEdgeRejects = Math.max(0, Math.floor(numberOrDefault(value.edgeRejects, 0)));
  const rawGateRejects = Math.max(0, Math.floor(numberOrDefault(value.gateRejects, 0)));
  const legacyGateRejects = shouldMigrateLegacyGateRejects(rawLastRejectedCategory, rawLastRejectedMessage) ? rawEdgeRejects : 0;
  const lastRejectedCategory = legacyGateRejects > 0 ? "gateRejects" : rawLastRejectedCategory;
  return {
    sourceAlgoId,
    algoId,
    displayId,
    family,
    startedAt: stringOrNull(value.startedAt),
    lastSignalAt: stringOrNull(value.lastSignalAt),
    lastAttemptAt: stringOrNull(value.lastAttemptAt),
    lastAcceptedAt: stringOrNull(value.lastAcceptedAt),
    lastRejectedAt: stringOrNull(value.lastRejectedAt),
    lastRejectedMessage: rawLastRejectedMessage,
    lastRejectedCategory,
    signals: Math.max(0, Math.floor(numberOrDefault(value.signals, 0))),
    attempts: Math.max(0, Math.floor(numberOrDefault(value.attempts, 0))),
    acceptedBuys: Math.max(0, Math.floor(numberOrDefault(value.acceptedBuys, 0))),
    rejected: Math.max(0, Math.floor(numberOrDefault(value.rejected, 0))),
    staleRejects: Math.max(0, Math.floor(numberOrDefault(value.staleRejects, 0))),
    depthRejects: Math.max(0, Math.floor(numberOrDefault(value.depthRejects, 0))),
    gateRejects: rawGateRejects + legacyGateRejects,
    edgeRejects: Math.max(0, rawEdgeRejects - legacyGateRejects),
    priceRejects: Math.max(0, Math.floor(numberOrDefault(value.priceRejects, 0))),
    otherRejects: Math.max(0, Math.floor(numberOrDefault(value.otherRejects, 0))),
    buys: Math.max(0, Math.floor(numberOrDefault(value.buys, 0))),
    sells: Math.max(0, Math.floor(numberOrDefault(value.sells, 0))),
    open: Math.max(0, Math.floor(numberOrDefault(value.open, 0))),
    wins: Math.max(0, Math.floor(numberOrDefault(value.wins, 0))),
    losses: Math.max(0, Math.floor(numberOrDefault(value.losses, 0))),
    totalPnl,
    totalCost,
  };
}

function shouldMigrateLegacyGateRejects(category: TopTraderRejectionKey | null, message: string | null) {
  if (category !== "edgeRejects" || !message) return false;
  const value = message.toLowerCase();
  if (!value.includes("would not keep") || !value.includes("positive edge")) return false;
  const edgeMatch = /edge is\s+([+-]?\d+(?:\.\d+)?)c/i.exec(message);
  if (!edgeMatch) return false;
  const edgeCents = Number(edgeMatch[1]);
  return Number.isFinite(edgeCents) && edgeCents >= liveExecutableMinEdgeAfterFees * 100;
}

function defaultLiveRunnerState(): LiveRunnerState {
  return {
    status: "idle",
    selectedAlgoId: null,
    selectedAlgoIds: [],
    maxBet: 10,
    allowRepeatBuys: true,
    autoDryLiveEnabled: false,
    dryLiveProbation: {},
    startedAt: null,
    stoppedAt: null,
  };
}

function normalizeLiveRunnerState(value: unknown): LiveRunnerState {
  if (!isRecord(value)) return defaultLiveRunnerState();
  const defaultState = defaultLiveRunnerState();
  const selectedAlgoId = stringOrNull(value.selectedAlgoId);
  const selectedAlgoIds = uniqueStringList(Array.isArray(value.selectedAlgoIds)
    ? value.selectedAlgoIds
    : selectedAlgoId ? [selectedAlgoId] : []);
  return {
    status: normalizePaperArenaStatus(value.status),
    selectedAlgoId,
    selectedAlgoIds,
    maxBet: Math.max(1, numberOrDefault(value.maxBet, defaultState.maxBet)),
    allowRepeatBuys: booleanOrDefault(value.allowRepeatBuys, defaultState.allowRepeatBuys),
    autoDryLiveEnabled: booleanOrDefault(value.autoDryLiveEnabled, defaultState.autoDryLiveEnabled),
    dryLiveProbation: normalizeDryLiveProbationRecords(value.dryLiveProbation),
    startedAt: stringOrNull(value.startedAt),
    stoppedAt: stringOrNull(value.stoppedAt),
  };
}

function normalizeDryLiveProbationRecords(value: unknown): Record<string, DryLiveProbationRecord> {
  if (!isRecord(value)) return {};
  const records: Record<string, DryLiveProbationRecord> = {};
  for (const item of Object.values(value)) {
    const record = normalizeDryLiveProbationRecord(item);
    if (record) records[record.sourceAlgoId] = record;
  }
  return records;
}

function normalizeDryLiveProbationRecord(value: unknown): DryLiveProbationRecord | null {
  if (!isRecord(value)) return null;
  const sourceAlgoId = stringOrNull(value.sourceAlgoId);
  const displayId = stringOrNull(value.displayId);
  const startedAt = stringOrNull(value.startedAt);
  if (!sourceAlgoId || !displayId || !startedAt) return null;
  const status: DryLiveProbationRecord["status"] = value.status === "passed" || value.status === "failed" ? value.status : "testing";
  const attempts = Math.max(0, Math.floor(numberOrDefault(value.attempts, 0)));
  const rejects = Math.max(0, Math.floor(numberOrDefault(value.rejects, Math.max(0, attempts - Math.floor(numberOrDefault(value.closedExits, 0))))));
  return {
    sourceAlgoId,
    displayId,
    status,
    startedAt,
    reviewedAt: stringOrNull(value.reviewedAt),
    reason: stringOrNull(value.reason),
    attempts,
    rejects,
    closedExits: Math.max(0, Math.floor(numberOrDefault(value.closedExits, 0))),
    totalPnl: roundDisplayMoney(numberOrDefault(value.totalPnl, 0)),
    avgTrade: numberOrNull(value.avgTrade),
    rejectRate: numberOrNull(value.rejectRate),
  };
}

function defaultLiveOrderRouterStatus(): LiveOrderRouterStatus {
  return {
    state: "checking",
    configured: false,
    liveEnabled: false,
    dryRun: true,
    liveSwitchEnabled: false,
    sellExitsEnabled: false,
    allowedSeries: "KXDOGE15M",
    maxOrderDollars: 10,
    maxExposureDollars: 50,
    executionMinEdgeAfterFees: liveExecutableMinEdgeAfterFees,
    conservativeMode: false,
    conservative: {
      minConfidence: 92,
      minEdgeAfterFees: 0.06,
      minSideProbability: 0.9,
      maxSpreadCents: 2,
      minSecondsToClose: 20,
      maxSecondsToClose: 300,
    },
    error: null,
  };
}

function normalizeLiveOrderRouterStatus(value: unknown): LiveOrderRouterStatus {
  const defaults = defaultLiveOrderRouterStatus();
  if (!isRecord(value)) return { ...defaults, state: "error", error: "Order router payload was not an object" };
  const state = value.state === "error" ? "error" : value.state === "checking" ? "checking" : "ready";
  const conservative = isRecord(value.conservative) ? value.conservative : {};
  return {
    state,
    configured: Boolean(value.configured),
    liveEnabled: Boolean(value.liveEnabled),
    dryRun: value.dryRun !== false,
    liveSwitchEnabled: Boolean(value.liveSwitchEnabled),
    sellExitsEnabled: Boolean(value.sellExitsEnabled),
    allowedSeries: stringOrNull(value.allowedSeries) ?? defaults.allowedSeries,
    maxOrderDollars: numberOrDefault(value.maxOrderDollars, defaults.maxOrderDollars),
    maxExposureDollars: numberOrDefault(value.maxExposureDollars, defaults.maxExposureDollars),
    executionMinEdgeAfterFees: numberOrDefault(value.executionMinEdgeAfterFees, defaults.executionMinEdgeAfterFees),
    conservativeMode: value.conservativeMode === true,
    conservative: {
      minConfidence: numberOrDefault(conservative.minConfidence, defaults.conservative.minConfidence),
      minEdgeAfterFees: numberOrDefault(conservative.minEdgeAfterFees, defaults.conservative.minEdgeAfterFees),
      minSideProbability: numberOrDefault(conservative.minSideProbability, defaults.conservative.minSideProbability),
      maxSpreadCents: numberOrDefault(conservative.maxSpreadCents, defaults.conservative.maxSpreadCents),
      minSecondsToClose: numberOrDefault(conservative.minSecondsToClose, defaults.conservative.minSecondsToClose),
      maxSecondsToClose: numberOrDefault(conservative.maxSecondsToClose, defaults.conservative.maxSecondsToClose),
    },
    error: stringOrNull(value.error),
  };
}

function activationDuration(start: string, end: string) {
  const startMs = Date.parse(start);
  const endMs = Date.parse(end);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return "0m";
  return durationLabelFromMs(endMs - startMs);
}

function durationLabelFromMs(durationMs: number) {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return "0m";
  const minutes = Math.floor(durationMs / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;
  if (hours < 24) return `${hours}h ${restMinutes}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

function activatedCycleCount(start: string, end: string) {
  const startMs = Date.parse(start);
  const endMs = Date.parse(end);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return 1;
  return Math.max(1, Math.ceil((endMs - startMs) / (15 * 60_000)));
}

function activatedFullCycleCount(start: string, end: string) {
  const startMs = Date.parse(start);
  const endMs = Date.parse(end);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return 0;
  return Math.max(0, Math.floor((endMs - startMs) / (15 * 60_000)));
}

function activatedCycleCountForRow(row: { activatedAt: string; deactivatedAt: string | null; cycleCount?: number }, fallbackEnd: string) {
  return row.cycleCount ?? activatedCycleCount(row.activatedAt, row.deactivatedAt ?? fallbackEnd);
}

function activatedFullCycleCountForRow(row: { activatedAt: string; deactivatedAt: string | null; fullCycleCount?: number }, fallbackEnd: string) {
  return row.fullCycleCount ?? activatedFullCycleCount(row.activatedAt, row.deactivatedAt ?? fallbackEnd);
}

function activatedPnlPerCycle(row: { activatedAt: string; deactivatedAt: string | null; liveStats: PaperSummarySnapshot; cycleCount?: number }, fallbackEnd: string) {
  const cycles = activatedCycleCountForRow(row, fallbackEnd);
  return roundDisplayMoney(row.liveStats.totalPnl / cycles);
}

function activatedBatchLabel(row: { displayId: string; sourceRunId: string | null; sourceAlgoId: string }) {
  const fromRun = /^factory-batch-batch-([a-z]+)-/i.exec(row.sourceRunId ?? "")?.[1];
  const fromSource = /^factory-batch-batch-([a-z]+)-/i.exec(row.sourceAlgoId)?.[1];
  const fromDisplay = /^([A-Z]+)-\d{4}$/i.exec(row.displayId)?.[1];
  const batch = fromRun ?? fromSource ?? fromDisplay;
  return batch ? `Batch ${batch.toUpperCase()}` : "Factory batch";
}

function activatedBatchFilterKey(row: { displayId: string; sourceRunId: string | null; sourceAlgoId: string }) {
  const fromRun = /^factory-batch-batch-([a-z]+)-/i.exec(row.sourceRunId ?? "")?.[1];
  const fromSource = /^factory-batch-batch-([a-z]+)-/i.exec(row.sourceAlgoId)?.[1];
  const fromDisplay = /^([A-Z]+)-\d{4}$/i.exec(row.displayId)?.[1];
  const batch = (fromRun ?? fromSource ?? fromDisplay)?.toUpperCase();
  return batch ? `batch-${batch}` : "batch-unknown";
}

function topTraderEligibleBatchCounts(rows: TopTraderRow[]) {
  return activatedBatchFilterOptions(rows)
    .map((option) => ({
      key: option.key,
      label: topTraderBatchCountLabel(option),
      count: option.uniqueAlgoCount,
    }));
}

function topTraderRejectReasonRows(statsRows: TopTraderExecutableStats[]) {
  const keys: TopTraderRejectionKey[] = ["staleRejects", "depthRejects", "gateRejects", "edgeRejects", "priceRejects", "otherRejects"];
  return keys
    .map((key) => ({
      key,
      label: topTraderRejectReasonLabel(key),
      count: statsRows.reduce((total, stats) => total + stats[key], 0),
    }))
    .filter((item) => item.count > 0)
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label));
}

function topTraderRejectReasonLabel(key: TopTraderRejectionKey) {
  if (key === "staleRejects") return "Stale";
  if (key === "depthRejects") return "Depth";
  if (key === "gateRejects") return "Gate";
  if (key === "edgeRejects") return "Edge";
  if (key === "priceRejects") return "Price";
  return "Other";
}

function topTraderBatchCountLabel(option: { key: string; label: string }) {
  const fromLabel = /^Batch\s+([A-Z]+)$/i.exec(option.label)?.[1];
  const fromKey = /^batch-([A-Z]+)$/i.exec(option.key)?.[1];
  return (fromLabel ?? fromKey)?.toUpperCase() ?? option.label;
}

function activatedUniqueAlgoCount(rows: Array<{ displayId: string; sourceAlgoId: string }>) {
  const ids = new Set<string>();
  for (const row of rows) {
    ids.add(row.sourceAlgoId || row.displayId);
  }
  return ids.size;
}

function activatedBatchFilterOptions(rows: Array<{ displayId: string; sourceRunId: string | null; sourceAlgoId: string }>) {
  const counts = new Map<string, { key: string; label: string; sampleCount: number; algoIds: Set<string> }>();
  for (const row of rows) {
    const key = activatedBatchFilterKey(row);
    const label = activatedBatchLabel(row);
    const current = counts.get(key);
    if (current) {
      current.sampleCount += 1;
      current.algoIds.add(row.sourceAlgoId || row.displayId);
    } else {
      counts.set(key, { key, label, sampleCount: 1, algoIds: new Set([row.sourceAlgoId || row.displayId]) });
    }
  }
  return [...counts.values()]
    .map(({ key, label, sampleCount, algoIds }) => ({ key, label, sampleCount, uniqueAlgoCount: algoIds.size }))
    .sort((left, right) => activatedBatchOptionIndex(right) - activatedBatchOptionIndex(left)
      || right.label.localeCompare(left.label));
}

function newestActivatedBatchFilterKey(options: Array<{ key: string; label: string }>) {
  return options.slice()
    .sort((left, right) => activatedBatchOptionIndex(right) - activatedBatchOptionIndex(left)
      || right.label.localeCompare(left.label))[0]?.key ?? "";
}

function activatedBatchOptionIndex(option: { key: string; label: string }) {
  const batch = /Batch\s+([A-Z]+)/i.exec(option.label)?.[1]
    ?? /batch-([A-Z]+)/i.exec(option.key)?.[1];
  return batch ? batchIndexFromName(batch) : -1;
}

function activatedRowIdentityKeys(row: { displayId: string; sourceAlgoId: string }) {
  return [`source:${row.sourceAlgoId}`, `display:${row.displayId}`].filter((key) => !key.endsWith(":"));
}

function activatedRowMatchesActiveSet(row: { displayId: string; sourceAlgoId: string }, activeKeys: Set<string>) {
  return activatedRowIdentityKeys(row).some((key) => activeKeys.has(key));
}

function activatedConfidence(
  row: { activatedAt: string; deactivatedAt: string | null; liveStats: PaperSummarySnapshot; cycleCount?: number },
  fallbackEnd: string,
): {
  label: "PROVEN" | "QUALIFIED" | "BUILDING" | "EARLY SPIKE" | "LOSING" | "NO SAMPLE";
  tone: "info" | "warn" | "good" | "bad" | "neutral";
  rank: number;
  scoreMultiplier: number;
  liveEligible: boolean;
  detail: string;
} {
  const cycles = activatedCycleCountForRow(row, fallbackEnd);
  const closed = row.liveStats.sells;
  const totalResolved = Math.max(1, row.liveStats.wins + row.liveStats.losses);
  const winRate = row.liveStats.wins / totalResolved;
  const roi = row.liveStats.roi ?? 0;
  const pnl = row.liveStats.totalPnl;
  const sample = `${closed} closed / ${cycles} elapsed 15m`;

  if (closed <= 0) {
    return { label: "NO SAMPLE", tone: "neutral", rank: 0, scoreMultiplier: 0, liveEligible: false, detail: `Needs closed trades; ${sample}.` };
  }
  if (pnl <= 0) {
    return { label: "LOSING", tone: "bad", rank: 0, scoreMultiplier: 0.05, liveEligible: false, detail: `Negative P/L; ${sample}.` };
  }
  if (cycles < 2 || closed < 15) {
    return { label: "EARLY SPIKE", tone: "warn", rank: 1, scoreMultiplier: 0.08, liveEligible: false, detail: `Too little evidence; ${sample}.` };
  }
  if (cycles < 3 || closed < 25) {
    return { label: "BUILDING", tone: "warn", rank: 2, scoreMultiplier: 0.22, liveEligible: false, detail: `Needs 3 elapsed 15m windows and 25 closed; ${sample}.` };
  }
  if (cycles >= 6 && closed >= 60 && winRate >= 0.52 && roi > 0) {
    return { label: "PROVEN", tone: "good", rank: 4, scoreMultiplier: 1, liveEligible: true, detail: `${percent(winRate)} win / ${sample}.` };
  }
  if (winRate >= 0.5 && roi > 0) {
    return { label: "QUALIFIED", tone: "info", rank: 3, scoreMultiplier: 0.65, liveEligible: true, detail: `${percent(winRate)} win / ${sample}.` };
  }
  return { label: "BUILDING", tone: "warn", rank: 2, scoreMultiplier: 0.35, liveEligible: false, detail: `Positive but weak sample; ${sample}.` };
}

function activatedConfidenceShortDetail(
  row: { activatedAt: string; deactivatedAt: string | null; liveStats: PaperSummarySnapshot; cycleCount?: number },
  fallbackEnd: string,
) {
  const cycles = activatedCycleCountForRow(row, fallbackEnd);
  const closed = row.liveStats.sells;
  const totalResolved = Math.max(1, row.liveStats.wins + row.liveStats.losses);
  const winRate = row.liveStats.wins / totalResolved;

  if (closed <= 0) return "needs closed trades";
  if (row.liveStats.totalPnl <= 0) return `${closed} closed / losing`;
  if (cycles < 3 || closed < 25) {
    const closedText = closed < 25 ? `${closed}/25 closed` : `${closed} closed`;
    const cycleText = cycles < 3 ? `${cycles}/3 elapsed` : `${cycles} elapsed`;
    return `${closedText} / ${cycleText}`;
  }
  return `${percent(winRate)} win / ${closed} closed`;
}

function activatedRankingScore(row: { activatedAt: string; deactivatedAt: string | null; liveStats: PaperSummarySnapshot; cycleCount?: number }, fallbackEnd: string) {
  const confidence = activatedConfidence(row, fallbackEnd);
  const pnlPerCycle = activatedPnlPerCycle(row, fallbackEnd);
  return confidence.rank * 100_000
    + pnlPerCycle * confidence.scoreMultiplier
    + row.liveStats.totalPnl * 0.01
    + row.liveStats.sells * 0.001;
}

function activatedTrainingSortScore(row: { arenaEntryPolicy: ArenaEntryPolicy }) {
  return factoryArchiveCanTrain(row) ? 1 : 0;
}

function activatedTrainingStatus(row: { arenaEntryPolicy: ArenaEntryPolicy }): {
  label: "TRAINING" | "REPEAT" | "LEGACY";
  tone: "info" | "warn" | "good" | "bad" | "neutral";
  factoryEligible: boolean;
  detail: string;
} {
  if (row.arenaEntryPolicy === "single-entry") {
    return {
      label: "TRAINING",
      tone: "good",
      factoryEligible: true,
      detail: "Single-entry sample; eligible for Factory training.",
    };
  }
  if (row.arenaEntryPolicy === "repeat-entry") {
    return {
      label: "REPEAT",
      tone: "warn",
      factoryEligible: false,
      detail: "Repeat-buy sample; visible only until retested as single-entry.",
    };
  }
  return {
    label: "LEGACY",
    tone: "neutral",
    factoryEligible: false,
    detail: "Old sample without entry-policy proof; skipped by Factory training.",
  };
}

function roundDisplayMoney(value: number) {
  return Number(value.toFixed(2));
}

function roundDisplayRatio(value: number) {
  return Number(value.toFixed(4));
}

function PanelTitle({ title, icon }: { title: string; icon: ReactNode }) {
  return <div className="panel-title">{icon}<h1>{title}</h1></div>;
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "positive" | "negative" }) {
  return (
    <div className="stat">
      <span>{label}</span>
      <strong className={tone ?? ""}>{value}</strong>
    </div>
  );
}

function StatLine({ label, value, tone }: { label: string; value: string; tone?: "positive" | "negative" }) {
  return (
    <div className="stat-line">
      <span>{label}</span>
      <strong className={tone ?? ""}>{value}</strong>
    </div>
  );
}

function chartRangeConfig(range: ChartRangeKey) {
  return chartRangeOptions.find((item) => item.id === range) ?? chartRangeOptions[2];
}

async function fetchCoinbaseCandlesForRange(range: ChartRangeKey) {
  const config = chartRangeConfig(range);
  const end = new Date();
  const start = new Date(end.getTime() - config.durationMs - config.granularitySeconds * 2_000);
  const params = new URLSearchParams({
    granularity: String(config.granularitySeconds),
    start: start.toISOString(),
    end: end.toISOString(),
  });
  const response = await fetch(`${coinbaseRestBase}/products/${coinbaseProductId}/candles?${params.toString()}`, { cache: "no-store" });
  if (!response.ok) throw new Error("Coinbase chart history failed");
  const payload = await response.json() as CoinbaseCandle[];
  return normalizeCoinbaseCandles(payload, 320);
}

function candlesForChartRange(range: ChartRangeKey, historicalCandles: Candle[], liveCandles: Candle[], generatedAt: string) {
  const config = chartRangeConfig(range);
  const endMs = Date.parse(generatedAt);
  const effectiveEndMs = Number.isFinite(endMs) ? endMs : Date.now();
  const cutoff = effectiveEndMs - config.durationMs;
  const merged = mergeCandles(historicalCandles, liveCandles)
    .filter((candle) => {
      const time = Date.parse(candle.time);
      return Number.isFinite(time) && time <= effectiveEndMs + config.granularitySeconds * 1000;
    });
  const inRange = merged.filter((candle) => Date.parse(candle.time) >= cutoff);
  const leadCandle = [...merged].reverse().find((candle) => Date.parse(candle.time) < cutoff);
  const selected = inRange.length < 2 && leadCandle ? [leadCandle, ...inRange] : inRange;
  if (selected.length > 0) return selected.slice(-320);
  return (liveCandles.length ? liveCandles : historicalCandles).slice(-2);
}

function mergeCandles(...groups: Candle[][]) {
  const byTime = new Map<string, Candle>();
  for (const candles of groups) {
    for (const candle of candles) {
      byTime.set(candle.time, candle);
    }
  }
  return [...byTime.values()].sort((left, right) => Date.parse(left.time) - Date.parse(right.time));
}

function chartGeometry(candles: Candle[], targetPrice: number, range: ChartRangeKey) {
  const closeSeries = candles.map((item) => item.close);
  const movingAverage = rollingAverage(closeSeries, 8);
  const volatility = rollingVolatility(closeSeries, 14);
  const volatilityUpper = closeSeries.map((price, index) => price + volatility[index] * 1.7);
  const volatilityLower = closeSeries.map((price, index) => price - volatility[index] * 1.7);
  const min = Math.min(targetPrice, ...candles.map((item) => item.low), ...volatilityLower.filter(Boolean)) - 0.002;
  const max = Math.max(targetPrice, ...candles.map((item) => item.high), ...volatilityUpper.filter(Boolean)) + 0.002;
  const priceY = (price: number) => 278 - ((price - min) / (max - min)) * 240;
  const step = 846 / Math.max(1, candles.length - 1);
  const pointFor = (price: number, index: number) => ({
    x: 26 + index * step,
    y: priceY(price),
  });
  const momentumSeries = closeSeries.map((price, index) => index < 8 ? 0 : price - closeSeries[index - 8]);
  const maxMomentum = Math.max(0.0001, ...momentumSeries.map((value) => Math.abs(value)));
  const momentumPoints = momentumSeries.map((value, index) => ({
    x: 26 + index * step,
    y: 314 - (value / maxMomentum) * 18,
  }));
  const kalshiPoints = closeSeries.map((price, index) => {
    const yesPrice = clamp(0.5 + (price - targetPrice) * 62, 0.08, 0.92);
    return {
      x: 26 + index * step,
      y: 338 - yesPrice * 68,
    };
  });
  const signalPoints = candles.reduce<Array<{ key: string; x: number; y: number; label: "YES" | "NO" }>>((items, candle, index) => {
    if (index === 0) return items;
    const previous = candles[index - 1];
    const crossedUp = previous.close < targetPrice && candle.close >= targetPrice;
    const crossedDown = previous.close >= targetPrice && candle.close < targetPrice;
    if (!crossedUp && !crossedDown) return items;
    return items.concat({
      key: `signal-${candle.time}`,
      x: 26 + index * step,
      y: priceY(candle.close),
      label: crossedUp ? "YES" : "NO",
    });
  }, []).slice(-8);
  const volatilityUpperPoints = volatilityUpper.map(pointFor);
  const volatilityLowerPoints = volatilityLower.map(pointFor);
  const volatilityBandPath = [
    linePath(volatilityUpperPoints),
    linePath([...volatilityLowerPoints].reverse()).replace(/^M/, "L"),
    "Z",
  ].join(" ");
  const finalWindowWidth = clamp(846 * (60_000 / chartRangeConfig(range).durationMs), 8, 846);
  const finalWindowX = 872 - finalWindowWidth;
  return {
    targetY: priceY(targetPrice),
    finalWindowX,
    finalWindowWidth,
    finalWindowLabelX: Math.min(finalWindowX + 12, 792),
    movingAveragePath: linePath(movingAverage.map(pointFor)),
    volatilityUpperPath: linePath(volatilityUpperPoints),
    volatilityLowerPath: linePath(volatilityLowerPoints),
    volatilityBandPath,
    momentumPath: linePath(momentumPoints),
    edgePath: linePath(closeSeries.map((price, index) => pointFor(targetPrice + (price - targetPrice) * 0.52, index))),
    kalshiPath: linePath(kalshiPoints),
    signals: signalPoints,
    grid: Array.from({ length: 6 }, (_, index) => ({
      key: `h-${index}`,
      x1: 26,
      x2: 872,
      y1: 38 + index * 48,
      y2: 38 + index * 48,
    })).concat(Array.from({ length: 7 }, (_, index) => ({
      key: `v-${index}`,
      x1: 26 + index * 141,
      x2: 26 + index * 141,
      y1: 28,
      y2: 278,
    }))),
    candles: candles.map((candle, index) => {
      const x = 26 + index * step;
      return {
        key: candle.time,
        x,
        highY: priceY(candle.high),
        lowY: priceY(candle.low),
        openY: priceY(candle.open),
        closeY: priceY(candle.close),
        up: candle.close >= candle.open,
      };
    }),
    volume: candles.map((candle, index) => ({
      key: `vol-${candle.time}`,
      x: 26 + index * step - 2,
      y: 336 - Math.min(48, candle.volume / 140),
      h: Math.min(48, candle.volume / 140),
      up: candle.close >= candle.open,
    })),
  };
}

function rollingAverage(values: number[], windowSize: number) {
  return values.map((_, index) => {
    const start = Math.max(0, index - windowSize + 1);
    const sample = values.slice(start, index + 1);
    return sample.reduce((sum, value) => sum + value, 0) / sample.length;
  });
}

function rollingVolatility(values: number[], windowSize: number) {
  return values.map((_, index) => {
    const start = Math.max(0, index - windowSize + 1);
    const sample = values.slice(start, index + 1);
    const average = sample.reduce((sum, value) => sum + value, 0) / sample.length;
    const variance = sample.reduce((sum, value) => sum + (value - average) ** 2, 0) / sample.length;
    return Math.sqrt(variance);
  });
}

function linePath(points: Array<{ x: number; y: number }>) {
  return points.map((point, index) => `${index === 0 ? "M" : "L"}${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(" ");
}

function money(value: number, digits = 2) {
  return `$${value.toFixed(digits)}`;
}

function signedMoney(value: number, digits = 2) {
  return `${value >= 0 ? "+" : "-"}$${Math.abs(value).toFixed(digits)}`;
}

function edgeCentsLabel(value: number) {
  return `${(value * 100).toFixed(1)}c`;
}

function centsMoney(value: number) {
  return money(value / 100);
}

function countOrDash(value: number | null) {
  return value === null ? "-" : Intl.NumberFormat("en-US").format(value);
}

function stringOrNull(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : null;
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

function percent(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

function contractPrice(value: number) {
  return `${(value * 100).toFixed(1)}c`;
}

function compactMoney(value: number) {
  return `$${compactNumber(value)}`;
}

function compactNumber(value: number) {
  return Intl.NumberFormat("en-US", {
    maximumFractionDigits: value >= 1_000_000 ? 2 : 0,
    notation: "compact",
  }).format(value);
}

function midpoint(orderBook: RuntimeSnapshot["orderBook"]) {
  const bestYesBid = orderBook.yesBids[0]?.price ?? null;
  const bestYesAsk = orderBook.yesAsks[0]?.price ?? null;
  if (bestYesBid === null || bestYesAsk === null) return null;
  return (bestYesBid + bestYesAsk) / 2;
}

function bookSpread(orderBook: RuntimeSnapshot["orderBook"]) {
  const bestYesBid = orderBook.yesBids[0]?.price ?? null;
  const bestYesAsk = orderBook.yesAsks[0]?.price ?? null;
  if (bestYesBid === null || bestYesAsk === null) return null;
  return Math.max(0, bestYesAsk - bestYesBid);
}

function topBookDepth(orderBook: RuntimeSnapshot["orderBook"]) {
  return [
    ...orderBook.yesBids.slice(0, 3),
    ...orderBook.noBids.slice(0, 3),
  ].reduce((total, level) => total + level.size, 0);
}

function contractsLabel(value: number) {
  return `${compactNumber(value)} ct`;
}

function portfolioModeLabel(portfolio: KalshiPortfolioSummary) {
  if (portfolio.status === "live") return "Read-only live";
  if (portfolio.configured && portfolio.status === "error") return "Credential error";
  if (portfolio.status === "connecting") return "Connecting";
  return "Credentials off";
}

function orderRouterLabel(status: LiveOrderRouterStatus) {
  if (status.state === "checking") return "Checking";
  if (status.dryRun) return status.liveSwitchEnabled ? "Dry run" : "Dry run off";
  if (!status.configured) return "Not configured";
  if (!status.liveSwitchEnabled && status.sellExitsEnabled) return "Exits only";
  if (!status.liveSwitchEnabled) return "Switch off";
  if (status.liveEnabled) return "Live enabled";
  return "Locked";
}

function kalshiBadgeLabel(status: KalshiMarketData["status"]) {
  if (status === "live") return "Kalshi Live";
  if (status === "stale") return "Kalshi Stale";
  if (status === "error") return "Kalshi Error";
  if (status === "not_configured") return "Kalshi Off";
  return "Kalshi Loading";
}

function kalshiStatusLabel(status: KalshiMarketData["status"]) {
  if (status === "live") return "Live";
  if (status === "stale") return "Stale";
  if (status === "error") return "Error";
  if (status === "not_configured") return "Off";
  return "Loading";
}

function feedBadgeLabel(status: MarketFeedStatus) {
  if (status === "live") return "Coinbase Live";
  if (status === "rest") return "Coinbase REST";
  if (status === "stale") return "Feed Stale";
  if (status === "error") return "Feed Error";
  return "Connecting Feed";
}

function feedStatusLabel(status: MarketFeedStatus) {
  if (status === "live") return "Live";
  if (status === "rest") return "REST";
  if (status === "stale") return "Stale";
  if (status === "error") return "Error";
  return "Connecting";
}

function feedAgeLabel(snapshot: RuntimeSnapshot) {
  if (!snapshot.feed.receivedAt) return "waiting";
  const ageSeconds = Math.max(0, Math.round((Date.parse(snapshot.generatedAt) - Date.parse(snapshot.feed.receivedAt)) / 1000));
  return ageSeconds <= 1 ? "live now" : `${ageSeconds}s ago`;
}

function formatLatency(value: number | null) {
  if (value === null) return "-";
  if (value < 1000) return `${Math.round(value)} ms`;
  return `${(value / 1000).toFixed(1)}s`;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function signedPercent(value: number) {
  return `${value >= 0 ? "+" : ""}${percent(value)}`;
}

function nullableSignedPercent(value: number | null) {
  return value === null ? "-" : signedPercent(value);
}

function formatSpread(value: number) {
  return Number.isFinite(value) ? `${(value * 100).toFixed(1)}c` : "-";
}

export default App;
