export const familyRegistryVersion = "dogeedge.family-registry.v1";

const researchSupportedFamilies = new Set([
  "paper",
  "paper-variant",
  "sweep-model",
  "sweep-scalp",
  "sweep-liquidity-imbalance",
]);

const unsupportedLiveFamilies = new Set([
  "sweep-momentum-trail",
  "sweep-order-flow-pressure",
  "sweep-managed-scalp",
  "sweep-distance",
  "sweep-target-revert",
  "sweep-momentum",
]);

export function familyResearchSupported(family: string | null | undefined) {
  if (!family) return false;
  if (researchSupportedFamilies.has(family)) return true;
  if (unsupportedLiveFamilies.has(family)) return false;
  return false;
}

export function familySupportReason(family: string | null | undefined) {
  if (familyResearchSupported(family)) return "research_adapter_available";
  if (family && unsupportedLiveFamilies.has(family)) return "missing_research_adapter";
  return "unregistered_family";
}
