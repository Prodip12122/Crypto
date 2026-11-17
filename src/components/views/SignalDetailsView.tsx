import { useEffect, useState } from 'react';
import { ArrowLeft, Send, Sparkles } from 'lucide-react';
import { CandlestickChart } from '../CandlestickChart';
import { formatPrice, formatShortTime, formatUsd, type PersistedSignalRow } from '../../lib/format';
import type { Candle, SignalEvaluation } from '../../types/trading';

interface SignalDetailsViewProps {
  liveSignal: SignalEvaluation | null;
  persistedSignal: PersistedSignalRow | null;
  isAuthenticated: boolean;
  langMode: 'en' | 'bn' | 'en_bn';
  authFetch: (input: string, init?: RequestInit) => Promise<Response>;
  onSignIn: () => void;
  onPublishSignal: (sig: SignalEvaluation) => Promise<void>;
  onBack: () => void;
}

const SCORE_WEIGHTS: Array<{ key: string; label: string; max: number }> = [
  { key: 'mtfTrend', label: 'Multi-Timeframe Trend', max: 20 },
  { key: 'momentum', label: 'Momentum (RSI / MACD / ADX)', max: 15 },
  { key: 'volumeOrderBook', label: 'Volume & Order Book', max: 15 },
  { key: 'smc', label: 'Smart Money Concepts', max: 20 },
  { key: 'supportResistance', label: 'Support & Resistance / VWAP', max: 10 },
  { key: 'fundingOi', label: 'Funding & Open Interest', max: 10 },
  { key: 'fundamentalBtc', label: 'Fundamental & BTC Context', max: 5 },
  { key: 'entryRiskQuality', label: 'Entry & Risk Quality', max: 5 },
];

export function SignalDetailsView({
  liveSignal,
  persistedSignal,
  isAuthenticated,
  langMode,
  authFetch,
  onSignIn,
  onPublishSignal,
  onBack,
}: SignalDetailsViewProps) {
  const [candles, setCandles] = useState<Candle[]>([]);
  const [tf, setTf] = useState<'5m' | '15m' | '1h' | '4h'>('5m');
  const [aiEn, setAiEn] = useState<string | null>(null);
  const [aiBn, setAiBn] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [publishNotice, setPublishNotice] = useState<string | null>(null);
  const [events, setEvents] = useState<Array<{ id: string; eventType: string; newStatus: string; triggerPrice: number; note: string; createdAt: string }>>([]);

  const symbol = persistedSignal?.symbol || liveSignal?.symbol || 'REZUSDT';
  const direction = persistedSignal?.direction || liveSignal?.direction || 'LONG';
  const entryType = persistedSignal?.entryType || liveSignal?.entryType || 'LIMIT';
  const totalScore = persistedSignal?.totalScore ?? liveSignal?.totalScore ?? 0;
  const classification = persistedSignal?.classification || liveSignal?.classification || 'Rejected';
  const entryPrice = persistedSignal?.entryLimitPrice ?? liveSignal?.entryLimitPrice ?? 0;
  const zoneLow = persistedSignal?.entryZoneLow ?? liveSignal?.entryZoneLow ?? 0;
  const zoneHigh = persistedSignal?.entryZoneHigh ?? liveSignal?.entryZoneHigh ?? 0;
  const stopLoss = persistedSignal?.stopLoss ?? liveSignal?.stopLoss ?? 0;
  const tp1 = persistedSignal?.tp1 ?? liveSignal?.tp1 ?? 0;
  const tp2 = persistedSignal?.tp2 ?? liveSignal?.tp2 ?? 0;
  const tp3 = persistedSignal?.tp3 ?? liveSignal?.tp3 ?? 0;
  const rr = persistedSignal?.riskRewardRatio ?? liveSignal?.riskRewardRatio ?? 0;
  const posSize = persistedSignal?.positionSizeUsd ?? liveSignal?.positionSizeUsd ?? 0;
  const leverage = persistedSignal?.leverage ?? liveSignal?.leverage ?? 1;
  const holdMins = persistedSignal?.estimatedHoldingMinutes ?? liveSignal?.estimatedHoldingMinutes ?? 30;
  const breakdown: Record<string, number> =
    persistedSignal?.scoreBreakdown || (liveSignal?.scoreBreakdown as unknown as Record<string, number>) || {};

  const showEn = langMode === 'en' || langMode === 'en_bn';
  const showBn = langMode === 'bn' || langMode === 'en_bn';

  const defaultEn = persistedSignal?.aiExplanationEn || liveSignal?.deterministicRationaleEn || '';
  const defaultBn = persistedSignal?.aiExplanationBn || liveSignal?.deterministicRationaleBn || '';

  useEffect(() => {
    setAiEn(null);
    setAiBn(null);
    setPublishNotice(null);
  }, [symbol, persistedSignal?.id]);

  useEffect(() => {
    let active = true;
    fetch(`/api/market/analyze/${encodeURIComponent(symbol)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!active || !data) return;
        const map = {
          '5m': data.candles5m,
          '15m': data.candles15m,
          '1h': data.candles1h,
          '4h': data.candles4h,
        };
        setCandles(map[tf] || data.candles5m || []);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [symbol, tf]);

  useEffect(() => {
    if (!persistedSignal?.id || !isAuthenticated) {
      setEvents([]);
      return;
    }
    authFetch(`/api/signals/${persistedSignal.id}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.events) setEvents(data.events);
      })
      .catch(() => {});
  }, [persistedSignal?.id, isAuthenticated, authFetch]);

  const handleGenerateAi = async () => {
    if (!liveSignal && !persistedSignal) return;
    setAiLoading(true);
    try {
      const payload = liveSignal || {
        symbol,
        direction,
        entryType,
        totalScore,
        classification,
        entryLimitPrice: entryPrice,
        entryZoneLow: zoneLow,
        entryZoneHigh: zoneHigh,
        stopLoss,
        tp1,
        tp2,
        tp3,
        riskRewardRatio: rr,
        estimatedHoldingMinutes: holdMins,
        scoreBreakdown: breakdown,
        technicalSummary: persistedSignal?.technicalSummary || {},
        smcSummary: persistedSignal?.smcSummary || {},
        fundamentalContext: persistedSignal?.fundamentalContext || {},
      };
      const res = await authFetch('/api/gemini/explain-signal', {
        method: 'POST',
        body: JSON.stringify({ signal: payload }),
      });
      if (res.ok) {
        const data = (await res.json()) as { explanationEn: string; explanationBn: string };
        setAiEn(data.explanationEn);
        setAiBn(data.explanationBn);
      }
    } finally {
      setAiLoading(false);
    }
  };

  const handlePublish = async () => {
    if (!liveSignal) return;
    setPublishing(true);
    setPublishNotice(null);
    try {
      await onPublishSignal(liveSignal);
      setPublishNotice('Signal persisted to PostgreSQL and queued for Telegram delivery.');
    } catch (err) {
      setPublishNotice(err instanceof Error ? err.message : 'Failed to publish signal.');
    } finally {
      setPublishing(false);
    }
  };

  if (!liveSignal && !persistedSignal) {
    return (
      <div className="rounded-lg border border-slate-800/80 bg-[#111827] p-8 text-center">
        <p className="text-sm text-slate-400">Select any signal from the Dashboard, Scanner, or History to inspect full trade levels, 100-point scoring, and AI analysis.</p>
        <button
          onClick={onBack}
          className="mt-4 px-4 py-2 text-xs font-medium rounded-lg border border-slate-700 text-slate-200 hover:bg-slate-800 cursor-pointer"
        >
          Back to Dashboard
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Top Action Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="p-2 rounded-lg border border-slate-800 text-slate-300 hover:bg-slate-800 cursor-pointer"
            aria-label="Go back"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-xl font-semibold text-slate-100">{symbol}</h1>
              <span
                className={`font-mono text-sm font-semibold ${
                  direction === 'LONG' ? 'text-emerald-400' : 'text-rose-400'
                }`}
              >
                {direction} · {entryType}
              </span>
              <span className="font-mono text-sm text-cyan-400">
                {totalScore}/100 ({classification})
              </span>
            </div>
            <div className="text-xs text-slate-400 mt-0.5">
              Status: {persistedSignal?.status || (liveSignal?.passedValidation ? 'QUALIFIED CANDIDATE' : 'REJECTED CANDIDATE')} · Est. Hold: ~{holdMins} min
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {isAuthenticated ? (
            <>
              <button
                onClick={handleGenerateAi}
                disabled={aiLoading}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border border-slate-700 text-slate-200 hover:bg-slate-800 disabled:opacity-50 cursor-pointer"
              >
                <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
                {aiLoading ? 'Analyzing...' : 'Gemini AI Explain'}
              </button>
              {liveSignal && !persistedSignal && (
                <button
                  onClick={handlePublish}
                  disabled={publishing}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg bg-cyan-500 text-slate-950 hover:bg-cyan-400 disabled:opacity-50 cursor-pointer"
                >
                  <Send className="w-3.5 h-3.5" />
                  {publishing ? 'Publishing...' : 'Publish & Alert Telegram'}
                </button>
              )}
            </>
          ) : (
            <button
              onClick={onSignIn}
              className="px-4 py-2 text-xs font-semibold rounded-lg bg-cyan-500 text-slate-950 hover:bg-cyan-400 cursor-pointer"
            >
              Sign in for AI & Publish
            </button>
          )}
        </div>
      </div>

      {publishNotice && (
        <div className="rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-4 py-3 text-xs text-cyan-200">
          {publishNotice}
        </div>
      )}

      {/* Main Split: Chart + Order Ticket */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-xs font-medium text-slate-300">
              Interactive Price Action & Entry/Exit Levels
            </div>
            <div className="flex items-center gap-1 p-1 rounded-md bg-[#111827] border border-slate-800/80">
              {(['5m', '15m', '1h', '4h'] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setTf(t)}
                  className={`px-2.5 py-1 text-xs font-mono rounded cursor-pointer ${
                    tf === t ? 'bg-slate-800 text-cyan-400' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {t.toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          <CandlestickChart
            candles={candles}
            symbol={symbol}
            overlays={{
              entry: entryPrice,
              stopLoss,
              tp1,
              tp2,
              tp3,
            }}
            height={400}
          />
        </div>

        {/* Execution Parameters & Position Sizing */}
        <div className="rounded-lg border border-slate-800/80 bg-[#111827] p-5 space-y-4">
          <h2 className="text-sm font-semibold text-slate-100">Deterministic Execution Plan</h2>
          <div className="divide-y divide-slate-800/70 text-sm font-mono tabular-nums">
            <div className="py-2 flex justify-between">
              <span className="text-slate-400 font-sans text-xs">Entry Target ({entryType})</span>
              <span className="text-sky-400 font-semibold">{formatPrice(entryPrice)}</span>
            </div>
            <div className="py-2 flex justify-between">
              <span className="text-slate-400 font-sans text-xs">Entry Zone</span>
              <span className="text-slate-200 text-xs">
                {formatPrice(zoneLow)} – {formatPrice(zoneHigh)}
              </span>
            </div>
            <div className="py-2 flex justify-between">
              <span className="text-slate-400 font-sans text-xs">Stop Loss</span>
              <span className="text-rose-400 font-semibold">{formatPrice(stopLoss)}</span>
            </div>
            <div className="py-2 flex justify-between">
              <span className="text-slate-400 font-sans text-xs">Take Profit 1 (1R)</span>
              <span className="text-emerald-400">{formatPrice(tp1)}</span>
            </div>
            <div className="py-2 flex justify-between">
              <span className="text-slate-400 font-sans text-xs">Take Profit 2 (2R)</span>
              <span className="text-emerald-400 font-semibold">{formatPrice(tp2)}</span>
            </div>
            <div className="py-2 flex justify-between">
              <span className="text-slate-400 font-sans text-xs">Take Profit 3 (3R)</span>
              <span className="text-emerald-300">{formatPrice(tp3)}</span>
            </div>
            <div className="py-2 flex justify-between">
              <span className="text-slate-400 font-sans text-xs">Risk / Reward</span>
              <span className="text-slate-100">{rr}:1</span>
            </div>
            <div className="py-2 flex justify-between">
              <span className="text-slate-400 font-sans text-xs">Position Size · Leverage</span>
              <span className="text-slate-100">
                {formatUsd(posSize)} · {leverage}x
              </span>
            </div>
          </div>
          <p className="text-[11px] text-slate-500 leading-relaxed">
            Score measures multi-factor technical and structural alignment (not a win probability). Execution and profit are never guaranteed.
          </p>
        </div>
      </div>

      {/* 100-Point Scoring Breakdown + AI / Bangla Explanation */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="rounded-lg border border-slate-800/80 bg-[#111827] p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-100">100-Point Scoring Breakdown</h2>
            <span className="font-mono text-sm font-semibold text-cyan-400 tabular-nums">
              {totalScore} / 100
            </span>
          </div>
          <div className="space-y-2.5 pt-1">
            {SCORE_WEIGHTS.map((item) => {
              const val = Number(breakdown[item.key] ?? 0);
              const pct = Math.min(100, Math.round((val / item.max) * 100));
              return (
                <div key={item.key}>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-slate-300">{item.label}</span>
                    <span className="font-mono tabular-nums text-slate-200">
                      {val} / {item.max}
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full bg-slate-800 overflow-hidden">
                    <div
                      className="h-full bg-cyan-400 rounded-full"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="rounded-lg border border-slate-800/80 bg-[#111827] p-5 space-y-4">
          <h2 className="text-sm font-semibold text-slate-100">
            Market & Risk Explanation (English + সহজ বাংলা)
          </h2>
          {showEn && (
            <div className="space-y-1">
              <div className="text-xs font-medium text-cyan-400">Quantitative Analysis</div>
              <p className="text-sm text-slate-200 leading-relaxed">{aiEn || defaultEn}</p>
            </div>
          )}
          {showBn && (
            <div className="space-y-1 pt-3 border-t border-slate-800/80">
              <div className="text-xs font-medium text-emerald-400">
                সহজ বাংলা বিশ্লেষণ (Non-Technical Summary)
              </div>
              <p className="text-sm text-slate-200 leading-relaxed">{aiBn || defaultBn}</p>
            </div>
          )}
          {liveSignal && liveSignal.rejectionReasons.length > 0 && (
            <div className="pt-3 border-t border-slate-800/80">
              <div className="text-xs font-medium text-amber-400 mb-1">Validation Warnings</div>
              <ul className="list-disc pl-4 text-xs text-slate-300 space-y-1">
                {liveSignal.rejectionReasons.map((r, idx) => (
                  <li key={idx}>{r}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>

      {/* Persisted Lifecycle Event Audit Trail */}
      {events.length > 0 && (
        <div className="rounded-lg border border-slate-800/80 bg-[#111827] p-5">
          <h2 className="text-sm font-semibold text-slate-100 mb-3">Signal Lifecycle Event Log</h2>
          <div className="divide-y divide-slate-800/60 text-xs">
            {events.map((ev) => (
              <div key={ev.id} className="py-2.5 flex items-center justify-between gap-4">
                <div>
                  <span className="font-mono font-semibold text-cyan-400">{ev.eventType}</span>
                  <span className="text-slate-400 ml-3">{ev.note}</span>
                </div>
                <div className="font-mono tabular-nums text-slate-400 shrink-0">
                  @{formatPrice(ev.triggerPrice)} · {formatShortTime(ev.createdAt)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
