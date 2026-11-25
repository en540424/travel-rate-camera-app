/**
 * 開発用の模擬の中継（通信しない・有料APIを呼ばない）。development buildの画面確認とテストのためだけに使う。
 * 本番では使わない（`ai-gateway-client.ts` の `getAiGateway` が __DEV__ のときだけ選ぶ）。
 *
 * 中継の規則のうち、アプリの表示に関わるものだけを真似る：
 * - 残量はサーバー側（ここ）で数える。同じ Idempotency-Key の再送は二重に数えない。別の本文に同じキーは拒否
 * - 枠を使い切ったら quota_exceeded
 * 訳文は「［模擬］」を付けた入力の写しで、翻訳ではない（実翻訳と誤認させない）。
 */
import { countChars, languagePair, validateTextRequest, type AiQuota } from './ai-translation-core';
import type { AiGateway, TextTranslateResult, VoiceConnection, VoiceHandlers, VoiceOpenOptions } from './ai-gateway-types';

export type MockOptions = {
  textLimit?: number;
  voiceLimitMs?: number;
  periodEnd?: string;
  /** 次の要求で返すエラー（テスト用） */
  failNext?: () => string | null;
  /** 音声の模擬の時計（テストで差し替える） */
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (h: unknown) => void;
};

export function createMockGateway(opts: MockOptions = {}): AiGateway & { state: { textUsed: number; voiceUsedMs: number } } {
  const textLimit = opts.textLimit ?? 200;
  const voiceLimitMs = opts.voiceLimitMs ?? 15 * 60_000;
  const periodEnd = opts.periodEnd ?? '2026-12-01T00:00:00.000Z';
  const state = { textUsed: 0, voiceUsedMs: 0 };
  const done = new Map<string, { bodyKey: string; result: TextTranslateResult }>();
  const setTimer = opts.setTimer ?? ((fn: () => void, ms: number) => setInterval(fn, ms));
  const clearTimer = opts.clearTimer ?? ((h: unknown) => clearInterval(h as ReturnType<typeof setInterval>));

  const quota = (): Partial<AiQuota> => ({
    textRemaining: Math.max(0, textLimit - state.textUsed), textLimit,
    voiceRemainingMs: Math.max(0, voiceLimitMs - state.voiceUsedMs), voiceLimitMs, periodEnd, trial: false,
  });

  return {
    kind: 'mock',
    state,
    async translateText(req, key) {
      const bodyKey = `${req.direction}|${req.partnerLang}|${req.text}`;
      const prev = done.get(key);
      if (prev) return prev.bodyKey === bodyKey ? prev.result : { ok: false, code: 'unknown', quota: quota() };
      const injected = opts.failNext?.();
      if (injected) return { ok: false, code: injected as never, quota: quota() };
      if (validateTextRequest(req).length) return { ok: false, code: 'input_too_long', quota: quota() };
      if (state.textUsed >= textLimit) return { ok: false, code: 'quota_exceeded', quota: quota() };
      state.textUsed += 1;
      const { target } = languagePair(req);
      const result: TextTranslateResult = {
        ok: true, translation: `［模擬・${target}］${req.text.trim()}（${countChars(req.text.trim())}文字）`, quota: quota(),
      };
      done.set(key, { bodyKey, result });
      return result;
    },
    async getQuota() {
      return { ok: true, quota: quota() };
    },
    async openVoice(_o: VoiceOpenOptions, h: VoiceHandlers): Promise<VoiceConnection | { error: 'quota_exceeded' }> {
      if (state.voiceUsedMs >= voiceLimitMs) return { error: 'quota_exceeded' };
      const TICK = 1000;
      let sessionRemaining = 5 * 60_000;
      let open = true;
      h.onMessage({ type: 'session', session_id: `mock-${Date.now()}`, resume_token: 'mock-resume' });
      const timer = setTimer(() => {
        if (!open) return;
        state.voiceUsedMs += TICK;
        sessionRemaining -= TICK;
        const remaining = Math.max(0, voiceLimitMs - state.voiceUsedMs);
        h.onMessage({ type: 'quota', remaining_user_ms: remaining, session_remaining_ms: sessionRemaining, period_end: periodEnd });
        if (remaining === 60_000) h.onMessage({ type: 'warn', remaining_user_ms: remaining });
        if (remaining <= 0 || sessionRemaining <= 0) finish(remaining <= 0 ? 'quota_exceeded' : 'session_limit');
      }, TICK);
      const finish = (reason: string) => {
        if (!open) return;
        open = false;
        clearTimer(timer);
        h.onMessage({ type: 'draining' });
        h.onMessage({ type: 'closed', reason });
      };
      // 模擬：上りの音声は数えず捨てる（訳の音声は返さない。再生の経路の確認は実機の中継で行う）
      return { sendAudio: () => {}, isOpen: () => open, stop: () => finish('stopped'), close: () => { open = false; clearTimer(timer); } };
    },
  };
}
