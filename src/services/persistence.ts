import { desc, eq, inArray } from 'drizzle-orm';
import { db } from '../db/index.ts';
import {
  auditLogs,
  backtestResults,
  exchangeSymbols,
  marketNews,
  performanceStats,
  signalCandidates,
  signalEvents,
  systemSettings,
  telegramMessages,
  telegramSettings,
  tradingSignals,
} from '../db/schema.ts';
import { processSignalLifecycleStep } from '../engine/scoring.ts';
import type {
  AdminConfigParams,
  BacktestReport,
  NewsIntelligenceItem,
  ScannerRunResult,
  SignalEvaluation,
  SignalStatus,
} from '../types/trading.ts';
import { binanceService } from './binance.ts';
import { generateSignalAIExplanation } from './gemini-ai.ts';
import {
  decryptSecret,
  encryptSecret,
  formatTelegramLifecycleUpdate,
  formatTelegramSignalMessage,
  sendTelegramMessage,
} from './telegram.ts';

export async function logAuditEvent(
  userUid: string,
  action: string,
  resource: string,
  details?: Record<string, unknown>
) {
  try {
    await db.insert(auditLogs).values({
      userUid,
      action,
      resource,
      details: details ?? {},
    });
  } catch (error) {
    console.error('Audit log insert failed:', error);
  }
}

export async function getUserSystemSettings(userId: number): Promise<AdminConfigParams> {
  try {
    const rows = await db
      .select()
      .from(systemSettings)
      .where(eq(systemSettings.userId, userId))
      .limit(1);
    const s = rows[0];
    if (!s) {
      return {
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
      };
    }
    return {
      scanFrequencySec: s.scanFrequencySec,
      minVolume24hUsd: s.minVolume24hUsd,
      minSignalScore: s.minSignalScore,
      maxActiveSignals: s.maxActiveSignals,
      riskPercentage: s.riskPercentage,
      maxLeverage: s.maxLeverage,
      minRiskReward: s.minRiskReward,
      rezPriorityEnabled: s.rezPriorityEnabled,
      aiNewsAnalysisEnabled: s.aiNewsAnalysisEnabled,
      scannerEnabled: s.scannerEnabled,
      accountEquityUsd: s.accountEquityUsd,
      languageMode: (s.languageMode as AdminConfigParams['languageMode']) || 'en_bn',
    };
  } catch (error) {
    console.error('Database query failed in getUserSystemSettings:', error);
    throw new Error('Failed to load system settings.', { cause: error });
  }
}

export async function updateUserSystemSettings(
  userId: number,
  userUid: string,
  patch: Partial<AdminConfigParams>
) {
  try {
    const updated = await db
      .insert(systemSettings)
      .values({
        userId,
        ...patch,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: systemSettings.userId,
        set: {
          ...patch,
          updatedAt: new Date(),
        },
      })
      .returning();

    await logAuditEvent(userUid, 'UPDATE_SYSTEM_SETTINGS', 'system_settings', patch as Record<string, unknown>);
    return updated[0];
  } catch (error) {
    console.error('Database update failed in updateUserSystemSettings:', error);
    throw new Error('Failed to save system settings.', { cause: error });
  }
}

export async function getUserTelegramSettingsSafe(userId: number) {
  try {
    const rows = await db
      .select()
      .from(telegramSettings)
      .where(eq(telegramSettings.userId, userId))
      .limit(1);
    const row = rows[0];
    const hasEnvToken = Boolean(process.env.TELEGRAM_BOT_TOKEN);
    return {
      channelChatId: row?.channelChatId || process.env.TELEGRAM_CHAT_ID || '',
      notificationsEnabled: row?.notificationsEnabled ?? false,
      minSignalScore: row?.minSignalScore ?? 80,
      messageFormat: row?.messageFormat ?? 'standard',
      hasBotTokenConfigured: Boolean(row?.botTokenEncrypted) || hasEnvToken,
      lastTestStatus: row?.lastTestStatus ?? null,
      lastTestAt: row?.lastTestAt ?? null,
    };
  } catch (error) {
    console.error('Database query failed in getUserTelegramSettingsSafe:', error);
    throw new Error('Failed to load Telegram settings.', { cause: error });
  }
}

export async function updateUserTelegramSettings(
  userId: number,
  userUid: string,
  input: {
    botToken?: string;
    channelChatId?: string;
    notificationsEnabled?: boolean;
    minSignalScore?: number;
    messageFormat?: string;
  }
) {
  try {
    const updateSet: Record<string, unknown> = {
      updatedAt: new Date(),
    };
    if (input.channelChatId !== undefined) updateSet.channelChatId = input.channelChatId.trim();
    if (input.notificationsEnabled !== undefined) updateSet.notificationsEnabled = input.notificationsEnabled;
    if (input.minSignalScore !== undefined) updateSet.minSignalScore = input.minSignalScore;
    if (input.messageFormat !== undefined) updateSet.messageFormat = input.messageFormat;
    if (input.botToken && input.botToken.trim().length > 10) {
      updateSet.botTokenEncrypted = encryptSecret(input.botToken.trim());
    }

    await db
      .insert(telegramSettings)
      .values({
        userId,
        channelChatId: input.channelChatId?.trim() ?? '',
        notificationsEnabled: input.notificationsEnabled ?? false,
        minSignalScore: input.minSignalScore ?? 80,
        messageFormat: input.messageFormat ?? 'standard',
        botTokenEncrypted:
          input.botToken && input.botToken.trim().length > 10
            ? encryptSecret(input.botToken.trim())
            : null,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: telegramSettings.userId,
        set: updateSet,
      });

    await logAuditEvent(userUid, 'UPDATE_TELEGRAM_SETTINGS', 'telegram_settings', {
      notificationsEnabled: input.notificationsEnabled,
      minSignalScore: input.minSignalScore,
      hasNewToken: Boolean(input.botToken),
    });

    return await getUserTelegramSettingsSafe(userId);
  } catch (error) {
    console.error('Database update failed in updateUserTelegramSettings:', error);
    throw new Error('Failed to save Telegram settings.', { cause: error });
  }
}

export async function resolveBotCredentialsForUser(userId: number): Promise<{
  botToken: string | null;
  chatId: string | null;
  notificationsEnabled: boolean;
  minSignalScore: number;
  messageFormat: string;
}> {
  const rows = await db
    .select()
    .from(telegramSettings)
    .where(eq(telegramSettings.userId, userId))
    .limit(1);
  const row = rows[0];
  const decrypted = row?.botTokenEncrypted ? decryptSecret(row.botTokenEncrypted) : null;
  const botToken = decrypted || process.env.TELEGRAM_BOT_TOKEN || null;
  const chatId = row?.channelChatId || process.env.TELEGRAM_CHAT_ID || null;
  return {
    botToken,
    chatId,
    notificationsEnabled: row?.notificationsEnabled ?? false,
    minSignalScore: row?.minSignalScore ?? 80,
    messageFormat: row?.messageFormat ?? 'standard',
  };
}

export async function persistScanCandidatesAndSignals(
  userId: number,
  scan: ScannerRunResult,
  aiEnabled: boolean
) {
  try {
    // 1. Save candidate snapshots (top 20)
    const candidateRows = scan.allCandidates.slice(0, 20).map((c) => ({
      scanCycleId: scan.scanCycleId,
      symbol: c.symbol,
      direction: c.bestDirection ?? 'NONE',
      totalScore: c.totalScore,
      classification: c.classification,
      scoreBreakdown: c.evaluation?.scoreBreakdown ?? {},
      rejectionReason: c.filterRejectReason,
      passedValidation: c.filterPassed,
      metricsSnapshot: {
        lastPrice: c.lastPrice,
        quoteVolume24h: c.quoteVolume24h,
        spreadBps: c.spreadBps,
        fundingRate: c.fundingRate,
      },
    }));
    if (candidateRows.length > 0) {
      await db.insert(signalCandidates).values(candidateRows);
    }

    // 2. Duplicate prevention: avoid re-publishing an already active signal for same symbol + direction
    const activeRows = await db
      .select()
      .from(tradingSignals)
      .where(
        inArray(tradingSignals.status, ['WAITING_FOR_ENTRY', 'ENTRY_FILLED', 'TP1_HIT', 'TP2_HIT'])
      );
    const activeKeys = new Set(activeRows.map((r) => `${r.symbol}:${r.direction}`));

    const creds = await resolveBotCredentialsForUser(userId);
    const insertedSignals = [];

    for (const sig of scan.topSignals) {
      if (activeKeys.has(`${sig.symbol}:${sig.direction}`)) continue;

      const aiText = aiEnabled
        ? await generateSignalAIExplanation(sig)
        : {
            explanationEn: sig.deterministicRationaleEn,
            explanationBn: sig.deterministicRationaleBn,
            aiPowered: false,
          };

      const expiryAt = new Date(Date.now() + sig.signalExpiryMinutes * 60_000);
      const inserted = await db
        .insert(tradingSignals)
        .values({
          userId,
          symbol: sig.symbol,
          direction: sig.direction,
          entryType: sig.entryType,
          status: sig.entryType === 'MARKET' ? 'ENTRY_FILLED' : 'WAITING_FOR_ENTRY',
          totalScore: sig.totalScore,
          classification: sig.classification,
          entryLimitPrice: sig.entryLimitPrice,
          entryZoneLow: sig.entryZoneLow,
          entryZoneHigh: sig.entryZoneHigh,
          stopLoss: sig.stopLoss,
          tp1: sig.tp1,
          tp2: sig.tp2,
          tp3: sig.tp3,
          riskRewardRatio: sig.riskRewardRatio,
          positionSizeUsd: sig.positionSizeUsd,
          leverage: sig.leverage,
          riskPercent: sig.riskPercent,
          estimatedHoldingMinutes: sig.estimatedHoldingMinutes,
          signalExpiryAt: expiryAt,
          timeframePrimary: '5m',
          scoreBreakdown: sig.scoreBreakdown as unknown as Record<string, number>,
          technicalSummary: sig.technicalSummary as unknown as Record<string, unknown>,
          smcSummary: sig.smcSummary as unknown as Record<string, unknown>,
          fundamentalContext: sig.fundamentalContext as unknown as Record<string, unknown>,
          aiExplanationEn: aiText.explanationEn,
          aiExplanationBn: aiText.explanationBn,
          filledAt: sig.entryType === 'MARKET' ? new Date() : null,
        })
        .returning();

      const created = inserted[0];
      insertedSignals.push(created);

      await db.insert(signalEvents).values({
        signalId: created.id,
        eventType: 'SIGNAL_CREATED',
        previousStatus: 'NEW',
        newStatus: created.status,
        triggerPrice: sig.entryLimitPrice,
        candleTime: new Date(),
        note: `Signal published with score ${sig.totalScore}/100 (${sig.classification}).`,
      });

      // Dispatch Telegram notification if enabled & meets score threshold
      if (
        creds.notificationsEnabled &&
        creds.botToken &&
        creds.chatId &&
        sig.totalScore >= creds.minSignalScore
      ) {
        await dispatchTelegramIdempotent({
          signalId: created.id,
          eventType: 'SIGNAL_CREATED',
          botToken: creds.botToken,
          chatId: creds.chatId,
          text: formatTelegramSignalMessage(
            sig,
            created.status as SignalStatus,
            aiText.explanationEn,
            creds.messageFormat
          ),
        });
      }
    }

    return insertedSignals;
  } catch (error) {
    console.error('Database error in persistScanCandidatesAndSignals:', error);
    throw new Error('Failed to persist scan signals.', { cause: error });
  }
}

export async function publishSingleSignalToDb(userId: number, sig: SignalEvaluation, aiEnabled: boolean) {
  try {
    const aiText = aiEnabled
      ? await generateSignalAIExplanation(sig)
      : {
          explanationEn: sig.deterministicRationaleEn,
          explanationBn: sig.deterministicRationaleBn,
          aiPowered: false,
        };

    const expiryAt = new Date(Date.now() + sig.signalExpiryMinutes * 60_000);
    const inserted = await db
      .insert(tradingSignals)
      .values({
        userId,
        symbol: sig.symbol,
        direction: sig.direction,
        entryType: sig.entryType,
        status: sig.entryType === 'MARKET' ? 'ENTRY_FILLED' : 'WAITING_FOR_ENTRY',
        totalScore: sig.totalScore,
        classification: sig.classification,
        entryLimitPrice: sig.entryLimitPrice,
        entryZoneLow: sig.entryZoneLow,
        entryZoneHigh: sig.entryZoneHigh,
        stopLoss: sig.stopLoss,
        tp1: sig.tp1,
        tp2: sig.tp2,
        tp3: sig.tp3,
        riskRewardRatio: sig.riskRewardRatio,
        positionSizeUsd: sig.positionSizeUsd,
        leverage: sig.leverage,
        riskPercent: sig.riskPercent,
        estimatedHoldingMinutes: sig.estimatedHoldingMinutes,
        signalExpiryAt: expiryAt,
        timeframePrimary: '5m',
        scoreBreakdown: sig.scoreBreakdown as unknown as Record<string, number>,
        technicalSummary: sig.technicalSummary as unknown as Record<string, unknown>,
        smcSummary: sig.smcSummary as unknown as Record<string, unknown>,
        fundamentalContext: sig.fundamentalContext as unknown as Record<string, unknown>,
        aiExplanationEn: aiText.explanationEn,
        aiExplanationBn: aiText.explanationBn,
        filledAt: sig.entryType === 'MARKET' ? new Date() : null,
      })
      .returning();

    const created = inserted[0];
    await db.insert(signalEvents).values({
      signalId: created.id,
      eventType: 'SIGNAL_CREATED',
      previousStatus: 'NEW',
      newStatus: created.status,
      triggerPrice: sig.entryLimitPrice,
      candleTime: new Date(),
      note: `Manual/Scanner publish with score ${sig.totalScore}/100 (${sig.classification}).`,
    });

    const creds = await resolveBotCredentialsForUser(userId);
    if (
      creds.notificationsEnabled &&
      creds.botToken &&
      creds.chatId &&
      sig.totalScore >= creds.minSignalScore
    ) {
      await dispatchTelegramIdempotent({
        signalId: created.id,
        eventType: 'SIGNAL_CREATED',
        botToken: creds.botToken,
        chatId: creds.chatId,
        text: formatTelegramSignalMessage(
          sig,
          created.status as SignalStatus,
          aiText.explanationEn,
          creds.messageFormat
        ),
      });
    }

    return created;
  } catch (error) {
    console.error('Database error in publishSingleSignalToDb:', error);
    throw new Error('Failed to publish trading signal.', { cause: error });
  }
}

export async function dispatchTelegramIdempotent(params: {
  signalId: string;
  eventType: string;
  botToken: string;
  chatId: string;
  text: string;
}) {
  const idempotencyKey = `${params.signalId}:${params.eventType}`;
  try {
    const existing = await db
      .select()
      .from(telegramMessages)
      .where(eq(telegramMessages.idempotencyKey, idempotencyKey))
      .limit(1);
    if (existing.length > 0 && existing[0].status === 'sent') {
      return existing[0];
    }

    const sendRes = await sendTelegramMessage({
      botToken: params.botToken,
      chatId: params.chatId,
      text: params.text,
    });

    const saved = await db
      .insert(telegramMessages)
      .values({
        signalId: params.signalId,
        idempotencyKey,
        chatId: params.chatId,
        telegramMessageId: sendRes.messageId ?? null,
        eventType: params.eventType,
        payload: params.text,
        status: sendRes.ok ? 'sent' : 'failed',
        retryCount: 1,
        errorMessage: sendRes.error ?? null,
        sentAt: sendRes.ok ? new Date() : null,
      })
      .onConflictDoUpdate({
        target: telegramMessages.idempotencyKey,
        set: {
          status: sendRes.ok ? 'sent' : 'failed',
          telegramMessageId: sendRes.messageId ?? null,
          errorMessage: sendRes.error ?? null,
          sentAt: sendRes.ok ? new Date() : null,
        },
      })
      .returning();

    return saved[0];
  } catch (error) {
    console.error('Telegram dispatch persistence error:', error);
    return null;
  }
}

export async function listPersistedSignals(limit = 60) {
  try {
    const rows = await db
      .select()
      .from(tradingSignals)
      .orderBy(desc(tradingSignals.createdAt))
      .limit(limit);
    return rows;
  } catch (error) {
    console.error('Database query failed in listPersistedSignals:', error);
    throw new Error('Failed to fetch signal history.', { cause: error });
  }
}

export async function getSignalWithEvents(signalId: string) {
  try {
    const sigRows = await db
      .select()
      .from(tradingSignals)
      .where(eq(tradingSignals.id, signalId))
      .limit(1);
    if (sigRows.length === 0) return null;

    const events = await db
      .select()
      .from(signalEvents)
      .where(eq(signalEvents.signalId, signalId))
      .orderBy(desc(signalEvents.createdAt));

    const tgDeliveries = await db
      .select()
      .from(telegramMessages)
      .where(eq(telegramMessages.signalId, signalId))
      .orderBy(desc(telegramMessages.createdAt));

    return {
      signal: sigRows[0],
      events,
      telegramMessages: tgDeliveries,
    };
  } catch (error) {
    console.error('Database query failed in getSignalWithEvents:', error);
    throw new Error('Failed to fetch signal details.', { cause: error });
  }
}

export async function evaluateActiveSignalsLifecycle(userId: number) {
  try {
    const active = await db
      .select()
      .from(tradingSignals)
      .where(
        inArray(tradingSignals.status, ['WAITING_FOR_ENTRY', 'ENTRY_FILLED', 'TP1_HIT', 'TP2_HIT'])
      );

    if (active.length === 0) return { checked: 0, updated: 0 };

    const creds = await resolveBotCredentialsForUser(userId);
    let updatedCount = 0;

    for (const sig of active) {
      const candles5m = await binanceService.fetchKlines(sig.symbol, '5m', 3);
      const latestCandle = candles5m[candles5m.length - 1];
      if (!latestCandle) continue;

      const sub1m = await binanceService.fetchKlines(sig.symbol, '1m', 5).catch(() => []);

      const step = processSignalLifecycleStep(
        {
          status: sig.status as SignalStatus,
          direction: sig.direction as 'LONG' | 'SHORT',
          entryType: sig.entryType as 'LIMIT' | 'MARKET',
          entryLimitPrice: sig.entryLimitPrice,
          entryZoneLow: sig.entryZoneLow,
          entryZoneHigh: sig.entryZoneHigh,
          stopLoss: sig.stopLoss,
          tp1: sig.tp1,
          tp2: sig.tp2,
          tp3: sig.tp3,
          signalExpiryAt: sig.signalExpiryAt.getTime(),
        },
        latestCandle,
        sub1m
      );

      if (!step.changed || !step.eventType) continue;

      const isTerminal =
        step.newStatus === 'TP3_HIT' ||
        step.newStatus === 'SL_HIT' ||
        step.newStatus === 'EXPIRED' ||
        step.newStatus === 'CANCELLED';

      await db
        .update(tradingSignals)
        .set({
          status: step.newStatus,
          ambiguousResolution: step.ambiguousResolution ?? sig.ambiguousResolution,
          realizedPnlR: step.realizedPnlR ?? sig.realizedPnlR,
          realizedPnlPct:
            step.realizedPnlR !== null ? step.realizedPnlR * sig.riskPercent : sig.realizedPnlPct,
          filledAt: step.newStatus === 'ENTRY_FILLED' ? new Date() : sig.filledAt,
          closedAt: isTerminal ? new Date() : sig.closedAt,
          updatedAt: new Date(),
        })
        .where(eq(tradingSignals.id, sig.id));

      await db.insert(signalEvents).values({
        signalId: sig.id,
        eventType: step.eventType,
        previousStatus: sig.status,
        newStatus: step.newStatus,
        triggerPrice: step.triggerPrice,
        candleTime: new Date(latestCandle.openTime),
        note: step.note ?? `${step.eventType} triggered`,
      });

      if (creds.notificationsEnabled && creds.botToken && creds.chatId) {
        await dispatchTelegramIdempotent({
          signalId: sig.id,
          eventType: step.eventType,
          botToken: creds.botToken,
          chatId: creds.chatId,
          text: formatTelegramLifecycleUpdate({
            symbol: sig.symbol,
            direction: sig.direction,
            eventType: step.eventType,
            triggerPrice: step.triggerPrice,
            note: step.note ?? '',
          }),
        });
      }

      updatedCount += 1;
    }

    await recomputePerformanceStats();
    return { checked: active.length, updated: updatedCount };
  } catch (error) {
    console.error('Database error in evaluateActiveSignalsLifecycle:', error);
    throw new Error('Failed to evaluate signal lifecycle.', { cause: error });
  }
}

export async function recomputePerformanceStats() {
  try {
    const all = await db.select().from(tradingSignals).orderBy(tradingSignals.createdAt);
    const totalSignals = all.length;
    const filledSignals = all.filter((s) => s.filledAt !== null || s.status !== 'WAITING_FOR_ENTRY').length;
    const tp1Hits = all.filter((s) => ['TP1_HIT', 'TP2_HIT', 'TP3_HIT'].includes(s.status)).length;
    const tp2Hits = all.filter((s) => ['TP2_HIT', 'TP3_HIT'].includes(s.status)).length;
    const tp3Hits = all.filter((s) => s.status === 'TP3_HIT').length;
    const slHits = all.filter((s) => s.status === 'SL_HIT').length;
    const expiredCount = all.filter((s) => s.status === 'EXPIRED').length;

    const completedTrades = all.filter(
      (s) => s.filledAt !== null && ['TP1_HIT', 'TP2_HIT', 'TP3_HIT', 'SL_HIT'].includes(s.status)
    );
    const wins = completedTrades.filter((s) => s.status !== 'SL_HIT').length;
    const winRatePct = completedTrades.length > 0 ? (wins / completedTrades.length) * 100 : 0;
    const avgScore =
      totalSignals > 0 ? all.reduce((sum, s) => sum + s.totalScore, 0) / totalSignals : 0;
    const avgR =
      completedTrades.length > 0
        ? completedTrades.reduce((sum, s) => sum + (s.realizedPnlR ?? 0), 0) / completedTrades.length
        : 0;

    let equity = 100;
    let peak = 100;
    let maxDrawdownPct = 0;
    for (const t of completedTrades) {
      equity += t.realizedPnlPct ?? (t.realizedPnlR ?? 0) * t.riskPercent;
      if (equity > peak) peak = equity;
      const dd = peak > 0 ? ((peak - equity) / peak) * 100 : 0;
      if (dd > maxDrawdownPct) maxDrawdownPct = dd;
    }

    const netPnlPct = equity - 100;

    await db
      .insert(performanceStats)
      .values({
        period: 'all_time',
        totalSignals,
        filledSignals,
        tp1Hits,
        tp2Hits,
        tp3Hits,
        slHits,
        expiredCount,
        winRatePct: Number(winRatePct.toFixed(1)),
        avgScore: Number(avgScore.toFixed(1)),
        avgR: Number(avgR.toFixed(2)),
        netPnlPct: Number(netPnlPct.toFixed(2)),
        maxDrawdownPct: Number(maxDrawdownPct.toFixed(2)),
        computedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: performanceStats.period,
        set: {
          totalSignals,
          filledSignals,
          tp1Hits,
          tp2Hits,
          tp3Hits,
          slHits,
          expiredCount,
          winRatePct: Number(winRatePct.toFixed(1)),
          avgScore: Number(avgScore.toFixed(1)),
          avgR: Number(avgR.toFixed(2)),
          netPnlPct: Number(netPnlPct.toFixed(2)),
          maxDrawdownPct: Number(maxDrawdownPct.toFixed(2)),
          computedAt: new Date(),
        },
      });
  } catch (error) {
    console.error('Database error in recomputePerformanceStats:', error);
  }
}

export async function getPerformanceOverview() {
  try {
    const rows = await db
      .select()
      .from(performanceStats)
      .where(eq(performanceStats.period, 'all_time'))
      .limit(1);
    return rows[0] ?? null;
  } catch (error) {
    console.error('Database query failed in getPerformanceOverview:', error);
    throw new Error('Failed to fetch performance statistics.', { cause: error });
  }
}

export async function saveBacktestResult(userId: number, report: BacktestReport, riskPct: number, feeBps: number, slippageBps: number) {
  try {
    const inserted = await db
      .insert(backtestResults)
      .values({
        userId,
        symbol: report.symbol,
        timeframe: report.timeframe,
        splitMode: report.splitMode,
        startDate: new Date(report.startDate),
        endDate: new Date(report.endDate),
        initialEquity: report.initialEquity,
        riskPerTradePct: riskPct,
        feeBps,
        slippageBps,
        totalTrades: report.totalTrades,
        wins: report.wins,
        losses: report.losses,
        winRatePct: report.winRatePct,
        profitFactor: report.profitFactor,
        expectancyR: report.expectancyR,
        averageR: report.averageR,
        maxDrawdownPct: report.maxDrawdownPct,
        avgHoldingMinutes: report.avgHoldingMinutes,
        netPnlUsd: report.netPnlUsd,
        equityCurve: report.equityCurve,
        tradesLog: report.tradesLog as unknown as Array<Record<string, unknown>>,
      })
      .returning();
    return inserted[0];
  } catch (error) {
    console.error('Database error in saveBacktestResult:', error);
    throw new Error('Failed to save backtest result.', { cause: error });
  }
}

export async function listBacktestResults(limit = 20) {
  try {
    return await db
      .select()
      .from(backtestResults)
      .orderBy(desc(backtestResults.createdAt))
      .limit(limit);
  } catch (error) {
    console.error('Database query failed in listBacktestResults:', error);
    throw new Error('Failed to load saved backtests.', { cause: error });
  }
}

export async function upsertNewsItems(items: NewsIntelligenceItem[]) {
  try {
    if (items.length === 0) return;
    for (const item of items.slice(0, 8)) {
      await db.insert(marketNews).values({
        title: item.title,
        source: item.source,
        url: item.url,
        publishedAt: new Date(item.publishedAt),
        relevanceScore: item.relevanceScore,
        sentiment: item.sentiment,
        affectedSymbols: item.affectedSymbols,
        summaryEn: item.summaryEn,
        summaryBn: item.summaryBn,
        riskFlags: item.riskFlags,
        isVerified: item.isVerified,
      });
    }
  } catch (error) {
    console.error('Database error saving market news:', error);
  }
}

export async function upsertExchangeSymbols(
  symbols: Array<{
    symbol: string;
    baseAsset: string;
    quoteAsset: string;
    contractType: string;
    status: string;
    pricePrecision: number;
    quantityPrecision: number;
    tickSize: number;
    stepSize: number;
    minQty: number;
    minNotional: number;
    maxLeverage: number;
    isPriority: boolean;
  }>
) {
  try {
    for (const s of symbols.slice(0, 60)) {
      await db
        .insert(exchangeSymbols)
        .values({ ...s, lastSyncedAt: new Date() })
        .onConflictDoUpdate({
          target: exchangeSymbols.symbol,
          set: {
            status: s.status,
            tickSize: s.tickSize,
            stepSize: s.stepSize,
            lastSyncedAt: new Date(),
          },
        });
    }
  } catch (error) {
    console.error('Database error syncing exchange_symbols:', error);
  }
}

export async function listAuditLogs(limit = 40) {
  try {
    return await db
      .select()
      .from(auditLogs)
      .orderBy(desc(auditLogs.createdAt))
      .limit(limit);
  } catch (error) {
    console.error('Database query failed in listAuditLogs:', error);
    throw new Error('Failed to load audit logs.', { cause: error });
  }
}
