export const familyRegistryVersion = "dogeedge.family-registry.v1";

const entries = [
  { family: "paper", researchSupported: true, researchAdapter: "built_in_paper" },
  { family: "paper-variant", researchSupported: true, researchAdapter: "built_in_paper_variant" },
  { family: "sweep-model", researchSupported: true, researchAdapter: "factory_sweep_model" },
  { family: "sweep-momentum-trail", researchSupported: false, reason: "missing_research_adapter" },
  { family: "sweep-order-flow-pressure", researchSupported: false, reason: "missing_research_adapter" },
  { family: "sweep-liquidity-imbalance", researchSupported: false, reason: "missing_research_adapter" },
  { family: "sweep-scalp", researchSupported: false, reason: "missing_research_adapter" },
  { family: "sweep-managed-scalp", researchSupported: false, reason: "missing_research_adapter" },
  { family: "sweep-distance", researchSupported: false, reason: "missing_research_adapter" },
  { family: "sweep-target-revert", researchSupported: false, reason: "missing_research_adapter" },
  { family: "sweep-momentum", researchSupported: false, reason: "missing_research_adapter" },
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
