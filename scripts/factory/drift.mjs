import { average, roundRatio } from "./utils.mjs";

export const defaultDriftThresholds = {
  pageHinkleyDelta: 0.005,
  pageHinkleyLambda: 0.35,
  maxRegimeShareDelta: 0.35,
  maxFillRateDelta: 0.25,
  maxSlippageDelta: 0.03,
  minPaperTradesForDecision: 20,
};

export function detectEvidenceDrift({ validationTrades = [], paperTrades = [], validationRegimes = {}, paperRegimes = {}, validationFill = {}, paperFill = {}, thresholds = defaultDriftThresholds } = {}) {
  const minPaperTrades = Math.max(1, Number(thresholds.minPaperTradesForDecision ?? defaultDriftThresholds.minPaperTradesForDecision));
  if (paperTrades.length < minPaperTrades) {
    return {
      driftOk: true,
      driftReasons: [],
      driftScore: 0,
      sampleStatus: "insufficient_paper_sample_warning_only",
      warnings: ["insufficient_paper_sample_for_drift_decision"],
      components: {
        pnl: { drift: false, score: 0, maxDeviation: 0, mean: average(paperTrades.map((trade) => Number(trade.pnl ?? 0))) ?? 0 },
        regime: regimeShareDrift(validationRegimes, paperRegimes, thresholds),
        fill: fillQualityDrift(validationFill, paperFill, thresholds),
        validationTradeCount: validationTrades.length,
        paperTradeCount: paperTrades.length,
        minPaperTradesForDecision: minPaperTrades,
      },
    };
  }
  const pnl = pageHinkleyDrift(paperTrades.map((trade) => Number(trade.pnl ?? 0)), thresholds);
  const regime = regimeShareDrift(validationRegimes, paperRegimes, thresholds);
  const fill = fillQualityDrift(validationFill, paperFill, thresholds);
  const driftReasons = [
    ...(pnl.drift ? ["pnl_page_hinkley_drift"] : []),
    ...(regime.drift ? ["regime_share_drift"] : []),
    ...(fill.drift ? ["fill_quality_drift"] : []),
  ];
  const driftScore = roundRatio(Math.min(1, pnl.score + regime.score + fill.score));
  return {
    driftOk: driftReasons.length === 0,
    driftReasons,
    driftScore,
    components: {
      pnl,
      regime,
      fill,
      validationTradeCount: validationTrades.length,
      paperTradeCount: paperTrades.length,
    },
  };
}

export function pageHinkleyDrift(values, thresholds = defaultDriftThresholds) {
  if (values.length < 8) return { drift: false, score: 0, maxDeviation: 0, mean: average(values) ?? 0 };
  const delta = thresholds.pageHinkleyDelta;
  const lambda = thresholds.pageHinkleyLambda;
  let mean = 0;
  let cumulative = 0;
  let minCumulative = 0;
  let maxDeviation = 0;
  for (let index = 0; index < values.length; index += 1) {
    mean += (values[index] - mean) / (index + 1);
    cumulative += values[index] - mean - delta;
    minCumulative = Math.min(minCumulative, cumulative);
    maxDeviation = Math.max(maxDeviation, cumulative - minCumulative);
  }
  return {
    drift: maxDeviation > lambda,
    score: roundRatio(Math.min(1, maxDeviation / Math.max(lambda, 0.0001))),
    maxDeviation: roundRatio(maxDeviation),
    mean: roundRatio(mean),
  };
}

export function regimeShareDrift(validationRegimes, paperRegimes, thresholds = defaultDriftThresholds) {
  const keys = new Set([...Object.keys(validationRegimes ?? {}), ...Object.keys(paperRegimes ?? {})]);
  let maxDelta = 0;
  for (const key of keys) {
    const left = Number(validationRegimes?.[key] ?? 0);
    const right = Number(paperRegimes?.[key] ?? 0);
    maxDelta = Math.max(maxDelta, Math.abs(left - right));
  }
  return {
    drift: maxDelta > thresholds.maxRegimeShareDelta,
    score: roundRatio(Math.min(1, maxDelta / Math.max(thresholds.maxRegimeShareDelta, 0.0001))),
    maxDelta: roundRatio(maxDelta),
  };
}

export function fillQualityDrift(validationFill, paperFill, thresholds = defaultDriftThresholds) {
  const fillRateDelta = Math.abs(Number(validationFill.fillRate ?? 0) - Number(paperFill.fillRate ?? 0));
  const slippageDelta = Math.abs(Number(validationFill.avgSlippage ?? 0) - Number(paperFill.avgSlippage ?? 0));
  const fillRateDrift = fillRateDelta > thresholds.maxFillRateDelta;
  const slippageDrift = slippageDelta > thresholds.maxSlippageDelta;
  return {
    drift: fillRateDrift || slippageDrift,
    score: roundRatio(Math.min(1, (fillRateDelta / Math.max(thresholds.maxFillRateDelta, 0.0001) + slippageDelta / Math.max(thresholds.maxSlippageDelta, 0.0001)) / 2)),
    fillRateDelta: roundRatio(fillRateDelta),
    slippageDelta: roundRatio(slippageDelta),
  };
}
