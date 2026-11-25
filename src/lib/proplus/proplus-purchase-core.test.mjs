/**
 * Pro+ の購入画面の判定（2026-11-25）。StoreKit・RevenueCat の実通信は無く、判定の組み合わせだけを固定する。
 *
 * 1. 商品の取得状態：購入できない環境・読み込み中・取得失敗・未登録（準備中）・購入可を分け、未登録・失敗では押せない
 * 2. 購入ボタン：新規・アップグレード（即時）・期間の変更（次回の更新日）・契約中・下位への変更・契約不明
 * 3. 購入の結果：`resolveTierPurchaseOutcome`（目標＝pro_plus）と組み合わせ、Pro+ が付かなければ完了と見せない。
 *    期間の変更の success を「Pro+ が有効になりました」と見せない
 * 4. 復元：Pro+ だけを「Pro+ を復元」とし、Pro だけの復元は Pro+ と見せない
 * 5. 無料体験の文言は StoreKit の introPrice があった時だけ。使えない機能を「利用可」にしない
 */
import { deepEqual, equal, ok } from 'node:assert/strict';
import { test } from 'node:test';

import { classifyPlanChange } from '../plan-change-core.ts';
import { resolveTierPurchaseOutcome } from '../revenuecat-purchase-core.ts';
import {
  availabilityMessage,
  describeIntroOffer,
  describePurchaseResult,
  describeRestoreResult,
  effectivePeriod,
  planActionFor,
  planComparison,
  proPlusFeatures,
  resolveProPlusAvailability,
  tierLabel,
} from './proplus-purchase-core.ts';

const base = { isConfigured: true, isInitialized: true, loadState: 'loaded', hasMonthly: true, hasAnnual: true };

test('商品の取得状態：環境・読み込み・失敗・未登録・購入可', () => {
  equal(resolveProPlusAvailability({ ...base, isInitialized: false }), 'loading');
  equal(resolveProPlusAvailability({ ...base, isConfigured: false }), 'store_unavailable');
  equal(resolveProPlusAvailability({ ...base, loadState: 'idle' }), 'loading');
  equal(resolveProPlusAvailability({ ...base, loadState: 'loading' }), 'loading');
  equal(resolveProPlusAvailability({ ...base, loadState: 'failed' }), 'fetch_failed');
  equal(resolveProPlusAvailability({ ...base, hasMonthly: false, hasAnnual: false }), 'not_registered');
  equal(resolveProPlusAvailability({ ...base, hasMonthly: false }), 'ready');
  equal(resolveProPlusAvailability(base), 'ready');
  ok(availabilityMessage('not_registered').includes('準備中'));
  ok(availabilityMessage('fetch_failed').includes('取得できません'));
  equal(availabilityMessage('ready'), null);
});

test('期間の選択：選んだ期間の商品が無ければ、ある方へ寄せる', () => {
  equal(effectivePeriod('monthly', { monthly: true, annual: true }), 'monthly');
  equal(effectivePeriod('monthly', { monthly: false, annual: true }), 'annual');
  equal(effectivePeriod('annual', { monthly: true, annual: false }), 'monthly');
  equal(effectivePeriod('annual', { monthly: false, annual: false }), 'annual');
});

const NEW = { kind: 'new', timing: 'immediate' };
const args = (change, availability = 'ready', priceLabel = '¥X/月') => ({ change, availability, priceLabel, purchasing: false });

test('購入ボタン：未登録・取得失敗・購入できない環境・読み込み中は押せない（価格が無ければ押せない）', () => {
  for (const a of ['not_registered', 'fetch_failed', 'store_unavailable', 'loading']) {
    const action = planActionFor(args(NEW, a));
    equal(action.disabled, true, a);
    equal(action.kind, 'none', a);
  }
  equal(planActionFor(args(NEW, 'not_registered')).label, '準備中');
  equal(planActionFor(args(NEW, 'ready', null)).disabled, true, '価格の表示値が無い');
  equal(planActionFor({ ...args(NEW), purchasing: true }).disabled, true, '購入中は押せない（二重購入の防止）');
});

test('購入ボタン：Free・Pro・Pro+ の契約と商品の組み合わせ（plan-change-core の判定と一緒に）', () => {
  const pm = { tier: 'pro', period: 'monthly' };
  const pa = { tier: 'pro', period: 'annual' };
  const ppm = { tier: 'pro_plus', period: 'monthly' };
  const ppa = { tier: 'pro_plus', period: 'annual' };
  const act = (tier, product, target) => planActionFor(args(classifyPlanChange(tier, product, target)));

  const free = act('free', null, ppm);
  deepEqual([free.kind, free.note], ['purchase', null]);
  ok(free.label.includes('購入する'));

  for (const current of [pm, pa]) {
    const up = act('pro', current, ppa);
    equal(up.kind, 'purchase');
    ok(up.label.includes('アップグレード'));
    ok(up.note.includes('すぐに'), 'アップグレードは即時');
  }

  const cross = act('pro_plus', ppm, ppa);
  equal(cross.kind, 'purchase');
  ok(cross.note.includes('次回の更新日'), '期間の変更は次回の更新日から');

  const same = act('pro_plus', ppa, ppa);
  deepEqual([same.kind, same.disabled], ['none', true]);

  const unknownPaid = act('pro_plus', null, ppa);
  equal(unknownPaid.kind, 'manage', '契約の商品が分からなければ推測せず管理画面へ');
  const unknownPro = act('pro', null, ppa);
  equal(unknownPro.kind, 'manage');

  const down = planActionFor(args(classifyPlanChange('pro_plus', ppa, pm)));
  equal(down.kind, 'manage', '下位への変更は管理画面へ');
  ok(down.note.includes('次回の更新日'));
});

test('購入の結果：Pro+ の Entitlement が付いた時だけ完了。Pro だけ残った・例外・オフラインは完了にしない', () => {
  const ppm = { tier: 'pro_plus', period: 'monthly' };
  const cases = [
    // [購入前, 例外, キャンセル, 購入後, 期待の結果, 期待の見せ方]
    ['free', false, false, 'pro_plus', 'success', 'complete'],
    ['pro', false, false, 'pro_plus', 'success', 'complete'],
    ['pro', false, false, 'pro', 'entitlement_missing', 'restore'], // Pro→Pro+ で pro_plus が付かない
    ['free', false, false, 'free', 'entitlement_missing', 'restore'],
    ['free', false, false, null, 'entitlement_missing', 'restore'], // 購入後の CustomerInfo が取れない
    ['free', true, false, 'pro_plus', 'success', 'complete'], // 例外の後に Apple 側で成立していた
    ['pro', true, false, 'pro', 'error', 'restore'],
    ['free', true, false, null, 'error', 'restore'], // オフライン・通信失敗
    ['pro_plus', true, false, 'pro_plus', 'error', 'restore'], // 既存の Pro+ を今回の成功と誤認しない
    ['free', true, true, 'free', 'cancelled', null],
  ];
  for (const [before, threw, cancelled, after, want, tone] of cases) {
    const status = resolveTierPurchaseOutcome({ threw, cancelled, tierBefore: before, tierAfter: after, targetTier: 'pro_plus' });
    equal(status, want, JSON.stringify([before, threw, cancelled, after]));
    const change = classifyPlanChange(before, before === 'free' ? null : ppm, ppm);
    const shown = describePurchaseResult(status, before === 'pro_plus' ? change : { kind: before === 'pro' ? 'upgrade' : 'new', timing: 'immediate' });
    equal(shown?.tone ?? null, tone, JSON.stringify([before, threw, after]));
  }
});

test('期間の変更（Crossgrade）の success は「Pro+ が有効になりました」と見せない', () => {
  const shown = describePurchaseResult('success', { kind: 'crossgrade', timing: 'next_renewal' });
  equal(shown.tone, 'info');
  ok(!shown.title.includes('有効になりました'));
  ok(shown.body.includes('次回の更新日'));
  equal(describePurchaseResult('success', NEW).title, 'Pro+が有効になりました');
  ok(describePurchaseResult('entitlement_missing', NEW).body.includes('もう一度購入せず'), '二重購入を促さない');
});

test('復元：Pro+ だけを Pro+ の復元とし、Pro だけ・無し・失敗を分ける', () => {
  equal(describeRestoreResult('success', 'pro_plus').tone, 'complete');
  const pro = describeRestoreResult('success', 'pro');
  equal(pro.tone, 'info');
  ok(pro.body.includes('Pro+の購入は見つかりませんでした'));
  ok(describeRestoreResult('success', 'free').title.includes('見つかりませんでした'));
  ok(describeRestoreResult('error', null).title.includes('確認できませんでした'));
  ok(describeRestoreResult('success', null).title.includes('確認できませんでした'), '復元後の状態が分からない時は Free と見せない');
});

test('無料体験の文言は StoreKit の introPrice がある時だけ', () => {
  equal(describeIntroOffer(null), null);
  equal(describeIntroOffer(undefined), null);
  ok(describeIntroOffer({ price: 0, priceString: '¥0', periodUnit: 'DAY', periodNumberOfUnits: 7, cycles: 1 }).startsWith('最初の7日は無料'));
  ok(describeIntroOffer({ price: 0, priceString: '¥0', periodUnit: 'WEEK', periodNumberOfUnits: 1, cycles: 1 }).startsWith('最初の1週間は無料'));
  ok(describeIntroOffer({ price: 120, priceString: '¥120', periodUnit: 'MONTH', periodNumberOfUnits: 1, cycles: 3 }).includes('3か月は¥120'));
  equal(describeIntroOffer({ price: 0, priceString: '¥0', periodUnit: 'FORTNIGHT', periodNumberOfUnits: 1, cycles: 1 }), null);
  equal(describeIntroOffer({ price: 0, priceString: '¥0', periodUnit: 'DAY', periodNumberOfUnits: 0, cycles: 1 }), null);
});

test('比較表の数値は FREE_LIMITS から。価格をコードに持たない', () => {
  const rows = planComparison({ saves: 10, trips: 1 });
  equal(rows[0].free, '1旅行10件');
  equal(rows[1].free, '1件');
  ok(rows.every((r) => !/[¥円]|\d{3,}/.test(`${r.free}${r.pro}${r.proPlus}`)), '価格・枠の数値を書かない');
  ok(rows.filter((r) => r.pro === '—').every((r) => r.proPlus === '○'), 'Pro+ は Pro にない機能を含む');
  ok(rows.filter((r) => r.pro !== '—').every((r) => r.proPlus === r.pro), 'Pro+ は Pro の機能をすべて含む');
});

test('使えない機能を「利用可」にしない：中継が無ければ AI は準備中、音声は取り込み部品が無ければ準備中', () => {
  const none = proPlusFeatures({ aiGatewayConfigured: false, voiceReady: false });
  deepEqual(none.map((f) => f.status), ['available', 'available', 'preparing', 'preparing']);
  const textOnly = proPlusFeatures({ aiGatewayConfigured: true, voiceReady: false });
  deepEqual(textOnly.map((f) => f.status), ['available', 'available', 'available', 'preparing']);
  equal(proPlusFeatures({ aiGatewayConfigured: false, voiceReady: true })[3].status, 'preparing', '中継が無ければ音声も準備中');
  deepEqual(['free', 'pro', 'pro_plus'].map(tierLabel), ['無料版', 'Pro', 'Pro+']);
});
