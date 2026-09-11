/**
 * `lib/revenuecat-purchase-core.ts`の検証（`node --test src/lib/revenuecat-purchase-core.test.mjs`）。
 *
 * Fable 5.1 / Codex独立監査（2026-09-11、HEAD dbd99ce）S2-2：
 * 「purchasePackageが正常resolveしただけでactive proを確認せず完了画面へ進む」問題の再発防止。
 */
import { equal } from 'node:assert/strict';
import { test } from 'node:test';

import { resolvePurchaseOutcome } from './revenuecat-purchase-core.ts';

test('正常終了＋pro有効 → success', () => {
  equal(resolvePurchaseOutcome({ threw: false, cancelled: false, wasProBefore: false, proActiveAfter: true }), 'success');
});

test('正常終了だがpro無効 → entitlement_missing（成功扱いにしない）', () => {
  equal(resolvePurchaseOutcome({ threw: false, cancelled: false, wasProBefore: false, proActiveAfter: false }), 'entitlement_missing');
});

test('正常終了だがCustomerInfoを確認できない（null） → entitlement_missing', () => {
  equal(resolvePurchaseOutcome({ threw: false, cancelled: false, wasProBefore: false, proActiveAfter: null }), 'entitlement_missing');
});

test('利用者キャンセル → cancelled（proの状態に依らない）', () => {
  equal(resolvePurchaseOutcome({ threw: true, cancelled: true, wasProBefore: false, proActiveAfter: true }), 'cancelled');
  equal(resolvePurchaseOutcome({ threw: true, cancelled: true, wasProBefore: true, proActiveAfter: null }), 'cancelled');
});

test('例外だが「購入前は非Pro → 今はPro」 → success（Apple側で成立していた救済）', () => {
  equal(resolvePurchaseOutcome({ threw: true, cancelled: false, wasProBefore: false, proActiveAfter: true }), 'success');
});

test('例外で、購入前から既にPro → error（既存Entitlementを今回の成功と誤認しない）', () => {
  equal(resolvePurchaseOutcome({ threw: true, cancelled: false, wasProBefore: true, proActiveAfter: true }), 'error');
});

test('例外でpro無効／再取得不能 → error', () => {
  equal(resolvePurchaseOutcome({ threw: true, cancelled: false, wasProBefore: false, proActiveAfter: false }), 'error');
  equal(resolvePurchaseOutcome({ threw: true, cancelled: false, wasProBefore: false, proActiveAfter: null }), 'error');
});
