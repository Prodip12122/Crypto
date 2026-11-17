import WebSocket from 'ws';
import type {
  Candle,
  CoinMarketSnapshot,
  ExchangeSymbolInfo,
  FundingAndOI,
  MarketTicker24h,
  OrderBookSnapshot,
  Timeframe,
} from '../types/trading.ts';

const FAPI_BASE = 'https://fapi.binance.com';
const FAPI_WS = 'wss://fstream.binance.com/ws/!miniTicker@arr';

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

class BinanceFuturesService {
  private cache = new Map<string, CacheEntry<unknown>>();
  private livePrices = new Map<string, { price: number; changePct24h: number; quoteVolume: number; updatedAt: number }>();
  private ws: WebSocket | null = null;
  private wsStatus: 'connected' | 'reconnecting' | 'disconnected' = 'disconnected';
  private wsLastMessageAt: number | null = null;
  private wsReconnectCount = 0;
  private wsTimer: NodeJS.Timeout | null = null;
  private wsListeners = new Set<(prices: Array<{ s: string; c: number; q: number }>) => void>();

  constructor() {
    // WebSocket connects lazily when server starts stream
  }

  public startWebSocket(): void {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }
    try {
      this.wsStatus = 'reconnecting';
      this.ws = new WebSocket(FAPI_WS);

      this.ws.on('open', () => {
        this.wsStatus = 'connected';
        this.wsLastMessageAt = Date.now();
      });

      this.ws.on('message', (raw: WebSocket.RawData) => {
        try {
          const arr = JSON.parse(raw.toString()) as Array<{
            s: string;
            c: string;
            o: string;
            q: string;
          }>;
          if (!Array.isArray(arr)) return;
          const now = Date.now();
          this.wsLastMessageAt = now;
          const updates: Array<{ s: string; c: number; q: number }> = [];
          for (const item of arr) {
            const close = Number(item.c);
            const open = Number(item.o);
            const qVol = Number(item.q);
            const changePct = open > 0 ? ((close - open) / open) * 100 : 0;
            this.livePrices.set(item.s, {
              price: close,
              changePct24h: changePct,
              quoteVolume: qVol,
              updatedAt: now,
            });
            updates.push({ s: item.s, c: close, q: qVol });
          }
          for (const listener of this.wsListeners) {
            listener(updates);
          }
        } catch {
          // Ignore malformed frame
        }
      });

      this.ws.on('close', () => {
        this.wsStatus = 'reconnecting';
        this.scheduleReconnect();
      });

      this.ws.on('error', () => {
        this.wsStatus = 'reconnecting';
        this.ws?.terminate();
      });
    } catch {
      this.wsStatus = 'disconnected';
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.wsTimer) return;
    this.wsReconnectCount += 1;
    const delayMs = Math.min(30000, 1500 * Math.pow(1.5, Math.min(this.wsReconnectCount, 6)));
    this.wsTimer = setTimeout(() => {
      this.wsTimer = null;
      this.startWebSocket();
    }, delayMs);
  }

  public getConnectionStatus() {
    return {
      status: this.wsStatus,
      lastMessageAt: this.wsLastMessageAt ? new Date(this.wsLastMessageAt).toISOString() : null,
      reconnectCount: this.wsReconnectCount,
      trackedSymbolsCount: this.livePrices.size,
    };
  }

  public getLivePrice(symbol: string) {
    return this.livePrices.get(symbol) ?? null;
  }

  public subscribeLivePrices(fn: (prices: Array<{ s: string; c: number; q: number }>) => void): () => void {
    this.wsListeners.add(fn);
    return () => this.wsListeners.delete(fn);
  }

  private getCached<T>(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }
    return entry.data as T;
  }

  private setCached<T>(key: string, data: T, ttlMs: number): void {
    this.cache.set(key, { data, expiresAt: Date.now() + ttlMs });
  }

  private async fetchJson<T>(path: string, retries = 2): Promise<T> {
    let lastErr: unknown;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 9000);
        const res = await fetch(`${FAPI_BASE}${path}`, {
          signal: controller.signal,
          headers: { Accept: 'application/json' },
        });
        clearTimeout(timeout);

        if (res.status === 429 || res.status === 418) {
          const retryAfter = Number(res.headers.get('Retry-After') || '2');
          await new Promise((r) => setTimeout(r, retryAfter * 1000));
          continue;
        }
        if (!res.ok) {
          throw new Error(`Binance Futures API HTTP ${res.status} for ${path}`);
        }
        return (await res.json()) as T;
      } catch (err) {
        lastErr = err;
        if (attempt < retries) {
          await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
        }
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  }

  public async fetchExchangeInfo(): Promise<ExchangeSymbolInfo[]> {
    const cacheKey = 'exchangeInfo';
    const cached = this.getCached<ExchangeSymbolInfo[]>(cacheKey);
    if (cached) return cached;

    interface RawExchangeInfo {
      symbols: Array<{
        symbol: string;
        baseAsset: string;
        quoteAsset: string;
        contractType: string;
        status: string;
        pricePrecision: number;
        quantityPrecision: number;
        filters: Array<{
          filterType: string;
          tickSize?: string;
          stepSize?: string;
          minQty?: string;
          notional?: string;
        }>;
      }>;
    }

    const raw = await this.fetchJson<RawExchangeInfo>('/fapi/v1/exchangeInfo');
    const eligible: ExchangeSymbolInfo[] = raw.symbols
      .filter(
        (s) =>
          s.status === 'TRADING' &&
          s.quoteAsset === 'USDT' &&
          s.contractType === 'PERPETUAL'
      )
      .map((s) => {
        const priceFilter = s.filters.find((f) => f.filterType === 'PRICE_FILTER');
        const lotFilter = s.filters.find((f) => f.filterType === 'LOT_SIZE');
        const minNotionalFilter = s.filters.find((f) => f.filterType === 'MIN_NOTIONAL');
        return {
          symbol: s.symbol,
          baseAsset: s.baseAsset,
          quoteAsset: s.quoteAsset,
          contractType: s.contractType,
          status: s.status,
          pricePrecision: s.pricePrecision,
          quantityPrecision: s.quantityPrecision,
          tickSize: Number(priceFilter?.tickSize || 0.0001),
          stepSize: Number(lotFilter?.stepSize || 0.001),
          minQty: Number(lotFilter?.minQty || 0.001),
          minNotional: Number(minNotionalFilter?.notional || 5),
          maxLeverage: 20,
          isPriority: s.symbol === 'REZUSDT',
        };
      });

    this.setCached(cacheKey, eligible, 10 * 60 * 1000);
    return eligible;
  }

  public async fetchAll24hTickers(): Promise<Map<string, MarketTicker24h>> {
    const cacheKey = 'tickers24h';
    const cached = this.getCached<Map<string, MarketTicker24h>>(cacheKey);
    if (cached) return cached;

    interface RawTicker {
      symbol: string;
      lastPrice: string;
      priceChangePercent: string;
      highPrice: string;
      lowPrice: string;
      volume: string;
      quoteVolume: string;
      openTime: number;
      closeTime: number;
    }

    const list = await this.fetchJson<RawTicker[]>('/fapi/v1/ticker/24hr');
    const map = new Map<string, MarketTicker24h>();
    for (const t of list) {
      const lastPrice = Number(t.lastPrice);
      const quoteVolume = Number(t.quoteVolume);
      const live = this.livePrices.get(t.symbol);
      map.set(t.symbol, {
        symbol: t.symbol,
        lastPrice: live && Date.now() - live.updatedAt < 15000 ? live.price : lastPrice,
        priceChangePercent: Number(t.priceChangePercent),
        highPrice: Number(t.highPrice),
        lowPrice: Number(t.lowPrice),
        volume: Number(t.volume),
        quoteVolume,
        openTime: t.openTime,
        closeTime: t.closeTime,
      });
    }

    this.setCached(cacheKey, map, 20_000);
    return map;
  }

  public async fetchAllPremiumIndex(): Promise<
    Map<string, { markPrice: number; indexPrice: number; fundingRate: number; nextFundingTime: number }>
  > {
    const cacheKey = 'premiumIndexAll';
    const cached =
      this.getCached<Map<string, { markPrice: number; indexPrice: number; fundingRate: number; nextFundingTime: number }>>(
        cacheKey
      );
    if (cached) return cached;

    interface RawPrem {
      symbol: string;
      markPrice: string;
      indexPrice: string;
      lastFundingRate: string;
      nextFundingTime: number;
    }

    const list = await this.fetchJson<RawPrem[]>('/fapi/v1/premiumIndex');
    const map = new Map<
      string,
      { markPrice: number; indexPrice: number; fundingRate: number; nextFundingTime: number }
    >();
    for (const p of list) {
      map.set(p.symbol, {
        markPrice: Number(p.markPrice),
        indexPrice: Number(p.indexPrice),
        fundingRate: Number(p.lastFundingRate),
        nextFundingTime: p.nextFundingTime,
      });
    }
    this.setCached(cacheKey, map, 25_000);
    return map;
  }

  public async fetchKlines(
    symbol: string,
    interval: Timeframe | '1m',
    limit = 220
  ): Promise<Candle[]> {
    const cacheKey = `klines:${symbol}:${interval}:${limit}`;
    const ttl = interval === '5m' || interval === '1m' ? 15_000 : interval === '15m' ? 30_000 : 60_000;
    const cached = this.getCached<Candle[]>(cacheKey);
    if (cached) return cached;

    type RawKline = [
      number,
      string,
      string,
      string,
      string,
      string,
      number,
      string,
      number,
      string,
      string,
      string,
    ];
    const rows = await this.fetchJson<RawKline[]>(
      `/fapi/v1/klines?symbol=${encodeURIComponent(symbol)}&interval=${interval}&limit=${limit}`
    );
    const now = Date.now();
    const candles: Candle[] = rows.map((r) => ({
      openTime: r[0],
      open: Number(r[1]),
      high: Number(r[2]),
      low: Number(r[3]),
      close: Number(r[4]),
      volume: Number(r[5]),
      closeTime: r[6],
      quoteVolume: Number(r[7]),
      trades: r[8],
      isClosed: r[6] <= now,
    }));

    this.setCached(cacheKey, candles, ttl);
    return candles;
  }

  public async fetchOrderBook(symbol: string, limit = 20): Promise<OrderBookSnapshot> {
    const cacheKey = `depth:${symbol}`;
    const cached = this.getCached<OrderBookSnapshot>(cacheKey);
    if (cached) return cached;

    interface RawDepth {
      bids: Array<[string, string]>;
      asks: Array<[string, string]>;
    }
    const raw = await this.fetchJson<RawDepth>(
      `/fapi/v1/depth?symbol=${encodeURIComponent(symbol)}&limit=${limit}`
    );
    const bestBid = Number(raw.bids[0]?.[0] || 0);
    const bestAsk = Number(raw.asks[0]?.[0] || 0);
    const mid = (bestBid + bestAsk) / 2;
    const spreadBps = mid > 0 ? ((bestAsk - bestBid) / mid) * 10000 : 999;

    const bidDepthUsd = raw.bids.reduce((sum, [p, q]) => sum + Number(p) * Number(q), 0);
    const askDepthUsd = raw.asks.reduce((sum, [p, q]) => sum + Number(p) * Number(q), 0);
    const totalDepth = bidDepthUsd + askDepthUsd;
    const imbalance = totalDepth > 0 ? (bidDepthUsd - askDepthUsd) / totalDepth : 0;

    const snapshot: OrderBookSnapshot = {
      symbol,
      bestBid,
      bestAsk,
      spreadBps: Number(spreadBps.toFixed(2)),
      bidDepthUsd: Number(bidDepthUsd.toFixed(2)),
      askDepthUsd: Number(askDepthUsd.toFixed(2)),
      imbalance: Number(imbalance.toFixed(3)),
      timestamp: Date.now(),
    };
    this.setCached(cacheKey, snapshot, 15_000);
    return snapshot;
  }

  public async fetchDerivativesMetrics(
    symbol: string,
    lastPrice: number,
    prem?: { markPrice: number; indexPrice: number; fundingRate: number; nextFundingTime: number }
  ): Promise<FundingAndOI> {
    const cacheKey = `deriv:${symbol}`;
    const cached = this.getCached<FundingAndOI>(cacheKey);
    if (cached) return cached;

    let openInterest = 0;
    let openInterestChangePct: number | null = null;
    let longShortRatio: number | null = null;

    try {
      const oi = await this.fetchJson<{ openInterest: string }>(
        `/fapi/v1/openInterest?symbol=${encodeURIComponent(symbol)}`
      );
      openInterest = Number(oi.openInterest);
    } catch {
      openInterest = 0;
    }

    try {
      const ls = await this.fetchJson<Array<{ longShortRatio: string }>>(
        `/futures/data/globalLongShortAccountRatio?symbol=${encodeURIComponent(symbol)}&period=15m&limit=2`
      );
      if (ls.length > 0) {
        longShortRatio = Number(ls[ls.length - 1].longShortRatio);
      }
    } catch {
      longShortRatio = null;
    }

    try {
      const oiHist = await this.fetchJson<Array<{ sumOpenInterestValue: string }>>(
        `/futures/data/openInterestHist?symbol=${encodeURIComponent(symbol)}&period=15m&limit=2`
      );
      if (oiHist.length >= 2) {
        const prev = Number(oiHist[0].sumOpenInterestValue);
        const curr = Number(oiHist[1].sumOpenInterestValue);
        if (prev > 0) {
          openInterestChangePct = Number((((curr - prev) / prev) * 100).toFixed(2));
        }
      }
    } catch {
      openInterestChangePct = null;
    }

    const result: FundingAndOI = {
      symbol,
      markPrice: prem?.markPrice ?? lastPrice,
      indexPrice: prem?.indexPrice ?? lastPrice,
      fundingRate: prem?.fundingRate ?? 0,
      nextFundingTime: prem?.nextFundingTime ?? Date.now() + 3600_000,
      openInterest,
      openInterestValue: Number((openInterest * lastPrice).toFixed(2)),
      openInterestChangePct,
      longShortRatio,
      timestamp: Date.now(),
    };
    this.setCached(cacheKey, result, 30_000);
    return result;
  }

  public async fetchCoinSnapshot(symbolInfo: ExchangeSymbolInfo): Promise<CoinMarketSnapshot | null> {
    const tickers = await this.fetchAll24hTickers();
    const premMap = await this.fetchAllPremiumIndex();
    const ticker = tickers.get(symbolInfo.symbol);
    if (!ticker) return null;

    const [orderBook, derivatives] = await Promise.all([
      this.fetchOrderBook(symbolInfo.symbol, 20),
      this.fetchDerivativesMetrics(
        symbolInfo.symbol,
        ticker.lastPrice,
        premMap.get(symbolInfo.symbol)
      ),
    ]);

    return {
      symbolInfo,
      ticker,
      orderBook,
      derivatives,
      fetchedAt: Date.now(),
    };
  }
}

export const binanceService = new BinanceFuturesService();
