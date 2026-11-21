/**
 * Pro+ AI翻訳（テキスト・リアルタイム音声）のアプリ側の純粋ロジック（import 0件・`node --test`で検証）。
 *
 * 設計の正本：Vault `旅レートカメラ_ProPlus中核3機能_技術設計・原価制御_2026-11-04` §4・§6-11・§7。
 * - 既存の端末内翻訳（Apple Translation）とは別のサービス層。既存の翻訳には触れない
 * - **利用量の正はサーバー（tabirate-ai-gateway の台帳）**。アプリは残量を表示するだけで、上限の判定をしない
 *   （再接続・再起動・複数端末で回避されないため。アプリ側で数えた値は信用しない）
 * - 枠の数値（月200回・500文字・音声15分・1回5分 等）はHuman未承認の候補値で、サーバーから届いた値を表示する。
 *   アプリが持つのは入力の事前検査（文字数）だけで、その上限もサーバーの応答で上書きできる
 */

// ── テキスト ──

export type AiDirection = 'from_ja' | 'to_ja';

export type TextTranslateRequest = {
  text: string;
  direction: AiDirection;
  /** 相手の言語（BCP-47の言語部分。例：en, fr, ko, zh-Hans, th） */
  partnerLang: string;
};

/** 1回の入力の上限の初期値（候補値・H-P3）。サーバーが `max_chars` を返したらそちらを使う。 */
export const DEFAULT_TEXT_MAX_CHARS = 500;

export function countChars(text: string): number {
  return [...text.normalize('NFC')].length;
}

export function validateTextRequest(req: TextTranslateRequest, maxChars = DEFAULT_TEXT_MAX_CHARS): string[] {
  const errors: string[] = [];
  const n = countChars(req.text.trim());
  if (n === 0) errors.push('翻訳する文章を入力してください');
  if (n > maxChars) errors.push(`1回に翻訳できるのは${maxChars}文字までです（今は${n}文字）。分けて翻訳してください`);
  if (!/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(req.partnerLang) || req.partnerLang === 'ja') errors.push('相手の言語を選んでください');
  return errors;
}

export function languagePair(req: Pick<TextTranslateRequest, 'direction' | 'partnerLang'>): { source: string; target: string } {
  return req.direction === 'from_ja' ? { source: 'ja', target: req.partnerLang } : { source: req.partnerLang, target: 'ja' };
}

// ── 利用量（サーバーの値） ──

export type AiQuota = {
  /** 今月のAIテキストの残り回数 */
  textRemaining: number | null;
  textLimit: number | null;
  /** 今月のAI音声の残り（ミリ秒） */
  voiceRemainingMs: number | null;
  voiceLimitMs: number | null;
  /** 周期の終わり（ISO8601・サーバーが算出） */
  periodEnd: string | null;
  /** 無料体験中か */
  trial: boolean;
};

export const UNKNOWN_QUOTA: AiQuota = { textRemaining: null, textLimit: null, voiceRemainingMs: null, voiceLimitMs: null, periodEnd: null, trial: false };

export function formatDurationMs(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m > 0 ? `${m}分${String(s).padStart(2, '0')}秒` : `${s}秒`;
}

/** 残量の表示（例：「今月の残り：テキスト 180回・音声 12分30秒（12月1日に更新）」）。値が無ければ「確認中」。 */
export function formatQuota(q: AiQuota): string {
  if (q.textRemaining === null && q.voiceRemainingMs === null) return '今月の残り：確認中';
  const parts: string[] = [];
  if (q.textRemaining !== null) parts.push(`テキスト ${q.textRemaining}回`);
  if (q.voiceRemainingMs !== null) parts.push(`音声 ${formatDurationMs(q.voiceRemainingMs)}`);
  let s = `${q.trial ? '無料体験の残り' : '今月の残り'}：${parts.join('・')}`;
  if (q.periodEnd && !q.trial) {
    const d = new Date(q.periodEnd);
    if (!Number.isNaN(d.getTime())) s += `（${d.getMonth() + 1}月${d.getDate()}日に更新）`;
  }
  return s;
}

/** サーバーから届いた残量で上書きする（サーバーが正。欠けた項目だけ前の値を残す）。 */
export function mergeQuota(prev: AiQuota, next: Partial<AiQuota>): AiQuota {
  const out = { ...prev };
  for (const [k, v] of Object.entries(next) as [keyof AiQuota, unknown][]) if (v !== undefined) (out as Record<string, unknown>)[k] = v;
  return out;
}

// ── エラー（設計書§6-11の種類）と、利用者への案内 ──

export type AiErrorCode =
  | 'not_entitled' | 'quota_exceeded' | 'busy' | 'budget_stop' | 'provider_error' | 'pending_link' | 'resume_rejected'
  | 'rate_limited' | 'input_too_long' | 'offline' | 'unconfigured' | 'consent_required' | 'unknown';

export type AiRecovery = 'retry' | 'retry_later' | 'use_device_translation' | 'restore_purchase' | 'shorten' | 'reconnect' | 'consent' | 'none';

export type AiErrorInfo = { message: string; recovery: AiRecovery; resumable: boolean };

export function describeAiError(code: AiErrorCode): AiErrorInfo {
  switch (code) {
    case 'not_entitled': return { message: 'AI翻訳はPro+の機能です。契約中の場合は購入の復元をお試しください。', recovery: 'restore_purchase', resumable: false };
    case 'quota_exceeded': return { message: '今月のAI翻訳の利用枠を使い切りました。通常の翻訳（端末内・無料）は引き続き使えます。', recovery: 'use_device_translation', resumable: false };
    case 'busy': return { message: '混み合っています。少し待ってからもう一度お試しください。', recovery: 'retry_later', resumable: false };
    case 'budget_stop': return { message: 'AI翻訳を一時停止しています。通常の翻訳（端末内）をお使いください。', recovery: 'use_device_translation', resumable: false };
    case 'provider_error': return { message: '翻訳サービスで問題が起きました。もう一度お試しください。', recovery: 'retry', resumable: true };
    case 'pending_link': return { message: '契約の確認に少し時間がかかっています。しばらくしてからお試しください（体験の範囲で使えます）。', recovery: 'retry_later', resumable: false };
    case 'resume_rejected': return { message: '接続を続けられませんでした。新しく始めてください。', recovery: 'reconnect', resumable: false };
    case 'rate_limited': return { message: '短い間に続けて使われています。少し待ってからお試しください。', recovery: 'retry_later', resumable: false };
    case 'input_too_long': return { message: '文章が長すぎます。分けて翻訳してください。', recovery: 'shorten', resumable: false };
    case 'offline': return { message: 'インターネットに接続できません。AI翻訳は通信が必要です。通常の翻訳（端末内）は使えます。', recovery: 'use_device_translation', resumable: true };
    case 'unconfigured': return { message: 'AI翻訳は提供開始の準備中です。通常の翻訳（端末内・無料）をお使いください。', recovery: 'use_device_translation', resumable: false };
    case 'consent_required': return { message: 'AI翻訳を使う前に、送信する内容の確認が必要です。', recovery: 'consent', resumable: false };
    default: return { message: 'AI翻訳でエラーが起きました。もう一度お試しください。', recovery: 'retry', resumable: false };
  }
}

const KNOWN_CODES = new Set<AiErrorCode>([
  'not_entitled', 'quota_exceeded', 'busy', 'budget_stop', 'provider_error', 'pending_link', 'resume_rejected',
  'rate_limited', 'input_too_long', 'offline', 'unconfigured', 'consent_required',
]);

export function normalizeErrorCode(code: unknown): AiErrorCode {
  return typeof code === 'string' && KNOWN_CODES.has(code as AiErrorCode) ? (code as AiErrorCode) : 'unknown';
}

/**
 * テキスト翻訳の再試行の方針。同じ `Idempotency-Key` で送り直すので、サーバー側で二重に消費されない（§7）。
 * 再試行するのは通信の揺れ（offline・provider_error）だけで、回数は最大2回。
 */
export function shouldRetryText(code: AiErrorCode, attempt: number): boolean {
  return attempt < 2 && (code === 'offline' || code === 'provider_error');
}

// ── 音声セッション（端末⇔中継の状態。§6-11のメッセージ） ──

export type VoiceServerMessage =
  | { type: 'session'; session_id: string; resume_token: string }
  | { type: 'quota'; remaining_user_ms: number; session_remaining_ms: number; period_end?: string; trial?: boolean }
  | { type: 'warn'; remaining_user_ms: number }
  | { type: 'draining' }
  | { type: 'closed'; reason?: string }
  | { type: 'error'; code: string };

export type VoicePhase = 'idle' | 'connecting' | 'active' | 'draining' | 'reconnecting' | 'closed' | 'error';

export type VoiceState = {
  phase: VoicePhase;
  sessionId: string | null;
  resumeToken: string | null;
  resumeCount: number;
  remainingUserMs: number | null;
  sessionRemainingMs: number | null;
  warning: string | null;
  error: AiErrorCode | null;
  closedReason: string | null;
};

export const VOICE_IDLE: VoiceState = {
  phase: 'idle', sessionId: null, resumeToken: null, resumeCount: 0, remainingUserMs: null, sessionRemainingMs: null,
  warning: null, error: null, closedReason: null,
};

/** 再開（同じセッションのつなぎ直し）の上限の初期値（候補値・H-P3。サーバーの `max_resumes` と同じ6） */
export const MAX_RESUMES = 6;

export type VoiceEvent =
  | { type: 'start' }
  | { type: 'server'; msg: VoiceServerMessage }
  | { type: 'socket_lost' }
  | { type: 'stop' }
  | { type: 'reset' };

/**
 * 音声セッションの状態遷移。残量はサーバーの `quota` だけで更新し、端末で減算しない。
 * 切断時は、再開トークンがあり上限内なら `reconnecting`（同じトークンで再開を要求する）、無ければ `error`。
 */
export function voiceReducer(s: VoiceState, e: VoiceEvent): VoiceState {
  switch (e.type) {
    case 'start':
      return s.phase === 'idle' || s.phase === 'closed' || s.phase === 'error' ? { ...VOICE_IDLE, phase: 'connecting' } : s;
    case 'reset':
      return VOICE_IDLE;
    case 'stop':
      return s.phase === 'active' || s.phase === 'connecting' || s.phase === 'reconnecting' ? { ...s, phase: 'draining' } : s;
    case 'socket_lost': {
      if (s.phase === 'draining') return { ...s, phase: 'closed', closedReason: s.closedReason ?? 'stopped' };
      if (s.phase !== 'active' && s.phase !== 'reconnecting' && s.phase !== 'connecting') return s;
      if (s.resumeToken && s.resumeCount < MAX_RESUMES) return { ...s, phase: 'reconnecting', resumeCount: s.resumeCount + 1 };
      return { ...s, phase: 'error', error: 'offline' };
    }
    case 'server': {
      const m = e.msg;
      switch (m.type) {
        case 'session':
          return { ...s, phase: s.phase === 'draining' ? 'draining' : 'active', sessionId: m.session_id, resumeToken: m.resume_token, error: null };
        case 'quota':
          return { ...s, remainingUserMs: m.remaining_user_ms, sessionRemainingMs: m.session_remaining_ms };
        case 'warn':
          return { ...s, remainingUserMs: m.remaining_user_ms, warning: `今月の音声の残りが${formatDurationMs(m.remaining_user_ms)}です` };
        case 'draining':
          return { ...s, phase: 'draining' };
        case 'closed':
          return { ...s, phase: 'closed', closedReason: m.reason ?? null, resumeToken: null };
        case 'error': {
          const code = normalizeErrorCode(m.code);
          return { ...s, phase: 'error', error: code, resumeToken: describeAiError(code).resumable ? s.resumeToken : null };
        }
      }
    }
  }
  return s;
}

/** 音声を送ってよい状態か（入力を止める判定。サーバーの `draining` の後は送らない）。 */
export function canSendAudio(s: VoiceState): boolean {
  return s.phase === 'active';
}
