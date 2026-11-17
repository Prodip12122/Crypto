import type {
  Candle,
  FibonacciLevels,
  IndicatorSet,
  SupportResistanceLevel,
  Timeframe,
} from '../types/trading.ts';

export function calculateSMA(values: number[], period: number): number[] {
  const result: number[] = new Array(values.length).fill(NaN);
  if (values.length < period || period <= 0) return result;
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) {
      sum -= values[i - period];
    }
    if (i >= period - 1) {
      result[i] = sum / period;
    }
  }
  return result;
}

export function calculateEMA(values: number[], period: number): number[] {
  const result: number[] = new Array(values.length).fill(NaN);
  if (values.length < period || period <= 0) return result;

  let seedSum = 0;
  for (let i = 0; i < period; i++) {
    seedSum += values[i];
  }
  const k = 2 / (period + 1);
  let ema = seedSum / period;
  result[period - 1] = ema;

  for (let i = period; i < values.length; i++) {
    ema = values[i] * k + ema * (1 - k);
    result[i] = ema;
  }
  return result;
}

export function calculateRSI(closes: number[], period = 14): number[] {
  const result: number[] = new Array(closes.length).fill(NaN);
  if (closes.length <= period) return result;

  let gainSum = 0;
  let lossSum = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gainSum += diff;
    else lossSum += Math.abs(diff);
  }

  let avgGain = gainSum / period;
  let avgLoss = lossSum / period;
  result[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? Math.abs(diff) : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    result[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return result;
}

export function calculateMACD(
  closes: number[],
  fastPeriod = 12,
  slowPeriod = 26,
  signalPeriod = 9
): { macd: number[]; signal: number[]; histogram: number[] } {
  const emaFast = calculateEMA(closes, fastPeriod);
  const emaSlow = calculateEMA(closes, slowPeriod);
  const macdLine = closes.map((_, i) =>
    Number.isFinite(emaFast[i]) && Number.isFinite(emaSlow[i]) ? emaFast[i] - emaSlow[i] : NaN
  );

  const validStart = macdLine.findIndex((v) => Number.isFinite(v));
  const signalLine: number[] = new Array(closes.length).fill(NaN);
  if (validStart !== -1) {
    const validMacd = macdLine.slice(validStart);
    const sigSlice = calculateEMA(validMacd, signalPeriod);
    for (let i = 0; i < sigSlice.length; i++) {
      signalLine[validStart + i] = sigSlice[i];
    }
  }

  const histogram = macdLine.map((m, i) =>
    Number.isFinite(m) && Number.isFinite(signalLine[i]) ? m - signalLine[i] : NaN
  );

  return { macd: macdLine, signal: signalLine, histogram };
}

export function calculateATR(candles: Candle[], period = 14): number[] {
  const result: number[] = new Array(candles.length).fill(NaN);
  if (candles.length <= period) return result;

  const tr: number[] = new Array(candles.length).fill(0);
  tr[0] = candles[0].high - candles[0].low;
  for (let i = 1; i < candles.length; i++) {
    const hl = candles[i].high - candles[i].low;
    const hc = Math.abs(candles[i].high - candles[i - 1].close);
    const lc = Math.abs(candles[i].low - candles[i - 1].close);
    tr[i] = Math.max(hl, hc, lc);
  }

  let atrSum = 0;
  for (let i = 1; i <= period; i++) {
    atrSum += tr[i];
  }
  let atr = atrSum / period;
  result[period] = atr;

  for (let i = period + 1; i < candles.length; i++) {
    atr = (atr * (period - 1) + tr[i]) / period;
    result[i] = atr;
  }
  return result;
}

export function calculateADX(
  candles: Candle[],
  period = 14
): { adx: number[]; plusDI: number[]; minusDI: number[] } {
  const len = candles.length;
  const adx = new Array(len).fill(NaN);
  const plusDI = new Array(len).fill(NaN);
  const minusDI = new Array(len).fill(NaN);
  if (len <= period * 2) return { adx, plusDI, minusDI };

  const tr = new Array(len).fill(0);
  const plusDM = new Array(len).fill(0);
  const minusDM = new Array(len).fill(0);

  for (let i = 1; i < len; i++) {
    const upMove = candles[i].high - candles[i - 1].high;
    const downMove = candles[i - 1].low - candles[i].low;
    plusDM[i] = upMove > downMove && upMove > 0 ? upMove : 0;
    minusDM[i] = downMove > upMove && downMove > 0 ? downMove : 0;
    tr[i] = Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - candles[i - 1].close),
      Math.abs(candles[i].low - candles[i - 1].close)
    );
  }

  let smTR = 0;
  let smPlusDM = 0;
  let smMinusDM = 0;
  for (let i = 1; i <= period; i++) {
    smTR += tr[i];
    smPlusDM += plusDM[i];
    smMinusDM += minusDM[i];
  }

  const dxArr = new Array(len).fill(NaN);
  for (let i = period; i < len; i++) {
    if (i > period) {
      smTR = smTR - smTR / period + tr[i];
      smPlusDM = smPlusDM - smPlusDM / period + plusDM[i];
      smMinusDM = smMinusDM - smMinusDM / period + minusDM[i];
    }
    const pdi = smTR === 0 ? 0 : (100 * smPlusDM) / smTR;
    const mdi = smTR === 0 ? 0 : (100 * smMinusDM) / smTR;
    plusDI[i] = pdi;
    minusDI[i] = mdi;
    const diSum = pdi + mdi;
    dxArr[i] = diSum === 0 ? 0 : (100 * Math.abs(pdi - mdi)) / diSum;
  }

  let adxSum = 0;
  for (let i = period; i < period * 2; i++) {
    adxSum += dxArr[i];
  }
  let adxVal = adxSum / period;
  adx[period * 2 - 1] = adxVal;

  for (let i = period * 2; i < len; i++) {
    adxVal = (adxVal * (period - 1) + dxArr[i]) / period;
    adx[i] = adxVal;
  }

  return { adx, plusDI, minusDI };
}

export function calculateBollingerBands(
  closes: number[],
  period = 20,
  stdDevMult = 2
): { upper: number[]; middle: number[]; lower: number[] } {
  const middle = calculateSMA(closes, period);
  const upper = new Array(closes.length).fill(NaN);
  const lower = new Array(closes.length).fill(NaN);

  for (let i = period - 1; i < closes.length; i++) {
    const mean = middle[i];
    let variance = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const diff = closes[j] - mean;
      variance += diff * diff;
    }
    const stdDev = Math.sqrt(variance / period);
    upper[i] = mean + stdDevMult * stdDev;
    lower[i] = mean - stdDevMult * stdDev;
  }

  return { upper, middle, lower };
}

export function calculateVWAP(candles: Candle[]): number[] {
  const result: number[] = new Array(candles.length).fill(NaN);
  let cumPV = 0;
  let cumVol = 0;
  let currentDay = '';

  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const dayStr = new Date(c.openTime).toISOString().slice(0, 10);
    if (dayStr !== currentDay) {
      cumPV = 0;
      cumVol = 0;
      currentDay = dayStr;
    }
    const typicalPrice = (c.high + c.low + c.close) / 3;
    cumPV += typicalPrice * c.volume;
    cumVol += c.volume;
    result[i] = cumVol > 0 ? cumPV / cumVol : c.close;
  }

  return result;
}

export function calculateOBV(candles: Candle[]): number[] {
  const obv: number[] = new Array(candles.length).fill(0);
  if (candles.length === 0) return obv;
  obv[0] = candles[0].volume;
  for (let i = 1; i < candles.length; i++) {
    if (candles[i].close > candles[i - 1].close) {
      obv[i] = obv[i - 1] + candles[i].volume;
    } else if (candles[i].close < candles[i - 1].close) {
      obv[i] = obv[i - 1] - candles[i].volume;
    } else {
      obv[i] = obv[i - 1];
    }
  }
  return obv;
}

export function calculateFibonacciLevels(candles: Candle[], lookback = 60): FibonacciLevels {
  const slice = candles.slice(-Math.min(lookback, candles.length));
  let high = -Infinity;
  let low = Infinity;
  let highIdx = 0;
  let lowIdx = 0;

  for (let i = 0; i < slice.length; i++) {
    if (slice[i].high > high) {
      high = slice[i].high;
      highIdx = i;
    }
    if (slice[i].low < low) {
      low = slice[i].low;
      lowIdx = i;
    }
  }

  const range = Math.max(high - low, 1e-12);
  const trend: 'up' | 'down' = highIdx >= lowIdx ? 'up' : 'down';

  if (trend === 'up') {
    return {
      swingHigh: high,
      swingLow: low,
      trend,
      level236: high - range * 0.236,
      level382: high - range * 0.382,
      level500: high - range * 0.5,
      level618: high - range * 0.618,
      level786: high - range * 0.786,
    };
  }
  return {
    swingHigh: high,
    swingLow: low,
    trend,
    level236: low + range * 0.236,
    level382: low + range * 0.382,
    level500: low + range * 0.5,
    level618: low + range * 0.618,
    level786: low + range * 0.786,
  };
}

export function detectSupportResistance(
  candles: Candle[],
  atr: number
): { supportLevels: SupportResistanceLevel[]; resistanceLevels: SupportResistanceLevel[] } {
  const lookback = candles.slice(-120);
  const currentPrice = lookback[lookback.length - 1]?.close ?? 0;
  const clusterTolerance = Math.max(atr * 0.65, currentPrice * 0.0025);

  const pivots: number[] = [];
  for (let i = 2; i < lookback.length - 2; i++) {
    const isSwingHigh =
      lookback[i].high > lookback[i - 1].high &&
      lookback[i].high > lookback[i - 2].high &&
      lookback[i].high >= lookback[i + 1].high &&
      lookback[i].high >= lookback[i + 2].high;
    const isSwingLow =
      lookback[i].low < lookback[i - 1].low &&
      lookback[i].low < lookback[i - 2].low &&
      lookback[i].low <= lookback[i + 1].low &&
      lookback[i].low <= lookback[i + 2].low;
    if (isSwingHigh) pivots.push(lookback[i].high);
    if (isSwingLow) pivots.push(lookback[i].low);
  }

  const clusters: Array<{ sum: number; count: number }> = [];
  for (const p of pivots) {
    const found = clusters.find((c) => Math.abs(c.sum / c.count - p) <= clusterTolerance);
    if (found) {
      found.sum += p;
      found.count += 1;
    } else {
      clusters.push({ sum: p, count: 1 });
    }
  }

  const supportLevels: SupportResistanceLevel[] = [];
  const resistanceLevels: SupportResistanceLevel[] = [];

  for (const c of clusters) {
    const level = c.sum / c.count;
    const strength = Math.min(10, c.count * 2 + 1);
    if (level <= currentPrice) {
      supportLevels.push({ price: level, type: 'support', touches: c.count, strength });
    } else {
      resistanceLevels.push({ price: level, type: 'resistance', touches: c.count, strength });
    }
  }

  supportLevels.sort((a, b) => b.price - a.price);
  resistanceLevels.sort((a, b) => a.price - b.price);

  return {
    supportLevels: supportLevels.slice(0, 4),
    resistanceLevels: resistanceLevels.slice(0, 4),
  };
}

export function analyzeIndicators(rawCandles: Candle[], timeframe: Timeframe): IndicatorSet {
  // Enforce closed candles for signal confirmation
  const closed = rawCandles.filter((c) => c.isClosed);
  const candles = closed.length >= 50 ? closed : rawCandles;
  if (candles.length < 30) {
    throw new Error(`Insufficient closed candles (${candles.length}) for ${timeframe} technical analysis.`);
  }

  const closes = candles.map((c) => c.close);
  const volumes = candles.map((c) => c.volume);
  const lastIdx = candles.length - 1;
  const lastCandle = candles[lastIdx];
  const prevCandle = candles[lastIdx - 1];

  const ema9Arr = calculateEMA(closes, 9);
  const ema20Arr = calculateEMA(closes, 20);
  const ema50Arr = calculateEMA(closes, 50);
  const ema100Arr = calculateEMA(closes, Math.min(100, candles.length));
  const ema200Arr = calculateEMA(closes, Math.min(200, candles.length));
  const rsiArr = calculateRSI(closes, 14);
  const macdRes = calculateMACD(closes, 12, 26, 9);
  const adxRes = calculateADX(candles, 14);
  const atrArr = calculateATR(candles, 14);
  const bbRes = calculateBollingerBands(closes, 20, 2);
  const vwapArr = calculateVWAP(candles);
  const obvArr = calculateOBV(candles);
  const volSmaArr = calculateSMA(volumes, 20);

  const safe = (arr: number[], fallback: number) => {
    const val = arr[lastIdx];
    return Number.isFinite(val) ? val : fallback;
  };

  const close = lastCandle.close;
  const ema9 = safe(ema9Arr, close);
  const ema20 = safe(ema20Arr, close);
  const ema50 = safe(ema50Arr, ema20);
  const ema100 = safe(ema100Arr, ema50);
  const ema200 = safe(ema200Arr, ema100);
  const rsi14 = safe(rsiArr, 50);
  const macd = safe(macdRes.macd, 0);
  const macdSignal = safe(macdRes.signal, 0);
  const macdHistogram = safe(macdRes.histogram, 0);
  const adx14 = safe(adxRes.adx, 18);
  const plusDI = safe(adxRes.plusDI, 20);
  const minusDI = safe(adxRes.minusDI, 20);
  const atr14 = safe(atrArr, close * 0.005);
  const atrPercent = close > 0 ? (atr14 / close) * 100 : 0;
  const bbUpper = safe(bbRes.upper, close * 1.01);
  const bbMiddle = safe(bbRes.middle, close);
  const bbLower = safe(bbRes.lower, close * 0.99);
  const bbWidthPct = bbMiddle > 0 ? ((bbUpper - bbLower) / bbMiddle) * 100 : 0;
  const vwap = safe(vwapArr, close);
  const obv = safe(obvArr, 0);
  const obvPrev5 = obvArr[Math.max(0, lastIdx - 5)] ?? obv;
  const obvSlope = obv - obvPrev5;
  const volumeSma20 = safe(volSmaArr, lastCandle.volume);
  const volumeRatio = volumeSma20 > 0 ? lastCandle.volume / volumeSma20 : 1;

  const fibonacci = calculateFibonacciLevels(candles, 60);
  const { supportLevels, resistanceLevels } = detectSupportResistance(candles, atr14);

  let trendDirection: 'bullish' | 'bearish' | 'neutral' = 'neutral';
  if (close > ema50 && ema9 > ema20 && ema20 > ema50) {
    trendDirection = 'bullish';
  } else if (close < ema50 && ema9 < ema20 && ema20 < ema50) {
    trendDirection = 'bearish';
  } else if (close > ema200 && ema20 > ema50) {
    trendDirection = 'bullish';
  } else if (close < ema200 && ema20 < ema50) {
    trendDirection = 'bearish';
  }

  let momentumState: IndicatorSet['momentumState'] = 'neutral';
  if (rsi14 >= 72) momentumState = 'overbought';
  else if (rsi14 <= 28) momentumState = 'oversold';
  else if (rsi14 > 53 && macdHistogram > 0) momentumState = 'bullish';
  else if (rsi14 < 47 && macdHistogram < 0) momentumState = 'bearish';

  // Breakout & pullback setup flags
  const recent20High = Math.max(...candles.slice(-21, -1).map((c) => c.high));
  const recent20Low = Math.min(...candles.slice(-21, -1).map((c) => c.low));
  const bodySize = Math.abs(lastCandle.close - lastCandle.open);
  const upperWick = lastCandle.high - Math.max(lastCandle.close, lastCandle.open);
  const lowerWick = Math.min(lastCandle.close, lastCandle.open) - lastCandle.low;
  const totalRange = Math.max(lastCandle.high - lastCandle.low, 1e-12);

  const breakoutUp = close > recent20High && volumeRatio >= 1.2;
  const breakoutDown = close < recent20Low && volumeRatio >= 1.2;
  const pullbackToEma20 =
    Math.abs(lastCandle.low - ema20) <= atr14 * 0.6 ||
    Math.abs(lastCandle.high - ema20) <= atr14 * 0.6;
  const bullishPinBar = lowerWick > bodySize * 1.8 && lowerWick / totalRange > 0.5 && close > prevCandle.low;
  const bearishPinBar = upperWick > bodySize * 1.8 && upperWick / totalRange > 0.5 && close < prevCandle.high;
  const volumeConfirmed = volumeRatio >= 1.15;
  const avgAtr10 =
    atrArr
      .slice(-11, -1)
      .filter((x) => Number.isFinite(x))
      .reduce((acc, v, _, arr) => acc + v / arr.length, 0) || atr14;
  const volatilityExpansion = atr14 > avgAtr10 * 1.1;

  return {
    timeframe,
    candleTime: lastCandle.openTime,
    close,
    ema9,
    ema20,
    ema50,
    ema100,
    ema200,
    rsi14,
    macd,
    macdSignal,
    macdHistogram,
    adx14,
    plusDI,
    minusDI,
    atr14,
    atrPercent,
    bbUpper,
    bbMiddle,
    bbLower,
    bbWidthPct,
    vwap,
    obv,
    obvSlope,
    volumeSma20,
    volumeRatio,
    fibonacci,
    supportLevels,
    resistanceLevels,
    trendDirection,
    momentumState,
    setupFlags: {
      breakoutUp,
      breakoutDown,
      pullbackToEma20,
      bullishPinBar,
      bearishPinBar,
      volumeConfirmed,
      volatilityExpansion,
    },
  };
}
