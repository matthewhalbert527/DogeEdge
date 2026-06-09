import { average, childSeed, dayKey, maxDrawdownFromEquity, median, roundMoney, roundRatio, seededRandom, stddev, unique } from "./utils.mjs";
import { probabilityCalibrationForTrades } from "./probability-calibration.mjs";

export function metricsForAlgo(algo, trades, options = {}) {
  const closed = trades
    .filter((trade) => trade.status === "closed" && typeof trade.pnl === "number")
    .sort((left, right) => Date.parse(left.closedAt) - Date.parse(right.closedAt));
  const wins = closed.filter((trade) => trade.pnl > 0);
  const losses = closed.filter((trade) => trade.pnl < 0);
  const totalPnl = roundMoney(closed.reduce((total, trade) => total + trade.pnl, 0));
  const totalCost = roundMoney(closed.reduce((total, trade) => total + trade.entryPrice * trade.contracts, 0));
  const equityCurve = equityCurveForTrades(closed);
  const grossWins = wins.reduce((total, trade) => total + trade.pnl, 0);
  const grossLosses = Math.abs(losses.reduce((total, trade) => total + trade.pnl, 0));
  const returns = closed.map((trade) => trade.pnl);
  const meanPnl = average(returns);
  const risk = stddev(returns) ?? 0;
  const downside = stddev(returns.filter((value) => value < 0)) ?? 0;
  const marketPnls = groupPnl(closed, (trade) => trade.marketTicker);
  const dayPnls = groupPnl(closed, (trade) => dayKey(trade.closedAt ?? trade.openedAt));
  const regimeBreakdown = regimeMetrics(closed);
  const telemetry = executionTelemetryForTrades(trades);
  const returnMoments = momentsFor(returns);
  const probabilityCalibration = probabilityCalibrationForTrades(closed);
  const bootstrapSeed = childSeed(options.seed ?? "factory-bootstrap", algo.id, options.seedScope ?? "full-sample");
  const bootstrap = bootstrapConfidenceIntervals(closed, { ...options, seed: bootstrapSeed });
  return {
    algoId: algo.id,
    algoName: algo.name,
    family: algo.family,
    params: algo.params ?? {},
    closed: closed.length,
    open: trades.filter((trade) => trade.status === "open").length,
    independentClosedMarkets: unique(closed.map((trade) => trade.marketTicker)).length,
    daysRepresented: unique(closed.map((trade) => dayKey(trade.closedAt ?? trade.openedAt))).length,
    wins: wins.length,
    losses: losses.length,
    winRate: closed.length ? roundRatio(wins.length / closed.length) : null,
    averagePnl: closed.length ? roundMoney(totalPnl / closed.length) : null,
    medianPnl: median(returns),
    totalPnl,
    totalCost,
    roi: totalCost > 0 ? roundRatio(totalPnl / totalCost) : 0,
    maxDrawdown: maxDrawdownFromEquity(equityCurve.map((point) => point.equity)),
    averageDrawdown: averageDrawdown(equityCurve),
    timeUnderWater: timeUnderWater(equityCurve),
    consecutiveLosses: maxConsecutive(closed, (trade) => trade.pnl < 0),
    tailLoss: percentile(returns, 0.05),
    worstMarket: worstGroup(marketPnls),
    worstDay: worstGroup(dayPnls),
    downsideDeviation: roundMoney(downside),
    profitFactor: grossLosses > 0 ? roundRatio(grossWins / grossLosses) : grossWins > 0 ? Number.POSITIVE_INFINITY : 0,
    payoffRatio: losses.length ? roundRatio((average(wins.map((trade) => trade.pnl)) ?? 0) / Math.abs(average(losses.map((trade) => trade.pnl)) ?? 1)) : null,
    expectancyPerContract: expectancyPerContract(closed),
    exposureSeconds: exposureSeconds(closed),
    turnover: roundMoney(closed.reduce((total, trade) => total + trade.entryPrice * trade.contracts, 0)),
    capacityProxy: capacityProxy(closed),
    riskOfLossStreak: lossStreakProbability(closed),
    sharpeLike: risk > 0 && meanPnl !== null ? roundRatio((meanPnl / risk) * Math.sqrt(closed.length)) : 0,
    returnMoments,
    skewness: returnMoments.skewness,
    kurtosis: returnMoments.kurtosis,
    averageEntryEdge: average(closed.map((trade) => trade.entryContext.edgeAfterFees)),
    averageEntrySpread: average(closed.map((trade) => trade.entryContext.selectedSpread).filter((value) => typeof value === "number")),
    averageSecondsToClose: average(closed.map((trade) => trade.entryContext.secondsToClose)),
    averageSlippageCents: telemetry.averageSlippageCents,
    averagePartialFillRatio: telemetry.averagePartialFillRatio,
    averageFillProbability: telemetry.averageFillProbability,
    averageFillDepthUtilization: telemetry.averageFillDepthUtilization,
    probabilityCalibration,
    binaryForecastQuality: probabilityCalibration,
    brierScore: probabilityCalibration.brierScore,
    logLoss: probabilityCalibration.logLoss,
    expectedCalibrationError: probabilityCalibration.expectedCalibrationError,
    probabilityCalibrationReady: probabilityCalibration.calibrationReady,
    probabilityLabelKnownCount: probabilityCalibration.labelKnownCount,
    queueResults: telemetry.queueResults,
    latencyBuckets: telemetry.latencyBuckets,
    executionTelemetry: telemetry,
    bootstrapSeed,
    equityCurve,
    bootstrap,
    regimeBreakdown,
  };
}

export function foldMetricsForAlgo(algo, trades, folds, options = {}) {
  return folds.map((fold) => {
    const validationIds = new Set(fold.validationEventIds);
    return {
      foldId: fold.id,
      trainEventCount: fold.trainEventIds.length,
      validationEventCount: fold.validationEventIds.length,
      purgedEventCount: fold.purgedEventIds.length,
      embargoedEventCount: fold.embargoedEventIds.length,
      ...metricsForAlgo(algo, trades.filter((trade) => validationIds.has(trade.marketTicker)), { ...options, seedScope: fold.id }),
    };
  });
}

export function trainMetricsForAlgo(algo, trades, folds, options = {}) {
  return folds.map((fold) => {
    const trainIds = new Set(fold.trainEventIds);
    return {
      foldId: fold.id,
      trainEventCount: fold.trainEventIds.length,
      validationEventCount: fold.validationEventIds.length,
      purgedEventCount: fold.purgedEventIds.length,
      embargoedEventCount: fold.embargoedEventIds.length,
      ...metricsForAlgo(algo, trades.filter((trade) => trainIds.has(trade.marketTicker)), { ...options, seedScope: `${fold.id}:train` }),
    };
  });
}

export function summarizeFoldMetrics(foldMetrics) {
  const closedFolds = foldMetrics.filter((fold) => fold.closed > 0);
  const positive = closedFolds.filter((fold) => fold.totalPnl > 0 && (fold.averagePnl ?? 0) > 0);
  return {
    foldCount: foldMetrics.length,
    testedFoldCount: closedFolds.length,
    positiveFoldCount: positive.length,
    positiveFoldRate: closedFolds.length ? roundRatio(positive.length / closedFolds.length) : 0,
    minFoldPnl: closedFolds.length ? Math.min(...closedFolds.map((fold) => fold.totalPnl)) : 0,
    medianFoldPnl: median(closedFolds.map((fold) => fold.totalPnl)) ?? 0,
    foldConsistency: closedFolds.length ? roundRatio(positive.length / closedFolds.length) : 0,
  };
}

export function costComparisonMetrics(algo, byCostModel, options = {}) {
  const result = {};
  for (const [id, simulation] of Object.entries(byCostModel)) {
    result[id] = metricsForAlgo(algo, simulation.trades, { ...options, seedScope: `cost:${id}` });
  }
  return result;
}

export function executionTelemetryForSimulation(simulation) {
  const tradeTelemetry = executionTelemetryForTrades(simulation?.trades ?? []);
  const rejectReasons = {};
  for (const reject of simulation?.rejects ?? []) {
    rejectReasons[reject.reasonCode] = (rejectReasons[reject.reasonCode] ?? 0) + 1;
  }
  const fills = simulation?.trades?.length ?? 0;
  const rejects = simulation?.rejects?.length ?? 0;
  return {
    ...tradeTelemetry,
    fills,
    rejects,
    fillRate: fills + rejects > 0 ? roundRatio(fills / (fills + rejects)) : 1,
    rejectReasons,
    staleQuoteRejections: rejectReasons.stale_quote ?? 0,
    queueMisses: rejectReasons.queue_miss ?? 0,
    depthRejections: (rejectReasons.insufficient_depth ?? 0) + (rejectReasons.cannot_fill_full_size ?? 0),
  };
}

function equityCurveForTrades(closed) {
  let running = 0;
  return closed.map((trade, index) => {
    running = roundMoney(running + trade.pnl);
    return {
      index: index + 1,
      time: trade.closedAt,
      marketTicker: trade.marketTicker,
      pnl: trade.pnl,
      equity: running,
    };
  });
}

function averageDrawdown(equityCurve) {
  let peak = 0;
  const drawdowns = [];
  for (const point of equityCurve) {
    peak = Math.max(peak, point.equity);
    drawdowns.push(point.equity - peak);
  }
  return roundMoney(average(drawdowns) ?? 0);
}

function timeUnderWater(equityCurve) {
  let peak = 0;
  let count = 0;
  for (const point of equityCurve) {
    peak = Math.max(peak, point.equity);
    if (point.equity < peak) count += 1;
  }
  return equityCurve.length ? roundRatio(count / equityCurve.length) : 0;
}

function maxConsecutive(items, predicate) {
  let current = 0;
  let best = 0;
  for (const item of items) {
    current = predicate(item) ? current + 1 : 0;
    best = Math.max(best, current);
  }
  return best;
}

function percentile(values, quantile) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const index = Math.max(0, Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * quantile)));
  return roundMoney(sorted[index]);
}

function groupPnl(trades, keyFn) {
  const groups = new Map();
  for (const trade of trades) {
    const key = keyFn(trade) ?? "unknown";
    groups.set(key, roundMoney((groups.get(key) ?? 0) + trade.pnl));
  }
  return groups;
}

function worstGroup(groups) {
  const rows = [...groups.entries()].sort((left, right) => left[1] - right[1]);
  return rows.length ? { key: rows[0][0], pnl: rows[0][1] } : null;
}

function expectancyPerContract(trades) {
  const contracts = trades.reduce((total, trade) => total + trade.contracts, 0);
  const pnl = trades.reduce((total, trade) => total + trade.pnl, 0);
  return contracts > 0 ? roundMoney(pnl / contracts) : null;
}

function exposureSeconds(trades) {
  return Math.round(trades.reduce((total, trade) => {
    const opened = Date.parse(trade.openedAt);
    const closed = Date.parse(trade.closedAt ?? "");
    return total + (Number.isFinite(opened) && Number.isFinite(closed) ? Math.max(0, closed - opened) / 1000 : 0);
  }, 0));
}

function capacityProxy(trades) {
  const contracts = trades.map((trade) => trade.contracts);
  return contracts.length ? Math.max(...contracts) : 0;
}

function lossStreakProbability(trades) {
  if (!trades.length) return 1;
  const lossRate = trades.filter((trade) => trade.pnl < 0).length / trades.length;
  return roundRatio(1 - (1 - lossRate ** Math.min(5, trades.length)) ** Math.max(1, trades.length - 4));
}

function executionTelemetryForTrades(trades) {
  const contexts = trades
    .flatMap((trade) => [trade.entryContext, trade.exitContext])
    .filter((context) => context && typeof context === "object");
  const entries = trades.map((trade) => trade.entryContext).filter((context) => context && typeof context === "object");
  return {
    averageSlippageCents: roundMoney(average(contexts.map((context) => context.slippageCents).filter(Number.isFinite)) ?? 0),
    averagePartialFillRatio: roundRatio(average(entries.map((context) => context.partialFillRatio).filter(Number.isFinite)) ?? 0),
    averageFillProbability: roundRatio(average(contexts.map((context) => context.fillProbabilityUsed).filter(Number.isFinite)) ?? 0),
    averageFillDepthUtilization: roundRatio(average(entries.map((context) => context.fillDepthUtilization).filter(Number.isFinite)) ?? 0),
    queueResults: countBy(contexts, (context) => context.queueResult ?? "unknown"),
    latencyBuckets: countBy(contexts, (context) => context.latencyBucket ?? "unknown"),
  };
}

function countBy(items, keyFn) {
  const counts = {};
  for (const item of items) {
    const key = String(keyFn(item));
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function momentsFor(values) {
  const finite = values.filter(Number.isFinite);
  const n = finite.length;
  const mean = average(finite) ?? 0;
  const sd = stddev(finite) ?? 0;
  if (n < 3 || sd <= 0) return { n, mean: roundMoney(mean), variance: roundMoney(sd ** 2), skewness: 0, kurtosis: 3 };
  const centered = finite.map((value) => (value - mean) / sd);
  const skewness = n > 2
    ? (n / ((n - 1) * (n - 2))) * centered.reduce((total, value) => total + value ** 3, 0)
    : 0;
  const rawKurtosis = centered.reduce((total, value) => total + value ** 4, 0) / n;
  return {
    n,
    mean: roundMoney(mean),
    variance: roundMoney(sd ** 2),
    skewness: roundRatio(skewness),
    kurtosis: roundRatio(Math.max(1.0001, rawKurtosis)),
  };
}

function regimeMetrics(trades) {
  const fields = ["timeToClose", "spread", "liquidity", "volatility", "momentum", "distance", "phase"];
  const result = {};
  for (const field of fields) {
    const groups = new Map();
    for (const trade of trades) {
      const key = trade.entryContext.regime?.[field] ?? "unknown";
      const current = groups.get(key) ?? { closed: 0, pnl: 0, wins: 0 };
      current.closed += 1;
      current.pnl = roundMoney(current.pnl + trade.pnl);
      if (trade.pnl > 0) current.wins += 1;
      groups.set(key, current);
    }
    result[field] = Object.fromEntries([...groups.entries()].map(([key, value]) => [key, {
      ...value,
      winRate: value.closed ? roundRatio(value.wins / value.closed) : null,
    }]));
  }
  return result;
}

function bootstrapConfidenceIntervals(trades, options = {}) {
  const closed = trades.filter((trade) => trade.status === "closed" && typeof trade.pnl === "number");
  const groups = [...groupTradesByMarket(closed).values()];
  const iterations = Math.max(100, Math.min(2_000, Number(options.bootstrapIterations ?? 400)));
  const rng = seededRandom(options.seed ?? "factory-bootstrap");
  if (!groups.length) return emptyBootstrap();
  const samples = [];
  for (let index = 0; index < iterations; index += 1) {
    const sampleTrades = [];
    for (let draw = 0; draw < groups.length; draw += 1) {
      sampleTrades.push(...groups[Math.floor(rng() * groups.length)]);
    }
    samples.push(sampleSummary(sampleTrades));
  }
  return {
    meanPnl: ci(samples.map((sample) => sample.meanPnl)),
    hitRate: ci(samples.map((sample) => sample.hitRate)),
    roi: ci(samples.map((sample) => sample.roi)),
    sharpeLike: ci(samples.map((sample) => sample.sharpeLike)),
    maxDrawdown: ci(samples.map((sample) => sample.maxDrawdown)),
    profitFactor: ci(samples.map((sample) => sample.profitFactor).filter(Number.isFinite)),
  };
}

function groupTradesByMarket(trades) {
  const groups = new Map();
  for (const trade of trades) {
    const rows = groups.get(trade.marketTicker) ?? [];
    rows.push(trade);
    groups.set(trade.marketTicker, rows);
  }
  return groups;
}

function sampleSummary(trades) {
  const pnl = trades.map((trade) => trade.pnl);
  const totalPnl = pnl.reduce((total, value) => total + value, 0);
  const totalCost = trades.reduce((total, trade) => total + trade.entryPrice * trade.contracts, 0);
  const risk = stddev(pnl) ?? 0;
  const meanPnl = average(pnl) ?? 0;
  const equity = [];
  let running = 0;
  for (const value of pnl) {
    running += value;
    equity.push(running);
  }
  const grossWins = pnl.filter((value) => value > 0).reduce((total, value) => total + value, 0);
  const grossLosses = Math.abs(pnl.filter((value) => value < 0).reduce((total, value) => total + value, 0));
  return {
    meanPnl,
    hitRate: trades.length ? trades.filter((trade) => trade.pnl > 0).length / trades.length : 0,
    roi: totalCost > 0 ? totalPnl / totalCost : 0,
    sharpeLike: risk > 0 ? (meanPnl / risk) * Math.sqrt(trades.length) : 0,
    maxDrawdown: maxDrawdownFromEquity(equity),
    profitFactor: grossLosses > 0 ? grossWins / grossLosses : grossWins > 0 ? Number.POSITIVE_INFINITY : 0,
  };
}

function ci(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return { lower: null, median: null, upper: null };
  return {
    lower: roundMoney(sorted[Math.floor((sorted.length - 1) * 0.05)]),
    median: roundMoney(sorted[Math.floor((sorted.length - 1) * 0.5)]),
    upper: roundMoney(sorted[Math.floor((sorted.length - 1) * 0.95)]),
  };
}

function emptyBootstrap() {
  const empty = { lower: null, median: null, upper: null };
  return { meanPnl: empty, hitRate: empty, roi: empty, sharpeLike: empty, maxDrawdown: empty, profitFactor: empty };
}
