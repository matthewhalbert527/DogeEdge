import { eventSort } from "./splits.mjs";

export const defaultHoldoutConfig = {
  holdoutRatio: 0.2,
  minHoldoutEvents: 12,
};

export function finalHoldoutSplit(events, options = {}) {
  const sorted = [...events].sort(eventSort);
  if (!sorted.length) {
    return {
      researchEvents: [],
      holdoutEvents: [],
      holdoutEventIds: [],
      immutable: true,
      strictlyLater: true,
      latestResearchEnd: null,
      earliestHoldoutStart: null,
      reason: "no_events",
    };
  }
  const ratio = clampRatio(options.holdoutRatio ?? defaultHoldoutConfig.holdoutRatio);
  const minEvents = Math.max(1, Math.floor(Number(options.minHoldoutEvents ?? defaultHoldoutConfig.minHoldoutEvents)));
  const holdoutCount = Math.min(sorted.length, Math.max(minEvents, Math.ceil(sorted.length * ratio)));
  const holdoutStart = Math.max(0, sorted.length - holdoutCount);
  const researchEvents = sorted.slice(0, holdoutStart);
  const holdoutEvents = sorted.slice(holdoutStart);
  const latestResearchEnd = Math.max(0, ...researchEvents.map((event) => event.labelWindowEndMs ?? 0));
  const earliestHoldoutStart = Math.min(...holdoutEvents.map((event) => event.labelWindowStartMs ?? event.labelWindowEndMs ?? 0));
  const strictlyLater = researchEvents.length === 0 || earliestHoldoutStart >= latestResearchEnd;
  return {
    researchEvents,
    holdoutEvents,
    holdoutEventIds: holdoutEvents.map((event) => event.id),
    immutable: true,
    strictlyLater,
    latestResearchEnd: researchEvents.length ? new Date(latestResearchEnd).toISOString() : null,
    earliestHoldoutStart: holdoutEvents.length ? new Date(earliestHoldoutStart).toISOString() : null,
    reason: strictlyLater ? "ok" : "holdout_overlaps_research",
  };
}

export function holdoutSummary({ baseMetric, conservativeMetric, thresholds = {} }) {
  const minClosed = Math.max(1, Number(thresholds.minHoldoutClosed ?? 10));
  const minMarkets = Math.max(1, Number(thresholds.minHoldoutMarkets ?? minClosed));
  const minRoi = Number(thresholds.minHoldoutRoi ?? 0);
  const minLowerCi = Number(thresholds.minHoldoutExpectancyLowerBound ?? 0);
  const lowerCi = conservativeMetric?.bootstrap?.meanPnl?.lower ?? null;
  const holdoutPass = Boolean(
    conservativeMetric
    && conservativeMetric.closed >= minClosed
    && conservativeMetric.independentClosedMarkets >= minMarkets
    && conservativeMetric.totalPnl > 0
    && conservativeMetric.roi >= minRoi
    && lowerCi !== null
    && lowerCi >= minLowerCi
  );
  return {
    holdoutClosed: baseMetric?.closed ?? 0,
    holdoutMarkets: baseMetric?.independentClosedMarkets ?? 0,
    holdoutTotalPnl: baseMetric?.totalPnl ?? 0,
    holdoutRoi: baseMetric?.roi ?? 0,
    holdoutMaxDrawdown: baseMetric?.maxDrawdown ?? 0,
    holdoutPositive: (baseMetric?.totalPnl ?? 0) > 0,
    holdoutConservativeClosed: conservativeMetric?.closed ?? 0,
    holdoutConservativeMarkets: conservativeMetric?.independentClosedMarkets ?? 0,
    holdoutConservativeTotalPnl: conservativeMetric?.totalPnl ?? 0,
    holdoutConservativeRoi: conservativeMetric?.roi ?? 0,
    holdoutLowerCi: lowerCi,
    holdoutPass,
  };
}

function clampRatio(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return defaultHoldoutConfig.holdoutRatio;
  return Math.min(0.5, Math.max(0.05, parsed));
}
