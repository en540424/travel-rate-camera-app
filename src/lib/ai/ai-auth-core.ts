/**
 * Pro+ AI 翻訳の本人認証（端末側の純粋ロジック・`node --test` で検証）。中継は tabirate-ai-gateway `src/api/auth.mjs`。
 *
 * 流れ：端末は StoreKit の署名付き取引（Apple が署名した JWS。端末のネイティブ部品 `modules/storekit-proof` が取り出す）を
 * `POST {base}/v1/auth/session` へ送り、中継の短命のトークンを受ける。以後の要求（テキスト・残量・音声）は
 * `Authorization: Bearer <トークン>` と `x-app-user-id` を付ける。中継はトークンの主体を「証拠の購読（Apple の取引ID）」にし、
 * 利用枠もその購読ごとに数える（2026-11-26 B1 の根本修正。x-app-user-id からは決めない）。権利は中継が要求ごとに確かめる。
 * - トークンは端末のメモリにだけ置く（保存しない）。期限の少し前に取り直す
 * - 中継が 401 を返したら、トークンを捨てて1回だけ取り直して送り直す
 * - **証拠の方式（StoreKit の JWS を使うか）の採用は Human の判断**（2026-11-25 時点で未決定）。中継が方式を登録していなければ
 *   交換は unconfigured になり、AI 翻訳は「準備中」のまま動かない
 */
import { normalizeErrorCode, type AiErrorCode } from './ai-translation-core';

export type GatewayToken = { token: string; expiresAtMs: number };

/** 期限の何ms前から取り直すか */
export const TOKEN_REFRESH_MARGIN_MS = 60_000;

export function tokenUsable(t: GatewayToken | null, now: number, marginMs = TOKEN_REFRESH_MARGIN_MS): t is GatewayToken {
  return t !== null && typeof t.token === 'string' && t.token.length > 0 && Number.isFinite(t.expiresAtMs) && t.expiresAtMs - marginMs > now;
}

/** 交換の応答を読む */
export function exchangeOutcome(status: number, body: Record<string, unknown> | null): { ok: true; token: GatewayToken } | { ok: false; code: AiErrorCode } {
  if (status === 200 && body && typeof body.token === 'string' && typeof body.expires_at === 'string') {
    const exp = Date.parse(body.expires_at);
    if (Number.isFinite(exp)) return { ok: true, token: { token: body.token, expiresAtMs: exp } };
    return { ok: false, code: 'unknown' };
  }
  return { ok: false, code: normalizeErrorCode(body?.error) };
}

/** 交換の本文。更新情報（猶予期間の確認に使う）は取れた時だけ載せる。JWS は資格情報として扱い、保存・記録しない */
export function proofBody(proof: { jws: string; renewalJws?: string }): string {
  const p: Record<string, string> = { kind: 'storekit_jws', jws: proof.jws };
  if (typeof proof.renewalJws === 'string' && proof.renewalJws.length > 0) p.renewal_jws = proof.renewalJws;
  return JSON.stringify({ proof: p });
}

/** 要求が 401 で返った時、トークンを取り直して1回だけ送り直すか */
export function shouldRefreshAfter(status: number, attempt: number): boolean {
  return status === 401 && attempt === 0;
}

/** 証拠が取れない時の扱い（端末に Pro+ の取引が無い・StoreKit が使えない）：Pro+ ではないものとして案内する */
export function proofUnavailableCode(reason: 'no_transaction' | 'unsupported' | 'error'): AiErrorCode {
  if (reason === 'no_transaction') return 'not_entitled';
  if (reason === 'unsupported') return 'unconfigured';
  return 'unknown';
}
