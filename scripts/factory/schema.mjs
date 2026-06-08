import {
  booleanOrDefault,
  contractMs,
  isRecord,
  isoFromMs,
  numberOrDefault,
  numberOrNull,
  parseTime,
  roundPrice,
  roundRatio,
  stringOrNull,
} from "./utils.mjs";

const futureOutcomeKeys = [
  "futureEstimate",
  "futurePrice",
  "futureSpotPrice",
  "futureSettlement",
  "futureWinningSide",
  "outcome",
  "result",
  "settledPrice",
  "settlementResult",
  "winningSide",
  "won",
];

export function normalizeDecisionFrame(value, options = {}) {
  const permissiveDebug = Boolean(options.permissiveDebug);
  const warnings = [];
  const errors = [];
  if (!isRecord(value)) {
    return validationResult(null, warnings, ["row is not an object"], permissiveDebug);
  }

  for (const key of futureOutcomeKeys) {
    if (Object.prototype.hasOwnProperty.call(value, key)) {
      errors.push(`future/outcome field is not allowed in decision frames: ${key}`);
    }
  }

  const observedAt = stringOrNull(value.observedAt) ?? stringOrNull(value.capturedAt);
  const featureMs = parseTime(observedAt);
  if (featureMs === null) errors.push("observedAt/capturedAt is missing or invalid");

  const capturedAt = stringOrNull(value.capturedAt) ?? observedAt;
  const capturedMs = parseTime(capturedAt);
  if (capturedMs === null) errors.push("capturedAt is invalid");
  if (featureMs !== null && capturedMs !== null && capturedMs + 5_000 < featureMs) {
    errors.push("capturedAt is earlier than observedAt");
  }

  const marketTicker = stringOrNull(value.marketTicker);
  const marketLive = booleanOrDefault(value.marketLive, false);
  if (marketLive && !marketTicker) errors.push("live frame is missing marketTicker");

  const secondsToClose = numberOrNull(value.secondsToClose);
  if (secondsToClose !== null && secondsToClose < -5) errors.push("secondsToClose is negative before close tolerance");

  const explicitCloseMs = parseTime(value.marketCloseTime) ?? parseTime(value.marketCloseTimestamp);
  const inferredCloseMs = featureMs !== null && secondsToClose !== null
    ? featureMs + Math.max(0, secondsToClose) * 1000
    : null;
  const marketCloseMs = explicitCloseMs ?? inferredCloseMs;
  if (marketTicker && marketCloseMs === null) errors.push("market close timestamp cannot be inferred");
  if (featureMs !== null && marketCloseMs !== null && featureMs >= marketCloseMs && !options.allowPostCloseFrames) {
    errors.push("featureTimestamp must be strictly before marketCloseTimestamp");
  } else if (featureMs !== null && marketCloseMs !== null && marketCloseMs + 5_000 < featureMs) {
    warnings.push("post-close frame was accepted only because allowPostCloseFrames is enabled");
  }

  const targetPrice = numberOrNull(value.targetPrice);
  const estimate = numberOrNull(value.estimate);
  const yesAsk = numberOrNull(value.yesAsk);
  const noAsk = numberOrNull(value.noAsk);
  const yesBid = numberOrNull(value.yesBid);
  const noBid = numberOrNull(value.noBid);
  for (const [label, price] of [["yesAsk", yesAsk], ["noAsk", noAsk], ["yesBid", yesBid], ["noBid", noBid]]) {
    if (price !== null && (price < 0 || price > 1.1)) errors.push(`${label} is outside contract price bounds`);
  }
  if (yesAsk !== null && yesBid !== null && yesAsk < yesBid) warnings.push("YES ask is below YES bid");
  if (noAsk !== null && noBid !== null && noAsk < noBid) warnings.push("NO ask is below NO bid");

  const frame = {
    id: stringOrNull(value.id) ?? `${marketTicker ?? "NO_MARKET"}:${featureMs ?? capturedMs ?? 0}`,
    capturedAt: capturedAt ?? observedAt ?? new Date(0).toISOString(),
    observedAt: observedAt ?? capturedAt ?? new Date(0).toISOString(),
    featureTimestamp: featureMs === null ? null : isoFromMs(featureMs),
    featureTimestampMs: featureMs,
    labelTimestamp: null,
    labelTimestampMs: null,
    labelSource: "unknown",
    marketCloseTimestamp: marketCloseMs === null ? null : isoFromMs(marketCloseMs),
    marketCloseTimestampMs: marketCloseMs,
    settlementTimestamp: null,
    settlementTimestampMs: null,
    settlementSource: "unknown",
    officialResolutionAvailable: false,
    sourceUrl: stringOrNull(value.sourceUrl),
    dataMode: stringOrNull(value.dataMode),
    activeRulesVersion: stringOrNull(value.activeRulesVersion),
    marketLive,
    marketTicker,
    marketTitle: stringOrNull(value.marketTitle),
    marketLabel: stringOrNull(value.marketLabel),
    marketCloseTime: marketCloseMs === null ? null : isoFromMs(marketCloseMs),
    kalshiStatus: stringOrNull(value.kalshiStatus),
    feedStatus: stringOrNull(value.feedStatus),
    targetPrice,
    estimate,
    spotPrice: numberOrNull(value.spotPrice),
    oneMinuteChange: numberOrDefault(value.oneMinuteChange, 0),
    oneMinuteMovePercent: numberOrDefault(value.oneMinuteMovePercent, 0),
    distanceFromTarget: numberOrNull(value.distanceFromTarget) ?? (estimate !== null && targetPrice !== null ? roundPrice(estimate - targetPrice) : null),
    secondsToClose: secondsToClose ?? 900,
    fairProbability: numberOrDefault(value.fairProbability, 0.5),
    modelAction: stringOrNull(value.modelAction) ?? "skip",
    modelConfidence: numberOrDefault(value.modelConfidence, 0),
    modelEdgeAfterFees: numberOrDefault(value.modelEdgeAfterFees, 0),
    modelSizeContracts: numberOrDefault(value.modelSizeContracts, 1),
    yesAsk,
    noAsk,
    yesBid,
    noBid,
    yesSpread: numberOrNull(value.yesSpread) ?? nullableSpread(yesAsk, yesBid),
    noSpread: numberOrNull(value.noSpread) ?? nullableSpread(noAsk, noBid),
    yesBidDepth: nestedNumberOrNull(value.yesTopDepth, "bidSize") ?? numberOrDefault(value.yesBidDepth, 0),
    yesAskDepth: nestedNumberOrNull(value.yesTopDepth, "askSize") ?? numberOrDefault(value.yesAskDepth, 0),
    noBidDepth: nestedNumberOrNull(value.noTopDepth, "bidSize") ?? numberOrDefault(value.noBidDepth, 0),
    noAskDepth: nestedNumberOrNull(value.noTopDepth, "askSize") ?? numberOrDefault(value.noAskDepth, 0),
    sampleWeight: 1,
    overlapCount: 1,
    independentKey: null,
    regime: null,
  };

  if (frame.featureTimestampMs !== null && frame.marketCloseTimestampMs !== null) {
    frame.secondsToClose = Math.max(0, Math.round((frame.marketCloseTimestampMs - frame.featureTimestampMs) / 1000));
  }

  return validationResult(frame, warnings, errors, permissiveDebug);
}

function validationResult(frame, warnings, errors, permissiveDebug) {
  if (errors.length && !permissiveDebug) return { frame: null, warnings, errors };
  if (frame && errors.length) frame.permissiveErrors = errors;
  return { frame, warnings, errors: permissiveDebug ? [] : errors };
}

function nestedNumberOrNull(value, key) {
  return isRecord(value) ? numberOrNull(value[key]) : null;
}

function nullableSpread(ask, bid) {
  return ask === null || bid === null ? null : roundRatio(Math.max(0, ask - bid));
}
