/**
 * AI翻訳の中継（tabirate-ai-gateway）とアプリの間の口（型だけ）。
 *
 * 中継の外部入口は未実装（2026-11-21時点。gatewayのworkerは全要求に404）。ここの形は設計書§6-11・§7に合わせた
 * アプリ側の想定で、中継の実装時に突き合わせる（変える時はこのファイルと `ai-gateway-client.ts` だけを直す）。
 *
 * - テキスト：POST {base}/v1/text/translate  ヘッダ `Idempotency-Key`（再送は同じキー）
 *   本文 { text, source, target } → 200 { translation, quota } ／ 4xx・5xx { error: code, quota? }
 * - 残量：GET {base}/v1/quota → { quota }
 * - 音声：WebSocket {base}/v1/voice?direction=&lang=  上りはPCM（バイナリ）、下りは訳の音声（バイナリ）と制御JSON（`VoiceServerMessage`）
 * - 利用者の識別：RevenueCatのapp user IDを送り、中継がRevenueCat v2で検証して内部IDへ束ねる（§5-1）。鍵はアプリに入れない
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
  sendAudio: (pcm: ArrayBuffer) => void;
  /** 入力を止めて排出を待つ（サーバーが closed を送る） */
  stop: () => void;
  /** 強制的に閉じる（画面を離れた時） */
  close: () => void;
};

export type VoiceOpenOptions = { direction: 'from_ja' | 'to_ja'; partnerLang: string; resumeToken?: string | null };

export interface AiGateway {
  readonly kind: 'http' | 'mock' | 'unconfigured';
  translateText(req: TextTranslateRequest, idempotencyKey: string): Promise<TextTranslateResult>;
  getQuota(): Promise<{ ok: true; quota: Partial<AiQuota> } | { ok: false; code: AiErrorCode }>;
  openVoice(opts: VoiceOpenOptions, handlers: VoiceHandlers): VoiceConnection | { error: AiErrorCode };
}
