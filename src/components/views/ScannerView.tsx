import { useMemo, useState } from 'react';
import { RefreshCw, Search } from 'lucide-react';
import { formatPct, formatPrice, formatUsd } from '../../lib/format';
import type { ScannerRunResult, SignalEvaluation } from '../../types/trading';

interface ScannerViewProps {
  scanResult: ScannerRunResult | null;
  scanLoading: boolean;
  onRunScan: () => void;
  onSelectSignal: (sig: SignalEvaluation) => void;
  onInspectSymbol: (symbol: string) => void;
}

export function ScannerView({
  scanResult,
  scanLoading,
  onRunScan,
  onSelectSignal,
  onInspectSymbol,
}: ScannerViewProps) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'passed' | 'rejected' | 'priority'>('all');

  const filtered = useMemo(() => {
    const list = scanResult?.allCandidates ?? [];
    return list.filter((item) => {
      if (query.trim() && !item.symbol.toLowerCase().includes(query.trim().toLowerCase())) {
        return false;
      }
      if (filter === 'passed') return item.filterPassed;
      if (filter === 'rejected') return !item.filterPassed;
      if (filter === 'priority') return item.isPriority;
      return true;
    });
  }, [scanResult, query, filter]);

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-100">Live Market Scanner</h1>
          <p className="text-xs text-slate-400 mt-1">
            Dynamically discovers all Binance USDT-M Perpetual contracts, filters liquidity & spread, and scores Top candidates.
          </p>
        </div>
        <button
          onClick={onRunScan}
          disabled={scanLoading}
          className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-lg bg-cyan-500 text-slate-950 hover:bg-cyan-400 disabled:opacity-50 transition-colors cursor-pointer shrink-0"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${scanLoading ? 'animate-spin' : ''}`} />
          {scanLoading ? 'Scanning...' : 'Refresh Scanner'}
        </button>
      </div>

      {/* Filter & Search Toolbar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 rounded-lg border border-slate-800/80 bg-[#111827] p-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter symbol (e.g. REZUSDT, BTCUSDT)..."
            className="w-full pl-9 pr-3 py-1.5 text-sm bg-[#090d16] border border-slate-800 rounded-md text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-cyan-500"
          />
        </div>

        <div className="flex items-center gap-1 p-1 bg-[#090d16] rounded-lg border border-slate-800/80">
          {(['all', 'passed', 'rejected', 'priority'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setFilter(tab)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                filter === tab
                  ? 'bg-slate-800 text-cyan-400'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {tab === 'all' && `All (${scanResult?.allCandidates.length ?? 0})`}
              {tab === 'passed' && `Qualified (${scanResult?.validSignalsCount ?? 0})`}
              {tab === 'rejected' && `Rejected (${scanResult?.rejectedCount ?? 0})`}
              {tab === 'priority' && 'REZUSDT Priority'}
            </button>
          ))}
        </div>
      </div>

      {/* Scanner Table */}
      <div className="rounded-lg border border-slate-800/80 bg-[#111827] overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-slate-800/80 text-xs text-slate-400">
              <th className="py-3 px-4 font-medium">Symbol</th>
              <th className="py-3 px-4 font-medium text-right">Last Price</th>
              <th className="py-3 px-4 font-medium text-right">24h Change</th>
              <th className="py-3 px-4 font-medium text-right">24h Volume</th>
              <th className="py-3 px-4 font-medium text-right">Spread</th>
              <th className="py-3 px-4 font-medium text-right">Funding</th>
              <th className="py-3 px-4 font-medium text-right">Score · Bias</th>
              <th className="py-3 px-4 font-medium">Validation Verdict</th>
              <th className="py-3 px-4 font-medium text-right">Inspect</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60 text-sm">
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={9} className="py-8 text-center text-slate-400 text-sm">
                  {scanLoading ? 'Running multi-timeframe scanner...' : 'No matching coins found.'}
                </td>
              </tr>
            ) : (
              filtered.map((c) => (
                <tr key={c.symbol} className="hover:bg-slate-800/35 transition-colors">
                  <td className="py-3 px-4 font-medium text-slate-100">
                    <div>{c.symbol}</div>
                    {c.isPriority && <div className="text-xs text-cyan-400">Priority Watchlist</div>}
                  </td>
                  <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-200">
                    ${formatPrice(c.lastPrice)}
                  </td>
                  <td
                    className={`py-3 px-4 text-right font-mono tabular-nums ${
                      c.priceChangePercent24h >= 0 ? 'text-emerald-400' : 'text-rose-400'
                    }`}
                  >
                    {formatPct(c.priceChangePercent24h)}
                  </td>
                  <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-300">
                    {formatUsd(c.quoteVolume24h)}
                  </td>
                  <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-300">
                    {c.spreadBps.toFixed(1)} bps
                  </td>
                  <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-300">
                    {(c.fundingRate * 100).toFixed(4)}%
                  </td>
                  <td className="py-3 px-4 text-right font-mono tabular-nums">
                    <span
                      className={
                        c.totalScore >= 80 ? 'text-cyan-400 font-semibold' : 'text-slate-300'
                      }
                    >
                      {c.totalScore}/100
                    </span>
                    <div className="text-xs text-slate-400">
                      {c.bestDirection ?? '—'} · {c.classification}
                    </div>
                  </td>
                  <td className="py-3 px-4 text-xs max-w-xs">
                    {c.filterPassed ? (
                      <span className="text-emerald-400 font-medium">
                        Qualified ({c.evaluation?.entryType})
                      </span>
                    ) : (
                      <span className="text-slate-400">{c.filterRejectReason || 'Rejected'}</span>
                    )}
                  </td>
                  <td className="py-3 px-4 text-right">
                    <div className="inline-flex items-center gap-2">
                      {c.evaluation && (
                        <button
                          onClick={() => onSelectSignal(c.evaluation!)}
                          className="px-2.5 py-1 text-xs rounded border border-slate-700 text-slate-200 hover:bg-slate-800 cursor-pointer"
                        >
                          Signal
                        </button>
                      )}
                      <button
                        onClick={() => onInspectSymbol(c.symbol)}
                        className="px-2.5 py-1 text-xs rounded border border-slate-700 text-cyan-400 hover:bg-slate-800 cursor-pointer"
                      >
                        Chart
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
