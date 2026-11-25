/**
 * Pro+ AI 翻訳の本人認証（端末側の純粋ロジック・`node --test` で検証）。中継は tabirate-ai-gateway `src/api/auth.mjs`。
 *
 * 流れ：端末は StoreKit の署名付き取引（Apple が署名した JWS。端末のネイティブ部品 `modules/storekit-proof` が取り出す）を
 * `POST {base}/v1/auth/session` へ送り、中継の短命のトークンを受ける。以後の要求（テキスト・残量・音声）は
 * `Authorization: Bearer <トークン>` と `x-app-user-id` を付ける。中継はトークンの主体を「証拠の購読（Apple の取引ID）」にし、
 * 利用枠もその購読ごとに数える（2026-11-26 B1 の根本修正。x-app-user-id からは決めない）。権利は中継が要求ごとに確かめる。
 * - トークンは端末のメモリにだけ置く（保存しない）。期限の少し前に取り直す
 * - 中継が 401 を返したら、トークンを捨てて1回だけ取り直して送り直す
 * - 中継が 403 `not_entitled` を返したら、**そのトークンにつき1回だけ**新しい証拠で交換し直して送り直す（2026-11-26）。トークンは
 *   交換の時の取引に結び付く。月額→年額などの商品の変更・失効後の再購読で RevenueCat が別の購読を作ると、古い取引のトークンは
 *   権利なしのままになる。端末の StoreKit に今の Pro+ の取引が無ければ交換は通信せずに not_entitled で終わる。交換が断られても
 *   古いトークンを残す。交換が not_entitled で**確定して**断られたトークンでは2回目の交換をしない。圏外・503・429 の一時的な失敗は
 *   間隔（REEXCHANGE_MIN_INTERVAL_MS）の後にもう一度だけ許す。交換し直しは端末全体で間隔に1回まで（交換の回数の上限 429 に当てない）。
 *   同時に 403 を受けた要求は、進行中の交換し直しを共有する（検収 RV-3・RV-4・RV-12）
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

/** 要求が 403 `not_entitled` で返った時、新しい証拠で交換し直して1回だけ送り直すか（同じトークンでの2回目は呼び出し側が止める） */
export function shouldReexchangeAfterDenied(status: number, error: unknown, attempt: number): boolean {
  return status === 403 && normalizeErrorCode(error) === 'not_entitled' && attempt === 0;
}

/** 403 の後の交換し直しの最小の間隔（端末全体）。正当な交換は10分のトークンの期限ごとに1回なので、これで窓の上限に当たらない */
export const REEXCHANGE_MIN_INTERVAL_MS = 60_000;

/**
 * 403 の後に交換し直してよいか。`deniedFor` は交換が not_entitled で確定して断られたトークン、`lastAt` は前の交換し直しの時刻
 */
export function reexchangeAllowed(p: { deniedToken: string; deniedFor: string | null; lastAt: number | null; now: number; minIntervalMs?: number }): boolean {
  if (p.deniedFor !== null && p.deniedFor === p.deniedToken) return false;
  return p.lastAt === null || p.now - p.lastAt >= (p.minIntervalMs ?? REEXCHANGE_MIN_INTERVAL_MS);
}

/** 証拠が取れない時の扱い（端末に Pro+ の取引が無い・StoreKit が使えない）：Pro+ ではないものとして案内する */
export function proofUnavailableCode(reason: 'no_transaction' | 'unsupported' | 'error'): AiErrorCode {
  if (reason === 'no_transaction') return 'not_entitled';
  if (reason === 'unsupported') return 'unconfigured';
  return 'unknown';
}
