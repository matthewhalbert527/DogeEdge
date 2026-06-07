import { contractMs } from "./utils.mjs";

export function chronologicalSplit(events, options = {}) {
  const sorted = [...events].sort(eventSort);
  const validationRatio = clampRatio(options.validationRatio ?? 0.2, 0.05, 0.4);
  const testRatio = clampRatio(options.testRatio ?? 0.2, 0.05, 0.4);
  const testStart = Math.max(0, Math.floor(sorted.length * (1 - testRatio)));
  const validationStart = Math.max(0, Math.floor(testStart * (1 - validationRatio)));
  return {
    train: sorted.slice(0, validationStart),
    validation: sorted.slice(validationStart, testStart),
    test: sorted.slice(testStart),
  };
}

export function purgedEmbargoFolds(events, options = {}) {
  const sorted = [...events].sort(eventSort);
  const foldCount = Math.max(2, Math.min(sorted.length || 2, Math.floor(Number(options.foldCount ?? 5))));
  const embargoMs = Math.max(0, Number(options.embargoMs ?? contractMs));
  const folds = [];
  for (let index = 0; index < foldCount; index += 1) {
    const start = Math.floor(index * sorted.length / foldCount);
    const end = Math.floor((index + 1) * sorted.length / foldCount);
    const validation = sorted.slice(start, end);
    if (!validation.length) continue;
    folds.push(buildFold(`purged-${index + 1}`, sorted, validation, embargoMs));
  }
  return folds;
}

export function cpcvApproximationFolds(events, options = {}) {
  const baseFolds = purgedEmbargoFolds(events, options);
  const maxCombinations = Math.max(1, Number(options.maxCombinations ?? 10));
  const embargoMs = Math.max(0, Number(options.embargoMs ?? contractMs));
  const sorted = [...events].sort(eventSort);
  const combos = [];
  for (let left = 0; left < baseFolds.length; left += 1) {
    for (let right = left + 1; right < baseFolds.length; right += 1) {
      const ids = new Set([...baseFolds[left].validationEventIds, ...baseFolds[right].validationEventIds]);
      const validation = sorted.filter((event) => ids.has(event.id));
      combos.push(buildFold(`cpcv-${left + 1}-${right + 1}`, sorted, validation, embargoMs));
      if (combos.length >= maxCombinations) return combos;
    }
  }
  return combos.length ? combos : baseFolds;
}

export function eventSort(left, right) {
  return (left.labelWindowEndMs ?? 0) - (right.labelWindowEndMs ?? 0) || left.id.localeCompare(right.id);
}

function buildFold(id, allEvents, validation, embargoMs) {
  const validationIds = new Set(validation.map((event) => event.id));
  const validationStart = Math.min(...validation.map((event) => event.labelWindowStartMs ?? 0));
  const validationEnd = Math.max(...validation.map((event) => event.labelWindowEndMs ?? event.labelWindowStartMs ?? 0));
  const purged = [];
  const embargoed = [];
  const train = [];
  for (const event of allEvents) {
    if (validationIds.has(event.id)) continue;
    const start = event.labelWindowStartMs ?? 0;
    const end = event.labelWindowEndMs ?? start;
    const overlaps = start <= validationEnd && end >= validationStart;
    const embargo = start > validationEnd && start <= validationEnd + embargoMs;
    if (overlaps) {
      purged.push(event);
    } else if (embargo) {
      embargoed.push(event);
    } else {
      train.push(event);
    }
  }
  return {
    id,
    validationStart: new Date(validationStart).toISOString(),
    validationEnd: new Date(validationEnd).toISOString(),
    embargoMs,
    trainEvents: train,
    validationEvents: validation,
    purgedEvents: purged,
    embargoedEvents: embargoed,
    trainEventIds: train.map((event) => event.id),
    validationEventIds: validation.map((event) => event.id),
    purgedEventIds: purged.map((event) => event.id),
    embargoedEventIds: embargoed.map((event) => event.id),
  };
}

function clampRatio(value, min, max) {
  return Math.min(max, Math.max(min, Number(value)));
}

