/**
 * AI翻訳の中継への接続。どの実装を使うかを決める唯一の入口（`getAiGateway`）。
 *
 * - `AI_GATEWAY_URL` が未設定（本番の現状）→ 'unconfigured'：すべての要求が `unconfigured` を返し、画面は通常翻訳へ案内する
 * - development build（__DEV__）で未設定 → 模擬（通信しない・有料APIを呼ばない）
 * - 設定済み → HTTP／WebSocketで中継へ。鍵はアプリに入れない（中継がRevenueCatで権利を確認する）
 *
 * 音声の取り込み（マイクのPCMを連続で取り出す部品）はまだ入っていない（設計書§10工程10）。
 * そのため実の中継に対しては、音声は `audio_unavailable` 相当として開始しない（`unconfigured` を返す）。
 */
import { AI_GATEWAY_URL } from '@/config/ai-gateway';
import { DEV_PRO_PLUS_PREVIEW } from '@/config/feature-flags';
import { normalizeErrorCode, type AiQuota } from '@/lib/ai/ai-translation-core';
import { usePurchasesStore } from '@/stores/purchases-store';

import type { AiGateway, TextTranslateResult } from './ai-gateway-types';
import { createMockGateway } from './ai-gateway-mock';

const TIMEOUT_MS = 20_000;

function appUserId(): string | null {
  return usePurchasesStore.getState().customerInfo?.originalAppUserId ?? null;
}

function quotaFromJson(q: Record<string, unknown> | undefined): Partial<AiQuota> {
  if (!q) return {};
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
  return {
    textRemaining: num(q.text_remaining), textLimit: num(q.text_limit),
    voiceRemainingMs: num(q.voice_remaining_ms), voiceLimitMs: num(q.voice_limit_ms),
    periodEnd: typeof q.period_end === 'string' ? q.period_end : undefined,
    trial: typeof q.trial === 'boolean' ? q.trial : undefined,
  };
}

async function fetchJson(url: string, init: RequestInit): Promise<{ status: number; body: Record<string, unknown> } | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { status: res.status, body };
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

function createHttpGateway(base: string): AiGateway {
  const headers = () => ({ 'content-type': 'application/json', 'x-app-user-id': appUserId() ?? '' });
  return {
    kind: 'http',
    async translateText(req, key): Promise<TextTranslateResult> {
      const { source, target } = req.direction === 'from_ja' ? { source: 'ja', target: req.partnerLang } : { source: req.partnerLang, target: 'ja' };
      const r = await fetchJson(`${base}/v1/text/translate`, {
        method: 'POST',
        headers: { ...headers(), 'idempotency-key': key },
        body: JSON.stringify({ text: req.text, source, target }),
      });
      if (!r) return { ok: false, code: 'offline' };
      if (r.status === 200 && typeof r.body.translation === 'string') {
        return { ok: true, translation: r.body.translation, quota: quotaFromJson(r.body.quota as Record<string, unknown>) };
      }
      return { ok: false, code: normalizeErrorCode(r.body.error), quota: quotaFromJson(r.body.quota as Record<string, unknown>) };
    },
    async getQuota() {
      const r = await fetchJson(`${base}/v1/quota`, { method: 'GET', headers: headers() });
      if (!r) return { ok: false, code: 'offline' };
      if (r.status !== 200) return { ok: false, code: normalizeErrorCode(r.body.error) };
      return { ok: true, quota: quotaFromJson(r.body.quota as Record<string, unknown>) };
    },
    openVoice() {
      return { error: 'unconfigured' };
    },
  };
}

const unconfigured: AiGateway = {
  kind: 'unconfigured',
  async translateText() { return { ok: false, code: 'unconfigured' }; },
  async getQuota() { return { ok: false, code: 'unconfigured' }; },
  openVoice() { return { error: 'unconfigured' }; },
};

let cached: AiGateway | null = null;

export function getAiGateway(): AiGateway {
  if (cached) return cached;
  if (AI_GATEWAY_URL) cached = createHttpGateway(AI_GATEWAY_URL.replace(/\/$/, ''));
  else if (DEV_PRO_PLUS_PREVIEW) cached = createMockGateway();
  else cached = unconfigured;
  return cached;
}
