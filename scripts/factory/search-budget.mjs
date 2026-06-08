import { roundRatio } from "./utils.mjs";
import { familyRegistryEntry, familyResearchSupported } from "./family-registry.mjs";

export const defaultSearchBudgetPolicy = {
  minEventsForBroadSweep: 250,
  minOfficialSettlementCoverage: 0.95,
  lowEvidenceSweepCap: 250,
  lowEvidenceDeepSweepAllowed: false,
  lowEvidenceFamilyPilotCount: 50,
  priorityResearchFamilies: ["sweep-model", "sweep-scalp", "sweep-liquidity-imbalance"],
  allowUnsupportedFamilyMinting: false,
  unsupportedFamilyShadowCap: 0,
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

export function applyFamilySearchBudget(algos = [], decision = {}, { selectedAlgoIds = null, policy = {} } = {}) {
  const requested = Array.isArray(algos) ? algos : [];
  const config = { ...defaultSearchBudgetPolicy, ...(decision.policy ?? {}), ...policy };
  const maxGeneratedAlgos = selectedAlgoIds
    ? requested.length
    : Math.max(0, Math.min(requested.length, Number(decision.maxGeneratedAlgos ?? requested.length)));
  const groups = groupByFamily(requested);
  const selected = [];
  const selectedIds = new Set();
  const selectedCounts = new Map();
  const familyOrder = [...groups.keys()];
  const priorityFamilies = Array.isArray(config.priorityResearchFamilies)
    ? config.priorityResearchFamilies.filter((family) => groups.has(family))
    : [];
  const supportedFamilies = familyOrder.filter((family) => familyResearchSupported(family));
  const nonPrioritySupportedFamilies = supportedFamilies.filter((family) => !priorityFamilies.includes(family));

  if (selectedAlgoIds) {
    for (const algo of requested) addAlgo(algo);
  } else if (decision.limited) {
    for (const family of priorityFamilies) {
      addFamily(family, config.lowEvidenceFamilyPilotCount);
    }
    for (const family of [...priorityFamilies, ...nonPrioritySupportedFamilies]) {
      addFamily(family, Number.POSITIVE_INFINITY);
    }
    if (config.allowUnsupportedFamilyMinting === true && config.unsupportedFamilyShadowCap > 0) {
      for (const family of familyOrder.filter((item) => !familyResearchSupported(item))) {
        addFamily(family, config.unsupportedFamilyShadowCap);
      }
    }
  } else {
    for (const family of supportedFamilies) {
      addFamily(family, Number.POSITIVE_INFINITY);
    }
    if (config.allowUnsupportedFamilyMinting === true) {
      for (const family of familyOrder.filter((item) => !familyResearchSupported(item))) {
        addFamily(family, config.unsupportedFamilyShadowCap > 0 ? config.unsupportedFamilyShadowCap : Number.POSITIVE_INFINITY);
      }
    }
  }

  const families = familyOrder.map((family) => {
    const entry = familyRegistryEntry(family);
    const requestedCount = groups.get(family)?.length ?? 0;
    const selectedCount = selectedCounts.get(family) ?? 0;
    const researchSupported = entry.researchSupported === true;
    return {
      family,
      requested: requestedCount,
      selected: selectedCount,
      researchSupported,
      telemetryClassification: entry.telemetryClassification ?? (researchSupported ? "supported_for_research" : "telemetry_only"),
      action: familyBudgetAction({ researchSupported, selectedCount, requestedCount, entry }),
      reason: entry.reason ?? (researchSupported ? "research_adapter_available" : "unsupported_for_research"),
    };
  });
  const unsupportedMintingCount = families
    .filter((row) => !row.researchSupported)
    .reduce((sum, row) => sum + row.selected, 0);
  const selectedSupportedFamilyCount = families.filter((row) => row.researchSupported && row.selected > 0).length;
  return {
    algos: selected,
    familyBudget: {
      schemaVersion: "dogeedge.factory.family-budget.v1",
      limited: Boolean(decision.limited),
      maxGeneratedAlgos,
      selectedAlgos: selected.length,
      selectedSupportedFamilyCount,
      unsupportedMintingCount,
      reasonCodes: decision.reasonCodes ?? [],
      families,
    },
    summary: {
      selectedSweepAlgos: selected.length,
      selectedSupportedFamilyCount,
      unsupportedMintingCount,
      skippedUnsupportedAlgos: families
        .filter((row) => !row.researchSupported)
        .reduce((sum, row) => sum + Math.max(0, row.requested - row.selected), 0),
    },
  };

  function addFamily(family, limit) {
    if (selected.length >= maxGeneratedAlgos) return;
    const familyAlgos = groups.get(family) ?? [];
    let added = 0;
    for (const algo of familyAlgos) {
      if (added >= limit || selected.length >= maxGeneratedAlgos) return;
      if (addAlgo(algo)) added += 1;
    }
  }

  function addAlgo(algo) {
    if (!algo || selectedIds.has(algo.id)) return false;
    if (selected.length >= maxGeneratedAlgos) return false;
    selected.push(algo);
    selectedIds.add(algo.id);
    const family = algo.family ?? "unknown";
    selectedCounts.set(family, (selectedCounts.get(family) ?? 0) + 1);
    return true;
  }
}

function groupByFamily(algos) {
  const groups = new Map();
  for (const algo of algos) {
    const family = algo?.family ?? "unknown";
    if (!groups.has(family)) groups.set(family, []);
    groups.get(family).push(algo);
  }
  return groups;
}

function familyBudgetAction({ researchSupported, selectedCount, requestedCount, entry }) {
  if (researchSupported && selectedCount > 0) return "pilot_supported_family";
  if (researchSupported && requestedCount > 0) return "supported_budget_waiting";
  if (!researchSupported && selectedCount > 0) return "shadow_telemetry_budget";
  return entry.defaultBudgetAction ?? "freeze_new_minting";
}
