import type { TradeAction } from "./doge";

export type PaperSide = "YES" | "NO";
export type PaperEventAction = "BUY" | "SELL";
export type PaperResult = "Win" | "Loss" | "-";
export type BuiltInPaperStrategyId = "final60" | "thresholdDistance" | "orderbookScalp" | "momentumFlip" | "noTradeSentinel";
export type GeneratedPaperStrategyId = `generated:${string}`;
export type PaperStrategyId = BuiltInPaperStrategyId | GeneratedPaperStrategyId;
export type PaperAlgoVariantId =
  | "final60Strict"
  | "final60Aggressive"
  | "final60TrueWindow45"
  | "spreadScalpMax4c"
  | "spreadScalpMax2c"
  | "thresholdDistanceFar"
  | "momentum003"
  | "momentumMax6c"
  | "yesProbationStrict";
export type PaperAlgoUpgradeId = "standard" | PaperAlgoVariantId;

export interface PaperStrategyDefinition {
  id: BuiltInPaperStrategyId;
  name: string;
  shortName: string;
  description: string;
  defaultEnabled: boolean;
}

export interface EnabledPaperStrategies {
  final60: boolean;
  thresholdDistance: boolean;
  orderbookScalp: boolean;
  momentumFlip: boolean;
  noTradeSentinel: boolean;
}

export interface ActivePaperAlgoUpgrades {
  final60: PaperAlgoUpgradeId;
  thresholdDistance: PaperAlgoUpgradeId;
  orderbookScalp: PaperAlgoUpgradeId;
  momentumFlip: PaperAlgoUpgradeId;
  noTradeSentinel: PaperAlgoUpgradeId;
}

export interface PaperAlgoUpgradeDefinition {
  id: PaperAlgoVariantId;
  name: string;
  shortName: string;
  baseStrategyId: BuiltInPaperStrategyId;
  description: string;
}

export interface GeneratedPaperAlgo {
  id: GeneratedPaperStrategyId;
  displayId: string;
  sourceAlgoId: string;
  name: string;
  family: string;
  params: Record<string, unknown>;
  enabled: boolean;
  promotedAt: string;
  sourceRunId: string | null;
  sourceMetrics: {
    closed: number;
    wins: number;
    losses: number;
    totalPnl: number;
    totalCost: number;
    roi: number;
    maxDrawdown: number;
  };
}

export interface PaperEngineInput {
  observedAt: string;
  marketLive: boolean;
  ticker: string | null;
  title: string | null;
  targetPrice: number;
  estimate: number;
  spotPrice: number;
  oneMinuteChange: number;
  fairProbability: number;
  action: TradeAction;
  confidence: number;
  edgeAfterFees: number;
  sizeContracts: number;
  secondsToClose: number;
  finalMinuteAverageSoFar?: number | null;
  finalMinuteCompletedSeconds?: number;
  finalMinuteRemainingSeconds?: number;
  requiredRemainingAverageForYes?: number | null;
  settlementCouldStillFlip?: boolean;
  settlementConfidence?: number;
  yesAsk: number | null;
  noAsk: number | null;
  yesBid: number | null;
  noBid: number | null;
  yesAskDepth?: number | null;
  noAskDepth?: number | null;
  yesBidDepth?: number | null;
  noBidDepth?: number | null;
  yesAskDepthDelta?: number | null;
  noAskDepthDelta?: number | null;
  yesBidDepthDelta?: number | null;
  noBidDepthDelta?: number | null;
  yesAskPriceDelta?: number | null;
  noAskPriceDelta?: number | null;
  yesBidPriceDelta?: number | null;
  noBidPriceDelta?: number | null;
}

export interface PaperTrade {
  id: string;
  strategyId: PaperStrategyId;
  strategyName: string;
  marketTicker: string;
  marketTitle: string | null;
  side: PaperSide;
  contracts: number;
  entryPrice: number;
  exitPrice: number | null;
  targetPrice: number;
  openedAt: string;
  closedAt: string | null;
  status: "open" | "closed";
  result: PaperResult;
  pnl: number | null;
  feesPaid: number;
  entryEstimate: number;
  lastEstimate: number;
  reason: string;
  entryContext: PaperTradeContext;
  exitContext: PaperTradeContext | null;
  bestExitPrice?: number | null;
}

export interface PaperEvent {
  id: string;
  time: string;
  action: PaperEventAction;
  strategyId: PaperStrategyId;
  strategyName: string;
  marketTicker: string;
  side: PaperSide;
  contracts: number;
  price: number;
  status: "open" | "closed";
  result: PaperResult;
  pnl: number | null;
  reason: string;
  context: PaperTradeContext;
}

export interface PaperTradeContext {
  observedAt: string;
  side: PaperSide;
  targetPrice: number;
  estimate: number;
  spotPrice: number;
  oneMinuteChange: number;
  oneMinuteMovePercent: number;
  distanceFromTarget: number;
  fairProbability: number;
  edgeAfterFees: number;
  confidence: number;
  secondsToClose: number;
  yesAsk: number | null;
  noAsk: number | null;
  yesBid: number | null;
  noBid: number | null;
  selectedAsk: number | null;
  selectedBid: number | null;
  selectedSpread: number | null;
  yesSpread: number | null;
  noSpread: number | null;
}

export interface PaperState {
  trades: PaperTrade[];
  events: PaperEvent[];
}

export interface PaperSummary {
  buys: number;
  sells: number;
  open: number;
  wins: number;
  losses: number;
  totalPnl: number;
}

export interface PaperRiskLimits {
  startingBalance: number;
  maxCostPerTrade: number;
  stakeMode?: "signal" | "max-cost";
  executionMode?: "optimistic" | "executable";
  feeRate?: number;
  maxEntrySpread?: number;
  minEdgeAfterFees?: number;
  maxDepthShare?: number;
  minExitDepthContracts?: number;
  maxEntriesPerMarket?: number;
  allowMultipleOpenEntriesPerMarket?: boolean;
  accountScope?: "global" | "strategy";
  suspendNewEntries?: boolean;
  blockReentryAfterLoss?: boolean;
}

export interface PaperSignalPreview {
  strategyId: PaperStrategyId;
  strategyName: string;
  action: TradeAction;
  side: PaperSide | null;
  confidence: number;
  edgeAfterFees: number;
  sizeContracts: number;
  fairProbability: number;
  reason: string;
  selectedAsk: number | null;
  selectedBid: number | null;
  selectedSpread: number | null;
}

interface StrategySignal {
  strategyId: PaperStrategyId;
  strategyName: string;
  action: TradeAction;
  confidence: number;
  edgeAfterFees: number;
  sizeContracts: number;
  fairProbability: number;
  reason: string;
  exitRules?: {
    takeProfit?: number;
    stopLoss?: number;
    trailingStop?: number;
    trailAfterProfit?: number;
    minHoldSeconds?: number;
    maxHoldSeconds?: number;
    exitBeforeClose?: number;
    exitOnMomentumFlip?: boolean;
    momentumExitMovePercent?: number;
  };
}

export const paperStorageKey = "dogeedge.paperTrading.v2";
export const legacyPaperStorageKey = "dogeedge.paperTrading.v1";
export const paperStrategyStorageKey = "dogeedge.paperStrategies.v1";
export const paperAlgoUpgradeStorageKey = "dogeedge.paperAlgoUpgrades.v1";
export const generatedPaperAlgoStorageKey = "dogeedge.generatedPaperAlgos.v1";
const paperHistoryLimit = 50_000;

export const activePaperRules = {
  version: "2026-05-31-learning-pass-1",
  final60MaxSecondsToClose: 60,
  thresholdMinDistanceFromTarget: 0.0002,
  orderbookScalpMaxSpread: 0.02,
  momentumMaxSpread: 0.06,
  yesProbation: {
    minEdgeAfterFees: 0.18,
    minConfidence: 80,
    maxSpread: 0.02,
  },
};

export const activePaperRuleDescriptions = [
  "Final-60 opens only inside the final 60 seconds.",
  "Threshold Distance requires DOGE to be at least 0.00020 away from the target.",
  "Orderbook Spread Scalp requires the selected side spread to be 2c or tighter.",
  "Momentum Flip will not open when the selected side spread is above 6c.",
  "YES paper buys are on probation and require at least +18% edge, 80 confidence, and 2c max spread.",
];

export const paperStrategyDefinitions: PaperStrategyDefinition[] = [
  {
    id: "final60",
    name: "Final-60 Lock",
    shortName: "Final-60",
    description: "Uses the existing final-minute settlement model and buys the side with positive post-cost edge.",
    defaultEnabled: true,
  },
  {
    id: "thresholdDistance",
    name: "Threshold Distance",
    shortName: "Distance",
    description: "Buys the side matching the current estimate when DOGE is far enough from the target.",
    defaultEnabled: true,
  },
  {
    id: "orderbookScalp",
    name: "Orderbook Spread Scalp",
    shortName: "Scalp",
    description: "Only trades when the top-of-book spread is tight enough to test edge capture.",
    defaultEnabled: true,
  },
  {
    id: "momentumFlip",
    name: "Momentum Flip",
    shortName: "Momentum",
    description: "Tests short-term DOGE direction against YES/NO prices using the one-minute spot move.",
    defaultEnabled: true,
  },
  {
    id: "noTradeSentinel",
    name: "No-Trade Sentinel",
    shortName: "Sentinel",
    description: "Guard strategy that stays flat; useful as a no-action baseline.",
    defaultEnabled: false,
  },
];

export const paperAlgoUpgradeDefinitions: PaperAlgoUpgradeDefinition[] = [
  {
    id: "final60Strict",
    name: "Final-60 Strict",
    shortName: "F60 Strict",
    baseStrategyId: "final60",
    description: "Requires stronger edge, higher confidence, and the final 60 seconds.",
  },
  {
    id: "final60Aggressive",
    name: "Final-60 Aggressive",
    shortName: "F60 Aggro",
    baseStrategyId: "final60",
    description: "Accepts smaller positive edge to test whether more entries improve total P/L.",
  },
  {
    id: "final60TrueWindow45",
    name: "Final-60 <= 45s",
    shortName: "F60 45s",
    baseStrategyId: "final60",
    description: "Only tests Final-60 entries during the last 45 seconds.",
  },
  {
    id: "spreadScalpMax4c",
    name: "Spread Scalp <= 4c",
    shortName: "Scalp 4c",
    baseStrategyId: "orderbookScalp",
    description: "Only tests orderbook scalps when selected top-of-book spread is 4c or tighter.",
  },
  {
    id: "spreadScalpMax2c",
    name: "Spread Scalp <= 2c",
    shortName: "Scalp 2c",
    baseStrategyId: "orderbookScalp",
    description: "Tests the tighter scalp rule suggested by paper results.",
  },
  {
    id: "thresholdDistanceFar",
    name: "Threshold >= 0.00020",
    shortName: "Dist 0.00020",
    baseStrategyId: "thresholdDistance",
    description: "Only enters when DOGE is at least 0.00020 away from the target.",
  },
  {
    id: "momentum003",
    name: "Momentum >= 0.03%",
    shortName: "Mom 0.03%",
    baseStrategyId: "momentumFlip",
    description: "Only tests momentum when the one-minute DOGE move is at least 0.03%.",
  },
  {
    id: "momentumMax6c",
    name: "Momentum <= 6c spread",
    shortName: "Mom 6c",
    baseStrategyId: "momentumFlip",
    description: "Tests Momentum with the wide-spread loss filter applied.",
  },
  {
    id: "yesProbationStrict",
    name: "YES Probation Strict",
    shortName: "YES Strict",
    baseStrategyId: "thresholdDistance",
    description: "Keeps testing rare YES entries only under strict edge, confidence, and spread rules.",
  },
];

export const defaultPaperStrategies: EnabledPaperStrategies = {
  final60: true,
  thresholdDistance: true,
  orderbookScalp: true,
  momentumFlip: true,
  noTradeSentinel: false,
};

export const defaultPaperAlgoUpgrades: ActivePaperAlgoUpgrades = {
  final60: "standard",
  thresholdDistance: "standard",
  orderbookScalp: "standard",
  momentumFlip: "standard",
  noTradeSentinel: "standard",
};

export const emptyPaperState: PaperState = {
  trades: [],
  events: [],
};

export function advancePaperStrategies(
  current: PaperState,
  input: PaperEngineInput,
  enabled: EnabledPaperStrategies,
  upgrades: ActivePaperAlgoUpgrades = defaultPaperAlgoUpgrades,
  generatedAlgos: GeneratedPaperAlgo[] = [],
  riskLimits?: PaperRiskLimits,
): PaperState {
  const normalizedUpgrades = normalizePaperAlgoUpgrades(upgrades);
  const builtInStrategies = strategySignals(input, normalizedUpgrades)
    .map((signal) => ({ signal, allowOpen: enabled[signal.strategyId as BuiltInPaperStrategyId] }));
  const generatedStrategies = normalizeGeneratedPaperAlgos(generatedAlgos)
    .map((algo) => ({ signal: generatedPaperAlgoSignal(input, algo), allowOpen: algo.enabled }));
  return [...builtInStrategies, ...generatedStrategies]
    .reduce((state, item) => advancePaperStrategyState(state, input, item.signal, item.allowOpen, riskLimits), normalizePaperState(current));
}

export function advancePaperState(current: PaperState, input: PaperEngineInput): PaperState {
  return advancePaperStrategyState(normalizePaperState(current), input, final60Signal(input), true);
}

export function paperSummary(state: PaperState, strategyId?: PaperStrategyId): PaperSummary {
  const normalized = normalizePaperState(state);
  const trades = strategyId ? normalized.trades.filter((trade) => trade.strategyId === strategyId) : normalized.trades;
  const events = strategyId ? normalized.events.filter((event) => event.strategyId === strategyId) : normalized.events;
  const closed = trades.filter((trade) => trade.status === "closed" && trade.pnl !== null);
  return {
    buys: events.filter((event) => event.action === "BUY").length,
    sells: events.filter((event) => event.action === "SELL").length,
    open: trades.filter((trade) => trade.status === "open").length,
    wins: closed.filter((trade) => (trade.pnl ?? 0) > 0).length,
    losses: closed.filter((trade) => (trade.pnl ?? 0) < 0).length,
    totalPnl: roundMoney(closed.reduce((total, trade) => total + (trade.pnl ?? 0), 0)),
  };
}

export function normalizePaperState(value: unknown): PaperState {
  if (!isRecord(value)) return emptyPaperState;
  const trades = Array.isArray(value.trades)
    ? uniqueById(value.trades.map(normalizeTrade).filter((item): item is PaperTrade => item !== null))
    : [];
  const events = Array.isArray(value.events)
    ? uniqueById(value.events.map(normalizeEvent).filter((item): item is PaperEvent => item !== null))
    : [];
  return {
    trades: trades.slice(0, paperHistoryLimit),
    events: events.slice(0, paperHistoryLimit),
  };
}

export function normalizeEnabledStrategies(value: unknown): EnabledPaperStrategies {
  if (!isRecord(value)) return { ...defaultPaperStrategies };
  return {
    final60: booleanOrDefault(value.final60, defaultPaperStrategies.final60),
    thresholdDistance: booleanOrDefault(value.thresholdDistance, defaultPaperStrategies.thresholdDistance),
    orderbookScalp: booleanOrDefault(value.orderbookScalp, defaultPaperStrategies.orderbookScalp),
    momentumFlip: booleanOrDefault(value.momentumFlip, defaultPaperStrategies.momentumFlip),
    noTradeSentinel: booleanOrDefault(value.noTradeSentinel, defaultPaperStrategies.noTradeSentinel),
  };
}

export function normalizePaperAlgoUpgrades(value: unknown): ActivePaperAlgoUpgrades {
  if (!isRecord(value)) return { ...defaultPaperAlgoUpgrades };
  return {
    final60: normalizePaperAlgoUpgradeId(value.final60, "final60"),
    thresholdDistance: normalizePaperAlgoUpgradeId(value.thresholdDistance, "thresholdDistance"),
    orderbookScalp: normalizePaperAlgoUpgradeId(value.orderbookScalp, "orderbookScalp"),
    momentumFlip: normalizePaperAlgoUpgradeId(value.momentumFlip, "momentumFlip"),
    noTradeSentinel: normalizePaperAlgoUpgradeId(value.noTradeSentinel, "noTradeSentinel"),
  };
}

export function normalizeGeneratedPaperAlgos(value: unknown): GeneratedPaperAlgo[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const algos: GeneratedPaperAlgo[] = [];
  for (const item of value) {
    const algo = normalizeGeneratedPaperAlgo(item);
    if (!algo || !algo.enabled || seen.has(algo.id)) continue;
    seen.add(algo.id);
    algos.push(algo);
  }
  return algos.slice(0, 3_000);
}

export function generatedPaperAlgoSupportsFamily(family: string) {
  return [
    "sweep-model",
    "sweep-distance",
    "sweep-scalp",
    "sweep-momentum",
    "sweep-momentum-trail",
    "sweep-fade-model",
    "sweep-fade-momentum",
    "sweep-target-revert",
    "sweep-managed-scalp",
    "sweep-cheap-longshot",
    "sweep-late-favorite",
    "sweep-late-lock",
    "sweep-kalshi-lag-lock",
    "sweep-liquidity-imbalance",
    "sweep-order-flow-pressure",
    "paper",
    "paper-variant",
    "shadow",
  ].includes(family);
}

export function clearPaperState(): PaperState {
  return emptyPaperState;
}

export function generatedPaperAlgoSignalPreview(input: PaperEngineInput, algo: GeneratedPaperAlgo): PaperSignalPreview {
  const signal = generatedPaperAlgoSignal(input, algo);
  const side = sideFromAction(signal.action);
  return {
    strategyId: signal.strategyId,
    strategyName: signal.strategyName,
    action: signal.action,
    side,
    confidence: signal.confidence,
    edgeAfterFees: signal.edgeAfterFees,
    sizeContracts: signal.sizeContracts,
    fairProbability: signal.fairProbability,
    reason: signal.reason,
    selectedAsk: side === null ? null : askForSide(side, input),
    selectedBid: side === null ? null : bidForSide(side, input, signal),
    selectedSpread: side === null ? null : spreadForSide(side, input),
  };
}

function advancePaperStrategyState(current: PaperState, input: PaperEngineInput, signal: StrategySignal, allowOpen: boolean, riskLimits?: PaperRiskLimits): PaperState {
  const state = current;
  if (!input.marketLive || !input.ticker) return state;

  let changed = false;
  let trades = state.trades.map((trade) => {
    if (trade.status !== "open" || trade.strategyId !== signal.strategyId || trade.marketTicker !== input.ticker) return trade;
    const bestExitPrice = updatedBestExitPrice(trade, input, signal);
    if (trade.lastEstimate === input.estimate && bestExitPrice === (trade.bestExitPrice ?? null)) return trade;
    changed = true;
    return { ...trade, lastEstimate: input.estimate, bestExitPrice };
  });
  let events = [...state.events];

  const openForCurrentMarket = trades.find((trade) => trade.status === "open" && trade.strategyId === signal.strategyId && trade.marketTicker === input.ticker) ?? null;
  if (openForCurrentMarket) {
    const oppositeSide = sideFromAction(signal.action);
    const ageMs = Date.parse(input.observedAt) - Date.parse(openForCurrentMarket.openedAt);
    const exitDecision = managedExitDecision(openForCurrentMarket, input, signal, riskLimits);
    const shouldExitFlip = oppositeSide !== null
      && oppositeSide !== openForCurrentMarket.side
      && signal.edgeAfterFees > 0
      && ageMs >= 10_000;
    if (exitDecision) {
      const closed = closeTradePortion(openForCurrentMarket, exitDecision.contracts, input.observedAt, exitDecision.price, exitDecision.reason, tradeContextFromInput(input, signal, openForCurrentMarket.side), exitDecision.feePaid);
      trades = replaceTradePortion(trades, openForCurrentMarket, closed);
      events = addEvent(events, sellEvent(closed, input.observedAt, exitDecision.reason));
      changed = true;
    } else if (shouldExitFlip) {
      const flipExit = executableExitDecision(openForCurrentMarket, input, signal, `${signal.strategyName} flipped to the opposite side.`, riskLimits);
      if (flipExit) {
        const closed = closeTradePortion(openForCurrentMarket, flipExit.contracts, input.observedAt, flipExit.price, flipExit.reason, tradeContextFromInput(input, signal, openForCurrentMarket.side), flipExit.feePaid);
        trades = replaceTradePortion(trades, openForCurrentMarket, closed);
        events = addEvent(events, sellEvent(closed, input.observedAt, "Model flip sell."));
        changed = true;
      }
    }
  }

  for (const trade of trades.filter((item) => item.status === "open" && item.strategyId === signal.strategyId)) {
    const marketChanged = trade.marketTicker !== input.ticker;
    const atClose = trade.marketTicker === input.ticker && input.secondsToClose <= 2;
    if (!marketChanged && !atClose) continue;
    const closed = settleTrade(trade, input, marketChanged ? "Contract rolled to a new ticker." : "Contract reached the close window.");
    trades = replaceTrade(trades, closed);
    events = addEvent(events, sellEvent(closed, input.observedAt, closed.reason));
    changed = true;
  }

  const side = sideFromAction(signal.action);
  const hasCurrentOpen = trades.some((trade) => trade.status === "open" && trade.strategyId === signal.strategyId && trade.marketTicker === input.ticker);
  const openEntryAllowed = !hasCurrentOpen || Boolean(riskLimits?.allowMultipleOpenEntriesPerMarket);
  const entriesOnCurrentMarket = trades.filter((trade) => trade.strategyId === signal.strategyId && trade.marketTicker === input.ticker).length;
  const blockedByLoss = Boolean(riskLimits?.blockReentryAfterLoss && trades.some((trade) => trade.strategyId === signal.strategyId && trade.marketTicker === input.ticker && trade.status === "closed" && (trade.pnl ?? 0) < 0));
  const blockedByEntryCount = riskLimits?.maxEntriesPerMarket !== undefined && entriesOnCurrentMarket >= riskLimits.maxEntriesPerMarket;
  const entriesSuspended = Boolean(riskLimits?.suspendNewEntries);
  if (allowOpen && !entriesSuspended && side && openEntryAllowed && !blockedByLoss && !blockedByEntryCount && signal.edgeAfterFees > 0 && input.secondsToClose > 8 && executionEntryAllowed(signal, side, input, riskLimits)) {
    const ask = askForSide(side, input);
    if (ask !== null && ask > 0 && ask < 1) {
      const contracts = contractsForTrade(signal, side, ask, input, { trades, events }, riskLimits);
      if (contracts > 0) {
        const trade = openTrade(input, signal, side, ask, contracts, riskLimits);
        trades = [trade, ...trades].slice(0, paperHistoryLimit);
        events = addEvent(events, buyEvent(trade));
        changed = true;
      }
    }
  }

  if (!changed) return state;
  return {
    trades: trades.slice(0, paperHistoryLimit),
    events: events.slice(0, paperHistoryLimit),
  };
}

function strategySignals(input: PaperEngineInput, upgrades: ActivePaperAlgoUpgrades): StrategySignal[] {
  return paperStrategyDefinitions.map((strategy) => strategySignalForSlot(input, strategy.id, upgrades[strategy.id]));
}

function strategySignalForSlot(input: PaperEngineInput, strategyId: BuiltInPaperStrategyId, upgradeId: PaperAlgoUpgradeId): StrategySignal {
  const normalizedUpgrade = normalizePaperAlgoUpgradeId(upgradeId, strategyId);
  if (normalizedUpgrade !== "standard") return upgradedSignal(input, normalizedUpgrade);

  if (strategyId === "thresholdDistance") return thresholdDistanceSignal(input);
  if (strategyId === "orderbookScalp") return orderbookScalpSignal(input);
  if (strategyId === "momentumFlip") return momentumFlipSignal(input);
  if (strategyId === "noTradeSentinel") return noTradeSentinelSignal();
  return final60Signal(input);
}

function final60Signal(input: PaperEngineInput): StrategySignal {
  const side = sideFromAction(input.action);
  const selectedSpread = side === null ? Number.POSITIVE_INFINITY : spreadForSide(side, input);
  const insideFinalWindow = input.secondsToClose <= activePaperRules.final60MaxSecondsToClose;
  const yesAllowed = yesProbationAllows(side, input.edgeAfterFees, input.confidence, selectedSpread);
  const action = input.action !== "skip" && insideFinalWindow && yesAllowed ? input.action : "skip";
  return {
    strategyId: "final60",
    strategyName: "Final-60 Lock",
    action,
    confidence: input.confidence,
    edgeAfterFees: input.edgeAfterFees,
    sizeContracts: input.sizeContracts,
    fairProbability: input.fairProbability,
    reason: final60Reason(input, insideFinalWindow, yesAllowed),
  };
}

function thresholdDistanceSignal(input: PaperEngineInput): StrategySignal {
  const distance = input.estimate - input.targetPrice;
  const side: PaperSide = distance >= 0 ? "YES" : "NO";
  const ask = askForSide(side, input);
  const fairProbability = side === "YES"
    ? clamp(0.5 + distance / 0.0012, 0.01, 0.99)
    : clamp(0.5 - distance / 0.0012, 0.01, 0.99);
  const confidence = clamp(Math.round(45 + Math.min(1, Math.abs(distance) / 0.00022) * 50), 0, 100);
  const edgeAfterFees = ask === null ? -1 : roundRatio(fairProbability - ask - 0.014);
  const spread = spreadForSide(side, input);
  const clearsDistance = Math.abs(distance) >= activePaperRules.thresholdMinDistanceFromTarget;
  const yesAllowed = yesProbationAllows(side, edgeAfterFees, confidence, spread);
  return {
    strategyId: "thresholdDistance",
    strategyName: "Threshold Distance",
    action: clearsDistance && edgeAfterFees > 0 && yesAllowed ? actionForSide(side) : "skip",
    confidence,
    edgeAfterFees,
    sizeContracts: confidence >= 82 ? 5 : confidence >= 68 ? 3 : 1,
    fairProbability: roundRatio(fairProbability),
    reason: yesAllowed
      ? clearsDistance ? `${side} estimate is at least 0.00020 from target.` : "Estimate is too close to target."
      : "YES distance entries are on probation until strict edge/spread rules pass.",
  };
}

function orderbookScalpSignal(input: PaperEngineInput): StrategySignal {
  const yesSpread = spreadForSide("YES", input);
  const noSpread = spreadForSide("NO", input);
  const yesEdge = input.yesAsk === null ? -1 : input.fairProbability - input.yesAsk - 0.006;
  const noEdge = input.noAsk === null ? -1 : (1 - input.fairProbability) - input.noAsk - 0.006;
  const side: PaperSide = yesEdge >= noEdge ? "YES" : "NO";
  const spread = side === "YES" ? yesSpread : noSpread;
  const bestEdge = side === "YES" ? yesEdge : noEdge;
  const fairProbability = side === "YES" ? input.fairProbability : 1 - input.fairProbability;
  const confidence = clamp(Math.round(52 + Math.max(0, bestEdge) * 120 - Math.max(0, spread - 0.01) * 180), 0, 92);
  const tightEnough = spread <= activePaperRules.orderbookScalpMaxSpread;
  const yesAllowed = yesProbationAllows(side, bestEdge, confidence, spread);
  return {
    strategyId: "orderbookScalp",
    strategyName: "Orderbook Spread Scalp",
    action: tightEnough && bestEdge > 0 && yesAllowed ? actionForSide(side) : "skip",
    confidence,
    edgeAfterFees: roundRatio(bestEdge),
    sizeContracts: spread <= 0.01 ? 3 : 1,
    fairProbability: roundRatio(fairProbability),
    reason: yesAllowed
      ? tightEnough ? `${side} top-of-book spread is 2c or tighter for paper scalp testing.` : "Top-of-book spread is above the 2c scalp limit."
      : "YES scalp entries are on probation until strict edge/spread rules pass.",
  };
}

function momentumFlipSignal(input: PaperEngineInput): StrategySignal {
  const momentum = input.oneMinuteChange;
  const side: PaperSide = momentum >= 0 ? "YES" : "NO";
  const ask = askForSide(side, input);
  const momentumBoost = clamp(Math.abs(momentum) / 0.00035, 0, 1) * 0.12;
  const baseFair = side === "YES" ? input.fairProbability : 1 - input.fairProbability;
  const fairProbability = clamp(baseFair + momentumBoost, 0.01, 0.99);
  const edgeAfterFees = ask === null ? -1 : roundRatio(fairProbability - ask - 0.018);
  const confidence = clamp(Math.round(48 + momentumBoost * 280), 0, 86);
  const hasMomentum = Math.abs(momentum) >= 0.000015;
  const spread = spreadForSide(side, input);
  const spreadAllowed = spread <= activePaperRules.momentumMaxSpread;
  const yesAllowed = yesProbationAllows(side, edgeAfterFees, confidence, spread);
  return {
    strategyId: "momentumFlip",
    strategyName: "Momentum Flip",
    action: hasMomentum && spreadAllowed && edgeAfterFees > 0 && yesAllowed ? actionForSide(side) : "skip",
    confidence,
    edgeAfterFees,
    sizeContracts: confidence >= 78 ? 3 : 1,
    fairProbability: roundRatio(fairProbability),
    reason: yesAllowed
      ? hasMomentum
        ? spreadAllowed ? `${side} has momentum support with spread at or below 6c.` : "Momentum spread is above the 6c loss filter."
        : "One-minute DOGE move is too small."
      : "YES momentum entries are on probation until strict edge/spread rules pass.",
  };
}

function noTradeSentinelSignal(): StrategySignal {
  return {
    strategyId: "noTradeSentinel",
    strategyName: "No-Trade Sentinel",
    action: "skip",
    confidence: 100,
    edgeAfterFees: 0,
    sizeContracts: 0,
    fairProbability: 0.5,
    reason: "Guard-only baseline; this strategy intentionally stays flat.",
  };
}

function generatedPaperAlgoSignal(input: PaperEngineInput, algo: GeneratedPaperAlgo): StrategySignal {
  if (!generatedPaperAlgoSupportsFamily(algo.family)) {
    return signalFromGenerated(algo, null, -1, 0, 0, 0.5, "Generated family is not available in the paper runner yet.");
  }

  if (algo.family === "sweep-model") return generatedModelSignal(input, algo);
  if (algo.family === "sweep-distance") return generatedDistanceSignal(input, algo);
  if (algo.family === "sweep-scalp") return generatedScalpSignal(input, algo);
  if (algo.family === "sweep-momentum") return generatedMomentumSignal(input, algo);
  if (algo.family === "sweep-momentum-trail") return generatedMomentumTrailSignal(input, algo);
  if (algo.family === "sweep-fade-model") return generatedWeakModelFadeSignal(input, algo);
  if (algo.family === "sweep-fade-momentum") return generatedMomentumFadeSignal(input, algo);
  if (algo.family === "sweep-target-revert") return generatedTargetReversionSignal(input, algo);
  if (algo.family === "sweep-managed-scalp") return generatedManagedScalpSignal(input, algo);
  if (algo.family === "sweep-cheap-longshot") return generatedCheapLongshotSignal(input, algo);
  if (algo.family === "sweep-late-favorite") return generatedLateFavoriteSignal(input, algo);
  if (algo.family === "sweep-late-lock") return generatedLateLockSignal(input, algo);
  if (algo.family === "sweep-kalshi-lag-lock") return generatedKalshiLagLockSignal(input, algo);
  if (algo.family === "sweep-liquidity-imbalance") return generatedLiquidityImbalanceSignal(input, algo);
  if (algo.family === "sweep-order-flow-pressure") return generatedOrderFlowPressureSignal(input, algo);
  if (algo.family === "paper" || algo.family === "paper-variant" || algo.family === "shadow") return generatedLegacyCandidateSignal(input, algo);
  return signalFromGenerated(algo, null, -1, 0, 0, 0.5, "Generated family is not available in the paper runner yet.");
}

function generatedLegacyCandidateSignal(input: PaperEngineInput, algo: GeneratedPaperAlgo): StrategySignal {
  if (algo.sourceAlgoId === "final60-lock-v1") return signalFromExistingAsGenerated(algo, final60Signal(input));
  if (algo.sourceAlgoId === "threshold-distance-020") return signalFromExistingAsGenerated(algo, thresholdDistanceSignal(input));
  if (algo.sourceAlgoId === "spread-scalp-2c") return signalFromExistingAsGenerated(algo, upgradedSignal(input, "spreadScalpMax2c"));
  if (algo.sourceAlgoId === "final60-strict") return signalFromExistingAsGenerated(algo, upgradedSignal(input, "final60Strict"));
  if (algo.sourceAlgoId === "final60-aggressive") return signalFromExistingAsGenerated(algo, upgradedSignal(input, "final60Aggressive"));
  if (algo.sourceAlgoId === "spread-scalp-4c") return signalFromExistingAsGenerated(algo, upgradedSignal(input, "spreadScalpMax4c"));
  if (algo.sourceAlgoId === "momentum-003") return signalFromExistingAsGenerated(algo, upgradedSignal(input, "momentum003"));
  if (algo.sourceAlgoId === "momentum-max-6c") return signalFromExistingAsGenerated(algo, upgradedSignal(input, "momentumMax6c"));
  if (algo.sourceAlgoId === "yes-probation-strict") return signalFromExistingAsGenerated(algo, upgradedSignal(input, "yesProbationStrict"));
  return signalFromGenerated(algo, null, -1, 0, 0, 0.5, "Legacy generated candidate is not mapped in the generated runner yet.");
}

function signalFromExistingAsGenerated(algo: GeneratedPaperAlgo, signal: StrategySignal): StrategySignal {
  return signalFromGenerated(
    algo,
    sideFromAction(signal.action),
    signal.edgeAfterFees,
    signal.confidence,
    signal.sizeContracts,
    signal.fairProbability,
    signal.reason,
    signal.exitRules,
  );
}

function generatedModelSignal(input: PaperEngineInput, algo: GeneratedPaperAlgo): StrategySignal {
  const maxSecondsToClose = numberParam(algo.params, "maxSecondsToClose", 60);
  const minEdge = numberParam(algo.params, "minEdge", 0);
  const minConfidence = numberParam(algo.params, "minConfidence", 50);
  const maxSpread = numberParam(algo.params, "maxSpread", 0.04);
  const yesMode = stringParam(algo.params, "yesMode", "strict");
  const side = sideFromAction(input.action);
  const spread = side === null ? Number.POSITIVE_INFINITY : spreadForSide(side, input);
  const allowed = side !== null
    && input.secondsToClose <= maxSecondsToClose
    && input.edgeAfterFees >= minEdge
    && input.confidence >= minConfidence
    && spread <= maxSpread
    && yesGateAllows(yesMode, side, input.edgeAfterFees, input.confidence, spread);
  return signalFromGenerated(algo, allowed ? side : null, input.edgeAfterFees, input.confidence, contractsForConfidence(input.confidence), input.fairProbability, "Generated model-window sweep algo.");
}

function generatedDistanceSignal(input: PaperEngineInput, algo: GeneratedPaperAlgo): StrategySignal {
  const minDistance = numberParam(algo.params, "minDistance", 0.0002);
  const feeBuffer = numberParam(algo.params, "feeBuffer", 0.014);
  const maxSpread = numberParam(algo.params, "maxSpread", 0.04);
  const minConfidence = numberParam(algo.params, "minConfidence", 45);
  const yesMode = stringParam(algo.params, "yesMode", "strict");
  const distance = input.estimate - input.targetPrice;
  const side: PaperSide = distance >= 0 ? "YES" : "NO";
  const ask = askForSide(side, input);
  const fairProbability = side === "YES"
    ? clamp(0.5 + distance / 0.0012, 0.01, 0.99)
    : clamp(0.5 - distance / 0.0012, 0.01, 0.99);
  const edge = ask === null ? -1 : roundRatio(fairProbability - ask - feeBuffer);
  const spread = spreadForSide(side, input);
  const confidence = clamp(Math.round(45 + Math.min(1, Math.abs(distance) / 0.00022) * 50), 0, 100);
  const allowed = Math.abs(distance) >= minDistance
    && edge > 0
    && confidence >= minConfidence
    && spread <= maxSpread
    && yesGateAllows(yesMode, side, edge, confidence, spread);
  return signalFromGenerated(algo, allowed ? side : null, edge, confidence, contractsForConfidence(confidence), fairProbability, "Generated distance sweep algo.");
}

function generatedScalpSignal(input: PaperEngineInput, algo: GeneratedPaperAlgo): StrategySignal {
  const maxSpread = numberParam(algo.params, "maxSpread", 0.04);
  const feeBuffer = numberParam(algo.params, "feeBuffer", 0.006);
  const minEdge = numberParam(algo.params, "minEdge", 0);
  const sideMode = stringParam(algo.params, "sideMode", "best");
  const yesMode = stringParam(algo.params, "yesMode", "strict");
  const picked = pickBestSide(input, feeBuffer, sideMode);
  const allowed = picked.spread <= maxSpread
    && picked.edge >= minEdge
    && yesGateAllows(yesMode, picked.side, picked.edge, picked.confidence, picked.spread);
  return signalFromGenerated(algo, allowed ? picked.side : null, picked.edge, picked.confidence, picked.spread <= 0.02 ? 3 : 1, picked.fairProbability, "Generated spread-scalp sweep algo.");
}

function generatedMomentumSignal(input: PaperEngineInput, algo: GeneratedPaperAlgo): StrategySignal {
  const minMovePercent = numberParam(algo.params, "minMovePercent", 0.0003);
  const maxSpread = numberParam(algo.params, "maxSpread", 0.06);
  const feeBuffer = numberParam(algo.params, "feeBuffer", 0.018);
  const boostMultiplier = numberParam(algo.params, "boostMultiplier", 140);
  const yesMode = stringParam(algo.params, "yesMode", "strict");
  const movePercent = input.spotPrice > 0 ? input.oneMinuteChange / input.spotPrice : 0;
  const side: PaperSide = movePercent >= 0 ? "YES" : "NO";
  const ask = askForSide(side, input);
  const spread = spreadForSide(side, input);
  const baseFair = side === "YES" ? input.fairProbability : 1 - input.fairProbability;
  const fairProbability = clamp(baseFair + Math.min(0.12, Math.abs(movePercent) * boostMultiplier), 0.01, 0.99);
  const edge = ask === null ? -1 : roundRatio(fairProbability - ask - feeBuffer);
  const confidence = clamp(Math.round(48 + Math.min(1, Math.abs(movePercent) / 0.001) * 42 + Math.max(0, edge) * 40), 0, 94);
  const allowed = Math.abs(movePercent) >= minMovePercent
    && spread <= maxSpread
    && edge > 0
    && yesGateAllows(yesMode, side, edge, confidence, spread);
  return signalFromGenerated(algo, allowed ? side : null, edge, confidence, confidence >= 78 ? 3 : 1, fairProbability, "Generated momentum sweep algo.");
}

function generatedMomentumTrailSignal(input: PaperEngineInput, algo: GeneratedPaperAlgo): StrategySignal {
  const minMovePercent = numberParam(algo.params, "minMovePercent", 0.0002);
  const maxSpread = numberParam(algo.params, "maxSpread", 0.03);
  const feeBuffer = numberParam(algo.params, "feeBuffer", 0.018);
  const boostMultiplier = numberParam(algo.params, "boostMultiplier", 150);
  const minEdge = numberParam(algo.params, "minEdge", 0.04);
  const minSecondsToClose = numberParam(algo.params, "minSecondsToClose", 45);
  const yesMode = stringParam(algo.params, "yesMode", "loose");
  const movePercent = input.spotPrice > 0 ? input.oneMinuteChange / input.spotPrice : 0;
  const side: PaperSide = movePercent >= 0 ? "YES" : "NO";
  const ask = askForSide(side, input);
  const spread = spreadForSide(side, input);
  const baseFair = side === "YES" ? input.fairProbability : 1 - input.fairProbability;
  const fairProbability = clamp(baseFair + Math.min(0.16, Math.abs(movePercent) * boostMultiplier), 0.01, 0.99);
  const edge = ask === null ? -1 : roundRatio(fairProbability - ask - feeBuffer);
  const confidence = clamp(Math.round(50 + Math.min(1, Math.abs(movePercent) / 0.001) * 36 + Math.max(0, edge) * 70 - Math.max(0, spread - 0.02) * 90), 0, 96);
  const allowed = Math.abs(movePercent) >= minMovePercent
    && input.secondsToClose >= minSecondsToClose
    && spread <= maxSpread
    && edge >= minEdge
    && yesGateAllows(yesMode, side, edge, confidence, spread);
  return signalFromGenerated(
    algo,
    allowed ? side : null,
    edge,
    confidence,
    confidence >= 84 ? 4 : confidence >= 72 ? 2 : 1,
    fairProbability,
    "Generated momentum-trail scalp algo.",
    {
      takeProfit: numberParam(algo.params, "takeProfit", 0.06),
      stopLoss: numberParam(algo.params, "stopLoss", 0.04),
      trailingStop: numberParam(algo.params, "trailingStop", 0.02),
      trailAfterProfit: numberParam(algo.params, "trailAfterProfit", 0.025),
      minHoldSeconds: numberParam(algo.params, "minHoldSeconds", 6),
      maxHoldSeconds: numberParam(algo.params, "maxHoldSeconds", 180),
      exitBeforeClose: numberParam(algo.params, "exitBeforeClose", 30),
      exitOnMomentumFlip: Boolean(algo.params.exitOnMomentumFlip ?? true),
      momentumExitMovePercent: numberParam(algo.params, "momentumExitMovePercent", 0.00008),
    },
  );
}

function generatedWeakModelFadeSignal(input: PaperEngineInput, algo: GeneratedPaperAlgo): StrategySignal {
  const maxSecondsToClose = numberParam(algo.params, "maxSecondsToClose", 120);
  const maxModelEdge = numberParam(algo.params, "maxModelEdge", 0.05);
  const maxConfidence = numberParam(algo.params, "maxConfidence", 50);
  const maxSpread = numberParam(algo.params, "maxSpread", 0.04);
  const yesMode = stringParam(algo.params, "yesMode", "loose");
  const modelSide = sideFromAction(input.action);
  const side = modelSide === null ? null : oppositeSide(modelSide);
  const ask = side === null ? null : askForSide(side, input);
  const spread = side === null ? Number.POSITIVE_INFINITY : spreadForSide(side, input);
  const fairProbability = side === "YES" ? input.fairProbability : 1 - input.fairProbability;
  const edge = ask === null ? -1 : roundRatio(fairProbability - ask - 0.014);
  const confidence = clamp(72 - input.confidence + Math.max(0, -input.edgeAfterFees) * 100, 0, 88);
  const allowed = side !== null
    && input.secondsToClose <= maxSecondsToClose
    && input.edgeAfterFees <= maxModelEdge
    && input.confidence <= maxConfidence
    && spread <= maxSpread
    && edge > -0.02
    && yesGateAllows(yesMode, side, edge, confidence, spread);
  return signalFromGenerated(algo, allowed ? side : null, edge, confidence, confidence >= 70 ? 2 : 1, fairProbability, "Generated weak-model fade algo.");
}

function generatedMomentumFadeSignal(input: PaperEngineInput, algo: GeneratedPaperAlgo): StrategySignal {
  const minMovePercent = numberParam(algo.params, "minMovePercent", 0.0002);
  const maxSpread = numberParam(algo.params, "maxSpread", 0.06);
  const feeBuffer = numberParam(algo.params, "feeBuffer", 0.014);
  const boostMultiplier = numberParam(algo.params, "boostMultiplier", 80);
  const yesMode = stringParam(algo.params, "yesMode", "loose");
  const movePercent = input.spotPrice > 0 ? input.oneMinuteChange / input.spotPrice : 0;
  const side: PaperSide = movePercent >= 0 ? "NO" : "YES";
  const ask = askForSide(side, input);
  const spread = spreadForSide(side, input);
  const baseFair = side === "YES" ? input.fairProbability : 1 - input.fairProbability;
  const fairProbability = clamp(baseFair + Math.min(0.1, Math.abs(movePercent) * boostMultiplier), 0.01, 0.99);
  const edge = ask === null ? -1 : roundRatio(fairProbability - ask - feeBuffer);
  const confidence = clamp(Math.round(46 + Math.min(1, Math.abs(movePercent) / 0.001) * 38 + Math.max(0, edge) * 45), 0, 90);
  const allowed = Math.abs(movePercent) >= minMovePercent
    && spread <= maxSpread
    && edge > -0.02
    && yesGateAllows(yesMode, side, edge, confidence, spread);
  return signalFromGenerated(algo, allowed ? side : null, edge, confidence, confidence >= 78 ? 3 : 1, fairProbability, "Generated momentum-fade sweep algo.");
}

function generatedTargetReversionSignal(input: PaperEngineInput, algo: GeneratedPaperAlgo): StrategySignal {
  const minDistance = numberParam(algo.params, "minDistance", 0);
  const maxDistance = numberParam(algo.params, "maxDistance", 0.0001);
  const maxSpread = numberParam(algo.params, "maxSpread", 0.04);
  const feeBuffer = numberParam(algo.params, "feeBuffer", 0.014);
  const yesMode = stringParam(algo.params, "yesMode", "loose");
  const distance = input.estimate - input.targetPrice;
  const side: PaperSide = distance >= 0 ? "NO" : "YES";
  const ask = askForSide(side, input);
  const spread = spreadForSide(side, input);
  const distanceAbs = Math.abs(distance);
  const reversionBoost = clamp((maxDistance - distanceAbs) / Math.max(0.00001, maxDistance) * 0.12, 0, 0.12);
  const baseFair = side === "YES" ? input.fairProbability : 1 - input.fairProbability;
  const fairProbability = clamp(baseFair + reversionBoost, 0.01, 0.99);
  const edge = ask === null ? -1 : roundRatio(fairProbability - ask - feeBuffer);
  const confidence = clamp(Math.round(50 + reversionBoost * 260 + Math.max(0, edge) * 60), 0, 92);
  const allowed = distanceAbs >= minDistance
    && distanceAbs <= maxDistance
    && spread <= maxSpread
    && edge > -0.02
    && yesGateAllows(yesMode, side, edge, confidence, spread);
  return signalFromGenerated(algo, allowed ? side : null, edge, confidence, confidence >= 78 ? 2 : 1, fairProbability, "Generated target-reversion sweep algo.");
}

function generatedManagedScalpSignal(input: PaperEngineInput, algo: GeneratedPaperAlgo): StrategySignal {
  const maxSpread = numberParam(algo.params, "maxSpread", 0.04);
  const feeBuffer = numberParam(algo.params, "feeBuffer", 0.014);
  const minEdge = numberParam(algo.params, "minEdge", 0.02);
  const takeProfit = numberParam(algo.params, "takeProfit", 0.04);
  const stopLoss = numberParam(algo.params, "stopLoss", 0.04);
  const maxHoldSeconds = numberParam(algo.params, "maxHoldSeconds", 180);
  const yesMode = stringParam(algo.params, "yesMode", "loose");
  const picked = pickBestSide(input, feeBuffer, "best");
  const allowed = picked.spread <= maxSpread
    && picked.edge >= minEdge
    && yesGateAllows(yesMode, picked.side, picked.edge, picked.confidence, picked.spread);
  return signalFromGenerated(algo, allowed ? picked.side : null, picked.edge, picked.confidence, picked.spread <= 0.02 ? 3 : 1, picked.fairProbability, "Generated managed-scalp sweep algo.", {
    takeProfit,
    stopLoss,
    maxHoldSeconds,
  });
}

function generatedCheapLongshotSignal(input: PaperEngineInput, algo: GeneratedPaperAlgo): StrategySignal {
  const maxAsk = numberParam(algo.params, "maxAsk", 0.18);
  const minEdge = numberParam(algo.params, "minEdge", 0.02);
  const minSecondsToClose = numberParam(algo.params, "minSecondsToClose", 120);
  const maxSpread = numberParam(algo.params, "maxSpread", 0.04);
  const sideMode = stringParam(algo.params, "sideMode", "best");
  const picked = pickBestSide(input, 0.014, sideMode);
  const allowed = picked.ask !== null
    && picked.ask <= maxAsk
    && picked.edge >= minEdge
    && picked.spread <= maxSpread
    && input.secondsToClose >= minSecondsToClose;
  return signalFromGenerated(algo, allowed ? picked.side : null, picked.edge, picked.confidence, 1, picked.fairProbability, "Generated cheap-longshot sweep algo.");
}

function generatedLateFavoriteSignal(input: PaperEngineInput, algo: GeneratedPaperAlgo): StrategySignal {
  const maxSecondsToClose = numberParam(algo.params, "maxSecondsToClose", 120);
  const minFairProbability = numberParam(algo.params, "minFairProbability", 0.72);
  const maxAsk = numberParam(algo.params, "maxAsk", 0.85);
  const maxSpread = numberParam(algo.params, "maxSpread", 0.08);
  const sideMode = stringParam(algo.params, "sideMode", "fair");
  const modelSide = sideFromAction(input.action);
  const fairSide: PaperSide = input.fairProbability >= 0.5 ? "YES" : "NO";
  const side = sideMode === "model" && modelSide ? modelSide : fairSide;
  const picked = sideCandidate(side, input, 0.01);
  const allowed = input.secondsToClose <= maxSecondsToClose
    && picked.fairProbability >= minFairProbability
    && picked.ask !== null
    && picked.ask <= maxAsk
    && picked.edge > 0
    && picked.spread <= maxSpread
    && yesGateAllows("loose", picked.side, picked.edge, picked.confidence, picked.spread);
  return signalFromGenerated(algo, allowed ? picked.side : null, picked.edge, picked.confidence, picked.confidence >= 82 ? 3 : 1, picked.fairProbability, "Generated late-favorite sweep algo.");
}

function generatedLateLockSignal(input: PaperEngineInput, algo: GeneratedPaperAlgo): StrategySignal {
  const maxSecondsToClose = numberParam(algo.params, "maxSecondsToClose", 60);
  const minSecondsToClose = numberParam(algo.params, "minSecondsToClose", 10);
  const minDistance = numberParam(algo.params, "minDistance", 0.00018);
  const minRequiredGap = numberParam(algo.params, "minRequiredGap", 0.00012);
  const minCompletedSeconds = numberParam(algo.params, "minCompletedSeconds", 8);
  const minSettlementConfidence = numberParam(algo.params, "minSettlementConfidence", 74);
  const requireConvergence = Boolean(algo.params.requireConvergence ?? false);
  const volatilityMultiple = numberParam(algo.params, "volatilityMultiple", 1.4);
  const minFairProbability = numberParam(algo.params, "minFairProbability", 0.9);
  const maxAsk = numberParam(algo.params, "maxAsk", 0.9);
  const maxSpread = numberParam(algo.params, "maxSpread", 0.02);
  const minEdge = numberParam(algo.params, "minEdge", 0.08);
  const minConfidence = numberParam(algo.params, "minConfidence", 84);
  const minBidDepth = numberParam(algo.params, "minBidDepth", 1);
  const minAskDepth = numberParam(algo.params, "minAskDepth", 1);
  const feeBuffer = numberParam(algo.params, "feeBuffer", 0.01);
  const distance = input.estimate - input.targetPrice;
  const side: PaperSide = distance >= 0 ? "YES" : "NO";
  const ask = askForSide(side, input);
  const spread = spreadForSide(side, input);
  const bidDepth = bidDepthForSide(side, input);
  const askDepth = askDepthForSide(side, input);
  const distanceAbs = Math.abs(distance);
  const secondsRemaining = Math.max(0, input.secondsToClose);
  const expectedMoveRemaining = Math.abs(input.oneMinuteChange) * secondsRemaining / 60;
  const adverseMovePerMinute = side === "YES" ? Math.max(0, -input.oneMinuteChange) : Math.max(0, input.oneMinuteChange);
  const expectedAdverseMove = adverseMovePerMinute * secondsRemaining / 60;
  const noReturnFloor = Math.max(minDistance, expectedMoveRemaining * 0.4 + expectedAdverseMove);
  const noReturnRatio = noReturnFloor > 0 ? distanceAbs / noReturnFloor : 0;
  const convergence = settlementConvergenceForSide(side, input, minRequiredGap);
  const baseFairProbability = side === "YES" ? input.fairProbability : 1 - input.fairProbability;
  const distanceBoost = Math.min(0.08, Math.max(0, distanceAbs - minDistance) / Math.max(0.000001, minDistance * 4) * 0.08);
  const noReturnBoost = Math.min(0.08, Math.max(0, noReturnRatio - 1) * 0.035);
  const convergenceBoost = convergence.available && convergence.sideMatches
    ? Math.min(0.13, Math.max(0, convergence.lockRatio - 1) * 0.035 + (convergence.couldStillFlip ? 0 : 0.07) + convergence.confidence / 1000)
    : 0;
  const fairProbability = clamp(baseFairProbability + distanceBoost + noReturnBoost + convergenceBoost, 0.01, 0.99);
  const edge = ask === null ? -1 : roundRatio(fairProbability - ask - feeBuffer);
  const confidence = clamp(Math.round(
    48
    + Math.min(1, distanceAbs / Math.max(0.000001, minDistance * 2.5)) * 16
    + Math.min(1, noReturnRatio / Math.max(1, volatilityMultiple * 1.4)) * 22
    + (convergence.available && convergence.sideMatches ? Math.min(18, convergence.confidence * 0.18) : 0)
    + (convergence.locked ? 10 : 0)
    + Math.max(0, edge) * 110
    + Math.min(8, Math.min(bidDepth, askDepth))
    - Math.max(0, spread - 0.01) * 220,
  ), 0, 99);
  const noReturnLocked = distanceAbs >= minDistance
    && noReturnRatio >= volatilityMultiple
    && distanceAbs >= expectedAdverseMove * volatilityMultiple + minDistance * 0.25;
  const convergenceLocked = convergence.available
    && convergence.sideMatches
    && convergence.completedSeconds >= minCompletedSeconds
    && convergence.confidence >= minSettlementConfidence
    && (convergence.locked || convergence.lockRatio >= volatilityMultiple);
  const lockAllowed = convergence.available && requireConvergence ? convergenceLocked : convergenceLocked || noReturnLocked;
  const allowed = input.secondsToClose <= maxSecondsToClose
    && input.secondsToClose >= minSecondsToClose
    && lockAllowed
    && fairProbability >= minFairProbability
    && ask !== null
    && ask <= maxAsk
    && spread <= maxSpread
    && edge >= minEdge
    && confidence >= minConfidence
    && bidDepth >= minBidDepth
    && askDepth >= minAskDepth
    && yesGateAllows("loose", side, edge, confidence, spread);
  return signalFromGenerated(
    algo,
    allowed ? side : null,
    edge,
    confidence,
    confidence >= 94 ? 3 : confidence >= 88 ? 2 : 1,
    fairProbability,
    convergence.available
      ? `Generated late-lock convergence algo: ${side} required gap ${convergence.requiredGap.toFixed(5)} with ${convergence.completedSeconds}s sampled.`
      : `Generated late-lock final-window algo: ${side} is ${distanceAbs.toFixed(5)} from the line with ${input.secondsToClose}s left.`,
  );
}

function generatedKalshiLagLockSignal(input: PaperEngineInput, algo: GeneratedPaperAlgo): StrategySignal {
  const maxSecondsToClose = numberParam(algo.params, "maxSecondsToClose", 120);
  const minSecondsToClose = numberParam(algo.params, "minSecondsToClose", 8);
  const minMovePercent = numberParam(algo.params, "minMovePercent", 0.00008);
  const minRequiredGap = numberParam(algo.params, "minRequiredGap", 0.0001);
  const minSettlementConfidence = numberParam(algo.params, "minSettlementConfidence", 68);
  const minFairProbability = numberParam(algo.params, "minFairProbability", 0.82);
  const maxAsk = numberParam(algo.params, "maxAsk", 0.94);
  const maxSpread = numberParam(algo.params, "maxSpread", 0.02);
  const minEdge = numberParam(algo.params, "minEdge", 0.08);
  const feeBuffer = numberParam(algo.params, "feeBuffer", 0.012);
  const maxCatchupDelta = numberParam(algo.params, "maxCatchupDelta", 0.015);
  const minBidDepth = numberParam(algo.params, "minBidDepth", 1);
  const minAskDepth = numberParam(algo.params, "minAskDepth", 1);
  const requireFinalWindow = Boolean(algo.params.requireFinalWindow ?? false);
  const modelSide: PaperSide = input.estimate >= input.targetPrice ? "YES" : "NO";
  const momentumSide: PaperSide = input.oneMinuteChange >= 0 ? "YES" : "NO";
  const convergence = settlementConvergenceForSide(modelSide, input, minRequiredGap);
  const side = convergence.available && convergence.sideMatches && convergence.confidence >= minSettlementConfidence
    ? modelSide
    : momentumSide;
  const selectedConvergence = settlementConvergenceForSide(side, input, minRequiredGap);
  const ask = askForSide(side, input);
  const spread = spreadForSide(side, input);
  const bidDepth = bidDepthForSide(side, input);
  const askDepth = askDepthForSide(side, input);
  const directionalMove = directionalMovePercent(side, input);
  const marketCatchup = priceDeltaForSide(side, input);
  const baseFairProbability = side === "YES" ? input.fairProbability : 1 - input.fairProbability;
  const convergenceBoost = selectedConvergence.available && selectedConvergence.sideMatches
    ? Math.min(0.14, selectedConvergence.confidence / 900 + Math.max(0, selectedConvergence.lockRatio - 1) * 0.035 + (selectedConvergence.couldStillFlip ? 0 : 0.06))
    : 0;
  const momentumBoost = Math.min(0.08, Math.max(0, directionalMove - minMovePercent) * 180);
  const fairProbability = clamp(baseFairProbability + convergenceBoost + momentumBoost, 0.01, 0.99);
  const edge = ask === null ? -1 : roundRatio(fairProbability - ask - feeBuffer);
  const finalWindowAllowed = !requireFinalWindow || selectedConvergence.available || input.secondsToClose <= 60;
  const lagNotCaughtUp = marketCatchup <= maxCatchupDelta;
  const directionalAllowed = selectedConvergence.available && selectedConvergence.sideMatches
    ? selectedConvergence.confidence >= minSettlementConfidence && (selectedConvergence.locked || selectedConvergence.lockRatio >= 1)
    : directionalMove >= minMovePercent;
  const confidence = clamp(Math.round(
    40
    + Math.max(0, edge) * 140
    + Math.min(1, Math.max(0, directionalMove) / Math.max(0.00001, minMovePercent * 3)) * 14
    + (selectedConvergence.available && selectedConvergence.sideMatches ? selectedConvergence.confidence * 0.22 : 0)
    + (lagNotCaughtUp ? 8 : -10)
    + Math.min(8, Math.min(bidDepth, askDepth))
    - Math.max(0, spread - 0.01) * 180,
  ), 0, 99);
  const allowed = input.secondsToClose <= maxSecondsToClose
    && input.secondsToClose >= minSecondsToClose
    && finalWindowAllowed
    && directionalAllowed
    && lagNotCaughtUp
    && fairProbability >= minFairProbability
    && ask !== null
    && ask <= maxAsk
    && spread <= maxSpread
    && edge >= minEdge
    && confidence >= numberParam(algo.params, "minConfidence", 78)
    && bidDepth >= minBidDepth
    && askDepth >= minAskDepth
    && yesGateAllows("loose", side, edge, confidence, spread);
  return signalFromGenerated(
    algo,
    allowed ? side : null,
    edge,
    confidence,
    confidence >= 92 ? 3 : confidence >= 84 ? 2 : 1,
    fairProbability,
    selectedConvergence.available
      ? `Generated Kalshi-lag lock: ${side} convergence is ahead of contract price.`
      : `Generated Kalshi-lag momentum: ${side} DOGE moved before the contract caught up.`,
    {
      takeProfit: numberParam(algo.params, "takeProfit", 0.035),
      stopLoss: numberParam(algo.params, "stopLoss", 0.035),
      trailingStop: numberParam(algo.params, "trailingStop", 0.012),
      trailAfterProfit: numberParam(algo.params, "trailAfterProfit", 0.018),
      minHoldSeconds: numberParam(algo.params, "minHoldSeconds", 0),
      maxHoldSeconds: numberParam(algo.params, "maxHoldSeconds", 90),
      exitBeforeClose: numberParam(algo.params, "exitBeforeClose", 8),
      exitOnMomentumFlip: Boolean(algo.params.exitOnMomentumFlip ?? true),
      momentumExitMovePercent: numberParam(algo.params, "momentumExitMovePercent", 0.00005),
    },
  );
}

function generatedLiquidityImbalanceSignal(input: PaperEngineInput, algo: GeneratedPaperAlgo): StrategySignal {
  const maxSpread = numberParam(algo.params, "maxSpread", 0.08);
  const minBidDepth = numberParam(algo.params, "minBidDepth", 1);
  const minImbalance = numberParam(algo.params, "minImbalance", 0.25);
  const minEdge = numberParam(algo.params, "minEdge", 0);
  const yesMode = stringParam(algo.params, "yesMode", "loose");
  const yes = sideCandidate("YES", input, 0.014);
  const no = sideCandidate("NO", input, 0.014);
  const yesImbalance = depthImbalanceForSide("YES", input);
  const noImbalance = depthImbalanceForSide("NO", input);
  const picked = yesImbalance >= noImbalance ? yes : no;
  const imbalance = picked.side === "YES" ? yesImbalance : noImbalance;
  const depth = bidDepthForSide(picked.side, input);
  const allowed = picked.ask !== null
    && picked.spread <= maxSpread
    && depth >= minBidDepth
    && imbalance >= minImbalance
    && picked.edge >= minEdge
    && yesGateAllows(yesMode, picked.side, picked.edge, picked.confidence, picked.spread);
  return signalFromGenerated(algo, allowed ? picked.side : null, picked.edge, picked.confidence, depth >= 5 ? 3 : 1, picked.fairProbability, "Generated liquidity-imbalance sweep algo.");
}

function generatedOrderFlowPressureSignal(input: PaperEngineInput, algo: GeneratedPaperAlgo): StrategySignal {
  const maxSpread = numberParam(algo.params, "maxSpread", 0.03);
  const minPressure = numberParam(algo.params, "minPressure", 0.22);
  const minEdge = numberParam(algo.params, "minEdge", 0.04);
  const feeBuffer = numberParam(algo.params, "feeBuffer", 0.014);
  const minBidDepth = numberParam(algo.params, "minBidDepth", 2);
  const minAskDepth = numberParam(algo.params, "minAskDepth", 1);
  const minSecondsToClose = numberParam(algo.params, "minSecondsToClose", 30);
  const minMovePercent = numberParam(algo.params, "minMovePercent", 0);
  const sideMode = stringParam(algo.params, "sideMode", "hybrid");
  const yesMode = stringParam(algo.params, "yesMode", "loose");
  const requireMomentumConfirm = Boolean(algo.params.requireMomentumConfirm ?? false);
  const yes = orderFlowPressureCandidate("YES", input, feeBuffer);
  const no = orderFlowPressureCandidate("NO", input, feeBuffer);
  const picked = pickOrderFlowPressureSide(yes, no, sideMode);
  const directionalMove = directionalMovePercent(picked.side, input);
  const momentumAllowed = requireMomentumConfirm
    ? directionalMove >= Math.max(0, minMovePercent)
    : minMovePercent <= 0 || directionalMove >= -minMovePercent;
  const allowed = picked.ask !== null
    && input.secondsToClose >= minSecondsToClose
    && picked.spread <= maxSpread
    && picked.bidDepth >= minBidDepth
    && picked.askDepth >= minAskDepth
    && picked.pressure >= minPressure
    && picked.edge >= minEdge
    && momentumAllowed
    && yesGateAllows(yesMode, picked.side, picked.edge, picked.confidence, picked.spread);
  return signalFromGenerated(
    algo,
    allowed ? picked.side : null,
    picked.edge,
    picked.confidence,
    picked.bidDepth >= 8 && picked.askDepth >= 4 ? 3 : picked.bidDepth >= 4 ? 2 : 1,
    picked.fairProbability,
    `Generated order-flow pressure scalp: ${picked.side} pressure ${percentText(picked.pressure)}.`,
    {
      takeProfit: numberParam(algo.params, "takeProfit", 0.05),
      stopLoss: numberParam(algo.params, "stopLoss", 0.04),
      trailingStop: numberParam(algo.params, "trailingStop", 0.018),
      trailAfterProfit: numberParam(algo.params, "trailAfterProfit", 0.025),
      minHoldSeconds: numberParam(algo.params, "minHoldSeconds", 4),
      maxHoldSeconds: numberParam(algo.params, "maxHoldSeconds", 150),
      exitBeforeClose: numberParam(algo.params, "exitBeforeClose", 20),
      exitOnMomentumFlip: Boolean(algo.params.exitOnMomentumFlip ?? true),
      momentumExitMovePercent: numberParam(algo.params, "momentumExitMovePercent", 0.00006),
    },
  );
}

function upgradedSignal(input: PaperEngineInput, upgradeId: PaperAlgoVariantId): StrategySignal {
  const definition = paperAlgoUpgradeDefinitionForId(upgradeId);

  if (upgradeId === "final60Strict") {
    const side = sideFromAction(input.action);
    const spread = side === null ? Number.POSITIVE_INFINITY : spreadForSide(side, input);
    const allowed = side !== null
      && input.secondsToClose <= 60
      && input.edgeAfterFees >= 0.07
      && input.confidence >= 70
      && yesProbationAllows(side, input.edgeAfterFees, input.confidence, spread);
    return signalFromUpgrade(definition, allowed ? side : null, input.edgeAfterFees, input.confidence, input.confidence >= 85 ? 4 : 2, input.fairProbability, "Strict final-minute edge and confidence filter.");
  }

  if (upgradeId === "final60Aggressive") {
    const side = sideFromAction(input.action);
    const spread = side === null ? Number.POSITIVE_INFINITY : spreadForSide(side, input);
    const allowed = side !== null
      && input.edgeAfterFees >= 0.025
      && input.confidence >= 45
      && yesProbationAllows(side, input.edgeAfterFees, input.confidence, spread);
    return signalFromUpgrade(definition, allowed ? side : null, input.edgeAfterFees, input.confidence, input.confidence >= 75 ? 3 : 1, input.fairProbability, "Aggressive positive-edge entry filter.");
  }

  if (upgradeId === "final60TrueWindow45") {
    const side = sideFromAction(input.action);
    const spread = side === null ? Number.POSITIVE_INFINITY : spreadForSide(side, input);
    const allowed = side !== null
      && input.secondsToClose <= 45
      && input.edgeAfterFees >= 0.04
      && input.confidence >= 55
      && yesProbationAllows(side, input.edgeAfterFees, input.confidence, spread);
    return signalFromUpgrade(definition, allowed ? side : null, input.edgeAfterFees, input.confidence, input.confidence >= 80 ? 3 : 1, input.fairProbability, "True final-window test with 45 seconds or less remaining.");
  }

  if (upgradeId === "spreadScalpMax4c" || upgradeId === "spreadScalpMax2c") {
    const maxSpread = upgradeId === "spreadScalpMax4c" ? 0.04 : activePaperRules.orderbookScalpMaxSpread;
    const yesEdge = input.yesAsk === null ? -1 : input.fairProbability - input.yesAsk - 0.006;
    const noEdge = input.noAsk === null ? -1 : (1 - input.fairProbability) - input.noAsk - 0.006;
    const side: PaperSide = yesEdge >= noEdge ? "YES" : "NO";
    const spread = spreadForSide(side, input);
    const edge = side === "YES" ? yesEdge : noEdge;
    const confidence = clamp(Math.round((upgradeId === "spreadScalpMax2c" ? 58 : 55) + Math.max(0, edge) * (upgradeId === "spreadScalpMax2c" ? 135 : 130)), 0, upgradeId === "spreadScalpMax2c" ? 94 : 92);
    const yesAllowed = upgradeId === "spreadScalpMax4c" || yesProbationAllows(side, edge, confidence, spread);
    return signalFromUpgrade(
      definition,
      spread <= maxSpread && edge > 0 && yesAllowed ? side : null,
      edge,
      confidence,
      spread <= 0.01 ? 3 : 1,
      side === "YES" ? input.fairProbability : 1 - input.fairProbability,
      `Paper variant scalp with a hard ${(maxSpread * 100).toFixed(0)}c spread cap.`,
    );
  }

  if (upgradeId === "thresholdDistanceFar") {
    const distance = input.estimate - input.targetPrice;
    const side: PaperSide = distance >= 0 ? "YES" : "NO";
    const ask = askForSide(side, input);
    const fairProbability = side === "YES"
      ? clamp(0.5 + distance / 0.0012, 0.01, 0.99)
      : clamp(0.5 - distance / 0.0012, 0.01, 0.99);
    const edge = ask === null ? -1 : roundRatio(fairProbability - ask - 0.014);
    const confidence = clamp(Math.round(45 + Math.min(1, Math.abs(distance) / 0.00022) * 50), 0, 100);
    const spread = spreadForSide(side, input);
    const allowed = Math.abs(distance) >= activePaperRules.thresholdMinDistanceFromTarget
      && edge > 0
      && yesProbationAllows(side, edge, confidence, spread);
    return signalFromUpgrade(definition, allowed ? side : null, edge, confidence, confidence >= 82 ? 5 : confidence >= 68 ? 3 : 1, fairProbability, "Distance variant requiring at least 0.00020 from the target.");
  }

  if (upgradeId === "momentumMax6c") {
    const momentum = input.oneMinuteChange;
    const side: PaperSide = momentum >= 0 ? "YES" : "NO";
    const ask = askForSide(side, input);
    const spread = spreadForSide(side, input);
    const momentumBoost = clamp(Math.abs(momentum) / 0.00035, 0, 1) * 0.12;
    const baseFair = side === "YES" ? input.fairProbability : 1 - input.fairProbability;
    const fairProbability = clamp(baseFair + momentumBoost, 0.01, 0.99);
    const edge = ask === null ? -1 : roundRatio(fairProbability - ask - 0.018);
    const confidence = clamp(Math.round(48 + momentumBoost * 280), 0, 86);
    const allowed = Math.abs(momentum) >= 0.000015
      && spread <= activePaperRules.momentumMaxSpread
      && edge > 0
      && yesProbationAllows(side, edge, confidence, spread);
    return signalFromUpgrade(definition, allowed ? side : null, edge, confidence, confidence >= 78 ? 3 : 1, fairProbability, "Momentum variant with a 6c max selected spread.");
  }

  if (upgradeId === "yesProbationStrict") {
    const side: PaperSide = "YES";
    const ask = input.yesAsk;
    const spread = spreadForSide(side, input);
    const distance = input.estimate - input.targetPrice;
    const fairProbability = clamp(Math.max(input.fairProbability, 0.5 + distance / 0.0012), 0.01, 0.99);
    const edge = ask === null ? -1 : roundRatio(fairProbability - ask - 0.014);
    const confidence = clamp(Math.round(50 + Math.max(0, edge) * 180 + Math.max(0, distance) / 0.0002 * 18), 0, 96);
    const allowed = distance > 0
      && edge >= activePaperRules.yesProbation.minEdgeAfterFees
      && confidence >= activePaperRules.yesProbation.minConfidence
      && spread <= activePaperRules.yesProbation.maxSpread;
    return signalFromUpgrade(definition, allowed ? side : null, edge, confidence, 1, fairProbability, "Strict YES-only recovery test with high edge, high confidence, and tight spread.");
  }

  const movePercent = input.spotPrice > 0 ? input.oneMinuteChange / input.spotPrice : 0;
  const side: PaperSide = movePercent >= 0 ? "YES" : "NO";
  const ask = askForSide(side, input);
  const baseFair = side === "YES" ? input.fairProbability : 1 - input.fairProbability;
  const fairProbability = clamp(baseFair + Math.min(0.1, Math.abs(movePercent) * 180), 0.01, 0.99);
  const edge = ask === null ? -1 : roundRatio(fairProbability - ask - 0.018);
  const confidence = clamp(Math.round(52 + Math.min(1, Math.abs(movePercent) / 0.001) * 34), 0, 88);
  const allowed = Math.abs(movePercent) >= 0.0003 && edge > 0;
  return signalFromUpgrade(definition, allowed ? side : null, edge, confidence, Math.abs(movePercent) >= 0.0006 ? 3 : 1, fairProbability, "Momentum requires at least a 0.03% one-minute move.");
}

function signalFromUpgrade(
  definition: PaperAlgoUpgradeDefinition,
  side: PaperSide | null,
  edgeAfterFees: number,
  confidence: number,
  sizeContracts: number,
  fairProbability: number,
  reason: string,
): StrategySignal {
  return {
    strategyId: definition.baseStrategyId,
    strategyName: definition.name,
    action: side === null ? "skip" : actionForSide(side),
    confidence,
    edgeAfterFees: roundRatio(edgeAfterFees),
    sizeContracts,
    fairProbability: roundRatio(fairProbability),
    reason,
  };
}

function signalFromGenerated(
  algo: GeneratedPaperAlgo,
  side: PaperSide | null,
  edgeAfterFees: number,
  confidence: number,
  sizeContracts: number,
  fairProbability: number,
  reason: string,
  exitRules?: StrategySignal["exitRules"],
): StrategySignal {
  return {
    strategyId: algo.id,
    strategyName: `${algo.displayId} ${algo.name}`,
    action: side === null ? "skip" : actionForSide(side),
    confidence,
    edgeAfterFees: roundRatio(edgeAfterFees),
    sizeContracts,
    fairProbability: roundRatio(fairProbability),
    reason,
    exitRules,
  };
}

function openTrade(input: PaperEngineInput, signal: StrategySignal, side: PaperSide, entryPrice: number, contracts: number, riskLimits?: PaperRiskLimits): PaperTrade {
  const id = `paper-${signal.strategyId}-${input.ticker}-${side}-${Date.parse(input.observedAt)}`;
  const context = tradeContextFromInput(input, signal, side);
  const feesPaid = executionFee(entryPrice, contracts, riskLimits);
  const executableNote = isExecutableMode(riskLimits)
    ? ` Executable fill with ${contracts} contracts and ${moneyText(feesPaid)} estimated fees.`
    : "";
  return {
    id,
    strategyId: signal.strategyId,
    strategyName: signal.strategyName,
    marketTicker: input.ticker ?? "UNKNOWN",
    marketTitle: input.title,
    side,
    contracts,
    entryPrice: roundPrice(entryPrice),
    exitPrice: null,
    targetPrice: input.targetPrice,
    openedAt: input.observedAt,
    closedAt: null,
    status: "open",
    result: "-",
    pnl: null,
    feesPaid,
    entryEstimate: input.estimate,
    lastEstimate: input.estimate,
    reason: `${signal.strategyName}: ${signal.reason} ${signedPercent(signal.edgeAfterFees)} edge, ${signal.confidence}/100 confidence.${executableNote}`,
    entryContext: context,
    exitContext: null,
    bestExitPrice: signal.exitRules?.trailingStop ? context.selectedBid : null,
  };
}

function contractsForTrade(signal: StrategySignal, side: PaperSide, entryPrice: number, input: PaperEngineInput, state: PaperState, riskLimits?: PaperRiskLimits) {
  const signalContracts = Math.max(1, Math.floor(signal.sizeContracts || 1));
  if (!riskLimits) return signalContracts;
  const availableBalance = availablePaperBalance(
    state,
    riskLimits.startingBalance,
    riskLimits.accountScope === "strategy" ? signal.strategyId : null,
  );
  const feePerContract = executionFee(entryPrice, 1, riskLimits);
  const maxCost = Math.min(
    Math.max(0, riskLimits.maxCostPerTrade),
    Math.max(0, availableBalance),
  );
  if (entryPrice <= 0 || maxCost < entryPrice + feePerContract) return 0;
  const maxContracts = Math.max(0, Math.floor(maxCost / (entryPrice + feePerContract)));
  const requestedContracts = riskLimits.stakeMode === "max-cost" ? maxContracts : Math.min(signalContracts, maxContracts);
  if (!isExecutableMode(riskLimits)) return requestedContracts;
  const maxDepthShare = executableDepthShare(riskLimits);
  const askDepth = askDepthForSide(side, input);
  const exitDepth = bidDepthForSide(side, input);
  const depthContracts = Math.floor(Math.min(askDepth, exitDepth) * maxDepthShare);
  return Math.max(0, Math.min(requestedContracts, depthContracts));
}

function availablePaperBalance(state: PaperState, startingBalance: number, strategyId: PaperStrategyId | null = null) {
  const closedPnl = state.trades
    .filter((trade) => trade.status === "closed" && trade.pnl !== null && (strategyId === null || trade.strategyId === strategyId))
    .reduce((total, trade) => total + (trade.pnl ?? 0), 0);
  const openCost = state.trades
    .filter((trade) => trade.status === "open" && (strategyId === null || trade.strategyId === strategyId))
    .reduce((total, trade) => total + trade.entryPrice * trade.contracts + trade.feesPaid, 0);
  return startingBalance + closedPnl - openCost;
}

function managedExitDecision(trade: PaperTrade, input: PaperEngineInput, signal: StrategySignal, riskLimits?: PaperRiskLimits) {
  if (!signal.exitRules) return null;
  const exitPrice = bidForSide(trade.side, input, signal);
  const unitPnl = exitPrice - trade.entryPrice;
  const ageSeconds = (Date.parse(input.observedAt) - Date.parse(trade.openedAt)) / 1000;
  const minHoldSeconds = signal.exitRules.minHoldSeconds ?? 0;
  const canTrailExit = ageSeconds >= minHoldSeconds;
  const bestExitPrice = Math.max(trade.bestExitPrice ?? exitPrice, exitPrice);
  const bestUnitPnl = bestExitPrice - trade.entryPrice;
  const movePercent = input.spotPrice > 0 ? input.oneMinuteChange / input.spotPrice : 0;
  const adverseMomentum = trade.side === "YES"
    ? movePercent <= -(signal.exitRules.momentumExitMovePercent ?? 0.00008)
    : movePercent >= (signal.exitRules.momentumExitMovePercent ?? 0.00008);
  if (signal.exitRules.trailingStop !== undefined
    && bestUnitPnl >= (signal.exitRules.trailAfterProfit ?? 0)
    && bestExitPrice - exitPrice >= signal.exitRules.trailingStop
    && canTrailExit) {
    return executableExitDecision(trade, input, signal, `${signal.strategyName} trailing pullback exit.`, riskLimits);
  }
  if (signal.exitRules.exitOnMomentumFlip && adverseMomentum && unitPnl > 0 && canTrailExit) {
    return executableExitDecision(trade, input, signal, `${signal.strategyName} momentum turn exit.`, riskLimits);
  }
  if (signal.exitRules.takeProfit !== undefined && unitPnl >= signal.exitRules.takeProfit) {
    return executableExitDecision(trade, input, signal, `${signal.strategyName} managed take-profit.`, riskLimits);
  }
  if (signal.exitRules.stopLoss !== undefined && unitPnl <= -signal.exitRules.stopLoss) {
    return executableExitDecision(trade, input, signal, `${signal.strategyName} managed stop-loss.`, riskLimits);
  }
  if (signal.exitRules.maxHoldSeconds !== undefined && ageSeconds >= signal.exitRules.maxHoldSeconds) {
    return executableExitDecision(trade, input, signal, `${signal.strategyName} managed max-hold exit.`, riskLimits);
  }
  if (signal.exitRules.exitBeforeClose !== undefined && input.secondsToClose <= signal.exitRules.exitBeforeClose) {
    return executableExitDecision(trade, input, signal, `${signal.strategyName} managed close-window exit.`, riskLimits);
  }
  return null;
}

function updatedBestExitPrice(trade: PaperTrade, input: PaperEngineInput, signal: StrategySignal) {
  if (!signal.exitRules?.trailingStop) return trade.bestExitPrice ?? null;
  const exitPrice = bidForSide(trade.side, input, signal);
  const current = trade.bestExitPrice ?? exitPrice;
  return roundPrice(Math.max(current, exitPrice));
}

function executableExitDecision(trade: PaperTrade, input: PaperEngineInput, signal: StrategySignal, reason: string, riskLimits?: PaperRiskLimits) {
  const exitPrice = bidForSide(trade.side, input, signal);
  if (!isExecutableMode(riskLimits)) {
    return { price: exitPrice, reason, contracts: trade.contracts, feePaid: 0 };
  }
  const visibleBidDepth = Math.floor(bidDepthForSide(trade.side, input));
  if (exitPrice <= 0 || visibleBidDepth <= 0) return null;
  const contracts = Math.max(0, Math.min(trade.contracts, visibleBidDepth));
  if (contracts <= 0) return null;
  const feePaid = executionFee(exitPrice, contracts, riskLimits);
  const depthNote = contracts < trade.contracts ? ` Partial executable exit ${contracts}/${trade.contracts}.` : " Executable exit.";
  return { price: exitPrice, reason: `${reason}${depthNote} ${moneyText(feePaid)} estimated exit fees.`, contracts, feePaid };
}

function closeTradePortion(trade: PaperTrade, contracts: number, observedAt: string, exitPrice: number, reason: string, context: PaperTradeContext | null = null, exitFee = 0): PaperTrade {
  const closedContracts = Math.max(1, Math.min(trade.contracts, Math.floor(contracts)));
  const entryFee = proratedFee(trade.feesPaid, closedContracts, trade.contracts);
  const feesPaid = roundMoney(entryFee + exitFee);
  const pnl = roundMoney((exitPrice - trade.entryPrice) * closedContracts - feesPaid);
  return {
    ...trade,
    id: closedContracts === trade.contracts ? trade.id : `${trade.id}-partial-${Date.parse(observedAt)}-${closedContracts}`,
    contracts: closedContracts,
    exitPrice: roundPrice(exitPrice),
    closedAt: observedAt,
    status: "closed",
    result: pnl > 0 ? "Win" : "Loss",
    pnl,
    feesPaid,
    reason,
    exitContext: context,
  };
}

function settleTrade(trade: PaperTrade, input: PaperEngineInput, reason: string): PaperTrade {
  const estimate = trade.marketTicker === input.ticker ? input.estimate : trade.lastEstimate;
  const yesWon = estimate >= trade.targetPrice;
  const sideWon = trade.side === "YES" ? yesWon : !yesWon;
  return closeTradePortion(trade, trade.contracts, input.observedAt, sideWon ? 1 : 0, reason, tradeContextFromInput(input, contextSignalFromTrade(trade), trade.side));
}

function buyEvent(trade: PaperTrade): PaperEvent {
  return {
    id: `${trade.id}-buy`,
    time: trade.openedAt,
    action: "BUY",
    strategyId: trade.strategyId,
    strategyName: trade.strategyName,
    marketTicker: trade.marketTicker,
    side: trade.side,
    contracts: trade.contracts,
    price: trade.entryPrice,
    status: "open",
    result: "-",
    pnl: null,
    reason: trade.reason,
    context: trade.entryContext,
  };
}

function sellEvent(trade: PaperTrade, observedAt: string, reason: string): PaperEvent {
  return {
    id: `${trade.id}-sell-${Date.parse(observedAt)}`,
    time: observedAt,
    action: "SELL",
    strategyId: trade.strategyId,
    strategyName: trade.strategyName,
    marketTicker: trade.marketTicker,
    side: trade.side,
    contracts: trade.contracts,
    price: trade.exitPrice ?? 0,
    status: "closed",
    result: trade.result,
    pnl: trade.pnl,
    reason,
    context: trade.exitContext ?? trade.entryContext,
  };
}

function tradeContextFromInput(input: PaperEngineInput, signal: Pick<StrategySignal, "confidence" | "edgeAfterFees" | "fairProbability">, side: PaperSide): PaperTradeContext {
  const selectedAsk = askForSide(side, input);
  const selectedBid = side === "YES" ? input.yesBid : input.noBid;
  const yesSpread = nullableSpread(input.yesAsk, input.yesBid);
  const noSpread = nullableSpread(input.noAsk, input.noBid);
  return {
    observedAt: input.observedAt,
    side,
    targetPrice: input.targetPrice,
    estimate: input.estimate,
    spotPrice: input.spotPrice,
    oneMinuteChange: input.oneMinuteChange,
    oneMinuteMovePercent: input.spotPrice > 0 ? roundRatio(input.oneMinuteChange / input.spotPrice) : 0,
    distanceFromTarget: roundMarket(input.estimate - input.targetPrice),
    fairProbability: roundRatio(signal.fairProbability),
    edgeAfterFees: roundRatio(signal.edgeAfterFees),
    confidence: signal.confidence,
    secondsToClose: input.secondsToClose,
    yesAsk: input.yesAsk,
    noAsk: input.noAsk,
    yesBid: input.yesBid,
    noBid: input.noBid,
    selectedAsk,
    selectedBid,
    selectedSpread: nullableSpread(selectedAsk, selectedBid),
    yesSpread,
    noSpread,
  };
}

function contextSignalFromTrade(trade: PaperTrade): Pick<StrategySignal, "confidence" | "edgeAfterFees" | "fairProbability"> {
  return {
    confidence: trade.entryContext.confidence,
    edgeAfterFees: trade.entryContext.edgeAfterFees,
    fairProbability: trade.entryContext.fairProbability,
  };
}

function addEvent(events: PaperEvent[], event: PaperEvent) {
  if (events.some((item) => item.id === event.id)) return events;
  return [event, ...events].slice(0, paperHistoryLimit);
}

function replaceTrade(trades: PaperTrade[], next: PaperTrade) {
  return trades.map((trade) => trade.id === next.id ? next : trade);
}

function replaceTradePortion(trades: PaperTrade[], source: PaperTrade, closed: PaperTrade) {
  if (closed.contracts >= source.contracts) return replaceTrade(trades, closed);
  const remainingContracts = source.contracts - closed.contracts;
  const remainingFees = roundMoney(source.feesPaid - proratedFee(source.feesPaid, closed.contracts, source.contracts));
  const remaining = {
    ...source,
    contracts: remainingContracts,
    feesPaid: remainingFees,
  };
  return [closed, ...trades.map((trade) => trade.id === source.id ? remaining : trade)];
}

function uniqueById<T extends { id: string }>(items: T[]) {
  const seen = new Set<string>();
  const rows: T[] = [];
  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    rows.push(item);
  }
  return rows;
}

function sideFromAction(action: TradeAction): PaperSide | null {
  if (action === "buy_yes") return "YES";
  if (action === "buy_no") return "NO";
  return null;
}

function actionForSide(side: PaperSide): TradeAction {
  return side === "YES" ? "buy_yes" : "buy_no";
}

function final60Reason(input: PaperEngineInput, insideFinalWindow: boolean, yesAllowed: boolean) {
  if (input.action === "skip") return "Final-60 model found no positive edge.";
  if (!insideFinalWindow) return "Final-60 now waits for the final 60 seconds before opening.";
  if (!yesAllowed) return "YES Final-60 entries are on probation until strict edge/spread rules pass.";
  return "Final-60 model selected the strongest post-cost side inside the true final window.";
}

function yesProbationAllows(side: PaperSide | null, edgeAfterFees: number, confidence: number, spread: number) {
  if (side !== "YES") return true;
  return edgeAfterFees >= activePaperRules.yesProbation.minEdgeAfterFees
    && confidence >= activePaperRules.yesProbation.minConfidence
    && spread <= activePaperRules.yesProbation.maxSpread;
}

function yesGateAllows(mode: string, side: PaperSide, edgeAfterFees: number, confidence: number, spread: number) {
  if (side !== "YES" || mode === "none") return true;
  if (mode === "loose") return edgeAfterFees >= 0.08 && confidence >= 65 && spread <= 0.06;
  return yesProbationAllows(side, edgeAfterFees, confidence, spread);
}

function askForSide(side: PaperSide, input: PaperEngineInput) {
  return side === "YES" ? input.yesAsk : input.noAsk;
}

function bidForSide(side: PaperSide, input: PaperEngineInput, signal: StrategySignal) {
  const bid = side === "YES" ? input.yesBid : input.noBid;
  if (bid !== null && bid > 0 && bid < 1) return bid;
  const probability = side === "YES" ? signal.fairProbability : 1 - signal.fairProbability;
  return Math.max(0, Math.min(1, probability));
}

function spreadForSide(side: PaperSide, input: PaperEngineInput) {
  const ask = side === "YES" ? input.yesAsk : input.noAsk;
  const bid = side === "YES" ? input.yesBid : input.noBid;
  if (ask === null || bid === null) return Number.POSITIVE_INFINITY;
  return Math.max(0, ask - bid);
}

function sideCandidate(side: PaperSide, input: PaperEngineInput, feeBuffer: number) {
  const ask = askForSide(side, input);
  const spread = spreadForSide(side, input);
  const fairProbability = side === "YES" ? input.fairProbability : 1 - input.fairProbability;
  const edge = ask === null ? -1 : roundRatio(fairProbability - ask - feeBuffer);
  const confidence = clamp(Math.round(50 + Math.max(0, edge) * 180 - Math.max(0, spread - 0.02) * 120), 0, 96);
  return {
    side,
    ask,
    fairProbability,
    spread,
    edge,
    confidence,
  };
}

function pickBestSide(input: PaperEngineInput, feeBuffer: number, sideMode: string) {
  const yes = sideCandidate("YES", input, feeBuffer);
  const no = sideCandidate("NO", input, feeBuffer);
  if (sideMode === "yes-only") return yes;
  if (sideMode === "no-only") return no;
  return yes.edge >= no.edge ? yes : no;
}

function pickOrderFlowPressureSide(
  yes: ReturnType<typeof orderFlowPressureCandidate>,
  no: ReturnType<typeof orderFlowPressureCandidate>,
  sideMode: string,
) {
  if (sideMode === "yes-only") return yes;
  if (sideMode === "no-only") return no;
  if (sideMode === "pressure") return yes.pressureScore >= no.pressureScore ? yes : no;
  if (sideMode === "edge") return yes.edge >= no.edge ? yes : no;
  return yes.hybridScore >= no.hybridScore ? yes : no;
}

function orderFlowPressureCandidate(side: PaperSide, input: PaperEngineInput, feeBuffer: number) {
  const candidate = sideCandidate(side, input, feeBuffer);
  const pressure = orderFlowPressureForSide(side, input);
  const bidDepth = bidDepthForSide(side, input);
  const askDepth = askDepthForSide(side, input);
  const depthSupport = clamp((bidDepth - 1) / 12, 0, 1);
  const executableSupport = clamp(Math.min(bidDepth, askDepth) / 8, 0, 1);
  const confidence = clamp(Math.round(
    42
    + Math.max(0, pressure) * 42
    + Math.max(0, candidate.edge) * 130
    + depthSupport * 10
    + executableSupport * 8
    - Math.max(0, candidate.spread - 0.02) * 130,
  ), 0, 98);
  const pressureScore = pressure + depthSupport * 0.08 + executableSupport * 0.06 - candidate.spread * 1.5;
  const hybridScore = pressureScore + candidate.edge * 1.4 + confidence / 500;
  return {
    ...candidate,
    pressure,
    bidDepth,
    askDepth,
    confidence,
    pressureScore,
    hybridScore,
  };
}

function bidDepthForSide(side: PaperSide, input: PaperEngineInput) {
  return side === "YES" ? input.yesBidDepth ?? 0 : input.noBidDepth ?? 0;
}

function askDepthForSide(side: PaperSide, input: PaperEngineInput) {
  return side === "YES" ? input.yesAskDepth ?? 0 : input.noAskDepth ?? 0;
}

function bidDepthDeltaForSide(side: PaperSide, input: PaperEngineInput) {
  return side === "YES" ? input.yesBidDepthDelta ?? 0 : input.noBidDepthDelta ?? 0;
}

function askDepthDeltaForSide(side: PaperSide, input: PaperEngineInput) {
  return side === "YES" ? input.yesAskDepthDelta ?? 0 : input.noAskDepthDelta ?? 0;
}

function bidPriceDeltaForSide(side: PaperSide, input: PaperEngineInput) {
  return side === "YES" ? input.yesBidPriceDelta ?? 0 : input.noBidPriceDelta ?? 0;
}

function askPriceDeltaForSide(side: PaperSide, input: PaperEngineInput) {
  return side === "YES" ? input.yesAskPriceDelta ?? 0 : input.noAskPriceDelta ?? 0;
}

function priceDeltaForSide(side: PaperSide, input: PaperEngineInput) {
  return Math.max(bidPriceDeltaForSide(side, input), askPriceDeltaForSide(side, input));
}

function directionalMovePercent(side: PaperSide, input: PaperEngineInput) {
  const movePercent = input.spotPrice > 0 ? input.oneMinuteChange / input.spotPrice : 0;
  return side === "YES" ? movePercent : -movePercent;
}

function settlementConvergenceForSide(side: PaperSide, input: PaperEngineInput, minRequiredGap: number) {
  const completedSeconds = Math.max(0, numberOrDefault(input.finalMinuteCompletedSeconds, 0));
  const required = numberOrNull(input.requiredRemainingAverageForYes);
  const confidence = clamp(numberOrDefault(input.settlementConfidence, 0), 0, 100);
  const available = completedSeconds > 0 && required !== null && input.spotPrice > 0;
  const requiredGap = !available || required === null
    ? 0
    : side === "YES" ? input.spotPrice - required : required - input.spotPrice;
  const settlementSide: PaperSide = input.estimate >= input.targetPrice ? "YES" : "NO";
  const lockRatio = available ? Math.max(0, requiredGap) / Math.max(0.000001, minRequiredGap) : 0;
  const couldStillFlip = input.settlementCouldStillFlip ?? true;
  return {
    available,
    completedSeconds,
    confidence,
    couldStillFlip,
    locked: available && requiredGap >= minRequiredGap && !couldStillFlip,
    lockRatio,
    requiredGap,
    sideMatches: side === settlementSide,
  };
}

function orderFlowPressureForSide(side: PaperSide, input: PaperEngineInput) {
  const otherSide = oppositeSide(side);
  const selectedBidDepth = bidDepthForSide(side, input);
  const otherBidDepth = bidDepthForSide(otherSide, input);
  const selectedAskDepth = askDepthForSide(side, input);
  const otherAskDepth = askDepthForSide(otherSide, input);
  const selectedBidDelta = bidDepthDeltaForSide(side, input);
  const otherBidDelta = bidDepthDeltaForSide(otherSide, input);
  const selectedAskDelta = askDepthDeltaForSide(side, input);
  const otherAskDelta = askDepthDeltaForSide(otherSide, input);
  const bidBase = Math.max(1, selectedBidDepth + otherBidDepth + Math.abs(selectedBidDelta) + Math.abs(otherBidDelta));
  const askBase = Math.max(1, selectedAskDepth + otherAskDepth + Math.abs(selectedAskDelta) + Math.abs(otherAskDelta));
  const depthFlow = clamp((selectedBidDelta - otherBidDelta) / bidBase, -1, 1);
  const askSweep = clamp((otherAskDelta - selectedAskDelta) / askBase, -1, 1);
  const pricePush = clamp((
    bidPriceDeltaForSide(side, input)
    - bidPriceDeltaForSide(otherSide, input)
    + askPriceDeltaForSide(side, input)
    - askPriceDeltaForSide(otherSide, input)
  ) / 0.04, -1, 1);
  const currentImbalance = depthImbalanceForSide(side, input);
  const momentumPressure = clamp(directionalMovePercent(side, input) / 0.001, -1, 1);
  return roundRatio(
    currentImbalance * 0.36
    + depthFlow * 0.28
    + pricePush * 0.18
    + askSweep * 0.1
    + momentumPressure * 0.08,
  );
}

function executionEntryAllowed(signal: StrategySignal, side: PaperSide, input: PaperEngineInput, riskLimits?: PaperRiskLimits) {
  const limits = riskLimits;
  if (limits?.executionMode !== "executable") return true;
  const spread = spreadForSide(side, input);
  const maxSpread = limits.maxEntrySpread ?? 0.02;
  const minEdge = limits.minEdgeAfterFees ?? 0.08;
  const minExitDepth = limits.minExitDepthContracts ?? 1;
  return signal.edgeAfterFees >= minEdge
    && spread <= maxSpread
    && askDepthForSide(side, input) > 0
    && bidDepthForSide(side, input) >= minExitDepth;
}

function isExecutableMode(riskLimits?: PaperRiskLimits) {
  return riskLimits?.executionMode === "executable";
}

function executableDepthShare(riskLimits?: PaperRiskLimits) {
  const share = riskLimits?.maxDepthShare ?? 0.25;
  return clamp(share, 0.01, 1);
}

function executionFee(price: number, contracts: number, riskLimits?: PaperRiskLimits) {
  const limits = riskLimits;
  if (limits?.executionMode !== "executable") return 0;
  const rate = limits.feeRate ?? 0.07;
  return roundMoney(Math.max(0, contracts) * Math.max(0, rate) * price * Math.max(0, 1 - price));
}

function proratedFee(totalFee: number, contracts: number, totalContracts: number) {
  if (totalContracts <= 0) return 0;
  return roundMoney(totalFee * (contracts / totalContracts));
}

function moneyText(value: number) {
  const sign = value < 0 ? "-" : "";
  return `${sign}$${Math.abs(value).toFixed(2)}`;
}

function depthImbalanceForSide(side: PaperSide, input: PaperEngineInput) {
  const selected = bidDepthForSide(side, input);
  const other = bidDepthForSide(oppositeSide(side), input);
  const total = selected + other;
  return total > 0 ? roundRatio((selected - other) / total) : 0;
}

function oppositeSide(side: PaperSide): PaperSide {
  return side === "YES" ? "NO" : "YES";
}

function nullableSpread(ask: number | null, bid: number | null) {
  if (ask === null || bid === null) return null;
  return roundRatio(Math.max(0, ask - bid));
}

function normalizeTrade(value: unknown): PaperTrade | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== "string"
    || typeof value.marketTicker !== "string"
    || (value.side !== "YES" && value.side !== "NO")
    || typeof value.contracts !== "number"
    || typeof value.entryPrice !== "number"
    || typeof value.targetPrice !== "number"
    || typeof value.openedAt !== "string"
    || (value.status !== "open" && value.status !== "closed")) return null;

  const entryEstimate = typeof value.entryEstimate === "number" ? value.entryEstimate : value.targetPrice;
  const lastEstimate = typeof value.lastEstimate === "number" ? value.lastEstimate : value.targetPrice;
  const entryContextFallback = legacyContext({
    observedAt: value.openedAt,
    side: value.side,
    targetPrice: value.targetPrice,
    estimate: entryEstimate,
    spotPrice: entryEstimate,
    price: value.entryPrice,
  });
  const exitContextFallback = typeof value.closedAt === "string"
    ? legacyContext({
      observedAt: value.closedAt,
      side: value.side,
      targetPrice: value.targetPrice,
      estimate: lastEstimate,
      spotPrice: lastEstimate,
      price: typeof value.exitPrice === "number" ? value.exitPrice : null,
    })
    : null;

  return {
    id: value.id,
    strategyId: normalizeStrategyId(value.strategyId),
    strategyName: stringOrDefault(value.strategyName, strategyNameForId(normalizeStrategyId(value.strategyId))),
    marketTicker: value.marketTicker,
    marketTitle: typeof value.marketTitle === "string" ? value.marketTitle : null,
    side: value.side,
    contracts: value.contracts,
    entryPrice: value.entryPrice,
    exitPrice: typeof value.exitPrice === "number" ? value.exitPrice : null,
    targetPrice: value.targetPrice,
    openedAt: value.openedAt,
    closedAt: typeof value.closedAt === "string" ? value.closedAt : null,
    status: value.status,
    result: normalizeResult(value.result),
    pnl: typeof value.pnl === "number" ? value.pnl : null,
    feesPaid: typeof value.feesPaid === "number" ? value.feesPaid : 0,
    entryEstimate,
    lastEstimate,
    reason: stringOrDefault(value.reason, "Imported legacy paper trade."),
    entryContext: normalizeTradeContext(value.entryContext, entryContextFallback) ?? entryContextFallback,
    exitContext: normalizeTradeContext(value.exitContext, exitContextFallback),
    bestExitPrice: numberOrNull(value.bestExitPrice),
  };
}

function normalizeEvent(value: unknown): PaperEvent | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== "string"
    || typeof value.time !== "string"
    || (value.action !== "BUY" && value.action !== "SELL")
    || typeof value.marketTicker !== "string"
    || (value.side !== "YES" && value.side !== "NO")
    || typeof value.contracts !== "number"
    || typeof value.price !== "number") return null;

  return {
    id: value.id,
    time: value.time,
    action: value.action,
    strategyId: normalizeStrategyId(value.strategyId),
    strategyName: stringOrDefault(value.strategyName, strategyNameForId(normalizeStrategyId(value.strategyId))),
    marketTicker: value.marketTicker,
    side: value.side,
    contracts: value.contracts,
    price: value.price,
    status: value.status === "closed" ? "closed" : "open",
    result: normalizeResult(value.result),
    pnl: typeof value.pnl === "number" ? value.pnl : null,
    reason: stringOrDefault(value.reason, "Imported legacy paper event."),
    context: normalizeTradeContext(value.context, legacyContext({
      observedAt: value.time,
      side: value.side,
      targetPrice: 0,
      estimate: 0,
      spotPrice: 0,
      price: value.price,
    })) ?? legacyContext({
      observedAt: value.time,
      side: value.side,
      targetPrice: 0,
      estimate: 0,
      spotPrice: 0,
      price: value.price,
    }),
  };
}

function normalizeTradeContext(value: unknown, fallback: PaperTradeContext | null): PaperTradeContext | null {
  if (!isRecord(value) || (value.side !== "YES" && value.side !== "NO")) return fallback;
  return {
    observedAt: stringOrDefault(value.observedAt, fallback?.observedAt ?? new Date(0).toISOString()),
    side: value.side,
    targetPrice: numberOrDefault(value.targetPrice, fallback?.targetPrice ?? 0),
    estimate: numberOrDefault(value.estimate, fallback?.estimate ?? 0),
    spotPrice: numberOrDefault(value.spotPrice, fallback?.spotPrice ?? 0),
    oneMinuteChange: numberOrDefault(value.oneMinuteChange, fallback?.oneMinuteChange ?? 0),
    oneMinuteMovePercent: numberOrDefault(value.oneMinuteMovePercent, fallback?.oneMinuteMovePercent ?? 0),
    distanceFromTarget: numberOrDefault(value.distanceFromTarget, fallback?.distanceFromTarget ?? 0),
    fairProbability: numberOrDefault(value.fairProbability, fallback?.fairProbability ?? 0),
    edgeAfterFees: numberOrDefault(value.edgeAfterFees, fallback?.edgeAfterFees ?? 0),
    confidence: numberOrDefault(value.confidence, fallback?.confidence ?? 0),
    secondsToClose: numberOrDefault(value.secondsToClose, fallback?.secondsToClose ?? 0),
    yesAsk: numberOrNull(value.yesAsk),
    noAsk: numberOrNull(value.noAsk),
    yesBid: numberOrNull(value.yesBid),
    noBid: numberOrNull(value.noBid),
    selectedAsk: numberOrNull(value.selectedAsk),
    selectedBid: numberOrNull(value.selectedBid),
    selectedSpread: numberOrNull(value.selectedSpread),
    yesSpread: numberOrNull(value.yesSpread),
    noSpread: numberOrNull(value.noSpread),
  };
}

function legacyContext({
  observedAt,
  side,
  targetPrice,
  estimate,
  spotPrice,
  price,
}: {
  observedAt: string;
  side: PaperSide;
  targetPrice: number;
  estimate: number;
  spotPrice: number;
  price: number | null;
}): PaperTradeContext {
  return {
    observedAt,
    side,
    targetPrice,
    estimate,
    spotPrice,
    oneMinuteChange: 0,
    oneMinuteMovePercent: 0,
    distanceFromTarget: roundMarket(estimate - targetPrice),
    fairProbability: 0,
    edgeAfterFees: 0,
    confidence: 0,
    secondsToClose: 0,
    yesAsk: side === "YES" ? price : null,
    noAsk: side === "NO" ? price : null,
    yesBid: null,
    noBid: null,
    selectedAsk: price,
    selectedBid: null,
    selectedSpread: null,
    yesSpread: null,
    noSpread: null,
  };
}

function normalizeStrategyId(value: unknown): PaperStrategyId {
  if (paperStrategyDefinitions.some((strategy) => strategy.id === value)) return value as BuiltInPaperStrategyId;
  if (isGeneratedPaperStrategyId(value)) return value;
  return "final60";
}

function normalizePaperAlgoUpgradeId(value: unknown, strategyId: BuiltInPaperStrategyId): PaperAlgoUpgradeId {
  if (value === "standard") return "standard";
  const definition = paperAlgoUpgradeDefinitions.find((upgrade) => upgrade.id === value);
  if (!definition || definition.baseStrategyId !== strategyId) return "standard";
  return definition.id;
}

function paperAlgoUpgradeDefinitionForId(id: PaperAlgoVariantId): PaperAlgoUpgradeDefinition {
  return paperAlgoUpgradeDefinitions.find((upgrade) => upgrade.id === id) ?? paperAlgoUpgradeDefinitions[0];
}

function strategyNameForId(id: PaperStrategyId) {
  if (isGeneratedPaperStrategyId(id)) return "Generated Paper Algo";
  return paperStrategyDefinitions.find((strategy) => strategy.id === id)?.name ?? "Final-60 Lock";
}

function normalizeGeneratedPaperAlgo(value: unknown): GeneratedPaperAlgo | null {
  if (!isRecord(value)) return null;
  const sourceAlgoId = stringOrDefault(value.sourceAlgoId, "");
  const id = isGeneratedPaperStrategyId(value.id)
    ? value.id
    : sourceAlgoId ? `generated:${sourceAlgoId}` as GeneratedPaperStrategyId : null;
  if (!id || !sourceAlgoId) return null;
  const rawFamily = stringOrDefault(value.family, "unknown");
  const family = rawFamily === "shadow" ? "paper-variant" : rawFamily;
  const name = stringOrDefault(value.name, sourceAlgoId);
  const sourceMetrics = isRecord(value.sourceMetrics) ? value.sourceMetrics : {};
  return {
    id,
    displayId: normalizeGeneratedPaperDisplayId(
      value.displayId,
      fallbackGeneratedPaperDisplayId(id, family, `${name} ${sourceAlgoId}`),
    ),
    sourceAlgoId,
    name,
    family,
    params: isRecord(value.params) ? { ...value.params } : {},
    enabled: booleanOrDefault(value.enabled, true),
    promotedAt: stringOrDefault(value.promotedAt, new Date(0).toISOString()),
    sourceRunId: typeof value.sourceRunId === "string" ? value.sourceRunId : null,
    sourceMetrics: {
      closed: numberOrDefault(sourceMetrics.closed, 0),
      wins: numberOrDefault(sourceMetrics.wins, 0),
      losses: numberOrDefault(sourceMetrics.losses, 0),
      totalPnl: numberOrDefault(sourceMetrics.totalPnl, 0),
      totalCost: numberOrDefault(sourceMetrics.totalCost, 0),
      roi: numberOrDefault(sourceMetrics.roi, 0),
      maxDrawdown: numberOrDefault(sourceMetrics.maxDrawdown, 0),
    },
  };
}

export function generatedPaperFamilyCode(family: string, nameOrSource = "") {
  const normalized = family.replace(/^sweep-/, "").toLowerCase();
  const searchable = `${normalized} ${nameOrSource}`.toLowerCase();
  if (searchable.includes("cheap-longshot") || searchable.includes("longshot")) return "CL";
  if (searchable.includes("managed-scalp")) return "MS";
  if (searchable.includes("momentum-trail")) return "MT";
  if (searchable.includes("kalshi-lag") || searchable.includes("lag-lock")) return "KL";
  if (searchable.includes("order-flow") || searchable.includes("flow-pressure") || searchable.includes("pressure")) return "OF";
  if (searchable.includes("liquidity-imbalance")) return "LI";
  if (searchable.includes("late-lock")) return "LL";
  if (searchable.includes("late-favorite")) return "LF";
  if (searchable.includes("target-revert")) return "TR";
  if (searchable.includes("fade-momentum")) return "MF";
  if (searchable.includes("fade-model")) return "FM";
  if (searchable.includes("momentum")) return "MO";
  if (searchable.includes("scalp") || searchable.includes("spread")) return "SC";
  if (searchable.includes("distance") || searchable.includes("threshold")) return "DI";
  if (searchable.includes("final60") || searchable.includes("final-60")) return "F60";
  if (searchable.includes("yes-probation")) return "YP";
  const fixed: Record<string, string> = {
    model: "MD",
    distance: "DI",
    scalp: "SC",
    momentum: "MO",
    "fade-model": "FM",
    "fade-momentum": "MF",
    "momentum-trail": "MT",
    "kalshi-lag-lock": "KL",
    "order-flow-pressure": "OF",
    "target-revert": "TR",
    "managed-scalp": "MS",
    "cheap-longshot": "CL",
    "late-lock": "LL",
    "late-favorite": "LF",
    "liquidity-imbalance": "LI",
    paper: "PA",
    "paper-variant": "PV",
    shadow: "PV",
  };
  if (fixed[normalized]) return fixed[normalized];
  const parts = normalized.split("-").filter(Boolean);
  const code = parts.map((part) => part[0]).join("").toUpperCase().slice(0, 3);
  return code || "GA";
}

function normalizeGeneratedPaperDisplayId(value: unknown, fallback: string) {
  if (typeof value !== "string") return fallback;
  const normalized = value.trim().toUpperCase().replace(/[^A-Z0-9-]/g, "");
  if (normalized.length < 3) return fallback;
  return normalized.slice(0, 16);
}

function fallbackGeneratedPaperDisplayId(id: string, family: string, nameOrSource: string) {
  return `${generatedPaperFamilyCode(family, nameOrSource)}-${shortStableCode(`${id}:${nameOrSource}`)}`;
}

function shortStableCode(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36).toUpperCase().padStart(4, "0").slice(0, 4);
}

function isGeneratedPaperStrategyId(value: unknown): value is GeneratedPaperStrategyId {
  return typeof value === "string" && value.startsWith("generated:") && value.length > "generated:".length;
}

function normalizeResult(value: unknown): PaperResult {
  if (value === "Win" || value === "Loss") return value;
  return "-";
}

function booleanOrDefault(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

function numberOrDefault(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function numberOrNull(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringOrDefault(value: unknown, fallback: string) {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function numberParam(params: Record<string, unknown>, key: string, fallback: number) {
  const value = params[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function stringParam(params: Record<string, unknown>, key: string, fallback: string) {
  const value = params[key];
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function roundPrice(value: number) {
  return Number(value.toFixed(4));
}

function roundMarket(value: number) {
  return Number(value.toFixed(7));
}

function roundMoney(value: number) {
  return Number(value.toFixed(2));
}

function roundRatio(value: number) {
  return Number(value.toFixed(4));
}

function signedPercent(value: number) {
  return `${value >= 0 ? "+" : ""}${(value * 100).toFixed(1)}%`;
}

function percentText(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

function contractsForConfidence(confidence: number) {
  if (confidence >= 85) return 5;
  if (confidence >= 72) return 3;
  return 1;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
