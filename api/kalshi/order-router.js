import crypto from "node:crypto";

const KALSHI_BASE_URL = process.env.KALSHI_BASE_URL ?? "https://external-api.kalshi.com";
const TRADE_API_PATH = "/trade-api/v2";
const DEFAULT_SERIES = "KXDOGE15M";
const DEFAULT_MAX_ORDER_DOLLARS = 10;
const DEFAULT_MAX_EXPOSURE_DOLLARS = 50;
const DEFAULT_MAX_SLIPPAGE_CENTS = 1;
const DEFAULT_EXECUTION_MIN_EDGE_AFTER_FEES = 0.01;
const DEFAULT_CONSERVATIVE_MIN_CONFIDENCE = 92;
const DEFAULT_CONSERVATIVE_MIN_EDGE = 0.06;
const DEFAULT_CONSERVATIVE_MIN_SIDE_PROBABILITY = 0.90;
const DEFAULT_CONSERVATIVE_MAX_SPREAD_CENTS = 2;
const DEFAULT_CONSERVATIVE_MIN_SECONDS_TO_CLOSE = 20;
const DEFAULT_CONSERVATIVE_MAX_SECONDS_TO_CLOSE = 300;
const MAX_CONTRACTS_PER_KALSHI_ORDER = 100;
const activePaperRules = {
  thresholdMinDistanceFromTarget: 0.0002,
  orderbookScalpMaxSpread: 0.02,
  momentumMaxSpread: 0.06,
  yesProbation: {
    minEdgeAfterFees: 0.18,
    minConfidence: 80,
    maxSpread: 0.02,
  },
};
const generatedPaperFamilies = new Set([
  "sweep-model",
  "sweep-distance",
  "sweep-scalp",
  "sweep-momentum",
  "sweep-momentum-trail",
  "sweep-fade-model",
  "sweep-fade-momentum",
  "sweep-target-revert",
  "sweep-managed-scalp",
  "sweep-cheap-longshot",
  "sweep-late-favorite",
  "sweep-liquidity-imbalance",
  "paper",
  "paper-variant",
  "shadow",
]);

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0");

  if (request.method === "GET") {
    response.status(200).json(routerStatus(process.env));
    return;
  }

  if (request.method !== "POST") {
    response.setHeader("Allow", "GET, POST");
    response.status(405).json({ status: "error", error: "Method not allowed" });
    return;
  }

  const status = routerStatus(process.env);
  const body = parseRequestBody(request.body);
  if (!body.ok) {
    response.status(400).json({
      ...status,
      accepted: false,
      status: "rejected",
      error: body.error,
    });
    return;
  }

  const parsed = normalizeOrderRequest(body.value, status);
  if (!parsed.ok) {
    response.status(400).json({
      ...status,
      accepted: false,
      status: "rejected",
      error: parsed.error,
    });
    return;
  }

  const order = parsed.order;
  if (!status.liveSwitchEnabled && order.action !== "sell") {
    response.status(200).json({
      ...status,
      accepted: false,
      status: "locked",
      error: "Live trading switch is OFF. New buys are blocked; sell exits remain allowed.",
      risk: order.risk,
    });
    return;
  }

  const keyId = process.env.KALSHI_API_KEY_ID;
  const privateKeyPem = normalizePrivateKey(process.env.KALSHI_PRIVATE_KEY_PEM);
  if (!status.dryRun && (!keyId || !privateKeyPem)) {
    response.status(200).json({
      ...status,
      accepted: false,
      status: "not_configured",
      error: "Kalshi credentials are not configured on the backend.",
      risk: order.risk,
    });
    return;
  }

  const liveRouteReady = order.action === "sell" ? status.sellExitsEnabled : status.liveEnabled;
  if (!liveRouteReady && !status.dryRun) {
    response.status(200).json({
      ...status,
      accepted: false,
      status: "locked",
      error: order.action === "sell"
        ? "Live sell exits are locked. Set DOGEEDGE_LIVE_TRADING_ENABLED=1 and DOGEEDGE_LIVE_DRY_RUN=0 on the backend."
        : "Live trading is locked. Turn on the live switch after backend live mode is configured.",
      risk: order.risk,
    });
    return;
  }

  try {
    const accountRisk = !status.dryRun && keyId && privateKeyPem
      ? fetchAccountRisk(keyId, privateKeyPem, status.allowedSeries)
      : Promise.resolve(emptyAccountRisk());
    const [account, execution] = await Promise.all([
      accountRisk,
      buildExecutionPlan(order, status),
    ]);
    if (!execution.ok) {
      response.status(200).json({
        ...status,
        accepted: false,
        status: "rejected",
        error: execution.error,
        execution: execution.snapshot ?? null,
      });
      return;
    }

    const risk = riskCheckExecutionPlan(execution.plan, account, status);
    if (!risk.ok) {
      response.status(200).json({
        ...status,
        accepted: false,
        status: "rejected",
        error: risk.error,
        risk: risk.snapshot,
      });
      return;
    }

    const submission = await submitExecutionPlan(execution.plan, status.dryRun, keyId, privateKeyPem);
    const accepted = status.dryRun ? submission.submittedOrders.length > 0 : submission.filledContracts > 0;

    response.status(status.dryRun || !accepted ? 200 : 201).json({
      ...status,
      accepted,
      status: accepted ? status.dryRun ? "dry_run" : "submitted" : "rejected",
      dryRun: status.dryRun,
      clientOrderId: submission.lastClientOrderId,
      kalshiOrder: submission.submittedOrders.at(-1)?.kalshiOrder ?? null,
      routedOrder: submission.submittedOrders.map((item) => redactedOrderPayload(item.payload)),
      execution: execution.plan.snapshot,
      submittedContracts: submission.filledContracts,
      submittedCostCents: submission.filledCostCents,
      requestedContracts: submission.requestedContracts,
      requestedCostCents: submission.requestedCostCents,
      submittedOrders: submission.submittedOrders.map((item) => ({
        clientOrderId: item.clientOrderId,
        count: item.filledCount,
        requestedCount: item.requestedCount,
        priceCents: item.priceCents,
        side: item.side,
        status: item.status,
      })),
      risk: risk.snapshot,
      error: accepted ? null : submission.error ?? "Kalshi accepted the IOC request but filled 0 contracts.",
      message: accepted
        ? status.dryRun
          ? `Dry run accepted for ${submission.filledContracts} contracts from the fresh order book. No order was sent to Kalshi.`
          : `Live order filled from the fresh order book: ${submission.filledContracts} contracts across ${submission.submittedOrders.length} IOC order${submission.submittedOrders.length === 1 ? "" : "s"}.`
        : submission.error ?? "Kalshi accepted the IOC request but filled 0 contracts; the runner will retry.",
    });
  } catch (error) {
    response.status(200).json({
      ...status,
      accepted: false,
      status: "error",
      error: error instanceof Error ? error.message : "Kalshi order router failed",
    });
  }
}

function emptyAccountRisk() {
  return {
    balanceCents: null,
    openPositionCostCents: 0,
    restingBuyCostCents: 0,
    openPositionTickers: [],
    restingOrderTickers: [],
  };
}

export function routerStatus(env = process.env) {
  const maxOrderDollars = positiveNumber(env.DOGEEDGE_LIVE_MAX_ORDER_DOLLARS, DEFAULT_MAX_ORDER_DOLLARS);
  const maxExposureDollars = positiveNumber(env.DOGEEDGE_LIVE_MAX_EXPOSURE_DOLLARS, DEFAULT_MAX_EXPOSURE_DOLLARS);
  const executionMinEdgeAfterFees = positiveNumber(env.DOGEEDGE_EXECUTION_MIN_EDGE, DEFAULT_EXECUTION_MIN_EDGE_AFTER_FEES);
  const allowedSeries = stringOrDefault(env.DOGEEDGE_LIVE_ALLOWED_SERIES, DEFAULT_SERIES);
  const credentialsConfigured = Boolean(env.KALSHI_API_KEY_ID && normalizePrivateKey(env.KALSHI_PRIVATE_KEY_PEM));
  const liveSwitchEnabled = env.DOGEEDGE_LIVE_SWITCH_ENABLED === "1";
  const dryRun = env.DOGEEDGE_LIVE_DRY_RUN !== "0";
  const liveModeReady = env.DOGEEDGE_LIVE_TRADING_ENABLED === "1" && !dryRun;
  const conservativeMode = env.DOGEEDGE_CONSERVATIVE_MODE === "1";
  return {
    configured: credentialsConfigured,
    liveEnabled: liveSwitchEnabled && liveModeReady,
    dryRun,
    liveSwitchEnabled,
    sellExitsEnabled: liveModeReady,
    allowedSeries,
    maxOrderDollars,
    maxExposureDollars,
    executionMinEdgeAfterFees,
    conservativeMode,
    conservative: {
      minConfidence: positiveNumber(env.DOGEEDGE_CONSERVATIVE_MIN_CONFIDENCE, DEFAULT_CONSERVATIVE_MIN_CONFIDENCE),
      minEdgeAfterFees: positiveNumber(env.DOGEEDGE_CONSERVATIVE_MIN_EDGE, DEFAULT_CONSERVATIVE_MIN_EDGE),
      minSideProbability: positiveNumber(env.DOGEEDGE_CONSERVATIVE_MIN_SIDE_PROBABILITY, DEFAULT_CONSERVATIVE_MIN_SIDE_PROBABILITY),
      maxSpreadCents: positiveNumber(env.DOGEEDGE_CONSERVATIVE_MAX_SPREAD_CENTS, DEFAULT_CONSERVATIVE_MAX_SPREAD_CENTS),
      minSecondsToClose: positiveNumber(env.DOGEEDGE_CONSERVATIVE_MIN_SECONDS_TO_CLOSE, DEFAULT_CONSERVATIVE_MIN_SECONDS_TO_CLOSE),
      maxSecondsToClose: positiveNumber(env.DOGEEDGE_CONSERVATIVE_MAX_SECONDS_TO_CLOSE, DEFAULT_CONSERVATIVE_MAX_SECONDS_TO_CLOSE),
    },
  };
}

export function normalizeOrderRequest(body, status) {
  if (!isRecord(body)) return reject("Order request body must be a JSON object.");

  const algoId = stringOrNull(body.algoId);
  const algoDisplayId = stringOrNull(body.algoDisplayId);
  const algoName = stringOrNull(body.algoName);
  const ticker = stringOrNull(body.ticker);
  const side = normalizedEnum(body.side, ["yes", "no"]);
  const action = normalizedEnum(body.action, ["buy", "sell"]);
  const signalAction = normalizedEnum(body.signalAction, ["buy_yes", "buy_no"]);
  const count = integerNumber(body.count);
  const priceCents = integerNumber(body.priceCents);
  const maxTradeDollars = moneyNumber(body.maxTradeDollars);
  const maxSlippageCents = integerNumber(body.maxSlippageCents);
  const executionProfile = normalizedEnum(body.executionProfile, ["standard", "conservative"]) ?? (status.conservativeMode && !status.dryRun ? "conservative" : "standard");
  const algoFamily = stringOrNull(body.algoFamily);
  const algoSourceId = stringOrNull(body.algoSourceId);
  const algoParams = isRecord(body.algoParams) ? { ...body.algoParams } : null;
  const paperInput = normalizePaperInput(body.paperInput);

  if (!algoId || !algoId.startsWith("generated:")) return reject("Live orders require a selected generated algo ID.");
  if (!algoDisplayId) return reject("Live orders require the selected algo display ID.");
  if (!algoName) return reject("Live orders require the selected algo name.");
  if (!ticker || !ticker.startsWith(status.allowedSeries)) return reject(`Ticker must be an active ${status.allowedSeries} market.`);
  if (!side) return reject("Order side must be yes or no.");
  if (!action) return reject("Order action must be buy or sell.");
  if (action === "buy" && !signalAction) return reject("Live buys require a current selected-algo buy signal.");
  if (action === "buy" && signalAction !== `buy_${side}`) return reject("The selected algo signal does not match the requested side.");
  if (count === null || count < 1 || count > 5_000) return reject("Order count must be a whole number from 1 to 5000.");
  if (priceCents === null || priceCents < 1 || priceCents > 99) return reject("Limit price must be 1-99 cents.");
  if (action === "buy" && (maxTradeDollars === null || maxTradeDollars <= 0)) return reject("Max per trade must be greater than $0.");
  if (action === "buy" && maxTradeDollars > status.maxOrderDollars) return reject(`Max per trade is capped at ${money(status.maxOrderDollars)} by the backend.`);

  const estimatedCostCents = count * priceCents;
  if (action === "buy" && estimatedCostCents > dollarsToCents(maxTradeDollars)) {
    return reject(`Order cost ${centsMoney(estimatedCostCents)} exceeds max per trade ${money(maxTradeDollars)}.`);
  }

  return {
    ok: true,
    order: {
      algoId,
      algoDisplayId,
      algoName,
      ticker,
      side,
      action,
      signalAction,
      count,
      priceCents,
      maxTradeDollars: maxTradeDollars ?? status.maxOrderDollars,
      maxSlippageCents: maxSlippageCents === null ? DEFAULT_MAX_SLIPPAGE_CENTS : Math.max(0, Math.min(5, maxSlippageCents)),
      executionProfile,
      algoFamily,
      algoSourceId,
      algoParams,
      paperInput,
      estimatedCostCents,
      risk: {
        requestedCostCents: estimatedCostCents,
        maxTradeCents: dollarsToCents(maxTradeDollars ?? status.maxOrderDollars),
      },
    },
  };
}

export async function buildExecutionPlan(order, status) {
  if (order.action === "sell") {
    return buildSellExecutionPlan(order);
  }

  if (!order.algoFamily || !order.algoParams || !order.paperInput) {
    if (shouldApplyConservative(order, status)) {
      return {
        ok: false,
        error: "Conservative execution requires generated algo metadata and a fresh paper input snapshot.",
        snapshot: {
          source: "conservative-missing-metadata",
          ticker: order.ticker,
          side: order.side,
          signalAction: order.signalAction,
          requestedPriceCents: order.priceCents,
          totalCount: 0,
          totalEstimatedCostCents: 0,
          reason: "Conservative mode cannot re-check a legacy frontend-sized order.",
        },
      };
    }
    return {
      ok: true,
      plan: {
        source: "frontend-snapshot",
        orders: [order],
        totalCount: order.count,
        totalEstimatedCostCents: order.estimatedCostCents,
        snapshot: {
          source: "frontend-snapshot",
          ticker: order.ticker,
          side: order.side,
          signalAction: order.signalAction,
          requestedPriceCents: order.priceCents,
          limitPriceCents: order.priceCents,
          slippageCents: 0,
          totalCount: order.count,
          totalEstimatedCostCents: order.estimatedCostCents,
          reason: "Legacy frontend-sized order.",
        },
      },
    };
  }

  const fresh = await fetchFreshMarketByTicker(order.ticker);
  const input = paperInputFromFreshMarket(order.paperInput, fresh);
  const algo = {
    id: order.algoId,
    displayId: order.algoDisplayId,
    sourceAlgoId: order.algoSourceId ?? "",
    name: order.algoName,
    family: order.algoFamily,
    params: order.algoParams,
  };
  const signal = generatedPaperAlgoSignal(input, algo);
  const side = sideFromAction(signal.action);
  const requestedSide = order.side.toUpperCase();
  if (!side || signal.action !== order.signalAction || side !== requestedSide) {
    return {
      ok: false,
      error: `Fresh ${order.algoDisplayId} signal is ${signal.action}; waiting instead of chasing the old ${order.signalAction} signal.`,
      snapshot: executionSnapshot(order, fresh, signal, null, [], "Fresh algo signal changed before order placement."),
    };
  }

  const freshAskCents = askCentsForSide(side, input);
  if (freshAskCents === null) {
    return {
      ok: false,
      error: `Fresh ${side} ask is unavailable; waiting for a tradable book.`,
      snapshot: executionSnapshot(order, fresh, signal, null, [], "Fresh ask unavailable."),
    };
  }

  const limitPriceCents = Math.min(99, order.priceCents + order.maxSlippageCents);
  if (freshAskCents > limitPriceCents) {
    return {
      ok: false,
      error: `Fresh ${side} ask moved to ${freshAskCents}c, above allowed ${limitPriceCents}c.`,
      snapshot: executionSnapshot(order, fresh, signal, limitPriceCents, [], "Fresh ask exceeded slippage limit."),
    };
  }

  const limitInput = inputWithSideAsk(input, side, limitPriceCents / 100);
  const limitSignal = generatedPaperAlgoSignal(limitInput, algo);
  const minEdgeAfterFees = status.executionMinEdgeAfterFees ?? DEFAULT_EXECUTION_MIN_EDGE_AFTER_FEES;
  const limitFailure = executableLimitFailureMessage("Fresh", order.algoDisplayId, side, order.signalAction, limitSignal, limitPriceCents, minEdgeAfterFees);
  if (limitFailure) {
    return {
      ok: false,
      error: limitFailure,
      snapshot: executionSnapshot(order, fresh, limitSignal, limitPriceCents, [], "Fresh signal failed the executable slippage-limit check."),
    };
  }

  const conservative = shouldApplyConservative(order, status) ? conservativeBuyCheck(input, side, limitSignal, status) : { ok: true };
  if (!conservative.ok) {
    return {
      ok: false,
      error: conservative.error,
      snapshot: executionSnapshot(order, fresh, limitSignal, limitPriceCents, [], conservative.error),
    };
  }

  const plannedOrders = depthAwareOrders(order, fresh, side, limitPriceCents);
  if (!plannedOrders.length) {
    return {
      ok: false,
      error: `No visible ${side} ask depth is available at ${limitPriceCents}c or better.`,
      snapshot: executionSnapshot(order, fresh, signal, limitPriceCents, [], "No executable visible depth."),
    };
  }

  const totalCount = plannedOrders.reduce((total, item) => total + item.count, 0);
  const totalEstimatedCostCents = plannedOrders.reduce((total, item) => total + item.estimatedCostCents, 0);
  return {
    ok: true,
    plan: {
      source: "fresh-depth",
      orders: plannedOrders,
      totalCount,
      totalEstimatedCostCents,
      snapshot: executionSnapshot(order, fresh, signal, limitPriceCents, plannedOrders, "Fresh book depth-aware IOC plan."),
    },
  };
}

function buildSnapshotBuyExecutionPlan(order) {
  const input = order.paperInput;
  const algo = {
    id: order.algoId,
    displayId: order.algoDisplayId,
    sourceAlgoId: order.algoSourceId ?? "",
    name: order.algoName,
    family: order.algoFamily,
    params: order.algoParams,
  };
  const signal = generatedPaperAlgoSignal(input, algo);
  const side = sideFromAction(signal.action);
  const requestedSide = order.side.toUpperCase();
  if (!side || signal.action !== order.signalAction || side !== requestedSide) {
    return {
      ok: false,
      error: `Current ${order.algoDisplayId} signal is ${signal.action}; waiting instead of chasing the old ${order.signalAction} signal.`,
      snapshot: snapshotExecutionSnapshot(order, input, signal, null, [], "Current algo signal changed before dry-run placement."),
    };
  }

  const currentAskCents = askCentsForSide(side, input);
  if (currentAskCents === null) {
    return {
      ok: false,
      error: `Current ${side} ask is unavailable; waiting for a tradable book.`,
      snapshot: snapshotExecutionSnapshot(order, input, signal, null, [], "Current ask unavailable."),
    };
  }

  const limitPriceCents = Math.min(99, order.priceCents + order.maxSlippageCents);
  if (currentAskCents > limitPriceCents) {
    return {
      ok: false,
      error: `Current ${side} ask moved to ${currentAskCents}c, above allowed ${limitPriceCents}c.`,
      snapshot: snapshotExecutionSnapshot(order, input, signal, limitPriceCents, [], "Current ask exceeded slippage limit."),
    };
  }

  const limitInput = inputWithSideAsk(input, side, limitPriceCents / 100);
  const limitSignal = generatedPaperAlgoSignal(limitInput, algo);
  const limitFailure = executableLimitFailureMessage("Current", order.algoDisplayId, side, order.signalAction, limitSignal, limitPriceCents, DEFAULT_EXECUTION_MIN_EDGE_AFTER_FEES);
  if (limitFailure) {
    return {
      ok: false,
      error: limitFailure,
      snapshot: snapshotExecutionSnapshot(order, input, limitSignal, limitPriceCents, [], "Current signal failed the executable slippage-limit check."),
    };
  }

  const plannedOrders = depthAwareSnapshotOrders(order, input, side, limitPriceCents);
  if (!plannedOrders.length) {
    return {
      ok: false,
      error: `No visible ${side} ask depth is available at ${limitPriceCents}c or better.`,
      snapshot: snapshotExecutionSnapshot(order, input, signal, limitPriceCents, [], "No executable visible snapshot depth."),
    };
  }

  const totalCount = plannedOrders.reduce((total, item) => total + item.count, 0);
  const totalEstimatedCostCents = plannedOrders.reduce((total, item) => total + item.estimatedCostCents, 0);
  return {
    ok: true,
    plan: {
      source: "snapshot-depth",
      orders: plannedOrders,
      totalCount,
      totalEstimatedCostCents,
      snapshot: snapshotExecutionSnapshot(order, input, signal, limitPriceCents, plannedOrders, "Current snapshot depth-aware dry-run plan."),
    },
  };
}

async function buildSellExecutionPlan(order) {
  const fresh = await fetchFreshMarketByTicker(order.ticker);
  const side = order.side.toUpperCase();
  const minPriceCents = Math.max(1, order.priceCents - order.maxSlippageCents);
  const freshBidCents = bidCentsForSide(side, fresh.orderbook);

  if (freshBidCents === null) {
    return {
      ok: false,
      error: `Fresh ${side} bid is unavailable; waiting for exit liquidity.`,
      snapshot: sellExecutionSnapshot(order, fresh, minPriceCents, [], "Fresh bid unavailable."),
    };
  }

  if (freshBidCents < minPriceCents) {
    return {
      ok: false,
      error: `Fresh ${side} bid moved to ${freshBidCents}c, below allowed ${minPriceCents}c.`,
      snapshot: sellExecutionSnapshot(order, fresh, minPriceCents, [], "Fresh bid moved below sell floor."),
    };
  }

  const plannedOrders = depthAwareSellOrders(order, fresh, side, minPriceCents);
  if (!plannedOrders.length) {
    return {
      ok: false,
      error: `No visible ${side} bid depth is available at ${minPriceCents}c or better.`,
      snapshot: sellExecutionSnapshot(order, fresh, minPriceCents, [], "No executable visible sell depth."),
    };
  }

  const totalCount = plannedOrders.reduce((total, item) => total + item.count, 0);
  const totalEstimatedCostCents = plannedOrders.reduce((total, item) => total + item.estimatedCostCents, 0);
  return {
    ok: true,
    plan: {
      source: "fresh-sell-depth",
      orders: plannedOrders,
      totalCount,
      totalEstimatedCostCents,
      snapshot: sellExecutionSnapshot(order, fresh, minPriceCents, plannedOrders, "Fresh book depth-aware reduce-only sell plan."),
    },
  };
}

function buildSnapshotSellExecutionPlan(order) {
  const input = order.paperInput;
  const side = order.side.toUpperCase();
  const minPriceCents = Math.max(1, order.priceCents - order.maxSlippageCents);
  const currentBidCents = bidCentsForInputSide(side, input);

  if (currentBidCents === null) {
    return {
      ok: false,
      error: `Current ${side} bid is unavailable; waiting for exit liquidity.`,
      snapshot: snapshotSellExecutionSnapshot(order, input, minPriceCents, [], "Current bid unavailable."),
    };
  }

  if (currentBidCents < minPriceCents) {
    return {
      ok: false,
      error: `Current ${side} bid moved to ${currentBidCents}c, below allowed ${minPriceCents}c.`,
      snapshot: snapshotSellExecutionSnapshot(order, input, minPriceCents, [], "Current bid moved below sell floor."),
    };
  }

  const plannedOrders = depthAwareSnapshotSellOrders(order, input, side, minPriceCents);
  if (!plannedOrders.length) {
    return {
      ok: false,
      error: `No visible ${side} bid depth is available at ${minPriceCents}c or better.`,
      snapshot: snapshotSellExecutionSnapshot(order, input, minPriceCents, [], "No executable visible snapshot sell depth."),
    };
  }

  const totalCount = plannedOrders.reduce((total, item) => total + item.count, 0);
  const totalEstimatedCostCents = plannedOrders.reduce((total, item) => total + item.estimatedCostCents, 0);
  return {
    ok: true,
    plan: {
      source: "snapshot-sell-depth",
      orders: plannedOrders,
      totalCount,
      totalEstimatedCostCents,
      snapshot: snapshotSellExecutionSnapshot(order, input, minPriceCents, plannedOrders, "Current snapshot depth-aware reduce-only dry-run plan."),
    },
  };
}

function depthAwareSellOrders(order, fresh, side, minPriceCents) {
  let remainingContracts = order.count;
  const sideLower = side.toLowerCase();
  const levels = bidLevelsForSide(side, fresh.orderbook)
    .map((level) => ({
      priceCents: priceToFloorCents(level.price),
      availableContracts: Math.floor(level.size),
    }))
    .filter((level) => level.priceCents >= minPriceCents && level.availableContracts > 0)
    .sort((left, right) => right.priceCents - left.priceCents);
  const orders = [];

  for (const level of levels) {
    let levelCount = Math.min(level.availableContracts, remainingContracts);
    while (levelCount > 0) {
      const count = Math.min(MAX_CONTRACTS_PER_KALSHI_ORDER, levelCount);
      orders.push({
        ...order,
        side: sideLower,
        action: "sell",
        count,
        priceCents: level.priceCents,
        estimatedCostCents: count * level.priceCents,
        risk: {
          requestedCostCents: 0,
          maxTradeCents: dollarsToCents(order.maxTradeDollars),
        },
      });
      remainingContracts -= count;
      levelCount -= count;
      if (remainingContracts <= 0) break;
    }
    if (remainingContracts <= 0) break;
  }

  return orders;
}

function depthAwareSnapshotOrders(order, input, side, limitPriceCents) {
  const askCents = askCentsForSide(side, input);
  const askDepth = askDepthForInputSide(side, input);
  if (askCents === null || askCents > limitPriceCents || askDepth <= 0) return [];

  const sideLower = side.toLowerCase();
  const maxCostCents = dollarsToCents(order.maxTradeDollars);
  let remainingContracts = Math.min(
    order.count,
    Math.floor(askDepth),
    Math.floor(maxCostCents / askCents),
  );
  const orders = [];

  while (remainingContracts > 0) {
    const count = Math.min(MAX_CONTRACTS_PER_KALSHI_ORDER, remainingContracts);
    orders.push({
      ...order,
      ticker: order.ticker,
      side: sideLower,
      signalAction: actionForSide(side),
      count,
      priceCents: askCents,
      estimatedCostCents: count * askCents,
      risk: {
        requestedCostCents: count * askCents,
        maxTradeCents: maxCostCents,
      },
    });
    remainingContracts -= count;
  }

  return orders;
}

function depthAwareSnapshotSellOrders(order, input, side, minPriceCents) {
  const bidCents = bidCentsForInputSide(side, input);
  const bidDepth = bidDepthForInputSide(side, input);
  if (bidCents === null || bidCents < minPriceCents || bidDepth <= 0) return [];

  const sideLower = side.toLowerCase();
  let remainingContracts = Math.min(order.count, Math.floor(bidDepth));
  const orders = [];

  while (remainingContracts > 0) {
    const count = Math.min(MAX_CONTRACTS_PER_KALSHI_ORDER, remainingContracts);
    orders.push({
      ...order,
      side: sideLower,
      action: "sell",
      count,
      priceCents: bidCents,
      estimatedCostCents: count * bidCents,
      risk: {
        requestedCostCents: 0,
        maxTradeCents: dollarsToCents(order.maxTradeDollars),
      },
    });
    remainingContracts -= count;
  }

  return orders;
}

function sellExecutionSnapshot(order, fresh, minPriceCents, orders, reason) {
  const side = order.side.toUpperCase();
  const bidLevels = bidLevelsForSide(side, fresh.orderbook);
  return {
    source: "fresh-sell-depth",
    ticker: fresh.market.ticker,
    observedAt: fresh.observedAt,
    side,
    action: "sell",
    requestedPriceCents: order.priceCents,
    limitPriceCents: minPriceCents,
    slippageCents: order.maxSlippageCents,
    bestBidCents: bidLevels.length ? priceToFloorCents(bidLevels[0].price) : null,
    visibleDepthAtLimit: bidLevels
      .filter((level) => priceToFloorCents(level.price) >= minPriceCents)
      .reduce((total, level) => total + Math.floor(level.size), 0),
    totalCount: orders.reduce((total, item) => total + item.count, 0),
    totalEstimatedCostCents: orders.reduce((total, item) => total + item.estimatedCostCents, 0),
    plannedOrders: orders.map((item) => ({
      count: item.count,
      priceCents: item.priceCents,
      side: item.side,
      action: item.action,
    })),
    reason,
  };
}

function snapshotSellExecutionSnapshot(order, input, minPriceCents, orders, reason) {
  const side = order.side.toUpperCase();
  const bestBidCents = bidCentsForInputSide(side, input);
  return {
    source: "snapshot-sell-depth",
    ticker: order.ticker,
    observedAt: input.observedAt,
    side,
    action: "sell",
    requestedPriceCents: order.priceCents,
    limitPriceCents: minPriceCents,
    slippageCents: order.maxSlippageCents,
    bestBidCents,
    visibleDepthAtLimit: bestBidCents !== null && bestBidCents >= minPriceCents ? Math.floor(bidDepthForInputSide(side, input)) : 0,
    totalCount: orders.reduce((total, item) => total + item.count, 0),
    totalEstimatedCostCents: orders.reduce((total, item) => total + item.estimatedCostCents, 0),
    plannedOrders: orders.map((item) => ({
      count: item.count,
      priceCents: item.priceCents,
      side: item.side,
      action: item.action,
    })),
    reason,
  };
}

function depthAwareOrders(order, fresh, side, limitPriceCents) {
  const maxCostCents = Math.min(dollarsToCents(order.maxTradeDollars), dollarsToCents(fresh.maxOrderDollars ?? order.maxTradeDollars));
  let remainingCostCents = maxCostCents;
  const sideLower = side.toLowerCase();
  const levels = askLevelsForSide(side, fresh.orderbook)
    .map((level) => ({
      priceCents: priceToCents(level.price),
      availableContracts: Math.floor(level.size),
    }))
    .filter((level) => level.priceCents >= 1 && level.priceCents <= limitPriceCents && level.availableContracts > 0)
    .sort((left, right) => left.priceCents - right.priceCents);
  const orders = [];

  for (const level of levels) {
    const affordableAtLevel = Math.floor(remainingCostCents / level.priceCents);
    let levelCount = Math.min(level.availableContracts, affordableAtLevel);
    while (levelCount > 0) {
      const count = Math.min(MAX_CONTRACTS_PER_KALSHI_ORDER, levelCount);
      orders.push({
        ...order,
        ticker: fresh.market.ticker,
        side: sideLower,
        signalAction: actionForSide(side),
        count,
        priceCents: level.priceCents,
        estimatedCostCents: count * level.priceCents,
        risk: {
          requestedCostCents: count * level.priceCents,
          maxTradeCents: dollarsToCents(order.maxTradeDollars),
        },
      });
      remainingCostCents -= count * level.priceCents;
      levelCount -= count;
      if (remainingCostCents < level.priceCents) break;
    }
    if (remainingCostCents <= 0) break;
  }

  return orders;
}

function executionSnapshot(order, fresh, signal, limitPriceCents, orders, reason) {
  const side = sideFromAction(signal.action) ?? order.side.toUpperCase();
  const askLevels = side === "YES" || side === "NO" ? askLevelsForSide(side, fresh.orderbook) : [];
  return {
    source: "fresh-depth",
    executionProfile: order.executionProfile ?? "standard",
    ticker: fresh.market.ticker,
    observedAt: fresh.observedAt,
    side,
    signalAction: signal.action,
    edgeAfterFees: signal.edgeAfterFees,
    confidence: signal.confidence,
    requestedPriceCents: order.priceCents,
    limitPriceCents,
    slippageCents: order.maxSlippageCents,
    bestAskCents: askLevels.length ? priceToCents(askLevels[0].price) : null,
    visibleDepthAtLimit: limitPriceCents === null ? 0 : askLevels
      .filter((level) => priceToCents(level.price) <= limitPriceCents)
      .reduce((total, level) => total + Math.floor(level.size), 0),
    totalCount: orders.reduce((total, item) => total + item.count, 0),
    totalEstimatedCostCents: orders.reduce((total, item) => total + item.estimatedCostCents, 0),
    plannedOrders: orders.map((item) => ({
      count: item.count,
      priceCents: item.priceCents,
      side: item.side,
    })),
    reason,
  };
}

function snapshotExecutionSnapshot(order, input, signal, limitPriceCents, orders, reason) {
  const side = sideFromAction(signal.action) ?? order.side.toUpperCase();
  const bestAskCents = side === "YES" || side === "NO" ? askCentsForSide(side, input) : null;
  return {
    source: "snapshot-depth",
    executionProfile: order.executionProfile ?? "standard",
    ticker: order.ticker,
    observedAt: input.observedAt,
    side,
    signalAction: signal.action,
    edgeAfterFees: signal.edgeAfterFees,
    confidence: signal.confidence,
    requestedPriceCents: order.priceCents,
    limitPriceCents,
    slippageCents: order.maxSlippageCents,
    bestAskCents,
    visibleDepthAtLimit: side === "YES" || side === "NO"
      ? limitPriceCents !== null && bestAskCents !== null && bestAskCents <= limitPriceCents ? Math.floor(askDepthForInputSide(side, input)) : 0
      : 0,
    totalCount: orders.reduce((total, item) => total + item.count, 0),
    totalEstimatedCostCents: orders.reduce((total, item) => total + item.estimatedCostCents, 0),
    plannedOrders: orders.map((item) => ({
      count: item.count,
      priceCents: item.priceCents,
      side: item.side,
    })),
    reason,
  };
}

function shouldApplyConservative(order, status) {
  return order.action === "buy"
    && status.conservativeMode
    && (order.executionProfile === "conservative" || !status.dryRun);
}

function conservativeBuyCheck(input, side, signal, status) {
  if (!status.conservativeMode) return { ok: true };
  const rules = status.conservative ?? {};
  const sideProbability = side === "YES" ? input.fairProbability : 1 - input.fairProbability;
  const spreadCents = Math.ceil(spreadForSide(side, input) * 100);
  const secondsToClose = Number(input.secondsToClose);
  const checks = [
    {
      pass: signal.confidence >= rules.minConfidence,
      error: `Conservative mode is waiting for confidence >= ${rules.minConfidence}; fresh signal is ${signal.confidence}.`,
    },
    {
      pass: signal.edgeAfterFees >= rules.minEdgeAfterFees,
      error: `Conservative mode is waiting for edge >= ${(rules.minEdgeAfterFees * 100).toFixed(1)}%; fresh edge is ${(signal.edgeAfterFees * 100).toFixed(1)}%.`,
    },
    {
      pass: sideProbability >= rules.minSideProbability,
      error: `Conservative mode is waiting for side probability >= ${(rules.minSideProbability * 100).toFixed(0)}%; fresh ${side} probability is ${(sideProbability * 100).toFixed(1)}%.`,
    },
    {
      pass: spreadCents <= rules.maxSpreadCents,
      error: `Conservative mode is waiting for spread <= ${rules.maxSpreadCents}c; fresh ${side} spread is ${Number.isFinite(spreadCents) ? `${spreadCents}c` : "unavailable"}.`,
    },
    {
      pass: Number.isFinite(secondsToClose) && secondsToClose >= rules.minSecondsToClose && secondsToClose <= rules.maxSecondsToClose,
      error: `Conservative mode only buys ${rules.minSecondsToClose}-${rules.maxSecondsToClose}s before close; fresh market has ${Number.isFinite(secondsToClose) ? `${secondsToClose}s` : "unknown"} left.`,
    },
  ];
  const failed = checks.find((check) => !check.pass);
  return failed ? { ok: false, error: failed.error } : { ok: true };
}

export function buildKalshiOrderPayload(order, clientOrderId) {
  const payload = {
    ticker: order.ticker,
    side: order.side,
    action: order.action,
    client_order_id: clientOrderId,
    count: order.count,
    time_in_force: "immediate_or_cancel",
    self_trade_prevention_type: "taker_at_cross",
    cancel_order_on_pause: true,
  };

  if (order.side === "yes") {
    payload.yes_price = order.priceCents;
  } else {
    payload.no_price = order.priceCents;
  }

  if (order.action !== "buy") {
    payload.reduce_only = true;
  }

  return payload;
}

export function riskCheckOrder(order, account, status) {
  return riskCheckExecutionPlan({
    orders: [order],
    totalEstimatedCostCents: order.estimatedCostCents,
  }, account, status);
}

export function riskCheckExecutionPlan(plan, account, status) {
  const maxOrderCents = dollarsToCents(status.maxOrderDollars);
  const maxExposureCents = dollarsToCents(status.maxExposureDollars);
  const orderCostCents = plan.orders
    .filter((order) => order.action === "buy")
    .reduce((total, order) => total + order.estimatedCostCents, 0);
  const openExposureCents = Math.max(0, account.openPositionCostCents + account.restingBuyCostCents);
  const hasBuy = plan.orders.some((order) => order.action === "buy");
  const conservativeBuy = plan.orders.some((order) => order.action === "buy" && shouldApplyConservative(order, status));
  const projectedExposureCents = hasBuy ? openExposureCents + orderCostCents : openExposureCents;
  const snapshot = {
    balanceCents: account.balanceCents,
    openPositionCostCents: account.openPositionCostCents,
    restingBuyCostCents: account.restingBuyCostCents,
    openExposureCents,
    projectedExposureCents,
    orderCostCents,
    maxOrderCents,
    maxExposureCents,
  };

  if (orderCostCents > maxOrderCents) return { ok: false, error: "Order exceeds backend max-order cap.", snapshot };
  if (conservativeBuy && projectedExposureCents > maxExposureCents) return { ok: false, error: `Projected DOGE exposure exceeds ${money(status.maxExposureDollars)} conservative budget.`, snapshot };
  if (account.balanceCents !== null && hasBuy && orderCostCents > account.balanceCents) {
    return { ok: false, error: "Kalshi balance is below the requested order cost.", snapshot };
  }
  return { ok: true, snapshot };
}

async function submitExecutionPlan(plan, dryRun, keyId, privateKeyPem) {
  const submittedOrders = [];
  let error = null;

  for (const order of plan.orders) {
    const clientOrderId = clientOrderIdFor(order);
    const payload = buildKalshiOrderPayload(order, clientOrderId);
    try {
      const result = dryRun
        ? { order: null }
        : await signedKalshiPost("/portfolio/orders", payload, keyId, privateKeyPem);
      const filledCount = dryRun ? order.count : filledCountFromKalshiOrder(result.order, order.count);
      submittedOrders.push({
        clientOrderId,
        payload,
        kalshiOrder: result.order ?? null,
        requestedCount: order.count,
        filledCount,
        priceCents: order.priceCents,
        side: order.side,
        requestedCostCents: order.estimatedCostCents,
        filledCostCents: Math.round(filledCount * order.priceCents),
        status: stringOrNull(result.order?.status),
      });
    } catch (caught) {
      error = caught instanceof Error ? caught.message : "Kalshi order submission failed";
      break;
    }
  }

  return {
    submittedOrders,
    requestedContracts: submittedOrders.reduce((total, item) => total + item.requestedCount, 0),
    requestedCostCents: submittedOrders.reduce((total, item) => total + item.requestedCostCents, 0),
    filledContracts: submittedOrders.reduce((total, item) => total + item.filledCount, 0),
    filledCostCents: submittedOrders.reduce((total, item) => total + item.filledCostCents, 0),
    lastClientOrderId: submittedOrders.at(-1)?.clientOrderId ?? null,
    error,
  };
}

function filledCountFromKalshiOrder(order, fallbackCount) {
  if (!isRecord(order)) return fallbackCount;
  const explicitFill = toNumber(order.fill_count_fp ?? order.fill_count);
  if (explicitFill !== null) return Math.max(0, Math.floor(explicitFill));
  const initial = toNumber(order.initial_count_fp ?? order.initial_count ?? order.count_fp ?? order.count);
  const remaining = toNumber(order.remaining_count_fp ?? order.remaining_count);
  if (initial !== null && remaining !== null) return Math.max(0, Math.floor(initial - remaining));
  return fallbackCount;
}

async function fetchAccountRisk(keyId, privateKeyPem, seriesTicker) {
  const [balancePayload, positionsPayload, ordersPayload] = await Promise.all([
    signedKalshiGet("/portfolio/balance", keyId, privateKeyPem),
    signedKalshiGet("/portfolio/positions?limit=100&settlement_status=unsettled&position=position,total_traded", keyId, privateKeyPem),
    signedKalshiGet("/portfolio/orders?limit=100&status=resting", keyId, privateKeyPem).catch(() => ({ orders: [] })),
  ]);
  const positions = Array.isArray(positionsPayload.market_positions)
    ? positionsPayload.market_positions
    : Array.isArray(positionsPayload.positions)
      ? positionsPayload.positions
      : [];
  const orders = Array.isArray(ordersPayload.orders) ? ordersPayload.orders : [];
  const seriesPositions = positions.filter((position) => {
    const ticker = marketTicker(position);
    const positionSize = toNumber(position.position_fp ?? position.position) ?? 0;
    return ticker?.startsWith(seriesTicker) && Math.abs(positionSize) > 0;
  });
  const seriesOrders = orders.filter((order) => marketTicker(order)?.startsWith(seriesTicker));
  return {
    balanceCents: toNumber(balancePayload.balance),
    openPositionCostCents: seriesPositions
      .reduce((total, position) => total + positionCostCents(position), 0),
    restingBuyCostCents: seriesOrders
      .filter((order) => {
        const action = String(order.action ?? "").toLowerCase();
        return action === "" || action === "buy";
      })
      .reduce((total, order) => total + restingOrderCostCents(order), 0),
    openPositionTickers: seriesPositions.map(marketTicker).filter(Boolean),
    restingOrderTickers: seriesOrders.map(marketTicker).filter(Boolean),
  };
}

async function fetchFreshDogeMarket(seriesTicker) {
  const now = new Date();
  const market = await discoverActiveDogeMarket(now, seriesTicker);
  const [freshMarket, orderbook] = await Promise.all([
    kalshiPublicGet(`/markets/${encodeURIComponent(market.ticker)}`).then((payload) => payload.market ?? market),
    kalshiPublicGet(`/markets/${encodeURIComponent(market.ticker)}/orderbook?depth=20`).then((payload) => payload.orderbook_fp ?? {}),
  ]);
  const normalizedOrderbook = normalizeOrderbook(freshMarket, orderbook, now.toISOString());
  return {
    observedAt: now.toISOString(),
    market: freshMarket,
    orderbook: normalizedOrderbook,
  };
}

async function fetchFreshMarketByTicker(ticker) {
  const now = new Date();
  const [market, orderbook] = await Promise.all([
    kalshiPublicGet(`/markets/${encodeURIComponent(ticker)}`).then((payload) => payload.market),
    kalshiPublicGet(`/markets/${encodeURIComponent(ticker)}/orderbook?depth=20`).then((payload) => payload.orderbook_fp ?? {}),
  ]);
  if (!market?.ticker) throw new Error(`Kalshi market ${ticker} was not returned`);
  return {
    observedAt: now.toISOString(),
    market,
    orderbook: normalizeOrderbook(market, orderbook, now.toISOString()),
  };
}

async function discoverActiveDogeMarket(now, seriesTicker) {
  const payload = await kalshiPublicGet(`/markets?series_ticker=${encodeURIComponent(seriesTicker)}&status=open&limit=1000`);
  const markets = Array.isArray(payload.markets) ? payload.markets : [];
  if (!markets.length) throw new Error(`No open ${seriesTicker} markets returned by Kalshi`);
  const scored = markets
    .filter((market) => market?.ticker && String(market.status ?? "").toLowerCase() !== "closed")
    .map((market) => {
      const closeMs = Date.parse(market.close_time ?? market.close ?? "");
      const millisecondsToClose = Number.isFinite(closeMs) ? closeMs - now.getTime() : Number.POSITIVE_INFINITY;
      return {
        market,
        score: [
          market.status === "active" ? 0 : 1,
          millisecondsToClose >= -15_000 ? 0 : 1,
          Math.abs(millisecondsToClose),
        ],
      };
    })
    .sort((left, right) => compareScores(left.score, right.score));
  if (!scored.length) throw new Error(`No usable ${seriesTicker} markets returned by Kalshi`);
  return scored[0].market;
}

async function kalshiPublicGet(pathWithQuery) {
  const response = await fetch(`${KALSHI_BASE_URL}${TRADE_API_PATH}${pathWithQuery}`, {
    headers: {
      "Accept": "application/json",
      "User-Agent": "DogeEdge/0.1",
    },
    cache: "no-store",
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Kalshi ${pathWithQuery.split("?")[0]} failed with ${response.status}: ${text.slice(0, 180)}`);
  }
  return response.json();
}

function normalizeOrderbook(market, orderbook, observedAt) {
  const yesBids = normalizeBidLevels(orderbook.yes_dollars);
  const noBids = normalizeBidLevels(orderbook.no_dollars);
  const yesAsk = toNumber(market.yes_ask_dollars ?? market.yes_ask);
  const noAsk = toNumber(market.no_ask_dollars ?? market.no_ask);
  const yesAsks = noBids
    .map((level) => ({ price: roundRatio(1 - level.price), size: level.size }))
    .filter((level) => level.price > 0 && level.price < 1)
    .sort((left, right) => left.price - right.price);
  const noAsks = yesBids
    .map((level) => ({ price: roundRatio(1 - level.price), size: level.size }))
    .filter((level) => level.price > 0 && level.price < 1)
    .sort((left, right) => left.price - right.price);
  return {
    yesBids,
    yesAsks: withTopAsk(yesAsks, yesAsk, toNumber(market.yes_ask_size_fp)),
    noBids,
    noAsks: withTopAsk(noAsks, noAsk, toNumber(market.no_ask_size_fp)),
    observedAt,
  };
}

function normalizeBidLevels(levels) {
  if (!Array.isArray(levels)) return [];
  return levels
    .map((level) => ({
      price: roundRatio(toNumber(level?.[0]) ?? 0),
      size: roundSize(toNumber(level?.[1]) ?? 0),
    }))
    .filter((level) => level.price > 0 && level.price < 1 && level.size > 0)
    .sort((left, right) => right.price - left.price);
}

function withTopAsk(levels, ask, size) {
  if (ask === null) return levels;
  if (levels.some((level) => Math.abs(level.price - ask) < 0.00001)) return levels;
  return [{ price: roundRatio(ask), size: size ?? 0 }, ...levels].sort((left, right) => left.price - right.price);
}

function compareScores(left, right) {
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const delta = (left[index] ?? 0) - (right[index] ?? 0);
    if (delta !== 0) return delta;
  }
  return 0;
}

function paperInputFromFreshMarket(snapshotInput, fresh) {
  const market = fresh.market;
  const orderbook = fresh.orderbook;
  const now = new Date(fresh.observedAt);
  return {
    observedAt: fresh.observedAt,
    marketLive: true,
    ticker: stringOrNull(market.ticker),
    title: stringOrNull(market.title),
    targetPrice: targetPriceFromMarket(market) ?? snapshotInput.targetPrice,
    estimate: snapshotInput.estimate,
    spotPrice: snapshotInput.spotPrice,
    oneMinuteChange: snapshotInput.oneMinuteChange,
    fairProbability: snapshotInput.fairProbability,
    action: snapshotInput.action,
    confidence: snapshotInput.confidence,
    edgeAfterFees: snapshotInput.edgeAfterFees,
    sizeContracts: snapshotInput.sizeContracts,
    secondsToClose: secondsToClose(now, market) ?? snapshotInput.secondsToClose,
    yesAsk: askFromOrderbook("YES", orderbook),
    noAsk: askFromOrderbook("NO", orderbook),
    yesBid: bidFromOrderbook("YES", orderbook),
    noBid: bidFromOrderbook("NO", orderbook),
    yesAskDepth: orderbook.yesAsks[0]?.size ?? null,
    noAskDepth: orderbook.noAsks[0]?.size ?? null,
    yesBidDepth: orderbook.yesBids[0]?.size ?? null,
    noBidDepth: orderbook.noBids[0]?.size ?? null,
  };
}

function normalizePaperInput(value) {
  if (!isRecord(value)) return null;
  const targetPrice = toNumber(value.targetPrice);
  const estimate = toNumber(value.estimate);
  const spotPrice = toNumber(value.spotPrice);
  const fairProbability = toNumber(value.fairProbability);
  const confidence = toNumber(value.confidence);
  const secondsToCloseValue = toNumber(value.secondsToClose);
  if (targetPrice === null || estimate === null || spotPrice === null || fairProbability === null || confidence === null || secondsToCloseValue === null) {
    return null;
  }
  return {
    observedAt: stringOrNull(value.observedAt) ?? new Date().toISOString(),
    marketLive: Boolean(value.marketLive),
    ticker: stringOrNull(value.ticker),
    title: stringOrNull(value.title),
    targetPrice,
    estimate,
    spotPrice,
    oneMinuteChange: toNumber(value.oneMinuteChange) ?? 0,
    fairProbability,
    action: normalizedEnum(value.action, ["buy_yes", "buy_no", "skip"]) ?? "skip",
    confidence,
    edgeAfterFees: toNumber(value.edgeAfterFees) ?? 0,
    sizeContracts: toNumber(value.sizeContracts) ?? 0,
    secondsToClose: secondsToCloseValue,
    yesAsk: toNumber(value.yesAsk),
    noAsk: toNumber(value.noAsk),
    yesBid: toNumber(value.yesBid),
    noBid: toNumber(value.noBid),
    yesAskDepth: toNumber(value.yesAskDepth),
    noAskDepth: toNumber(value.noAskDepth),
    yesBidDepth: toNumber(value.yesBidDepth),
    noBidDepth: toNumber(value.noBidDepth),
  };
}

function targetPriceFromMarket(market) {
  const direct = toNumber(market.floor_strike ?? market.floor);
  if (direct !== null) return direct;
  const subtitle = String(market.yes_sub_title ?? "");
  const match = subtitle.match(/\$([0-9.]+)/);
  return match ? toNumber(match[1]) : null;
}

function secondsToClose(now, market) {
  const closeMs = Date.parse(market.close_time ?? market.close ?? "");
  if (!Number.isFinite(closeMs)) return null;
  return Math.max(0, Math.min(15 * 60, Math.ceil((closeMs - now.getTime()) / 1000)));
}

function askFromOrderbook(side, orderbook) {
  return askLevelsForSide(side, orderbook)[0]?.price ?? null;
}

function bidFromOrderbook(side, orderbook) {
  const levels = side === "YES" ? orderbook.yesBids : orderbook.noBids;
  return levels[0]?.price ?? null;
}

function bidCentsForSide(side, orderbook) {
  const bid = bidFromOrderbook(side, orderbook);
  return bid === null ? null : priceToFloorCents(bid);
}

function bidCentsForInputSide(side, input) {
  const bid = side === "YES" ? input.yesBid : input.noBid;
  return bid === null ? null : priceToFloorCents(bid);
}

function askLevelsForSide(side, orderbook) {
  return side === "YES" ? orderbook.yesAsks : orderbook.noAsks;
}

function bidLevelsForSide(side, orderbook) {
  return side === "YES" ? orderbook.yesBids : orderbook.noBids;
}

function askCentsForSide(side, input) {
  const ask = askForSide(side, input);
  return ask === null ? null : priceToCents(ask);
}

function askDepthForInputSide(side, input) {
  const depth = side === "YES" ? input.yesAskDepth : input.noAskDepth;
  return Number.isFinite(depth) ? Math.max(0, depth) : 0;
}

function bidDepthForInputSide(side, input) {
  const depth = side === "YES" ? input.yesBidDepth : input.noBidDepth;
  return Number.isFinite(depth) ? Math.max(0, depth) : 0;
}

function priceToCents(price) {
  return Math.max(1, Math.min(99, Math.ceil(roundRatio(price) * 100)));
}

function priceToFloorCents(price) {
  return Math.max(1, Math.min(99, Math.floor(roundRatio(price) * 100)));
}

function inputWithSideAsk(input, side, ask) {
  return side === "YES"
    ? { ...input, yesAsk: ask }
    : { ...input, noAsk: ask };
}

function generatedPaperAlgoSignal(input, algo) {
  if (!generatedPaperFamilies.has(algo.family)) {
    return signalFromGenerated(algo, null, -1, 0, 0, 0.5, "Generated family is not available in the live router yet.");
  }
  if (algo.family === "sweep-model") return generatedModelSignal(input, algo);
  if (algo.family === "sweep-distance") return generatedDistanceSignal(input, algo);
  if (algo.family === "sweep-scalp") return generatedScalpSignal(input, algo);
  if (algo.family === "sweep-momentum") return generatedMomentumSignal(input, algo);
  if (algo.family === "sweep-momentum-trail") return generatedMomentumTrailSignal(input, algo);
  if (algo.family === "sweep-fade-model") return generatedWeakModelFadeSignal(input, algo);
  if (algo.family === "sweep-fade-momentum") return generatedMomentumFadeSignal(input, algo);
  if (algo.family === "sweep-target-revert") return generatedTargetReversionSignal(input, algo);
  if (algo.family === "sweep-managed-scalp") return generatedManagedScalpSignal(input, algo);
  if (algo.family === "sweep-cheap-longshot") return generatedCheapLongshotSignal(input, algo);
  if (algo.family === "sweep-late-favorite") return generatedLateFavoriteSignal(input, algo);
  if (algo.family === "sweep-liquidity-imbalance") return generatedLiquidityImbalanceSignal(input, algo);
  return generatedLegacyCandidateSignal(input, algo);
}

function generatedLegacyCandidateSignal(input, algo) {
  if (algo.sourceAlgoId === "threshold-distance-020") return generatedDistanceSignal(input, { ...algo, params: { minDistance: 0.0002 } });
  if (algo.sourceAlgoId === "spread-scalp-2c") return generatedScalpSignal(input, { ...algo, params: { maxSpread: 0.02 } });
  if (algo.sourceAlgoId === "spread-scalp-4c") return generatedScalpSignal(input, { ...algo, params: { maxSpread: 0.04, yesMode: "loose" } });
  if (algo.sourceAlgoId === "momentum-003") return generatedMomentumSignal(input, { ...algo, params: { minMovePercent: 0.0003 } });
  if (algo.sourceAlgoId === "momentum-max-6c") return generatedMomentumSignal(input, { ...algo, params: { maxSpread: 0.06 } });
  return signalFromGenerated(algo, null, -1, 0, 0, 0.5, "Legacy generated candidate is not mapped in the live router yet.");
}

function generatedModelSignal(input, algo) {
  const maxSecondsToClose = numberParam(algo.params, "maxSecondsToClose", 60);
  const minEdge = numberParam(algo.params, "minEdge", 0);
  const minConfidence = numberParam(algo.params, "minConfidence", 50);
  const maxSpread = numberParam(algo.params, "maxSpread", 0.04);
  const yesMode = stringParam(algo.params, "yesMode", "strict");
  const side = sideFromAction(input.action);
  const spread = side === null ? Number.POSITIVE_INFINITY : spreadForSide(side, input);
  const allowed = side !== null
    && input.secondsToClose <= maxSecondsToClose
    && input.edgeAfterFees >= minEdge
    && input.confidence >= minConfidence
    && spread <= maxSpread
    && yesGateAllows(yesMode, side, input.edgeAfterFees, input.confidence, spread);
  return signalFromGenerated(algo, allowed ? side : null, input.edgeAfterFees, input.confidence, contractsForConfidence(input.confidence), input.fairProbability, "Generated model-window sweep algo.");
}

function generatedDistanceSignal(input, algo) {
  const minDistance = numberParam(algo.params, "minDistance", 0.0002);
  const feeBuffer = numberParam(algo.params, "feeBuffer", 0.014);
  const maxSpread = numberParam(algo.params, "maxSpread", 0.04);
  const minConfidence = numberParam(algo.params, "minConfidence", 45);
  const yesMode = stringParam(algo.params, "yesMode", "strict");
  const distance = input.estimate - input.targetPrice;
  const side = distance >= 0 ? "YES" : "NO";
  const ask = askForSide(side, input);
  const fairProbability = side === "YES"
    ? clamp(0.5 + distance / 0.0012, 0.01, 0.99)
    : clamp(0.5 - distance / 0.0012, 0.01, 0.99);
  const edge = ask === null ? -1 : roundRatio(fairProbability - ask - feeBuffer);
  const spread = spreadForSide(side, input);
  const confidence = clamp(Math.round(45 + Math.min(1, Math.abs(distance) / 0.00022) * 50), 0, 100);
  const allowed = Math.abs(distance) >= minDistance
    && edge > 0
    && confidence >= minConfidence
    && spread <= maxSpread
    && yesGateAllows(yesMode, side, edge, confidence, spread);
  return signalFromGenerated(algo, allowed ? side : null, edge, confidence, contractsForConfidence(confidence), fairProbability, "Generated distance sweep algo.");
}

function generatedScalpSignal(input, algo) {
  const maxSpread = numberParam(algo.params, "maxSpread", 0.04);
  const feeBuffer = numberParam(algo.params, "feeBuffer", 0.006);
  const minEdge = numberParam(algo.params, "minEdge", 0);
  const sideMode = stringParam(algo.params, "sideMode", "best");
  const yesMode = stringParam(algo.params, "yesMode", "strict");
  const picked = pickBestSide(input, feeBuffer, sideMode);
  const allowed = picked.spread <= maxSpread
    && picked.edge >= minEdge
    && yesGateAllows(yesMode, picked.side, picked.edge, picked.confidence, picked.spread);
  return signalFromGenerated(algo, allowed ? picked.side : null, picked.edge, picked.confidence, picked.spread <= 0.02 ? 3 : 1, picked.fairProbability, "Generated spread-scalp sweep algo.");
}

function generatedMomentumSignal(input, algo) {
  const minMovePercent = numberParam(algo.params, "minMovePercent", 0.0003);
  const maxSpread = numberParam(algo.params, "maxSpread", 0.06);
  const feeBuffer = numberParam(algo.params, "feeBuffer", 0.018);
  const boostMultiplier = numberParam(algo.params, "boostMultiplier", 140);
  const yesMode = stringParam(algo.params, "yesMode", "strict");
  const movePercent = input.spotPrice > 0 ? input.oneMinuteChange / input.spotPrice : 0;
  const side = movePercent >= 0 ? "YES" : "NO";
  const ask = askForSide(side, input);
  const spread = spreadForSide(side, input);
  const baseFair = side === "YES" ? input.fairProbability : 1 - input.fairProbability;
  const fairProbability = clamp(baseFair + Math.min(0.12, Math.abs(movePercent) * boostMultiplier), 0.01, 0.99);
  const edge = ask === null ? -1 : roundRatio(fairProbability - ask - feeBuffer);
  const confidence = clamp(Math.round(48 + Math.min(1, Math.abs(movePercent) / 0.001) * 42 + Math.max(0, edge) * 40), 0, 94);
  const allowed = Math.abs(movePercent) >= minMovePercent
    && spread <= maxSpread
    && edge > 0
    && yesGateAllows(yesMode, side, edge, confidence, spread);
  return signalFromGenerated(algo, allowed ? side : null, edge, confidence, confidence >= 78 ? 3 : 1, fairProbability, "Generated momentum sweep algo.");
}

function generatedMomentumTrailSignal(input, algo) {
  const minMovePercent = numberParam(algo.params, "minMovePercent", 0.0002);
  const maxSpread = numberParam(algo.params, "maxSpread", 0.03);
  const feeBuffer = numberParam(algo.params, "feeBuffer", 0.018);
  const boostMultiplier = numberParam(algo.params, "boostMultiplier", 150);
  const minEdge = numberParam(algo.params, "minEdge", 0.04);
  const minSecondsToClose = numberParam(algo.params, "minSecondsToClose", 45);
  const yesMode = stringParam(algo.params, "yesMode", "loose");
  const movePercent = input.spotPrice > 0 ? input.oneMinuteChange / input.spotPrice : 0;
  const side = movePercent >= 0 ? "YES" : "NO";
  const ask = askForSide(side, input);
  const spread = spreadForSide(side, input);
  const baseFair = side === "YES" ? input.fairProbability : 1 - input.fairProbability;
  const fairProbability = clamp(baseFair + Math.min(0.16, Math.abs(movePercent) * boostMultiplier), 0.01, 0.99);
  const edge = ask === null ? -1 : roundRatio(fairProbability - ask - feeBuffer);
  const confidence = clamp(Math.round(50 + Math.min(1, Math.abs(movePercent) / 0.001) * 36 + Math.max(0, edge) * 70 - Math.max(0, spread - 0.02) * 90), 0, 96);
  const allowed = Math.abs(movePercent) >= minMovePercent
    && input.secondsToClose >= minSecondsToClose
    && spread <= maxSpread
    && edge >= minEdge
    && yesGateAllows(yesMode, side, edge, confidence, spread);
  return signalFromGenerated(
    algo,
    allowed ? side : null,
    edge,
    confidence,
    confidence >= 84 ? 4 : confidence >= 72 ? 2 : 1,
    fairProbability,
    "Generated momentum-trail scalp algo.",
    {
      takeProfit: numberParam(algo.params, "takeProfit", 0.06),
      stopLoss: numberParam(algo.params, "stopLoss", 0.04),
      trailingStop: numberParam(algo.params, "trailingStop", 0.02),
      trailAfterProfit: numberParam(algo.params, "trailAfterProfit", 0.025),
      minHoldSeconds: numberParam(algo.params, "minHoldSeconds", 6),
      maxHoldSeconds: numberParam(algo.params, "maxHoldSeconds", 180),
      exitBeforeClose: numberParam(algo.params, "exitBeforeClose", 30),
      exitOnMomentumFlip: Boolean(algo.params.exitOnMomentumFlip ?? true),
      momentumExitMovePercent: numberParam(algo.params, "momentumExitMovePercent", 0.00008),
    },
  );
}

function generatedWeakModelFadeSignal(input, algo) {
  const maxSecondsToClose = numberParam(algo.params, "maxSecondsToClose", 120);
  const maxModelEdge = numberParam(algo.params, "maxModelEdge", 0.05);
  const maxConfidence = numberParam(algo.params, "maxConfidence", 50);
  const maxSpread = numberParam(algo.params, "maxSpread", 0.04);
  const yesMode = stringParam(algo.params, "yesMode", "loose");
  const modelSide = sideFromAction(input.action);
  const side = modelSide === null ? null : oppositeSide(modelSide);
  const ask = side === null ? null : askForSide(side, input);
  const spread = side === null ? Number.POSITIVE_INFINITY : spreadForSide(side, input);
  const fairProbability = side === "YES" ? input.fairProbability : 1 - input.fairProbability;
  const edge = ask === null ? -1 : roundRatio(fairProbability - ask - 0.014);
  const confidence = clamp(72 - input.confidence + Math.max(0, -input.edgeAfterFees) * 100, 0, 88);
  const allowed = side !== null
    && input.secondsToClose <= maxSecondsToClose
    && input.edgeAfterFees <= maxModelEdge
    && input.confidence <= maxConfidence
    && spread <= maxSpread
    && edge > -0.02
    && yesGateAllows(yesMode, side, edge, confidence, spread);
  return signalFromGenerated(algo, allowed ? side : null, edge, confidence, confidence >= 70 ? 2 : 1, fairProbability, "Generated weak-model fade algo.");
}

function generatedMomentumFadeSignal(input, algo) {
  const minMovePercent = numberParam(algo.params, "minMovePercent", 0.0002);
  const maxSpread = numberParam(algo.params, "maxSpread", 0.06);
  const feeBuffer = numberParam(algo.params, "feeBuffer", 0.014);
  const boostMultiplier = numberParam(algo.params, "boostMultiplier", 80);
  const yesMode = stringParam(algo.params, "yesMode", "loose");
  const movePercent = input.spotPrice > 0 ? input.oneMinuteChange / input.spotPrice : 0;
  const side = movePercent >= 0 ? "NO" : "YES";
  const ask = askForSide(side, input);
  const spread = spreadForSide(side, input);
  const baseFair = side === "YES" ? input.fairProbability : 1 - input.fairProbability;
  const fairProbability = clamp(baseFair + Math.min(0.1, Math.abs(movePercent) * boostMultiplier), 0.01, 0.99);
  const edge = ask === null ? -1 : roundRatio(fairProbability - ask - feeBuffer);
  const confidence = clamp(Math.round(46 + Math.min(1, Math.abs(movePercent) / 0.001) * 38 + Math.max(0, edge) * 45), 0, 90);
  const allowed = Math.abs(movePercent) >= minMovePercent
    && spread <= maxSpread
    && edge > -0.02
    && yesGateAllows(yesMode, side, edge, confidence, spread);
  return signalFromGenerated(algo, allowed ? side : null, edge, confidence, confidence >= 78 ? 3 : 1, fairProbability, "Generated momentum-fade sweep algo.");
}

function generatedTargetReversionSignal(input, algo) {
  const minDistance = numberParam(algo.params, "minDistance", 0);
  const maxDistance = numberParam(algo.params, "maxDistance", 0.0001);
  const maxSpread = numberParam(algo.params, "maxSpread", 0.04);
  const feeBuffer = numberParam(algo.params, "feeBuffer", 0.014);
  const yesMode = stringParam(algo.params, "yesMode", "loose");
  const distance = input.estimate - input.targetPrice;
  const side = distance >= 0 ? "NO" : "YES";
  const ask = askForSide(side, input);
  const spread = spreadForSide(side, input);
  const distanceAbs = Math.abs(distance);
  const reversionBoost = clamp((maxDistance - distanceAbs) / Math.max(0.00001, maxDistance) * 0.12, 0, 0.12);
  const baseFair = side === "YES" ? input.fairProbability : 1 - input.fairProbability;
  const fairProbability = clamp(baseFair + reversionBoost, 0.01, 0.99);
  const edge = ask === null ? -1 : roundRatio(fairProbability - ask - feeBuffer);
  const confidence = clamp(Math.round(50 + reversionBoost * 260 + Math.max(0, edge) * 60), 0, 92);
  const allowed = distanceAbs >= minDistance
    && distanceAbs <= maxDistance
    && spread <= maxSpread
    && edge > -0.02
    && yesGateAllows(yesMode, side, edge, confidence, spread);
  return signalFromGenerated(algo, allowed ? side : null, edge, confidence, confidence >= 78 ? 2 : 1, fairProbability, "Generated target-reversion sweep algo.");
}

function generatedManagedScalpSignal(input, algo) {
  const maxSpread = numberParam(algo.params, "maxSpread", 0.04);
  const feeBuffer = numberParam(algo.params, "feeBuffer", 0.014);
  const minEdge = numberParam(algo.params, "minEdge", 0.02);
  const takeProfit = numberParam(algo.params, "takeProfit", 0.04);
  const stopLoss = numberParam(algo.params, "stopLoss", 0.04);
  const maxHoldSeconds = numberParam(algo.params, "maxHoldSeconds", 180);
  const yesMode = stringParam(algo.params, "yesMode", "loose");
  const picked = pickBestSide(input, feeBuffer, "best");
  const allowed = picked.spread <= maxSpread
    && picked.edge >= minEdge
    && yesGateAllows(yesMode, picked.side, picked.edge, picked.confidence, picked.spread);
  return signalFromGenerated(algo, allowed ? picked.side : null, picked.edge, picked.confidence, picked.spread <= 0.02 ? 3 : 1, picked.fairProbability, "Generated managed-scalp sweep algo.", {
    takeProfit,
    stopLoss,
    maxHoldSeconds,
  });
}

function generatedCheapLongshotSignal(input, algo) {
  const maxAsk = numberParam(algo.params, "maxAsk", 0.18);
  const minEdge = numberParam(algo.params, "minEdge", 0.02);
  const minSecondsToClose = numberParam(algo.params, "minSecondsToClose", 120);
  const maxSpread = numberParam(algo.params, "maxSpread", 0.04);
  const sideMode = stringParam(algo.params, "sideMode", "best");
  const picked = pickBestSide(input, 0.014, sideMode);
  const allowed = picked.ask !== null
    && picked.ask <= maxAsk
    && picked.edge >= minEdge
    && picked.spread <= maxSpread
    && input.secondsToClose >= minSecondsToClose;
  return signalFromGenerated(algo, allowed ? picked.side : null, picked.edge, picked.confidence, 1, picked.fairProbability, "Generated cheap-longshot sweep algo.");
}

function generatedLateFavoriteSignal(input, algo) {
  const maxSecondsToClose = numberParam(algo.params, "maxSecondsToClose", 120);
  const minFairProbability = numberParam(algo.params, "minFairProbability", 0.72);
  const maxAsk = numberParam(algo.params, "maxAsk", 0.85);
  const maxSpread = numberParam(algo.params, "maxSpread", 0.08);
  const sideMode = stringParam(algo.params, "sideMode", "fair");
  const modelSide = sideFromAction(input.action);
  const fairSide = input.fairProbability >= 0.5 ? "YES" : "NO";
  const side = sideMode === "model" && modelSide ? modelSide : fairSide;
  const picked = sideCandidate(side, input, 0.01);
  const allowed = input.secondsToClose <= maxSecondsToClose
    && picked.fairProbability >= minFairProbability
    && picked.ask !== null
    && picked.ask <= maxAsk
    && picked.edge > 0
    && picked.spread <= maxSpread
    && yesGateAllows("loose", picked.side, picked.edge, picked.confidence, picked.spread);
  return signalFromGenerated(algo, allowed ? picked.side : null, picked.edge, picked.confidence, picked.confidence >= 82 ? 3 : 1, picked.fairProbability, "Generated late-favorite sweep algo.");
}

function generatedLiquidityImbalanceSignal(input, algo) {
  const maxSpread = numberParam(algo.params, "maxSpread", 0.08);
  const minBidDepth = numberParam(algo.params, "minBidDepth", 1);
  const minImbalance = numberParam(algo.params, "minImbalance", 0.25);
  const minEdge = numberParam(algo.params, "minEdge", 0);
  const yesMode = stringParam(algo.params, "yesMode", "loose");
  const yes = sideCandidate("YES", input, 0.014);
  const no = sideCandidate("NO", input, 0.014);
  const yesImbalance = depthImbalanceForSide("YES", input);
  const noImbalance = depthImbalanceForSide("NO", input);
  const picked = yesImbalance >= noImbalance ? yes : no;
  const imbalance = picked.side === "YES" ? yesImbalance : noImbalance;
  const depth = bidDepthForSide(picked.side, input);
  const allowed = picked.ask !== null
    && picked.spread <= maxSpread
    && depth >= minBidDepth
    && imbalance >= minImbalance
    && picked.edge >= minEdge
    && yesGateAllows(yesMode, picked.side, picked.edge, picked.confidence, picked.spread);
  return signalFromGenerated(algo, allowed ? picked.side : null, picked.edge, picked.confidence, depth >= 5 ? 3 : 1, picked.fairProbability, "Generated liquidity-imbalance sweep algo.");
}

function signalFromGenerated(algo, side, edgeAfterFees, confidence, sizeContracts, fairProbability, reason, exitRules) {
  return {
    strategyId: algo.id,
    strategyName: `${algo.displayId} ${algo.name}`,
    action: side === null ? "skip" : actionForSide(side),
    confidence,
    edgeAfterFees: roundRatio(edgeAfterFees),
    sizeContracts,
    fairProbability: roundRatio(fairProbability),
    reason,
    exitRules,
  };
}

function yesProbationAllows(side, edgeAfterFees, confidence, spread) {
  if (side !== "YES") return true;
  return edgeAfterFees >= activePaperRules.yesProbation.minEdgeAfterFees
    && confidence >= activePaperRules.yesProbation.minConfidence
    && spread <= activePaperRules.yesProbation.maxSpread;
}

function yesGateAllows(mode, side, edgeAfterFees, confidence, spread) {
  if (side !== "YES" || mode === "none") return true;
  if (mode === "loose") return edgeAfterFees >= 0.08 && confidence >= 65 && spread <= 0.06;
  return yesProbationAllows(side, edgeAfterFees, confidence, spread);
}

function askForSide(side, input) {
  return side === "YES" ? input.yesAsk : input.noAsk;
}

function spreadForSide(side, input) {
  const ask = side === "YES" ? input.yesAsk : input.noAsk;
  const bid = side === "YES" ? input.yesBid : input.noBid;
  if (ask === null || bid === null) return Number.POSITIVE_INFINITY;
  return Math.max(0, ask - bid);
}

function sideCandidate(side, input, feeBuffer) {
  const ask = askForSide(side, input);
  const spread = spreadForSide(side, input);
  const fairProbability = side === "YES" ? input.fairProbability : 1 - input.fairProbability;
  const edge = ask === null ? -1 : roundRatio(fairProbability - ask - feeBuffer);
  const confidence = clamp(Math.round(50 + Math.max(0, edge) * 180 - Math.max(0, spread - 0.02) * 120), 0, 96);
  return {
    side,
    ask,
    fairProbability,
    spread,
    edge,
    confidence,
  };
}

function pickBestSide(input, feeBuffer, sideMode) {
  const yes = sideCandidate("YES", input, feeBuffer);
  const no = sideCandidate("NO", input, feeBuffer);
  if (sideMode === "yes-only") return yes;
  if (sideMode === "no-only") return no;
  return yes.edge >= no.edge ? yes : no;
}

function bidDepthForSide(side, input) {
  return side === "YES" ? input.yesBidDepth ?? 0 : input.noBidDepth ?? 0;
}

function depthImbalanceForSide(side, input) {
  const selected = bidDepthForSide(side, input);
  const other = bidDepthForSide(oppositeSide(side), input);
  const total = selected + other;
  return total > 0 ? roundRatio((selected - other) / total) : 0;
}

function sideFromAction(action) {
  if (action === "buy_yes") return "YES";
  if (action === "buy_no") return "NO";
  return null;
}

function actionForSide(side) {
  return side === "YES" ? "buy_yes" : "buy_no";
}

function oppositeSide(side) {
  return side === "YES" ? "NO" : "YES";
}

function numberParam(params, key, fallback) {
  const value = params[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function stringParam(params, key, fallback) {
  const value = params[key];
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function contractsForConfidence(confidence) {
  if (confidence >= 85) return 5;
  if (confidence >= 72) return 3;
  return 1;
}

async function signedKalshiGet(pathWithQuery, keyId, privateKeyPem) {
  const timestamp = String(Date.now());
  const method = "GET";
  const pathWithoutQuery = `${TRADE_API_PATH}${pathWithQuery}`.split("?")[0];
  const signature = signPss(privateKeyPem, `${timestamp}${method}${pathWithoutQuery}`);
  const response = await fetch(`${KALSHI_BASE_URL}${TRADE_API_PATH}${pathWithQuery}`, {
    headers: signedHeaders(keyId, signature, timestamp),
    cache: "no-store",
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Kalshi ${pathWithoutQuery} failed with ${response.status}: ${text.slice(0, 180)}`);
  }
  return response.json();
}

async function signedKalshiPost(path, body, keyId, privateKeyPem) {
  const timestamp = String(Date.now());
  const method = "POST";
  const pathWithoutQuery = `${TRADE_API_PATH}${path}`;
  const signature = signPss(privateKeyPem, `${timestamp}${method}${pathWithoutQuery}`);
  const response = await fetch(`${KALSHI_BASE_URL}${TRADE_API_PATH}${path}`, {
    method,
    headers: {
      ...signedHeaders(keyId, signature, timestamp),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Kalshi ${pathWithoutQuery} failed with ${response.status}: ${text.slice(0, 240)}`);
  }
  return response.json();
}

function signedHeaders(keyId, signature, timestamp) {
  return {
    "Accept": "application/json",
    "KALSHI-ACCESS-KEY": keyId,
    "KALSHI-ACCESS-SIGNATURE": signature,
    "KALSHI-ACCESS-TIMESTAMP": timestamp,
    "User-Agent": "DogeEdge/0.1",
  };
}

function signPss(privateKeyPem, text) {
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(text);
  signer.end();
  return signer.sign({
    key: privateKeyPem,
    padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
    saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST,
  }).toString("base64");
}

function clientOrderIdFor(order) {
  const displayId = order.algoDisplayId.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 16);
  const timestamp = Date.now().toString(36);
  const random = crypto.randomBytes(3).toString("hex");
  return `dogeedge-${displayId}-${timestamp}-${random}`.slice(0, 64);
}

function redactedOrderPayload(payload) {
  return {
    ticker: payload.ticker,
    side: payload.side,
    action: payload.action,
    client_order_id: payload.client_order_id,
    count: payload.count,
    yes_price: payload.yes_price ?? null,
    no_price: payload.no_price ?? null,
    buy_max_cost: payload.buy_max_cost ?? null,
    time_in_force: payload.time_in_force,
  };
}

function parseRequestBody(body) {
  if (typeof body !== "string") return { ok: true, value: body };
  try {
    return { ok: true, value: JSON.parse(body) };
  } catch {
    return { ok: false, error: "Order request body must be valid JSON." };
  }
}

function positionCostCents(position) {
  const dollarCost = toNumber(position.position_cost_dollars);
  if (dollarCost !== null) return dollarsToCents(Math.abs(dollarCost));
  const centCost = toNumber(position.position_cost_cents ?? position.position_cost);
  return centCost === null ? 0 : Math.abs(Math.round(centCost));
}

function restingOrderCostCents(order) {
  const remaining = toNumber(order.remaining_count_fp ?? order.remaining_count ?? order.count_fp ?? order.count) ?? 0;
  const yesPrice = toNumber(order.yes_price_dollars ?? order.yes_price);
  const noPrice = toNumber(order.no_price_dollars ?? order.no_price);
  const priceDollars = centsOrDollarsToDollars(yesPrice ?? noPrice ?? 0);
  return Math.max(0, Math.round(remaining * priceDollars * 100));
}

function marketTicker(row) {
  return isRecord(row) ? stringOrNull(row.market_ticker ?? row.ticker ?? row.marketTicker) : null;
}

function normalizePrivateKey(value) {
  if (!value) return null;
  return value.includes("\\n") ? value.replace(/\\n/g, "\n") : value;
}

function normalizedEnum(value, allowed) {
  const normalized = stringOrNull(value)?.toLowerCase();
  return normalized && allowed.includes(normalized) ? normalized : null;
}

function reject(error) {
  return { ok: false, error };
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringOrNull(value) {
  return value === undefined || value === null || value === "" ? null : String(value);
}

function stringOrDefault(value, fallback) {
  const text = stringOrNull(value);
  return text ?? fallback;
}

function toNumber(value) {
  if (value === undefined || value === null || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function integerNumber(value) {
  const parsed = toNumber(value);
  return parsed !== null && Number.isInteger(parsed) ? parsed : null;
}

function moneyNumber(value) {
  const parsed = toNumber(value);
  return parsed !== null && Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : null;
}

function positiveNumber(value, fallback) {
  const parsed = toNumber(value);
  return parsed !== null && parsed > 0 ? parsed : fallback;
}

function dollarsToCents(value) {
  return Math.round(value * 100);
}

function centsOrDollarsToDollars(value) {
  return value > 1 ? value / 100 : value;
}

function money(value) {
  return `$${Number(value).toFixed(2)}`;
}

function centsMoney(cents) {
  return money(cents / 100);
}

function executableLimitFailureMessage(source, algoDisplayId, requestedSide, requestedAction, limitSignal, limitPriceCents, minEdgeAfterFees) {
  if (limitSignal.edgeAfterFees < minEdgeAfterFees) {
    return `${source} ${requestedSide} order would not keep the required ${edgeCentsLabel(minEdgeAfterFees)} positive edge at ${limitPriceCents}c; edge is ${edgeCentsLabel(limitSignal.edgeAfterFees)}.`;
  }
  const limitSide = sideFromAction(limitSignal.action);
  if (!limitSide || limitSignal.action === "skip") {
    return `${source} ${algoDisplayId} algo gate failed at ${limitPriceCents}c; it no longer passes its own entry rules. Edge is ${edgeCentsLabel(limitSignal.edgeAfterFees)}.`;
  }
  if (limitSide !== requestedSide || limitSignal.action !== requestedAction) {
    return `${source} ${algoDisplayId} side changed to ${limitSide} at ${limitPriceCents}c; waiting for a stable executable signal. Edge is ${edgeCentsLabel(limitSignal.edgeAfterFees)}.`;
  }
  return null;
}

function edgeCentsLabel(value) {
  return `${(value * 100).toFixed(1)}c`;
}

function roundRatio(value) {
  return Number(value.toFixed(4));
}

function roundSize(value) {
  return Number(value.toFixed(2));
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
