import { useEffect, useState } from 'react';
import { Play, Save } from 'lucide-react';
import { formatPct, formatPrice, formatUsd, type PerformanceOverviewRow, type PersistedSignalRow } from '../../lib/format';
import type { BacktestReport, Timeframe } from '../../types/trading';

interface PerformanceBacktestViewProps {
  mode: 'performance' | 'backtesting';
  performance: PerformanceOverviewRow | null;
  persistedSignals: PersistedSignalRow[];
  isAuthenticated: boolean;
  authFetch: (input: string, init?: RequestInit) => Promise<Response>;
  onSignIn: () => void;
}

export function PerformanceBacktestView({
  mode,
  performance,
  persistedSignals,
  isAuthenticated,
  authFetch,
  onSignIn,
}: PerformanceBacktestViewProps) {
  const [symbol, setSymbol] = useState('REZUSDT');
  const [timeframe, setTimeframe] = useState<Timeframe>('15m');
  const [splitMode, setSplitMode] = useState<'train' | 'validation' | 'out_of_sample' | 'full'>('out_of_sample');
  const [initialEquity, setInitialEquity] = useState(10000);
  const [riskPct, setRiskPct] = useState(1.0);
  const [feeBps, setFeeBps] = useState(4);
  const [slippageBps, setSlippageBps] = useState(2);
  const [minScore, setMinScore] = useState(75);
  const [report, setReport] = useState<BacktestReport | null>(null);
  const [savedBacktests, setSavedBacktests] = useState<Array<{ id: string; symbol: string; timeframe: string; splitMode: string; winRatePct: number; profitFactor: number; netPnlUsd: number; maxDrawdownPct: number; createdAt: string }>>([]);
  const [running, setRunning] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isAuthenticated) return;
    authFetch('/api/backtests')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.backtests) setSavedBacktests(data.backtests);
      })
      .catch(() => {});
  }, [isAuthenticated, authFetch]);

  const handleRunBacktest = async () => {
    setRunning(true);
    setError(null);
    setSaveMessage(null);
    try {
      const res = await fetch('/api/market/backtest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol,
          timeframe,
          splitMode,
          initialEquity,
          riskPerTradePct: riskPct,
          feeBps,
          slippageBps,
          minScore,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Backtest failed');
      setReport(data as BacktestReport);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Backtest failed');
    } finally {
      setRunning(false);
    }
  };

  const handleSave = async () => {
    if (!report || !isAuthenticated) return;
    const res = await authFetch('/api/backtests/save', {
      method: 'POST',
      body: JSON.stringify({ report, riskPerTradePct: riskPct, feeBps, slippageBps }),
    });
    if (res.ok) {
      setSaveMessage('Backtest report archived to PostgreSQL.');
      const listRes = await authFetch('/api/backtests');
      if (listRes.ok) {
        const d = await listRes.json();
        setSavedBacktests(d.backtests || []);
      }
    }
  };

  if (mode === 'performance') {
    const completed = persistedSignals.filter((s) =>
      ['TP1_HIT', 'TP2_HIT', 'TP3_HIT', 'SL_HIT'].includes(s.status)
    );
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-semibold text-slate-100">Performance Analytics</h1>
          <p className="text-xs text-slate-400 mt-1">
            Verified outcomes of filled signals only (unfilled LIMIT expirations are excluded from win-rate calculations).
          </p>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <div className="rounded-lg border border-slate-800/80 bg-[#111827] p-4">
            <div className="text-xs text-slate-400">Total / Filled</div>
            <div className="mt-1 text-2xl font-mono font-semibold tabular-nums text-slate-100">
              {performance?.totalSignals ?? 0} <span className="text-sm text-slate-500">/ {performance?.filledSignals ?? 0}</span>
            </div>
          </div>
          <div className="rounded-lg border border-slate-800/80 bg-[#111827] p-4">
            <div className="text-xs text-slate-400">Win Rate (Filled)</div>
            <div className="mt-1 text-2xl font-mono font-semibold tabular-nums text-emerald-400">
              {performance ? `${performance.winRatePct.toFixed(1)}%` : '0.0%'}
            </div>
          </div>
          <div className="rounded-lg border border-slate-800/80 bg-[#111827] p-4">
            <div className="text-xs text-slate-400">TP1 / TP2 / TP3 / SL</div>
            <div className="mt-1 text-sm font-mono font-semibold tabular-nums text-slate-100">
              {performance?.tp1Hits ?? 0} / {performance?.tp2Hits ?? 0} / {performance?.tp3Hits ?? 0} /{' '}
              <span className="text-rose-400">{performance?.slHits ?? 0}</span>
            </div>
          </div>
          <div className="rounded-lg border border-slate-800/80 bg-[#111827] p-4">
            <div className="text-xs text-slate-400">Avg R-Multiple</div>
            <div className="mt-1 text-2xl font-mono font-semibold tabular-nums text-cyan-400">
              {performance ? `${performance.avgR.toFixed(2)}R` : '0.00R'}
            </div>
          </div>
          <div className="rounded-lg border border-slate-800/80 bg-[#111827] p-4">
            <div className="text-xs text-slate-400">Net PnL · Max DD</div>
            <div className="mt-1 text-lg font-mono font-semibold tabular-nums text-slate-100">
              {performance ? formatPct(performance.netPnlPct) : '0.00%'} ·{' '}
              <span className="text-rose-400">
                {performance ? `${performance.maxDrawdownPct.toFixed(2)}%` : '0.00%'}
              </span>
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-slate-800/80 bg-[#111827] p-5">
          <h2 className="text-sm font-semibold text-slate-100 mb-3">
            Completed Trade Outcomes ({completed.length})
          </h2>
          {!isAuthenticated ? (
            <div className="text-sm text-slate-400">
              Sign in with Google to inspect your persisted signal performance ledger.
            </div>
          ) : completed.length === 0 ? (
            <div className="text-sm text-slate-400">
              No completed filled trades yet. Use &ldquo;Check Live Lifecycle&rdquo; on Signal History as price hits TP/SL levels.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400">
                    <th className="py-2 px-3">Pair</th>
                    <th className="py-2 px-3">Side</th>
                    <th className="py-2 px-3">Outcome</th>
                    <th className="py-2 px-3 text-right">Score</th>
                    <th className="py-2 px-3 text-right">Realized R</th>
                    <th className="py-2 px-3">Ambiguity Note</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 font-mono tabular-nums">
                  {completed.map((c) => (
                    <tr key={c.id}>
                      <td className="py-2 px-3 text-slate-100">{c.symbol}</td>
                      <td className="py-2 px-3">{c.direction}</td>
                      <td className="py-2 px-3 text-cyan-400">{c.status}</td>
                      <td className="py-2 px-3 text-right">{c.totalScore}</td>
                      <td className={`py-2 px-3 text-right ${(c.realizedPnlR ?? 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {c.realizedPnlR ?? 0}R
                      </td>
                      <td className="py-2 px-3 text-slate-400 font-sans">
                        {c.ambiguousResolution || 'Clean intrabar order'}
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

  // Backtesting View
  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-100">Chronological Historical Backtesting</h1>
          <p className="text-xs text-slate-400 mt-1">
            Strict causal replay on Binance Futures historical OHLCV with trading fees, slippage, funding accrual, and out-of-sample splits.
          </p>
        </div>
      </div>

      {/* Config Form */}
      <div className="rounded-lg border border-slate-800/80 bg-[#111827] p-5">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
          <div>
            <label className="block text-slate-400 mb-1">Symbol</label>
            <input
              type="text"
              value={symbol}
              onChange={(e) => setSymbol(e.target.value.toUpperCase())}
              className="w-full px-3 py-2 rounded bg-[#090d16] border border-slate-800 font-mono text-slate-100"
            />
          </div>
          <div>
            <label className="block text-slate-400 mb-1">Timeframe</label>
            <select
              value={timeframe}
              onChange={(e) => setTimeframe(e.target.value as Timeframe)}
              className="w-full px-3 py-2 rounded bg-[#090d16] border border-slate-800 font-mono text-slate-100"
            >
              <option value="5m">5M</option>
              <option value="15m">15M</option>
              <option value="1h">1H</option>
              <option value="4h">4H</option>
            </select>
          </div>
          <div>
            <label className="block text-slate-400 mb-1">Chronological Split</label>
            <select
              value={splitMode}
              onChange={(e) => setSplitMode(e.target.value as typeof splitMode)}
              className="w-full px-3 py-2 rounded bg-[#090d16] border border-slate-800 font-mono text-slate-100"
            >
              <option value="out_of_sample">Out-of-Sample (Last 45%)</option>
              <option value="validation">Validation (40%–80%)</option>
              <option value="train">Train (First 60%)</option>
              <option value="full">Full Window (500 bars)</option>
            </select>
          </div>
          <div>
            <label className="block text-slate-400 mb-1">Initial Equity ($)</label>
            <input
              type="number"
              value={initialEquity}
              onChange={(e) => setInitialEquity(Number(e.target.value))}
              className="w-full px-3 py-2 rounded bg-[#090d16] border border-slate-800 font-mono text-slate-100"
            />
          </div>
          <div>
            <label className="block text-slate-400 mb-1">Risk / Trade (%)</label>
            <input
              type="number"
              step="0.25"
              value={riskPct}
              onChange={(e) => setRiskPct(Number(e.target.value))}
              className="w-full px-3 py-2 rounded bg-[#090d16] border border-slate-800 font-mono text-slate-100"
            />
          </div>
          <div>
            <label className="block text-slate-400 mb-1">Fee (bps / side)</label>
            <input
              type="number"
              value={feeBps}
              onChange={(e) => setFeeBps(Number(e.target.value))}
              className="w-full px-3 py-2 rounded bg-[#090d16] border border-slate-800 font-mono text-slate-100"
            />
          </div>
          <div>
            <label className="block text-slate-400 mb-1">Slippage (bps)</label>
            <input
              type="number"
              value={slippageBps}
              onChange={(e) => setSlippageBps(Number(e.target.value))}
              className="w-full px-3 py-2 rounded bg-[#090d16] border border-slate-800 font-mono text-slate-100"
            />
          </div>
          <div>
            <label className="block text-slate-400 mb-1">Min Entry Score</label>
            <input
              type="number"
              value={minScore}
              onChange={(e) => setMinScore(Number(e.target.value))}
              className="w-full px-3 py-2 rounded bg-[#090d16] border border-slate-800 font-mono text-slate-100"
            />
          </div>
        </div>

        <div className="mt-4 flex items-center gap-3">
          <button
            onClick={handleRunBacktest}
            disabled={running}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-lg bg-cyan-500 text-slate-950 hover:bg-cyan-400 disabled:opacity-50 cursor-pointer"
          >
            <Play className="w-3.5 h-3.5" />
            {running ? 'Running Replay...' : 'Run Backtest'}
          </button>
          {report && (
            isAuthenticated ? (
              <button
                onClick={handleSave}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-lg border border-slate-700 text-slate-200 hover:bg-slate-800 cursor-pointer"
              >
                <Save className="w-3.5 h-3.5" />
                Save to PostgreSQL
              </button>
            ) : (
              <button
                onClick={onSignIn}
                className="px-4 py-2 text-xs font-medium rounded-lg border border-slate-700 text-cyan-400 hover:bg-slate-800 cursor-pointer"
              >
                Sign in to Archive Backtest
              </button>
            )
          )}
          {saveMessage && <span className="text-xs text-emerald-400">{saveMessage}</span>}
        </div>
        {error && <div className="mt-3 text-xs text-rose-400">{error}</div>}
      </div>

      {report && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
            <div className="rounded-lg border border-slate-800/80 bg-[#111827] p-3.5">
              <div className="text-xs text-slate-400">Net PnL</div>
              <div
                className={`mt-1 text-lg font-mono font-semibold tabular-nums ${
                  report.netPnlUsd >= 0 ? 'text-emerald-400' : 'text-rose-400'
                }`}
              >
                {formatUsd(report.netPnlUsd)}
              </div>
            </div>
            <div className="rounded-lg border border-slate-800/80 bg-[#111827] p-3.5">
              <div className="text-xs text-slate-400">Win Rate</div>
              <div className="mt-1 text-lg font-mono font-semibold tabular-nums text-slate-100">
                {report.winRatePct}% ({report.wins}/{report.totalTrades})
              </div>
            </div>
            <div className="rounded-lg border border-slate-800/80 bg-[#111827] p-3.5">
              <div className="text-xs text-slate-400">Profit Factor</div>
              <div className="mt-1 text-lg font-mono font-semibold tabular-nums text-cyan-400">
                {report.profitFactor}
              </div>
            </div>
            <div className="rounded-lg border border-slate-800/80 bg-[#111827] p-3.5">
              <div className="text-xs text-slate-400">Expectancy · Avg R</div>
              <div className="mt-1 text-lg font-mono font-semibold tabular-nums text-slate-100">
                {report.expectancyR}R · {report.averageR}R
              </div>
            </div>
            <div className="rounded-lg border border-slate-800/80 bg-[#111827] p-3.5">
              <div className="text-xs text-slate-400">Max Drawdown</div>
              <div className="mt-1 text-lg font-mono font-semibold tabular-nums text-rose-400">
                {report.maxDrawdownPct}%
              </div>
            </div>
            <div className="rounded-lg border border-slate-800/80 bg-[#111827] p-3.5">
              <div className="text-xs text-slate-400">Avg Hold Time</div>
              <div className="mt-1 text-lg font-mono font-semibold tabular-nums text-slate-100">
                {report.avgHoldingMinutes}m
              </div>
            </div>
          </div>

          {/* Equity Curve SVG */}
          <div className="rounded-lg border border-slate-800/80 bg-[#111827] p-5">
            <div className="flex justify-between text-xs text-slate-400 mb-3">
              <span>Equity Curve ({report.candlesAnalyzed} candles · {report.splitMode})</span>
              <span className="font-mono tabular-nums">
                Final: {formatUsd(report.finalEquity)}
              </span>
            </div>
            <EquityCurveChart points={report.equityCurve} />
          </div>

          {/* Trades Log */}
          <div className="rounded-lg border border-slate-800/80 bg-[#111827] overflow-x-auto">
            <div className="px-4 py-3 border-b border-slate-800/80 text-xs font-medium text-slate-300">
              Simulated Chronological Trades ({report.tradesLog.length})
            </div>
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-800/80 text-slate-400">
                  <th className="py-2.5 px-4">Entry Time</th>
                  <th className="py-2.5 px-4">Side</th>
                  <th className="py-2.5 px-4">Outcome</th>
                  <th className="py-2.5 px-4 text-right">Entry</th>
                  <th className="py-2.5 px-4 text-right">Exit</th>
                  <th className="py-2.5 px-4 text-right">Fees + Funding</th>
                  <th className="py-2.5 px-4 text-right">PnL (R / $)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-mono tabular-nums">
                {report.tradesLog.map((t, idx) => (
                  <tr key={idx}>
                    <td className="py-2.5 px-4 text-slate-300">
                      {new Date(t.entryTime).toLocaleString()}
                    </td>
                    <td className={`py-2.5 px-4 ${t.direction === 'LONG' ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {t.direction}
                    </td>
                    <td className="py-2.5 px-4 text-slate-200">{t.outcome}</td>
                    <td className="py-2.5 px-4 text-right text-slate-200">{formatPrice(t.entryPrice)}</td>
                    <td className="py-2.5 px-4 text-right text-slate-200">{formatPrice(t.exitPrice)}</td>
                    <td className="py-2.5 px-4 text-right text-slate-400">${t.feesUsd.toFixed(2)}</td>
                    <td className={`py-2.5 px-4 text-right ${t.pnlUsd >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {t.pnlR}R ({formatUsd(t.pnlUsd)})
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {savedBacktests.length > 0 && (
        <div className="rounded-lg border border-slate-800/80 bg-[#111827] p-5">
          <h2 className="text-sm font-semibold text-slate-100 mb-3">Archived Backtests (PostgreSQL)</h2>
          <div className="divide-y divide-slate-800/60 text-xs font-mono tabular-nums">
            {savedBacktests.map((b) => (
              <div key={b.id} className="py-2.5 flex items-center justify-between gap-4">
                <span className="text-slate-100">
                  {b.symbol} · {b.timeframe.toUpperCase()} · {b.splitMode}
                </span>
                <span className="text-slate-400">
                  WR {b.winRatePct}% · PF {b.profitFactor} · DD {b.maxDrawdownPct}% ·{' '}
                  <span className={b.netPnlUsd >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                    {formatUsd(b.netPnlUsd)}
                  </span>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function EquityCurveChart({ points }: { points: Array<{ time: string; equity: number }> }) {
  if (points.length < 2) {
    return <div className="text-xs text-slate-500 py-8 text-center">Not enough trades to plot curve.</div>;
  }
  const width = 800;
  const height = 180;
  const pad = 16;
  const vals = points.map((p) => p.equity);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const range = Math.max(max - min, 1);

  const coords = points.map((p, idx) => {
    const x = pad + (idx / (points.length - 1)) * (width - pad * 2);
    const y = height - pad - ((p.equity - min) / range) * (height - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-44 bg-[#090d16] rounded border border-slate-800/70">
      <polyline
        fill="none"
        stroke="#22d3ee"
        strokeWidth="2"
        points={coords.join(' ')}
      />
    </svg>
  );
}
