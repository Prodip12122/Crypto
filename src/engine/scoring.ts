import type {
  AdminConfigParams,
  Candle,
  CoinMarketSnapshot,
  EntryType,
  FundamentalContext,
  ScoreBreakdown,
  SignalClassification,
  SignalDirection,
  SignalEvaluation,
  SignalStatus,
  TimeframeAnalysis,
} from '../types/trading.ts';

export function classifyScore(score: number): SignalClassification {
  if (score >= 90) return 'Premium';
  if (score >= 85) return 'Strong';
  if (score >= 80) return 'Valid';
  return 'Rejected';
}

export function roundToStep(value: number, step: number): number {
  if (!Number.isFinite(step) || step <= 0) return value;
  const decimals = Math.max(0, Math.ceil(-Math.log10(step)));
  const rounded = Math.round(value / step) * step;
  return Number(rounded.toFixed(decimals));
}

export function calculatePositionSizing(params: {
  accountEquityUsd: number;
  riskPercent: number;
  entryPrice: number;
  stopLoss: number;
  maxLeverage: number;
  stepSize: number;
  minQty: number;
  minNotional: number;
  feeRateBps?: number;
}): { positionSizeUsd: number; quantity: number; leverage: number } {
  const {
    accountEquityUsd,
    riskPercent,
    entryPrice,
    stopLoss,
    maxLeverage,
    stepSize,
    minQty,
    minNotional,
    feeRateBps = 4, // 0.04% Binance Futures taker
  } = params;

  const riskBudgetUsd = accountEquityUsd * (riskPercent / 100);
  const stopDistPct = Math.abs(entryPrice - stopLoss) / Math.max(entryPrice, 1e-12);
  const roundTripFeePct = (feeRateBps * 2) / 10000;
  const effectiveStopPct = Math.max(stopDistPct + roundTripFeePct, 0.002);

  const rawNotionalUsd = riskBudgetUsd / effectiveStopPct;
  const maxAllowedNotional = accountEquityUsd * maxLeverage;
  const clampedNotionalUsd = Math.max(minNotional, Math.min(rawNotionalUsd, maxAllowedNotional));

  const rawQty = clampedNotionalUsd / Math.max(entryPrice, 1e-12);
  const steppedQty = Math.max(minQty, roundToStep(rawQty, stepSize));
  const finalNotional = steppedQty * entryPrice;
  const requiredLeverage = Math.max(
    1,
    Math.min(maxLeverage, Math.ceil(finalNotional / Math.max(accountEquityUsd, 1)))
  );

  return {
    positionSizeUsd: Number(finalNotional.toFixed(2)),
    quantity: steppedQty,
    leverage: requiredLeverage,
  };
}

export function evaluateDirection(params: {
  direction: SignalDirection;
  snapshot: CoinMarketSnapshot;
  tf4h: TimeframeAnalysis;
  tf1h: TimeframeAnalysis;
  tf15m: TimeframeAnalysis;
  tf5m: TimeframeAnalysis;
  btcContext: FundamentalContext;
  config: AdminConfigParams;
}): SignalEvaluation {
  const { direction, snapshot, tf4h, tf1h, tf15m, tf5m, btcContext, config } = params;
  const ind4h = tf4h.indicators;
  const ind1h = tf1h.indicators;
  const ind15m = tf15m.indicators;
  const ind5m = tf5m.indicators;
  const smc15m = tf15m.smc;
  const smc5m = tf5m.smc;

  const isLong = direction === 'LONG';
  const rejectionReasons: string[] = [];

  // 1. Hard Liquidity, Spread & Data Freshness checks
  const ageMs = Date.now() - snapshot.fetchedAt;
  if (ageMs > 180_000) {
    rejectionReasons.push(`Stale market snapshot (${Math.round(ageMs / 1000)}s old)`);
  }
  if (snapshot.ticker.quoteVolume < config.minVolume24hUsd) {
    rejectionReasons.push(
      `24h volume $${(snapshot.ticker.quoteVolume / 1e6).toFixed(2)}M below $${(
        config.minVolume24hUsd / 1e6
      ).toFixed(1)}M threshold`
    );
  }
  if (snapshot.orderBook.spreadBps > 15) {
    rejectionReasons.push(`Bid/ask spread too wide (${snapshot.orderBook.spreadBps.toFixed(1)} bps)`);
  }

  // 2. Higher-timeframe strong conflict check (4H + 1H)
  const expectedBias = isLong ? 'bullish' : 'bearish';
  const oppositeBias = isLong ? 'bearish' : 'bullish';
  if (ind4h.trendDirection === oppositeBias && ind1h.trendDirection === oppositeBias) {
    rejectionReasons.push(`Higher timeframes (4H & 1H) strongly ${oppositeBias}, conflicting with ${direction}`);
  }
  if (
    tf4h.smc.structureBias === oppositeBias &&
    ind4h.adx14 > 28 &&
    ind1h.trendDirection === oppositeBias
  ) {
    rejectionReasons.push(`4H structural ${oppositeBias} trend (ADX ${ind4h.adx14.toFixed(1)}) opposes ${direction}`);
  }

  // 3. Deterministic 100-Point Scoring Breakdown
  // A) Multi-Timeframe Trend (max 20)
  let mtfTrend = 0;
  if (ind4h.trendDirection === expectedBias) mtfTrend += 6;
  else if (ind4h.trendDirection === 'neutral') mtfTrend += 3;

  if (ind1h.trendDirection === expectedBias) mtfTrend += 6;
  else if (ind1h.trendDirection === 'neutral') mtfTrend += 2;

  if (ind15m.trendDirection === expectedBias) mtfTrend += 5;
  else if (ind15m.trendDirection === 'neutral') mtfTrend += 2;

  if (ind5m.trendDirection === expectedBias) mtfTrend += 3;

  // B) Momentum (max 15)
  let momentum = 0;
  if (isLong) {
    if (ind5m.rsi14 >= 45 && ind5m.rsi14 <= 68) momentum += 5;
    else if (ind5m.rsi14 >= 38 && ind5m.rsi14 < 45) momentum += 3;
    if (ind5m.macdHistogram > 0) momentum += 4;
    if (ind15m.macdHistogram > 0) momentum += 3;
    if (ind15m.adx14 >= 20 && ind15m.plusDI > ind15m.minusDI) momentum += 3;
  } else {
    if (ind5m.rsi14 <= 55 && ind5m.rsi14 >= 32) momentum += 5;
    else if (ind5m.rsi14 > 55 && ind5m.rsi14 <= 62) momentum += 3;
    if (ind5m.macdHistogram < 0) momentum += 4;
    if (ind15m.macdHistogram < 0) momentum += 3;
    if (ind15m.adx14 >= 20 && ind15m.minusDI > ind15m.plusDI) momentum += 3;
  }

  // C) Volume and Order Book (max 15)
  let volumeOrderBook = 0;
  if (ind5m.volumeRatio >= 1.5) volumeOrderBook += 6;
  else if (ind5m.volumeRatio >= 1.15) volumeOrderBook += 4;
  else if (ind5m.volumeRatio >= 0.9) volumeOrderBook += 2;

  if ((isLong && ind5m.obvSlope > 0) || (!isLong && ind5m.obvSlope < 0)) volumeOrderBook += 4;
  if ((isLong && snapshot.orderBook.imbalance > 0.08) || (!isLong && snapshot.orderBook.imbalance < -0.08)) {
    volumeOrderBook += 3;
  } else if (Math.abs(snapshot.orderBook.imbalance) <= 0.08) {
    volumeOrderBook += 1;
  }
  if (snapshot.orderBook.spreadBps <= 5) volumeOrderBook += 2;
  else if (snapshot.orderBook.spreadBps <= 10) volumeOrderBook += 1;

  // D) Smart Money Concepts (max 20)
  let smcScore = 0;
  if (smc15m.structureBias === expectedBias) smcScore += 6;
  else if (smc15m.structureBias === 'ranging') smcScore += 2;

  const hasBos =
    smc15m.bosEvents.some((b) => b.direction === expectedBias) ||
    smc5m.bosEvents.some((b) => b.direction === expectedBias);
  const hasChoch = smc5m.chochEvents.some((c) => c.direction === expectedBias);
  if (hasBos) smcScore += 4;
  if (hasChoch) smcScore += 2;

  const relevantZone = isLong ? smc15m.nearestBullishZone : smc15m.nearestBearishZone;
  if (relevantZone) smcScore += 4;

  const expectedSweep = isLong ? 'sell_side_sweep' : 'buy_side_sweep';
  if (
    smc5m.recentSweeps.some((s) => s.type === expectedSweep) ||
    smc15m.recentSweeps.some((s) => s.type === expectedSweep)
  ) {
    smcScore += 4;
  }

  // E) Support and Resistance / VWAP / Fib (max 10)
  let supportResistance = 0;
  const currentPrice = snapshot.ticker.lastPrice;
  if (isLong) {
    const nearSupport = ind15m.supportLevels.find(
      (s) => currentPrice >= s.price && (currentPrice - s.price) / currentPrice <= 0.012
    );
    if (nearSupport) supportResistance += 5;
    if (currentPrice >= ind5m.vwap * 0.998) supportResistance += 3;
    if (Math.abs(currentPrice - ind15m.fibonacci.level618) / currentPrice <= 0.01 ||
        Math.abs(currentPrice - ind15m.fibonacci.level500) / currentPrice <= 0.01) {
      supportResistance += 2;
    }
  } else {
    const nearRes = ind15m.resistanceLevels.find(
      (r) => r.price >= currentPrice && (r.price - currentPrice) / currentPrice <= 0.012
    );
    if (nearRes) supportResistance += 5;
    if (currentPrice <= ind5m.vwap * 1.002) supportResistance += 3;
    if (Math.abs(currentPrice - ind15m.fibonacci.level618) / currentPrice <= 0.01 ||
        Math.abs(currentPrice - ind15m.fibonacci.level500) / currentPrice <= 0.01) {
      supportResistance += 2;
    }
  }

  // F) Funding and Open Interest (max 10)
  let fundingOi = 0;
  const fr = snapshot.derivatives.fundingRate;
  if (isLong) {
    if (fr <= 0.0001) fundingOi += 5; // neutral or negative funding favors longs
    else if (fr <= 0.0005) fundingOi += 3;
  } else {
    if (fr >= -0.0001) fundingOi += 5;
    else if (fr >= -0.0005) fundingOi += 3;
  }
  if (snapshot.derivatives.openInterestValue > 2_000_000) fundingOi += 3;
  if (snapshot.derivatives.longShortRatio !== null) {
    // Contrarian edge when crowd isn't overcrowded on our side
    if ((isLong && snapshot.derivatives.longShortRatio < 1.6) ||
        (!isLong && snapshot.derivatives.longShortRatio > 0.7)) {
      fundingOi += 2;
    }
  } else {
    fundingOi += 1;
  }

  // G) Fundamental and BTC Context (max 5)
  let fundamentalBtc = 0;
  if (btcContext.btcTrend4h === expectedBias || btcContext.btcTrend1h === expectedBias) {
    fundamentalBtc += 3;
  } else if (btcContext.btcTrend1h === 'neutral') {
    fundamentalBtc += 2;
  }
  if (btcContext.newsRiskLevel === 'low') fundamentalBtc += 2;
  else if (btcContext.newsRiskLevel === 'moderate') fundamentalBtc += 1;

  // 4. Entry, Stop Loss & Take Profit Calculation
  const tickSize = snapshot.symbolInfo.tickSize || 0.0001;
  const atr5m = Math.max(ind5m.atr14, currentPrice * 0.0015);
  const atr15m = Math.max(ind15m.atr14, currentPrice * 0.0025);

  let entryType: EntryType = 'MARKET';
  let entryLimitPrice = currentPrice;
  let entryZoneLow = currentPrice - atr5m * 0.25;
  let entryZoneHigh = currentPrice + atr5m * 0.25;

  if (isLong) {
    if (relevantZone && relevantZone.high < currentPrice && (currentPrice - relevantZone.high) / currentPrice <= 0.012) {
      entryType = 'LIMIT';
      entryLimitPrice = (relevantZone.high + relevantZone.low) / 2;
      entryZoneLow = relevantZone.low;
      entryZoneHigh = relevantZone.high;
    } else if (ind5m.ema20 < currentPrice && (currentPrice - ind5m.ema20) / currentPrice >= 0.002 && (currentPrice - ind5m.ema20) / currentPrice <= 0.01) {
      entryType = 'LIMIT';
      entryLimitPrice = ind5m.ema20;
      entryZoneLow = ind5m.ema20 - atr5m * 0.25;
      entryZoneHigh = ind5m.ema20 + atr5m * 0.25;
    } else {
      entryType = 'MARKET';
      entryLimitPrice = currentPrice;
      entryZoneLow = currentPrice - atr5m * 0.2;
      entryZoneHigh = currentPrice + atr5m * 0.2;
    }
  } else {
    if (relevantZone && relevantZone.low > currentPrice && (relevantZone.low - currentPrice) / currentPrice <= 0.012) {
      entryType = 'LIMIT';
      entryLimitPrice = (relevantZone.high + relevantZone.low) / 2;
      entryZoneLow = relevantZone.low;
      entryZoneHigh = relevantZone.high;
    } else if (ind5m.ema20 > currentPrice && (ind5m.ema20 - currentPrice) / currentPrice >= 0.002 && (ind5m.ema20 - currentPrice) / currentPrice <= 0.01) {
      entryType = 'LIMIT';
      entryLimitPrice = ind5m.ema20;
      entryZoneLow = ind5m.ema20 - atr5m * 0.25;
      entryZoneHigh = ind5m.ema20 + atr5m * 0.25;
    } else {
      entryType = 'MARKET';
      entryLimitPrice = currentPrice;
      entryZoneLow = currentPrice - atr5m * 0.2;
      entryZoneHigh = currentPrice + atr5m * 0.2;
    }
  }

  // Stop Loss using swing structure + ATR buffer
  let stopLoss: number;
  if (isLong) {
    const structSupport = ind15m.supportLevels[0]?.price;
    const atrStop = entryLimitPrice - atr15m * 1.35;
    const rawStop = structSupport && structSupport < entryLimitPrice
      ? Math.min(atrStop, structSupport - atr5m * 0.35)
      : atrStop;
    // Clamp stop distance between 0.35% and 4.0%
    const minStop = entryLimitPrice * (1 - 0.04);
    const maxStop = entryLimitPrice * (1 - 0.0035);
    stopLoss = Math.max(minStop, Math.min(maxStop, rawStop));
  } else {
    const structRes = ind15m.resistanceLevels[0]?.price;
    const atrStop = entryLimitPrice + atr15m * 1.35;
    const rawStop = structRes && structRes > entryLimitPrice
      ? Math.max(atrStop, structRes + atr5m * 0.35)
      : atrStop;
    const minStop = entryLimitPrice * (1 + 0.0035);
    const maxStop = entryLimitPrice * (1 + 0.04);
    stopLoss = Math.min(maxStop, Math.max(minStop, rawStop));
  }

  const riskUnit = Math.abs(entryLimitPrice - stopLoss);
  const stopDistPct = riskUnit / Math.max(entryLimitPrice, 1e-12);
  if (stopDistPct < 0.003 || stopDistPct > 0.045) {
    rejectionReasons.push(`Stop-loss distance ${(stopDistPct * 100).toFixed(2)}% outside [0.3%, 4.5%] range`);
  }

  // TP1 = 1R, TP2 = 2R, TP3 = 3R adjusted conservatively for nearby S/R
  let tp1 = isLong ? entryLimitPrice + riskUnit * 1.0 : entryLimitPrice - riskUnit * 1.0;
  let tp2 = isLong ? entryLimitPrice + riskUnit * 2.0 : entryLimitPrice - riskUnit * 2.0;
  let tp3 = isLong ? entryLimitPrice + riskUnit * 3.0 : entryLimitPrice - riskUnit * 3.0;

  if (isLong && ind15m.resistanceLevels.length > 0) {
    const res1 = ind15m.resistanceLevels[0].price;
    if (res1 > entryLimitPrice + riskUnit * 1.65 && res1 < tp2) {
      tp2 = res1 * 0.999;
    }
  } else if (!isLong && ind15m.supportLevels.length > 0) {
    const sup1 = ind15m.supportLevels[0].price;
    if (sup1 < entryLimitPrice - riskUnit * 1.65 && sup1 > tp2) {
      tp2 = sup1 * 1.001;
    }
  }

  // Round prices to tickSize
  entryLimitPrice = roundToStep(entryLimitPrice, tickSize);
  entryZoneLow = roundToStep(entryZoneLow, tickSize);
  entryZoneHigh = roundToStep(entryZoneHigh, tickSize);
  stopLoss = roundToStep(stopLoss, tickSize);
  tp1 = roundToStep(tp1, tickSize);
  tp2 = roundToStep(tp2, tickSize);
  tp3 = roundToStep(tp3, tickSize);

  const riskRewardRatio = Number((Math.abs(tp2 - entryLimitPrice) / Math.max(riskUnit, 1e-12)).toFixed(2));
  if (riskRewardRatio < config.minRiskReward) {
    rejectionReasons.push(`Risk/Reward ${riskRewardRatio} below minimum ${config.minRiskReward}`);
  }

  // H) Entry and Risk Quality (max 5)
  let entryRiskQuality = 0;
  if (riskRewardRatio >= 2.0) entryRiskQuality += 3;
  else if (riskRewardRatio >= config.minRiskReward) entryRiskQuality += 2;
  if (stopDistPct >= 0.004 && stopDistPct <= 0.025) entryRiskQuality += 2;
  else if (stopDistPct <= 0.04) entryRiskQuality += 1;

  const scoreBreakdown: ScoreBreakdown = {
    mtfTrend: Math.min(20, mtfTrend),
    momentum: Math.min(15, momentum),
    volumeOrderBook: Math.min(15, volumeOrderBook),
    smc: Math.min(20, smcScore),
    supportResistance: Math.min(10, supportResistance),
    fundingOi: Math.min(10, fundingOi),
    fundamentalBtc: Math.min(5, fundamentalBtc),
    entryRiskQuality: Math.min(5, entryRiskQuality),
  };

  const totalScore =
    scoreBreakdown.mtfTrend +
    scoreBreakdown.momentum +
    scoreBreakdown.volumeOrderBook +
    scoreBreakdown.smc +
    scoreBreakdown.supportResistance +
    scoreBreakdown.fundingOi +
    scoreBreakdown.fundamentalBtc +
    scoreBreakdown.entryRiskQuality;

  const classification = classifyScore(totalScore);
  if (totalScore < config.minSignalScore) {
    rejectionReasons.push(`Score ${totalScore}/100 below minimum threshold ${config.minSignalScore}`);
  }

  const sizing = calculatePositionSizing({
    accountEquityUsd: config.accountEquityUsd,
    riskPercent: config.riskPercentage,
    entryPrice: entryLimitPrice,
    stopLoss,
    maxLeverage: Math.min(config.maxLeverage, snapshot.symbolInfo.maxLeverage),
    stepSize: snapshot.symbolInfo.stepSize,
    minQty: snapshot.symbolInfo.minQty,
    minNotional: snapshot.symbolInfo.minNotional,
  });

  // Estimated holding time based on TP2 distance relative to 5m ATR velocity
  const barsToTarget = Math.max(4, Math.min(48, Math.round(Math.abs(tp2 - entryLimitPrice) / (atr5m * 0.45))));
  const estimatedHoldingMinutes = barsToTarget * 5;
  const signalExpiryMinutes = entryType === 'LIMIT' ? 45 : 20;

  const passedValidation = rejectionReasons.length === 0 && totalScore >= config.minSignalScore;

  const deterministicRationaleEn = `${snapshot.symbolInfo.symbol} ${direction} (${entryType}) scored ${totalScore}/100 (${classification}). 4H trend is ${ind4h.trendDirection}, 1H is ${ind1h.trendDirection}, 15M SMC bias is ${smc15m.structureBias} with ${smc15m.activeOrderBlocks.length} active OBs and ${smc15m.activeFVGs.length} FVGs. 5M RSI is ${ind5m.rsi14.toFixed(1)}, volume ${ind5m.volumeRatio.toFixed(2)}x SMA20, R:R ${riskRewardRatio}:1.`;

  const deterministicRationaleBn = `${snapshot.symbolInfo.symbol} কয়েনে ${direction === 'LONG' ? 'দাম বাড়ার (LONG)' : 'দাম কমার (SHORT)'} সুযোগ তৈরি হয়েছে। সিস্টেমের মোট স্কোর ${totalScore}/100 (${classification})। বড় টাইমফ্রেম (4H: ${ind4h.trendDirection}, 1H: ${ind1h.trendDirection}) এবং Smart Money কাঠামো (${smc15m.structureBias}) একই দিক নির্দেশ করছে। ঝুকি ও লাভের অনুপাত ${riskRewardRatio}:1 এবং আনুমানিক সময় ${estimatedHoldingMinutes} মিনিট।`;

  return {
    symbol: snapshot.symbolInfo.symbol,
    direction,
    entryType,
    totalScore,
    classification,
    scoreBreakdown,
    passedValidation,
    rejectionReasons,
    entryLimitPrice,
    entryZoneLow,
    entryZoneHigh,
    stopLoss,
    tp1,
    tp2,
    tp3,
    riskRewardRatio,
    positionSizeUsd: sizing.positionSizeUsd,
    quantity: sizing.quantity,
    leverage: sizing.leverage,
    riskPercent: config.riskPercentage,
    estimatedHoldingMinutes,
    signalExpiryMinutes,
    technicalSummary: {
      trend4h: ind4h.trendDirection,
      trend1h: ind1h.trendDirection,
      setup15m: ind15m.trendDirection,
      entry5m: ind5m.trendDirection,
      rsi5m: Number(ind5m.rsi14.toFixed(2)),
      adx15m: Number(ind15m.adx14.toFixed(2)),
      atr5mPct: Number(ind5m.atrPercent.toFixed(3)),
      vwapRelation: currentPrice >= ind5m.vwap ? 'Above VWAP' : 'Below VWAP',
      volumeRatio5m: Number(ind5m.volumeRatio.toFixed(2)),
    },
    smcSummary: {
      bias15m: smc15m.structureBias,
      bosDetected: hasBos,
      chochDetected: hasChoch,
      activeObCount: smc15m.activeOrderBlocks.length,
      activeFvgCount: smc15m.activeFVGs.length,
      recentSweep: smc5m.recentSweeps[0]?.type ?? smc15m.recentSweeps[0]?.type ?? null,
    },
    fundamentalContext: btcContext,
    deterministicRationaleEn,
    deterministicRationaleBn,
  };
}

export interface LifecycleSignalState {
  status: SignalStatus;
  direction: SignalDirection;
  entryType: EntryType;
  entryLimitPrice: number;
  entryZoneLow: number;
  entryZoneHigh: number;
  stopLoss: number;
  tp1: number;
  tp2: number;
  tp3: number;
  signalExpiryAt: number;
}

export interface LifecycleStepResult {
  newStatus: SignalStatus;
  changed: boolean;
  eventType: string | null;
  triggerPrice: number;
  ambiguousResolution: string | null;
  realizedPnlR: number | null;
  note: string | null;
}

/**
 * Deterministic event processor for signal lifecycle state transitions.
 * Never counts an unfilled LIMIT signal as a completed winning trade.
 * Marks ambiguous candles if both SL and TP are crossed within the same candle.
 */
export function processSignalLifecycleStep(
  signal: LifecycleSignalState,
  candle: Candle,
  subCandles1m?: Candle[]
): LifecycleStepResult {
  const isLong = signal.direction === 'LONG';
  const current = signal.status;

  if (
    current === 'TP3_HIT' ||
    current === 'SL_HIT' ||
    current === 'EXPIRED' ||
    current === 'CANCELLED'
  ) {
    return {
      newStatus: current,
      changed: false,
      eventType: null,
      triggerPrice: candle.close,
      ambiguousResolution: null,
      realizedPnlR: null,
      note: null,
    };
  }

  // Check expiry while WAITING_FOR_ENTRY
  if (current === 'WAITING_FOR_ENTRY' && candle.closeTime >= signal.signalExpiryAt) {
    return {
      newStatus: 'EXPIRED',
      changed: true,
      eventType: 'EXPIRED',
      triggerPrice: candle.close,
      ambiguousResolution: null,
      realizedPnlR: 0,
      note: 'Signal expired before entry zone fill (not counted as win or loss).',
    };
  }

  // Step 1: Check ENTRY_FILLED if WAITING_FOR_ENTRY
  if (current === 'WAITING_FOR_ENTRY') {
    const filled =
      signal.entryType === 'MARKET' ||
      (candle.low <= signal.entryZoneHigh && candle.high >= signal.entryZoneLow);

    if (!filled) {
      return {
        newStatus: current,
        changed: false,
        eventType: null,
        triggerPrice: candle.close,
        ambiguousResolution: null,
        realizedPnlR: null,
        note: null,
      };
    }

    // Check if SL was also touched on the exact entry candle
    const slHitSameBar = isLong ? candle.low <= signal.stopLoss : candle.high >= signal.stopLoss;
    if (slHitSameBar && (!subCandles1m || subCandles1m.length === 0)) {
      return {
        newStatus: 'SL_HIT',
        changed: true,
        eventType: 'SL_HIT',
        triggerPrice: signal.stopLoss,
        ambiguousResolution: 'AMBIGUOUS_ENTRY_SL_CONSERVATIVE',
        realizedPnlR: -1,
        note: 'Candle touched both entry zone and stop-loss; conservatively resolved as SL_HIT.',
      };
    }

    return {
      newStatus: 'ENTRY_FILLED',
      changed: true,
      eventType: 'ENTRY_FILLED',
      triggerPrice: signal.entryLimitPrice,
      ambiguousResolution: null,
      realizedPnlR: null,
      note: `Entry filled at ${signal.entryLimitPrice}.`,
    };
  }

  // Step 2: Signal is filled (ENTRY_FILLED / TP1_HIT / TP2_HIT) -> Evaluate SL vs TP1/TP2/TP3
  const slTouched = isLong ? candle.low <= signal.stopLoss : candle.high >= signal.stopLoss;
  const tp3Touched = isLong ? candle.high >= signal.tp3 : candle.low <= signal.tp3;
  const tp2Touched = isLong ? candle.high >= signal.tp2 : candle.low <= signal.tp2;
  const tp1Touched = isLong ? candle.high >= signal.tp1 : candle.low <= signal.tp1;

  const anyNextTpTouched =
    (current === 'ENTRY_FILLED' && (tp1Touched || tp2Touched || tp3Touched)) ||
    (current === 'TP1_HIT' && (tp2Touched || tp3Touched)) ||
    (current === 'TP2_HIT' && tp3Touched);

  // Ambiguous candle check: both SL and next TP touched inside the same bar
  if (slTouched && anyNextTpTouched) {
    if (subCandles1m && subCandles1m.length > 0) {
      let stateCopy: LifecycleSignalState = { ...signal };
      for (const sc of subCandles1m) {
        const res = processSignalLifecycleStep(stateCopy, sc);
        if (res.changed) {
          return {
            ...res,
            ambiguousResolution: `RESOLVED_VIA_1M_DATA (${res.newStatus})`,
          };
        }
      }
    }
    return {
      newStatus: 'SL_HIT',
      changed: true,
      eventType: 'SL_HIT',
      triggerPrice: signal.stopLoss,
      ambiguousResolution: 'AMBIGUOUS_INTRABAR_SL_FIRST',
      realizedPnlR: current === 'TP1_HIT' ? 0.25 : current === 'TP2_HIT' ? 1.0 : -1.0,
      note: 'Candle crossed both SL and TP without 1m ordering; marked ambiguous and resolved conservatively.',
    };
  }

  if (slTouched) {
    return {
      newStatus: 'SL_HIT',
      changed: true,
      eventType: 'SL_HIT',
      triggerPrice: signal.stopLoss,
      ambiguousResolution: null,
      realizedPnlR: current === 'TP1_HIT' ? 0.25 : current === 'TP2_HIT' ? 1.0 : -1.0,
      note: `Stop-loss hit at ${signal.stopLoss}.`,
    };
  }

  if (tp3Touched) {
    return {
      newStatus: 'TP3_HIT',
      changed: true,
      eventType: 'TP3_HIT',
      triggerPrice: signal.tp3,
      ambiguousResolution: null,
      realizedPnlR: 3.0,
      note: `Take Profit 3 reached at ${signal.tp3}.`,
    };
  }

  if (tp2Touched && (current === 'ENTRY_FILLED' || current === 'TP1_HIT')) {
    return {
      newStatus: 'TP2_HIT',
      changed: true,
      eventType: 'TP2_HIT',
      triggerPrice: signal.tp2,
      ambiguousResolution: null,
      realizedPnlR: 2.0,
      note: `Take Profit 2 reached at ${signal.tp2}.`,
    };
  }

  if (tp1Touched && current === 'ENTRY_FILLED') {
    return {
      newStatus: 'TP1_HIT',
      changed: true,
      eventType: 'TP1_HIT',
      triggerPrice: signal.tp1,
      ambiguousResolution: null,
      realizedPnlR: 1.0,
      note: `Take Profit 1 reached at ${signal.tp1}.`,
    };
  }

  return {
    newStatus: current,
    changed: false,
    eventType: null,
    triggerPrice: candle.close,
    ambiguousResolution: null,
    realizedPnlR: null,
    note: null,
  };
}
