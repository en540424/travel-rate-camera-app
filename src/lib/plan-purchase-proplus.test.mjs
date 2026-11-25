/**
 * Pro+を加えた購入の判定・Offeringの解決・プラン変更の検証（2026-11-25）。
 *
 * 1. `resolveTierPurchaseOutcome`：目標を'pro'にした時、従来の`resolvePurchaseOutcome`と全組み合わせで一致
 *    （Proの購入の挙動は変えない）。Pro→Pro+の購入で、残っている`pro`を成功と誤認しない
 * 2. `resolveMonthlyPackage`/`resolveAnnualPackage`：Proの商品だけのOfferingでは除外の有無で結果が同じ。
 *    Pro+の商品が混ざっても、Proの候補として拾わない
 * 3. `classifyPlanChange`：Upgrade（即時）・Downgrade／Crossgrade（次回更新日）
 * 4. `resolveProPlusFlags`：本番の既定値では入口なし・契約を装わない。検証用ビルドは本物の権利で判定
 */
import { deepEqual, equal } from 'node:assert/strict';
import { test } from 'node:test';

import { classifyPlanChange, identifyPlanProduct } from './plan-change-core.ts';
import { getProPlusAccess, resolveProPlusFlags } from './proplus/proplus-access-core.ts';
import { resolveAnnualPackage, resolveMonthlyPackage, resolvePackageByProductId } from './revenuecat-package-core.ts';
import { resolvePurchaseOutcome, resolveTierPurchaseOutcome } from './revenuecat-purchase-core.ts';

const TIERS = ['free', 'pro', 'pro_plus'];
const BOOLS = [true, false];

// ── 1. 購入の判定 ──

test('目標＝pro：従来の判定（wasProBefore・proActiveAfter）と全組み合わせで一致する', () => {
  for (const threw of BOOLS) for (const cancelled of BOOLS) for (const wasProBefore of BOOLS)
    for (const proActiveAfter of [true, false, null]) {
      const legacy = (() => {
        if (!threw) return proActiveAfter === true ? 'success' : 'entitlement_missing';
        if (cancelled) return 'cancelled';
        if (!wasProBefore && proActiveAfter === true) return 'success';
        return 'error';
      })();
      equal(resolvePurchaseOutcome({ threw, cancelled, wasProBefore, proActiveAfter }), legacy,
        JSON.stringify({ threw, cancelled, wasProBefore, proActiveAfter }));
    }
});

test('目標＝pro：購入前がPro+でも「既に権利がある」扱い（従来のisPro＝Pro以上と同じ）', () => {
  equal(resolveTierPurchaseOutcome({ threw: true, cancelled: false, tierBefore: 'pro_plus', tierAfter: 'pro_plus', targetTier: 'pro' }), 'error');
  equal(resolveTierPurchaseOutcome({ threw: false, cancelled: false, tierBefore: 'pro_plus', tierAfter: 'pro_plus', targetTier: 'pro' }), 'success');
});

test('Pro→Pro+：正常終了でもpro_plusが付かなければ entitlement_missing（残っているproを成功と誤認しない）', () => {
  equal(resolveTierPurchaseOutcome({ threw: false, cancelled: false, tierBefore: 'pro', tierAfter: 'pro', targetTier: 'pro_plus' }), 'entitlement_missing');
  equal(resolveTierPurchaseOutcome({ threw: false, cancelled: false, tierBefore: 'pro', tierAfter: 'pro_plus', targetTier: 'pro_plus' }), 'success');
  equal(resolveTierPurchaseOutcome({ threw: false, cancelled: false, tierBefore: 'pro', tierAfter: null, targetTier: 'pro_plus' }), 'entitlement_missing');
});

test('Pro→Pro+：例外の後にpro_plusが見えたら救済で success（購入前がProでも）', () => {
  equal(resolveTierPurchaseOutcome({ threw: true, cancelled: false, tierBefore: 'pro', tierAfter: 'pro_plus', targetTier: 'pro_plus' }), 'success');
  equal(resolveTierPurchaseOutcome({ threw: true, cancelled: false, tierBefore: 'pro', tierAfter: 'pro', targetTier: 'pro_plus' }), 'error');
  equal(resolveTierPurchaseOutcome({ threw: true, cancelled: false, tierBefore: 'pro_plus', tierAfter: 'pro_plus', targetTier: 'pro_plus' }), 'error');
});

test('キャンセルは目標・プランに依らず cancelled', () => {
  for (const tierBefore of TIERS) for (const tierAfter of [...TIERS, null]) for (const targetTier of ['pro', 'pro_plus'])
    equal(resolveTierPurchaseOutcome({ threw: true, cancelled: true, tierBefore, tierAfter, targetTier }), 'cancelled');
});

test('想定外のプランの値は権利なし側（success にしない）', () => {
  equal(resolveTierPurchaseOutcome({ threw: false, cancelled: false, tierBefore: 'free', tierAfter: 'constructor', targetTier: 'pro' }), 'entitlement_missing');
  equal(resolveTierPurchaseOutcome({ threw: true, cancelled: false, tierBefore: 'free', tierAfter: 'unknown', targetTier: 'pro' }), 'error');
});

// ── 2. Offeringの解決 ──

const PRO_M = 'com.estep.travelratecamera.pro.monthly';
const PRO_Y = 'com.estep.travelratecamera.pro.yearly';
const PLUS_M = 'com.estep.travelratecamera.proplus.monthly';
const PLUS_Y = 'com.estep.travelratecamera.proplus.yearly';
const EXCLUDE = [PLUS_M, PLUS_Y];
const pkg = (identifier, packageType, productId) => ({ identifier, packageType, product: { identifier: productId } });

test('Proの商品だけのOffering：除外の有無で結果が同じ（定義済み・独自命名・packageType無し）', () => {
  const pm = pkg('$rc_monthly', 'MONTHLY', PRO_M);
  const py = pkg('$rc_annual', 'ANNUAL', PRO_Y);
  const offerings = [
    { availablePackages: [pm, py], monthly: pm, annual: py },
    { availablePackages: [pkg('Monthly', 'MONTHLY', PRO_M), pkg('Yearly', 'ANNUAL', PRO_Y)], monthly: null, annual: null },
    { availablePackages: [pkg('a', 'CUSTOM', PRO_M), pkg('b', 'CUSTOM', PRO_Y)] },
    { availablePackages: [] },
    null,
  ];
  for (const o of offerings) {
    equal(resolveMonthlyPackage(o, PRO_M, EXCLUDE), resolveMonthlyPackage(o, PRO_M));
    equal(resolveAnnualPackage(o, PRO_Y, EXCLUDE), resolveAnnualPackage(o, PRO_Y));
  }
});

test('Pro+の商品が$rc_monthly・MONTHLYで混ざっても、Proの月額・年額として拾わない', () => {
  const plusM = pkg('$rc_monthly', 'MONTHLY', PLUS_M);
  const plusY = pkg('$rc_annual', 'ANNUAL', PLUS_Y);
  const proM = pkg('pro_m', 'CUSTOM', PRO_M);
  const proY = pkg('pro_y', 'CUSTOM', PRO_Y);
  const o = { availablePackages: [plusM, plusY, proM, proY], monthly: plusM, annual: plusY };
  equal(resolveMonthlyPackage(o, PRO_M, EXCLUDE), proM);
  equal(resolveAnnualPackage(o, PRO_Y, EXCLUDE), proY);
  // 除外しなければ従来どおりPro+を拾ってしまう（除外が必要な理由）
  equal(resolveMonthlyPackage(o, PRO_M), plusM);
});

test('Pro+の解決はProduct IDの完全一致だけ（$rc_monthly・packageTypeを見ない）', () => {
  const proM = pkg('$rc_monthly', 'MONTHLY', PRO_M);
  const plusM = pkg('plus_m', 'CUSTOM', PLUS_M);
  equal(resolvePackageByProductId({ availablePackages: [proM, plusM], monthly: proM }, PLUS_M), plusM);
  equal(resolvePackageByProductId({ availablePackages: [proM], monthly: proM }, PLUS_M), null);
  equal(resolvePackageByProductId(null, PLUS_M), null);
});

// ── 3. プラン変更 ──

const CATALOG = { proMonthly: PRO_M, proAnnual: PRO_Y, proPlusMonthly: PLUS_M, proPlusAnnual: PLUS_Y };

test('Product IDから商品を特定し、知らないIDはnull', () => {
  deepEqual(identifyPlanProduct(PRO_M, CATALOG), { tier: 'pro', period: 'monthly' });
  deepEqual(identifyPlanProduct(PLUS_Y, CATALOG), { tier: 'pro_plus', period: 'annual' });
  equal(identifyPlanProduct('com.other', CATALOG), null);
  equal(identifyPlanProduct(null, CATALOG), null);
});

test('プラン変更：Free→新規／Pro→Pro+＝Upgrade即時／Pro+→Pro＝Downgrade次回／月⇔年＝Crossgrade次回／同じ', () => {
  const pro = (period) => ({ tier: 'pro', period });
  const plus = (period) => ({ tier: 'pro_plus', period });
  deepEqual(classifyPlanChange('free', null, plus('monthly')), { kind: 'new', timing: 'immediate' });
  deepEqual(classifyPlanChange('pro', pro('monthly'), plus('monthly')), { kind: 'upgrade', timing: 'immediate' });
  deepEqual(classifyPlanChange('pro', pro('annual'), plus('monthly')), { kind: 'upgrade', timing: 'immediate' });
  deepEqual(classifyPlanChange('pro_plus', plus('monthly'), pro('monthly')), { kind: 'downgrade', timing: 'next_renewal' });
  deepEqual(classifyPlanChange('pro', pro('monthly'), pro('annual')), { kind: 'crossgrade', timing: 'next_renewal' });
  deepEqual(classifyPlanChange('pro_plus', plus('annual'), plus('annual')), { kind: 'same', timing: 'none' });
});

test('プラン変更：有料なのに今の商品を特定できない・プランと商品が食い違う → unknown（推測しない）', () => {
  deepEqual(classifyPlanChange('pro', null, { tier: 'pro_plus', period: 'monthly' }), { kind: 'unknown', timing: 'none' });
  deepEqual(classifyPlanChange('pro_plus', { tier: 'pro', period: 'monthly' }, { tier: 'pro', period: 'annual' }), { kind: 'unknown', timing: 'none' });
});

// ── 4. Pro+の入口のフラグ ──

test('本番の既定値（公開フラグfalse・開発ビルドでない・検証用でない）：入口なし・契約を装わない', () => {
  const f = resolveProPlusFlags({ showProPlus: false, devPreview: false, qa: false });
  deepEqual(f, { flagEnabled: false, simulateEntitlement: false });
  for (const hasProPlus of BOOLS) for (const hasExistingData of BOOLS)
    equal(getProPlusAccess({ flagEnabled: f.flagEnabled, hasProPlus, hasExistingData }), 'hidden');
});

test('開発ビルド：入口あり・契約を装う／検証用ビルド：入口あり・本物の権利で判定', () => {
  deepEqual(resolveProPlusFlags({ showProPlus: false, devPreview: true, qa: false }), { flagEnabled: true, simulateEntitlement: true });
  deepEqual(resolveProPlusFlags({ showProPlus: false, devPreview: false, qa: true }), { flagEnabled: true, simulateEntitlement: false });
  deepEqual(resolveProPlusFlags({ showProPlus: false, devPreview: true, qa: true }), { flagEnabled: true, simulateEntitlement: false });
  const qa = resolveProPlusFlags({ showProPlus: false, devPreview: false, qa: true });
  equal(getProPlusAccess({ flagEnabled: qa.flagEnabled, hasProPlus: false, hasExistingData: false }), 'upsell');
  equal(getProPlusAccess({ flagEnabled: qa.flagEnabled, hasProPlus: false, hasExistingData: true }), 'read_only');
  equal(getProPlusAccess({ flagEnabled: qa.flagEnabled, hasProPlus: true, hasExistingData: false }), 'full');
});
