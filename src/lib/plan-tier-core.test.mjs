/**
 * `lib/plan-tier-core.ts`の検証（`node --test src/lib/plan-tier-core.test.mjs`）。
 *
 * 3プラン（Free・Pro・Pro+）の基盤。Pro+の価格・機能は未承認のため、ここで固定するのは
 *  1. 現行のFree／Proの権限が変わらないこと（従来の`'pro' in entitlements.active`との真理値表）
 *  2. Pro+がProを包含し、将来のPro+固有機能を`isTierAtLeast`で判定できること
 * の2点だけ。Pro+に含める機能そのものはテストにも書かない。
 */
import { deepEqual, equal } from 'node:assert/strict';
import { test } from 'node:test';

import {
  REVENUECAT_ENTITLEMENT_ID,
  REVENUECAT_PRO_PLUS_ENTITLEMENT_ID,
} from '../config/revenuecat.ts';
import {
  hasProAccess,
  isTierAtLeast,
  PLAN_TIERS,
  resolvePlanTier,
  resolvePlanTierFromActive,
} from './plan-tier-core.ts';

// 実設定（config/revenuecat.ts。import無しのファイルなのでnodeから直接読める）と同じ値で判定する。
const IDS = { pro: REVENUECAT_ENTITLEMENT_ID, proPlus: REVENUECAT_PRO_PLUS_ENTITLEMENT_ID };

test('設定の保護：既存購入者のProのEntitlement IDは"pro"のまま（変えるとPro購入者の権利が消える）', () => {
  equal(REVENUECAT_ENTITLEMENT_ID, 'pro');
  // Pro+の識別子は暫定。Proと同一にならないことだけを固定する（同一だとProがPro+に昇格する）
  equal(REVENUECAT_PRO_PLUS_ENTITLEMENT_ID === REVENUECAT_ENTITLEMENT_ID, false);
});

/** 従来の判定（purchases-store.ts／revenuecat.native.ts にあった式）。`active`はcustomerInfo.entitlements.activeの辞書 */
const legacyIsPro = (active) => 'pro' in active;

/** SDKが返す形（識別子→EntitlementInfo）の辞書を作る */
const activeDict = (...ids) => Object.fromEntries(ids.map((id) => [id, { isActive: true }]));

const tierOf = (...activeIds) => resolvePlanTier(activeIds, IDS);
const isProOf = (active) => hasProAccess(resolvePlanTierFromActive(active, IDS));

test('現行のFree／Pro：{pro, pro_plus, other}の全8部分集合で、旧式(`in`)と新しいisProが突き合う', () => {
  const universe = ['pro', 'pro_plus', 'other'];
  for (let mask = 0; mask < 1 << universe.length; mask++) {
    const ids = universe.filter((_, i) => mask & (1 << i));
    const active = activeDict(...ids);
    const legacy = legacyIsPro(active);
    const now = isProOf(active);
    if (ids.includes('pro_plus') && !ids.includes('pro')) {
      // 唯一の差：pro_plus だけがProの権利を与える（Pro+はProを包含）。現時点では商品が無く到達しない。
      equal(legacy, false, `legacy ${JSON.stringify(ids)}`);
      equal(now, true, `now ${JSON.stringify(ids)}`);
    } else {
      equal(now, legacy, `ids=${JSON.stringify(ids)}`);
    }
  }
});

test('現行のFree／Pro：到達できるentitlements.activeの形（空・pro・無関係・値がundefined・null-prototype）で旧式と一致', () => {
  const reachable = [
    {},
    activeDict('pro'),
    activeDict('other'),
    activeDict('pro', 'other'),
    activeDict('other', 'another'),
    { pro: undefined }, // `in`はキーがあればtrue。Object.keysも同じ
    Object.assign(Object.create(null), { pro: { isActive: true } }),
    Object.freeze(activeDict('pro')),
  ];
  for (const active of reachable) {
    equal(isProOf(active), legacyIsPro(active), `active keys=${JSON.stringify(Object.keys(active))}`);
  }
});

test('CustomerInfo未取得（null／undefined）は free を返す：呼び出し側が「権利なし」と誤用しないための前提を固定', () => {
  equal(resolvePlanTierFromActive(null, IDS), 'free');
  equal(resolvePlanTierFromActive(undefined, IDS), 'free');
  equal(isProOf(null), false);
});

test('現行のFree／Pro：tierの具体値（空・無関係なEntitlement＝free／pro有効＝pro）', () => {
  equal(tierOf(), 'free');
  equal(tierOf('other'), 'free');
  equal(tierOf('other', 'another'), 'free');
  equal(tierOf('pro'), 'pro');
  equal(tierOf('pro', 'other'), 'pro');
  equal(tierOf('other', 'pro'), 'pro');
});

test('従来との差：isProの結果が変わるのは pro_plus だけが有効な場合のみ（記録）', () => {
  // pro_plus だけ：従来はfalse、今回はtrue（Pro+はProを包含するため）。現時点では商品が無く到達しない。
  equal(legacyIsPro(activeDict('pro_plus')), false);
  equal(hasProAccess(tierOf('pro_plus')), true);
  // pro と pro_plus の両方：isProは従来も今回もtrue（tierだけがpro_plusになる）。
  equal(legacyIsPro(activeDict('pro', 'pro_plus')), true);
  equal(hasProAccess(tierOf('pro', 'pro_plus')), true);
  equal(tierOf('pro', 'pro_plus'), 'pro_plus');
});

test('Pro+はProを包含する：pro_plusだけが有効でも、Dashboardでproへ紐付けていなくてもProの権利を持つ', () => {
  equal(tierOf('pro_plus'), 'pro_plus');
  equal(hasProAccess('pro_plus'), true);
  equal(tierOf('pro_plus', 'other'), 'pro_plus');
});

test('プランの序列：free < pro < pro_plus（9通りすべて）', () => {
  deepEqual([...PLAN_TIERS], ['free', 'pro', 'pro_plus']);
  const expected = {
    free: { free: true, pro: false, pro_plus: false },
    pro: { free: true, pro: true, pro_plus: false },
    pro_plus: { free: true, pro: true, pro_plus: true },
  };
  for (const tier of PLAN_TIERS) {
    for (const required of PLAN_TIERS) {
      equal(isTierAtLeast(tier, required), expected[tier][required], `${tier} >= ${required}`);
    }
  }
});

test('将来のPro+固有機能の判定：isTierAtLeast(tier, "pro_plus") はPro+だけがtrue（Free・Proは機能を使えない）', () => {
  equal(isTierAtLeast('free', 'pro_plus'), false);
  equal(isTierAtLeast('pro', 'pro_plus'), false);
  equal(isTierAtLeast('pro_plus', 'pro_plus'), true);
});

test('hasProAccess：Proを要する既存機能の判定はPro・Pro+でtrue、Freeでfalse', () => {
  equal(hasProAccess('free'), false);
  equal(hasProAccess('pro'), true);
  equal(hasProAccess('pro_plus'), true);
});

test('想定外の値（序列に無いtier）は権利を与えない：fail closed', () => {
  equal(isTierAtLeast('platinum', 'pro'), false);
  equal(isTierAtLeast('pro', 'platinum'), false);
  equal(isTierAtLeast(undefined, 'free'), false);
  equal(isTierAtLeast('constructor', 'free'), false);
  equal(isTierAtLeast('__proto__', 'free'), false);
  equal(hasProAccess('platinum'), false);
});

test('Entitlement識別子は完全一致で比較する（部分一致・大文字小文字違い・継承プロパティ名では昇格しない）', () => {
  equal(tierOf('pro_plus_trial'), 'free');
  equal(tierOf('Pro'), 'free');
  equal(tierOf('PRO_PLUS'), 'free');
  equal(tierOf('proplus'), 'free');
  equal(tierOf('constructor', 'toString', '__proto__'), 'free');
});

test('識別子は引数で渡す：Dashboard側の名前が決まったら設定1か所の差し替えで追従できる', () => {
  const renamed = { pro: 'pro', proPlus: 'plus' };
  equal(resolvePlanTier(['plus'], renamed), 'pro_plus');
  equal(resolvePlanTier(['pro_plus'], renamed), 'free');
  equal(resolvePlanTier(['pro'], renamed), 'pro');
});

test('同じEntitlementが重複していても結果は変わらない', () => {
  equal(tierOf('pro', 'pro'), 'pro');
  equal(tierOf('pro_plus', 'pro_plus', 'pro'), 'pro_plus');
});
