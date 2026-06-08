import { roundRatio } from "./utils.mjs";

export const defaultSearchBudgetPolicy = {
  minEventsForBroadSweep: 250,
  minOfficialSettlementCoverage: 0.95,
  lowEvidenceSweepCap: 250,
  lowEvidenceDeepSweepAllowed: false,
};

export function searchBudgetDecision({
  eventCount = 0,
  officialSettlementCoverage = 0,
  requestedSweepAlgos = 0,
  sweepMode = false,
  deepSweepMode = false,
  policy = {},
} = {}) {
  const config = { ...defaultSearchBudgetPolicy, ...policy };
  const reasonCodes = [];
  if (eventCount < config.minEventsForBroadSweep) reasonCodes.push("search_budget_limited_by_sample_size");
  if (officialSettlementCoverage < config.minOfficialSettlementCoverage) reasonCodes.push("deep_sweep_blocked_low_official_coverage");
  const limited = sweepMode && reasonCodes.length > 0;
  const deepSweepAllowed = !deepSweepMode
    ? false
    : !limited || config.lowEvidenceDeepSweepAllowed === true;
  const maxGeneratedAlgos = limited
    ? Math.max(0, Math.min(requestedSweepAlgos, config.lowEvidenceSweepCap))
    : requestedSweepAlgos;
  return {
    schemaVersion: "dogeedge.factory.search-budget.v1",
    sweepMode,
    requestedDeepSweepMode: deepSweepMode,
    deepSweepAllowed,
    limited,
    reasonCodes,
    eventCount,
    officialSettlementCoverage: roundRatio(officialSettlementCoverage),
    requestedSweepAlgos,
    maxGeneratedAlgos,
    policy: config,
  };
}
