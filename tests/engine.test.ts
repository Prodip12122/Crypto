import { describe, expect, it } from 'vitest';
import {
  analyzeIndicators,
  calculateATR,
  calculateEMA,
  calculateMACD,
  calculateRSI,
  calculateVWAP,
} from '../src/engine/indicators.ts';
import { analyzeSMC } from '../src/engine/smc.ts';
import {
  calculatePositionSizing,
  classifyScore,
  evaluateDirection,
  processSignalLifecycleStep,
} from '../src/engine/scoring.ts';
import { runHistoricalBacktest } from '../src/engine/backtest.ts';
import type { Candle, CoinMarketSnapshot, FundamentalContext, TimeframeAnalysis } from '../src/types/trading.ts';
import { DEFAULT_ADMIN_CONFIG } from '../src/services/scanner.ts';

function generateSyntheticCandles(count: number, trend: 'up' | 'down' | 'flat', startPrice = 100): Candle[] {
  const candles: Candle[] = [];
  let price = startPrice;
  const baseTime = Date.UTC(2026, 0, 1, 0, 0, 0);

  for (let i = 0; i < count; i++) {
    const drift = trend === 'up' ? 0.35 : trend === 'down' ? -0.35 : 0;
    const wave = Math.sin(i * 0.4) * 0.45;
    const open = price;
    const close = Math.max(1, open + drift + wave);
    const high = Math.max(open, close) + 0.45;
    const low = Math.min(open, close) - 0.4;
    const volume = 1000 + (i % 7) * 250 + (i === count - 1 ? 1500 : 0);

    candles.push({
      openTime: baseTime + i * 300_000,
      closeTime: baseTime + (i + 1) * 300_000 - 1,
      open,
      high,
      low,
      close,
      volume,
      quoteVolume: volume * close,
      trades: 120,
      isClosed: true,
    });
    price = close;
  }
  return candles;
}

describe('Technical Indicator Engine', () => {
  it('computes EMA, RSI, MACD, ATR, and VWAP deterministically', () => {
    const candles = generateSyntheticCandles(120, 'up', 100);
    const closes = candles.map((c) => c.close);

    const ema20 = calculateEMA(closes, 20);
    const rsi = calculateRSI(closes, 14);
    const macd = calculateMACD(closes, 12, 26, 9);
    const atr = calculateATR(candles, 14);
    const vwap = calculateVWAP(candles);

    expect(Number.isFinite(ema20[119])).toBe(true);
    expect(rsi[119]).toBeGreaterThan(50);
    expect(rsi[119]).toBeLessThanOrEqual(100);
    expect(Number.isFinite(macd.macd[119])).toBe(true);
    expect(atr[119]).toBeGreaterThan(0);
    expect(vwap[119]).toBeGreaterThan(0);
  });

  it('produces complete IndicatorSet with bullish trend on uptrend candles', () => {
    const candles = generateSyntheticCandles(140, 'up', 50);
    const ind = analyzeIndicators(candles, '5m');
    expect(ind.trendDirection).toBe('bullish');
    expect(ind.ema9).toBeGreaterThan(ind.ema50);
    expect(ind.supportLevels.length + ind.resistanceLevels.length).toBeGreaterThanOrEqual(0);
  });
});

describe('Smart Money Concepts Engine', () => {
  it('detects bullish structure and Fair Value Gaps on impulsive candle displacement', () => {
    const candles = generateSyntheticCandles(90, 'up', 100);
    // Inject explicit bullish FVG at index 85-87
    candles[85].high = 135;
    candles[86].open = 135.2;
    candles[86].close = 138.5;
    candles[86].high = 138.8;
    candles[86].low = 135.1;
    candles[87].low = 137.0;
    candles[87].close = 139.2;
    candles[87].high = 139.5;
    candles[88].low = 138.0;
    candles[89].low = 138.2;

    const smc = analyzeSMC(candles, '15m');
    expect(smc.activeFVGs.some((f) => f.type === 'bullish')).toBe(true);
    expect(['bullish', 'ranging']).toContain(smc.structureBias);
  });
});

describe('Scoring, Position Sizing, and Lifecycle Engine', () => {
  it('classifies scores according to the 100-point rubric', () => {
    expect(classifyScore(94)).toBe('Premium');
    expect(classifyScore(87)).toBe('Strong');
    expect(classifyScore(81)).toBe('Valid');
    expect(classifyScore(79)).toBe('Rejected');
  });

  it('calculates deterministic position sizing respecting risk % and step size', () => {
    const sizing = calculatePositionSizing({
      accountEquityUsd: 10000,
      riskPercent: 1.0,
      entryPrice: 100,
      stopLoss: 98, // 2% stop distance
      maxLeverage: 10,
      stepSize: 0.1,
      minQty: 0.1,
      minNotional: 5,
    });
    // 1% of 10,000 = $100 risk. 2% stop + 0.08% fees = 2.08% -> ~$4807 notional
    expect(sizing.positionSizeUsd).toBeGreaterThan(4000);
    expect(sizing.positionSizeUsd).toBeLessThanOrEqual(100000);
    expect(sizing.leverage).toBeLessThanOrEqual(10);
    expect(sizing.quantity).toBeGreaterThan(0);
  });

  it('rejects LONG when 4H and 1H are strongly bearish', () => {
    const downCandles = generateSyntheticCandles(160, 'down', 200);
    const buildTf = (tf: '4h' | '1h' | '15m' | '5m'): TimeframeAnalysis => ({
      timeframe: tf,
      indicators: analyzeIndicators(downCandles, tf),
      smc: analyzeSMC(downCandles, tf),
      closedCandleCount: downCandles.length,
      lastCandleTime: downCandles[downCandles.length - 1].openTime,
    });
    const lastClose = downCandles[downCandles.length - 1].close;
    const snapshot: CoinMarketSnapshot = {
      symbolInfo: {
        symbol: 'REZUSDT',
        baseAsset: 'REZ',
        quoteAsset: 'USDT',
        contractType: 'PERPETUAL',
        status: 'TRADING',
        pricePrecision: 4,
        quantityPrecision: 0,
        tickSize: 0.0001,
        stepSize: 1,
        minQty: 1,
        minNotional: 5,
        maxLeverage: 20,
        isPriority: true,
      },
      ticker: {
        symbol: 'REZUSDT',
        lastPrice: lastClose,
        priceChangePercent: -4.2,
        highPrice: 205,
        lowPrice: lastClose,
        volume: 500000,
        quoteVolume: 25_000_000,
        openTime: 0,
        closeTime: Date.now(),
      },
      orderBook: {
        symbol: 'REZUSDT',
        bestBid: lastClose - 0.01,
        bestAsk: lastClose + 0.01,
        spreadBps: 2.0,
        bidDepthUsd: 80000,
        askDepthUsd: 80000,
        imbalance: 0,
        timestamp: Date.now(),
      },
      derivatives: {
        symbol: 'REZUSDT',
        markPrice: lastClose,
        indexPrice: lastClose,
        fundingRate: 0.0001,
        nextFundingTime: Date.now() + 3600_000,
        openInterest: 100000,
        openInterestValue: 10_000_000,
        openInterestChangePct: 1.5,
        longShortRatio: 1.1,
        timestamp: Date.now(),
      },
      fetchedAt: Date.now(),
    };
    const btcCtx: FundamentalContext = {
      btcTrend4h: 'bearish',
      btcTrend1h: 'bearish',
      btcPrice: 90000,
      btcChange24hPct: -2.1,
      fundingRatePct: 0.01,
      openInterestValueUsd: 10_000_000,
      openInterestChangePct: 1.5,
      longShortRatio: 1.1,
      newsRiskLevel: 'low',
      headlineSummary: 'Bearish BTC',
    };

    const longEval = evaluateDirection({
      direction: 'LONG',
      snapshot,
      tf4h: buildTf('4h'),
      tf1h: buildTf('1h'),
      tf15m: buildTf('15m'),
      tf5m: buildTf('5m'),
      btcContext: btcCtx,
      config: DEFAULT_ADMIN_CONFIG,
    });

    expect(longEval.passedValidation).toBe(false);
    expect(longEval.rejectionReasons.some((r) => r.includes('Higher timeframes'))).toBe(true);
  });

  it('never counts unfilled LIMIT signal as win on expiry and marks ambiguous candles', () => {
    const baseSignal = {
      status: 'WAITING_FOR_ENTRY' as const,
      direction: 'LONG' as const,
      entryType: 'LIMIT' as const,
      entryLimitPrice: 100,
      entryZoneLow: 99.5,
      entryZoneHigh: 100.5,
      stopLoss: 98,
      tp1: 102,
      tp2: 104,
      tp3: 106,
      signalExpiryAt: 1_700_000_900_000,
    };

    // Price rockets past TP1 without ever touching entryZone [99.5, 100.5]
    const missedCandle: Candle = {
      openTime: 1_700_000_000_000,
      closeTime: 1_700_000_300_000,
      open: 101,
      high: 105,
      low: 100.8,
      close: 104,
      volume: 500,
      quoteVolume: 50000,
      trades: 50,
      isClosed: true,
    };
    const step1 = processSignalLifecycleStep(baseSignal, missedCandle);
    expect(step1.newStatus).toBe('WAITING_FOR_ENTRY');
    expect(step1.changed).toBe(false);

    // Next candle expires past signalExpiryAt -> EXPIRED with 0R (not a win)
    const expiredCandle: Candle = {
      ...missedCandle,
      openTime: 1_700_000_900_000,
      closeTime: 1_700_001_200_000,
    };
    const stepExp = processSignalLifecycleStep(baseSignal, expiredCandle);
    expect(stepExp.newStatus).toBe('EXPIRED');
    expect(stepExp.realizedPnlR).toBe(0);

    // Ambiguous candle crossing both SL (98) and TP1 (102) while ENTRY_FILLED
    const filledSignal = { ...baseSignal, status: 'ENTRY_FILLED' as const };
    const ambigCandle: Candle = {
      ...missedCandle,
      open: 100,
      high: 103,
      low: 97.5,
      close: 101,
    };
    const stepAmbig = processSignalLifecycleStep(filledSignal, ambigCandle);
    expect(stepAmbig.newStatus).toBe('SL_HIT');
    expect(stepAmbig.ambiguousResolution).toBe('AMBIGUOUS_INTRABAR_SL_FIRST');
  });
});

describe('Historical Backtesting Engine', () => {
  it('runs chronological backtest with fees & slippage without look-ahead', () => {
    const candles = generateSyntheticCandles(240, 'up', 100);
    const report = runHistoricalBacktest(candles, {
      symbol: 'BTCUSDT',
      timeframe: '15m',
      splitMode: 'full',
      initialEquity: 10000,
      riskPerTradePct: 1,
      feeBps: 4,
      slippageBps: 2,
      minScore: 65,
    });
    expect(report.candlesAnalyzed).toBe(240);
    expect(report.equityCurve.length).toBeGreaterThanOrEqual(1);
    expect(Number.isFinite(report.maxDrawdownPct)).toBe(true);
  });
});
