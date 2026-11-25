/**
 * AI翻訳の中継（tabirate-ai-gateway）とアプリの間の口（型だけ）。
 *
 * 中継の外部入口は tabirate-ai-gateway `src/api/gateway.mjs`（2026-11-25 に突き合わせ済み。変える時は両方を直す）。
 *
 * - テキスト：POST {base}/v1/text/translate  ヘッダ `Idempotency-Key`（再送は同じキー）
 *   本文 { text, source, target } → 200 { translation, quota } ／ 4xx・5xx { error: code, quota? }
 * - 残量：GET {base}/v1/quota → { quota }
 * - 音声：WebSocket {base}/v1/voice?direction=&lang=  上りはPCM（バイナリ）、下りは訳の音声（バイナリ）と制御JSON（`VoiceServerMessage`）
 * - 本人認証：`POST {base}/v1/auth/session` で証拠（StoreKit の署名付き取引）を中継のトークンに換え、各要求に
 *   `Authorization: Bearer` と `x-app-user-id` を付ける（ai-auth-client.ts）。x-app-user-id だけでは中継が通さない。鍵はアプリに入れない
 */
import type { AiErrorCode, AiQuota, TextTranslateRequest, VoiceServerMessage } from './ai-translation-core';

export type TextTranslateResult =
  | { ok: true; translation: string; quota: Partial<AiQuota> }
  | { ok: false; code: AiErrorCode; quota?: Partial<AiQuota> };

export type VoiceHandlers = {
  onMessage: (m: VoiceServerMessage) => void;
  onAudio?: (pcm: ArrayBuffer) => void;
  onSocketLost: () => void;
};

export type VoiceConnection = {
  /** 上りの PCM（32 バイトの倍数）。接続が開く前・閉じた後は捨てる */
  sendAudio: (pcm: ArrayBuffer | Uint8Array) => void;
  /** 接続が開いていて送れる状態か */
  isOpen: () => boolean;
  /** 入力を止めて排出を待つ（サーバーが closed を送る） */
  stop: () => void;
  /** 強制的に閉じる（画面を離れた時） */
  close: () => void;
};

/** 再開には session_id と resume_token の両方が要る（中継の手順。voice-protocol-core.ts） */
export type VoiceOpenOptions = { direction: 'from_ja' | 'to_ja'; partnerLang: string; resume?: { sessionId: string | null; resumeToken: string | null } | null };

export interface AiGateway {
  readonly kind: 'http' | 'mock' | 'unconfigured';
  translateText(req: TextTranslateRequest, idempotencyKey: string): Promise<TextTranslateResult>;
  getQuota(): Promise<{ ok: true; quota: Partial<AiQuota> } | { ok: false; code: AiErrorCode }>;
  openVoice(opts: VoiceOpenOptions, handlers: VoiceHandlers): Promise<VoiceConnection | { error: AiErrorCode }>;
}
