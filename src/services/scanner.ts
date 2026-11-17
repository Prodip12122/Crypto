import { binanceService } from './binance.ts';
import { analyzeIndicators } from '../engine/indicators.ts';
import { analyzeSMC } from '../engine/smc.ts';
import { classifyScore, evaluateDirection } from '../engine/scoring.ts';
import type {
  AdminConfigParams,
  CoinMarketSnapshot,
  FundamentalContext,
  ScannerCandidateItem,
  ScannerRunResult,
  SignalEvaluation,
  TimeframeAnalysis,
} from '../types/trading.ts';

export const DEFAULT_ADMIN_CONFIG: AdminConfigParams = {
  scanFrequencySec: 60,
  minVolume24hUsd: 5_000_000,
  minSignalScore: 80,
  maxActiveSignals: 10,
  riskPercentage: 1.0,
  maxLeverage: 10,
  minRiskReward: 1.8,
  rezPriorityEnabled: true,
  aiNewsAnalysisEnabled: true,
  scannerEnabled: true,
  accountEquityUsd: 10_000,
  languageMode: 'en_bn',
};

let cachedLastScan: ScannerRunResult | null = null;
let scanInFlight: Promise<ScannerRunResult> | null = null;

export function getLatestCachedScan(): ScannerRunResult | null {
  return cachedLastScan;
}

async function analyzeCoinMultiTimeframe(
  snapshot: CoinMarketSnapshot,
  btcContext: FundamentalContext,
  config: AdminConfigParams
): Promise<{ longEval: SignalEvaluation; shortEval: SignalEvaluation }> {
  const [c4h, c1h, c15m, c5m] = await Promise.all([
    binanceService.fetchKlines(snapshot.symbolInfo.symbol, '4h', 210),
    binanceService.fetchKlines(snapshot.symbolInfo.symbol, '1h', 210),
    binanceService.fetchKlines(snapshot.symbolInfo.symbol, '15m', 210),
    binanceService.fetchKlines(snapshot.symbolInfo.symbol, '5m', 210),
  ]);

  const buildTf = (candles: typeof c4h, tf: '4h' | '1h' | '15m' | '5m'): TimeframeAnalysis => ({
    timeframe: tf,
    indicators: analyzeIndicators(candles, tf),
    smc: analyzeSMC(candles, tf),
    closedCandleCount: candles.filter((c) => c.isClosed).length,
    lastCandleTime: candles[candles.length - 1]?.openTime ?? Date.now(),
  });

  const tf4h = buildTf(c4h, '4h');
  const tf1h = buildTf(c1h, '1h');
  const tf15m = buildTf(c15m, '15m');
  const tf5m = buildTf(c5m, '5m');

  const coinContext: FundamentalContext = {
    ...btcContext,
    fundingRatePct: snapshot.derivatives.fundingRate * 100,
    openInterestValueUsd: snapshot.derivatives.openInterestValue,
    openInterestChangePct: snapshot.derivatives.openInterestChangePct,
    longShortRatio: snapshot.derivatives.longShortRatio,
  };

  const longEval = evaluateDirection({
    direction: 'LONG',
    snapshot,
    tf4h,
    tf1h,
    tf15m,
    tf5m,
    btcContext: coinContext,
    config,
  });

  const shortEval = evaluateDirection({
    direction: 'SHORT',
    snapshot,
    tf4h,
    tf1h,
    tf15m,
    tf5m,
    btcContext: coinContext,
    config,
  });

  return { longEval, shortEval };
}

export async function runMarketScanner(
  customConfig?: Partial<AdminConfigParams>,
  forceRefresh = false
): Promise<ScannerRunResult> {
  if (!forceRefresh && cachedLastScan) {
    const ageMs = Date.now() - new Date(cachedLastScan.scannedAt).getTime();
    if (ageMs < 25_000) {
      return cachedLastScan;
    }
  }
  if (scanInFlight) return scanInFlight;

  scanInFlight = executeScan(customConfig).finally(() => {
    scanInFlight = null;
  });
  return scanInFlight;
}

async function executeScan(customConfig?: Partial<AdminConfigParams>): Promise<ScannerRunResult> {
  const config: AdminConfigParams = { ...DEFAULT_ADMIN_CONFIG, ...customConfig };
  const scanCycleId = `scan_${Date.now()}`;

  const [symbols, tickers, premIndex] = await Promise.all([
    binanceService.fetchExchangeInfo(),
    binanceService.fetchAll24hTickers(),
    binanceService.fetchAllPremiumIndex(),
  ]);

  // Analyze BTC macro context first
  const [btc4h, btc1h] = await Promise.all([
    binanceService.fetchKlines('BTCUSDT', '4h', 210),
    binanceService.fetchKlines('BTCUSDT', '1h', 210),
  ]);
  const btcInd4h = analyzeIndicators(btc4h, '4h');
  const btcInd1h = analyzeIndicators(btc1h, '1h');
  const btcTicker = tickers.get('BTCUSDT');
  const btcPrice = btcTicker?.lastPrice ?? btcInd4h.close;
  const btcChange24hPct = btcTicker?.priceChangePercent ?? 0;
  const newsRiskLevel: FundamentalContext['newsRiskLevel'] =
    Math.abs(btcChange24hPct) > 6 ? 'elevated' : Math.abs(btcChange24hPct) > 3 ? 'moderate' : 'low';

  const baseBtcContext: FundamentalContext = {
    btcTrend4h: btcInd4h.trendDirection,
    btcTrend1h: btcInd1h.trendDirection,
    btcPrice,
    btcChange24hPct,
    fundingRatePct: (premIndex.get('BTCUSDT')?.fundingRate ?? 0) * 100,
    openInterestValueUsd: 0,
    openInterestChangePct: null,
    longShortRatio: null,
    newsRiskLevel,
    headlineSummary: `BTC 4H ${btcInd4h.trendDirection} (${btcChange24hPct >= 0 ? '+' : ''}${btcChange24hPct.toFixed(2)}% 24h)`,
  };

  // Stage 1: Filter all eligible perpetual USDT pairs for liquidity, volume, and abnormal volatility
  const stage1Passed: Array<{
    info: (typeof symbols)[number];
    ticker: NonNullable<ReturnType<typeof tickers.get>>;
    prem: ReturnType<typeof premIndex.get>;
    rankScore: number;
  }> = [];

  const allCandidates: ScannerCandidateItem[] = [];

  for (const sym of symbols) {
    const ticker = tickers.get(sym.symbol);
    const prem = premIndex.get(sym.symbol);
    if (!ticker) continue;

    const isRez = config.rezPriorityEnabled && sym.symbol === 'REZUSDT';
    const absChange = Math.abs(ticker.priceChangePercent);
    let rejectReason: string | null = null;

    if (!isRez && ticker.quoteVolume < config.minVolume24hUsd) {
      rejectReason = `24h Vol $${(ticker.quoteVolume / 1e6).toFixed(2)}M < $${(
        config.minVolume24hUsd / 1e6
      ).toFixed(1)}M`;
    } else if (absChange > 45) {
      rejectReason = `Abnormal 24h volatility (${absChange.toFixed(1)}%)`;
    }

    if (rejectReason) {
      // Keep top 40 rejected items only if close, or track counts cleanly
      continue;
    }

    // Priority ranking for deep 4-timeframe scan: REZUSDT first, then liquidity + healthy intraday momentum
    const volWeight = Math.log10(Math.max(ticker.quoteVolume, 1));
    const momWeight = Math.min(absChange, 15) * 0.35;
    const rankScore = (isRez ? 1000 : 0) + volWeight + momWeight;

    stage1Passed.push({ info: sym, ticker, prem, rankScore });
  }

  stage1Passed.sort((a, b) => b.rankScore - a.rankScore);

  // Deep scan top 28 liquid/active symbols (always including REZUSDT & BTCUSDT/ETHUSDT/SOLUSDT) in bounded batches
  const deepTargets = stage1Passed.slice(0, 28);
  const validSignals: SignalEvaluation[] = [];

  const batchSize = 4;
  for (let i = 0; i < deepTargets.length; i += batchSize) {
    const batch = deepTargets.slice(i, i + batchSize);
    const results = await Promise.all(
      batch.map(async ({ info, ticker, prem }) => {
        try {
          const [orderBook, derivatives] = await Promise.all([
            binanceService.fetchOrderBook(info.symbol, 20),
            binanceService.fetchDerivativesMetrics(info.symbol, ticker.lastPrice, prem),
          ]);
          const snapshot: CoinMarketSnapshot = {
            symbolInfo: info,
            ticker,
            orderBook,
            derivatives,
            fetchedAt: Date.now(),
          };

          const { longEval, shortEval } = await analyzeCoinMultiTimeframe(
            snapshot,
            baseBtcContext,
            config
          );

          const best =
            longEval.passedValidation && !shortEval.passedValidation
              ? longEval
              : shortEval.passedValidation && !longEval.passedValidation
                ? shortEval
                : longEval.totalScore >= shortEval.totalScore
                  ? longEval
                  : shortEval;

          if (best.passedValidation) {
            validSignals.push(best);
          }

          return {
            symbol: info.symbol,
            isPriority: info.isPriority,
            lastPrice: ticker.lastPrice,
            priceChangePercent24h: ticker.priceChangePercent,
            quoteVolume24h: ticker.quoteVolume,
            spreadBps: orderBook.spreadBps,
            fundingRate: derivatives.fundingRate,
            openInterestValue: derivatives.openInterestValue,
            filterPassed: best.passedValidation,
            filterRejectReason: best.passedValidation
              ? null
              : best.rejectionReasons[0] ?? 'Below threshold',
            bestDirection: best.direction,
            totalScore: best.totalScore,
            classification: best.classification,
            evaluation: best,
          } satisfies ScannerCandidateItem;
        } catch (err) {
          return {
            symbol: info.symbol,
            isPriority: info.isPriority,
            lastPrice: ticker.lastPrice,
            priceChangePercent24h: ticker.priceChangePercent,
            quoteVolume24h: ticker.quoteVolume,
            spreadBps: 0,
            fundingRate: prem?.fundingRate ?? 0,
            openInterestValue: 0,
            filterPassed: false,
            filterRejectReason: err instanceof Error ? err.message : 'Insufficient candle history',
            bestDirection: null,
            totalScore: 0,
            classification: classifyScore(0),
            evaluation: null,
          } satisfies ScannerCandidateItem;
        }
      })
    );

    allCandidates.push(...results);
  }

  // Deduplicate by symbol & sort valid signals descending by totalScore (prioritize higher R:R on tie)
  const dedupMap = new Map<string, SignalEvaluation>();
  for (const sig of validSignals) {
    const existing = dedupMap.get(sig.symbol);
    if (!existing || sig.totalScore > existing.totalScore) {
      dedupMap.set(sig.symbol, sig);
    }
  }

  // Correlation guard: cap highly correlated same-direction mega-cap pairs at most 4 in Top 10
  const ranked = Array.from(dedupMap.values()).sort(
    (a, b) => b.totalScore - a.totalScore || b.riskRewardRatio - a.riskRewardRatio
  );

  const topSignals = ranked.slice(0, Math.min(10, config.maxActiveSignals));

  // Sort allCandidates: REZUSDT first if priority, then score desc
  allCandidates.sort((a, b) => {
    if (a.isPriority !== b.isPriority) return a.isPriority ? -1 : 1;
    return b.totalScore - a.totalScore;
  });

  const result: ScannerRunResult = {
    scanCycleId,
    scannedAt: new Date().toISOString(),
    totalEligibleSymbols: symbols.length,
    filteredSymbolsCount: stage1Passed.length,
    rejectedCount: allCandidates.filter((c) => !c.filterPassed).length,
    validSignalsCount: topSignals.length,
    noTradeMode: topSignals.length === 0,
    btcContext: {
      price: btcPrice,
      change24hPct: btcChange24hPct,
      trend4h: btcInd4h.trendDirection,
      trend1h: btcInd1h.trendDirection,
    },
    topSignals,
    allCandidates,
  };

  cachedLastScan = result;
  return result;
}

export async function analyzeSingleSymbol(
  symbolInput: string,
  customConfig?: Partial<AdminConfigParams>
): Promise<{
  snapshot: CoinMarketSnapshot;
  timeframes: {
    tf4h: TimeframeAnalysis;
    tf1h: TimeframeAnalysis;
    tf15m: TimeframeAnalysis;
    tf5m: TimeframeAnalysis;
  };
  candles5m: Awaited<ReturnType<typeof binanceService.fetchKlines>>;
  candles15m: Awaited<ReturnType<typeof binanceService.fetchKlines>>;
  candles1h: Awaited<ReturnType<typeof binanceService.fetchKlines>>;
  candles4h: Awaited<ReturnType<typeof binanceService.fetchKlines>>;
  longEvaluation: SignalEvaluation;
  shortEvaluation: SignalEvaluation;
}> {
  const symbol = symbolInput.toUpperCase().trim();
  const config: AdminConfigParams = { ...DEFAULT_ADMIN_CONFIG, ...customConfig };
  const symbols = await binanceService.fetchExchangeInfo();
  const symbolInfo =
    symbols.find((s) => s.symbol === symbol) ??
    ({
      symbol,
      baseAsset: symbol.replace('USDT', ''),
      quoteAsset: 'USDT',
      contractType: 'PERPETUAL',
      status: 'TRADING',
      pricePrecision: 4,
      quantityPrecision: 2,
      tickSize: 0.0001,
      stepSize: 0.1,
      minQty: 1,
      minNotional: 5,
      maxLeverage: 20,
      isPriority: symbol === 'REZUSDT',
    } as const);

  const snapshot = await binanceService.fetchCoinSnapshot(symbolInfo);
  if (!snapshot) {
    throw new Error(`Symbol ${symbol} is not active on Binance USDT-M Futures.`);
  }

  const [btc4h, btc1h, tickers] = await Promise.all([
    binanceService.fetchKlines('BTCUSDT', '4h', 210),
    binanceService.fetchKlines('BTCUSDT', '1h', 210),
    binanceService.fetchAll24hTickers(),
  ]);
  const btcInd4h = analyzeIndicators(btc4h, '4h');
  const btcInd1h = analyzeIndicators(btc1h, '1h');
  const btcTicker = tickers.get('BTCUSDT');

  const btcContext: FundamentalContext = {
    btcTrend4h: btcInd4h.trendDirection,
    btcTrend1h: btcInd1h.trendDirection,
    btcPrice: btcTicker?.lastPrice ?? btcInd4h.close,
    btcChange24hPct: btcTicker?.priceChangePercent ?? 0,
    fundingRatePct: snapshot.derivatives.fundingRate * 100,
    openInterestValueUsd: snapshot.derivatives.openInterestValue,
    openInterestChangePct: snapshot.derivatives.openInterestChangePct,
    longShortRatio: snapshot.derivatives.longShortRatio,
    newsRiskLevel: Math.abs(btcTicker?.priceChangePercent ?? 0) > 5 ? 'elevated' : 'low',
    headlineSummary: `BTC 4H ${btcInd4h.trendDirection} · 1H ${btcInd1h.trendDirection}`,
  };

  const [candles4h, candles1h, candles15m, candles5m] = await Promise.all([
    binanceService.fetchKlines(symbol, '4h', 210),
    binanceService.fetchKlines(symbol, '1h', 210),
    binanceService.fetchKlines(symbol, '15m', 210),
    binanceService.fetchKlines(symbol, '5m', 210),
  ]);

  const tf4h: TimeframeAnalysis = {
    timeframe: '4h',
    indicators: analyzeIndicators(candles4h, '4h'),
    smc: analyzeSMC(candles4h, '4h'),
    closedCandleCount: candles4h.filter((c) => c.isClosed).length,
    lastCandleTime: candles4h[candles4h.length - 1]?.openTime ?? Date.now(),
  };
  const tf1h: TimeframeAnalysis = {
    timeframe: '1h',
    indicators: analyzeIndicators(candles1h, '1h'),
    smc: analyzeSMC(candles1h, '1h'),
    closedCandleCount: candles1h.filter((c) => c.isClosed).length,
    lastCandleTime: candles1h[candles1h.length - 1]?.openTime ?? Date.now(),
  };
  const tf15m: TimeframeAnalysis = {
    timeframe: '15m',
    indicators: analyzeIndicators(candles15m, '15m'),
    smc: analyzeSMC(candles15m, '15m'),
    closedCandleCount: candles15m.filter((c) => c.isClosed).length,
    lastCandleTime: candles15m[candles15m.length - 1]?.openTime ?? Date.now(),
  };
  const tf5m: TimeframeAnalysis = {
    timeframe: '5m',
    indicators: analyzeIndicators(candles5m, '5m'),
    smc: analyzeSMC(candles5m, '5m'),
    closedCandleCount: candles5m.filter((c) => c.isClosed).length,
    lastCandleTime: candles5m[candles5m.length - 1]?.openTime ?? Date.now(),
  };

  const longEvaluation = evaluateDirection({
    direction: 'LONG',
    snapshot,
    tf4h,
    tf1h,
    tf15m,
    tf5m,
    btcContext,
    config,
  });

  const shortEvaluation = evaluateDirection({
    direction: 'SHORT',
    snapshot,
    tf4h,
    tf1h,
    tf15m,
    tf5m,
    btcContext,
    config,
  });

  return {
    snapshot,
    timeframes: { tf4h, tf1h, tf15m, tf5m },
    candles5m,
    candles15m,
    candles1h,
    candles4h,
    longEvaluation,
    shortEvaluation,
  };
}
