import { ArrowDownRight, ArrowUpRight, RefreshCw, ShieldAlert } from 'lucide-react';
import { formatPct, formatPrice, formatShortTime, formatUsd, type PerformanceOverviewRow, type PersistedSignalRow } from '../../lib/format';
import type { ScannerRunResult, SignalEvaluation } from '../../types/trading';

interface DashboardViewProps {
  scanResult: ScannerRunResult | null;
  scanLoading: boolean;
  persistedSignals: PersistedSignalRow[];
  performance: PerformanceOverviewRow | null;
  langMode: 'en' | 'bn' | 'en_bn';
  onRunScan: () => void;
  onSelectSignal: (sig: SignalEvaluation) => void;
  onInspectSymbol: (symbol: string) => void;
  onNavigate: (page: string) => void;
}

export function DashboardView({
  scanResult,
  scanLoading,
  persistedSignals,
  performance,
  langMode,
  onRunScan,
  onSelectSignal,
  onInspectSymbol,
  onNavigate,
}: DashboardViewProps) {
  const showBn = langMode === 'bn' || langMode === 'en_bn';
  const showEn = langMode === 'en' || langMode === 'en_bn';

  const topSignals = scanResult?.topSignals ?? [];
  const activePersisted = persistedSignals.filter((s) =>
    ['WAITING_FOR_ENTRY', 'ENTRY_FILLED', 'TP1_HIT', 'TP2_HIT'].includes(s.status)
  );

  const longCount = topSignals.filter((s) => s.direction === 'LONG').length;
  const shortCount = topSignals.filter((s) => s.direction === 'SHORT').length;
  const avgScore =
    topSignals.length > 0
      ? Math.round(topSignals.reduce((acc, s) => acc + s.totalScore, 0) / topSignals.length)
      : performance?.avgScore ?? 0;

  const tpHitRate = performance
    ? `${performance.winRatePct.toFixed(1)}%`
    : '0.0%';
  const slHitRate =
    performance && performance.filledSignals > 0
      ? `${((performance.slHits / performance.filledSignals) * 100).toFixed(1)}%`
      : '0.0%';

  const rezCandidate = scanResult?.allCandidates.find((c) => c.symbol === 'REZUSDT');

  return (
    <div className="space-y-6">
      {/* Header Row */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-100 tracking-tight">
            Scalping Signal Intelligence Overview
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            {showEn && 'Real-time Binance USDT-M Futures multi-timeframe scanner (4H · 1H · 15M · 5M)'}
            {showBn && (
              <span className="block text-xs text-slate-400 mt-0.5">
                সহজ বাংলা: বিন্যান্স ফিউচার্সের সব কয়েন যাচাই করে সেরা ১০টি নিরাপদ ট্রেডিং সুযোগ এখানে দেখানো হয়।
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <button
            onClick={onRunScan}
            disabled={scanLoading}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-lg bg-cyan-500 text-slate-950 hover:bg-cyan-400 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${scanLoading ? 'animate-spin' : ''}`} />
            {scanLoading ? 'Scanning Market...' : 'Run Full Scan'}
          </button>
        </div>
      </div>

      {/* 10 Core Dashboard KPIs in Clean Hairline Grid */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <div className="rounded-lg border border-slate-800/80 bg-[#111827] p-4">
          <div className="text-xs text-slate-400">Total Scanned Coins</div>
          <div className="mt-1.5 text-2xl font-semibold font-mono tabular-nums text-slate-100">
            {scanResult?.totalEligibleSymbols ?? '—'}
          </div>
          <div className="mt-1 text-xs text-slate-500 tabular-nums">
            {scanResult ? `${scanResult.filteredSymbolsCount} passed liquidity` : 'Awaiting scan'}
          </div>
        </div>

        <div className="rounded-lg border border-slate-800/80 bg-[#111827] p-4">
          <div className="text-xs text-slate-400">Top Opportunities / Active</div>
          <div className="mt-1.5 text-2xl font-semibold font-mono tabular-nums text-cyan-400">
            {topSignals.length} <span className="text-sm text-slate-500">/ {activePersisted.length} DB</span>
          </div>
          <div className="mt-1 text-xs text-slate-500 tabular-nums">
            {longCount} LONG · {shortCount} SHORT
          </div>
        </div>

        <div className="rounded-lg border border-slate-800/80 bg-[#111827] p-4">
          <div className="text-xs text-slate-400">BTC Market Direction</div>
          <div className="mt-1.5 flex items-baseline gap-2">
            <span className="text-xl font-semibold font-mono tabular-nums text-slate-100">
              ${formatPrice(scanResult?.btcContext.price)}
            </span>
            <span
              className={`text-xs font-mono tabular-nums ${
                (scanResult?.btcContext.change24hPct ?? 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'
              }`}
            >
              {formatPct(scanResult?.btcContext.change24hPct)}
            </span>
          </div>
          <div className="mt-1 text-xs text-slate-400">
            4H: {scanResult?.btcContext.trend4h ?? '—'} · 1H: {scanResult?.btcContext.trend1h ?? '—'}
          </div>
        </div>

        <div className="rounded-lg border border-slate-800/80 bg-[#111827] p-4">
          <div className="text-xs text-slate-400">Avg Score · TP / SL Rate</div>
          <div className="mt-1.5 text-2xl font-semibold font-mono tabular-nums text-slate-100">
            {avgScore}<span className="text-sm text-slate-500">/100</span>
          </div>
          <div className="mt-1 text-xs text-slate-400 tabular-nums">
            TP: <span className="text-emerald-400">{tpHitRate}</span> · SL:{' '}
            <span className="text-rose-400">{slHitRate}</span>
          </div>
        </div>

        <div className="rounded-lg border border-slate-800/80 bg-[#111827] p-4">
          <div className="text-xs text-slate-400">Historical PnL · Max DD</div>
          <div
            className={`mt-1.5 text-2xl font-semibold font-mono tabular-nums ${
              (performance?.netPnlPct ?? 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'
            }`}
          >
            {performance ? formatPct(performance.netPnlPct) : '0.00%'}
          </div>
          <div className="mt-1 text-xs text-slate-400 tabular-nums">
            Max Drawdown: {performance ? `${performance.maxDrawdownPct.toFixed(2)}%` : '0.00%'}
          </div>
        </div>
      </div>

      {/* Priority Watchlist Spotlight: REZUSDT */}
      <div className="rounded-lg border border-slate-800/80 bg-[#111827] p-5">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="text-xs text-cyan-400 font-medium">Priority Watchlist · REZUSDT Perpetual</div>
            <div className="mt-1 flex items-baseline gap-4">
              <span className="text-xl font-semibold font-mono tabular-nums text-slate-100">
                ${formatPrice(rezCandidate?.lastPrice)}
              </span>
              <span
                className={`text-sm font-mono tabular-nums ${
                  (rezCandidate?.priceChangePercent24h ?? 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'
                }`}
              >
                {formatPct(rezCandidate?.priceChangePercent24h)} (24h)
              </span>
              <span className="text-xs text-slate-400 font-mono tabular-nums">
                Vol: {formatUsd(rezCandidate?.quoteVolume24h)} · Score: {rezCandidate?.totalScore ?? 0}/100 ({rezCandidate?.classification ?? 'Pending'})
              </span>
            </div>
            {rezCandidate?.filterRejectReason && (
              <p className="mt-1.5 text-xs text-amber-400">
                Current Validation Note: {rezCandidate.filterRejectReason}
              </p>
            )}
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <button
              onClick={() => onInspectSymbol('REZUSDT')}
              className="px-4 py-2 text-xs font-medium rounded-lg border border-slate-700 text-slate-200 hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Open REZUSDT Chart & SMC
            </button>
          </div>
        </div>
      </div>

      {/* Top 10 Qualified Scalping Opportunities OR Disciplined NO TRADE State */}
      <div className="rounded-lg border border-slate-800/80 bg-[#111827]">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-5 py-4 border-b border-slate-800/80">
          <div>
            <h2 className="text-base font-semibold text-slate-100">
              Top 10 Qualified Scalping Opportunities
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Only signals scoring ≥ 80/100 with zero higher-timeframe conflicts are published. Last cycle:{' '}
              <span className="font-mono">{formatShortTime(scanResult?.scannedAt)}</span>
            </p>
          </div>
          <button
            onClick={() => onNavigate('scanner')}
            className="text-xs text-cyan-400 hover:text-cyan-300 font-medium whitespace-nowrap shrink-0 cursor-pointer"
          >
            View All Candidates →
          </button>
        </div>

        {scanLoading && !scanResult ? (
          <div className="p-8 text-center text-sm text-slate-400">
            Scanning Binance USDT-M Perpetual contracts across 4H, 1H, 15M, and 5M timeframes...
          </div>
        ) : topSignals.length === 0 ? (
          <div className="p-8 flex flex-col items-center text-center max-w-xl mx-auto">
            <ShieldAlert className="w-8 h-8 text-amber-400 mb-3" />
            <div className="text-lg font-semibold text-slate-100">NO TRADE — Strict Capital Preservation</div>
            <p className="text-sm text-slate-400 mt-2">
              {showEn &&
                'No pairs currently pass the 80/100 deterministic scoring and higher-timeframe alignment rules. Waiting for cleaner structure rather than forcing low-quality setups.'}
            </p>
            {showBn && (
              <p className="text-xs text-slate-400 mt-2">
                সহজ বাংলা: এই মুহূর্তে বাজারে নিরাপদ কোনো ট্রেডিং সুযোগ নেই। ঝুঁকি এড়াতে এখন কোনো সিগন্যাল দেওয়া হচ্ছে না।
              </p>
            )}
            <button
              onClick={() => onNavigate('scanner')}
              className="mt-4 px-4 py-2 text-xs font-medium rounded-lg border border-slate-700 text-slate-200 hover:bg-slate-800 transition-colors cursor-pointer"
            >
              Inspect Rejected Candidates
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-800/80 text-xs text-slate-400">
                  <th className="py-3 px-4 font-medium">Pair</th>
                  <th className="py-3 px-4 font-medium">Side · Order</th>
                  <th className="py-3 px-4 font-medium text-right">Score</th>
                  <th className="py-3 px-4 font-medium text-right">Entry Zone</th>
                  <th className="py-3 px-4 font-medium text-right">Stop Loss</th>
                  <th className="py-3 px-4 font-medium text-right">TP1 / TP2 / TP3</th>
                  <th className="py-3 px-4 font-medium text-right">R:R · Hold</th>
                  <th className="py-3 px-4 font-medium text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 text-sm">
                {topSignals.map((sig) => (
                  <tr
                    key={`${sig.symbol}-${sig.direction}`}
                    onClick={() => onSelectSignal(sig)}
                    className="hover:bg-slate-800/40 transition-colors cursor-pointer"
                  >
                    <td className="py-3 px-4 font-medium text-slate-100">
                      <div>{sig.symbol}</div>
                      <div className="text-xs text-slate-400">
                        4H {sig.technicalSummary.trend4h} · SMC {sig.smcSummary.bias15m}
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <span
                        className={`inline-flex items-center gap-1 font-mono text-xs font-semibold ${
                          sig.direction === 'LONG' ? 'text-emerald-400' : 'text-rose-400'
                        }`}
                      >
                        {sig.direction === 'LONG' ? (
                          <ArrowUpRight className="w-3.5 h-3.5" />
                        ) : (
                          <ArrowDownRight className="w-3.5 h-3.5" />
                        )}
                        {sig.direction}
                      </span>
                      <div className="text-xs text-slate-400">{sig.entryType}</div>
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums">
                      <div className="text-slate-100 font-semibold">{sig.totalScore}/100</div>
                      <div className="text-xs text-cyan-400">{sig.classification}</div>
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-200">
                      <div>{formatPrice(sig.entryLimitPrice)}</div>
                      <div className="text-xs text-slate-400">
                        {formatPrice(sig.entryZoneLow)} – {formatPrice(sig.entryZoneHigh)}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums text-rose-400">
                      {formatPrice(sig.stopLoss)}
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums text-emerald-400 text-xs">
                      <div>{formatPrice(sig.tp1)}</div>
                      <div>
                        {formatPrice(sig.tp2)} · {formatPrice(sig.tp3)}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-200">
                      <div>{sig.riskRewardRatio}:1</div>
                      <div className="text-xs text-slate-400">~{sig.estimatedHoldingMinutes}m</div>
                    </td>
                    <td className="py-3 px-4 text-right">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelectSignal(sig);
                        }}
                        className="px-3 py-1.5 text-xs font-medium rounded-md border border-slate-700 text-slate-200 hover:bg-slate-700 transition-colors cursor-pointer"
                      >
                        Details
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
