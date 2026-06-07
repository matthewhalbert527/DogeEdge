import { clamp, roundMoney, roundPrice, roundRatio, seededRandom } from "./utils.mjs";

export const defaultCostModels = [
  {
    id: "base",
    label: "Base visible-depth costs",
    feeRate: 0.008,
    feePerContract: 0,
    slippageCents: 0,
    spreadPenaltyCents: 0,
    stressSlippageCents: 0,
    maxLatencyMs: 5_000,
    depthShare: 0.5,
    minFillProbability: 1,
    allowPartialFills: true,
  },
  {
    id: "conservative",
    label: "Conservative visible-depth costs",
    feeRate: 0.012,
    feePerContract: 0.002,
    slippageCents: 1,
    spreadPenaltyCents: 0.5,
    stressSlippageCents: 0.5,
    maxLatencyMs: 2_500,
    depthShare: 0.25,
    minFillProbability: 0.85,
    allowPartialFills: true,
  },
  {
    id: "stress",
    label: "Stress adverse-selection costs",
    feeRate: 0.016,
    feePerContract: 0.004,
    slippageCents: 2,
    spreadPenaltyCents: 1,
    stressSlippageCents: 1,
    maxLatencyMs: 1_500,
    depthShare: 0.15,
    minFillProbability: 0.65,
    allowPartialFills: true,
  },
];

export function simulateAlgos(algos, events, options = {}) {
  const costModels = options.costModels ?? defaultCostModels;
  return algos.map((algo) => {
    const byCostModel = {};
    for (const costModel of costModels) {
      byCostModel[costModel.id] = simulateAlgoEvents(algo, events, {
        ...options,
        costModel,
        seed: `${options.seed ?? "dogeedge"}:${algo.id}:${costModel.id}`,
      });
    }
    return {
      algo,
      byCostModel,
      trades: byCostModel.base?.trades ?? Object.values(byCostModel)[0]?.trades ?? [],
    };
  });
}

export function simulateAlgoEvents(algo, events, options = {}) {
  const costModel = options.costModel ?? defaultCostModels[0];
  const rng = seededRandom(options.seed ?? `${algo.id}:${costModel.id}`);
  const trades = [];
  const rejects = [];
  let openTrade = null;

  for (const event of events) {
    for (const sourceFrame of event.frames) {
      if (!sourceFrame.marketLive || !sourceFrame.marketTicker || sourceFrame.estimate === null || sourceFrame.targetPrice === null) continue;
      const frame = executionFrame(sourceFrame, costModel);
      const currentSignal = safeSignal(algo, frame);
      let managedClosedThisFrame = false;

      if (openTrade) {
        if (openTrade.marketTicker !== frame.marketTicker) {
          trades.push(closeBySettlement(openTrade, event, frame, costModel, "Contract rolled to a new ticker."));
          openTrade = null;
        } else {
          openTrade.lastFrame = frame;
          const exitDecision = safeExit(algo, openTrade, frame, currentSignal);
          const ageMs = (frame.featureTimestampMs ?? Date.parse(frame.observedAt)) - Date.parse(openTrade.openedAt);
          const shouldFlip = currentSignal.side
            && currentSignal.side !== openTrade.side
            && currentSignal.edgeAfterFees > 0
            && ageMs >= 10_000;
          if (exitDecision) {
            const closed = closeByExecutableBid(openTrade, frame, costModel, exitDecision.reason, rng);
            if (closed) {
              trades.push(closed);
              openTrade = null;
              managedClosedThisFrame = true;
            } else {
              rejects.push(reject(frame, algo, "exit_no_fill", "No executable bid depth for managed exit."));
            }
          } else if (shouldFlip) {
            const closed = closeByExecutableBid(openTrade, frame, costModel, "Algo flipped to the opposite side.", rng);
            if (closed) {
              trades.push(closed);
              openTrade = null;
            } else {
              rejects.push(reject(frame, algo, "exit_no_fill", "No executable bid depth for flip exit."));
            }
          } else if (frame.secondsToClose <= 2) {
            trades.push(closeBySettlement(openTrade, event, frame, costModel, "Contract reached the close window."));
            openTrade = null;
          }
        }
      }

      if (!openTrade && !managedClosedThisFrame && currentSignal.side && currentSignal.edgeAfterFees > 0 && frame.secondsToClose > 8) {
        const entry = entryFill(algo, currentSignal, frame, costModel, rng);
        if (entry.ok) {
          openTrade = entry.trade;
        } else {
          rejects.push(reject(frame, algo, entry.reasonCode, entry.reason));
        }
      }
    }

    if (openTrade && openTrade.marketTicker === event.marketTicker) {
      trades.push(closeBySettlement(openTrade, event, event.frames.at(-1), costModel, "Contract settled by event label."));
      openTrade = null;
    }
  }

  if (openTrade) trades.push({ ...openTrade, lastFrame: undefined });
  return { trades, rejects, costModel };
}

function safeSignal(algo, frame) {
  try {
    return algo.signal(frame);
  } catch (error) {
    return {
      side: null,
      edgeAfterFees: -1,
      confidence: 0,
      contracts: 0,
      fairProbability: 0.5,
      reason: error instanceof Error ? error.message : "signal failed",
    };
  }
}

function safeExit(algo, trade, frame, signal) {
  if (typeof algo.exit !== "function") return null;
  try {
    return algo.exit(trade, frame, signal);
  } catch {
    return null;
  }
}

function executionFrame(frame, costModel) {
  const adverse = (costModel.slippageCents + costModel.spreadPenaltyCents + costModel.stressSlippageCents) / 100;
  return {
    ...frame,
    yesAsk: addCost(frame.yesAsk, adverse),
    noAsk: addCost(frame.noAsk, adverse),
    yesBid: subtractCost(frame.yesBid, adverse),
    noBid: subtractCost(frame.noBid, adverse),
    yesSpread: spread(addCost(frame.yesAsk, adverse), subtractCost(frame.yesBid, adverse)),
    noSpread: spread(addCost(frame.noAsk, adverse), subtractCost(frame.noBid, adverse)),
  };
}

function entryFill(algo, signal, frame, costModel, rng) {
  if (staleFrame(frame, costModel)) return { ok: false, reasonCode: "stale_quote", reason: "Frame was stale under the execution cost model." };
  const side = signal.side;
  const ask = askForSide(side, frame);
  const maxAsk = side === "BOTH" ? 1.1 : 1;
  if (ask === null || ask <= 0 || ask >= maxAsk) return { ok: false, reasonCode: "no_ask", reason: "No executable ask price." };
  if (rng() > costModel.minFillProbability) return { ok: false, reasonCode: "queue_miss", reason: "Queue/fill probability rejected the entry." };
  const requestedContracts = Math.max(1, Math.floor(signal.contracts || 1));
  const fillable = fillableContracts(side, "ask", frame, costModel, requestedContracts);
  if (fillable <= 0) return { ok: false, reasonCode: "insufficient_depth", reason: "Top-of-book ask depth is insufficient." };
  const contracts = costModel.allowPartialFills ? Math.min(requestedContracts, fillable) : requestedContracts <= fillable ? requestedContracts : 0;
  if (contracts <= 0) return { ok: false, reasonCode: "cannot_fill_full_size", reason: "Full requested size cannot fill at visible depth." };
  const feePaid = executionFee(ask, contracts, costModel);
  return {
    ok: true,
    trade: {
      id: `${algo.id}-${costModel.id}-${frame.marketTicker}-${side}-${frame.featureTimestampMs ?? Date.parse(frame.observedAt)}`,
      marketTicker: frame.marketTicker,
      marketTitle: frame.marketTitle,
      side,
      contracts,
      requestedContracts,
      entryPrice: roundPrice(ask),
      exitPrice: null,
      targetPrice: frame.targetPrice,
      openedAt: frame.featureTimestamp ?? frame.observedAt,
      closedAt: null,
      status: "open",
      result: "-",
      pnl: null,
      feesPaid: feePaid,
      entryFrameId: frame.id,
      exitFrameId: null,
      entryContext: tradeContext(frame, signal, side, costModel),
      exitContext: null,
      lastFrame: frame,
      reason: signal.reason,
      costModelId: costModel.id,
    },
  };
}

function closeByExecutableBid(trade, frame, costModel, reason, rng) {
  if (staleFrame(frame, costModel)) return null;
  if (rng() > costModel.minFillProbability) return null;
  const bid = bidForSide(trade.side, frame);
  if (bid === null || bid < 0) return null;
  const fillable = fillableContracts(trade.side, "bid", frame, costModel, trade.contracts);
  const contracts = costModel.allowPartialFills ? Math.min(trade.contracts, fillable) : trade.contracts <= fillable ? trade.contracts : 0;
  if (contracts <= 0) return null;
  return closeByPrice(trade, frame, bid, reason, costModel, contracts);
}

function closeBySettlement(trade, event, frame, costModel, reason) {
  if (trade.side === "BOTH") return closeByPrice(trade, frame, 1, reason, costModel, trade.contracts);
  const sideWon = trade.side === event.outcomeSide;
  return closeByPrice(trade, frame, sideWon ? 1 : 0, reason, costModel, trade.contracts);
}

function closeByPrice(trade, frame, exitPrice, reason, costModel, contracts) {
  const closedContracts = Math.max(1, Math.min(trade.contracts, Math.floor(contracts)));
  const entryFee = proratedFee(trade.feesPaid, closedContracts, trade.contracts);
  const exitFee = exitPrice > 0 && exitPrice < 1 ? executionFee(exitPrice, closedContracts, costModel) : 0;
  const feesPaid = roundMoney(entryFee + exitFee);
  const pnl = roundMoney((exitPrice - trade.entryPrice) * closedContracts - feesPaid);
  return {
    ...trade,
    id: closedContracts === trade.contracts ? trade.id : `${trade.id}-partial-${Date.parse(frame.observedAt)}-${closedContracts}`,
    contracts: closedContracts,
    exitPrice: roundPrice(exitPrice),
    closedAt: frame.featureTimestamp ?? frame.observedAt,
    status: "closed",
    result: pnl > 0 ? "Win" : "Loss",
    pnl,
    feesPaid,
    reason,
    exitFrameId: frame.id,
    exitContext: tradeContext(frame, contextSignalFromTrade(trade), trade.side, costModel),
    lastFrame: undefined,
  };
}

function tradeContext(frame, signal, side, costModel) {
  const selectedAsk = askForSide(side, frame);
  const selectedBid = bidForSide(side, frame);
  return {
    observedAt: frame.featureTimestamp ?? frame.observedAt,
    featureTimestamp: frame.featureTimestamp,
    labelTimestamp: frame.labelTimestamp,
    settlementTimestamp: frame.settlementTimestamp,
    marketCloseTimestamp: frame.marketCloseTimestamp,
    side,
    targetPrice: frame.targetPrice,
    estimate: frame.estimate,
    spotPrice: frame.spotPrice,
    oneMinuteChange: frame.oneMinuteChange,
    oneMinuteMovePercent: frame.oneMinuteMovePercent,
    distanceFromTarget: frame.distanceFromTarget,
    fairProbability: roundRatio(signal.fairProbability),
    edgeAfterFees: roundRatio(signal.edgeAfterFees),
    confidence: signal.confidence,
    secondsToClose: frame.secondsToClose,
    yesAsk: frame.yesAsk,
    noAsk: frame.noAsk,
    yesBid: frame.yesBid,
    noBid: frame.noBid,
    selectedAsk,
    selectedBid,
    selectedSpread: spread(selectedAsk, selectedBid),
    yesSpread: spread(frame.yesAsk, frame.yesBid),
    noSpread: spread(frame.noAsk, frame.noBid),
    costModelId: costModel.id,
    regime: frame.regime ?? null,
  };
}

function contextSignalFromTrade(trade) {
  return {
    confidence: trade.entryContext.confidence,
    edgeAfterFees: trade.entryContext.edgeAfterFees,
    fairProbability: trade.entryContext.fairProbability,
  };
}

function staleFrame(frame, costModel) {
  const captured = Date.parse(frame.capturedAt ?? "");
  const observed = Date.parse(frame.observedAt ?? "");
  if (!Number.isFinite(captured) || !Number.isFinite(observed)) return true;
  return captured - observed > costModel.maxLatencyMs;
}

function fillableContracts(side, bookSide, frame, costModel, requestedContracts) {
  const visibleDepth = side === "YES"
    ? bookSide === "ask" ? frame.yesAskDepth : frame.yesBidDepth
    : side === "NO"
      ? bookSide === "ask" ? frame.noAskDepth : frame.noBidDepth
      : Math.min(frame.yesAskDepth ?? 0, frame.noAskDepth ?? 0);
  if (!Number.isFinite(visibleDepth) || visibleDepth <= 0) return 0;
  return Math.floor(Math.max(0, Math.min(requestedContracts, visibleDepth * costModel.depthShare)));
}

function executionFee(price, contracts, costModel) {
  return roundMoney(Math.max(0, contracts * costModel.feePerContract + price * contracts * costModel.feeRate));
}

function proratedFee(totalFee, closedContracts, originalContracts) {
  if (!Number.isFinite(totalFee) || !Number.isFinite(originalContracts) || originalContracts <= 0) return 0;
  return roundMoney(totalFee * closedContracts / originalContracts);
}

function askForSide(side, frame) {
  if (side === "YES") return frame.yesAsk;
  if (side === "NO") return frame.noAsk;
  if (side === "BOTH" && frame.yesAsk !== null && frame.noAsk !== null) return roundPrice(frame.yesAsk + frame.noAsk);
  return null;
}

function bidForSide(side, frame) {
  if (side === "YES") return frame.yesBid;
  if (side === "NO") return frame.noBid;
  if (side === "BOTH" && frame.yesBid !== null && frame.noBid !== null) return roundPrice(frame.yesBid + frame.noBid);
  return null;
}

function addCost(value, cost) {
  return value === null ? null : clamp(roundPrice(value + cost), 0, 1.1);
}

function subtractCost(value, cost) {
  return value === null ? null : clamp(roundPrice(value - cost), 0, 1.1);
}

function spread(ask, bid) {
  return ask === null || bid === null ? null : roundRatio(Math.max(0, ask - bid));
}

function reject(frame, algo, reasonCode, reason) {
  return {
    algoId: algo.id,
    marketTicker: frame.marketTicker,
    observedAt: frame.featureTimestamp ?? frame.observedAt,
    frameId: frame.id,
    reasonCode,
    reason,
  };
}

