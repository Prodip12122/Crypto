import crypto from 'crypto';
import type { SignalEvaluation, SignalStatus } from '../types/trading.ts';

function getEncryptionKey(): Buffer {
  const secret =
    process.env.SETTINGS_ENCRYPTION_KEY ||
    process.env.GEMINI_API_KEY ||
    'fallback-local-dev-key-change-in-prod';
  return crypto.createHash('sha256').update(secret).digest();
}

export function encryptSecret(plainText: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

export function decryptSecret(cipherText: string): string | null {
  try {
    const [ivHex, tagHex, encHex] = cipherText.split(':');
    if (!ivHex || !tagHex || !encHex) return null;
    const key = getEncryptionKey();
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(encHex, 'hex')),
      decipher.final(),
    ]);
    return decrypted.toString('utf8');
  } catch {
    return null;
  }
}

export function formatTelegramSignalMessage(
  signal: SignalEvaluation,
  status: SignalStatus,
  explanationEn: string,
  format: string = 'standard'
): string {
  const pairLabel = signal.symbol.replace('USDT', '/USDT');
  const statusLabel = status.replace(/_/g, ' ');
  const expiryTime = new Date(Date.now() + signal.signalExpiryMinutes * 60_000)
    .toISOString()
    .slice(11, 16) + ' UTC';

  if (format === 'compact') {
    return [
      `🚀 ${pairLabel} — ${signal.direction} (${signal.entryType})`,
      `Score: ${signal.totalScore}/100 (${signal.classification}) | R:R ${signal.riskRewardRatio}:1`,
      `Entry: ${signal.entryZoneLow} - ${signal.entryZoneHigh} | SL: ${signal.stopLoss}`,
      `TP1: ${signal.tp1} | TP2: ${signal.tp2} | TP3: ${signal.tp3}`,
      `Status: ${statusLabel}`,
    ].join('\n');
  }

  return [
    `🚀 ${pairLabel} — ${signal.direction}`,
    `Exchange: Binance Futures`,
    `Strategy: Scalping (${signal.entryType})`,
    `Signal Score: ${signal.totalScore}/100 (${signal.classification})`,
    `Entry Zone: ${signal.entryZoneLow} – ${signal.entryZoneHigh} (Target: ${signal.entryLimitPrice})`,
    `Stop Loss: ${signal.stopLoss}`,
    `Take Profit 1: ${signal.tp1}`,
    `Take Profit 2: ${signal.tp2}`,
    `Take Profit 3: ${signal.tp3}`,
    `Risk/Reward: ${signal.riskRewardRatio}:1`,
    `Estimated Holding Time: ~${signal.estimatedHoldingMinutes} min`,
    `Timeframe: 5M / 15M / 1H / 4H`,
    `Signal Expiry: ${expiryTime}`,
    `Market Analysis: ${explanationEn}`,
    `Technical Confirmation: 4H ${signal.technicalSummary.trend4h}, 1H ${signal.technicalSummary.trend1h}, RSI(5m) ${signal.technicalSummary.rsi5m}, Vol ${signal.technicalSummary.volumeRatio5m}x`,
    `Fundamental Context: BTC 4H ${signal.fundamentalContext.btcTrend4h}, Funding ${(signal.fundamentalContext.fundingRatePct).toFixed(4)}%, News Risk ${signal.fundamentalContext.newsRiskLevel}`,
    `Status: ${statusLabel}`,
  ].join('\n');
}

export function formatTelegramLifecycleUpdate(params: {
  symbol: string;
  direction: string;
  eventType: string;
  triggerPrice: number;
  note: string;
}): string {
  const pairLabel = params.symbol.replace('USDT', '/USDT');
  const eventLabel = params.eventType.replace(/_/g, ' ');
  return [
    `📡 ${pairLabel} (${params.direction}) — ${eventLabel}`,
    `Trigger Price: ${params.triggerPrice}`,
    `Update: ${params.note}`,
    `Timestamp: ${new Date().toISOString()}`,
  ].join('\n');
}

export async function sendTelegramMessage(params: {
  botToken: string;
  chatId: string;
  text: string;
  retries?: number;
}): Promise<{ ok: boolean; messageId?: string; error?: string }> {
  const { botToken, chatId, text, retries = 2 } = params;
  if (!botToken || !chatId) {
    return { ok: false, error: 'Missing Telegram bot token or channel chat ID.' };
  }

  let lastError = 'Unknown Telegram API error';
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          chat_id: chatId,
          text,
          disable_web_page_preview: true,
        }),
      });
      clearTimeout(timer);

      const data = (await res.json()) as {
        ok: boolean;
        result?: { message_id: number };
        description?: string;
      };
      if (res.ok && data.ok && data.result) {
        return { ok: true, messageId: String(data.result.message_id) };
      }
      lastError = data.description || `Telegram HTTP ${res.status}`;
      if (res.status === 400 || res.status === 401 || res.status === 403) {
        break; // Non-retryable config error
      }
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
    if (attempt < retries) {
      await new Promise((r) => setTimeout(r, 700 * (attempt + 1)));
    }
  }

  return { ok: false, error: lastError };
}

export async function verifyTelegramBot(botToken: string): Promise<{
  ok: boolean;
  username?: string;
  error?: string;
}> {
  if (!botToken) return { ok: false, error: 'Bot token is required.' };
  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/getMe`);
    const data = (await res.json()) as {
      ok: boolean;
      result?: { username: string };
      description?: string;
    };
    if (data.ok && data.result) {
      return { ok: true, username: data.result.username };
    }
    return { ok: false, error: data.description || 'Failed to verify bot token.' };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
