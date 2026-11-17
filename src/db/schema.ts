import { relations } from 'drizzle-orm';
import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

// 1. users
export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  uid: text('uid').notNull().unique(),
  email: text('email').notNull(),
  displayName: text('display_name'),
  role: text('role').notNull().default('admin'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// 2. exchange_symbols
export const exchangeSymbols = pgTable(
  'exchange_symbols',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    symbol: text('symbol').notNull().unique(),
    baseAsset: text('base_asset').notNull(),
    quoteAsset: text('quote_asset').notNull(),
    contractType: text('contract_type').notNull(),
    status: text('status').notNull(),
    pricePrecision: integer('price_precision').notNull(),
    quantityPrecision: integer('quantity_precision').notNull(),
    tickSize: doublePrecision('tick_size').notNull(),
    stepSize: doublePrecision('step_size').notNull(),
    minQty: doublePrecision('min_qty').notNull(),
    minNotional: doublePrecision('min_notional').notNull(),
    maxLeverage: integer('max_leverage').notNull().default(20),
    isPriority: boolean('is_priority').notNull().default(false),
    lastSyncedAt: timestamp('last_synced_at').defaultNow().notNull(),
  },
  (table) => [index('idx_exchange_symbols_status').on(table.status)]
);

// 3. market_candles
export const marketCandles = pgTable(
  'market_candles',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    symbol: text('symbol').notNull(),
    timeframe: text('timeframe').notNull(),
    openTime: timestamp('open_time').notNull(),
    closeTime: timestamp('close_time').notNull(),
    open: doublePrecision('open').notNull(),
    high: doublePrecision('high').notNull(),
    low: doublePrecision('low').notNull(),
    close: doublePrecision('close').notNull(),
    volume: doublePrecision('volume').notNull(),
    quoteVolume: doublePrecision('quote_volume').notNull(),
    trades: integer('trades').notNull().default(0),
    isClosed: boolean('is_closed').notNull().default(true),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('idx_market_candles_sym_tf_time').on(table.symbol, table.timeframe, table.openTime)]
);

// 4. market_metrics
export const marketMetrics = pgTable(
  'market_metrics',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    symbol: text('symbol').notNull(),
    markPrice: doublePrecision('mark_price').notNull(),
    indexPrice: doublePrecision('index_price').notNull(),
    lastPrice: doublePrecision('last_price').notNull(),
    fundingRate: doublePrecision('funding_rate').notNull(),
    nextFundingTime: timestamp('next_funding_time'),
    openInterest: doublePrecision('open_interest').notNull(),
    openInterestValue: doublePrecision('open_interest_value').notNull(),
    longShortRatio: doublePrecision('long_short_ratio'),
    volume24h: doublePrecision('volume_24h').notNull(),
    quoteVolume24h: doublePrecision('quote_volume_24h').notNull(),
    priceChangePercent24h: doublePrecision('price_change_percent_24h').notNull(),
    bidPrice: doublePrecision('bid_price').notNull(),
    askPrice: doublePrecision('ask_price').notNull(),
    spreadBps: doublePrecision('spread_bps').notNull(),
    orderBookImbalance: doublePrecision('order_book_imbalance').notNull(),
    capturedAt: timestamp('captured_at').defaultNow().notNull(),
  },
  (table) => [index('idx_market_metrics_symbol_time').on(table.symbol, table.capturedAt)]
);

// 5. indicator_snapshots
export const indicatorSnapshots = pgTable(
  'indicator_snapshots',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    symbol: text('symbol').notNull(),
    timeframe: text('timeframe').notNull(),
    candleTime: timestamp('candle_time').notNull(),
    ema9: doublePrecision('ema_9').notNull(),
    ema20: doublePrecision('ema_20').notNull(),
    ema50: doublePrecision('ema_50').notNull(),
    ema100: doublePrecision('ema_100').notNull(),
    ema200: doublePrecision('ema_200').notNull(),
    rsi14: doublePrecision('rsi_14').notNull(),
    macd: doublePrecision('macd').notNull(),
    macdSignal: doublePrecision('macd_signal').notNull(),
    macdHistogram: doublePrecision('macd_histogram').notNull(),
    adx14: doublePrecision('adx_14').notNull(),
    atr14: doublePrecision('atr_14').notNull(),
    bbUpper: doublePrecision('bb_upper').notNull(),
    bbMiddle: doublePrecision('bb_middle').notNull(),
    bbLower: doublePrecision('bb_lower').notNull(),
    vwap: doublePrecision('vwap').notNull(),
    obv: doublePrecision('obv').notNull(),
    volumeSma20: doublePrecision('volume_sma_20').notNull(),
    smcSummary: jsonb('smc_summary').$type<Record<string, unknown>>().notNull(),
    srLevels: jsonb('sr_levels').$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('idx_indicator_snapshots_sym_tf').on(table.symbol, table.timeframe, table.candleTime)]
);

// 6. market_news
export const marketNews = pgTable(
  'market_news',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    title: text('title').notNull(),
    source: text('source').notNull(),
    url: text('url').notNull(),
    publishedAt: timestamp('published_at').notNull(),
    relevanceScore: integer('relevance_score').notNull(),
    sentiment: text('sentiment').notNull(),
    affectedSymbols: jsonb('affected_symbols').$type<string[]>().notNull(),
    summaryEn: text('summary_en').notNull(),
    summaryBn: text('summary_bn').notNull(),
    riskFlags: jsonb('risk_flags').$type<string[]>().notNull(),
    isVerified: boolean('is_verified').notNull().default(true),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('idx_market_news_published').on(table.publishedAt)]
);

// 7. signal_candidates
export const signalCandidates = pgTable(
  'signal_candidates',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    scanCycleId: text('scan_cycle_id').notNull(),
    symbol: text('symbol').notNull(),
    direction: text('direction').notNull(),
    totalScore: integer('total_score').notNull(),
    classification: text('classification').notNull(),
    scoreBreakdown: jsonb('score_breakdown').$type<Record<string, number>>().notNull(),
    rejectionReason: text('rejection_reason'),
    passedValidation: boolean('passed_validation').notNull(),
    metricsSnapshot: jsonb('metrics_snapshot').$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('idx_signal_candidates_cycle').on(table.scanCycleId, table.totalScore)]
);

// 8. trading_signals
export const tradingSignals = pgTable(
  'trading_signals',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: integer('user_id').references(() => users.id),
    symbol: text('symbol').notNull(),
    direction: text('direction').notNull(),
    entryType: text('entry_type').notNull(),
    status: text('status').notNull().default('WAITING_FOR_ENTRY'),
    totalScore: integer('total_score').notNull(),
    classification: text('classification').notNull(),
    entryLimitPrice: doublePrecision('entry_limit_price').notNull(),
    entryZoneLow: doublePrecision('entry_zone_low').notNull(),
    entryZoneHigh: doublePrecision('entry_zone_high').notNull(),
    stopLoss: doublePrecision('stop_loss').notNull(),
    tp1: doublePrecision('tp1').notNull(),
    tp2: doublePrecision('tp2').notNull(),
    tp3: doublePrecision('tp3').notNull(),
    riskRewardRatio: doublePrecision('risk_reward_ratio').notNull(),
    positionSizeUsd: doublePrecision('position_size_usd').notNull(),
    leverage: integer('leverage').notNull(),
    riskPercent: doublePrecision('risk_percent').notNull(),
    estimatedHoldingMinutes: integer('estimated_holding_minutes').notNull(),
    signalExpiryAt: timestamp('signal_expiry_at').notNull(),
    timeframePrimary: text('timeframe_primary').notNull().default('5m'),
    scoreBreakdown: jsonb('score_breakdown').$type<Record<string, number>>().notNull(),
    technicalSummary: jsonb('technical_summary').$type<Record<string, unknown>>().notNull(),
    smcSummary: jsonb('smc_summary').$type<Record<string, unknown>>().notNull(),
    fundamentalContext: jsonb('fundamental_context').$type<Record<string, unknown>>().notNull(),
    aiExplanationEn: text('ai_explanation_en').notNull(),
    aiExplanationBn: text('ai_explanation_bn').notNull(),
    ambiguousResolution: text('ambiguous_resolution'),
    realizedPnlR: doublePrecision('realized_pnl_r'),
    realizedPnlPct: doublePrecision('realized_pnl_pct'),
    filledAt: timestamp('filled_at'),
    closedAt: timestamp('closed_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    index('idx_trading_signals_status').on(table.status),
    index('idx_trading_signals_symbol').on(table.symbol, table.createdAt),
  ]
);

// 9. signal_events
export const signalEvents = pgTable(
  'signal_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    signalId: uuid('signal_id')
      .references(() => tradingSignals.id, { onDelete: 'cascade' })
      .notNull(),
    eventType: text('event_type').notNull(),
    previousStatus: text('previous_status').notNull(),
    newStatus: text('new_status').notNull(),
    triggerPrice: doublePrecision('trigger_price').notNull(),
    candleTime: timestamp('candle_time').notNull(),
    note: text('note').notNull(),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('idx_signal_events_signal').on(table.signalId, table.createdAt)]
);

// 10. telegram_settings
export const telegramSettings = pgTable('telegram_settings', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: integer('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull()
    .unique(),
  botTokenEncrypted: text('bot_token_encrypted'),
  channelChatId: text('channel_chat_id').notNull().default(''),
  notificationsEnabled: boolean('notifications_enabled').notNull().default(false),
  minSignalScore: integer('min_signal_score').notNull().default(80),
  messageFormat: text('message_format').notNull().default('standard'),
  lastTestStatus: text('last_test_status'),
  lastTestAt: timestamp('last_test_at'),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// 11. telegram_messages
export const telegramMessages = pgTable(
  'telegram_messages',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    signalId: uuid('signal_id')
      .references(() => tradingSignals.id, { onDelete: 'cascade' })
      .notNull(),
    idempotencyKey: text('idempotency_key').notNull().unique(),
    chatId: text('chat_id').notNull(),
    telegramMessageId: text('telegram_message_id'),
    eventType: text('event_type').notNull(),
    payload: text('payload').notNull(),
    status: text('status').notNull(),
    retryCount: integer('retry_count').notNull().default(0),
    errorMessage: text('error_message'),
    sentAt: timestamp('sent_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('idx_telegram_messages_signal').on(table.signalId)]
);

// 12. backtest_results
export const backtestResults = pgTable(
  'backtest_results',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: integer('user_id').references(() => users.id),
    symbol: text('symbol').notNull(),
    timeframe: text('timeframe').notNull(),
    splitMode: text('split_mode').notNull().default('out_of_sample'),
    startDate: timestamp('start_date').notNull(),
    endDate: timestamp('end_date').notNull(),
    initialEquity: doublePrecision('initial_equity').notNull(),
    riskPerTradePct: doublePrecision('risk_per_trade_pct').notNull(),
    feeBps: doublePrecision('fee_bps').notNull(),
    slippageBps: doublePrecision('slippage_bps').notNull(),
    totalTrades: integer('total_trades').notNull(),
    wins: integer('wins').notNull(),
    losses: integer('losses').notNull(),
    winRatePct: doublePrecision('win_rate_pct').notNull(),
    profitFactor: doublePrecision('profit_factor').notNull(),
    expectancyR: doublePrecision('expectancy_r').notNull(),
    averageR: doublePrecision('average_r').notNull(),
    maxDrawdownPct: doublePrecision('max_drawdown_pct').notNull(),
    avgHoldingMinutes: doublePrecision('avg_holding_minutes').notNull(),
    netPnlUsd: doublePrecision('net_pnl_usd').notNull(),
    equityCurve: jsonb('equity_curve').$type<Array<{ time: string; equity: number }>>().notNull(),
    tradesLog: jsonb('trades_log').$type<Array<Record<string, unknown>>>().notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('idx_backtest_results_symbol').on(table.symbol, table.createdAt)]
);

// 13. performance_stats
export const performanceStats = pgTable('performance_stats', {
  id: uuid('id').defaultRandom().primaryKey(),
  period: text('period').notNull().unique(),
  totalSignals: integer('total_signals').notNull().default(0),
  filledSignals: integer('filled_signals').notNull().default(0),
  tp1Hits: integer('tp1_hits').notNull().default(0),
  tp2Hits: integer('tp2_hits').notNull().default(0),
  tp3Hits: integer('tp3_hits').notNull().default(0),
  slHits: integer('sl_hits').notNull().default(0),
  expiredCount: integer('expired_count').notNull().default(0),
  winRatePct: doublePrecision('win_rate_pct').notNull().default(0),
  avgScore: doublePrecision('avg_score').notNull().default(0),
  avgR: doublePrecision('avg_r').notNull().default(0),
  netPnlPct: doublePrecision('net_pnl_pct').notNull().default(0),
  maxDrawdownPct: doublePrecision('max_drawdown_pct').notNull().default(0),
  computedAt: timestamp('computed_at').defaultNow().notNull(),
});

// 14. system_settings
export const systemSettings = pgTable('system_settings', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: integer('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull()
    .unique(),
  scanFrequencySec: integer('scan_frequency_sec').notNull().default(60),
  minVolume24hUsd: doublePrecision('min_volume_24h_usd').notNull().default(5000000),
  minSignalScore: integer('min_signal_score').notNull().default(80),
  maxActiveSignals: integer('max_active_signals').notNull().default(10),
  riskPercentage: doublePrecision('risk_percentage').notNull().default(1.0),
  maxLeverage: integer('max_leverage').notNull().default(10),
  minRiskReward: doublePrecision('min_risk_reward').notNull().default(1.8),
  timeframes: jsonb('timeframes')
    .$type<{ entry: string; setup: string; trend: string; macro: string }>()
    .notNull()
    .default({ entry: '5m', setup: '15m', trend: '1h', macro: '4h' }),
  rezPriorityEnabled: boolean('rez_priority_enabled').notNull().default(true),
  aiNewsAnalysisEnabled: boolean('ai_news_analysis_enabled').notNull().default(true),
  scannerEnabled: boolean('scanner_enabled').notNull().default(true),
  accountEquityUsd: doublePrecision('account_equity_usd').notNull().default(10000),
  languageMode: text('language_mode').notNull().default('en_bn'),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// 15. audit_logs (for Section 18 Security & Auditability)
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userUid: text('user_uid').notNull(),
    action: text('action').notNull(),
    resource: text('resource').notNull(),
    details: jsonb('details').$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('idx_audit_logs_time').on(table.createdAt)]
);

// Relations
export const usersRelations = relations(users, ({ many, one }) => ({
  signals: many(tradingSignals),
  backtests: many(backtestResults),
  telegramConfig: one(telegramSettings, {
    fields: [users.id],
    references: [telegramSettings.userId],
  }),
  settings: one(systemSettings, {
    fields: [users.id],
    references: [systemSettings.userId],
  }),
}));

export const tradingSignalsRelations = relations(tradingSignals, ({ one, many }) => ({
  owner: one(users, {
    fields: [tradingSignals.userId],
    references: [users.id],
  }),
  events: many(signalEvents),
  telegramDeliveries: many(telegramMessages),
}));

export const signalEventsRelations = relations(signalEvents, ({ one }) => ({
  signal: one(tradingSignals, {
    fields: [signalEvents.signalId],
    references: [tradingSignals.id],
  }),
}));

export const telegramMessagesRelations = relations(telegramMessages, ({ one }) => ({
  signal: one(tradingSignals, {
    fields: [telegramMessages.signalId],
    references: [tradingSignals.id],
  }),
}));
