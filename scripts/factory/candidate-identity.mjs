import { hashJson } from "./utils.mjs";

export const researchCandidateIdentityVersion = "dogeedge.research-candidate.v1";
export const defaultFeatureSchemaVersion = "dogeedge.decision-frame.v1";
export const defaultExecutionModelVersion = "dogeedge.simulator.v1";

export function researchCandidateIdentity(metric = {}, context = {}) {
  const sourceResearchAlgoId = String(metric.algoId ?? metric.id ?? "");
  const material = {
    identityVersion: researchCandidateIdentityVersion,
    family: stringOrUnknown(metric.family),
    sourceResearchAlgoId,
    normalizedParams: metric.params ?? metric.parameters ?? {},
    featureSchemaVersion: metric.featureSchemaVersion ?? context.featureSchemaVersion ?? defaultFeatureSchemaVersion,
    labelSource: metric.labelSource ?? metric.settlementEvidence?.labelSource ?? "unknown",
    settlementSource: metric.settlementSource ?? metric.settlementEvidence?.settlementSource ?? "unknown",
    executionModelVersion: metric.executionModelVersion ?? context.executionModelVersion ?? defaultExecutionModelVersion,
    costModelVersion: metric.costModelVersion ?? context.costModelHash ?? "UNAVAILABLE",
    riskModelVersion: metric.riskModelVersion ?? context.riskModelHash ?? "UNAVAILABLE",
    seed: metric.seed ?? context.seed ?? "dogeedge-factory-v2",
    metricsVersion: metric.metricsVersion ?? context.metricsVersion ?? "dogeedge.factory.metrics.v1",
    sourceRunId: metric.sourceRunId ?? context.sourceRunId ?? "",
    sourceSnapshotHash: metric.sourceSnapshotHash ?? context.sourceSnapshotHash ?? "",
    promotionVerdictAtInstall: metric.promotionVerdictAtInstall ?? metric.promotionVerdict ?? context.promotionVerdictAtInstall ?? "",
    configHash: metric.configHash ?? context.configHash ?? "UNAVAILABLE",
  };
  const candidateConfigHash = hashJson(material);
  return {
    identityVersion: researchCandidateIdentityVersion,
    researchCandidateId: `rcid-${candidateConfigHash.slice(0, 24)}`,
    candidateConfigHash,
    sourceResearchAlgoId,
    identityMaterial: material,
  };
}

export function researchCandidateIdentityContext({ primaryRun = {}, registry = {}, costModels = [], riskModel = {} } = {}) {
  return {
    featureSchemaVersion: defaultFeatureSchemaVersion,
    executionModelVersion: defaultExecutionModelVersion,
    costModelHash: registry.costModelHash ?? hashJson(costModels),
    riskModelHash: registry.riskModelHash ?? hashJson(riskModel),
    seed: registry.randomSeed ?? primaryRun.randomSeed ?? "dogeedge-factory-v2",
    metricsVersion: registry.metricsVersion ?? "dogeedge.factory.metrics.v1",
    sourceRunId: primaryRun.runId ?? "",
    sourceSnapshotHash: registry.inputManifestHash ?? registry.dataHash ?? primaryRun.sourceSnapshotHash ?? "",
    configHash: registry.configHash ?? primaryRun.configHash ?? "UNAVAILABLE",
  };
}

function stringOrUnknown(value) {
  return typeof value === "string" && value.length ? value : "unknown";
}
