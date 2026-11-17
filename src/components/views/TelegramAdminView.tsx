import { useEffect, useState } from 'react';
import { Check, Send, ShieldCheck } from 'lucide-react';
import type { AdminConfigParams } from '../../types/trading';

interface TelegramAdminViewProps {
  mode: 'telegram' | 'admin';
  isAuthenticated: boolean;
  userEmail: string | null;
  authFetch: (input: string, init?: RequestInit) => Promise<Response>;
  onSignIn: () => void;
  onConfigUpdated: (cfg: AdminConfigParams) => void;
}

export function TelegramAdminView({
  mode,
  isAuthenticated,
  userEmail,
  authFetch,
  onSignIn,
  onConfigUpdated,
}: TelegramAdminViewProps) {
  const [botToken, setBotToken] = useState('');
  const [hasTokenConfigured, setHasTokenConfigured] = useState(false);
  const [chatId, setChatId] = useState('');
  const [tgEnabled, setTgEnabled] = useState(false);
  const [tgMinScore, setTgMinScore] = useState(80);
  const [tgFormat, setTgFormat] = useState('standard');
  const [tgStatus, setTgStatus] = useState<string | null>(null);

  const [sysConfig, setSysConfig] = useState<AdminConfigParams>({
    scanFrequencySec: 60,
    minVolume24hUsd: 5_000_000,
    minSignalScore: 80,
    maxActiveSignals: 10,
    riskPercentage: 1.0,
    maxLeverage: 10,
    minRiskReward: 1.8,
    rezPriorityEnabled: true,
    aiNewsAnalysisEnabled: true,
    scannerEnabled: true,
    accountEquityUsd: 10_000,
    languageMode: 'en_bn',
  });
  const [auditLogs, setAuditLogs] = useState<Array<{ id: string; userUid: string; action: string; resource: string; createdAt: string }>>([]);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isAuthenticated) return;
    authFetch('/api/settings/telegram')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.settings) {
          setChatId(data.settings.channelChatId || '');
          setTgEnabled(Boolean(data.settings.notificationsEnabled));
          setTgMinScore(Number(data.settings.minSignalScore ?? 80));
          setTgFormat(data.settings.messageFormat || 'standard');
          setHasTokenConfigured(Boolean(data.settings.hasBotTokenConfigured));
          setTgStatus(data.settings.lastTestStatus || null);
        }
      })
      .catch(() => {});

    authFetch('/api/settings/system')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.settings) {
          setSysConfig(data.settings);
        }
      })
      .catch(() => {});

    authFetch('/api/audit-logs')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.logs) setAuditLogs(data.logs);
      })
      .catch(() => {});
  }, [isAuthenticated, authFetch]);

  if (!isAuthenticated) {
    return (
      <div className="rounded-lg border border-slate-800/80 bg-[#111827] p-8 max-w-xl mx-auto text-center space-y-4">
        <ShieldCheck className="w-8 h-8 text-cyan-400 mx-auto" />
        <h1 className="text-lg font-semibold text-slate-100">
          {mode === 'telegram' ? 'Telegram Bot Integration' : 'Admin & Risk Configuration'}
        </h1>
        <p className="text-sm text-slate-400">
          Sign in with Google to securely manage encrypted Telegram Bot credentials, scanner thresholds, risk parameters, and PostgreSQL audit logs.
        </p>
        <button
          onClick={onSignIn}
          className="px-5 py-2.5 text-xs font-semibold rounded-lg bg-cyan-500 text-slate-950 hover:bg-cyan-400 cursor-pointer"
        >
          Sign in with Google
        </button>
      </div>
    );
  }

  const handleSaveTelegram = async () => {
    setSaving(true);
    setFeedback(null);
    try {
      const res = await authFetch('/api/settings/telegram', {
        method: 'PUT',
        body: JSON.stringify({
          ...(botToken.trim() ? { botToken: botToken.trim() } : {}),
          channelChatId: chatId,
          notificationsEnabled: tgEnabled,
          minSignalScore: tgMinScore,
          messageFormat: tgFormat,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Save failed');
      setHasTokenConfigured(Boolean(data.settings.hasBotTokenConfigured));
      setBotToken('');
      setFeedback('Telegram settings saved securely (bot token encrypted on server).');
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const handleTestTelegram = async () => {
    setSaving(true);
    setFeedback(null);
    try {
      const res = await authFetch('/api/settings/telegram/test', {
        method: 'POST',
        body: JSON.stringify({
          ...(botToken.trim() ? { botToken: botToken.trim() } : {}),
          channelChatId: chatId,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Connection test failed');
      setTgStatus(`Connected (@${data.botUsername})`);
      setFeedback(`Test message delivered via @${data.botUsername} (Message ID: ${data.messageId}).`);
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Connection test failed');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveSystem = async () => {
    setSaving(true);
    setFeedback(null);
    try {
      const res = await authFetch('/api/settings/system', {
        method: 'PUT',
        body: JSON.stringify(sysConfig),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save system settings');
      onConfigUpdated(sysConfig);
      setFeedback('System & risk settings persisted to PostgreSQL.');
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  if (mode === 'telegram') {
    return (
      <div className="space-y-6 max-w-4xl">
        <div>
          <h1 className="text-xl font-semibold text-slate-100">Telegram Bot Integration</h1>
          <p className="text-xs text-slate-400 mt-1">
            Automated signal alerts and lifecycle updates (Entry Filled, TP1/TP2/TP3, SL Hit, Expired). Credentials are stored encrypted server-side only.
          </p>
        </div>

        {feedback && (
          <div className="rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-4 py-3 text-xs text-cyan-200">
            {feedback}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <div className="rounded-lg border border-slate-800/80 bg-[#111827] p-5 space-y-4 text-xs">
            <div>
              <label className="block text-slate-300 mb-1">
                Telegram Bot Token {hasTokenConfigured && <span className="text-emerald-400">(Configured)</span>}
              </label>
              <input
                type="password"
                value={botToken}
                onChange={(e) => setBotToken(e.target.value)}
                placeholder={hasTokenConfigured ? '•••••••••••• (leave blank to keep existing)' : 'Paste @BotFather token'}
                className="w-full px-3 py-2 rounded bg-[#090d16] border border-slate-800 font-mono text-slate-100"
              />
            </div>
            <div>
              <label className="block text-slate-300 mb-1">Channel / Chat ID</label>
              <input
                type="text"
                value={chatId}
                onChange={(e) => setChatId(e.target.value)}
                placeholder="-1001234567890 or @channel_username"
                className="w-full px-3 py-2 rounded bg-[#090d16] border border-slate-800 font-mono text-slate-100"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-slate-300 mb-1">Min Signal Score</label>
                <input
                  type="number"
                  min={70}
                  max={98}
                  value={tgMinScore}
                  onChange={(e) => setTgMinScore(Number(e.target.value))}
                  className="w-full px-3 py-2 rounded bg-[#090d16] border border-slate-800 font-mono text-slate-100"
                />
              </div>
              <div>
                <label className="block text-slate-300 mb-1">Message Format</label>
                <select
                  value={tgFormat}
                  onChange={(e) => setTgFormat(e.target.value)}
                  className="w-full px-3 py-2 rounded bg-[#090d16] border border-slate-800 font-mono text-slate-100"
                >
                  <option value="standard">Standard Detailed</option>
                  <option value="compact">Compact Scalper</option>
                </select>
              </div>
            </div>

            <label className="flex items-center gap-2.5 cursor-pointer pt-1">
              <input
                type="checkbox"
                checked={tgEnabled}
                onChange={(e) => setTgEnabled(e.target.checked)}
                className="accent-cyan-400"
              />
              <span className="text-slate-200">Enable Automatic Signal & Lifecycle Dispatch</span>
            </label>

            {tgStatus && (
              <div className="text-slate-400 font-mono">Last Test Status: {tgStatus}</div>
            )}

            <div className="flex items-center gap-3 pt-2">
              <button
                onClick={handleSaveTelegram}
                disabled={saving}
                className="inline-flex items-center gap-1.5 px-4 py-2 font-semibold rounded-lg bg-cyan-500 text-slate-950 hover:bg-cyan-400 disabled:opacity-50 cursor-pointer"
              >
                <Check className="w-3.5 h-3.5" />
                Save Config
              </button>
              <button
                onClick={handleTestTelegram}
                disabled={saving}
                className="inline-flex items-center gap-1.5 px-4 py-2 font-medium rounded-lg border border-slate-700 text-slate-200 hover:bg-slate-800 disabled:opacity-50 cursor-pointer"
              >
                <Send className="w-3.5 h-3.5" />
                Test Connection
              </button>
            </div>
          </div>

          <div className="rounded-lg border border-slate-800/80 bg-[#111827] p-5 space-y-2">
            <div className="text-xs font-semibold text-slate-200">Signal Broadcast Template Preview</div>
            <pre className="p-3.5 rounded bg-[#090d16] border border-slate-800/80 text-[11px] font-mono text-slate-300 whitespace-pre-wrap leading-relaxed">
{`🚀 REZ/USDT — LONG
Exchange: Binance Futures
Strategy: Scalping (LIMIT)
Signal Score: 88/100 (Strong)
Entry Zone: 0.0412 – 0.0416
Stop Loss: 0.0404
Take Profit 1: 0.0422
Take Profit 2: 0.0430
Take Profit 3: 0.0438
Risk/Reward: 2.0:1
Estimated Holding Time: ~35 min
Timeframe: 5M / 15M / 1H / 4H
Signal Expiry: 14:45 UTC
Status: WAITING FOR ENTRY`}
            </pre>
          </div>
        </div>
      </div>
    );
  }

  // Admin Settings View
  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-100">Admin Risk & Scanner Settings</h1>
          <p className="text-xs text-slate-400 mt-1">
            Signed in as {userEmail} · Role: Admin · Persisted in Cloud SQL PostgreSQL
          </p>
        </div>
      </div>

      {feedback && (
        <div className="rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-4 py-3 text-xs text-cyan-200">
          {feedback}
        </div>
      )}

      <div className="rounded-lg border border-slate-800/80 bg-[#111827] p-5 space-y-5">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
          <div>
            <label className="block text-slate-400 mb-1">Scan Frequency (sec)</label>
            <input
              type="number"
              value={sysConfig.scanFrequencySec}
              onChange={(e) => setSysConfig({ ...sysConfig, scanFrequencySec: Number(e.target.value) })}
              className="w-full px-3 py-2 rounded bg-[#090d16] border border-slate-800 font-mono text-slate-100"
            />
          </div>
          <div>
            <label className="block text-slate-400 mb-1">Min 24h Volume ($)</label>
            <input
              type="number"
              value={sysConfig.minVolume24hUsd}
              onChange={(e) => setSysConfig({ ...sysConfig, minVolume24hUsd: Number(e.target.value) })}
              className="w-full px-3 py-2 rounded bg-[#090d16] border border-slate-800 font-mono text-slate-100"
            />
          </div>
          <div>
            <label className="block text-slate-400 mb-1">Min Signal Score (≥80)</label>
            <input
              type="number"
              value={sysConfig.minSignalScore}
              onChange={(e) => setSysConfig({ ...sysConfig, minSignalScore: Number(e.target.value) })}
              className="w-full px-3 py-2 rounded bg-[#090d16] border border-slate-800 font-mono text-slate-100"
            />
          </div>
          <div>
            <label className="block text-slate-400 mb-1">Max Active Signals</label>
            <input
              type="number"
              value={sysConfig.maxActiveSignals}
              onChange={(e) => setSysConfig({ ...sysConfig, maxActiveSignals: Number(e.target.value) })}
              className="w-full px-3 py-2 rounded bg-[#090d16] border border-slate-800 font-mono text-slate-100"
            />
          </div>
          <div>
            <label className="block text-slate-400 mb-1">Account Equity ($)</label>
            <input
              type="number"
              value={sysConfig.accountEquityUsd}
              onChange={(e) => setSysConfig({ ...sysConfig, accountEquityUsd: Number(e.target.value) })}
              className="w-full px-3 py-2 rounded bg-[#090d16] border border-slate-800 font-mono text-slate-100"
            />
          </div>
          <div>
            <label className="block text-slate-400 mb-1">Risk / Trade (%)</label>
            <input
              type="number"
              step="0.25"
              value={sysConfig.riskPercentage}
              onChange={(e) => setSysConfig({ ...sysConfig, riskPercentage: Number(e.target.value) })}
              className="w-full px-3 py-2 rounded bg-[#090d16] border border-slate-800 font-mono text-slate-100"
            />
          </div>
          <div>
            <label className="block text-slate-400 mb-1">Max Leverage Cap (x)</label>
            <input
              type="number"
              value={sysConfig.maxLeverage}
              onChange={(e) => setSysConfig({ ...sysConfig, maxLeverage: Number(e.target.value) })}
              className="w-full px-3 py-2 rounded bg-[#090d16] border border-slate-800 font-mono text-slate-100"
            />
          </div>
          <div>
            <label className="block text-slate-400 mb-1">Min Risk/Reward</label>
            <input
              type="number"
              step="0.1"
              value={sysConfig.minRiskReward}
              onChange={(e) => setSysConfig({ ...sysConfig, minRiskReward: Number(e.target.value) })}
              className="w-full px-3 py-2 rounded bg-[#090d16] border border-slate-800 font-mono text-slate-100"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-6 text-xs pt-2 border-t border-slate-800/80">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={sysConfig.scannerEnabled}
              onChange={(e) => setSysConfig({ ...sysConfig, scannerEnabled: e.target.checked })}
              className="accent-cyan-400"
            />
            <span>Scanner Enabled</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={sysConfig.rezPriorityEnabled}
              onChange={(e) => setSysConfig({ ...sysConfig, rezPriorityEnabled: e.target.checked })}
              className="accent-cyan-400"
            />
            <span>REZUSDT Priority Watchlist</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={sysConfig.aiNewsAnalysisEnabled}
              onChange={(e) => setSysConfig({ ...sysConfig, aiNewsAnalysisEnabled: e.target.checked })}
              className="accent-cyan-400"
            />
            <span>Gemini AI News & Signal Explanations</span>
          </label>
        </div>

        <button
          onClick={handleSaveSystem}
          disabled={saving}
          className="px-4 py-2 text-xs font-semibold rounded-lg bg-cyan-500 text-slate-950 hover:bg-cyan-400 disabled:opacity-50 cursor-pointer"
        >
          {saving ? 'Saving...' : 'Save Admin Configuration'}
        </button>
      </div>

      {/* Audit Logs */}
      <div className="rounded-lg border border-slate-800/80 bg-[#111827] p-5">
        <h2 className="text-sm font-semibold text-slate-100 mb-3">Security Audit Logs</h2>
        {auditLogs.length === 0 ? (
          <div className="text-xs text-slate-400">No audit events recorded yet.</div>
        ) : (
          <div className="divide-y divide-slate-800/60 text-xs font-mono">
            {auditLogs.slice(0, 15).map((log) => (
              <div key={log.id} className="py-2 flex items-center justify-between gap-4">
                <span className="text-cyan-400">{log.action}</span>
                <span className="text-slate-400">{log.resource}</span>
                <span className="text-slate-500">{new Date(log.createdAt).toLocaleString()}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
