import { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  CandlestickChart as CandleIcon,
  Compass,
  FileText,
  History,
  LayoutDashboard,
  LogIn,
  LogOut,
  Menu,
  Newspaper,
  Radar,
  Send,
  Settings,
  TrendingUp,
  X,
} from 'lucide-react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { DashboardView } from './components/views/DashboardView';
import { ScannerView } from './components/views/ScannerView';
import { SignalsListView } from './components/views/SignalsListView';
import { SignalDetailsView } from './components/views/SignalDetailsView';
import { CoinAnalysisView } from './components/views/CoinAnalysisView';
import { MarketOverviewView } from './components/views/MarketOverviewView';
import { NewsView } from './components/views/NewsView';
import { PerformanceBacktestView } from './components/views/PerformanceBacktestView';
import { TelegramAdminView } from './components/views/TelegramAdminView';
import { formatPrice, type PerformanceOverviewRow, type PersistedSignalRow } from './lib/format';
import type { AdminConfigParams, ScannerRunResult, SignalEvaluation } from './types/trading';

type PageId =
  | 'dashboard'
  | 'scanner'
  | 'long'
  | 'short'
  | 'details'
  | 'coin'
  | 'overview'
  | 'news'
  | 'history'
  | 'performance'
  | 'backtesting'
  | 'telegram'
  | 'admin';

const NAV_ITEMS: Array<{ id: PageId; label: string; icon: typeof LayoutDashboard }> = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'scanner', label: 'Live Market Scanner', icon: Radar },
  { id: 'long', label: 'LONG Signals', icon: ArrowUpRight },
  { id: 'short', label: 'SHORT Signals', icon: ArrowDownRight },
  { id: 'details', label: 'Signal Details', icon: FileText },
  { id: 'coin', label: 'Coin Analysis', icon: CandleIcon },
  { id: 'overview', label: 'Market Overview', icon: Compass },
  { id: 'news', label: 'Fundamental News', icon: Newspaper },
  { id: 'history', label: 'Signal History', icon: History },
  { id: 'performance', label: 'Performance Analytics', icon: TrendingUp },
  { id: 'backtesting', label: 'Backtesting', icon: BarChart3 },
  { id: 'telegram', label: 'Telegram Settings', icon: Send },
  { id: 'admin', label: 'Admin Settings', icon: Settings },
];

function WorkspaceApp() {
  const { firebaseUser, dbUser, signInWithGoogle, logout, authFetch } = useAuth();
  const [activePage, setActivePage] = useState<PageId>('dashboard');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const [scanResult, setScanResult] = useState<ScannerRunResult | null>(null);
  const [scanLoading, setScanLoading] = useState(true);
  const [scanError, setScanError] = useState<string | null>(null);

  const [persistedSignals, setPersistedSignals] = useState<PersistedSignalRow[]>([]);
  const [performance, setPerformance] = useState<PerformanceOverviewRow | null>(null);

  const [selectedLiveSignal, setSelectedLiveSignal] = useState<SignalEvaluation | null>(null);
  const [selectedPersistedSignal, setSelectedPersistedSignal] = useState<PersistedSignalRow | null>(null);
  const [selectedSymbol, setSelectedSymbol] = useState<string>('REZUSDT');
  const [langMode, setLangMode] = useState<'en' | 'bn' | 'en_bn'>('en_bn');

  const [wsState, setWsState] = useState<{
    status: string;
    lastMessageAt: string | null;
    rezPrice?: number;
    btcPrice?: number;
  }>({ status: 'connecting', lastMessageAt: null });

  const [adminConfig, setAdminConfig] = useState<Partial<AdminConfigParams>>({});

  const fetchScan = useCallback(async (force = false) => {
    setScanLoading(true);
    setScanError(null);
    try {
      const qs = new URLSearchParams();
      if (force) qs.set('refresh', '1');
      if (adminConfig.minSignalScore) qs.set('minScore', String(adminConfig.minSignalScore));
      if (adminConfig.minVolume24hUsd) qs.set('minVolume', String(adminConfig.minVolume24hUsd));
      const res = await fetch(`/api/market/scanner?${qs.toString()}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Market scan failed');
      setScanResult(data as ScannerRunResult);
      if (!selectedLiveSignal && data.topSignals?.length > 0) {
        setSelectedLiveSignal(data.topSignals[0]);
      }
    } catch (err) {
      setScanError(err instanceof Error ? err.message : 'Unable to reach Binance Futures scanner.');
    } finally {
      setScanLoading(false);
    }
  }, [adminConfig.minSignalScore, adminConfig.minVolume24hUsd, selectedLiveSignal]);

  const fetchPersistedData = useCallback(async () => {
    if (!firebaseUser) {
      setPersistedSignals([]);
      setPerformance(null);
      return;
    }
    try {
      const res = await authFetch('/api/signals');
      if (res.ok) {
        const data = await res.json();
        setPersistedSignals(data.signals || []);
        setPerformance(data.performance || null);
      }
    } catch {
      // Ignore transient auth sync issue
    }
  }, [firebaseUser, authFetch]);

  useEffect(() => {
    fetchScan(false);
  }, [fetchScan]);

  useEffect(() => {
    fetchPersistedData();
  }, [fetchPersistedData]);

  // Real Binance WebSocket SSE heartbeat
  useEffect(() => {
    const es = new EventSource('/api/stream');
    es.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        setWsState({
          status: msg.wsStatus?.status || 'disconnected',
          lastMessageAt: msg.wsStatus?.lastMessageAt || msg.ts,
          rezPrice: msg.rez?.price,
          btcPrice: msg.btc?.price,
        });
      } catch {
        // ignore
      }
    };
    return () => es.close();
  }, []);

  const handleSelectLiveSignal = (sig: SignalEvaluation) => {
    setSelectedLiveSignal(sig);
    setSelectedPersistedSignal(null);
    setActivePage('details');
  };

  const handleSelectPersistedSignal = (sig: PersistedSignalRow) => {
    setSelectedPersistedSignal(sig);
    setSelectedLiveSignal(null);
    setActivePage('details');
  };

  const handleInspectSymbol = (sym: string) => {
    setSelectedSymbol(sym);
    setActivePage('coin');
  };

  const handlePublishSignal = async (sig: SignalEvaluation) => {
    const res = await authFetch('/api/signals/publish', {
      method: 'POST',
      body: JSON.stringify({ signal: sig }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Publish failed');
    await fetchPersistedData();
  };

  const handlePersistScan = async () => {
    const res = await authFetch('/api/signals/scan-and-persist', { method: 'POST' });
    if (res.ok) {
      const data = await res.json();
      if (data.scan) setScanResult(data.scan);
      await fetchPersistedData();
    }
  };

  const handleTickLifecycle = async () => {
    const res = await authFetch('/api/signals/tick-lifecycle', { method: 'POST' });
    if (res.ok) {
      await fetchPersistedData();
    }
  };

  const activeNavLabel = NAV_ITEMS.find((n) => n.id === activePage)?.label || 'Dashboard';

  return (
    <div className="min-h-screen bg-[#090d16] text-slate-200 flex">
      {/* Sidebar Desktop */}
      <aside className="hidden lg:flex lg:flex-col lg:w-64 lg:shrink-0 border-r border-slate-800/80 bg-[#0b101b]">
        <div className="h-14 px-5 flex items-center border-b border-slate-800/80">
          <span className="font-display text-sm font-bold tracking-tight text-slate-100 whitespace-nowrap">
            AI Crypto Signal Intelligence
          </span>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-0.5">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = activePage === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActivePage(item.id)}
                className={`w-full flex items-center gap-2.5 px-3 py-2 text-xs font-medium rounded-md transition-colors text-left cursor-pointer whitespace-nowrap ${
                  active
                    ? 'bg-slate-800/90 text-cyan-400'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}
        </nav>

        {/* Language Mode & Priority Shortcut */}
        <div className="p-4 border-t border-slate-800/80 space-y-3">
          <div>
            <div className="text-[11px] text-slate-500 mb-1.5">Explanation Language</div>
            <div className="grid grid-cols-3 gap-1 p-0.5 rounded bg-[#090d16] border border-slate-800">
              {([
                { id: 'en_bn', label: 'EN+বাং' },
                { id: 'en', label: 'EN' },
                { id: 'bn', label: 'বাংলা' },
              ] as const).map((m) => (
                <button
                  key={m.id}
                  onClick={() => setLangMode(m.id)}
                  className={`py-1 text-[11px] rounded cursor-pointer ${
                    langMode === m.id ? 'bg-slate-800 text-cyan-400 font-medium' : 'text-slate-400'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          <button
            onClick={() => handleInspectSymbol('REZUSDT')}
            className="w-full py-2 px-3 text-xs font-mono rounded-md border border-slate-800 bg-[#090d16] hover:border-cyan-500/50 flex items-center justify-between cursor-pointer"
          >
            <span className="text-slate-300">REZUSDT</span>
            <span className="text-cyan-400 tabular-nums">
              {wsState.rezPrice ? `$${formatPrice(wsState.rezPrice)}` : 'Analyze'}
            </span>
          </button>
        </div>
      </aside>

      {/* Mobile Drawer */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-black/70"
            onClick={() => setMobileMenuOpen(false)}
          />
          <aside className="relative z-10 w-64 bg-[#0b101b] border-r border-slate-800 flex flex-col">
            <div className="h-14 px-4 flex items-center justify-between border-b border-slate-800">
              <span className="font-display text-sm font-bold text-slate-100">
                Signal Intelligence
              </span>
              <button
                onClick={() => setMobileMenuOpen(false)}
                className="p-1.5 text-slate-400 hover:text-slate-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <nav className="flex-1 overflow-y-auto px-3 py-3 space-y-0.5">
              {NAV_ITEMS.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.id}
                    onClick={() => {
                      setActivePage(item.id);
                      setMobileMenuOpen(false);
                    }}
                    className={`w-full flex items-center gap-2.5 px-3 py-2 text-xs font-medium rounded-md text-left ${
                      activePage === item.id
                        ? 'bg-slate-800 text-cyan-400'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </nav>
          </aside>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Clean SaaS Top Bar */}
        <header className="h-14 px-4 sm:px-6 border-b border-slate-800/80 bg-[#0b101b] flex items-center justify-between gap-4 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={() => setMobileMenuOpen(true)}
              className="lg:hidden p-1.5 rounded border border-slate-800 text-slate-300"
              aria-label="Open menu"
            >
              <Menu className="w-4 h-4" />
            </button>
            <div className="text-xs text-slate-400 truncate">
              <span>Binance USDT-M Futures</span>
              <span className="mx-2" aria-hidden="true">/</span>
              <span className="text-slate-100 font-medium">{activeNavLabel}</span>
            </div>
          </div>

          <div className="flex items-center gap-4 shrink-0">
            {/* Real WebSocket Telemetry */}
            <div className="hidden sm:flex items-center gap-2 text-xs text-slate-400 font-mono">
              <Activity
                className={`w-3.5 h-3.5 ${
                  wsState.status === 'connected' ? 'text-emerald-400' : 'text-amber-400'
                }`}
              />
              <span>WS: {wsState.status}</span>
              {wsState.btcPrice && (
                <span className="text-slate-300 tabular-nums">
                  · BTC ${formatPrice(wsState.btcPrice)}
                </span>
              )}
            </div>

            {firebaseUser ? (
              <div className="flex items-center gap-2.5">
                <span className="hidden md:inline text-xs text-slate-300 truncate max-w-[160px]">
                  {dbUser?.email || firebaseUser.email}
                </span>
                <button
                  onClick={logout}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-slate-700 text-slate-300 hover:bg-slate-800 cursor-pointer whitespace-nowrap shrink-0"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  Sign Out
                </button>
              </div>
            ) : (
              <button
                onClick={signInWithGoogle}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold rounded-md bg-cyan-500 text-slate-950 hover:bg-cyan-400 cursor-pointer whitespace-nowrap shrink-0"
              >
                <LogIn className="w-3.5 h-3.5" />
                Sign In
              </button>
            )}
          </div>
        </header>

        {/* Main Viewport */}
        <main className="flex-1 p-4 sm:p-6 max-w-[1440px] w-full mx-auto">
          {scanError && (
            <div className="mb-5 rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-xs text-rose-300">
              Scanner notice: {scanError}
            </div>
          )}

          {activePage === 'dashboard' && (
            <DashboardView
              scanResult={scanResult}
              scanLoading={scanLoading}
              persistedSignals={persistedSignals}
              performance={performance}
              langMode={langMode}
              onRunScan={() => fetchScan(true)}
              onSelectSignal={handleSelectLiveSignal}
              onInspectSymbol={handleInspectSymbol}
              onNavigate={(p) => setActivePage(p as PageId)}
            />
          )}

          {activePage === 'scanner' && (
            <ScannerView
              scanResult={scanResult}
              scanLoading={scanLoading}
              onRunScan={() => fetchScan(true)}
              onSelectSignal={handleSelectLiveSignal}
              onInspectSymbol={handleInspectSymbol}
            />
          )}

          {(activePage === 'long' || activePage === 'short' || activePage === 'history') && (
            <SignalsListView
              mode={activePage === 'long' ? 'LONG' : activePage === 'short' ? 'SHORT' : 'HISTORY'}
              scanResult={scanResult}
              persistedSignals={persistedSignals}
              isAuthenticated={Boolean(firebaseUser)}
              onSignIn={signInWithGoogle}
              onSelectLiveSignal={handleSelectLiveSignal}
              onSelectPersistedSignal={handleSelectPersistedSignal}
              onPersistScan={handlePersistScan}
              onTickLifecycle={handleTickLifecycle}
            />
          )}

          {activePage === 'details' && (
            <SignalDetailsView
              liveSignal={selectedLiveSignal}
              persistedSignal={selectedPersistedSignal}
              isAuthenticated={Boolean(firebaseUser)}
              langMode={langMode}
              authFetch={authFetch}
              onSignIn={signInWithGoogle}
              onPublishSignal={handlePublishSignal}
              onBack={() => setActivePage('dashboard')}
            />
          )}

          {activePage === 'coin' && (
            <CoinAnalysisView
              initialSymbol={selectedSymbol}
              onSelectSignal={handleSelectLiveSignal}
            />
          )}

          {activePage === 'overview' && (
            <MarketOverviewView onInspectSymbol={handleInspectSymbol} />
          )}

          {activePage === 'news' && (
            <NewsView
              langMode={langMode}
              isAuthenticated={Boolean(firebaseUser)}
              authFetch={authFetch}
            />
          )}

          {(activePage === 'performance' || activePage === 'backtesting') && (
            <PerformanceBacktestView
              mode={activePage}
              performance={performance}
              persistedSignals={persistedSignals}
              isAuthenticated={Boolean(firebaseUser)}
              authFetch={authFetch}
              onSignIn={signInWithGoogle}
            />
          )}

          {(activePage === 'telegram' || activePage === 'admin') && (
            <TelegramAdminView
              mode={activePage}
              isAuthenticated={Boolean(firebaseUser)}
              userEmail={dbUser?.email || firebaseUser?.email || null}
              authFetch={authFetch}
              onSignIn={signInWithGoogle}
              onConfigUpdated={(cfg) => {
                setAdminConfig(cfg);
                setLangMode(cfg.languageMode);
              }}
            />
          )}
        </main>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <WorkspaceApp />
    </AuthProvider>
  );
}
