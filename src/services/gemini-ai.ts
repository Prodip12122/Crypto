import { GoogleGenAI, Type } from '@google/genai';
import type { NewsIntelligenceItem, SignalEvaluation } from '../types/trading.ts';

function getGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') return null;
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

export async function generateSignalAIExplanation(signal: SignalEvaluation): Promise<{
  explanationEn: string;
  explanationBn: string;
  aiPowered: boolean;
}> {
  const ai = getGeminiClient();
  if (!ai) {
    return {
      explanationEn: signal.deterministicRationaleEn,
      explanationBn: signal.deterministicRationaleBn,
      aiPowered: false,
    };
  }

  const structuredData = {
    symbol: signal.symbol,
    direction: signal.direction,
    entryType: signal.entryType,
    totalScore: signal.totalScore,
    classification: signal.classification,
    entryLimitPrice: signal.entryLimitPrice,
    stopLoss: signal.stopLoss,
    tp1: signal.tp1,
    tp2: signal.tp2,
    tp3: signal.tp3,
    riskRewardRatio: signal.riskRewardRatio,
    estimatedHoldingMinutes: signal.estimatedHoldingMinutes,
    scoreBreakdown: signal.scoreBreakdown,
    technicalSummary: signal.technicalSummary,
    smcSummary: signal.smcSummary,
    fundamentalContext: signal.fundamentalContext,
  };

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: `Explain this deterministic Binance Futures scalping signal strictly from the provided verified data. Do NOT invent prices, news, or probabilities.\n\nData:\n${JSON.stringify(structuredData)}`,
      config: {
        systemInstruction:
          'You are a disciplined quantitative crypto futures analyst. Produce two concise explanations: (1) explanationEn: crisp 2-3 sentence professional trading rationale citing the exact indicators, SMC structure, and risk levels; (2) explanationBn: clear, easy-to-understand non-technical Bangla explanation (সাধারণ মানুষের বোঝার মতো সহজ বাংলায় ট্রেডিং সিগন্যালটির কারণ, এন্ট্রি ও ঝুঁকি ব্যবস্থাপনা বুঝিয়ে বলুন, কোনো জটিল পরিভাষা ব্যবহার করলে সহজ অর্থ বলে দিন). Never claim guaranteed profit.',
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            explanationEn: { type: Type.STRING },
            explanationBn: { type: Type.STRING },
          },
          required: ['explanationEn', 'explanationBn'],
        },
      },
    });

    const parsed = JSON.parse((response.text ?? '{}').trim()) as {
      explanationEn?: string;
      explanationBn?: string;
    };

    return {
      explanationEn: parsed.explanationEn || signal.deterministicRationaleEn,
      explanationBn: parsed.explanationBn || signal.deterministicRationaleBn,
      aiPowered: true,
    };
  } catch (err) {
    console.error('Gemini signal explanation error:', err);
    return {
      explanationEn: signal.deterministicRationaleEn,
      explanationBn: signal.deterministicRationaleBn,
      aiPowered: false,
    };
  }
}

interface RawCryptoCompareNews {
  id: string;
  title: string;
  url: string;
  source: string;
  published_on: number;
  body: string;
  categories: string;
}

export async function fetchVerifiedCryptoNews(btcTrend: string): Promise<{
  items: NewsIntelligenceItem[];
  sourceStatus: 'live' | 'unavailable';
  error?: string;
}> {
  let rawArticles: RawCryptoCompareNews[] = [];
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const res = await fetch('https://min-api.cryptocompare.com/data/v2/news/?lang=EN', {
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) {
      throw new Error(`News feed HTTP ${res.status}`);
    }
    const json = (await res.json()) as { Data?: RawCryptoCompareNews[] };
    rawArticles = (json.Data ?? []).slice(0, 8);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unable to reach verified news feed';
    return { items: [], sourceStatus: 'unavailable', error: message };
  }

  if (rawArticles.length === 0) {
    return { items: [], sourceStatus: 'unavailable', error: 'No verified articles returned.' };
  }

  const ai = getGeminiClient();
  if (!ai) {
    return {
      sourceStatus: 'live',
      items: rawArticles.map((a) => ({
        id: String(a.id),
        title: a.title,
        source: a.source,
        url: a.url,
        publishedAt: new Date(a.published_on * 1000).toISOString(),
        relevanceScore: 70,
        sentiment: 'neutral' as const,
        affectedSymbols: extractSymbols(a.title + ' ' + a.categories),
        summaryEn: a.body.slice(0, 220) + (a.body.length > 220 ? '...' : ''),
        summaryBn: `${a.source} থেকে প্রকাশিত সংবাদ: ${a.title}`,
        riskFlags: [],
        isVerified: true,
      })),
    };
  }

  try {
    const compactInput = rawArticles.map((a) => ({
      id: String(a.id),
      title: a.title,
      source: a.source,
      publishedAt: new Date(a.published_on * 1000).toISOString(),
      excerpt: a.body.slice(0, 320),
    }));

    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: `Current BTC 4H trend: ${btcTrend}. Analyze these verified crypto news articles for Binance USDT-M Futures scalping risk and sentiment. Do NOT invent any news items.\n\nArticles:\n${JSON.stringify(compactInput)}`,
      config: {
        systemInstruction:
          'Analyze each verified news article objectively. Return JSON array matching input IDs with relevanceScore (0-100), sentiment (bullish|bearish|neutral), affectedSymbols (array of ticker symbols like BTCUSDT, ETHUSDT, REZUSDT, SOLUSDT), summaryEn (1-2 sentences), summaryBn (1-2 sentences in plain, non-technical Bangla), and riskFlags (array of short risk tags like "Volatility Event", "Macro Data", "Token Unlock", "Liquidation Risk" only when genuinely present in the article).',
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              id: { type: Type.STRING },
              relevanceScore: { type: Type.INTEGER },
              sentiment: { type: Type.STRING },
              affectedSymbols: { type: Type.ARRAY, items: { type: Type.STRING } },
              summaryEn: { type: Type.STRING },
              summaryBn: { type: Type.STRING },
              riskFlags: { type: Type.ARRAY, items: { type: Type.STRING } },
            },
            required: ['id', 'relevanceScore', 'sentiment', 'affectedSymbols', 'summaryEn', 'summaryBn', 'riskFlags'],
          },
        },
      },
    });

    const enrichedList = JSON.parse((response.text ?? '[]').trim()) as Array<{
      id: string;
      relevanceScore: number;
      sentiment: string;
      affectedSymbols: string[];
      summaryEn: string;
      summaryBn: string;
      riskFlags: string[];
    }>;

    const byId = new Map(enrichedList.map((e) => [e.id, e]));

    const items: NewsIntelligenceItem[] = rawArticles.map((a) => {
      const e = byId.get(String(a.id));
      const sentiment =
        e?.sentiment === 'bullish' || e?.sentiment === 'bearish' ? e.sentiment : 'neutral';
      return {
        id: String(a.id),
        title: a.title,
        source: a.source,
        url: a.url,
        publishedAt: new Date(a.published_on * 1000).toISOString(),
        relevanceScore: e?.relevanceScore ?? 65,
        sentiment,
        affectedSymbols: e?.affectedSymbols?.length ? e.affectedSymbols : extractSymbols(a.title),
        summaryEn: e?.summaryEn || a.body.slice(0, 200),
        summaryBn: e?.summaryBn || `${a.source} প্রকাশিত খবর: ${a.title}`,
        riskFlags: e?.riskFlags ?? [],
        isVerified: true,
      };
    });

    return { items, sourceStatus: 'live' };
  } catch (err) {
    console.error('Gemini news enrichment failed:', err);
    return {
      sourceStatus: 'live',
      items: rawArticles.map((a) => ({
        id: String(a.id),
        title: a.title,
        source: a.source,
        url: a.url,
        publishedAt: new Date(a.published_on * 1000).toISOString(),
        relevanceScore: 70,
        sentiment: 'neutral' as const,
        affectedSymbols: extractSymbols(a.title),
        summaryEn: a.body.slice(0, 220),
        summaryBn: `${a.source} থেকে প্রকাশিত সংবাদ: ${a.title}`,
        riskFlags: [],
        isVerified: true,
      })),
    };
  }
}

function extractSymbols(text: string): string[] {
  const candidates = ['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'REZ', 'DOGE', 'ADA', 'AVAX', 'LINK'];
  const upper = text.toUpperCase();
  const found = candidates.filter((c) => upper.includes(c)).map((c) => `${c}USDT`);
  return found.length > 0 ? found : ['BTCUSDT'];
}
