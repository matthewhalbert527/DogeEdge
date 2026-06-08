export const familyRegistryVersion = "dogeedge.family-registry.v1";

const entries = [
  supportedFamily("paper", "built_in_paper", "legacy_paper_signal"),
  supportedFamily("paper-variant", "built_in_paper_variant", "legacy_paper_signal"),
  supportedFamily("sweep-model", "factory_sweep_model", "model_window_replay"),
  supportedFamily("sweep-scalp", "factory_spread_scalp_sweep", "orderbook_scalp_replay"),
  supportedFamily("sweep-liquidity-imbalance", "factory_liquidity_imbalance_sweep", "orderbook_depth_imbalance_replay"),
  telemetryOnlyFamily("sweep-momentum-trail", "missing_research_adapter"),
  telemetryOnlyFamily("sweep-order-flow-pressure", "missing_research_adapter"),
  telemetryOnlyFamily("sweep-managed-scalp", "missing_research_adapter"),
  telemetryOnlyFamily("sweep-distance", "missing_research_adapter"),
  telemetryOnlyFamily("sweep-target-revert", "missing_research_adapter"),
  telemetryOnlyFamily("sweep-momentum", "missing_research_adapter"),
];

export const familyRegistry = Object.freeze(entries.map((entry) => Object.freeze({ ...entry })));

export function familyRegistryEntry(family) {
  const normalized = typeof family === "string" && family.length ? family : "unknown";
  return familyRegistry.find((entry) => entry.family === normalized) ?? {
    family: normalized,
    researchSupported: false,
    reason: "unregistered_family",
  };
}

export function familyResearchSupported(family) {
  return familyRegistryEntry(family).researchSupported === true;
}

export function familyDiscoveryClassification(family) {
  const entry = familyRegistryEntry(family);
  if (entry.researchSupported) return "supported_for_research";
  return entry.telemetryClassification ?? "telemetry_only";
}

export function familyRegistryPublic() {
  return {
    familyRegistryVersion,
    families: familyRegistry,
  };
}

export function researchLiveAlignment({ researchMetrics = [], liveStats = {} } = {}) {
  const researchRows = Array.isArray(researchMetrics) ? researchMetrics : [];
  const liveRows = Object.values(liveStats ?? {}).filter((row) => row && typeof row === "object");
  const researchIds = new Set(researchRows.map((row) => row.algoId ?? row.id).filter(Boolean));
  const liveIds = new Set(liveRows.map((row) => row.sourceAlgoId ?? row.algoId ?? row.id).filter(Boolean));
  const researchFamilies = familyCounts(researchRows.map((row) => row.family ?? "unknown"));
  const liveFamilies = familyCounts(liveRows.map((row) => row.family ?? "unknown"));
  const unsupportedLive = liveRows.filter((row) => !familyResearchSupported(row.family));
  const supportedLive = liveRows.filter((row) => familyResearchSupported(row.family));
  const overlapById = [...liveIds].filter((id) => researchIds.has(id));
  const overlapByFamily = Object.keys(liveFamilies).filter((family) => Object.prototype.hasOwnProperty.call(researchFamilies, family));
  return {
    familyRegistryVersion,
    liveAlgoCount: liveRows.length,
    researchAlgoCount: researchRows.length,
    overlapByIdCount: overlapById.length,
    overlapByFamilyCount: overlapByFamily.length,
    unsupportedLiveAlgoCount: unsupportedLive.length,
    supportedLiveAlgoCount: supportedLive.length,
    researchFamilies,
    liveFamilies,
    unsupportedLiveFamilies: Object.entries(familyCounts(unsupportedLive.map((row) => row.family ?? "unknown")))
      .map(([family, count]) => ({ family, count, reason: familyRegistryEntry(family).reason ?? "unsupported_for_research" }))
      .sort((left, right) => right.count - left.count || left.family.localeCompare(right.family)),
    supportedLiveFamilies: Object.entries(familyCounts(supportedLive.map((row) => row.family ?? "unknown")))
      .map(([family, count]) => ({ family, count }))
      .sort((left, right) => right.count - left.count || left.family.localeCompare(right.family)),
  };
}

function familyCounts(values) {
  const counts = {};
  for (const value of values) {
    const key = typeof value === "string" && value.length ? value : "unknown";
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function supportedFamily(family, researchAdapter, replayAdapter) {
  return {
    family,
    researchSupported: true,
    telemetryClassification: "supported_for_research",
    researchAdapter,
    replayAdapter,
    researchEvidenceAdapter: researchAdapter,
    featureSchemaVersion: "dogeedge.decision-frame.v1",
    parameterSchema: `${family}.parameters.v1`,
    entryExitSemantics: "factory_replay_signal",
    defaultBudgetAction: "pilot_supported_family",
  };
}

function telemetryOnlyFamily(family, reason) {
  return {
    family,
    researchSupported: false,
    telemetryClassification: "telemetry_only",
    reason,
    defaultBudgetAction: "freeze_new_minting",
  };
}
