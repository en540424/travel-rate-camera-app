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
 * テキスト翻訳の再試行の方針。再試行するのは通信の揺れ（offline・provider_error）だけで、回数は最大2回。
 * 送り直すキーは `keepIdempotencyKey` で決める（offline は同じキー＝サーバーで二重に消費されない、provider_error は新しいキー）。
 */
export function shouldRetryText(code: AiErrorCode, attempt: number): boolean {
  return attempt < 2 && (code === 'offline' || code === 'provider_error');
}

/**
 * 次の送信で同じ `Idempotency-Key` を使い続けるか。**届いたか分からない時（offline）と、中継で処理中の時（busy）だけ**同じキーを使う（§7）。
 * 中継から答えが返った後（成功・失敗のどれでも）は新しいキーにする：中継は同じキーの再送を事業者へ送らず 409 を返すので、
 * 失敗の後や同じ文の2回目を同じキーで送ると二度と通らない（2026-11-25 独立検収 B2）。失敗は回数に数えない（中継の台帳）。
 */
export function keepIdempotencyKey(outcome: AiErrorCode | 'success'): boolean {
  // busy：同じキーの要求がまだ中継で処理中（端末の時間切れの後など）。新しいキーにすると同じ文で2回目を予約してしまう（再検収 N5）
  return outcome === 'offline' || outcome === 'busy';
}

// ── 音声セッション（端末⇔中継の状態。§6-11のメッセージ） ──

export type VoiceServerMessage =
  | { type: 'session'; session_id: string; resume_token: string; provisional?: boolean }
  | { type: 'quota'; remaining_user_ms: number; session_remaining_ms: number; period_end?: string; trial?: boolean }
  | { type: 'warn'; remaining_user_ms: number }
  | { type: 'draining' }
  | { type: 'closed'; reason?: string }
  | { type: 'error'; code: string };

export type VoicePhase = 'idle' | 'connecting' | 'active' | 'draining' | 'reconnecting' | 'closed' | 'error';

/**
 * 端末側で起きた問題（中継の語彙ではない。中継の KNOWN_CODES と突き合わせる一覧には入れない）。
 * mic_denied：マイクの許可が無い／audio_unavailable：取り込み・再生の部品が無い・開けない／proof_unavailable：本人の証拠を取れない
 */
export type VoiceLocalIssue = 'mic_denied' | 'audio_unavailable' | 'proof_unavailable';

export function describeVoiceIssue(issue: VoiceLocalIssue): AiErrorInfo {
  switch (issue) {
    case 'mic_denied': return { message: 'マイクの使用が許可されていません。設定アプリで旅レートカメラのマイクを許可してから、もう一度お試しください。', recovery: 'none', resumable: false };
    case 'audio_unavailable': return { message: 'この端末では音声の通訳を始められませんでした。通常の翻訳（翻訳タブの音声入力）をお使いください。', recovery: 'use_device_translation', resumable: false };
    default: return { message: 'Pro+ の契約を確認できませんでした。契約中の場合は購入の復元をお試しください。', recovery: 'restore_purchase', resumable: false };
  }
}

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
  /** 契約の紐付けが未確定で、暫定の小さな枠で動いている（中継の session.provisional） */
  provisional: boolean;
  /** 訳の音声を再生中か（端末の再生の時計。半二重の入力の止めに使う） */
  playing: boolean;
  localIssue: VoiceLocalIssue | null;
};

export const VOICE_IDLE: VoiceState = {
  phase: 'idle', sessionId: null, resumeToken: null, resumeCount: 0, remainingUserMs: null, sessionRemainingMs: null,
  warning: null, error: null, closedReason: null, provisional: false, playing: false, localIssue: null,
};

/** 再開（同じセッションのつなぎ直し）の上限の初期値（候補値・H-P3。サーバーの `max_resumes` と同じ6） */
export const MAX_RESUMES = 6;

export type VoiceEvent =
  | { type: 'start' }
  | { type: 'server'; msg: VoiceServerMessage }
  | { type: 'socket_lost' }
  | { type: 'stop' }
  | { type: 'reset' }
  /** アプリがバックグラウンドへ移った：入力を止めて終える（バックグラウンドで録音しない） */
  | { type: 'background' }
  | { type: 'playback'; playing: boolean }
  | { type: 'local_issue'; issue: VoiceLocalIssue }
  /** 接続中・再接続中・終了中に応答が無いまま端末の期限が過ぎた（画面が詰まらないように） */
  | { type: 'timeout' };

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
    case 'background':
      if (s.phase === 'reconnecting') return { ...s, phase: 'closed', closedReason: 'background', resumeToken: null, playing: false };
      return s.phase === 'active' || s.phase === 'connecting' ? { ...s, phase: 'draining', closedReason: 'background' } : s;
    case 'playback':
      return s.playing === e.playing ? s : { ...s, playing: e.playing };
    case 'timeout':
      if (s.phase === 'connecting') return { ...s, phase: 'error', error: 'offline', resumeToken: null, playing: false };
      if (s.phase === 'reconnecting') return voiceReducer(s, { type: 'socket_lost' });
      if (s.phase === 'draining') return { ...s, phase: 'closed', closedReason: s.closedReason === 'background' ? 'background' : 'timeout', resumeToken: null, playing: false };
      return s;
    case 'local_issue':
      return { ...s, phase: 'error', localIssue: e.issue, resumeToken: null, playing: false };
    case 'stop':
      // 再接続中はつながっていないので、排出を待たずに終える
      if (s.phase === 'reconnecting') return { ...s, phase: 'closed', closedReason: 'stopped', resumeToken: null };
      return s.phase === 'active' || s.phase === 'connecting' ? { ...s, phase: 'draining' } : s;
    case 'socket_lost': {
      if (s.phase === 'draining') return { ...s, phase: 'closed', closedReason: s.closedReason ?? 'stopped' };
      if (s.phase !== 'active' && s.phase !== 'reconnecting' && s.phase !== 'connecting') return s;
      if (s.resumeToken && s.resumeCount < MAX_RESUMES) return { ...s, phase: 'reconnecting', resumeCount: s.resumeCount + 1 };
      return { ...s, phase: 'error', error: 'offline' };
    }
    case 'server': {
      const m = e.msg;
      // 終わった後（closed・error・idle）に遅れて届いた事象で状態を戻さない（閉じる途中の接続の session・draining 等。2026-11-26 検収）
      if (s.phase === 'closed' || s.phase === 'error' || s.phase === 'idle') return s;
      switch (m.type) {
        case 'session':
          return { ...s, phase: s.phase === 'draining' ? 'draining' : 'active', sessionId: m.session_id, resumeToken: m.resume_token, error: null, provisional: m.provisional === true };
        case 'quota':
          return { ...s, remainingUserMs: m.remaining_user_ms, sessionRemainingMs: m.session_remaining_ms };
        case 'warn':
          return { ...s, remainingUserMs: m.remaining_user_ms, warning: `今月の音声の残りが${formatDurationMs(m.remaining_user_ms)}です` };
        case 'draining':
          return { ...s, phase: 'draining' };
        case 'closed':
          // 中継が端末の切断として閉じた（受信の絞り＝溜まった音声のまとめ送り など）：台帳は再開を待つ（suspended）ので、切断と同じに扱う
          if (m.reason === 'client_disconnected' && s.phase !== 'draining') return voiceReducer(s, { type: 'socket_lost' });
          return { ...s, phase: 'closed', closedReason: s.closedReason === 'background' ? 'background' : (m.reason ?? null), resumeToken: null, playing: false };
        case 'error': {
          const code = normalizeErrorCode(m.code);
          return { ...s, phase: 'error', error: code, resumeToken: describeAiError(code).resumable ? s.resumeToken : null };
        }
      }
    }
  }
  return s;
}

/**
 * 音声の回が終わった理由の表示。中継の closed.reason（stop_reason・final）と端末の理由（stopped・background）。
 * 上限・停止で終わった時は理由が分かるように書く（設計書 §6-4「残量0」「停止スイッチ・全体予算」）。知らない値は汎用の文
 */
export function describeClosedReason(reason: string | null): string {
  switch (reason) {
    case 'stopped': case 'normal': case 'drained': return '通訳を終了しました。';
    case 'limit': return '利用の上限に達したため終了しました（今月の残り・1回の長さの上限、または契約の確認）。通常の翻訳（端末内・無料）は引き続き使えます。';
    case 'provider_error': return '翻訳サービスで問題が起きたため終了しました。もう一度お試しください。';
    case 'client_disconnected': return '通信が途切れたため終了しました。もう一度始めてください。';
    case 'timeout': return '応答が無かったため終了しました。通信の状態を確かめて、もう一度お試しください。';
    case 'idle': return 'しばらく音声が届かなかったため終了しました。';
    case 'kill_switch': case 'budget': return 'AI翻訳を一時停止しているため終了しました。通常の翻訳（端末内）をお使いください。';
    case 'superseded': return '別の端末・別の接続で通訳が始まったため、この接続を終了しました。';
    case 'background': return 'アプリが閉じられたため通訳を終了しました。もう一度始めてください。';
    // 開発用の模擬の中継だけが送る理由
    case 'quota_exceeded': return '今月のAI音声の利用枠を使い切りました。通常の翻訳（端末内・無料）は引き続き使えます。';
    case 'session_limit': return '1回の通訳の長さの上限に達したため終了しました。続ける場合はもう一度始めてください。';
    default: return '通訳が終了しました。';
  }
}

/** 音声を送ってよい状態か（入力を止める判定。サーバーの `draining` の後は送らない）。 */
export function canSendAudio(s: VoiceState): boolean {
  return s.phase === 'active';
}
