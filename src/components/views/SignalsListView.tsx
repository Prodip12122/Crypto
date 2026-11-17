import { useState } from 'react';
import { ArrowDownRight, ArrowUpRight, CheckCircle2, Database, RefreshCw } from 'lucide-react';
import { formatPrice, formatShortTime, type PersistedSignalRow } from '../../lib/format';
import type { ScannerRunResult, SignalEvaluation } from '../../types/trading';

interface SignalsListViewProps {
  mode: 'LONG' | 'SHORT' | 'HISTORY';
  scanResult: ScannerRunResult | null;
  persistedSignals: PersistedSignalRow[];
  isAuthenticated: boolean;
  onSignIn: () => void;
  onSelectLiveSignal: (sig: SignalEvaluation) => void;
  onSelectPersistedSignal: (sig: PersistedSignalRow) => void;
  onPersistScan: () => Promise<void>;
  onTickLifecycle: () => Promise<void>;
}

export function SignalsListView({
  mode,
  scanResult,
  persistedSignals,
  isAuthenticated,
  onSignIn,
  onSelectLiveSignal,
  onSelectPersistedSignal,
  onPersistScan,
  onTickLifecycle,
}: SignalsListViewProps) {
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [busy, setBusy] = useState(false);

  const liveFiltered =
    mode === 'HISTORY'
      ? []
      : (scanResult?.topSignals ?? []).filter((s) => s.direction === mode);

  const dbFiltered = persistedSignals.filter((s) => {
    if (mode !== 'HISTORY' && s.direction !== mode) return false;
    if (statusFilter !== 'ALL' && s.status !== statusFilter) return false;
    return true;
  });

  const handleAction = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-100">
            {mode === 'LONG' && 'LONG Scalping Signals'}
            {mode === 'SHORT' && 'SHORT Scalping Signals'}
            {mode === 'HISTORY' && 'Signal Lifecycle History (PostgreSQL)'}
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            {mode === 'HISTORY'
              ? 'Persisted signals with real-time WAITING_FOR_ENTRY, ENTRY_FILLED, TP1/TP2/TP3, SL_HIT, and EXPIRED tracking.'
              : `Qualified ${mode} opportunities passing 100-point scoring and multi-timeframe trend confirmation.`}
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {isAuthenticated ? (
            <>
              <button
                onClick={() => handleAction(onTickLifecycle)}
                disabled={busy}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border border-slate-700 text-slate-200 hover:bg-slate-800 disabled:opacity-50 cursor-pointer"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${busy ? 'animate-spin' : ''}`} />
                Check Live Lifecycle
              </button>
              <button
                onClick={() => handleAction(onPersistScan)}
                disabled={busy}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg bg-cyan-500 text-slate-950 hover:bg-cyan-400 disabled:opacity-50 cursor-pointer"
              >
                <Database className="w-3.5 h-3.5" />
                Save & Dispatch Top 10
              </button>
            </>
          ) : (
            <button
              onClick={onSignIn}
              className="px-4 py-2 text-xs font-semibold rounded-lg bg-cyan-500 text-slate-950 hover:bg-cyan-400 cursor-pointer"
            >
              Sign in to Save & Track Lifecycle
            </button>
          )}
        </div>
      </div>

      {/* Live Qualified Signals Section for LONG/SHORT views */}
      {mode !== 'HISTORY' && (
        <div className="rounded-lg border border-slate-800/80 bg-[#111827]">
          <div className="px-4 py-3 border-b border-slate-800/80 text-xs font-medium text-slate-300">
            Live Scanner Qualified {mode} Setups ({liveFiltered.length})
          </div>
          {liveFiltered.length === 0 ? (
            <div className="p-6 text-sm text-slate-400 text-center">
              No qualified {mode} setups in the latest scan cycle.
            </div>
          ) : (
            <div className="divide-y divide-slate-800/60">
              {liveFiltered.map((sig) => (
                <div
                  key={sig.symbol}
                  onClick={() => onSelectLiveSignal(sig)}
                  className="p-4 flex flex-col md:flex-row md:items-center justify-between gap-4 hover:bg-slate-800/35 cursor-pointer"
                >
                  <div>
                    <div className="flex items-center gap-3">
                      <span className="font-semibold text-slate-100">{sig.symbol}</span>
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
                        {sig.direction} · {sig.entryType}
                      </span>
                      <span className="font-mono text-xs text-cyan-400">
                        {sig.totalScore}/100 ({sig.classification})
                      </span>
                    </div>
                    <p className="text-xs text-slate-400 mt-1">{sig.deterministicRationaleEn}</p>
                  </div>
                  <div className="flex items-center gap-6 font-mono text-xs tabular-nums shrink-0">
                    <div>
                      <div className="text-slate-500">Entry</div>
                      <div className="text-slate-100">{formatPrice(sig.entryLimitPrice)}</div>
                    </div>
                    <div>
                      <div className="text-slate-500">SL</div>
                      <div className="text-rose-400">{formatPrice(sig.stopLoss)}</div>
                    </div>
                    <div>
                      <div className="text-slate-500">TP2 (2R)</div>
                      <div className="text-emerald-400">{formatPrice(sig.tp2)}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Persisted PostgreSQL Signal History */}
      <div className="rounded-lg border border-slate-800/80 bg-[#111827]">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-4 py-3 border-b border-slate-800/80">
          <div className="text-xs font-medium text-slate-300 flex items-center gap-2">
            <CheckCircle2 className="w-3.5 h-3.5 text-cyan-400" />
            Persisted PostgreSQL Signals ({dbFiltered.length})
          </div>
          <div className="flex flex-wrap items-center gap-1">
            {['ALL', 'WAITING_FOR_ENTRY', 'ENTRY_FILLED', 'TP1_HIT', 'TP2_HIT', 'TP3_HIT', 'SL_HIT', 'EXPIRED'].map(
              (st) => (
                <button
                  key={st}
                  onClick={() => setStatusFilter(st)}
                  className={`px-2 py-1 text-[11px] font-mono rounded transition-colors cursor-pointer ${
                    statusFilter === st ? 'bg-slate-800 text-cyan-400' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {st}
                </button>
              )
            )}
          </div>
        </div>

        {!isAuthenticated ? (
          <div className="p-8 text-center text-sm text-slate-400">
            Sign in with Google to view and manage your persisted Cloud SQL signal lifecycle log.
          </div>
        ) : dbFiltered.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-400">
            No persisted signals match this filter yet. Click &ldquo;Save &amp; Dispatch Top 10&rdquo; to archive qualified signals.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-800/80 text-xs text-slate-400">
                  <th className="py-3 px-4 font-medium">Time · Pair</th>
                  <th className="py-3 px-4 font-medium">Direction</th>
                  <th className="py-3 px-4 font-medium">Status</th>
                  <th className="py-3 px-4 font-medium text-right">Score</th>
                  <th className="py-3 px-4 font-medium text-right">Entry</th>
                  <th className="py-3 px-4 font-medium text-right">SL / TP2</th>
                  <th className="py-3 px-4 font-medium text-right">Outcome (R)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 text-sm">
                {dbFiltered.map((row) => (
                  <tr
                    key={row.id}
                    onClick={() => onSelectPersistedSignal(row)}
                    className="hover:bg-slate-800/40 cursor-pointer"
                  >
                    <td className="py-3 px-4">
                      <div className="font-medium text-slate-100">{row.symbol}</div>
                      <div className="text-xs text-slate-400 font-mono">
                        {formatShortTime(row.createdAt)}
                      </div>
                    </td>
                    <td className="py-3 px-4 font-mono text-xs">
                      <span className={row.direction === 'LONG' ? 'text-emerald-400' : 'text-rose-400'}>
                        {row.direction}
                      </span>{' '}
                      <span className="text-slate-400">· {row.entryType}</span>
                    </td>
                    <td className="py-3 px-4 font-mono text-xs text-slate-200">
                      {row.status}
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums text-cyan-400">
                      {row.totalScore}/100
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-200">
                      {formatPrice(row.entryLimitPrice)}
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums text-xs">
                      <span className="text-rose-400">{formatPrice(row.stopLoss)}</span>
                      <span className="text-slate-500"> / </span>
                      <span className="text-emerald-400">{formatPrice(row.tp2)}</span>
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums">
                      {row.realizedPnlR !== null ? (
                        <span className={row.realizedPnlR >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                          {row.realizedPnlR >= 0 ? '+' : ''}
                          {row.realizedPnlR}R
                        </span>
                      ) : (
                        <span className="text-slate-500">—</span>
                      )}
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
