import { average, normalCdf, normalInv, roundMoney, roundRatio, stddev, unique } from "./utils.mjs";
import { defaultPromotionThresholds, promotionReview } from "./promotion.mjs";
import { multipleTestingAdjustments } from "./multiple-testing.mjs";

export function rankFactoryMetrics(metrics, options = {}) {
  const trialSummary = trialSummaryFor(metrics);
  const testingAdjustments = multipleTestingAdjustments(metrics, {
    bootstrapIterations: options.bootstrapIterations,
    seed: options.seed,
  });
  const pboByAlgo = pboRankDegradationMap(metrics);
  const withStats = metrics.map((metric) => {
    const familyTrials = trialSummary.byFamily[metric.family] ?? 1;
    const multipleTestingPenalty = multipleTestingPenaltyFor(metric, trialSummary.totalTrials, familyTrials);
    const psr = probabilisticSharpeRatio(metric);
    const dsrApprox = deflatedSharpeRatioApprox(metric, trialSummary.totalTrials);
    const pboApprox = pboByAlgo.get(metric.algoId) ?? pboRankDegradationApprox(metric, metrics);
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
      pboMethod: "cpcv_train_validation_rank_degradation_approx",
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

export function probabilisticSharpeRatio(metric, benchmarkSharpe = 0) {
  const sharpe = perTradeSharpe(metric);
  const n = Math.max(1, metric.returnMoments?.n ?? metric.closed ?? 0);
  const skew = Number(metric.returnMoments?.skewness ?? metric.skewness ?? momentsFromTrades(metric).skewness ?? 0);
  const kurtosis = Math.max(1.0001, Number(metric.returnMoments?.kurtosis ?? metric.kurtosis ?? momentsFromTrades(metric).kurtosis ?? 3));
  const numerator = (sharpe - benchmarkSharpe) * Math.sqrt(Math.max(1, n - 1));
  const denominator = Math.sqrt(Math.max(1e-9, 1 - skew * sharpe + ((kurtosis - 1) / 4) * sharpe ** 2));
  return roundRatio(normalCdf(numerator / denominator));
}

export function deflatedSharpeRatioApprox(metric, totalTrials = 1) {
  const n = Math.max(2, metric.returnMoments?.n ?? metric.closed ?? 0);
  const effectiveTrials = Math.max(1, Number(metric.effectiveTotalTrials ?? totalTrials));
  const skew = Number(metric.returnMoments?.skewness ?? metric.skewness ?? momentsFromTrades(metric).skewness ?? 0);
  const kurtosis = Math.max(1.0001, Number(metric.returnMoments?.kurtosis ?? metric.kurtosis ?? momentsFromTrades(metric).kurtosis ?? 3));
  const sharpe = perTradeSharpe(metric);
  const srStd = Math.sqrt(Math.max(1e-9, 1 - skew * sharpe + ((kurtosis - 1) / 4) * sharpe ** 2)) / Math.sqrt(n - 1);
  const eulerGamma = 0.5772156649015329;
  const expectedMaxZ = effectiveTrials <= 1
    ? 0
    : (1 - eulerGamma) * normalInv(1 - 1 / effectiveTrials) + eulerGamma * normalInv(1 - 1 / (effectiveTrials * Math.E));
  const benchmarkSharpe = Math.max(0, expectedMaxZ * srStd);
  return probabilisticSharpeRatio(metric, benchmarkSharpe);
}

export function pboRankDegradationApprox(metric, menuMetrics) {
  return pboRankDegradationMap(menuMetrics).get(metric.algoId) ?? fallbackFoldFailurePbo(metric);
}

function pboRankDegradationMap(menuMetrics) {
  const foldIds = [...new Set(menuMetrics.flatMap((metric) => (Array.isArray(metric.cpcvMetrics) && metric.cpcvMetrics.length ? metric.cpcvMetrics : metric.foldMetrics ?? []).map((fold) => fold.foldId).filter(Boolean)))];
  if (!foldIds.length || menuMetrics.length < 2) return new Map(menuMetrics.map((metric) => [metric.algoId, fallbackFoldFailurePbo(metric)]));
  const ranksByFold = new Map(foldIds.map((foldId) => [foldId, {
    train: rankByFold(menuMetrics, foldId, "cpcvTrainMetrics"),
    validation: rankByFold(menuMetrics, foldId, "cpcvMetrics"),
  }]));
  const result = new Map();
  for (const metric of menuMetrics) {
    const validation = Array.isArray(metric.cpcvMetrics) && metric.cpcvMetrics.length ? metric.cpcvMetrics : metric.foldMetrics ?? [];
    const train = Array.isArray(metric.cpcvTrainMetrics) && metric.cpcvTrainMetrics.length ? metric.cpcvTrainMetrics : [];
    if (!validation.length || !train.length) {
      result.set(metric.algoId, fallbackFoldFailurePbo(metric));
      continue;
    }
    let eligiblePaths = 0;
    let degradedPaths = 0;
    for (const foldId of validation.map((fold) => fold.foldId).filter(Boolean)) {
      const ranks = ranksByFold.get(foldId);
      const trainRank = ranks?.train.get(metric.algoId);
      const validationRank = ranks?.validation.get(metric.algoId);
      if (!trainRank || !validationRank) continue;
      if (trainRank.percentile >= 0.5) {
        eligiblePaths += 1;
        if (validationRank.percentile < 0.5 || validationRank.percentile < trainRank.percentile - 0.25) degradedPaths += 1;
      }
    }
    result.set(metric.algoId, eligiblePaths ? roundRatio(degradedPaths / eligiblePaths) : fallbackFoldFailurePbo(metric));
  }
  return result;
}

function fallbackFoldFailurePbo(metric) {
  const folds = metric.foldMetrics ?? [];
  const tested = folds.filter((fold) => fold.closed > 0);
  if (!tested.length) return 1;
  const poor = tested.filter((fold) => fold.totalPnl <= 0 || (fold.roi ?? 0) <= 0).length;
  return roundRatio(poor / tested.length);
}

function rankByFold(metrics, foldId, field) {
  const rows = metrics
    .map((metric) => {
      const fold = (metric[field] ?? []).find((item) => item.foldId === foldId);
      if (!fold || fold.closed <= 0) return null;
      return {
        algoId: metric.algoId,
        score: foldStatistic(fold),
      };
    })
    .filter(Boolean)
    .sort((left, right) => right.score - left.score);
  const denominator = Math.max(1, rows.length - 1);
  return new Map(rows.map((row, index) => [row.algoId, {
    rank: index + 1,
    percentile: roundRatio(1 - index / denominator),
    score: row.score,
  }]));
}

function foldStatistic(fold) {
  const pnl = Number(fold.totalPnl ?? 0);
  const roi = Number(fold.roi ?? 0);
  const closed = Number(fold.closed ?? 0);
  const drawdownPenalty = Math.abs(Math.min(0, Number(fold.maxDrawdown ?? 0))) * 0.2;
  return pnl + roi * 2 + Math.log1p(closed) * 0.05 - drawdownPenalty;
}

function perTradeSharpe(metric) {
  if (Array.isArray(metric.closedTrades) && metric.closedTrades.length > 1) {
    const pnl = metric.closedTrades.map((trade) => Number(trade.pnl ?? 0)).filter(Number.isFinite);
    const mean = average(pnl) ?? 0;
    const risk = stddev(pnl) ?? 0;
    return risk > 0 ? mean / risk : mean > 0 ? 10 : 0;
  }
  const n = Math.max(1, metric.closed ?? 0);
  return Number(metric.sharpeLike ?? 0) / Math.sqrt(n);
}

function momentsFromTrades(metric) {
  const values = (metric.closedTrades ?? []).map((trade) => Number(trade.pnl ?? 0)).filter(Number.isFinite);
  const n = values.length;
  const mean = average(values) ?? 0;
  const risk = stddev(values) ?? 0;
  if (n < 3 || risk <= 0) return { skewness: 0, kurtosis: 3 };
  const normalized = values.map((value) => (value - mean) / risk);
  const skewness = n / ((n - 1) * (n - 2)) * normalized.reduce((total, value) => total + value ** 3, 0);
  const kurtosis = normalized.reduce((total, value) => total + value ** 4, 0) / n;
  return { skewness, kurtosis };
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
