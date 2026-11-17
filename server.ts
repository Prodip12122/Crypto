import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import { eq } from 'drizzle-orm';

import { db } from './src/db/index.ts';
import { signalEvents, telegramSettings, tradingSignals } from './src/db/schema.ts';
import { runHistoricalBacktest } from './src/engine/backtest.ts';
import { requireAdmin, requireAuth, type AuthRequest } from './src/middleware/auth.ts';
import { binanceService } from './src/services/binance.ts';
import { fetchVerifiedCryptoNews, generateSignalAIExplanation } from './src/services/gemini-ai.ts';
import {
  evaluateActiveSignalsLifecycle,
  getPerformanceOverview,
  getSignalWithEvents,
  getUserSystemSettings,
  getUserTelegramSettingsSafe,
  listAuditLogs,
  listBacktestResults,
  listPersistedSignals,
  logAuditEvent,
  persistScanCandidatesAndSignals,
  publishSingleSignalToDb,
  recomputePerformanceStats,
  resolveBotCredentialsForUser,
  saveBacktestResult,
  updateUserSystemSettings,
  updateUserTelegramSettings,
  upsertExchangeSymbols,
  upsertNewsItems,
} from './src/services/persistence.ts';
import {
  analyzeSingleSymbol,
  DEFAULT_ADMIN_CONFIG,
  getLatestCachedScan,
  runMarketScanner,
} from './src/services/scanner.ts';
import { sendTelegramMessage, verifyTelegramBot } from './src/services/telegram.ts';
import type { SignalEvaluation, Timeframe } from './src/types/trading.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json({ limit: '1mb' }));

// Simple sliding-window API rate limiter
const rateBuckets = new Map<string, { count: number; resetAt: number }>();
app.use('/api', (req, res, next) => {
  const ip = req.ip || 'local';
  const now = Date.now();
  let bucket = rateBuckets.get(ip);
  if (!bucket || now > bucket.resetAt) {
    bucket = { count: 0, resetAt: now + 60_000 };
    rateBuckets.set(ip, bucket);
  }
  bucket.count += 1;
  if (bucket.count > 180) {
    return res.status(429).json({ error: 'Rate limit exceeded. Please wait briefly.' });
  }
  next();
});

// ─── Public Market Data & Deterministic Engine Endpoints ──────────────────────

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    timestamp: new Date().toISOString(),
    binanceWs: binanceService.getConnectionStatus(),
  });
});

app.get('/api/market/overview', async (_req, res) => {
  try {
    const [symbols, tickers, premIndex] = await Promise.all([
      binanceService.fetchExchangeInfo(),
      binanceService.fetchAll24hTickers(),
      binanceService.fetchAllPremiumIndex(),
    ]);

    const tickerList = Array.from(tickers.values()).filter((t) =>
      symbols.some((s) => s.symbol === t.symbol)
    );
    const totalVolume24h = tickerList.reduce((sum, t) => sum + t.quoteVolume, 0);
    const gainers = [...tickerList]
      .sort((a, b) => b.priceChangePercent - a.priceChangePercent)
      .slice(0, 8);
    const losers = [...tickerList]
      .sort((a, b) => a.priceChangePercent - b.priceChangePercent)
      .slice(0, 8);
    const topVolume = [...tickerList]
      .sort((a, b) => b.quoteVolume - a.quoteVolume)
      .slice(0, 12);

    const btcTicker = tickers.get('BTCUSDT');
    const ethTicker = tickers.get('ETHUSDT');
    const rezTicker = tickers.get('REZUSDT');

    res.json({
      totalEligiblePairs: symbols.length,
      totalVolume24hUsd: totalVolume24h,
      btc: {
        price: btcTicker?.lastPrice ?? 0,
        change24hPct: btcTicker?.priceChangePercent ?? 0,
        fundingRate: premIndex.get('BTCUSDT')?.fundingRate ?? 0,
      },
      eth: {
        price: ethTicker?.lastPrice ?? 0,
        change24hPct: ethTicker?.priceChangePercent ?? 0,
        fundingRate: premIndex.get('ETHUSDT')?.fundingRate ?? 0,
      },
      rez: {
        price: rezTicker?.lastPrice ?? 0,
        change24hPct: rezTicker?.priceChangePercent ?? 0,
        volume24hUsd: rezTicker?.quoteVolume ?? 0,
        fundingRate: premIndex.get('REZUSDT')?.fundingRate ?? 0,
      },
      gainers,
      losers,
      topVolume,
      wsStatus: binanceService.getConnectionStatus(),
      fetchedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Market overview error:', error);
    res.status(502).json({
      error: error instanceof Error ? error.message : 'Failed to fetch Binance market overview.',
    });
  }
});

app.get('/api/market/scanner', async (req, res) => {
  try {
    const force = req.query.refresh === '1';
    const minScore = req.query.minScore ? Number(req.query.minScore) : undefined;
    const minVol = req.query.minVolume ? Number(req.query.minVolume) : undefined;

    const scanResult = await runMarketScanner(
      {
        ...(Number.isFinite(minScore) ? { minSignalScore: minScore } : {}),
        ...(Number.isFinite(minVol) ? { minVolume24hUsd: minVol } : {}),
      },
      force
    );

    res.json({
      ...scanResult,
      wsStatus: binanceService.getConnectionStatus(),
    });
  } catch (error) {
    console.error('Scanner endpoint error:', error);
    res.status(502).json({
      error: error instanceof Error ? error.message : 'Scanner cycle failed.',
    });
  }
});

app.get('/api/market/analyze/:symbol', async (req, res) => {
  try {
    const symbol = String(req.params.symbol || '').toUpperCase().trim();
    if (!/^[A-Z0-9]{4,20}$/.test(symbol)) {
      return res.status(400).json({ error: 'Invalid Binance Futures symbol format.' });
    }
    const analysis = await analyzeSingleSymbol(symbol);
    res.json(analysis);
  } catch (error) {
    console.error(`Analyze ${req.params.symbol} error:`, error);
    res.status(502).json({
      error: error instanceof Error ? error.message : 'Failed to analyze symbol.',
    });
  }
});

app.get('/api/market/news', async (_req, res) => {
  try {
    const cachedScan = getLatestCachedScan();
    const btcTrend = cachedScan?.btcContext.trend4h ?? 'neutral';
    const newsRes = await fetchVerifiedCryptoNews(btcTrend);
    res.json(newsRes);
  } catch (error) {
    console.error('Market news error:', error);
    res.status(502).json({
      items: [],
      sourceStatus: 'unavailable',
      error: error instanceof Error ? error.message : 'News service unavailable.',
    });
  }
});

app.post('/api/market/backtest', async (req, res) => {
  try {
    const symbol = String(req.body?.symbol || 'REZUSDT').toUpperCase().trim();
    const timeframe = (['5m', '15m', '1h', '4h'].includes(req.body?.timeframe)
      ? req.body.timeframe
      : '15m') as Timeframe;
    const splitMode = ['train', 'validation', 'out_of_sample', 'full'].includes(req.body?.splitMode)
      ? req.body.splitMode
      : 'out_of_sample';
    const initialEquity = Math.max(100, Number(req.body?.initialEquity || 10000));
    const riskPerTradePct = Math.min(5, Math.max(0.25, Number(req.body?.riskPerTradePct || 1)));
    const feeBps = Math.min(20, Math.max(0, Number(req.body?.feeBps ?? 4)));
    const slippageBps = Math.min(20, Math.max(0, Number(req.body?.slippageBps ?? 2)));
    const minScore = Math.min(95, Math.max(60, Number(req.body?.minScore ?? 75)));

    const candles = await binanceService.fetchKlines(symbol, timeframe, 500);
    const report = runHistoricalBacktest(candles, {
      symbol,
      timeframe,
      splitMode,
      initialEquity,
      riskPerTradePct,
      feeBps,
      slippageBps,
      minScore,
    });

    res.json(report);
  } catch (error) {
    console.error('Backtest error:', error);
    res.status(400).json({
      error: error instanceof Error ? error.message : 'Backtest execution failed.',
    });
  }
});

// Live SSE stream for Binance WebSocket price ticks
app.get('/api/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const sendStatus = () => {
    const payload = {
      type: 'heartbeat',
      wsStatus: binanceService.getConnectionStatus(),
      rez: binanceService.getLivePrice('REZUSDT'),
      btc: binanceService.getLivePrice('BTCUSDT'),
      eth: binanceService.getLivePrice('ETHUSDT'),
      ts: new Date().toISOString(),
    };
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  sendStatus();
  const interval = setInterval(sendStatus, 4000);
  req.on('close', () => clearInterval(interval));
});

// ─── Authenticated PostgreSQL & Admin Endpoints ──────────────────────────────

app.get('/api/auth/me', requireAuth, async (req: AuthRequest, res) => {
  res.json({ user: req.dbUser });
});

app.post('/api/gemini/explain-signal', requireAuth, async (req: AuthRequest, res) => {
  try {
    const signal = req.body?.signal as SignalEvaluation | undefined;
    if (!signal || !signal.symbol) {
      return res.status(400).json({ error: 'Valid signal payload is required.' });
    }
    const result = await generateSignalAIExplanation(signal);
    res.json(result);
  } catch (error) {
    console.error('Gemini explain-signal error:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'AI explanation failed.',
    });
  }
});

app.get('/api/signals', requireAuth, async (_req: AuthRequest, res) => {
  try {
    const [signals, performance] = await Promise.all([
      listPersistedSignals(80),
      getPerformanceOverview(),
    ]);
    res.json({ signals, performance });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to load signals.' });
  }
});

app.get('/api/signals/:id', requireAuth, async (req: AuthRequest, res) => {
  try {
    const detail = await getSignalWithEvents(String(req.params.id));
    if (!detail) {
      return res.status(404).json({ error: 'Signal not found.' });
    }
    res.json(detail);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to fetch signal.' });
  }
});

app.post('/api/signals/scan-and-persist', requireAuth, async (req: AuthRequest, res) => {
  try {
    const userId = req.dbUser!.id;
    const settings = await getUserSystemSettings(userId);
    const scan = await runMarketScanner(settings, true);
    const symbols = await binanceService.fetchExchangeInfo();
    await upsertExchangeSymbols(symbols);
    const published = await persistScanCandidatesAndSignals(
      userId,
      scan,
      settings.aiNewsAnalysisEnabled
    );
    await recomputePerformanceStats();
    await logAuditEvent(req.dbUser!.uid, 'SCAN_AND_PERSIST', 'trading_signals', {
      scanCycleId: scan.scanCycleId,
      publishedCount: published.length,
    });
    res.json({ scan, published });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to run and persist scan.',
    });
  }
});

app.post('/api/signals/publish', requireAuth, async (req: AuthRequest, res) => {
  try {
    const signal = req.body?.signal as SignalEvaluation | undefined;
    if (!signal || !signal.symbol) {
      return res.status(400).json({ error: 'Valid signal evaluation required.' });
    }
    const settings = await getUserSystemSettings(req.dbUser!.id);
    const created = await publishSingleSignalToDb(
      req.dbUser!.id,
      signal,
      settings.aiNewsAnalysisEnabled
    );
    await recomputePerformanceStats();
    await logAuditEvent(req.dbUser!.uid, 'PUBLISH_SIGNAL', 'trading_signals', {
      signalId: created.id,
      symbol: created.symbol,
      direction: created.direction,
    });
    res.json({ signal: created });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to publish signal.' });
  }
});

app.post('/api/signals/tick-lifecycle', requireAuth, async (req: AuthRequest, res) => {
  try {
    const outcome = await evaluateActiveSignalsLifecycle(req.dbUser!.id);
    res.json(outcome);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Lifecycle check failed.' });
  }
});

app.patch('/api/signals/:id/status', requireAuth, async (req: AuthRequest, res) => {
  try {
    const id = String(req.params.id);
    const nextStatus = String(req.body?.status || '').toUpperCase();
    if (!['CANCELLED', 'EXPIRED'].includes(nextStatus)) {
      return res.status(400).json({ error: 'Manual status update only supports CANCELLED or EXPIRED.' });
    }
    const existing = await db.select().from(tradingSignals).where(eq(tradingSignals.id, id)).limit(1);
    if (existing.length === 0) return res.status(404).json({ error: 'Signal not found.' });

    const prevStatus = existing[0].status;
    const updated = await db
      .update(tradingSignals)
      .set({ status: nextStatus, closedAt: new Date(), updatedAt: new Date() })
      .where(eq(tradingSignals.id, id))
      .returning();

    await db.insert(signalEvents).values({
      signalId: id,
      eventType: nextStatus,
      previousStatus: prevStatus,
      newStatus: nextStatus,
      triggerPrice: existing[0].entryLimitPrice,
      candleTime: new Date(),
      note: `Manually marked ${nextStatus} by ${req.dbUser!.email}.`,
    });

    await recomputePerformanceStats();
    await logAuditEvent(req.dbUser!.uid, 'UPDATE_SIGNAL_STATUS', 'trading_signals', {
      signalId: id,
      nextStatus,
    });
    res.json({ signal: updated[0] });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to update signal status.' });
  }
});

app.post('/api/backtests/save', requireAuth, async (req: AuthRequest, res) => {
  try {
    const report = req.body?.report;
    const riskPct = Number(req.body?.riskPerTradePct ?? 1);
    const feeBps = Number(req.body?.feeBps ?? 4);
    const slippageBps = Number(req.body?.slippageBps ?? 2);
    if (!report || !report.symbol) {
      return res.status(400).json({ error: 'Backtest report payload required.' });
    }
    const saved = await saveBacktestResult(req.dbUser!.id, report, riskPct, feeBps, slippageBps);
    await logAuditEvent(req.dbUser!.uid, 'SAVE_BACKTEST', 'backtest_results', {
      id: saved.id,
      symbol: report.symbol,
    });
    res.json({ saved });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to save backtest.' });
  }
});

app.get('/api/backtests', requireAuth, async (_req: AuthRequest, res) => {
  try {
    const rows = await listBacktestResults(20);
    res.json({ backtests: rows });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to load backtests.' });
  }
});

app.post('/api/news/sync', requireAuth, async (req: AuthRequest, res) => {
  try {
    const btcTrend = getLatestCachedScan()?.btcContext.trend4h ?? 'neutral';
    const newsRes = await fetchVerifiedCryptoNews(btcTrend);
    if (newsRes.items.length > 0) {
      await upsertNewsItems(newsRes.items);
    }
    res.json(newsRes);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to sync news.' });
  }
});

app.get('/api/settings/system', requireAuth, async (req: AuthRequest, res) => {
  try {
    const settings = await getUserSystemSettings(req.dbUser!.id);
    res.json({ settings });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to load settings.' });
  }
});

app.put('/api/settings/system', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
  try {
    const b = req.body || {};
    const patch = {
      ...(b.scanFrequencySec !== undefined ? { scanFrequencySec: Math.max(15, Number(b.scanFrequencySec)) } : {}),
      ...(b.minVolume24hUsd !== undefined ? { minVolume24hUsd: Math.max(100_000, Number(b.minVolume24hUsd)) } : {}),
      ...(b.minSignalScore !== undefined ? { minSignalScore: Math.min(98, Math.max(60, Number(b.minSignalScore))) } : {}),
      ...(b.maxActiveSignals !== undefined ? { maxActiveSignals: Math.min(20, Math.max(1, Number(b.maxActiveSignals))) } : {}),
      ...(b.riskPercentage !== undefined ? { riskPercentage: Math.min(5, Math.max(0.1, Number(b.riskPercentage))) } : {}),
      ...(b.maxLeverage !== undefined ? { maxLeverage: Math.min(50, Math.max(1, Number(b.maxLeverage))) } : {}),
      ...(b.minRiskReward !== undefined ? { minRiskReward: Math.min(5, Math.max(1, Number(b.minRiskReward))) } : {}),
      ...(b.rezPriorityEnabled !== undefined ? { rezPriorityEnabled: Boolean(b.rezPriorityEnabled) } : {}),
      ...(b.aiNewsAnalysisEnabled !== undefined ? { aiNewsAnalysisEnabled: Boolean(b.aiNewsAnalysisEnabled) } : {}),
      ...(b.scannerEnabled !== undefined ? { scannerEnabled: Boolean(b.scannerEnabled) } : {}),
      ...(b.accountEquityUsd !== undefined ? { accountEquityUsd: Math.max(100, Number(b.accountEquityUsd)) } : {}),
      ...(b.languageMode !== undefined && ['en', 'bn', 'en_bn'].includes(String(b.languageMode))
        ? { languageMode: String(b.languageMode) as 'en' | 'bn' | 'en_bn' }
        : {}),
    };
    const updated = await updateUserSystemSettings(req.dbUser!.id, req.dbUser!.uid, patch);
    res.json({ settings: updated });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to update settings.' });
  }
});

app.get('/api/settings/telegram', requireAuth, async (req: AuthRequest, res) => {
  try {
    const settings = await getUserTelegramSettingsSafe(req.dbUser!.id);
    res.json({ settings });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to load Telegram settings.' });
  }
});

app.put('/api/settings/telegram', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
  try {
    const settings = await updateUserTelegramSettings(req.dbUser!.id, req.dbUser!.uid, {
      botToken: req.body?.botToken,
      channelChatId: req.body?.channelChatId,
      notificationsEnabled: req.body?.notificationsEnabled,
      minSignalScore: req.body?.minSignalScore !== undefined ? Number(req.body.minSignalScore) : undefined,
      messageFormat: req.body?.messageFormat,
    });
    res.json({ settings });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to save Telegram settings.' });
  }
});

app.post('/api/settings/telegram/test', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
  try {
    const creds = await resolveBotCredentialsForUser(req.dbUser!.id);
    const tokenToUse = (req.body?.botToken && String(req.body.botToken).trim()) || creds.botToken;
    const chatIdToUse = (req.body?.channelChatId && String(req.body.channelChatId).trim()) || creds.chatId;

    if (!tokenToUse || !chatIdToUse) {
      return res.status(400).json({
        error: 'Both Bot Token and Channel Chat ID are required to run a connection test.',
      });
    }

    const botCheck = await verifyTelegramBot(tokenToUse);
    if (!botCheck.ok) {
      return res.status(400).json({ error: botCheck.error || 'Bot token verification failed.' });
    }

    const sendRes = await sendTelegramMessage({
      botToken: tokenToUse,
      chatId: chatIdToUse,
      text: `✅ AI Crypto Signal Intelligence connected.\nBot: @${botCheck.username}\nTimestamp: ${new Date().toISOString()}`,
    });

    await db
      .update(telegramSettings)
      .set({
        lastTestStatus: sendRes.ok ? `Connected (@${botCheck.username})` : sendRes.error || 'Failed',
        lastTestAt: new Date(),
      })
      .where(eq(telegramSettings.userId, req.dbUser!.id));

    await logAuditEvent(req.dbUser!.uid, 'TEST_TELEGRAM', 'telegram_settings', {
      ok: sendRes.ok,
      botUsername: botCheck.username,
    });

    if (!sendRes.ok) {
      return res.status(400).json({ error: sendRes.error || 'Failed to deliver test message.' });
    }

    res.json({ ok: true, botUsername: botCheck.username, messageId: sendRes.messageId });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Telegram test failed.' });
  }
});

app.get('/api/audit-logs', requireAuth, requireAdmin, async (_req: AuthRequest, res) => {
  try {
    const logs = await listAuditLogs(40);
    res.json({ logs });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to load audit logs.' });
  }
});

// ─── Vite / Static Serving & Startup ──────────────────────────────────────────

async function bootstrap() {
  const isProd = process.env.NODE_ENV === 'production';

  if (!isProd) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.join(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  const port = Number(process.env.PORT || 3000);
  app.listen(port, '0.0.0.0', () => {
    console.log(`AI Crypto Signal Intelligence server listening on port ${port}`);
    // Start Binance Futures WebSocket after HTTP server is bound
    binanceService.startWebSocket();
    // Warm market scanner asynchronously in background (non-blocking)
    setTimeout(() => {
      runMarketScanner(DEFAULT_ADMIN_CONFIG, false).catch((err) => {
        console.warn('Initial background scanner warmup warning:', err instanceof Error ? err.message : err);
      });
    }, 1500);
  });
}

bootstrap().catch((err) => {
  console.error('Server bootstrap failed:', err);
  process.exit(1);
});
