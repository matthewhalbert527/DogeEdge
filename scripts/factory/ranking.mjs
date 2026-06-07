import { normalCdf, roundMoney, roundRatio, stddev, unique } from "./utils.mjs";
import { defaultPromotionThresholds, promotionReview } from "./promotion.mjs";
import { multipleTestingAdjustments } from "./multiple-testing.mjs";

export function rankFactoryMetrics(metrics, options = {}) {
  const trialSummary = trialSummaryFor(metrics);
  const testingAdjustments = multipleTestingAdjustments(metrics, {
    bootstrapIterations: options.bootstrapIterations,
    seed: options.seed,
  });
  const withStats = metrics.map((metric) => {
    const familyTrials = trialSummary.byFamily[metric.family] ?? 1;
    const multipleTestingPenalty = multipleTestingPenaltyFor(metric, trialSummary.totalTrials, familyTrials);
    const psr = probabilisticSharpeRatio(metric);
    const dsrApprox = deflatedSharpeRatioApprox(metric, multipleTestingPenalty);
    const pboApprox = pboApproximation(metric);
    const adjusted = testingAdjustments[metric.algoId] ?? {
      familyAdjustedPValue: 1,
      globalAdjustedPValue: 1,
      falseDiscoveryRisk: 1,
    };
    const concentration = concentrationMetrics(metric);
    const adjustedConfidence = roundRatio(Math.max(0, Math.min(1, dsrApprox * (1 - pboApprox) * (1 - adjusted.falseDiscoveryRisk) - multipleTestingPenalty)));
    const robustScore = robustScoreFor(metric, { adjustedConfidence, concentration, multipleTestingPenalty, adjusted });
    const review = promotionReview({
      ...metric,
      adjustedConfidence,
      concentration,
      ...adjusted,
    }, options.thresholds ?? defaultPromotionThresholds);
    return {
      ...metric,
      trialSummary,
      effectiveFamilyTrials: familyTrials,
      effectiveTotalTrials: trialSummary.totalTrials,
      multipleTestingPenalty,
      psr,
      dsrApprox,
      pboApprox,
      ...adjusted,
      adjustedConfidence,
      concentration,
      robustScore,
      candidateScore: robustScore,
      ...review,
    };
  });
  return withStats.sort((left, right) => right.robustScore - left.robustScore || right.totalPnl - left.totalPnl || right.closed - left.closed);
}

export function candidateMetrics(metrics) {
  return metrics
    .filter((metric) => metric.promotionVerdict === "paper_only" || metric.promotionVerdict === "tiny_live_eligible")
    .sort((left, right) => right.robustScore - left.robustScore || right.costModels?.conservative?.totalPnl - left.costModels?.conservative?.totalPnl);
}

function robustScoreFor(metric, context) {
  const conservative = metric.costModels?.conservative ?? metric;
  const stress = metric.costModels?.stress ?? null;
  const fold = metric.foldSummary ?? {};
  const cpcv = metric.cpcvSummary ?? {};
  const walkForward = metric.walkForwardSummary ?? {};
  const holdout = metric.holdoutSummary ?? {};
  const paperEvidence = metric.paperEvidence ?? {};
  const ciLower = conservative.bootstrap?.meanPnl?.lower ?? -1;
  const drawdownPenalty = Math.abs(Math.min(0, metric.maxDrawdown ?? 0)) * 0.08;
  const sampleBonus = Math.log10((metric.independentClosedMarkets ?? 0) + 1) * 6;
  const consistency = (fold.positiveFoldRate ?? 0) * 25;
  const cpcvScore = (cpcv.positiveFoldRate ?? 0) * 18 + Math.max(-5, Math.min(8, cpcv.medianFoldPnl ?? 0));
  const walkForwardScore = walkForward.pass || metric.walkForwardPass ? 12 : -25;
  const holdoutScore = holdout.holdoutPass || metric.holdoutPass ? 20 : -40;
  const paperScore = paperEvidence.available ? paperEvidence.driftOk ? Math.min(8, (paperEvidence.closedMarkets ?? 0) / 10) : -30 : 0;
  const confidence = context.adjustedConfidence * 25;
  const pnl = conservative.totalPnl * 2 + (stress?.totalPnl ?? 0) * 0.5;
  const risk = (conservative.downsideDeviation ?? 0) * 4 + drawdownPenalty;
  const concentrationPenalty = ((context.concentration.maxMarketShare ?? 0) + (context.concentration.maxDayShare ?? 0) + (context.concentration.maxRegimeShare ?? 0)) * 10;
  const ciPenalty = ciLower < 0 ? Math.abs(ciLower) * 8 : 0;
  const pValuePenalty = ((context.adjusted.familyAdjustedPValue ?? 1) + (context.adjusted.globalAdjustedPValue ?? 1) + (context.adjusted.falseDiscoveryRisk ?? 1)) * 10;
  return roundRatio(pnl + sampleBonus + consistency + cpcvScore + walkForwardScore + holdoutScore + paperScore + confidence - risk - concentrationPenalty - ciPenalty - context.multipleTestingPenalty * 20 - pValuePenalty);
}

function probabilisticSharpeRatio(metric) {
  const sharpe = metric.sharpeLike ?? 0;
  const n = Math.max(1, metric.closed ?? 0);
  const denominator = Math.sqrt(Math.max(1e-9, 1 - 0 * sharpe + ((sharpe ** 2) / 4)));
  return roundRatio(normalCdf((sharpe * Math.sqrt(Math.max(1, n - 1))) / denominator));
}

function deflatedSharpeRatioApprox(metric, penalty) {
  const psr = probabilisticSharpeRatio(metric);
  return roundRatio(Math.max(0, psr - penalty));
}

function pboApproximation(metric) {
  const folds = metric.foldMetrics ?? [];
  const tested = folds.filter((fold) => fold.closed > 0);
  if (!tested.length) return 1;
  const poor = tested.filter((fold) => fold.totalPnl <= 0 || (fold.roi ?? 0) <= 0).length;
  return roundRatio(poor / tested.length);
}

function multipleTestingPenaltyFor(metric, totalTrials, familyTrials) {
  const paramCount = Object.keys(metric.params ?? {}).length;
  const complexity = Math.log1p(paramCount) * 0.01;
  return roundRatio(Math.min(0.45, Math.log1p(totalTrials) * 0.018 + Math.log1p(familyTrials) * 0.012 + complexity));
}

function concentrationMetrics(metric) {
  const trades = metric.closedTrades ?? [];
  const positivePnl = Math.max(0.0001, trades.filter((trade) => trade.pnl > 0).reduce((total, trade) => total + trade.pnl, 0));
  const byMarket = maxShare(trades, positivePnl, (trade) => trade.marketTicker);
  const byDay = maxShare(trades, positivePnl, (trade) => String(trade.closedAt ?? trade.openedAt).slice(0, 10));
  const bySide = maxShare(trades, positivePnl, (trade) => trade.side);
  const byRegime = maxShare(trades, positivePnl, (trade) => trade.entryContext?.regime?.timeToClose ?? "unknown");
  return {
    maxMarketShare: byMarket,
    maxDayShare: byDay,
    maxSideShare: bySide,
    maxRegimeShare: byRegime,
  };
}

function maxShare(trades, positivePnl, keyFn) {
  const groups = new Map();
  for (const trade of trades.filter((item) => item.pnl > 0)) {
    const key = keyFn(trade);
    groups.set(key, (groups.get(key) ?? 0) + trade.pnl);
  }
  if (!groups.size) return 0;
  return roundRatio(Math.max(...groups.values()) / positivePnl);
}

function trialSummaryFor(metrics) {
  const byFamily = {};
  for (const metric of metrics) {
    byFamily[metric.family] = (byFamily[metric.family] ?? 0) + 1;
  }
  return {
    totalTrials: metrics.length,
    byFamily,
    families: unique(metrics.map((metric) => metric.family)),
  };
}

export function attachClosedTrades(metric, trades) {
  const closedTrades = trades.filter((trade) => trade.status === "closed" && typeof trade.pnl === "number");
  return {
    ...metric,
    closedTrades,
    closedTradePnlStdDev: roundMoney(stddev(closedTrades.map((trade) => trade.pnl)) ?? 0),
  };
}
