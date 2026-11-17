import type {
  BacktestConfig,
  BacktestReport,
  BacktestTrade,
  Candle,
  SignalDirection,
} from '../types/trading.ts';
import { analyzeIndicators } from './indicators.ts';
import { analyzeSMC } from './smc.ts';

function sliceForSplit(candles: Candle[], mode: BacktestConfig['splitMode']): Candle[] {
  const n = candles.length;
  if (mode === 'train') return candles.slice(0, Math.floor(n * 0.6));
  if (mode === 'validation') return candles.slice(Math.floor(n * 0.4), Math.floor(n * 0.8));
  if (mode === 'out_of_sample') return candles.slice(Math.floor(n * 0.55));
  return candles;
}

/**
 * Chronological historical backtest engine with strict causal slicing (no look-ahead bias).
 * Includes trading fees, slippage, and funding accrual.
 */
export function runHistoricalBacktest(
  rawCandles: Candle[],
  config: BacktestConfig
): BacktestReport {
  const closed = rawCandles.filter((c) => c.isClosed);
  const candles = sliceForSplit(closed.length >= 120 ? closed : rawCandles, config.splitMode);

  if (candles.length < 80) {
    throw new Error(`Insufficient candles (${candles.length}) for backtest split "${config.splitMode}".`);
  }

  let equity = config.initialEquity;
  let peakEquity = equity;
  let maxDrawdownPct = 0;

  const equityCurve: Array<{ time: string; equity: number }> = [
    { time: new Date(candles[60].openTime).toISOString(), equity: Number(equity.toFixed(2)) },
  ];
  const tradesLog: BacktestTrade[] = [];

  const warmup = 60;
  let i = warmup;

  while (i < candles.length - 5) {
    // Causal window: strictly <= i
    const windowSlice = candles.slice(Math.max(0, i - 140), i + 1);
    const ind = analyzeIndicators(windowSlice, config.timeframe);
    const smc = analyzeSMC(windowSlice, config.timeframe);

    // Deterministic entry candidate scoring using causal window only
    let bullScore = 0;
    let bearScore = 0;

    if (ind.trendDirection === 'bullish') bullScore += 30;
    if (ind.trendDirection === 'bearish') bearScore += 30;
    if (ind.rsi14 >= 45 && ind.rsi14 <= 66 && ind.macdHistogram > 0) bullScore += 20;
    if (ind.rsi14 <= 55 && ind.rsi14 >= 34 && ind.macdHistogram < 0) bearScore += 20;
    if (ind.volumeRatio >= 1.1 && ind.obvSlope > 0) bullScore += 15;
    if (ind.volumeRatio >= 1.1 && ind.obvSlope < 0) bearScore += 15;
    if (smc.structureBias === 'bullish' || smc.nearestBullishZone) bullScore += 20;
    if (smc.structureBias === 'bearish' || smc.nearestBearishZone) bearScore += 20;
    if (ind.close >= ind.vwap) bullScore += 10;
    else bearScore += 10;
    if (ind.setupFlags.pullbackToEma20 || ind.setupFlags.breakoutUp) bullScore += 5;
    if (ind.setupFlags.pullbackToEma20 || ind.setupFlags.breakoutDown) bearScore += 5;

    const bestDir: SignalDirection | null =
      bullScore >= config.minScore && bullScore > bearScore
        ? 'LONG'
        : bearScore >= config.minScore && bearScore > bullScore
          ? 'SHORT'
          : null;

    if (!bestDir) {
      i += 1;
      continue;
    }

    const score = bestDir === 'LONG' ? bullScore : bearScore;
    const isLong = bestDir === 'LONG';
    const entryCandle = candles[i + 1];
    const slippageMult = config.slippageBps / 10000;
    const rawEntry = entryCandle.open;
    const entryPrice = isLong ? rawEntry * (1 + slippageMult) : rawEntry * (1 - slippageMult);

    const riskDist = Math.max(ind.atr14 * 1.4, entryPrice * 0.004);
    const stopLoss = isLong ? entryPrice - riskDist : entryPrice + riskDist;
    const tp1 = isLong ? entryPrice + riskDist * 1.0 : entryPrice - riskDist * 1.0;
    const tp2 = isLong ? entryPrice + riskDist * 2.0 : entryPrice - riskDist * 2.0;
    const tp3 = isLong ? entryPrice + riskDist * 3.0 : entryPrice - riskDist * 3.0;

    const riskUsd = equity * (config.riskPerTradePct / 100);
    const positionNotional = riskUsd / (riskDist / entryPrice);
    const feePct = (config.feeBps * 2) / 10000;
    const feesUsd = positionNotional * feePct;

    let exitIdx = Math.min(candles.length - 1, i + 36);
    let outcome: BacktestTrade['outcome'] = 'EXPIRED';
    let exitPrice = candles[exitIdx].close;
    let pnlR = 0;
    let ambiguousBar = false;

    for (let k = i + 1; k <= Math.min(candles.length - 1, i + 36); k++) {
      const bar = candles[k];
      const slHit = isLong ? bar.low <= stopLoss : bar.high >= stopLoss;
      const tp2Hit = isLong ? bar.high >= tp2 : bar.low <= tp2;
      const tp1Hit = isLong ? bar.high >= tp1 : bar.low <= tp1;

      if (slHit && (tp1Hit || tp2Hit)) {
        ambiguousBar = true;
        outcome = 'SL_HIT';
        exitPrice = stopLoss;
        pnlR = -1.0;
        exitIdx = k;
        break;
      }
      if (slHit) {
        outcome = 'SL_HIT';
        exitPrice = stopLoss;
        pnlR = -1.0;
        exitIdx = k;
        break;
      }
      if (tp2Hit) {
        outcome = 'TP2_HIT';
        exitPrice = tp2;
        pnlR = 2.0;
        exitIdx = k;
        break;
      }
      if (k === Math.min(candles.length - 1, i + 36)) {
        outcome = tp1Hit ? 'TP1_HIT' : 'EXPIRED';
        exitPrice = bar.close;
        pnlR = (isLong ? bar.close - entryPrice : entryPrice - bar.close) / riskDist;
        exitIdx = k;
      }
    }

    const holdingMinutes = Math.max(
      5,
      Math.round((candles[exitIdx].closeTime - entryCandle.openTime) / 60000)
    );
    // Approximate 8h funding cost (1 bps per 8h)
    const fundingCostUsd = positionNotional * 0.0001 * (holdingMinutes / 480);
    const grossPnlUsd = pnlR * riskUsd;
    const netTradePnlUsd = grossPnlUsd - feesUsd - fundingCostUsd;
    const netPnlR = netTradePnlUsd / Math.max(riskUsd, 1e-9);

    equity = Math.max(10, equity + netTradePnlUsd);
    if (equity > peakEquity) peakEquity = equity;
    const ddPct = peakEquity > 0 ? ((peakEquity - equity) / peakEquity) * 100 : 0;
    if (ddPct > maxDrawdownPct) maxDrawdownPct = ddPct;

    tradesLog.push({
      entryTime: new Date(entryCandle.openTime).toISOString(),
      exitTime: new Date(candles[exitIdx].closeTime).toISOString(),
      direction: bestDir,
      entryType: 'MARKET',
      score,
      entryPrice: Number(entryPrice.toFixed(6)),
      stopLoss: Number(stopLoss.toFixed(6)),
      tp1: Number(tp1.toFixed(6)),
      tp2: Number(tp2.toFixed(6)),
      tp3: Number(tp3.toFixed(6)),
      exitPrice: Number(exitPrice.toFixed(6)),
      outcome,
      pnlR: Number(netPnlR.toFixed(2)),
      pnlUsd: Number(netTradePnlUsd.toFixed(2)),
      feesUsd: Number((feesUsd + fundingCostUsd).toFixed(2)),
      holdingMinutes,
      ambiguousBar,
    });

    equityCurve.push({
      time: new Date(candles[exitIdx].closeTime).toISOString(),
      equity: Number(equity.toFixed(2)),
    });

    i = exitIdx + 1;
  }

  const wins = tradesLog.filter((t) => t.pnlUsd > 0).length;
  const losses = tradesLog.filter((t) => t.pnlUsd <= 0).length;
  const totalTrades = tradesLog.length;
  const grossProfit = tradesLog.filter((t) => t.pnlUsd > 0).reduce((s, t) => s + t.pnlUsd, 0);
  const grossLoss = Math.abs(tradesLog.filter((t) => t.pnlUsd < 0).reduce((s, t) => s + t.pnlUsd, 0));
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 9.99 : 0;
  const averageR =
    totalTrades > 0 ? tradesLog.reduce((s, t) => s + t.pnlR, 0) / totalTrades : 0;
  const winRatePct = totalTrades > 0 ? (wins / totalTrades) * 100 : 0;
  const avgWinR = wins > 0 ? tradesLog.filter((t) => t.pnlUsd > 0).reduce((s, t) => s + t.pnlR, 0) / wins : 0;
  const avgLossR =
    losses > 0
      ? Math.abs(tradesLog.filter((t) => t.pnlUsd <= 0).reduce((s, t) => s + t.pnlR, 0)) / losses
      : 0;
  const expectancyR = (winRatePct / 100) * avgWinR - (1 - winRatePct / 100) * avgLossR;
  const avgHoldingMinutes =
    totalTrades > 0
      ? tradesLog.reduce((s, t) => s + t.holdingMinutes, 0) / totalTrades
      : 0;

  return {
    symbol: config.symbol,
    timeframe: config.timeframe,
    splitMode: config.splitMode,
    startDate: new Date(candles[0].openTime).toISOString(),
    endDate: new Date(candles[candles.length - 1].closeTime).toISOString(),
    candlesAnalyzed: candles.length,
    initialEquity: config.initialEquity,
    finalEquity: Number(equity.toFixed(2)),
    netPnlUsd: Number((equity - config.initialEquity).toFixed(2)),
    totalTrades,
    wins,
    losses,
    winRatePct: Number(winRatePct.toFixed(1)),
    profitFactor: Number(profitFactor.toFixed(2)),
    expectancyR: Number(expectancyR.toFixed(3)),
    averageR: Number(averageR.toFixed(2)),
    maxDrawdownPct: Number(maxDrawdownPct.toFixed(2)),
    avgHoldingMinutes: Math.round(avgHoldingMinutes),
    equityCurve,
    tradesLog,
  };
}
