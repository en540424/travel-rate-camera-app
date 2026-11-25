/**
 * AI翻訳の中継への接続。どの実装を使うかを決める唯一の入口（`getAiGateway`）。
 *
 * - `AI_GATEWAY_URL` が未設定（本番の現状）→ 'unconfigured'：すべての要求が `unconfigured` を返し、画面は通常翻訳へ案内する
 * - development build（__DEV__）で未設定 → 模擬（通信しない・有料APIを呼ばない）
 * - 設定済み → HTTP／WebSocketで中継へ。鍵はアプリに入れない（中継がRevenueCatで権利を確認する）
 *
 * 本人認証（2026-11-25）：要求には中継のトークン（ai-auth-client.ts）を `Authorization: Bearer` で付け、`x-app-user-id` と
 * 合わせて送る。中継が 401 を返したらトークンを取り直して1回だけ送り直す。音声の WebSocket もヘッダで同じものを送る
 * （トークン・再開トークンを URL に載せない）。音声の手順は voice-protocol-core.ts。
 */
import { AI_GATEWAY_URL } from '@/config/ai-gateway';
import { DEV_PRO_PLUS_PREVIEW } from '@/config/feature-flags';
import { normalizeErrorCode, type AiErrorCode, type AiQuota } from '@/lib/ai/ai-translation-core';
import { usePurchasesStore } from '@/stores/purchases-store';

import { shouldRefreshAfter } from './ai-auth-core';
import { forgetGatewayToken, getGatewayToken } from './ai-auth-client';
import type { AiGateway, TextTranslateResult, VoiceConnection } from './ai-gateway-types';
import { createMockGateway } from './ai-gateway-mock';
import { closeEvent, helloMessage, parseServerMessage, STOP_MESSAGE, voiceSocketUrl } from './voice-protocol-core';

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
  /**
   * トークン付きで送る。401 ならトークンを取り直して1回だけ送り直す。
   * @returns 応答、または送る前の失敗（利用者のIDが無い・証拠が取れない）の語彙
   */
  type Authed = { early: AiErrorCode } | { response: { status: number; body: Record<string, unknown> } | null };
  async function authed(path: string, init: RequestInit & { headers?: Record<string, string> }): Promise<Authed> {
    const id = appUserId();
    if (!id) return { early: 'not_entitled' };
    for (let attempt = 0; ; attempt += 1) {
      const tok = await getGatewayToken(base, id, { force: attempt > 0 });
      if (!tok.ok) return { early: tok.code };
      const r = await fetchJson(`${base}${path}`, {
        ...init,
        headers: { 'content-type': 'application/json', ...(init.headers ?? {}), 'x-app-user-id': id, authorization: `Bearer ${tok.token}` },
      });
      if (r && shouldRefreshAfter(r.status, attempt)) {
        forgetGatewayToken();
        continue;
      }
      return { response: r };
    }
  }

  return {
    kind: 'http',
    async translateText(req, key): Promise<TextTranslateResult> {
      const { source, target } = req.direction === 'from_ja' ? { source: 'ja', target: req.partnerLang } : { source: req.partnerLang, target: 'ja' };
      const a = await authed('/v1/text/translate', {
        method: 'POST',
        headers: { 'idempotency-key': key },
        body: JSON.stringify({ text: req.text, source, target }),
      });
      if ('early' in a) return { ok: false, code: a.early };
      const r = a.response;
      if (!r) return { ok: false, code: 'offline' };
      if (r.status === 200 && typeof r.body.translation === 'string') {
        return { ok: true, translation: r.body.translation, quota: quotaFromJson(r.body.quota as Record<string, unknown>) };
      }
      return { ok: false, code: normalizeErrorCode(r.body.error), quota: quotaFromJson(r.body.quota as Record<string, unknown>) };
    },
    async getQuota() {
      const a = await authed('/v1/quota', { method: 'GET' });
      if ('early' in a) return { ok: false, code: a.early };
      const r = a.response;
      if (!r) return { ok: false, code: 'offline' };
      if (r.status !== 200) return { ok: false, code: normalizeErrorCode(r.body.error) };
      return { ok: true, quota: quotaFromJson(r.body.quota as Record<string, unknown>) };
    },
    async openVoice(opts, h) {
      const id = appUserId();
      if (!id) return { error: 'not_entitled' };
      const url = voiceSocketUrl(base, opts.direction, opts.partnerLang, { allowInsecure: __DEV__ });
      if (!url) return { error: 'unknown' };
      const tok = await getGatewayToken(base, id);
      if (!tok.ok) return { error: tok.code };
      // RN の WebSocket は第3引数の headers を upgrade の要求に付ける（中継は upgrade の前にトークンを確かめる）
      const ws = new (WebSocket as unknown as new (u: string, p: string[] | undefined, o: { headers: Record<string, string> }) => WebSocket)(
        url, undefined, { headers: { authorization: `Bearer ${tok.token}`, 'x-app-user-id': id } },
      );
      ws.binaryType = 'arraybuffer';
      let open = false;
      let sawSession = false;
      let sawFinal = false;
      let closedByUs = false;
      ws.onopen = () => {
        open = true;
        ws.send(helloMessage(opts.resume ?? null));
      };
      ws.onmessage = (ev: MessageEvent) => {
        if (typeof ev.data === 'string') {
          const m = parseServerMessage(ev.data);
          if (!m) return;
          if (m.type === 'session') sawSession = true;
          if (m.type === 'closed' || m.type === 'error') sawFinal = true;
          h.onMessage(m);
        } else if (ev.data instanceof ArrayBuffer) {
          h.onAudio?.(ev.data);
        }
      };
      ws.onerror = () => {
        // onclose が続く。ここでは何もしない
      };
      ws.onclose = () => {
        open = false;
        // session を受ける前に閉じた：upgrade で断られた（トークンの期限・失効）かもしれない。次はトークンを取り直す
        if (!sawSession) forgetGatewayToken();
        if (closedByUs) return;
        if (closeEvent(sawFinal) === 'socket_lost') h.onSocketLost();
      };
      const conn: VoiceConnection = {
        sendAudio: (pcm) => {
          if (open && ws.readyState === WebSocket.OPEN) ws.send(pcm instanceof Uint8Array ? pcm.slice().buffer : pcm);
        },
        isOpen: () => open && ws.readyState === WebSocket.OPEN,
        stop: () => {
          if (ws.readyState === WebSocket.OPEN) ws.send(STOP_MESSAGE);
          else {
            closedByUs = true;
            ws.close();
          }
        },
        close: () => {
          closedByUs = true;
          try {
            ws.close(1000);
          } catch {
            // 既に閉じている
          }
        },
      };
      return conn;
    },
  };
}

const unconfigured: AiGateway = {
  kind: 'unconfigured',
  async translateText() { return { ok: false, code: 'unconfigured' }; },
  async getQuota() { return { ok: false, code: 'unconfigured' }; },
  async openVoice() { return { error: 'unconfigured' }; },
};

let cached: AiGateway | null = null;

export function getAiGateway(): AiGateway {
  if (cached) return cached;
  if (AI_GATEWAY_URL) cached = createHttpGateway(AI_GATEWAY_URL.replace(/\/$/, ''));
  else if (DEV_PRO_PLUS_PREVIEW) cached = createMockGateway();
  else cached = unconfigured;
  return cached;
}
