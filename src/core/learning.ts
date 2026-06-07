import {
  activePaperRules,
  normalizePaperState,
  paperAlgoUpgradeDefinitions,
  paperStrategyDefinitions,
  type BuiltInPaperStrategyId,
  type PaperEngineInput,
  type PaperAlgoVariantId,
  type PaperResult,
  type PaperSide,
  type PaperState,
  type PaperTrade,
  type PaperTradeContext,
} from "./paper";

export type ShadowVariantId = PaperAlgoVariantId;

export interface ShadowVariantDefinition {
  id: ShadowVariantId;
  name: string;
  shortName: string;
  baseStrategyId: BuiltInPaperStrategyId;
  description: string;
}

interface ShadowSignal {
  side: PaperSide | null;
  fairProbability: number;
  edgeAfterFees: number;
  confidence: number;
  contracts: number;
  reason: string;
}

export interface ShadowTrade {
  id: string;
  variantId: ShadowVariantId;
  variantName: string;
  baseStrategyId: BuiltInPaperStrategyId;
  marketTicker: string;
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
  entryEstimate: number;
  lastEstimate: number;
  reason: string;
  entryContext: PaperTradeContext;
  exitContext: PaperTradeContext | null;
}

export interface ShadowEvent {
  id: string;
  time: string;
  variantId: ShadowVariantId;
  variantName: string;
  action: "BUY" | "SELL";
  side: PaperSide;
  price: number;
  contracts: number;
  pnl: number | null;
  result: PaperResult;
}

export interface ShadowState {
  trades: ShadowTrade[];
  events: ShadowEvent[];
}

export interface LearningState {
  shadow: ShadowState;
}

export interface StrategyLearningMetrics {
  strategyId: BuiltInPaperStrategyId;
  strategyName: string;
  closed: number;
  open: number;
  wins: number;
  losses: number;
  winRate: number | null;
  averagePnl: number | null;
  totalPnl: number;
  averageEdge: number | null;
  averageSpread: number | null;
  averageSecondsToClose: number | null;
  averageDistanceFromTarget: number | null;
  totalCost: number;
  roi: number | null;
}

export interface ShadowVariantMetrics {
  variantId: ShadowVariantId;
  variantName: string;
  baseStrategyId: BuiltInPaperStrategyId;
  closed: number;
  open: number;
  wins: number;
  losses: number;
  winRate: number | null;
  averagePnl: number | null;
  totalPnl: number;
  averageEdge: number | null;
  totalCost: number;
  roi: number | null;
}

export interface BestAlgoProjection {
  algorithmName: string;
  algorithmKind: "paper-strategy" | "shadow-variant";
  closed: number;
  wins: number;
  losses: number;
  winRate: number | null;
  totalPnl: number;
  totalCost: number;
  roi: number;
  dailyBudget: number;
  projectedDailyProfit: number;
  projectedDailyValue: number;
  confidenceLabel: "low sample" | "medium sample" | "higher sample";
}

export interface LearningInsight {
  id: string;
  tone: "collecting" | "positive" | "warning";
  title: string;
  detail: string;
  recommendation: string;
  sampleSize: number;
}

export interface LearningReport {
  savedContexts: number;
  closedTrades: number;
  strategyMetrics: StrategyLearningMetrics[];
  shadowMetrics: ShadowVariantMetrics[];
  bestShadowVariant: ShadowVariantMetrics | null;
  bestAlgoProjection: BestAlgoProjection | null;
  insights: LearningInsight[];
}

export const learningStorageKey = "dogeedge.learning.v1";

export const shadowVariantDefinitions: ShadowVariantDefinition[] = paperAlgoUpgradeDefinitions;

export const emptyLearningState: LearningState = {
  shadow: {
    trades: [],
    events: [],
  },
};

export function advanceLearningState(current: LearningState, input: PaperEngineInput): LearningState {
  const state = normalizeLearningState(current);
  if (!input.marketLive || !input.ticker) return state;
  const shadow = shadowVariantDefinitions.reduce((next, variant) => advanceShadowVariant(next, input, variant), state.shadow);
  return { shadow };
}

export function buildLearningReport(paperState: PaperState, learningState: LearningState): LearningReport {
  const normalizedPaper = normalizePaperState(paperState);
  const normalizedLearning = normalizeLearningState(learningState);
  const closedTrades = normalizedPaper.trades.filter((trade) => trade.status === "closed" && trade.pnl !== null);
  const strategyMetrics = paperStrategyDefinitions.map((strategy) => metricForPaperStrategy(strategy.id, strategy.name, normalizedPaper.trades));
  const shadowMetrics = shadowVariantDefinitions.map((variant) => metricForShadowVariant(variant, normalizedLearning.shadow));
  const bestShadowVariant = shadowMetrics
    .filter((metric) => metric.closed > 0)
    .sort((left, right) => right.totalPnl - left.totalPnl || (right.winRate ?? 0) - (left.winRate ?? 0))[0] ?? null;
  const bestAlgoProjection = buildBestAlgoProjection(strategyMetrics, shadowMetrics);

  return {
    savedContexts: normalizedPaper.trades.filter((trade) => trade.entryContext).length,
    closedTrades: closedTrades.length,
    strategyMetrics,
    shadowMetrics,
    bestShadowVariant,
    bestAlgoProjection,
    insights: buildInsights(closedTrades),
  };
}

export function normalizeLearningState(value: unknown): LearningState {
  if (!isRecord(value)) return emptyLearningState;
  const shadow = isRecord(value.shadow) ? value.shadow : {};
  const trades = Array.isArray(shadow.trades)
    ? uniqueById(shadow.trades.map(normalizeShadowTrade).filter((item): item is ShadowTrade => item !== null))
    : [];
  const events = Array.isArray(shadow.events)
    ? uniqueById(shadow.events.map(normalizeShadowEvent).filter((item): item is ShadowEvent => item !== null))
    : [];
  return {
    shadow: {
      trades: trades.slice(0, 220),
      events: events.slice(0, 220),
    },
  };
}

export function clearLearningState(): LearningState {
  return emptyLearningState;
}

function advanceShadowVariant(current: ShadowState, input: PaperEngineInput, variant: ShadowVariantDefinition): ShadowState {
  const signal = shadowSignal(input, variant);
  let changed = false;
  let trades = current.trades.map((trade) => {
    if (trade.status !== "open" || trade.variantId !== variant.id || trade.marketTicker !== input.ticker) return trade;
    if (trade.lastEstimate === input.estimate) return trade;
    changed = true;
    return { ...trade, lastEstimate: input.estimate };
  });
  let events = [...current.events];

  const openForCurrentMarket = trades.find((trade) => trade.status === "open" && trade.variantId === variant.id && trade.marketTicker === input.ticker) ?? null;
  if (openForCurrentMarket && signal.side && signal.side !== openForCurrentMarket.side && signal.edgeAfterFees > 0) {
    const ageMs = Date.parse(input.observedAt) - Date.parse(openForCurrentMarket.openedAt);
    if (ageMs >= 10_000) {
      const closed = closeShadowTrade(openForCurrentMarket, input, bidForSide(openForCurrentMarket.side, input, signal), "Paper variant signal flipped.");
      trades = replaceShadowTrade(trades, closed);
      events = addShadowEvent(events, shadowSellEvent(closed, input.observedAt));
      changed = true;
    }
  }

  for (const trade of trades.filter((item) => item.status === "open" && item.variantId === variant.id)) {
    const marketChanged = trade.marketTicker !== input.ticker;
    const atClose = trade.marketTicker === input.ticker && input.secondsToClose <= 2;
    if (!marketChanged && !atClose) continue;
    const estimate = marketChanged ? trade.lastEstimate : input.estimate;
    const yesWon = estimate >= trade.targetPrice;
    const sideWon = trade.side === "YES" ? yesWon : !yesWon;
    const closed = closeShadowTrade(trade, input, sideWon ? 1 : 0, marketChanged ? "Paper variant contract rolled." : "Paper variant contract closed.");
    trades = replaceShadowTrade(trades, closed);
    events = addShadowEvent(events, shadowSellEvent(closed, input.observedAt));
    changed = true;
  }

  const hasCurrentOpen = trades.some((trade) => trade.status === "open" && trade.variantId === variant.id && trade.marketTicker === input.ticker);
  if (signal.side && signal.edgeAfterFees > 0 && !hasCurrentOpen && input.secondsToClose > 8) {
    const ask = askForSide(signal.side, input);
    if (ask !== null && ask > 0 && ask < 1) {
      const opened = openShadowTrade(input, variant, signal, signal.side, ask);
      trades = [opened, ...trades].slice(0, 220);
      events = addShadowEvent(events, shadowBuyEvent(opened));
      changed = true;
    }
  }

  if (!changed) return current;
  return {
    trades: trades.slice(0, 220),
    events: events.slice(0, 220),
  };
}

function shadowSignal(input: PaperEngineInput, variant: ShadowVariantDefinition): ShadowSignal {
  if (variant.id === "final60Strict") {
    const side = sideFromAction(input.action);
    const allowed = side !== null && input.edgeAfterFees >= 0.07 && input.confidence >= 70 && input.secondsToClose <= 60;
    return {
      side: allowed ? side : null,
      fairProbability: input.fairProbability,
      edgeAfterFees: input.edgeAfterFees,
      confidence: input.confidence,
      contracts: input.confidence >= 85 ? 4 : 2,
      reason: "Strict final-minute edge and confidence filter.",
    };
  }

  if (variant.id === "final60Aggressive") {
    const side = sideFromAction(input.action);
    const allowed = side !== null && input.edgeAfterFees >= 0.025 && input.confidence >= 45;
    return {
      side: allowed ? side : null,
      fairProbability: input.fairProbability,
      edgeAfterFees: input.edgeAfterFees,
      confidence: input.confidence,
      contracts: input.confidence >= 75 ? 3 : 1,
      reason: "Aggressive positive-edge entry filter.",
    };
  }

  if (variant.id === "final60TrueWindow45") {
    const side = sideFromAction(input.action);
    const spread = side === null ? Number.POSITIVE_INFINITY : spreadForSide(side, input);
    const allowed = side !== null
      && input.secondsToClose <= 45
      && input.edgeAfterFees >= 0.04
      && input.confidence >= 55
      && yesProbationAllows(side, input.edgeAfterFees, input.confidence, spread);
    return {
      side: allowed ? side : null,
      fairProbability: input.fairProbability,
      edgeAfterFees: input.edgeAfterFees,
      confidence: input.confidence,
      contracts: input.confidence >= 80 ? 3 : 1,
      reason: "True final-window test with 45 seconds or less remaining.",
    };
  }

  if (variant.id === "spreadScalpMax4c") {
    const yesEdge = input.yesAsk === null ? -1 : input.fairProbability - input.yesAsk - 0.006;
    const noEdge = input.noAsk === null ? -1 : (1 - input.fairProbability) - input.noAsk - 0.006;
    const side: PaperSide = yesEdge >= noEdge ? "YES" : "NO";
    const spread = spreadForSide(side, input);
    const edge = side === "YES" ? yesEdge : noEdge;
    return {
      side: spread <= 0.04 && edge > 0 ? side : null,
      fairProbability: side === "YES" ? input.fairProbability : 1 - input.fairProbability,
      edgeAfterFees: roundRatio(edge),
      confidence: clamp(Math.round(55 + Math.max(0, edge) * 130), 0, 92),
      contracts: spread <= 0.02 ? 3 : 1,
      reason: "Paper variant scalp with a hard 4c spread cap.",
    };
  }

  if (variant.id === "spreadScalpMax2c") {
    const yesEdge = input.yesAsk === null ? -1 : input.fairProbability - input.yesAsk - 0.006;
    const noEdge = input.noAsk === null ? -1 : (1 - input.fairProbability) - input.noAsk - 0.006;
    const side: PaperSide = yesEdge >= noEdge ? "YES" : "NO";
    const spread = spreadForSide(side, input);
    const edge = side === "YES" ? yesEdge : noEdge;
    const confidence = clamp(Math.round(58 + Math.max(0, edge) * 135), 0, 94);
    return {
      side: spread <= activePaperRules.orderbookScalpMaxSpread && edge > 0 && yesProbationAllows(side, edge, confidence, spread) ? side : null,
      fairProbability: side === "YES" ? input.fairProbability : 1 - input.fairProbability,
      edgeAfterFees: roundRatio(edge),
      confidence,
      contracts: spread <= 0.01 ? 3 : 1,
      reason: "Tighter scalp variant with a hard 2c spread cap.",
    };
  }

  if (variant.id === "thresholdDistanceFar") {
    const distance = input.estimate - input.targetPrice;
    const side: PaperSide = distance >= 0 ? "YES" : "NO";
    const ask = askForSide(side, input);
    const fairProbability = side === "YES"
      ? clamp(0.5 + distance / 0.0012, 0.01, 0.99)
      : clamp(0.5 - distance / 0.0012, 0.01, 0.99);
    const edge = ask === null ? -1 : roundRatio(fairProbability - ask - 0.014);
    const confidence = clamp(Math.round(45 + Math.min(1, Math.abs(distance) / 0.00022) * 50), 0, 100);
    const spread = spreadForSide(side, input);
    return {
      side: Math.abs(distance) >= activePaperRules.thresholdMinDistanceFromTarget && edge > 0 && yesProbationAllows(side, edge, confidence, spread) ? side : null,
      fairProbability: roundRatio(fairProbability),
      edgeAfterFees: edge,
      confidence,
      contracts: confidence >= 82 ? 5 : confidence >= 68 ? 3 : 1,
      reason: "Distance variant requiring at least 0.00020 from the target.",
    };
  }

  if (variant.id === "momentumMax6c") {
    const momentum = input.oneMinuteChange;
    const side: PaperSide = momentum >= 0 ? "YES" : "NO";
    const ask = askForSide(side, input);
    const spread = spreadForSide(side, input);
    const momentumBoost = clamp(Math.abs(momentum) / 0.00035, 0, 1) * 0.12;
    const baseFair = side === "YES" ? input.fairProbability : 1 - input.fairProbability;
    const fairProbability = clamp(baseFair + momentumBoost, 0.01, 0.99);
    const edge = ask === null ? -1 : roundRatio(fairProbability - ask - 0.018);
    const confidence = clamp(Math.round(48 + momentumBoost * 280), 0, 86);
    return {
      side: Math.abs(momentum) >= 0.000015 && spread <= activePaperRules.momentumMaxSpread && edge > 0 && yesProbationAllows(side, edge, confidence, spread) ? side : null,
      fairProbability: roundRatio(fairProbability),
      edgeAfterFees: edge,
      confidence,
      contracts: confidence >= 78 ? 3 : 1,
      reason: "Momentum variant with a 6c max selected spread.",
    };
  }

  if (variant.id === "yesProbationStrict") {
    const side: PaperSide = "YES";
    const ask = input.yesAsk;
    const spread = spreadForSide(side, input);
    const distance = input.estimate - input.targetPrice;
    const fairProbability = clamp(Math.max(input.fairProbability, 0.5 + distance / 0.0012), 0.01, 0.99);
    const edge = ask === null ? -1 : roundRatio(fairProbability - ask - 0.014);
    const confidence = clamp(Math.round(50 + Math.max(0, edge) * 180 + Math.max(0, distance) / 0.0002 * 18), 0, 96);
    return {
      side: distance > 0 && edge >= activePaperRules.yesProbation.minEdgeAfterFees && confidence >= activePaperRules.yesProbation.minConfidence && spread <= activePaperRules.yesProbation.maxSpread ? side : null,
      fairProbability: roundRatio(fairProbability),
      edgeAfterFees: edge,
      confidence,
      contracts: 1,
      reason: "Strict YES-only recovery test with high edge, high confidence, and tight spread.",
    };
  }

  const movePercent = input.spotPrice > 0 ? input.oneMinuteChange / input.spotPrice : 0;
  const side: PaperSide = movePercent >= 0 ? "YES" : "NO";
  const ask = askForSide(side, input);
  const baseFair = side === "YES" ? input.fairProbability : 1 - input.fairProbability;
  const fairProbability = clamp(baseFair + Math.min(0.1, Math.abs(movePercent) * 180), 0.01, 0.99);
  const edge = ask === null ? -1 : fairProbability - ask - 0.018;
  return {
    side: Math.abs(movePercent) >= 0.0003 && edge > 0 ? side : null,
    fairProbability: roundRatio(fairProbability),
    edgeAfterFees: roundRatio(edge),
    confidence: clamp(Math.round(52 + Math.min(1, Math.abs(movePercent) / 0.001) * 34), 0, 88),
    contracts: Math.abs(movePercent) >= 0.0006 ? 3 : 1,
    reason: "Momentum requires at least a 0.03% one-minute move.",
  };
}

function openShadowTrade(input: PaperEngineInput, variant: ShadowVariantDefinition, signal: ShadowSignal, side: PaperSide, entryPrice: number): ShadowTrade {
  const context = contextFromInput(input, signal, side);
  const id = `shadow-${variant.id}-${input.ticker}-${side}-${Date.parse(input.observedAt)}`;
  return {
    id,
    variantId: variant.id,
    variantName: variant.name,
    baseStrategyId: variant.baseStrategyId,
    marketTicker: input.ticker ?? "UNKNOWN",
    side,
    contracts: Math.max(1, Math.floor(signal.contracts || 1)),
    entryPrice: roundPrice(entryPrice),
    exitPrice: null,
    targetPrice: input.targetPrice,
    openedAt: input.observedAt,
    closedAt: null,
    status: "open",
    result: "-",
    pnl: null,
    entryEstimate: input.estimate,
    lastEstimate: input.estimate,
    reason: signal.reason,
    entryContext: context,
    exitContext: null,
  };
}

function closeShadowTrade(trade: ShadowTrade, input: PaperEngineInput, exitPrice: number, reason: string): ShadowTrade {
  const pnl = roundMoney((exitPrice - trade.entryPrice) * trade.contracts);
  return {
    ...trade,
    exitPrice: roundPrice(exitPrice),
    closedAt: input.observedAt,
    status: "closed",
    result: pnl > 0 ? "Win" : "Loss",
    pnl,
    reason,
    exitContext: contextFromInput(input, {
      fairProbability: trade.entryContext.fairProbability,
      edgeAfterFees: trade.entryContext.edgeAfterFees,
      confidence: trade.entryContext.confidence,
    }, trade.side),
  };
}

function shadowBuyEvent(trade: ShadowTrade): ShadowEvent {
  return {
    id: `${trade.id}-buy`,
    time: trade.openedAt,
    variantId: trade.variantId,
    variantName: trade.variantName,
    action: "BUY",
    side: trade.side,
    price: trade.entryPrice,
    contracts: trade.contracts,
    pnl: null,
    result: "-",
  };
}

function shadowSellEvent(trade: ShadowTrade, observedAt: string): ShadowEvent {
  return {
    id: `${trade.id}-sell-${Date.parse(observedAt)}`,
    time: observedAt,
    variantId: trade.variantId,
    variantName: trade.variantName,
    action: "SELL",
    side: trade.side,
    price: trade.exitPrice ?? 0,
    contracts: trade.contracts,
    pnl: trade.pnl,
    result: trade.result,
  };
}

function buildInsights(closedTrades: PaperTrade[]): LearningInsight[] {
  if (closedTrades.length === 0) {
    return [{
      id: "collecting",
      tone: "collecting",
      title: "Collecting closed trades",
      detail: "The lab needs settled paper trades before it can separate useful patterns from noise.",
      recommendation: "Let the paper runner collect complete 15-minute contracts, then review the first rule hints.",
      sampleSize: 0,
    }];
  }

  return [
    spreadInsight(closedTrades),
    finalMinuteInsight(closedTrades),
    distanceInsight(closedTrades),
  ];
}

function spreadInsight(closedTrades: PaperTrade[]): LearningInsight {
  const momentumTrades = closedTrades.filter((trade) => trade.strategyId === "momentumFlip");
  const highSpread = momentumTrades.filter((trade) => (trade.entryContext.selectedSpread ?? 0) > 0.06);
  const lowerSpread = momentumTrades.filter((trade) => (trade.entryContext.selectedSpread ?? 0) <= 0.06);
  if (highSpread.length >= 2 && lowerSpread.length >= 2) {
    const highAvg = averagePnl(highSpread);
    const lowerAvg = averagePnl(lowerSpread);
    return {
      id: "momentum-spread",
      tone: highAvg < lowerAvg ? "warning" : "positive",
      title: highAvg < lowerAvg ? "Momentum weakens above 6c spread" : "Momentum is tolerating wider spreads",
      detail: `Momentum avg P/L is ${moneyValue(highAvg)} above 6c spread versus ${moneyValue(lowerAvg)} at 6c or tighter.`,
      recommendation: highAvg < lowerAvg ? "Consider testing a max-spread rule on Momentum before enabling larger buys." : "Keep collecting before tightening Momentum spread limits.",
      sampleSize: momentumTrades.length,
    };
  }
  return {
    id: "momentum-spread",
    tone: "collecting",
    title: "Watching Momentum spread",
    detail: `${momentumTrades.length} closed Momentum trades recorded; need at least 2 wide-spread and 2 tighter-spread samples.`,
    recommendation: "No automatic change. Keep Momentum paper-only until spread buckets have enough samples.",
    sampleSize: momentumTrades.length,
  };
}

function finalMinuteInsight(closedTrades: PaperTrade[]): LearningInsight {
  const finalTrades = closedTrades.filter((trade) => trade.strategyId === "final60");
  const under45 = finalTrades.filter((trade) => trade.entryContext.secondsToClose <= 45);
  const over45 = finalTrades.filter((trade) => trade.entryContext.secondsToClose > 45);
  if (under45.length >= 2 && over45.length >= 2) {
    const underAvg = averagePnl(under45);
    const overAvg = averagePnl(over45);
    return {
      id: "final60-time",
      tone: underAvg > overAvg ? "positive" : "warning",
      title: underAvg > overAvg ? "Final-60 is stronger under 45s" : "Final-60 needs more than the last 45s",
      detail: `Under-45s avg P/L is ${moneyValue(underAvg)} versus ${moneyValue(overAvg)} before 45s.`,
      recommendation: underAvg > overAvg ? "Candidate rule: require Final-60 entries to occur with 45 seconds or less remaining." : "Do not tighten Final-60 time yet; earlier entries are not underperforming in the sample.",
      sampleSize: finalTrades.length,
    };
  }
  return {
    id: "final60-time",
    tone: "collecting",
    title: "Watching Final-60 timing",
    detail: `${finalTrades.length} closed Final-60 trades recorded; timing buckets are not balanced yet.`,
    recommendation: "Keep comparing under-45s entries against earlier entries before changing the rule.",
    sampleSize: finalTrades.length,
  };
}

function distanceInsight(closedTrades: PaperTrade[]): LearningInsight {
  const distanceTrades = closedTrades.filter((trade) => trade.strategyId === "thresholdDistance");
  const far = distanceTrades.filter((trade) => Math.abs(trade.entryContext.distanceFromTarget) >= 0.0001);
  const near = distanceTrades.filter((trade) => Math.abs(trade.entryContext.distanceFromTarget) < 0.0001);
  if (far.length >= 2 && near.length >= 2) {
    const farAvg = averagePnl(far);
    const nearAvg = averagePnl(near);
    return {
      id: "distance-threshold",
      tone: farAvg > nearAvg ? "positive" : "warning",
      title: farAvg > nearAvg ? "Threshold Distance improves when farther from target" : "Threshold Distance is not helped by the 0.0001 filter",
      detail: `Far-distance avg P/L is ${moneyValue(farAvg)} versus ${moneyValue(nearAvg)} near target.`,
      recommendation: farAvg > nearAvg ? "Candidate rule: require distance from target of at least 0.0001 before buying." : "Do not raise the distance threshold yet; current sample does not support it.",
      sampleSize: distanceTrades.length,
    };
  }
  return {
    id: "distance-threshold",
    tone: "collecting",
    title: "Watching Threshold Distance",
    detail: `${distanceTrades.length} closed distance trades recorded; near/far buckets need more settled samples.`,
    recommendation: "Keep recording distance, spread, edge, and final result before changing the distance rule.",
    sampleSize: distanceTrades.length,
  };
}

function metricForPaperStrategy(strategyId: BuiltInPaperStrategyId, strategyName: string, trades: PaperTrade[]): StrategyLearningMetrics {
  const strategyTrades = trades.filter((trade) => trade.strategyId === strategyId);
  const closed = strategyTrades.filter((trade) => trade.status === "closed" && trade.pnl !== null);
  const wins = closed.filter((trade) => (trade.pnl ?? 0) > 0).length;
  const totalPnl = roundMoney(closed.reduce((total, trade) => total + (trade.pnl ?? 0), 0));
  const totalCost = roundMoney(closed.reduce((total, trade) => total + trade.entryPrice * trade.contracts, 0));
  return {
    strategyId,
    strategyName,
    closed: closed.length,
    open: strategyTrades.filter((trade) => trade.status === "open").length,
    wins,
    losses: closed.filter((trade) => (trade.pnl ?? 0) < 0).length,
    winRate: closed.length ? roundRatio(wins / closed.length) : null,
    averagePnl: closed.length ? roundMoney(totalPnl / closed.length) : null,
    totalPnl,
    averageEdge: average(closed.map((trade) => trade.entryContext.edgeAfterFees)),
    averageSpread: average(closed.map((trade) => trade.entryContext.selectedSpread).filter((value): value is number => value !== null)),
    averageSecondsToClose: average(closed.map((trade) => trade.entryContext.secondsToClose)),
    averageDistanceFromTarget: average(closed.map((trade) => Math.abs(trade.entryContext.distanceFromTarget))),
    totalCost,
    roi: totalCost > 0 ? roundRatio(totalPnl / totalCost) : null,
  };
}

function metricForShadowVariant(variant: ShadowVariantDefinition, state: ShadowState): ShadowVariantMetrics {
  const trades = state.trades.filter((trade) => trade.variantId === variant.id);
  const closed = trades.filter((trade) => trade.status === "closed" && trade.pnl !== null);
  const wins = closed.filter((trade) => (trade.pnl ?? 0) > 0).length;
  const totalPnl = roundMoney(closed.reduce((total, trade) => total + (trade.pnl ?? 0), 0));
  const totalCost = roundMoney(closed.reduce((total, trade) => total + trade.entryPrice * trade.contracts, 0));
  return {
    variantId: variant.id,
    variantName: variant.name,
    baseStrategyId: variant.baseStrategyId,
    closed: closed.length,
    open: trades.filter((trade) => trade.status === "open").length,
    wins,
    losses: closed.filter((trade) => (trade.pnl ?? 0) < 0).length,
    winRate: closed.length ? roundRatio(wins / closed.length) : null,
    averagePnl: closed.length ? roundMoney(totalPnl / closed.length) : null,
    totalPnl,
    averageEdge: average(closed.map((trade) => trade.entryContext.edgeAfterFees)),
    totalCost,
    roi: totalCost > 0 ? roundRatio(totalPnl / totalCost) : null,
  };
}

function buildBestAlgoProjection(strategyMetrics: StrategyLearningMetrics[], shadowMetrics: ShadowVariantMetrics[]): BestAlgoProjection | null {
  const dailyBudget = 50;
  const paperCandidates = strategyMetrics
    .filter((metric) => metric.closed >= 3 && metric.roi !== null && metric.totalPnl > 0)
    .map((metric) => ({
      algorithmName: metric.strategyName,
      algorithmKind: "paper-strategy" as const,
      closed: metric.closed,
      wins: metric.wins,
      losses: metric.losses,
      winRate: metric.winRate,
      totalPnl: metric.totalPnl,
      totalCost: metric.totalCost,
      roi: metric.roi ?? 0,
    }));
  const shadowCandidates = shadowMetrics
    .filter((metric) => metric.closed >= 3 && metric.roi !== null && metric.totalPnl > 0)
    .map((metric) => ({
      algorithmName: metric.variantName,
      algorithmKind: "shadow-variant" as const,
      closed: metric.closed,
      wins: metric.wins,
      losses: metric.losses,
      winRate: metric.winRate,
      totalPnl: metric.totalPnl,
      totalCost: metric.totalCost,
      roi: metric.roi ?? 0,
    }));
  const best = [...paperCandidates, ...shadowCandidates]
    .sort((left, right) => right.roi - left.roi || right.totalPnl - left.totalPnl || right.closed - left.closed)[0];
  if (!best) return null;

  const projectedDailyProfit = roundMoney(dailyBudget * best.roi);
  return {
    ...best,
    dailyBudget,
    projectedDailyProfit,
    projectedDailyValue: roundMoney(dailyBudget + projectedDailyProfit),
    confidenceLabel: best.closed >= 50 ? "higher sample" : best.closed >= 15 ? "medium sample" : "low sample",
  };
}

function normalizeShadowTrade(value: unknown): ShadowTrade | null {
  if (!isRecord(value)
    || typeof value.id !== "string"
    || !isShadowVariantId(value.variantId)
    || typeof value.variantName !== "string"
    || !isPaperStrategyId(value.baseStrategyId)
    || typeof value.marketTicker !== "string"
    || (value.side !== "YES" && value.side !== "NO")
    || typeof value.contracts !== "number"
    || typeof value.entryPrice !== "number"
    || typeof value.targetPrice !== "number"
    || typeof value.openedAt !== "string"
    || (value.status !== "open" && value.status !== "closed")) return null;
  const entryContext = normalizeContext(value.entryContext, value.side, value.openedAt, value.targetPrice, typeof value.entryEstimate === "number" ? value.entryEstimate : value.targetPrice, value.entryPrice);
  return {
    id: value.id,
    variantId: value.variantId,
    variantName: value.variantName,
    baseStrategyId: value.baseStrategyId,
    marketTicker: value.marketTicker,
    side: value.side,
    contracts: value.contracts,
    entryPrice: value.entryPrice,
    exitPrice: typeof value.exitPrice === "number" ? value.exitPrice : null,
    targetPrice: value.targetPrice,
    openedAt: value.openedAt,
    closedAt: typeof value.closedAt === "string" ? value.closedAt : null,
    status: value.status,
    result: value.result === "Win" || value.result === "Loss" ? value.result : "-",
    pnl: typeof value.pnl === "number" ? value.pnl : null,
    entryEstimate: typeof value.entryEstimate === "number" ? value.entryEstimate : value.targetPrice,
    lastEstimate: typeof value.lastEstimate === "number" ? value.lastEstimate : value.targetPrice,
    reason: typeof value.reason === "string" ? value.reason : "Imported background test trade.",
    entryContext,
    exitContext: normalizeContextOrNull(value.exitContext, value.side, typeof value.closedAt === "string" ? value.closedAt : value.openedAt, value.targetPrice, typeof value.lastEstimate === "number" ? value.lastEstimate : value.targetPrice, typeof value.exitPrice === "number" ? value.exitPrice : null),
  };
}

function normalizeShadowEvent(value: unknown): ShadowEvent | null {
  if (!isRecord(value)
    || typeof value.id !== "string"
    || typeof value.time !== "string"
    || !isShadowVariantId(value.variantId)
    || typeof value.variantName !== "string"
    || (value.action !== "BUY" && value.action !== "SELL")
    || (value.side !== "YES" && value.side !== "NO")
    || typeof value.price !== "number"
    || typeof value.contracts !== "number") return null;
  return {
    id: value.id,
    time: value.time,
    variantId: value.variantId,
    variantName: value.variantName,
    action: value.action,
    side: value.side,
    price: value.price,
    contracts: value.contracts,
    pnl: typeof value.pnl === "number" ? value.pnl : null,
    result: value.result === "Win" || value.result === "Loss" ? value.result : "-",
  };
}

function normalizeContext(value: unknown, side: PaperSide, observedAt: string, targetPrice: number, estimate: number, price: number | null): PaperTradeContext {
  if (isRecord(value) && (value.side === "YES" || value.side === "NO")) {
    return {
      observedAt: typeof value.observedAt === "string" ? value.observedAt : observedAt,
      side: value.side,
      targetPrice: numberOrDefault(value.targetPrice, targetPrice),
      estimate: numberOrDefault(value.estimate, estimate),
      spotPrice: numberOrDefault(value.spotPrice, estimate),
      oneMinuteChange: numberOrDefault(value.oneMinuteChange, 0),
      oneMinuteMovePercent: numberOrDefault(value.oneMinuteMovePercent, 0),
      distanceFromTarget: numberOrDefault(value.distanceFromTarget, roundMarket(estimate - targetPrice)),
      fairProbability: numberOrDefault(value.fairProbability, 0),
      edgeAfterFees: numberOrDefault(value.edgeAfterFees, 0),
      confidence: numberOrDefault(value.confidence, 0),
      secondsToClose: numberOrDefault(value.secondsToClose, 0),
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
  return fallbackContext(side, observedAt, targetPrice, estimate, price);
}

function normalizeContextOrNull(value: unknown, side: PaperSide, observedAt: string, targetPrice: number, estimate: number, price: number | null): PaperTradeContext | null {
  if (value === null || value === undefined) return null;
  return normalizeContext(value, side, observedAt, targetPrice, estimate, price);
}

function contextFromInput(input: PaperEngineInput, signal: Pick<ShadowSignal, "confidence" | "edgeAfterFees" | "fairProbability">, side: PaperSide): PaperTradeContext {
  const selectedAsk = askForSide(side, input);
  const selectedBid = side === "YES" ? input.yesBid : input.noBid;
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
    yesSpread: nullableSpread(input.yesAsk, input.yesBid),
    noSpread: nullableSpread(input.noAsk, input.noBid),
  };
}

function fallbackContext(side: PaperSide, observedAt: string, targetPrice: number, estimate: number, price: number | null): PaperTradeContext {
  return {
    observedAt,
    side,
    targetPrice,
    estimate,
    spotPrice: estimate,
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

function replaceShadowTrade(trades: ShadowTrade[], next: ShadowTrade) {
  return trades.map((trade) => trade.id === next.id ? next : trade);
}

function addShadowEvent(events: ShadowEvent[], event: ShadowEvent) {
  if (events.some((item) => item.id === event.id)) return events;
  return [event, ...events].slice(0, 220);
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

function sideFromAction(action: PaperEngineInput["action"]): PaperSide | null {
  if (action === "buy_yes") return "YES";
  if (action === "buy_no") return "NO";
  return null;
}

function askForSide(side: PaperSide, input: PaperEngineInput) {
  return side === "YES" ? input.yesAsk : input.noAsk;
}

function bidForSide(side: PaperSide, input: PaperEngineInput, signal: Pick<ShadowSignal, "fairProbability">) {
  const bid = side === "YES" ? input.yesBid : input.noBid;
  if (bid !== null && bid > 0 && bid < 1) return bid;
  return clamp(side === "YES" ? signal.fairProbability : 1 - signal.fairProbability, 0, 1);
}

function spreadForSide(side: PaperSide, input: PaperEngineInput) {
  const ask = side === "YES" ? input.yesAsk : input.noAsk;
  const bid = side === "YES" ? input.yesBid : input.noBid;
  if (ask === null || bid === null) return Number.POSITIVE_INFINITY;
  return Math.max(0, ask - bid);
}

function nullableSpread(ask: number | null, bid: number | null) {
  if (ask === null || bid === null) return null;
  return roundRatio(Math.max(0, ask - bid));
}

function yesProbationAllows(side: PaperSide, edgeAfterFees: number, confidence: number, spread: number) {
  if (side !== "YES") return true;
  return edgeAfterFees >= activePaperRules.yesProbation.minEdgeAfterFees
    && confidence >= activePaperRules.yesProbation.minConfidence
    && spread <= activePaperRules.yesProbation.maxSpread;
}

function average(values: number[]) {
  if (values.length === 0) return null;
  return roundRatio(values.reduce((total, value) => total + value, 0) / values.length);
}

function averagePnl(trades: PaperTrade[]) {
  if (trades.length === 0) return 0;
  return roundMoney(trades.reduce((total, trade) => total + (trade.pnl ?? 0), 0) / trades.length);
}

function moneyValue(value: number) {
  return `${value >= 0 ? "+" : "-"}$${Math.abs(value).toFixed(2)}`;
}

function isShadowVariantId(value: unknown): value is ShadowVariantId {
  return shadowVariantDefinitions.some((variant) => variant.id === value);
}

function isPaperStrategyId(value: unknown): value is BuiltInPaperStrategyId {
  return paperStrategyDefinitions.some((strategy) => strategy.id === value);
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

function roundPrice(value: number) {
  return Number(value.toFixed(4));
}

function roundMoney(value: number) {
  return Number(value.toFixed(2));
}

function roundRatio(value: number) {
  return Number(value.toFixed(4));
}

function roundMarket(value: number) {
  return Number(value.toFixed(7));
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
