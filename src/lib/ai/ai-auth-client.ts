/**
 * Pro+ AI 翻訳の本人認証（端末側の通信）。規則は ai-auth-core.ts（純粋・試験済み）、中継は tabirate-ai-gateway `src/api/auth.mjs`。
 *
 * 1. StoreKit 2 の今有効な Pro+ の取引の JWS を `modules/storekit-proof` で取り出す（iOS だけ。購入・復元はしない）
 * 2. `POST {base}/v1/auth/session` へ { proof: { kind: 'storekit_jws', jws, renewal_jws? } } と `x-app-user-id` を送る
 * 3. 中継の短命のトークンをメモリにだけ置く（保存しない）。期限の少し前・401 の後に取り直す
 * 鍵・秘密の値はアプリに入れない。ただし **JWS は期限まで何度でもトークンと交換できる資格情報**として扱う（ログ・保存・送信先は
 * 中継の交換だけ。2026-11-26 検収 S1：再利用の検査・個別の失効は中継に未実装で、Human の判断）。
 * **証拠の方式の採用は Human の判断。実機・Sandbox での取り出しと交換は未確認。**
 */
import { Platform } from 'react-native';

import { REVENUECAT_PRO_PLUS_ANNUAL_PRODUCT_ID, REVENUECAT_PRO_PLUS_MONTHLY_PRODUCT_ID } from '@/config/revenuecat';

import { exchangeOutcome, proofBody, proofUnavailableCode, reexchangeAllowed, tokenUsable, type GatewayToken } from './ai-auth-core';
import type { StoreKitProof } from '../../../modules/storekit-proof';
import type { AiErrorCode } from './ai-translation-core';

const TIMEOUT_MS = 20_000;

let cached: { appUserId: string; token: GatewayToken } | null = null;
let inflight: { appUserId: string; promise: Promise<TokenResult> } | null = null;

export type TokenResult = { ok: true; token: string } | { ok: false; code: AiErrorCode };

async function proofOf(): Promise<{ ok: true; proof: StoreKitProof } | { ok: false; code: AiErrorCode }> {
  if (Platform.OS !== 'ios') return { ok: false, code: proofUnavailableCode('unsupported') };
  try {
    const { currentEntitlementProofs } = await import('../../../modules/storekit-proof');
    const list = await currentEntitlementProofs([REVENUECAT_PRO_PLUS_MONTHLY_PRODUCT_ID, REVENUECAT_PRO_PLUS_ANNUAL_PRODUCT_ID]);
    return list.length > 0 ? { ok: true, proof: list[0] } : { ok: false, code: proofUnavailableCode('no_transaction') };
  } catch {
    return { ok: false, code: proofUnavailableCode('unsupported') };
  }
}

async function exchange(base: string, appUserId: string): Promise<TokenResult> {
  const proof = await proofOf();
  if (!proof.ok) return proof;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${base}/v1/auth/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-app-user-id': appUserId },
      body: proofBody(proof.proof),
      signal: ctrl.signal,
    });
    const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    const out = exchangeOutcome(res.status, body);
    if (!out.ok) return out;
    cached = { appUserId, token: out.token };
    return { ok: true, token: out.token.token };
  } catch {
    return { ok: false, code: 'offline' };
  } finally {
    clearTimeout(t);
  }
}

/** 使えるトークン。無い・期限が近い・`force` なら取り直す（同時の要求は1本にまとめる） */
export async function getGatewayToken(base: string, appUserId: string, { force = false } = {}): Promise<TokenResult> {
  if (!force && cached && cached.appUserId === appUserId && tokenUsable(cached.token, Date.now())) return { ok: true, token: cached.token.token };
  if (force) cached = null;
  // 同時の要求は同じ利用者の間だけ1本にまとめる（利用者が変わった直後に前の利用者の結果を使わない）
  if (!inflight || inflight.appUserId !== appUserId) {
    const promise = exchange(base, appUserId).finally(() => {
      if (inflight?.promise === promise) inflight = null;
    });
    inflight = { appUserId, promise };
  }
  return inflight.promise;
}

// 403 not_entitled の後の交換し直し（ai-auth-core の reexchangeAllowed）。確定して断られたトークン・前の時刻・進行中の交換
let deniedFor: string | null = null;
let lastReexchange: { appUserId: string; at: number } | null = null;
let reinflight: { appUserId: string; promise: Promise<{ ok: true; token: string } | null> } | null = null;

/**
 * 中継が 403 `not_entitled` を返したトークンについて、新しい証拠で交換し直す（ai-auth-core の shouldReexchangeAfterDenied）。
 * 成功すれば新しいトークン、交換しない・断られた時は null（古いトークンを残す）。同時の呼び出しは進行中の交換を共有する
 */
export async function reexchangeAfterDenied(base: string, appUserId: string, deniedToken: string): Promise<{ ok: true; token: string } | null> {
  if (reinflight && reinflight.appUserId === appUserId) return reinflight.promise;
  const now = Date.now();
  // 断られたトークンの後に、別の要求の交換し直しで新しいトークンが既にあれば、それで送り直す（交換しない。再検収 NV-2）
  if (cached && cached.appUserId === appUserId && cached.token.token !== deniedToken && tokenUsable(cached.token, now)) return { ok: true, token: cached.token.token };
  // 間隔は利用者ごと（利用者を切り替えた直後に前の利用者の間隔で止めない。再検収 NV-5）
  const lastAt = lastReexchange && lastReexchange.appUserId === appUserId ? lastReexchange.at : null;
  if (!reexchangeAllowed({ deniedToken, deniedFor, lastAt, now })) return null;
  lastReexchange = { appUserId, at: now };
  const promise = exchange(base, appUserId)
    .then((r) => {
      if (r.ok) return r;
      if (r.code === 'not_entitled') deniedFor = deniedToken; // 確定した拒否だけ。圏外・503・429 は間隔の後にもう一度許す
      return null;
    })
    .finally(() => {
      if (reinflight?.promise === promise) reinflight = null;
    });
  reinflight = { appUserId, promise };
  return promise;
}

/** トークンを捨てる（中継が 401 を返した時・利用者が変わった時） */
export function forgetGatewayToken() {
  cached = null;
}
