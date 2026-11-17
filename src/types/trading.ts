export type Timeframe = '5m' | '15m' | '1h' | '4h';

export type SignalDirection = 'LONG' | 'SHORT';

export type EntryType = 'LIMIT' | 'MARKET';

export type SignalClassification = 'Premium' | 'Strong' | 'Valid' | 'Rejected';

export type SignalStatus =
  | 'WAITING_FOR_ENTRY'
  | 'ENTRY_FILLED'
  | 'TP1_HIT'
  | 'TP2_HIT'
  | 'TP3_HIT'
  | 'SL_HIT'
  | 'EXPIRED'
  | 'CANCELLED';

export interface Candle {
  openTime: number;
  closeTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  quoteVolume: number;
  trades: number;
  isClosed: boolean;
}

export interface ExchangeSymbolInfo {
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  contractType: string;
  status: string;
  pricePrecision: number;
  quantityPrecision: number;
  tickSize: number;
  stepSize: number;
  minQty: number;
  minNotional: number;
  maxLeverage: number;
  isPriority: boolean;
}

export interface MarketTicker24h {
  symbol: string;
  lastPrice: number;
  priceChangePercent: number;
  highPrice: number;
  lowPrice: number;
  volume: number;
  quoteVolume: number;
  openTime: number;
  closeTime: number;
}

export interface OrderBookSnapshot {
  symbol: string;
  bestBid: number;
  bestAsk: number;
  spreadBps: number;
  bidDepthUsd: number;
  askDepthUsd: number;
  imbalance: number; // -1 to +1 (positive = bid heavy)
  timestamp: number;
}

export interface FundingAndOI {
  symbol: string;
  markPrice: number;
  indexPrice: number;
  fundingRate: number;
  nextFundingTime: number;
  openInterest: number;
  openInterestValue: number;
  openInterestChangePct: number | null;
  longShortRatio: number | null;
  timestamp: number;
}

export interface CoinMarketSnapshot {
  symbolInfo: ExchangeSymbolInfo;
  ticker: MarketTicker24h;
  orderBook: OrderBookSnapshot;
  derivatives: FundingAndOI;
  fetchedAt: number;
}

export interface FibonacciLevels {
  swingHigh: number;
  swingLow: number;
  trend: 'up' | 'down';
  level236: number;
  level382: number;
  level500: number;
  level618: number;
  level786: number;
}

export interface SupportResistanceLevel {
  price: number;
  type: 'support' | 'resistance';
  touches: number;
  strength: number; // 1-10
}

export interface IndicatorSet {
  timeframe: Timeframe;
  candleTime: number;
  close: number;
  ema9: number;
  ema20: number;
  ema50: number;
  ema100: number;
  ema200: number;
  rsi14: number;
  macd: number;
  macdSignal: number;
  macdHistogram: number;
  adx14: number;
  plusDI: number;
  minusDI: number;
  atr14: number;
  atrPercent: number;
  bbUpper: number;
  bbMiddle: number;
  bbLower: number;
  bbWidthPct: number;
  vwap: number;
  obv: number;
  obvSlope: number;
  volumeSma20: number;
  volumeRatio: number;
  fibonacci: FibonacciLevels;
  supportLevels: SupportResistanceLevel[];
  resistanceLevels: SupportResistanceLevel[];
  trendDirection: 'bullish' | 'bearish' | 'neutral';
  momentumState: 'bullish' | 'bearish' | 'overbought' | 'oversold' | 'neutral';
  setupFlags: {
    breakoutUp: boolean;
    breakoutDown: boolean;
    pullbackToEma20: boolean;
    bullishPinBar: boolean;
    bearishPinBar: boolean;
    volumeConfirmed: boolean;
    volatilityExpansion: boolean;
  };
}

export interface SwingPoint {
  index: number;
  time: number;
  price: number;
  type: 'HH' | 'HL' | 'LH' | 'LL' | 'HIGH' | 'LOW';
}

export interface FairValueGap {
  type: 'bullish' | 'bearish';
  top: number;
  bottom: number;
  candleTime: number;
  mitigated: boolean;
  sizeAtrRatio: number;
}

export interface OrderBlock {
  type: 'bullish' | 'bearish';
  high: number;
  low: number;
  candleTime: number;
  mitigated: boolean;
  displacementAtrRatio: number;
}

export interface LiquiditySweep {
  type: 'buy_side_sweep' | 'sell_side_sweep';
  sweptLevel: number;
  wickPrice: number;
  closePrice: number;
  candleTime: number;
}

export interface SMCAnalysis {
  timeframe: Timeframe;
  structureBias: 'bullish' | 'bearish' | 'ranging';
  lastStructureSequence: string[]; // e.g. ['HL', 'HH', 'HL', 'HH']
  bosEvents: Array<{ direction: 'bullish' | 'bearish'; price: number; time: number }>;
  chochEvents: Array<{ direction: 'bullish' | 'bearish'; price: number; time: number }>;
  activeFVGs: FairValueGap[];
  activeOrderBlocks: OrderBlock[];
  recentSweeps: LiquiditySweep[];
  equalHighs: number[];
  equalLows: number[];
  nearestBullishZone: { low: number; high: number; source: string } | null;
  nearestBearishZone: { low: number; high: number; source: string } | null;
}

export interface TimeframeAnalysis {
  timeframe: Timeframe;
  indicators: IndicatorSet;
  smc: SMCAnalysis;
  closedCandleCount: number;
  lastCandleTime: number;
}

export interface ScoreBreakdown {
  mtfTrend: number; // max 20
  momentum: number; // max 15
  volumeOrderBook: number; // max 15
  smc: number; // max 20
  supportResistance: number; // max 10
  fundingOi: number; // max 10
  fundamentalBtc: number; // max 5
  entryRiskQuality: number; // max 5
}

export interface FundamentalContext {
  btcTrend4h: 'bullish' | 'bearish' | 'neutral';
  btcTrend1h: 'bullish' | 'bearish' | 'neutral';
  btcPrice: number;
  btcChange24hPct: number;
  fundingRatePct: number;
  openInterestValueUsd: number;
  openInterestChangePct: number | null;
  longShortRatio: number | null;
  newsRiskLevel: 'low' | 'moderate' | 'elevated';
  headlineSummary: string;
}

export interface SignalEvaluation {
  symbol: string;
  direction: SignalDirection;
  entryType: EntryType;
  totalScore: number;
  classification: SignalClassification;
  scoreBreakdown: ScoreBreakdown;
  passedValidation: boolean;
  rejectionReasons: string[];
  entryLimitPrice: number;
  entryZoneLow: number;
  entryZoneHigh: number;
  stopLoss: number;
  tp1: number;
  tp2: number;
  tp3: number;
  riskRewardRatio: number;
  positionSizeUsd: number;
  quantity: number;
  leverage: number;
  riskPercent: number;
  estimatedHoldingMinutes: number;
  signalExpiryMinutes: number;
  technicalSummary: {
    trend4h: string;
    trend1h: string;
    setup15m: string;
    entry5m: string;
    rsi5m: number;
    adx15m: number;
    atr5mPct: number;
    vwapRelation: string;
    volumeRatio5m: number;
  };
  smcSummary: {
    bias15m: string;
    bosDetected: boolean;
    chochDetected: boolean;
    activeObCount: number;
    activeFvgCount: number;
    recentSweep: string | null;
  };
  fundamentalContext: FundamentalContext;
  deterministicRationaleEn: string;
  deterministicRationaleBn: string;
}

export interface ScannerCandidateItem {
  symbol: string;
  isPriority: boolean;
  lastPrice: number;
  priceChangePercent24h: number;
  quoteVolume24h: number;
  spreadBps: number;
  fundingRate: number;
  openInterestValue: number;
  filterPassed: boolean;
  filterRejectReason: string | null;
  bestDirection: SignalDirection | null;
  totalScore: number;
  classification: SignalClassification;
  evaluation: SignalEvaluation | null;
}

export interface ScannerRunResult {
  scanCycleId: string;
  scannedAt: string;
  totalEligibleSymbols: number;
  filteredSymbolsCount: number;
  rejectedCount: number;
  validSignalsCount: number;
  noTradeMode: boolean;
  btcContext: {
    price: number;
    change24hPct: number;
    trend4h: 'bullish' | 'bearish' | 'neutral';
    trend1h: 'bullish' | 'bearish' | 'neutral';
  };
  topSignals: SignalEvaluation[];
  allCandidates: ScannerCandidateItem[];
}

export interface NewsIntelligenceItem {
  id: string;
  title: string;
  source: string;
  url: string;
  publishedAt: string;
  relevanceScore: number;
  sentiment: 'bullish' | 'bearish' | 'neutral';
  affectedSymbols: string[];
  summaryEn: string;
  summaryBn: string;
  riskFlags: string[];
  isVerified: boolean;
}

export interface BacktestConfig {
  symbol: string;
  timeframe: Timeframe;
  splitMode: 'train' | 'validation' | 'out_of_sample' | 'full';
  initialEquity: number;
  riskPerTradePct: number;
  feeBps: number;
  slippageBps: number;
  minScore: number;
}

export interface BacktestTrade {
  entryTime: string;
  exitTime: string;
  direction: SignalDirection;
  entryType: EntryType;
  score: number;
  entryPrice: number;
  stopLoss: number;
  tp1: number;
  tp2: number;
  tp3: number;
  exitPrice: number;
  outcome: 'TP1_HIT' | 'TP2_HIT' | 'TP3_HIT' | 'SL_HIT' | 'EXPIRED';
  pnlR: number;
  pnlUsd: number;
  feesUsd: number;
  holdingMinutes: number;
  ambiguousBar: boolean;
}

export interface BacktestReport {
  symbol: string;
  timeframe: Timeframe;
  splitMode: string;
  startDate: string;
  endDate: string;
  candlesAnalyzed: number;
  initialEquity: number;
  finalEquity: number;
  netPnlUsd: number;
  totalTrades: number;
  wins: number;
  losses: number;
  winRatePct: number;
  profitFactor: number;
  expectancyR: number;
  averageR: number;
  maxDrawdownPct: number;
  avgHoldingMinutes: number;
  equityCurve: Array<{ time: string; equity: number }>;
  tradesLog: BacktestTrade[];
}

export interface AdminConfigParams {
  scanFrequencySec: number;
  minVolume24hUsd: number;
  minSignalScore: number;
  maxActiveSignals: number;
  riskPercentage: number;
  maxLeverage: number;
  minRiskReward: number;
  rezPriorityEnabled: boolean;
  aiNewsAnalysisEnabled: boolean;
  scannerEnabled: boolean;
  accountEquityUsd: number;
  languageMode: 'en' | 'bn' | 'en_bn';
}
