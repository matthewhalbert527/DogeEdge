export interface FactoryEvidenceSummary {
  positiveFoldRate?: number;
  foldConsistency?: number;
  medianFoldPnl?: number;
  testedFoldCount?: number;
}

export interface FactoryHoldoutSummary {
  holdoutClosed: number;
  holdoutMarkets: number;
  holdoutTotalPnl: number;
  holdoutRoi: number;
  holdoutMaxDrawdown: number;
  holdoutPositive: boolean;
  holdoutConservativeClosed: number;
  holdoutConservativeMarkets: number;
  holdoutConservativeTotalPnl: number;
  holdoutConservativeRoi: number;
  holdoutLowerCi: number | null;
  holdoutPass: boolean;
  holdoutStrictlyLater?: boolean;
  immutable?: boolean;
  latestResearchEnd?: string | null;
  earliestHoldoutStart?: string | null;
  reason?: string;
}

export interface FactoryDriftSummary {
  driftOk: boolean;
  driftReasons: string[];
  driftScore: number;
}

export interface FactoryPaperEvidenceSummary extends FactoryDriftSummary {
  available: boolean;
  status: string;
  closedMarkets: number;
  closedTrades: number;
  totalPnl?: number | null;
  roi?: number | null;
}

export interface FactoryResearchEvidence {
  promotionVerdict: string;
  reasonCodes: string[];
  adjustedConfidence: number;
  purgedSummary?: FactoryEvidenceSummary;
  cpcvSummary?: FactoryEvidenceSummary;
  walkForwardSummary?: FactoryEvidenceSummary;
  holdoutSummary?: FactoryHoldoutSummary;
  drift?: FactoryDriftSummary;
  paperEvidence?: FactoryPaperEvidenceSummary;
  conservativeTotalPnl: number;
  stressTotalPnl: number;
  psr: number;
  dsrApprox: number;
  pboApprox: number;
  realityCheckApproxPValue?: number;
  spaApproxPValue?: number;
  familyAdjustedPValue: number;
  globalAdjustedPValue: number;
  falseDiscoveryRisk: number;
  executionTelemetry?: Record<string, {
    fillRate?: number;
    averageSlippageCents?: number;
    averagePartialFillRatio?: number;
    averageFillProbability?: number;
    averageFillDepthUtilization?: number;
    staleQuoteRejections?: number;
    queueMisses?: number;
    depthRejections?: number;
  }>;
}
