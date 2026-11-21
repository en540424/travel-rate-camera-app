import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { analyze } from './analyze.mjs';
import {
  billedVoiceMinutes, breakEven, cohortValue, costCapFromMinutes, hubProceeds, fixedCostAt, maxVoiceQuota, monthlyUnit, periodEconomics, proceedsOf,
  referralReward, rewardEligible, storeFeeRate, textMonthCost, voiceMonthCost, voiceUsdPerBilledMinute,
} from './model.mjs';
import { toMarkdown } from './report.mjs';
import { buildAssumptions, loadScenario, resolveParams, validateScenario, withOverrides } from './scenario.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXAMPLE = path.join(HERE, '..', 'apps', 'example', 'scenario.json');
const EXAMPLE_TEXT = fs.readFileSync(EXAMPLE, 'utf8');
const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} ≠ ${b}`);

const TAX = { rate: 0.1, mode: 'standard' };
/** 計算の検査用の前提（数値は検査のためだけの値） */
function base(over = {}) {
  return {
    fx: 150, tax: TAX,
    storeFee: { firstYear: 0.26, afterFirstYear: 0.15 },
    plans: { monthly: { price: 600, periodMonths: 1 }, annual: { price: 6000, periodMonths: 12 } },
    trial: { voiceMinutes: 0, textRequests: 0, conversion: 0.3, usageShare: 1 },
    voiceProvider: { kind: 'flat', usdPerMin: 0.04 },
    textModel: { inputUsdPerMTok: 0.1, outputUsdPerMTok: 0.5 },
    textTokens: { inputPerRequest: 2000, outputPerRequest: 1200 },
    metering: { billedPerUserMinute: 1, avgSessionMinutes: 5, overheadSecPerSession: 0, abnormalEndsPerMonth: 0, leaseSecPerAbnormalEnd: 15 },
    costCapUsdPerMonth: Infinity, safetyFactor: 1, refundRate: 0, revenuecatRate: 0, serverPerSubscriberMonth: 0,
    retention: { monthlyChurn: 0.2, annualRenewalRate: 0.5 },
    ...over,
  };
}
const ZERO = { voiceMinutes: 0, textRequests: 0 };

test('税：本則は税抜×(1−手数料)。税を二重に引かない（税込1,100円・手数料0なら1,000円）', () => {
  close(proceedsOf(1100, 0, TAX), 1000);
  close(proceedsOf(600, 0.15, TAX), (600 / 1.1) * 0.85);
  close(proceedsOf(600, 0.26, TAX), (600 / 1.1) * 0.74);
  // 控除できない場合は手数料の消費税の分だけ少ない
  close(proceedsOf(600, 0.15, { rate: 0.1, mode: 'no_input_credit' }), 600 * 0.85 - 600 / 11);
  close(proceedsOf(600, 0.15, { rate: 0.1, mode: 'cash' }), 600 * 0.85);
  assert.throws(() => proceedsOf(600, 0.15, { rate: 0.1, mode: 'x' }));
});

test('手数料：有料1年までは1年目の率、それ以降は低い率（月額13回目・年額2回目から）', () => {
  const fee = { firstYear: 0.26, afterFirstYear: 0.15 };
  assert.equal(storeFeeRate(fee, 11), 0.26);
  assert.equal(storeFeeRate(fee, 12), 0.15);
  const a = base({ storeFee: fee });
  assert.equal(periodEconomics(a, 'monthly', 11, ZERO).feeRate, 0.26);
  assert.equal(periodEconomics(a, 'monthly', 12, ZERO).feeRate, 0.15);
  assert.equal(periodEconomics(a, 'annual', 0, ZERO).feeRate, 0.26);
  assert.equal(periodEconomics(a, 'annual', 1, ZERO).feeRate, 0.15);
});

test('事業者の単価：トークン課金は入力＋出力×比率、分課金は課金の基準で倍になる', () => {
  close(voiceUsdPerBilledMinute({ kind: 'per_token', inputUsdPerMTok: 3.5, outputUsdPerMTok: 21, tokensPerSec: 25, outputRatio: 1 }), 0.03675);
  close(voiceUsdPerBilledMinute({ kind: 'per_token', inputUsdPerMTok: 3.5, outputUsdPerMTok: 21, tokensPerSec: 25, outputRatio: 1.3 }), 0.00525 + 0.0315 * 1.3);
  const oa = { kind: 'per_minute', translateUsdPerMin: 0.034, transcribeUsdPerMin: 0.017, includeTranscribe: true, outputRatio: 1 };
  close(voiceUsdPerBilledMinute({ ...oa, billedOn: 'input' }), 0.051);
  close(voiceUsdPerBilledMinute({ ...oa, billedOn: 'both' }), 0.102);
  close(voiceUsdPerBilledMinute({ ...oa, billedOn: 'input', includeTranscribe: false, priceMultiplier: 1.5 }), 0.051);
});

test('請求の分数：0分は0。セッションの付加分・異常終了のリース・セッションごとの切り上げを足す', () => {
  const m = { billedPerUserMinute: 1, avgSessionMinutes: 5, overheadSecPerSession: 6, abnormalEndsPerMonth: 0, leaseSecPerAbnormalEnd: 15 };
  assert.equal(billedVoiceMinutes(0, m), 0);
  close(billedVoiceMinutes(15, m), 15 + 3 * 0.1);
  close(billedVoiceMinutes(15, { ...m, abnormalEndsPerMonth: 2 }), 15.3 + 0.5);
  close(billedVoiceMinutes(15, { ...m, billedPerUserMinute: 3 }), 45 + 9 * 0.1); // セッション数は接続の実時間（45分）で数える
  assert.equal(billedVoiceMinutes(14, { ...m, overheadSecPerSession: 0 }, true), 15); // 3セッション×切り上げ5分
});

test('原価上限：報告の原価が上限を超えると止まり、実費は上限×安全係数。提供できた割合を返す', () => {
  const a = base({ costCapUsdPerMonth: 1, safetyFactor: 1.3, voiceProvider: { kind: 'flat', usdPerMin: 0.1 } });
  const c = voiceMonthCost(15, a);
  assert.equal(c.capHit, true);
  close(c.servedShare, 1 / 1.5);
  close(c.actualUsd, 1.3);
  close(c.jpy, 1.3 * 150);
  const under = voiceMonthCost(5, a);
  assert.equal(under.capHit, false);
  close(under.jpy, 5 * 0.1 * 1.3 * 150);
});

test('原価上限（利用者1分あたり一律の報告）：事業者の単価に関係なく同じ分で止まり、値上げからは守らない', () => {
  const report = { basis: 'per_user_minute', reportedUsdPerUserMinute: 0.06 };
  const cheap = base({ costCapUsdPerMonth: 1.2, costReport: report, voiceProvider: { kind: 'flat', usdPerMin: 0.04 } });
  const dear = base({ costCapUsdPerMonth: 1.2, costReport: report, voiceProvider: { kind: 'flat', usdPerMin: 0.4 } });
  assert.equal(voiceMonthCost(15, cheap).capHit, false);
  assert.equal(voiceMonthCost(15, dear).capHit, false); // 高い単価でも15分（報告 $0.90）なら止まらない
  close(voiceMonthCost(15, dear).jpy, 15 * 0.4 * 150); // 実費は事業者の単価のまま
  const c = voiceMonthCost(30, cheap); // 報告 $1.80 > 上限 $1.20 → 20分で止まる
  close(c.servedShare, 1.2 / 1.8);
  close(c.actualUsd, 30 * 0.04 * (1.2 / 1.8));
  assert.equal(costCapFromMinutes(cheap), 20.5);
  assert.equal(costCapFromMinutes(dear), 20.5);
});

test('テキスト：上限いっぱいの1回の原価×回数。0回は0', () => {
  const a = base();
  close(textMonthCost(200, a).jpy, 200 * ((2000 * 0.1 + 1200 * 0.5) / 1e6) * 150);
  assert.equal(textMonthCost(0, a).jpy, 0);
});

test('利用0：AI原価0で、貢献利益＝受取−返金−RevenueCat−サーバー', () => {
  const a = base({ refundRate: 0.03, revenuecatRate: 0.01, serverPerSubscriberMonth: 1 });
  const u = monthlyUnit(a, 'monthly', ZERO);
  assert.equal(u.ai, 0);
  const proceeds = (600 / 1.1) * 0.74;
  close(u.contribution, proceeds - proceeds * 0.03 - 6 - 1);
});

test('年額：AI枠は毎月更新なので12か月分の原価を計上し、月換算は1/12。受取は年額の1回分', () => {
  const a = base();
  const usage = { voiceMinutes: 15, textRequests: 0 };
  const p = periodEconomics(a, 'annual', 0, usage);
  close(p.aiCost, 12 * 15 * 0.04 * 150);
  const u = monthlyUnit(a, 'annual', usage);
  close(u.proceeds, ((6000 / 1.1) * 0.74) / 12);
  close(u.ai, 15 * 0.04 * 150);
  close(u.contribution, u.proceeds - u.ai);
});

test('紹介の方式：年額は初回のみ＝初年度のみ。月額の初年度は12回。継続は支払月数の上限で止まる', () => {
  assert.equal(rewardEligible({ scheme: 'first_purchase' }, 0, 12), true);
  assert.equal(rewardEligible({ scheme: 'first_purchase' }, 1, 12), false);
  assert.equal(rewardEligible({ scheme: 'first_year' }, 0, 12), true);
  assert.equal(rewardEligible({ scheme: 'first_year' }, 1, 12), false);
  assert.equal(rewardEligible({ scheme: 'first_year' }, 11, 1), true);
  assert.equal(rewardEligible({ scheme: 'first_year' }, 12, 1), false);
  assert.equal(rewardEligible({ scheme: 'recurring', payoutMonths: null }, 40, 1), true);
  assert.equal(rewardEligible({ scheme: 'recurring', payoutMonths: 12 }, 12, 1), false);
  const a = base();
  const usage = { voiceMinutes: 0, textRequests: 0 };
  const ref = (scheme) => ({ rate: 0.2, scheme, basis: 'proceeds', clawbackOnRefund: false });
  const fp = cohortValue(a, 'annual', usage, { referral: ref('first_purchase'), horizonMonths: 36 });
  const fy = cohortValue(a, 'annual', usage, { referral: ref('first_year'), horizonMonths: 36 });
  close(fp.reward, fy.reward);
});

test('紹介の基準：貢献利益が負なら0。固定控除は年額で×12。返金の取消は受取の基準で返金率だけ戻す', () => {
  const a = base({ refundRate: 0.1 });
  const p = periodEconomics(a, 'annual', 0, ZERO);
  const contract = { rate: 0.2, scheme: 'recurring', basis: 'contract', deductionPerCoveredMonth: 50, clawbackOnRefund: false };
  close(referralReward(a, contract, p), (hubProceeds(6000, 0.26, 0.1) - 600) * 0.2);
  close(referralReward(a, { ...contract, basis: 'proceeds', clawbackOnRefund: true }, p), p.proceeds * 0.2 * 0.9);
  assert.equal(referralReward(a, { rate: 0.2, scheme: 'recurring', basis: 'contribution' }, { ...p, contribution: -10 }), 0);
  assert.equal(referralReward(a, null, p), 0);
});

test('紹介の契約基準は en-partner-hub の式（税込−税の割合→手数料）で、税の扱いの設定に依存しない', () => {
  // partner-hub：afterTax = gross − gross×tax%、proceeds = afterTax×(1−commission%)
  close(hubProceeds(600, 0.15, 0.1), (600 - 600 * (0.1 / 1.1)) * 0.85);
  const ref = { rate: 0.2, scheme: 'recurring', basis: 'contract', deductionPerCoveredMonth: 10, clawbackOnRefund: false };
  const std = periodEconomics(base(), 'monthly', 0, ZERO);
  const cash = periodEconomics(base({ tax: { rate: 0.1, mode: 'cash' } }), 'monthly', 0, ZERO);
  close(referralReward(base(), ref, std), referralReward(base({ tax: { rate: 0.1, mode: 'cash' } }), ref, cash));
  assert.notEqual(std.proceeds, cash.proceeds);
});

test('紹介の貢献基準：月次の表と獲得1人の期間内の値で、報酬の基準が同じ（体験の原価を含めない）', () => {
  const a = base({ trial: { voiceMinutes: 3, textRequests: 20, conversion: 0.3, usageShare: 1 }, voiceProvider: { kind: 'flat', usdPerMin: 0.05 } });
  const usage = { voiceMinutes: 15, textRequests: 100 };
  const ref = { rate: 0.2, scheme: 'first_purchase', basis: 'contribution' };
  const u = monthlyUnit(a, 'monthly', usage, { referral: ref });
  const c = cohortValue(a, 'monthly', usage, { referral: ref, horizonMonths: 1 });
  close(u.reward, c.reward);
  close(u.reward, periodEconomics(a, 'monthly', 0, usage).contribution * 0.2);
});

test('赤字：原価上限なしで高い単価を使い切ると貢献利益が負になる', () => {
  const a = base({ voiceProvider: { kind: 'flat', usdPerMin: 0.4 } });
  const u = monthlyUnit(a, 'annual', { voiceMinutes: 30, textRequests: 0 });
  assert.ok(u.contribution < 0);
  assert.ok(u.marginOfProceeds < 0);
});

test('為替：原価だけが為替に比例し、受取は変わらない', () => {
  const usage = { voiceMinutes: 15, textRequests: 200 };
  const u150 = monthlyUnit(base({ fx: 150 }), 'monthly', usage);
  const u190 = monthlyUnit(base({ fx: 190 }), 'monthly', usage);
  close(u150.proceeds, u190.proceeds);
  close(u190.ai / u150.ai, 190 / 150);
});

test('損益分岐：段ごとに固定費÷1人の月次。段の上限を超えたらその段では回収できない。0以下は回収不可', () => {
  const tiers = [{ upToSubscribers: 100, jpyPerMonth: 32000 }, { upToSubscribers: null, jpyPerMonth: 106000 }];
  const be = breakEven(tiers, 500);
  assert.deepEqual(be.map((x) => x.subscribers), [64, 212]);
  assert.deepEqual(be.map((x) => x.position), ['within', 'within']);
  assert.equal(breakEven(tiers, 200)[0].position, 'above');
  assert.equal(breakEven(tiers, 200)[0].withinTier, false);
  const rich = breakEven(tiers, 5000);
  assert.deepEqual(rich.map((x) => [x.subscribers, x.position]), [[7, 'within'], [22, 'below']]); // 2段目（101人〜）は入った時点で黒字
  assert.equal(breakEven(tiers, 0)[0].position, 'never');
  assert.equal(breakEven(tiers, 0)[0].subscribers, null);
  assert.equal(fixedCostAt(tiers, 50), 32000);
  assert.equal(fixedCostAt(tiers, 5000), 106000);
});

test('許容できる枠：目標の受取比を満たす最大の分。原価上限に当たる分も返す', () => {
  const a = base({ costCapUsdPerMonth: 1, voiceProvider: { kind: 'flat', usdPerMin: 0.05 } });
  const r = maxVoiceQuota(a, 'monthly', { textRequests: 0, targetMargin: -Infinity });
  assert.equal(r.costCapFromMinutes, 20.5); // 20分ちょうどは上限に等しく、超えるのは20.5分から
  const strict = maxVoiceQuota(base({ voiceProvider: { kind: 'flat', usdPerMin: 0.05 } }), 'monthly', { textRequests: 0, targetMargin: 0.5 });
  const u = monthlyUnit(base({ voiceProvider: { kind: 'flat', usdPerMin: 0.05 } }), 'monthly', { voiceMinutes: strict.maxMinutes, textRequests: 0 });
  assert.ok(u.marginOfProceeds >= 0.5);
  const over = monthlyUnit(base({ voiceProvider: { kind: 'flat', usdPerMin: 0.05 } }), 'monthly', { voiceMinutes: strict.maxMinutes + 0.5, textRequests: 0 });
  assert.ok(over.marginOfProceeds < 0.5);
  // 利益率で先に止まっても、原価上限に当たる分は独立に出る
  const capped = base({ costCapUsdPerMonth: 1, voiceProvider: { kind: 'flat', usdPerMin: 0.05 } });
  const tight = maxVoiceQuota(capped, 'annual', { textRequests: 0, targetMargin: 0.9 });
  assert.equal(tight.costCapFromMinutes, 20.5);
  assert.equal(costCapFromMinutes(base()), null);
  const loose = maxVoiceQuota(capped, 'monthly', { textRequests: 0, targetMargin: -Infinity });
  assert.equal(loose.maxMinutes, 20);
  assert.equal(loose.limitedBy, 'cost_cap');
  assert.equal(maxVoiceQuota(base(), 'monthly', { textRequests: 0, targetMargin: -Infinity, limitMinutes: 10 }).limitedBy, 'search_limit');
});

test('シナリオ：葉の出所・確度を集め、欠けや不正な値・存在しない選択を検出する', () => {
  const { value, provenance } = resolveParams({ a: { value: 1, status: 'confirmed', source: 'x' }, b: [{ value: 2, status: 'assumption', source: 'y' }] });
  assert.deepEqual(value, { a: 1, b: [2] });
  assert.equal(provenance.length, 2);
  const sc = loadScenario(EXAMPLE);
  const broken = JSON.parse(EXAMPLE_TEXT);
  broken.params.fx = { value: 150 };
  broken.params.metering.billedPerUserMinute.value = 0.5;
  broken.selection.voiceProvider = 'nope';
  broken.params.planMix.monthly.value = 0.9;
  broken.params.trial.conversion.value = 0;
  broken.params.costCapUsdPerMonth.value = -1;
  broken.params.referral.deductionPerCoveredMonth.value = 'abc';
  broken.params.referral.payoutMonths.value = 1.5;
  const probs = validateScenario(broken);
  assert.ok(probs.some((p) => p.includes('fx：status')));
  assert.ok(probs.some((p) => p.includes('fx：source')));
  assert.ok(probs.some((p) => p.includes('billedPerUserMinute')));
  assert.ok(probs.some((p) => p.includes('nope')));
  for (const k of ['planMix', 'trial.conversion', 'costCapUsdPerMonth', 'deductionPerCoveredMonth', 'payoutMonths']) assert.ok(probs.some((p) => p.includes(k)), k);
  assert.throws(() => withOverrides(sc.params, { 'metering.nothing': 1 }));
  close(withOverrides(sc.params, { fx: 190 }).fx, 190);
  assert.equal(sc.params.fx, 150);
});

test('例のシナリオ：検証を通り、分析・Markdownが全節を出す', () => {
  assert.deepEqual(validateScenario(JSON.parse(EXAMPLE_TEXT)), []);
  const sc = loadScenario(EXAMPLE);
  const res = analyze(sc);
  assert.ok(res.matrix.length > 0 && res.capByProvider.length > 0 && res.referral.length > 0);
  const md = toMarkdown(res, sc);
  for (const h of ['## 1. 単位原価', '## 2.', '## 3.', '## 4.', '## 5.', '## 6.', '## 前提と出所']) assert.ok(md.includes(h), h);
  // 原価上限なしのストレスでは提供割合が1
  assert.ok(res.capStress.filter((r) => r.key === 'no_cap').every((r) => r.cells.every((c) => c.servedShare === 1)));
  // 例の前提を組めること（選択の解決）
  assert.equal(buildAssumptions(sc.params, sc.selection).storeFee.firstYear, 0.15);
});
