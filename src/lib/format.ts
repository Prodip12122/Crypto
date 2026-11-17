export function formatPrice(val: number | null | undefined): string {
  if (val === null || val === undefined || !Number.isFinite(val)) return '—';
  if (val === 0) return '0.00';
  if (val < 0.01) return val.toFixed(6);
  if (val < 1) return val.toFixed(4);
  if (val < 100) return val.toFixed(3);
  return val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function formatUsd(val: number | null | undefined): string {
  if (val === null || val === undefined || !Number.isFinite(val)) return '—';
  const abs = Math.abs(val);
  const sign = val < 0 ? '-' : '';
  if (abs >= 1_000_000_000) return `${sign}$${(abs / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(2)}`;
}

export function formatPct(val: number | null | undefined, showPlus = true): string {
  if (val === null || val === undefined || !Number.isFinite(val)) return '—';
  const prefix = showPlus && val > 0 ? '+' : '';
  return `${prefix}${val.toFixed(2)}%`;
}

export function formatShortTime(iso: string | Date | null | undefined): string {
  if (!iso) return '—';
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export interface PersistedSignalRow {
  id: string;
  symbol: string;
  direction: 'LONG' | 'SHORT';
  entryType: 'LIMIT' | 'MARKET';
  status: string;
  totalScore: number;
  classification: string;
  entryLimitPrice: number;
  entryZoneLow: number;
  entryZoneHigh: number;
  stopLoss: number;
  tp1: number;
  tp2: number;
  tp3: number;
  riskRewardRatio: number;
  positionSizeUsd: number;
  leverage: number;
  riskPercent: number;
  estimatedHoldingMinutes: number;
  signalExpiryAt: string;
  timeframePrimary: string;
  scoreBreakdown: Record<string, number>;
  technicalSummary: Record<string, unknown>;
  smcSummary: Record<string, unknown>;
  fundamentalContext: Record<string, unknown>;
  aiExplanationEn: string;
  aiExplanationBn: string;
  ambiguousResolution: string | null;
  realizedPnlR: number | null;
  realizedPnlPct: number | null;
  filledAt: string | null;
  closedAt: string | null;
  createdAt: string;
}

export interface PerformanceOverviewRow {
  totalSignals: number;
  filledSignals: number;
  tp1Hits: number;
  tp2Hits: number;
  tp3Hits: number;
  slHits: number;
  expiredCount: number;
  winRatePct: number;
  avgScore: number;
  avgR: number;
  netPnlPct: number;
  maxDrawdownPct: number;
  computedAt: string;
}
