# AI Crypto Signal Intelligence

Production-oriented **Binance USDT-M Futures Scalping Signal Platform** featuring real-time perpetual contract discovery, multi-timeframe technical analysis (`4H`, `1H`, `15M`, `5M`), algorithmic Smart Money Concepts (SMC), deterministic 100-point signal scoring, Cloud SQL PostgreSQL persistence, Gemini AI explanations (English + non-technical Bangla), chronological backtesting, and automated Telegram signal lifecycle delivery.

## Project Directory Structure

- `server.ts` — Full-stack Express + Vite server (port 3000) with rate limiting, Binance WS/REST integration, Gemini AI routes, Telegram dispatch, and PostgreSQL endpoints
- `src/db/schema.ts` — Drizzle PostgreSQL schema (15 tables: `users`, `exchange_symbols`, `market_candles`, `market_metrics`, `indicator_snapshots`, `market_news`, `signal_candidates`, `trading_signals`, `signal_events`, `telegram_settings`, `telegram_messages`, `backtest_results`, `performance_stats`, `system_settings`, `audit_logs`)
- `src/db/index.ts` — Lazy `pg.Pool` Object Method connection pool
- `src/db/drizzle.config.ts` — Drizzle Kit schema migration configuration
- `src/engine/indicators.ts` — Deterministic EMA (9/20/50/100/200), RSI 14, MACD, ADX 14, ATR 14, Bollinger Bands, VWAP, OBV, Volume SMA 20, Fibonacci, S/R
- `src/engine/smc.ts` — Algorithmic HH/HL/LH/LL, BOS, CHoCH, Fair Value Gaps (FVG), Order Blocks, Liquidity Sweeps, Equal Highs/Lows
- `src/engine/scoring.ts` — 100-point scoring rubric, hard risk/liquidity validation, Entry/TP/SL & position sizing calculator, deterministic lifecycle processor
- `src/engine/backtest.ts` — Causal historical replay engine with fees, slippage, funding costs, and train/validation/out-of-sample splits
- `src/services/binance.ts` — Binance USDT-M Futures (`fapi.binance.com` & `fstream.binance.com`) REST + WebSocket client with caching and retries
- `src/services/gemini-ai.ts` — Server-side `@google/genai` (`gemini-4-hydrogen`) signal rationale & verified news summarizer
- `src/services/telegram.ts` — AES-256-GCM encrypted bot token management, message templates, and idempotent Telegram Bot API delivery
- `src/services/scanner.ts` — Automatic market scanner prioritizing `REZUSDT` and publishing up to Top 10 validated opportunities (or `NO TRADE`)
- `src/components/CandlestickChart.tsx` — Interactive TradingView Lightweight Charts canvas with EMA overlays and Entry/SL/TP price lines
- `tests/engine.test.ts` — Automated Vitest suite for indicators, SMC, scoring, position sizing, lifecycle state machine, and backtesting

## API Endpoints

### Public Market Data & Deterministic Engine
- `GET /api/health` — Server and Binance WebSocket telemetry
- `GET /api/market/overview` — Live Binance USDT-M Futures breadth, BTC/ETH/REZ stats, gainers, losers, volume leaders
- `GET /api/market/scanner` — Runs automatic coin scanner and returns Top 10 qualified opportunities or `noTradeMode: true`
- `GET /api/market/analyze/:symbol` — Multi-timeframe (`4h`, `1h`, `15m`, `5m`) candles, indicators, SMC, and independent LONG/SHORT evaluation
- `GET /api/market/news` — Verified crypto news feed summarized via Gemini AI (English & plain Bangla)
- `POST /api/market/backtest` — Executes chronological historical backtest on Binance Futures OHLCV
- `GET /api/stream` — Server-Sent Events stream of live WebSocket ticker updates

### Authenticated PostgreSQL, AI & Telegram Endpoints (`Authorization: Bearer <Firebase ID Token>`)
- `GET /api/auth/me` — Syncs Firebase user to PostgreSQL `users` table
- `GET /api/signals` & `GET /api/signals/:id` — Persisted signal history, events, and performance statistics
- `POST /api/signals/scan-and-persist` — Runs scanner, archives candidates & top signals, dispatches Telegram alerts
- `POST /api/signals/publish` — Publishes a selected candidate signal to PostgreSQL & Telegram
- `POST /api/signals/tick-lifecycle` — Evaluates active signals against latest 5m/1m candles (`ENTRY_FILLED`, `TP1/2/3`, `SL_HIT`, `EXPIRED`)
- `POST /api/gemini/explain-signal` — Generates structured English + Bangla AI explanation for a signal
- `GET/PUT /api/settings/system` & `GET/PUT /api/settings/telegram` & `POST /api/settings/telegram/test`
- `GET /api/backtests` & `POST /api/backtests/save`
- `GET /api/audit-logs`

## Environment Variables (See `.env.example`)
- `GEMINI_API_KEY` — Server-side Gemini API key (automatically injected in AI Studio)
- `SQL_HOST`, `SQL_DB_NAME`, `SQL_USER`, `SQL_PASSWORD`, `SQL_ADMIN_USER`, `SQL_ADMIN_PASSWORD` — Cloud SQL PostgreSQL variables
- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `SETTINGS_ENCRYPTION_KEY` — Optional server-side Telegram defaults & encryption key

## Running Locally & Tests
```bash
npm install
npm test        # Runs Vitest unit tests
npm run lint    # TypeScript type check
npm run dev     # Starts Express + Vite on port 3000
```
