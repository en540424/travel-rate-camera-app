/**
 * Pro+ リアルタイム音声：端末⇔中継の WebSocket の手順（純粋ロジック・`node --test` で検証）。
 * 中継の実装は tabirate-ai-gateway `src/api/voice.mjs`（2026-11-25 時点の手順。変える時は両方を直す）。
 *
 *   接続：GET {base}/v1/voice?direction=from_ja|to_ja&lang=<相手の言語>（WebSocket）。ヘッダに
 *         `Authorization: Bearer <中継のトークン>` と `x-app-user-id`。**トークン・再開トークンを URL に載せない**（ログに残る）
 *   1. 接続の直後に制御メッセージを1つ：{ type: 'start' } か { type: 'resume', session_id, resume_token }（10秒以内）
 *   2. 中継 → { type: 'session', session_id, resume_token, provisional } と { type: 'quota', remaining_user_ms, session_remaining_ms }
 *   3. 上り：バイナリの PCM（16kHz・16bit・モノラル。32 バイトの倍数。voice-pcm-core.ts）
 *   4. 下り：バイナリの訳の音声（24kHz・16bit・モノラル）と制御の JSON（quota・warn・draining・closed・error）
 *   5. 端末の { type: 'stop' } → 中継は入力を止め、排出して { type: 'closed', reason } を送って閉じる（1000）
 *   6. 切断：中継は台帳を suspended にして再開を待つ（再開は新しい接続の resume。回数に上限）
 */
import type { AiDirection, VoiceServerMessage } from './ai-translation-core';

const LANG = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;

/** 中継の基底URL（https）から音声の WebSocket のURL。基底が https 以外なら null（本番で平文の接続をしない） */
export function voiceSocketUrl(base: string, direction: AiDirection, partnerLang: string, { allowInsecure = false } = {}): string | null {
  if (!LANG.test(partnerLang) || partnerLang === 'ja') return null;
  let u: URL;
  try {
    u = new URL(base);
  } catch {
    return null;
  }
  if (u.protocol === 'https:') u.protocol = 'wss:';
  else if (u.protocol === 'http:' && allowInsecure) u.protocol = 'ws:';
  else return null;
  u.pathname = `${u.pathname.replace(/\/$/, '')}/v1/voice`;
  u.search = '';
  u.searchParams.set('direction', direction);
  u.searchParams.set('lang', partnerLang);
  return u.toString();
}

/** 最初の制御メッセージ。再開には session_id と resume_token の両方が要る（片方だけなら新しく始める） */
export function helloMessage(resume: { sessionId: string | null; resumeToken: string | null } | null): string {
  if (resume?.sessionId && resume.resumeToken) return JSON.stringify({ type: 'resume', session_id: resume.sessionId, resume_token: resume.resumeToken });
  return JSON.stringify({ type: 'start' });
}

export const STOP_MESSAGE = JSON.stringify({ type: 'stop' });

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;
const isStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 256;

/** 中継の制御メッセージを読む。形が違えば null（知らない型・壊れた値で状態を進めない） */
export function parseServerMessage(text: string): VoiceServerMessage | null {
  if (typeof text !== 'string' || text.length > 4_096) return null;
  let m: Record<string, unknown>;
  try {
    const v = JSON.parse(text);
    if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
    m = v as Record<string, unknown>;
  } catch {
    return null;
  }
  switch (m.type) {
    case 'session':
      return isStr(m.session_id) && isStr(m.resume_token) ? { type: 'session', session_id: m.session_id, resume_token: m.resume_token, provisional: m.provisional === true } : null;
    case 'quota':
      return isNum(m.remaining_user_ms) && isNum(m.session_remaining_ms)
        ? { type: 'quota', remaining_user_ms: m.remaining_user_ms, session_remaining_ms: m.session_remaining_ms, ...(typeof m.period_end === 'string' ? { period_end: m.period_end } : {}) }
        : null;
    case 'warn':
      return isNum(m.remaining_user_ms) ? { type: 'warn', remaining_user_ms: m.remaining_user_ms } : null;
    case 'draining':
      return { type: 'draining' };
    case 'closed':
      return { type: 'closed', ...(typeof m.reason === 'string' ? { reason: m.reason } : {}) };
    case 'error':
      return { type: 'error', code: typeof m.code === 'string' ? m.code : 'unknown' };
    default:
      return null;
  }
}

/**
 * 接続が閉じた時に状態へ渡す事象。中継は終わる時に必ず制御メッセージ（closed・error）を先に送るので、それを受けていれば
 * 何もしない。受けずに閉じた（通信の断・アプリの外の要因）なら切断（再開を試す）。
 */
export function closeEvent(sawFinalMessage: boolean): 'none' | 'socket_lost' {
  return sawFinalMessage ? 'none' : 'socket_lost';
}

/**
 * 再開の待ち（n 回目の再開の前）：0.5→1→2→4→4→4 秒。中継の台帳は切断の後30秒だけ再開を待つ（suspended）ので、6回で約16秒。
 * 待たずに繰り返すと、通信の断の間に数百ms で再開を使い切る（2026-11-26 検収）
 */
export function resumeDelayMs(resumeCount: number): number {
  return Math.min(4_000, 500 * 2 ** Math.max(0, resumeCount - 1));
}
