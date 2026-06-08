import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { normalizeDecisionFrame } from "./schema.mjs";
import { contractMs, dayKey, isRecord, parseTime, roundRatio } from "./utils.mjs";

export async function readFactoryDecisionFrames(baseDir, options = {}) {
  const files = await listFiles(baseDir);
  const jsonlFiles = files.filter((file) => file.endsWith(".jsonl")).sort();
  const frames = [];
  const warnings = [];
  const errors = [];
  for (const file of jsonlFiles) {
    const text = await readFile(file, "utf8");
    let lineNumber = 0;
    for (const line of text.split(/\r?\n/)) {
      lineNumber += 1;
      if (!line.trim()) continue;
      try {
        const parsed = JSON.parse(line);
        const result = normalizeDecisionFrame(parsed, options);
        warnings.push(...result.warnings.map((message) => ({ file, line: lineNumber, message })));
        const postCloseFeatureErrors = result.errors.filter((message) => message.includes("featureTimestamp must be strictly before marketCloseTimestamp"));
        const otherErrors = result.errors.filter((message) => !message.includes("featureTimestamp must be strictly before marketCloseTimestamp"));
        if (postCloseFeatureErrors.length && options.dropPostCloseFrames !== false) {
          warnings.push(...postCloseFeatureErrors.map((message) => ({ file, line: lineNumber, message: `${message}; row excluded from feature generation` })));
        }
        errors.push(...otherErrors.map((message) => ({ file, line: lineNumber, message })));
        if (result.frame) frames.push({ ...result.frame, sourceFile: file, sourceLine: lineNumber });
      } catch (error) {
        errors.push({ file, line: lineNumber, message: error instanceof Error ? error.message : "invalid JSON line" });
      }
    }
  }
  if (errors.length && !options.permissiveDebug) {
    const first = errors.slice(0, 5).map((error) => `${path.basename(error.file)}:${error.line} ${error.message}`).join("; ");
    throw new Error(`Decision-frame validation failed closed with ${errors.length} error(s): ${first}`);
  }
  const deduped = deduplicateDecisionFrames(frames, options);
  const eventResult = buildMarketEvents(deduped.frames, options);
  return {
    frames: deduped.frames,
    events: eventResult.events,
    warnings: [...warnings, ...deduped.warnings, ...eventResult.warnings],
    errors,
    frameCountRaw: frames.length,
    frameCount: deduped.frames.length,
    duplicateFrameCount: deduped.duplicateFrameCount,
    overlappingFrameCount: deduped.overlappingFrameCount,
    eventCount: eventResult.events.length,
  };
}

export function filterFramesByTime(frames, { since = null, until = null } = {}) {
  return frames
    .filter((frame) => {
      const time = frame.featureTimestampMs ?? parseTime(frame.observedAt);
      if (!Number.isFinite(time)) return false;
      if (since !== null && time < since) return false;
      if (until !== null && time > until) return false;
      return true;
    })
    .sort((left, right) => (left.featureTimestampMs ?? 0) - (right.featureTimestampMs ?? 0) || String(left.id).localeCompare(String(right.id)));
}

export function deduplicateDecisionFrames(frames, options = {}) {
  const bucketMs = Math.max(1_000, Number(options.overlapBucketMs ?? 5_000));
  const exact = new Set();
  const buckets = new Map();
  const output = [];
  let duplicateFrameCount = 0;
  let overlappingFrameCount = 0;
  for (const frame of filterFramesByTime(frames)) {
    const exactKey = `${frame.marketTicker}:${frame.featureTimestampMs}:${frame.yesAsk}:${frame.noAsk}:${frame.yesBid}:${frame.noBid}:${frame.estimate}`;
    if (exact.has(exactKey)) {
      duplicateFrameCount += 1;
      continue;
    }
    exact.add(exactKey);
    const bucket = Math.floor((frame.featureTimestampMs ?? 0) / bucketMs);
    const bucketKey = `${frame.marketTicker}:${bucket}:${roundRatio(frame.estimate ?? -1)}:${roundRatio(frame.yesAsk ?? -1)}:${roundRatio(frame.noAsk ?? -1)}:${roundRatio(frame.yesBid ?? -1)}:${roundRatio(frame.noBid ?? -1)}`;
    const existing = buckets.get(bucketKey);
    if (existing) {
      existing.overlapCount += 1;
      existing.sampleWeight = roundRatio(1 / existing.overlapCount);
      overlappingFrameCount += 1;
      continue;
    }
    const independentKey = `${frame.marketTicker}:${bucket}`;
    const regime = regimeForFrame(frame);
    const next = { ...frame, independentKey, regime };
    buckets.set(bucketKey, next);
    output.push(next);
  }
  return {
    frames: output,
    duplicateFrameCount,
    overlappingFrameCount,
    warnings: [
      ...(duplicateFrameCount ? [{ message: `${duplicateFrameCount} exact duplicate decision frame(s) removed` }] : []),
      ...(overlappingFrameCount ? [{ message: `${overlappingFrameCount} overlapping near-identical frame(s) downsampled` }] : []),
    ],
  };
}

export function buildMarketEvents(frames, options = {}) {
  const byTicker = new Map();
  const warnings = [];
  for (const frame of filterFramesByTime(frames)) {
    if (!frame.marketLive || !frame.marketTicker || frame.estimate === null || frame.targetPrice === null) continue;
    const rows = byTicker.get(frame.marketTicker) ?? [];
    rows.push(frame);
    byTicker.set(frame.marketTicker, rows);
  }
  const events = [];
  for (const [marketTicker, rows] of byTicker) {
    const sorted = rows.sort((left, right) => (left.featureTimestampMs ?? 0) - (right.featureTimestampMs ?? 0));
    const first = sorted[0];
    const closeMs = first.marketCloseTimestampMs ?? inferCloseMs(sorted);
    const labelFrame = chooseLabelFrame(sorted, closeMs);
    const official = officialOutcomeFor(marketTicker, options);
    if (!labelFrame) {
      warnings.push({ message: `${marketTicker} has no usable label frame` });
      continue;
    }
    const officialLabelMs = official ? parseTime(official.labelTimestamp ?? official.settlementTimestamp ?? official.resolvedAt) : null;
    const officialSettlementMs = official ? parseTime(official.settlementTimestamp ?? official.resolvedAt ?? official.labelTimestamp) : null;
    const officialUsable = official
      && official.outcomeSide
      && closeMs !== null
      && officialLabelMs !== null
      && officialSettlementMs !== null
      && officialLabelMs >= closeMs
      && officialSettlementMs >= closeMs;
    if (official && !officialUsable) {
      warnings.push({ message: `${marketTicker} official outcome was ignored because label/settlement timing was missing or before close` });
    }
    const labelMs = officialUsable
      ? officialLabelMs
      : closeMs === null ? labelFrame.featureTimestampMs : Math.max(closeMs, labelFrame.featureTimestampMs ?? closeMs);
    const settlementMs = officialUsable ? officialSettlementMs : labelMs;
    const labelTimestamp = labelMs === null ? null : new Date(labelMs).toISOString();
    const settlementTimestamp = settlementMs === null ? null : new Date(settlementMs).toISOString();
    const outcomeSide = officialUsable ? official.outcomeSide : (labelFrame.estimate ?? first.estimate) >= first.targetPrice ? "YES" : "NO";
    const labelSource = officialUsable ? "official_resolution" : "pre_close_frame_proxy";
    const settlementSource = officialUsable ? "official_resolution" : "estimated";
    events.push({
      id: marketTicker,
      marketTicker,
      day: dayKey(first.featureTimestamp),
      labelWindowStartMs: first.featureTimestampMs,
      labelWindowEndMs: closeMs,
      marketCloseTimestamp: closeMs === null ? null : new Date(closeMs).toISOString(),
      marketCloseTimestampMs: closeMs,
      labelTimestamp,
      labelTimestampMs: labelMs,
      settlementTimestamp,
      settlementTimestampMs: settlementMs,
      labelSource,
      settlementSource,
      officialResolutionAvailable: officialUsable,
      outcomeSide,
      targetPrice: first.targetPrice,
      frames: sorted.map((frame) => ({
        ...frame,
        labelTimestamp,
        labelTimestampMs: labelMs,
        settlementTimestamp,
        settlementTimestampMs: settlementMs,
        labelSource,
        settlementSource,
        officialResolutionAvailable: officialUsable,
      })),
      frameCount: sorted.length,
      independentFrameCount: new Set(sorted.map((frame) => frame.independentKey)).size,
      regimes: summarizeRegimes(sorted),
    });
  }
  return {
    events: events.sort((left, right) => (left.labelWindowEndMs ?? 0) - (right.labelWindowEndMs ?? 0) || left.marketTicker.localeCompare(right.marketTicker)),
    warnings,
  };
}

export function settlementCoverageSummary(events) {
  const total = events.length;
  const official = events.filter((event) => event.settlementSource === "official_resolution" && event.labelSource === "official_resolution").length;
  return {
    totalEvents: total,
    officialEvents: official,
    officialSettlementCoverage: total > 0 ? roundRatio(official / total) : 0,
    settlementSource: total > 0 && official === total ? "official_resolution" : official > 0 ? "mixed" : "estimated",
    labelSource: total > 0 && official === total ? "official_resolution" : official > 0 ? "mixed" : "pre_close_frame_proxy",
    officialResolutionAvailable: total > 0 && official === total,
  };
}

export function dataQualitySummary(loadResult) {
  return {
    rawFrames: loadResult.frameCountRaw,
    usableFrames: loadResult.frameCount,
    duplicateFramesRemoved: loadResult.duplicateFrameCount,
    overlappingFramesDownsampled: loadResult.overlappingFrameCount,
    marketEvents: loadResult.eventCount,
    warningCount: loadResult.warnings.length,
    errorCount: loadResult.errors.length,
  };
}

async function listFiles(dir) {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    const nested = await Promise.all(entries.map(async (entry) => {
      const fullPath = path.join(dir, entry.name);
      return entry.isDirectory() ? listFiles(fullPath) : [fullPath];
    }));
    return nested.flat();
  } catch {
    return [];
  }
}

function inferCloseMs(frames) {
  const inferred = frames
    .map((frame) => frame.featureTimestampMs !== null && Number.isFinite(frame.secondsToClose) ? frame.featureTimestampMs + frame.secondsToClose * 1000 : null)
    .filter((value) => value !== null);
  return inferred.length ? Math.max(...inferred) : (frames.at(-1)?.featureTimestampMs ?? null);
}

function chooseLabelFrame(frames, closeMs) {
  if (!frames.length) return null;
  if (closeMs === null) return frames.at(-1);
  const closeCandidates = frames.filter((frame) => (frame.featureTimestampMs ?? 0) < closeMs);
  return closeCandidates.at(-1) ?? null;
}

function officialOutcomeFor(marketTicker, options) {
  const source = options.officialOutcomes ?? options.officialResolutions ?? null;
  if (!source) return null;
  const value = source instanceof Map ? source.get(marketTicker) : isRecord(source) ? source[marketTicker] : null;
  if (!isRecord(value)) return null;
  const rawSide = typeof value.outcomeSide === "string"
    ? value.outcomeSide
    : typeof value.winningSide === "string"
      ? value.winningSide
      : null;
  const outcomeSide = rawSide?.toUpperCase() === "YES" ? "YES" : rawSide?.toUpperCase() === "NO" ? "NO" : null;
  return {
    ...value,
    outcomeSide,
  };
}

function regimeForFrame(frame) {
  return {
    timeToClose: bucket(frame.secondsToClose, [
      [60, "final_60s"],
      [180, "final_3m"],
      [420, "mid_close"],
      [900, "early"],
    ], "unknown"),
    spread: spreadBucket(Math.min(nonNull(frame.yesSpread), nonNull(frame.noSpread))),
    liquidity: liquidityBucket(Math.max(nonNull(frame.yesAskDepth), nonNull(frame.noAskDepth))),
    volatility: volatilityBucket(Math.abs(frame.oneMinuteMovePercent ?? 0)),
    momentum: momentumBucket(frame.oneMinuteChange ?? 0),
    distance: distanceBucket(Math.abs(frame.distanceFromTarget ?? 0)),
    phase: phaseBucket(frame.secondsToClose),
  };
}

function summarizeRegimes(frames) {
  const summary = {};
  for (const frame of frames) {
    if (!isRecord(frame.regime)) continue;
    for (const [key, value] of Object.entries(frame.regime)) {
      summary[key] ??= {};
      summary[key][value] = (summary[key][value] ?? 0) + 1;
    }
  }
  return summary;
}

function bucket(value, ranges, fallback) {
  if (!Number.isFinite(value)) return fallback;
  for (const [max, label] of ranges) {
    if (value <= max) return label;
  }
  return ranges.at(-1)?.[1] ?? fallback;
}

function spreadBucket(value) {
  if (!Number.isFinite(value)) return "unknown";
  if (value <= 0.02) return "tight";
  if (value <= 0.05) return "normal";
  return "wide";
}

function liquidityBucket(value) {
  if (!Number.isFinite(value) || value <= 0) return "none";
  if (value < 5) return "thin";
  if (value < 20) return "normal";
  return "deep";
}

function volatilityBucket(value) {
  if (value < 0.001) return "quiet";
  if (value < 0.004) return "normal";
  return "volatile";
}

function momentumBucket(value) {
  if (value > 0.00005) return "up";
  if (value < -0.00005) return "down";
  return "flat";
}

function distanceBucket(value) {
  if (value < 0.00005) return "at_line";
  if (value < 0.00025) return "near";
  return "far";
}

function phaseBucket(secondsToClose) {
  if (!Number.isFinite(secondsToClose)) return "unknown";
  const elapsed = contractMs / 1000 - secondsToClose;
  if (elapsed < 300) return "opening";
  if (secondsToClose <= 180) return "closing";
  return "middle";
}

function nonNull(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : Number.NEGATIVE_INFINITY;
}
