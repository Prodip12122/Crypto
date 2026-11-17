import { useEffect, useState } from 'react';
import { ExternalLink, RefreshCw } from 'lucide-react';
import type { NewsIntelligenceItem } from '../../types/trading';

interface NewsViewProps {
  langMode: 'en' | 'bn' | 'en_bn';
  isAuthenticated: boolean;
  authFetch: (input: string, init?: RequestInit) => Promise<Response>;
}

export function NewsView({ langMode, isAuthenticated, authFetch }: NewsViewProps) {
  const [items, setItems] = useState<NewsIntelligenceItem[]>([]);
  const [status, setStatus] = useState<'live' | 'unavailable'>('live');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const loadNews = async (persist = false) => {
    setLoading(true);
    setError(null);
    try {
      const res = persist && isAuthenticated
        ? await authFetch('/api/news/sync', { method: 'POST' })
        : await fetch('/api/market/news');
      const data = (await res.json()) as {
        items: NewsIntelligenceItem[];
        sourceStatus: 'live' | 'unavailable';
        error?: string;
      };
      setItems(data.items || []);
      setStatus(data.sourceStatus || 'live');
      if (data.error) setError(data.error);
    } catch (err) {
      setStatus('unavailable');
      setError(err instanceof Error ? err.message : 'Unable to load crypto news.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadNews(false);
  }, []);

  const showEn = langMode === 'en' || langMode === 'en_bn';
  const showBn = langMode === 'bn' || langMode === 'en_bn';

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-100">Fundamental News & AI Risk Context</h1>
          <p className="text-xs text-slate-400 mt-1">
            Verified market headlines analyzed by Gemini AI with source attribution, relevance scores, and plain Bangla summaries.
          </p>
        </div>
        <button
          onClick={() => loadNews(true)}
          disabled={loading}
          className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-lg border border-slate-700 text-slate-200 hover:bg-slate-800 cursor-pointer shrink-0"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          {loading ? 'Analyzing News...' : 'Refresh & Summarize'}
        </button>
      </div>

      {status === 'unavailable' && error && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-200">
          Verified news feed currently unavailable: {error}. No simulated or fabricated headlines are displayed.
        </div>
      )}

      {loading && items.length === 0 ? (
        <div className="rounded-lg border border-slate-800 bg-[#111827] p-8 text-center text-sm text-slate-400">
          Fetching verified headlines and running Gemini risk assessment...
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <article
              key={item.id}
              className="rounded-lg border border-slate-800/80 bg-[#111827] p-5 space-y-2.5"
            >
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2">
                <div>
                  <div className="text-xs text-slate-400 flex flex-wrap items-center gap-2">
                    <span className="font-medium text-slate-300">{item.source}</span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono">{new Date(item.publishedAt).toLocaleString()}</span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono">Relevance: {item.relevanceScore}/100</span>
                    <span aria-hidden="true">·</span>
                    <span
                      className={`font-mono font-semibold ${
                        item.sentiment === 'bullish'
                          ? 'text-emerald-400'
                          : item.sentiment === 'bearish'
                            ? 'text-rose-400'
                            : 'text-slate-300'
                      }`}
                    >
                      {item.sentiment.toUpperCase()}
                    </span>
                  </div>
                  <h2 className="text-base font-semibold text-slate-100 mt-1">{item.title}</h2>
                </div>
                <a
                  href={item.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-cyan-400 hover:text-cyan-300 shrink-0"
                >
                  Source <ExternalLink className="w-3 h-3" />
                </a>
              </div>

              {showEn && <p className="text-sm text-slate-300 leading-relaxed">{item.summaryEn}</p>}
              {showBn && (
                <p className="text-sm text-slate-300 leading-relaxed pt-2 border-t border-slate-800/60">
                  <span className="text-xs text-emerald-400 font-medium mr-2">সহজ বাংলা:</span>
                  {item.summaryBn}
                </p>
              )}

              <div className="flex flex-wrap items-center gap-3 text-xs text-slate-400 pt-1">
                <span>Affected: {item.affectedSymbols.join(', ')}</span>
                {item.riskFlags.length > 0 && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="text-amber-400">Risk Flags: {item.riskFlags.join(', ')}</span>
                  </>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
