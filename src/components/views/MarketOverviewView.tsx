import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { formatPct, formatPrice, formatUsd } from '../../lib/format';
import type { MarketTicker24h } from '../../types/trading';

interface MarketOverviewPayload {
  totalEligiblePairs: number;
  totalVolume24hUsd: number;
  btc: { price: number; change24hPct: number; fundingRate: number };
  eth: { price: number; change24hPct: number; fundingRate: number };
  rez: { price: number; change24hPct: number; volume24hUsd: number; fundingRate: number };
  gainers: MarketTicker24h[];
  losers: MarketTicker24h[];
  topVolume: MarketTicker24h[];
  fetchedAt: string;
}

export function MarketOverviewView({ onInspectSymbol }: { onInspectSymbol: (sym: string) => void }) {
  const [data, setData] = useState<MarketOverviewPayload | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/market/overview');
      if (res.ok) setData(await res.json());
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-100">Binance USDT-M Futures Overview</h1>
          <p className="text-xs text-slate-400 mt-1">
            Live perpetual contract liquidity, funding rates, gainers, and losers across all eligible symbols.
          </p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border border-slate-700 text-slate-200 hover:bg-slate-800 cursor-pointer"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {data && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="rounded-lg border border-slate-800/80 bg-[#111827] p-4">
              <div className="text-xs text-slate-400">Active Perpetual Pairs</div>
              <div className="mt-1 text-2xl font-semibold font-mono tabular-nums text-slate-100">
                {data.totalEligiblePairs}
              </div>
              <div className="mt-1 text-xs text-slate-400 font-mono tabular-nums">
                24h Vol: {formatUsd(data.totalVolume24hUsd)}
              </div>
            </div>
            <div className="rounded-lg border border-slate-800/80 bg-[#111827] p-4">
              <div className="text-xs text-slate-400">BTCUSDT Perpetual</div>
              <div className="mt-1 text-xl font-semibold font-mono tabular-nums text-slate-100">
                ${formatPrice(data.btc.price)}
              </div>
              <div className="mt-1 text-xs font-mono tabular-nums text-slate-400">
                {formatPct(data.btc.change24hPct)} · FR {(data.btc.fundingRate * 100).toFixed(4)}%
              </div>
            </div>
            <div className="rounded-lg border border-slate-800/80 bg-[#111827] p-4">
              <div className="text-xs text-slate-400">ETHUSDT Perpetual</div>
              <div className="mt-1 text-xl font-semibold font-mono tabular-nums text-slate-100">
                ${formatPrice(data.eth.price)}
              </div>
              <div className="mt-1 text-xs font-mono tabular-nums text-slate-400">
                {formatPct(data.eth.change24hPct)} · FR {(data.eth.fundingRate * 100).toFixed(4)}%
              </div>
            </div>
            <div className="rounded-lg border border-slate-800/80 bg-[#111827] p-4">
              <div className="text-xs text-cyan-400">REZUSDT (Priority)</div>
              <div className="mt-1 text-xl font-semibold font-mono tabular-nums text-slate-100">
                ${formatPrice(data.rez.price)}
              </div>
              <div className="mt-1 text-xs font-mono tabular-nums text-slate-400">
                {formatPct(data.rez.change24hPct)} · Vol {formatUsd(data.rez.volume24hUsd)}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            {[
              { title: 'Top 24h Gainers', list: data.gainers },
              { title: 'Top 24h Losers', list: data.losers },
              { title: 'Highest Volume Leaders', list: data.topVolume.slice(0, 8) },
            ].map((col) => (
              <div key={col.title} className="rounded-lg border border-slate-800/80 bg-[#111827]">
                <div className="px-4 py-3 border-b border-slate-800/80 text-sm font-semibold text-slate-100">
                  {col.title}
                </div>
                <div className="divide-y divide-slate-800/60">
                  {col.list.map((t) => (
                    <div
                      key={t.symbol}
                      onClick={() => onInspectSymbol(t.symbol)}
                      className="px-4 py-2.5 flex items-center justify-between text-xs hover:bg-slate-800/35 cursor-pointer"
                    >
                      <div>
                        <div className="font-medium text-slate-100">{t.symbol}</div>
                        <div className="text-slate-500 font-mono">{formatUsd(t.quoteVolume)}</div>
                      </div>
                      <div className="text-right font-mono tabular-nums">
                        <div className="text-slate-200">${formatPrice(t.lastPrice)}</div>
                        <div className={t.priceChangePercent >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                          {formatPct(t.priceChangePercent)}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
