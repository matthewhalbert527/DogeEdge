export type TradeSide = "YES" | "NO";
export type TradeAction = "buy_yes" | "buy_no" | "skip";
export type GateStatus = "allowed" | "blocked";
export type StrategyStatus = "Draft" | "Backtest Passed" | "Walk-Forward Passed" | "Paper Testing" | "Tiny Live Enabled" | "Rejected";

export interface PriceSample {
  observedAt: string;
  price: number;
  source: string;
  latencyMs: number;
}

export interface OrderBookLevel {
  price: number;
  size: number;
}

export interface KalshiOrderBook {
  yesBids: OrderBookLevel[];
  yesAsks: OrderBookLevel[];
  noBids: OrderBookLevel[];
  noAsks: OrderBookLevel[];
  observedAt: string;
}

export interface SettlementEstimate {
  estimate: number;
  averageSoFar: number | null;
  completedSeconds: number;
  remainingSeconds: number;
  requiredRemainingAverageForYes: number | null;
  couldStillFlip: boolean;
  confidence: number;
  confidenceLabel: "low" | "medium" | "high";
  sourceLabel: "exchange-estimate" | "coinbase-spot" | "cf-rti" | "dual-source";
  reason: string;
}

export interface StrategyDecision {
  action: TradeAction;
  fairProbability: number;
  impliedProbability: number;
  maxAcceptablePrice: number;
  edgeAfterFees: number;
  confidence: number;
  sizeContracts: number;
  reason: string;
  riskFlags: string[];
  strategyVersion: string;
}

export interface RiskConfig {
  paperOnly: boolean;
  killSwitchArmed: boolean;
  liveEnabled: boolean;
  maxTradeCostUsd: number;
  maxDailyCostUsd: number;
  maxSpread: number;
  maxLatencyMs: number;
  minConfidence: number;
  minEdgeAfterFees: number;
  minSecondsToClose: number;
  maxSecondsToClose: number;
}

export interface RiskInput {
  decision: StrategyDecision;
  book: KalshiOrderBook;
  latestSample: PriceSample;
  secondsToClose: number;
  dailyLiveCostUsd: number;
  openLivePositions: number;
}

export interface RiskGateResult {
  status: GateStatus;
  reasons: string[];
  maxCostUsd: number;
  spread: number;
}

export interface StrategyMetrics {
  trades: number;
  roi: number;
  maxDrawdown: number;
  winRate: number;
  edgeCapture: number;
  paperTrades: number;
  paperEdgePreserved: boolean;
  dataQuality: number;
}

export const defaultRiskConfig: RiskConfig = {
  paperOnly: true,
  killSwitchArmed: true,
  liveEnabled: false,
  maxTradeCostUsd: 5,
  maxDailyCostUsd: 25,
  maxSpread: 0.035,
  maxLatencyMs: 750,
  minConfidence: 70,
  minEdgeAfterFees: 0.035,
  minSecondsToClose: 12,
  maxSecondsToClose: 13 * 60,
};

export function estimateFinalMinuteSettlement(
  targetPrice: number,
  finalMinuteSamples: PriceSample[],
  latestPrice: number,
  options: {
    finalWindowSeconds?: number;
    plausibleMoveBuffer?: number;
    sourceLabel?: SettlementEstimate["sourceLabel"];
  } = {},
): SettlementEstimate {
  const finalWindowSeconds = options.finalWindowSeconds ?? 60;
  const plausibleMoveBuffer = options.plausibleMoveBuffer ?? 0.004;
  const completedSeconds = Math.min(finalWindowSeconds, finalMinuteSamples.length);
  const remainingSeconds = Math.max(0, finalWindowSeconds - completedSeconds);
  const sum = finalMinuteSamples.slice(-finalWindowSeconds).reduce((total, sample) => total + sample.price, 0);
  const averageSoFar = completedSeconds > 0 ? sum / completedSeconds : null;
  const estimate = completedSeconds > 0
    ? (sum + latestPrice * remainingSeconds) / finalWindowSeconds
    : latestPrice;
  const requiredRemainingAverageForYes = remainingSeconds > 0
    ? ((targetPrice * finalWindowSeconds) - sum) / remainingSeconds
    : null;
  const plausibleLow = latestPrice - plausibleMoveBuffer;
  const plausibleHigh = latestPrice + plausibleMoveBuffer;
  const couldStillFlip = remainingSeconds > 0
    && requiredRemainingAverageForYes !== null
    && requiredRemainingAverageForYes >= plausibleLow
    && requiredRemainingAverageForYes <= plausibleHigh;
  const distance = Math.abs(estimate - targetPrice);
  const timeCertainty = 1 - remainingSeconds / finalWindowSeconds;
  const distanceCertainty = Math.min(1, distance / Math.max(0.0001, plausibleMoveBuffer));
  const confidence = clamp(Math.round((timeCertainty * 45 + distanceCertainty * 55) * (couldStillFlip ? 0.7 : 1)), 0, 100);
  const confidenceLabel = confidence >= 78 ? "high" : confidence >= 55 ? "medium" : "low";

  return {
    estimate: roundPrice(estimate),
    averageSoFar: averageSoFar === null ? null : roundPrice(averageSoFar),
    completedSeconds,
    remainingSeconds,
    requiredRemainingAverageForYes: requiredRemainingAverageForYes === null ? null : roundPrice(requiredRemainingAverageForYes),
    couldStillFlip,
    confidence,
    confidenceLabel,
    sourceLabel: options.sourceLabel ?? "exchange-estimate",
    reason: couldStillFlip
      ? "Remaining seconds can still move the final average across target."
      : "Current average and remaining window make a threshold flip unlikely within the configured buffer.",
  };
}

export function probabilityFromSettlementEstimate(targetPrice: number, estimate: SettlementEstimate, volatilityBuffer = 0.006) {
  const z = (estimate.estimate - targetPrice) / Math.max(0.0001, volatilityBuffer);
  return clamp(1 / (1 + Math.exp(-z * 2.2)), 0.01, 0.99);
}

export function evaluateStrategy(input: {
  targetPrice: number;
  estimate: SettlementEstimate;
  yesAsk: number;
  noAsk: number;
  feeRate: number;
  spreadPenalty: number;
  strategyVersion: string;
}): StrategyDecision {
  const fairProbability = probabilityFromSettlementEstimate(input.targetPrice, input.estimate);
  const yesEdge = fairProbability - input.yesAsk - input.feeRate - input.spreadPenalty;
  const noProbability = 1 - fairProbability;
  const noEdge = noProbability - input.noAsk - input.feeRate - input.spreadPenalty;
  const action: TradeAction = yesEdge > noEdge && yesEdge > 0 ? "buy_yes" : noEdge > 0 ? "buy_no" : "skip";
  const bestEdge = action === "buy_yes" ? yesEdge : action === "buy_no" ? noEdge : Math.max(yesEdge, noEdge);
  const impliedProbability = action === "buy_no" ? input.noAsk : input.yesAsk;
  const confidence = Math.max(0, Math.min(100, input.estimate.confidence - (input.estimate.couldStillFlip ? 12 : 0)));
  return {
    action,
    fairProbability: roundRatio(action === "buy_no" ? noProbability : fairProbability),
    impliedProbability: roundRatio(impliedProbability),
    maxAcceptablePrice: roundRatio(Math.max(0, (action === "buy_no" ? noProbability : fairProbability) - input.feeRate - input.spreadPenalty)),
    edgeAfterFees: roundRatio(bestEdge),
    confidence,
    sizeContracts: action === "skip" ? 0 : confidence >= 82 ? 8 : confidence >= 70 ? 4 : 1,
    reason: action === "skip"
      ? "No side clears edge after fee and spread penalties."
      : `${action === "buy_yes" ? "YES" : "NO"} has the strongest post-cost edge.`,
    riskFlags: input.estimate.couldStillFlip ? ["final_window_can_still_flip"] : [],
    strategyVersion: input.strategyVersion,
  };
}

export function evaluateRiskGate(input: RiskInput, config: RiskConfig = defaultRiskConfig): RiskGateResult {
  const reasons: string[] = [];
  const ask = input.decision.action === "buy_no"
    ? bestAsk(input.book.noAsks)
    : input.decision.action === "buy_yes"
      ? bestAsk(input.book.yesAsks)
      : null;
  const bid = input.decision.action === "buy_no"
    ? bestBid(input.book.noBids)
    : input.decision.action === "buy_yes"
      ? bestBid(input.book.yesBids)
      : null;
  const spread = ask !== null && bid !== null ? ask - bid : Number.POSITIVE_INFINITY;
  const maxCostUsd = ask === null ? 0 : Number((ask * input.decision.sizeContracts).toFixed(2));

  if (input.decision.action === "skip") reasons.push("strategy selected skip");
  if (config.paperOnly) reasons.push("paper-only mode is active");
  if (config.killSwitchArmed) reasons.push("kill switch is armed");
  if (!config.liveEnabled) reasons.push("live trading is not enabled");
  if (maxCostUsd > config.maxTradeCostUsd) reasons.push("order exceeds per-trade live cap");
  if (input.dailyLiveCostUsd + maxCostUsd > config.maxDailyCostUsd) reasons.push("daily live cap would be exceeded");
  if (!Number.isFinite(spread) || spread > config.maxSpread) reasons.push("spread is too wide");
  if (input.latestSample.latencyMs > config.maxLatencyMs) reasons.push("exchange feed latency is too high");
  if (input.decision.confidence < config.minConfidence) reasons.push("confidence is below live threshold");
  if (input.decision.edgeAfterFees < config.minEdgeAfterFees) reasons.push("post-cost edge is below live threshold");
  if (input.secondsToClose < config.minSecondsToClose) reasons.push("contract is too close to expiration");
  if (input.secondsToClose > config.maxSecondsToClose) reasons.push("contract is too far from expiration for this strategy");
  if (input.openLivePositions > 0) reasons.push("existing live DOGE position is open");

  return {
    status: reasons.length === 0 ? "allowed" : "blocked",
    reasons,
    maxCostUsd,
    spread: Number.isFinite(spread) ? roundRatio(spread) : spread,
  };
}

export function promoteStrategy(metrics: StrategyMetrics): StrategyStatus {
  if (metrics.trades < 80 || metrics.dataQuality < 0.8) return "Draft";
  if (metrics.roi <= 0 || metrics.maxDrawdown > 0.22 || metrics.winRate < 0.54 || metrics.edgeCapture < 0.45) return "Rejected";
  if (metrics.paperTrades >= 40 && metrics.paperEdgePreserved) return "Tiny Live Enabled";
  if (metrics.paperTrades >= 12) return "Paper Testing";
  if (metrics.trades >= 160 && metrics.maxDrawdown <= 0.16) return "Walk-Forward Passed";
  return "Backtest Passed";
}

function bestAsk(levels: OrderBookLevel[]) {
  return levels.length ? Math.min(...levels.map((level) => level.price)) : null;
}

function bestBid(levels: OrderBookLevel[]) {
  return levels.length ? Math.max(...levels.map((level) => level.price)) : null;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function roundPrice(value: number) {
  return Number(value.toFixed(6));
}

function roundRatio(value: number) {
  return Number(value.toFixed(4));
}
