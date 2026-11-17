import { useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import { CandlestickChart } from '../CandlestickChart';
import { formatPct, formatPrice, formatUsd } from '../../lib/format';
import type { Candle, CoinMarketSnapshot, SignalEvaluation, TimeframeAnalysis } from '../../types/trading';

interface CoinAnalysisViewProps {
  initialSymbol: string;
  onSelectSignal: (sig: SignalEvaluation) => void;
}

interface AnalysisPayload {
  snapshot: CoinMarketSnapshot;
  timeframes: {
    tf4h: TimeframeAnalysis;
    tf1h: TimeframeAnalysis;
    tf15m: TimeframeAnalysis;
    tf5m: TimeframeAnalysis;
  };
  candles5m: Candle[];
  candles15m: Candle[];
  candles1h: Candle[];
  candles4h: Candle[];
  longEvaluation: SignalEvaluation;
  shortEvaluation: SignalEvaluation;
}

const QUICK_SYMBOLS = ['REZUSDT', 'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT'];

export function CoinAnalysisView({ initialSymbol, onSelectSignal }: CoinAnalysisViewProps) {
  const [symbol, setSymbol] = useState(initialSymbol || 'REZUSDT');
  const [inputVal, setInputVal] = useState(initialSymbol || 'REZUSDT');
  const [tf, setTf] = useState<'5m' | '15m' | '1h' | '4h'>('15m');
  const [data, setData] = useState<AnalysisPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setSymbol(initialSymbol);
    setInputVal(initialSymbol);
  }, [initialSymbol]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    fetch(`/api/market/analyze/${encodeURIComponent(symbol)}`)
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'Failed to analyze symbol');
        return json as AnalysisPayload;
      })
      .then((payload) => {
        if (active) setData(payload);
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : 'Analysis failed');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [symbol]);

  const activeTf = data
    ? {
        '5m': data.timeframes.tf5m,
        '15m': data.timeframes.tf15m,
        '1h': data.timeframes.tf1h,
        '4h': data.timeframes.tf4h,
      }[tf]
    : null;

  const activeCandles = data
    ? {
        '5m': data.candles5m,
        '15m': data.candles15m,
        '1h': data.candles1h,
        '4h': data.candles4h,
      }[tf]
    : [];

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = inputVal.toUpperCase().trim();
    if (clean) setSymbol(clean);
  };

  return (
    <div className="space-y-6">
      {/* Symbol Search & Quick Select */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-100">Individual Coin Analysis · {symbol}</h1>
          <p className="text-xs text-slate-400 mt-1">
            Multi-timeframe technical indicators, Smart Money Concepts, and independent LONG vs SHORT evaluation.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="flex items-center gap-2">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={inputVal}
              onChange={(e) => setInputVal(e.target.value.toUpperCase())}
              placeholder="e.g. REZUSDT"
              className="pl-8 pr-3 py-1.5 text-sm font-mono bg-[#111827] border border-slate-800 rounded-lg text-slate-100 focus:outline-none focus:border-cyan-500 w-40"
            />
          </div>
          <button
            type="submit"
            className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-cyan-500 text-slate-950 hover:bg-cyan-400 cursor-pointer"
          >
            Analyze
          </button>
        </form>
      </div>

      {/* Quick Symbol Tabs */}
      <div className="flex flex-wrap items-center gap-1.5">
        {QUICK_SYMBOLS.map((s) => (
          <button
            key={s}
            onClick={() => {
              setSymbol(s);
              setInputVal(s);
            }}
            className={`px-3 py-1.5 text-xs font-mono rounded-md border transition-colors cursor-pointer ${
              symbol === s
                ? 'border-cyan-500/60 bg-cyan-500/10 text-cyan-400'
                : 'border-slate-800 bg-[#111827] text-slate-400 hover:text-slate-200'
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      {error && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-300">
          {error}
        </div>
      )}

      {loading && !data ? (
        <div className="rounded-lg border border-slate-800 bg-[#111827] p-12 text-center text-sm text-slate-400">
          Loading Binance Futures market structure for {symbol}...
        </div>
      ) : (
        data && (
          <>
            {/* Market Snapshot Strip */}
            <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
              <div className="rounded-lg border border-slate-800/80 bg-[#111827] p-3.5">
                <div className="text-xs text-slate-400">Last Price</div>
                <div className="mt-1 font-mono text-base font-semibold tabular-nums text-slate-100">
                  ${formatPrice(data.snapshot.ticker.lastPrice)}
                </div>
              </div>
              <div className="rounded-lg border border-slate-800/80 bg-[#111827] p-3.5">
                <div className="text-xs text-slate-400">24h Change</div>
                <div
                  className={`mt-1 font-mono text-base font-semibold tabular-nums ${
                    data.snapshot.ticker.priceChangePercent >= 0 ? 'text-emerald-400' : 'text-rose-400'
                  }`}
                >
                  {formatPct(data.snapshot.ticker.priceChangePercent)}
                </div>
              </div>
              <div className="rounded-lg border border-slate-800/80 bg-[#111827] p-3.5">
                <div className="text-xs text-slate-400">24h Volume</div>
                <div className="mt-1 font-mono text-base font-semibold tabular-nums text-slate-100">
                  {formatUsd(data.snapshot.ticker.quoteVolume)}
                </div>
              </div>
              <div className="rounded-lg border border-slate-800/80 bg-[#111827] p-3.5">
                <div className="text-xs text-slate-400">Funding Rate</div>
                <div className="mt-1 font-mono text-base font-semibold tabular-nums text-slate-100">
                  {(data.snapshot.derivatives.fundingRate * 100).toFixed(4)}%
                </div>
              </div>
              <div className="rounded-lg border border-slate-800/80 bg-[#111827] p-3.5">
                <div className="text-xs text-slate-400">Open Interest</div>
                <div className="mt-1 font-mono text-base font-semibold tabular-nums text-slate-100">
                  {formatUsd(data.snapshot.derivatives.openInterestValue)}
                </div>
              </div>
              <div className="rounded-lg border border-slate-800/80 bg-[#111827] p-3.5">
                <div className="text-xs text-slate-400">Spread · Imbalance</div>
                <div className="mt-1 font-mono text-sm font-semibold tabular-nums text-slate-100">
                  {data.snapshot.orderBook.spreadBps.toFixed(1)}bps · {data.snapshot.orderBook.imbalance >= 0 ? '+' : ''}
                  {(data.snapshot.orderBook.imbalance * 100).toFixed(0)}%
                </div>
              </div>
            </div>

            {/* Chart + Timeframe Tabs */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="text-xs font-medium text-slate-300">
                  Candlestick Chart & EMA Structure ({tf.toUpperCase()})
                </div>
                <div className="flex items-center gap-1 p-1 rounded-md bg-[#111827] border border-slate-800/80">
                  {(['5m', '15m', '1h', '4h'] as const).map((t) => (
                    <button
                      key={t}
                      onClick={() => setTf(t)}
                      className={`px-3 py-1 text-xs font-mono rounded cursor-pointer ${
                        tf === t ? 'bg-slate-800 text-cyan-400' : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {t.toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>

              <CandlestickChart
                candles={activeCandles}
                symbol={symbol}
                height={400}
              />
            </div>

            {/* Independent LONG vs SHORT Evaluations */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {[data.longEvaluation, data.shortEvaluation].map((ev) => (
                <div
                  key={ev.direction}
                  className="rounded-lg border border-slate-800/80 bg-[#111827] p-5 space-y-3"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span
                        className={`font-mono text-sm font-semibold ${
                          ev.direction === 'LONG' ? 'text-emerald-400' : 'text-rose-400'
                        }`}
                      >
                        {ev.direction} Setup
                      </span>
                      <span className="text-xs text-slate-400">· {ev.entryType}</span>
                    </div>
                    <span className="font-mono text-sm font-semibold text-cyan-400 tabular-nums">
                      {ev.totalScore}/100 ({ev.classification})
                    </span>
                  </div>

                  <div className="grid grid-cols-4 gap-2 text-xs font-mono tabular-nums pt-1">
                    <div>
                      <div className="text-slate-500">Entry</div>
                      <div className="text-slate-100">{formatPrice(ev.entryLimitPrice)}</div>
                    </div>
                    <div>
                      <div className="text-slate-500">Stop Loss</div>
                      <div className="text-rose-400">{formatPrice(ev.stopLoss)}</div>
                    </div>
                    <div>
                      <div className="text-slate-500">TP2 (2R)</div>
                      <div className="text-emerald-400">{formatPrice(ev.tp2)}</div>
                    </div>
                    <div>
                      <div className="text-slate-500">R:R</div>
                      <div className="text-slate-100">{ev.riskRewardRatio}:1</div>
                    </div>
                  </div>

                  <div className="text-xs text-slate-400">
                    {ev.passedValidation ? (
                      <span className="text-emerald-400">Passed all validation checks.</span>
                    ) : (
                      <span>Rejected: {ev.rejectionReasons.join(' · ')}</span>
                    )}
                  </div>

                  <button
                    onClick={() => onSelectSignal(ev)}
                    className="w-full py-2 text-xs font-medium rounded-md border border-slate-700 text-slate-200 hover:bg-slate-800 cursor-pointer"
                  >
                    Open Full {ev.direction} Ticket & AI Explanation
                  </button>
                </div>
              ))}
            </div>

            {/* Technical Indicators & Smart Money Concepts Detail */}
            {activeTf && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                <div className="rounded-lg border border-slate-800/80 bg-[#111827] p-5">
                  <h2 className="text-sm font-semibold text-slate-100 mb-3">
                    Technical Indicators ({tf.toUpperCase()})
                  </h2>
                  <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs font-mono tabular-nums">
                    <div className="flex justify-between py-1 border-b border-slate-800/60">
                      <span className="text-slate-400">EMA 9 / 20</span>
                      <span className="text-slate-200">
                        {formatPrice(activeTf.indicators.ema9)} / {formatPrice(activeTf.indicators.ema20)}
                      </span>
                    </div>
                    <div className="flex justify-between py-1 border-b border-slate-800/60">
                      <span className="text-slate-400">EMA 50 / 200</span>
                      <span className="text-slate-200">
                        {formatPrice(activeTf.indicators.ema50)} / {formatPrice(activeTf.indicators.ema200)}
                      </span>
                    </div>
                    <div className="flex justify-between py-1 border-b border-slate-800/60">
                      <span className="text-slate-400">RSI (14)</span>
                      <span className="text-slate-200">{activeTf.indicators.rsi14.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between py-1 border-b border-slate-800/60">
                      <span className="text-slate-400">MACD Hist</span>
                      <span className="text-slate-200">{activeTf.indicators.macdHistogram.toFixed(6)}</span>
                    </div>
                    <div className="flex justify-between py-1 border-b border-slate-800/60">
                      <span className="text-slate-400">ADX (14)</span>
                      <span className="text-slate-200">{activeTf.indicators.adx14.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between py-1 border-b border-slate-800/60">
                      <span className="text-slate-400">ATR (14)</span>
                      <span className="text-slate-200">
                        {formatPrice(activeTf.indicators.atr14)} ({activeTf.indicators.atrPercent.toFixed(2)}%)
                      </span>
                    </div>
                    <div className="flex justify-between py-1 border-b border-slate-800/60">
                      <span className="text-slate-400">VWAP</span>
                      <span className="text-slate-200">{formatPrice(activeTf.indicators.vwap)}</span>
                    </div>
                    <div className="flex justify-between py-1 border-b border-slate-800/60">
                      <span className="text-slate-400">Vol / SMA20</span>
                      <span className="text-slate-200">{activeTf.indicators.volumeRatio.toFixed(2)}x</span>
                    </div>
                    <div className="flex justify-between py-1 border-b border-slate-800/60">
                      <span className="text-slate-400">BB Upper / Lower</span>
                      <span className="text-slate-200">
                        {formatPrice(activeTf.indicators.bbUpper)} / {formatPrice(activeTf.indicators.bbLower)}
                      </span>
                    </div>
                    <div className="flex justify-between py-1 border-b border-slate-800/60">
                      <span className="text-slate-400">Fib 0.618</span>
                      <span className="text-slate-200">{formatPrice(activeTf.indicators.fibonacci.level618)}</span>
                    </div>
                  </div>
                </div>

                <div className="rounded-lg border border-slate-800/80 bg-[#111827] p-5 space-y-3">
                  <h2 className="text-sm font-semibold text-slate-100">
                    Smart Money Concepts ({tf.toUpperCase()})
                  </h2>
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div className="p-3 rounded bg-[#090d16] border border-slate-800/70">
                      <div className="text-slate-400">Market Structure Bias</div>
                      <div className="mt-1 font-mono font-semibold text-slate-100">
                        {activeTf.smc.structureBias.toUpperCase()}
                      </div>
                      <div className="mt-1 font-mono text-slate-400">
                        {activeTf.smc.lastStructureSequence.join(' → ') || 'No swings yet'}
                      </div>
                    </div>
                    <div className="p-3 rounded bg-[#090d16] border border-slate-800/70">
                      <div className="text-slate-400">BOS · CHoCH Events</div>
                      <div className="mt-1 font-mono font-semibold text-slate-100">
                        {activeTf.smc.bosEvents.length} BOS · {activeTf.smc.chochEvents.length} CHoCH
                      </div>
                      <div className="mt-1 font-mono text-slate-400">
                        Sweeps: {activeTf.smc.recentSweeps.length}
                      </div>
                    </div>
                    <div className="p-3 rounded bg-[#090d16] border border-slate-800/70">
                      <div className="text-slate-400">Unmitigated Order Blocks</div>
                      <div className="mt-1 font-mono text-slate-200">
                        {activeTf.smc.activeOrderBlocks.length} active zones
                      </div>
                      {activeTf.smc.nearestBullishZone && (
                        <div className="mt-1 font-mono text-emerald-400">
                          Bull: {formatPrice(activeTf.smc.nearestBullishZone.low)}–{formatPrice(activeTf.smc.nearestBullishZone.high)}
                        </div>
                      )}
                    </div>
                    <div className="p-3 rounded bg-[#090d16] border border-slate-800/70">
                      <div className="text-slate-400">Fair Value Gaps (FVG)</div>
                      <div className="mt-1 font-mono text-slate-200">
                        {activeTf.smc.activeFVGs.length} open imbalances
                      </div>
                      {activeTf.smc.nearestBearishZone && (
                        <div className="mt-1 font-mono text-rose-400">
                          Bear: {formatPrice(activeTf.smc.nearestBearishZone.low)}–{formatPrice(activeTf.smc.nearestBearishZone.high)}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </>
        )
      )}
    </div>
  );
}
