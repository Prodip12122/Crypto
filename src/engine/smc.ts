import type {
  Candle,
  FairValueGap,
  LiquiditySweep,
  OrderBlock,
  SMCAnalysis,
  SwingPoint,
  Timeframe,
} from '../types/trading.ts';
import { calculateATR } from './indicators.ts';

function detectSwingPoints(candles: Candle[], left = 3, right = 3): SwingPoint[] {
  const rawSwings: SwingPoint[] = [];
  for (let i = left; i < candles.length - right; i++) {
    let isHigh = true;
    let isLow = true;
    for (let j = i - left; j <= i + right; j++) {
      if (j === i) continue;
      if (candles[j].high >= candles[i].high) isHigh = false;
      if (candles[j].low <= candles[i].low) isLow = false;
    }
    if (isHigh) {
      rawSwings.push({
        index: i,
        time: candles[i].openTime,
        price: candles[i].high,
        type: 'HIGH',
      });
    }
    if (isLow) {
      rawSwings.push({
        index: i,
        time: candles[i].openTime,
        price: candles[i].low,
        type: 'LOW',
      });
    }
  }

  // Classify HH/LH and HL/LL
  let prevHigh: number | null = null;
  let prevLow: number | null = null;
  for (const s of rawSwings) {
    if (s.type === 'HIGH') {
      if (prevHigh !== null) {
        s.type = s.price > prevHigh ? 'HH' : 'LH';
      }
      prevHigh = s.price;
    } else if (s.type === 'LOW') {
      if (prevLow !== null) {
        s.type = s.price > prevLow ? 'HL' : 'LL';
      }
      prevLow = s.price;
    }
  }
  return rawSwings;
}

export function analyzeSMC(rawCandles: Candle[], timeframe: Timeframe): SMCAnalysis {
  const closed = rawCandles.filter((c) => c.isClosed);
  const candles = closed.length >= 40 ? closed : rawCandles;
  const atrArr = calculateATR(candles, 14);
  const lastCandle = candles[candles.length - 1];
  const currentAtr =
    Number.isFinite(atrArr[candles.length - 1]) && atrArr[candles.length - 1] > 0
      ? atrArr[candles.length - 1]
      : lastCandle.close * 0.005;

  const swings = detectSwingPoints(candles, 3, 3);
  const highSwings = swings.filter((s) => s.type === 'HH' || s.type === 'LH' || s.type === 'HIGH');
  const lowSwings = swings.filter((s) => s.type === 'HL' || s.type === 'LL' || s.type === 'LOW');

  const lastStructureSequence = swings
    .filter((s) => s.type !== 'HIGH' && s.type !== 'LOW')
    .slice(-6)
    .map((s) => s.type);

  // Determine structural bias from recent sequence
  const recentTypes = lastStructureSequence.slice(-4);
  const bullCount = recentTypes.filter((t) => t === 'HH' || t === 'HL').length;
  const bearCount = recentTypes.filter((t) => t === 'LH' || t === 'LL').length;
  let structureBias: SMCAnalysis['structureBias'] = 'ranging';
  if (bullCount >= 3) structureBias = 'bullish';
  else if (bearCount >= 3) structureBias = 'bearish';
  else if (bullCount > bearCount && recentTypes[recentTypes.length - 1] === 'HH') structureBias = 'bullish';
  else if (bearCount > bullCount && recentTypes[recentTypes.length - 1] === 'LL') structureBias = 'bearish';

  // BOS & CHoCH detection using closed candle body closes beyond validated swings
  const bosEvents: SMCAnalysis['bosEvents'] = [];
  const chochEvents: SMCAnalysis['chochEvents'] = [];

  let runningBias: 'bullish' | 'bearish' | 'neutral' = 'neutral';
  let lastSwingHigh: SwingPoint | null = null;
  let lastSwingLow: SwingPoint | null = null;
  const brokenHighIndices = new Set<number>();
  const brokenLowIndices = new Set<number>();

  for (let i = 0; i < candles.length; i++) {
    const confirmedHigh = highSwings.find((s) => s.index + 3 === i);
    if (confirmedHigh) lastSwingHigh = confirmedHigh;
    const confirmedLow = lowSwings.find((s) => s.index + 3 === i);
    if (confirmedLow) lastSwingLow = confirmedLow;

    const c = candles[i];
    if (lastSwingHigh && !brokenHighIndices.has(lastSwingHigh.index) && c.close > lastSwingHigh.price) {
      brokenHighIndices.add(lastSwingHigh.index);
      if (runningBias === 'bearish') {
        chochEvents.push({ direction: 'bullish', price: lastSwingHigh.price, time: c.openTime });
      } else {
        bosEvents.push({ direction: 'bullish', price: lastSwingHigh.price, time: c.openTime });
      }
      runningBias = 'bullish';
    }
    if (lastSwingLow && !brokenLowIndices.has(lastSwingLow.index) && c.close < lastSwingLow.price) {
      brokenLowIndices.add(lastSwingLow.index);
      if (runningBias === 'bullish') {
        chochEvents.push({ direction: 'bearish', price: lastSwingLow.price, time: c.openTime });
      } else {
        bosEvents.push({ direction: 'bearish', price: lastSwingLow.price, time: c.openTime });
      }
      runningBias = 'bearish';
    }
  }

  // Fair Value Gaps (3-candle imbalance with >= 0.15 * ATR gap)
  const fvgs: FairValueGap[] = [];
  const lookbackStart = Math.max(2, candles.length - 80);
  for (let i = lookbackStart; i < candles.length; i++) {
    const c0 = candles[i - 2];
    const c2 = candles[i];
    const localAtr = Number.isFinite(atrArr[i]) ? atrArr[i] : currentAtr;

    if (c2.low > c0.high) {
      const gap = c2.low - c0.high;
      if (gap >= localAtr * 0.15) {
        let mitigated = false;
        for (let k = i + 1; k < candles.length; k++) {
          if (candles[k].low <= c0.high + gap * 0.5) {
            mitigated = true;
            break;
          }
        }
        if (!mitigated) {
          fvgs.push({
            type: 'bullish',
            bottom: c0.high,
            top: c2.low,
            candleTime: candles[i - 1].openTime,
            mitigated,
            sizeAtrRatio: Number((gap / localAtr).toFixed(2)),
          });
        }
      }
    }

    if (c2.high < c0.low) {
      const gap = c0.low - c2.high;
      if (gap >= localAtr * 0.15) {
        let mitigated = false;
        for (let k = i + 1; k < candles.length; k++) {
          if (candles[k].high >= c0.low - gap * 0.5) {
            mitigated = true;
            break;
          }
        }
        if (!mitigated) {
          fvgs.push({
            type: 'bearish',
            bottom: c2.high,
            top: c0.low,
            candleTime: candles[i - 1].openTime,
            mitigated,
            sizeAtrRatio: Number((gap / localAtr).toFixed(2)),
          });
        }
      }
    }
  }

  // Order Blocks: last opposite-colored candle before an impulsive displacement (>= 1.2 * ATR)
  const orderBlocks: OrderBlock[] = [];
  for (let i = lookbackStart; i < candles.length - 2; i++) {
    const c = candles[i];
    const next1 = candles[i + 1];
    const next2 = candles[i + 2];
    const localAtr = Number.isFinite(atrArr[i]) ? atrArr[i] : currentAtr;

    // Bullish OB: bearish candle followed by strong bullish expansion
    if (c.close < c.open && next1.close > next1.open) {
      const impulse = Math.max(next1.close, next2.close) - c.low;
      if (impulse >= localAtr * 1.2 && next1.close > c.high) {
        let mitigated = false;
        for (let k = i + 2; k < candles.length; k++) {
          if (candles[k].close < c.low) {
            mitigated = true;
            break;
          }
        }
        if (!mitigated) {
          orderBlocks.push({
            type: 'bullish',
            high: c.high,
            low: c.low,
            candleTime: c.openTime,
            mitigated,
            displacementAtrRatio: Number((impulse / localAtr).toFixed(2)),
          });
        }
      }
    }

    // Bearish OB: bullish candle followed by strong bearish expansion
    if (c.close > c.open && next1.close < next1.open) {
      const impulse = c.high - Math.min(next1.close, next2.close);
      if (impulse >= localAtr * 1.2 && next1.close < c.low) {
        let mitigated = false;
        for (let k = i + 2; k < candles.length; k++) {
          if (candles[k].close > c.high) {
            mitigated = true;
            break;
          }
        }
        if (!mitigated) {
          orderBlocks.push({
            type: 'bearish',
            high: c.high,
            low: c.low,
            candleTime: c.openTime,
            mitigated,
            displacementAtrRatio: Number((impulse / localAtr).toFixed(2)),
          });
        }
      }
    }
  }

  // Equal Highs & Equal Lows (within 0.15% tolerance)
  const equalHighs: number[] = [];
  const equalLows: number[] = [];
  const recentHighs = highSwings.slice(-8);
  for (let i = 0; i < recentHighs.length; i++) {
    for (let j = i + 1; j < recentHighs.length; j++) {
      const diffPct = Math.abs(recentHighs[i].price - recentHighs[j].price) / recentHighs[i].price;
      if (diffPct <= 0.0015) {
        equalHighs.push((recentHighs[i].price + recentHighs[j].price) / 2);
      }
    }
  }
  const recentLows = lowSwings.slice(-8);
  for (let i = 0; i < recentLows.length; i++) {
    for (let j = i + 1; j < recentLows.length; j++) {
      const diffPct = Math.abs(recentLows[i].price - recentLows[j].price) / recentLows[i].price;
      if (diffPct <= 0.0015) {
        equalLows.push((recentLows[i].price + recentLows[j].price) / 2);
      }
    }
  }

  // Liquidity Sweeps in last 12 candles
  const recentSweeps: LiquiditySweep[] = [];
  const sweepStart = Math.max(10, candles.length - 12);
  for (let i = sweepStart; i < candles.length; i++) {
    const c = candles[i];
    const priorHigh = highSwings
      .filter((s) => s.index < i - 3 && s.index >= i - 50)
      .sort((a, b) => b.price - a.price)[0];
    if (priorHigh && c.high > priorHigh.price && c.close < priorHigh.price) {
      recentSweeps.push({
        type: 'buy_side_sweep',
        sweptLevel: priorHigh.price,
        wickPrice: c.high,
        closePrice: c.close,
        candleTime: c.openTime,
      });
    }

    const priorLow = lowSwings
      .filter((s) => s.index < i - 3 && s.index >= i - 50)
      .sort((a, b) => a.price - b.price)[0];
    if (priorLow && c.low < priorLow.price && c.close > priorLow.price) {
      recentSweeps.push({
        type: 'sell_side_sweep',
        sweptLevel: priorLow.price,
        wickPrice: c.low,
        closePrice: c.close,
        candleTime: c.openTime,
      });
    }
  }

  const currentPrice = lastCandle.close;
  const bullZones = [
    ...orderBlocks
      .filter((ob) => ob.type === 'bullish' && ob.high <= currentPrice * 1.004)
      .map((ob) => ({ low: ob.low, high: ob.high, source: 'Bullish Order Block' })),
    ...fvgs
      .filter((f) => f.type === 'bullish' && f.top <= currentPrice * 1.004)
      .map((f) => ({ low: f.bottom, high: f.top, source: 'Bullish FVG' })),
  ].sort((a, b) => Math.abs(currentPrice - a.high) - Math.abs(currentPrice - b.high));

  const bearZones = [
    ...orderBlocks
      .filter((ob) => ob.type === 'bearish' && ob.low >= currentPrice * 0.996)
      .map((ob) => ({ low: ob.low, high: ob.high, source: 'Bearish Order Block' })),
    ...fvgs
      .filter((f) => f.type === 'bearish' && f.bottom >= currentPrice * 0.996)
      .map((f) => ({ low: f.bottom, high: f.top, source: 'Bearish FVG' })),
  ].sort((a, b) => Math.abs(a.low - currentPrice) - Math.abs(b.low - currentPrice));

  return {
    timeframe,
    structureBias,
    lastStructureSequence,
    bosEvents: bosEvents.slice(-5),
    chochEvents: chochEvents.slice(-5),
    activeFVGs: fvgs.slice(-6),
    activeOrderBlocks: orderBlocks.slice(-6),
    recentSweeps: recentSweeps.slice(-4),
    equalHighs: equalHighs.slice(-3),
    equalLows: equalLows.slice(-3),
    nearestBullishZone: bullZones[0] ?? null,
    nearestBearishZone: bearZones[0] ?? null,
  };
}
