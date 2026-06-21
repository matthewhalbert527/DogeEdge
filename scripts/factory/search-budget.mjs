import { roundRatio } from "./utils.mjs";
import { familyRegistryEntry, familyResearchSupported } from "./family-registry.mjs";

export const defaultSearchBudgetPolicy = {
  minEventsForBroadSweep: 250,
  minOfficialSettlementCoverage: 0.95,
  lowEvidenceSweepCap: 250,
  lowEvidenceDeepSweepAllowed: false,
  lowEvidenceFamilyPilotCount: 50,
  lowEvidenceExecutableMintingAllowed: false,
  lowEvidenceLabFamilyPilotCount: 25,
  allowLowEvidenceLabResearch: true,
  priorityResearchFamilies: ["sweep-scalp", "sweep-liquidity-imbalance"],
  labOnlyFamilies: ["sweep-model"],
  allowLabOnlyFamilyMinting: false,
  allowUnsupportedFamilyMinting: false,
  unsupportedFamilyShadowCap: 0,
};

export const defaultPromoteCheckDiagnosticCap = 100;

export function evidenceScaledFamilyTrialCap(independentReplayGradeMarkets = 0) {
  const count = Math.max(0, Number(independentReplayGradeMarkets ?? 0));
  if (count < 20) return { maxRegisteredCandidatesPerFamily: 10, mode: "fixed_diagnostic_templates", parameterOptimizationAllowed: false };
  if (count < 50) return { maxRegisteredCandidatesPerFamily: 25, mode: "bounded_registered_search", parameterOptimizationAllowed: true };
  if (count < 100) return { maxRegisteredCandidatesPerFamily: 50, mode: "bounded_registered_search", parameterOptimizationAllowed: true };
  if (count < 200) return { maxRegisteredCandidatesPerFamily: 100, mode: "bounded_registered_search", parameterOptimizationAllowed: true };
  return { maxRegisteredCandidatesPerFamily: 200, mode: "bounded_registered_search", parameterOptimizationAllowed: true };
}

export function searchBudgetDecision({
  eventCount = 0,
  officialSettlementCoverage = 0,
  independentReplayGradeMarkets = null,
  requestedSweepAlgos = 0,
  sweepMode = false,
  deepSweepMode = false,
  policy = {},
} = {}) {
  const evidenceCap = evidenceScaledFamilyTrialCap(independentReplayGradeMarkets ?? eventCount);
  const config = { ...defaultSearchBudgetPolicy, ...policy };
  config.lowEvidenceFamilyPilotCount = Math.min(config.lowEvidenceFamilyPilotCount, evidenceCap.maxRegisteredCandidatesPerFamily);
  config.lowEvidenceLabFamilyPilotCount = Math.min(config.lowEvidenceLabFamilyPilotCount, evidenceCap.maxRegisteredCandidatesPerFamily);
  if ((independentReplayGradeMarkets ?? eventCount) < 20) {
    const activeFamilySlots = Math.max(1, config.priorityResearchFamilies?.length ?? 0);
    config.lowEvidenceSweepCap = Math.min(config.lowEvidenceSweepCap, evidenceCap.maxRegisteredCandidatesPerFamily * activeFamilySlots);
    config.lowEvidenceExecutableMintingAllowed = true;
    config.allowLowEvidenceLabResearch = false;
    config.allowLabOnlyFamilyMinting = false;
  }
  const reasonCodes = [];
  if (eventCount < config.minEventsForBroadSweep) reasonCodes.push("search_budget_limited_by_sample_size");
  if (officialSettlementCoverage < config.minOfficialSettlementCoverage) reasonCodes.push("deep_sweep_blocked_low_official_coverage");
  if ((independentReplayGradeMarkets ?? eventCount) < 20) reasonCodes.push("search_budget_limited_by_replay_grade_market_count");
  const limited = sweepMode && reasonCodes.length > 0;
  const deepSweepAllowed = !deepSweepMode
    ? false
    : !limited || config.lowEvidenceDeepSweepAllowed === true;
  const maxGeneratedAlgos = limited
    ? Math.max(0, Math.min(requestedSweepAlgos, config.lowEvidenceSweepCap))
    : requestedSweepAlgos;
  const executableMintingAllowed = !limited || config.lowEvidenceExecutableMintingAllowed === true;
  const labResearchAllowed = !limited || config.allowLowEvidenceLabResearch === true;
  return {
    schemaVersion: "dogeedge.factory.search-budget.v1",
    sweepMode,
    requestedDeepSweepMode: deepSweepMode,
    deepSweepAllowed,
    limited,
    reasonCodes,
    eventCount,
    officialSettlementCoverage: roundRatio(officialSettlementCoverage),
    independentReplayGradeMarkets: independentReplayGradeMarkets ?? null,
    requestedSweepAlgos,
    maxGeneratedAlgos,
    evidenceScaledFamilyTrialCap: evidenceCap.maxRegisteredCandidatesPerFamily,
    parameterOptimizationAllowed: evidenceCap.parameterOptimizationAllowed,
    executableMintingAllowed,
    labResearchAllowed,
    policy: config,
  };
}

export function applyPromoteCheckDiagnosticCap(decision = {}, {
  promoteCheckMode = false,
  selectedAlgoIds = null,
  maxSweepAlgos = defaultPromoteCheckDiagnosticCap,
  reasonCode = "promote_check_diagnostic_cap",
} = {}) {
  if (!promoteCheckMode || selectedAlgoIds) return decision;
  const cap = Math.floor(Number(maxSweepAlgos));
  if (!Number.isFinite(cap) || cap <= 0) return decision;
  const requestedSweepAlgos = Math.max(0, Number(decision.requestedSweepAlgos ?? 0));
  const currentMax = Math.max(0, Number(decision.maxGeneratedAlgos ?? requestedSweepAlgos));
  const cappedMax = Math.min(currentMax, cap);
  if (cappedMax >= currentMax) return decision;
  const reasonCodes = uniqueStrings([...(decision.reasonCodes ?? []), reasonCode]);
  const evidenceLimited = Boolean((decision.reasonCodes ?? []).some((code) => code !== reasonCode));
  const config = { ...defaultSearchBudgetPolicy, ...(decision.policy ?? {}) };
  const priorityFamilyCount = Math.max(1, (Array.isArray(config.priorityResearchFamilies) ? config.priorityResearchFamilies : []).length);
  const promoteCheckPolicy = evidenceLimited
    ? config
    : {
        ...config,
        lowEvidenceExecutableMintingAllowed: true,
        allowLowEvidenceLabResearch: false,
        lowEvidenceFamilyPilotCount: Math.max(1, Math.ceil(cappedMax / priorityFamilyCount)),
      };
  return {
    ...decision,
    limited: true,
    reasonCodes,
    maxGeneratedAlgos: cappedMax,
    executableMintingAllowed: evidenceLimited ? decision.executableMintingAllowed : true,
    labResearchAllowed: evidenceLimited ? decision.labResearchAllowed : false,
    policy: promoteCheckPolicy,
    promoteCheckDiagnosticCap: {
      schemaVersion: "dogeedge.promote-check-diagnostic-cap.v1",
      applied: true,
      maxGeneratedAlgos: cappedMax,
      previousMaxGeneratedAlgos: currentMax,
      requestedSweepAlgos,
      reasonCode,
      note: "Promote-check is a bounded diagnostic. This cap does not relax promotion gates or enable live trading.",
    },
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
  const labOnlyFamilies = new Set(Array.isArray(config.labOnlyFamilies) ? config.labOnlyFamilies : []);
  const allowLabOnlyFamilyMinting = config.allowLabOnlyFamilyMinting === true;
  const executableMintingAllowed = decision.executableMintingAllowed !== false;
  const labResearchAllowed = decision.labResearchAllowed !== false;
  const priorityFamilies = Array.isArray(config.priorityResearchFamilies)
    ? config.priorityResearchFamilies.filter((family) => groups.has(family) && executableMintingAllowed && (allowLabOnlyFamilyMinting || !labOnlyFamilies.has(family)))
    : [];
  const supportedFamilies = familyOrder.filter((family) => familyResearchSupported(family) && executableMintingAllowed && (allowLabOnlyFamilyMinting || !labOnlyFamilies.has(family)));
  const labFamilies = familyOrder.filter((family) => labOnlyFamilies.has(family) && labResearchAllowed);
  const nonPrioritySupportedFamilies = supportedFamilies.filter((family) => !priorityFamilies.includes(family));

  if (selectedAlgoIds) {
    for (const algo of requested) addAlgo(algo);
  } else if (decision.limited) {
    for (const family of labFamilies) {
      addFamily(family, config.lowEvidenceLabFamilyPilotCount);
    }
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
    const labOnly = labOnlyFamilies.has(family) && !allowLabOnlyFamilyMinting;
    const budgetLane = labOnly
      ? "research_only_family"
      : researchSupported ? "executable_linked_family" : "unsupported_telemetry_only_family";
    return {
      family,
      requested: requestedCount,
      selected: selectedCount,
      researchSupported,
      labOnly,
      budgetLane,
      budgetBucket: selectedCount > 0
        ? labOnly ? "lab_only_research" : budgetLane
        : labOnly ? "lab_only_zero_budget" : researchSupported ? "supported_zero_budget" : "unsupported_zero_budget",
      telemetryClassification: entry.telemetryClassification ?? (researchSupported ? "supported_for_research" : "telemetry_only"),
      action: familyBudgetAction({ researchSupported, selectedCount, requestedCount, entry, labOnly }),
      reason: labOnly
        ? "lab_only_until_executable_exact_linkage"
        : entry.reason ?? (researchSupported ? "research_adapter_available" : "unsupported_for_research"),
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
      executableMintingAllowed,
      labResearchAllowed,
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

function uniqueStrings(values) {
  return [...new Set(values.filter((value) => typeof value === "string" && value.length))];
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

function familyBudgetAction({ researchSupported, selectedCount, requestedCount, entry, labOnly }) {
  if (labOnly && selectedCount > 0) return "tiny_lab_research";
  if (labOnly) return "lab_only_zero_budget";
  if (researchSupported && selectedCount > 0) return "pilot_supported_family";
  if (researchSupported && requestedCount > 0) return "supported_budget_waiting";
  if (!researchSupported && selectedCount > 0) return "shadow_telemetry_budget";
  return entry.defaultBudgetAction ?? "freeze_new_minting";
}
