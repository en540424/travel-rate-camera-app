// シナリオの analysis の指定どおりに、比較表のデータ（JSON）を作る。表示は report.mjs。
import {
  breakEven, costCapFromMinutes, cohortValue, maxVoiceQuota, monthlyUnit, textUsdPerRequest, voiceMonthCost,
} from './model.mjs';
import { buildAssumptions, withOverrides } from './scenario.mjs';

const PLANS = ['monthly', 'annual'];

function withPrices(params, [monthly, annual]) {
  return withOverrides(params, { 'plans.monthly.price': monthly, 'plans.annual.price': annual });
}

function usageOf(params, profileKey, voiceQuota, textQuota) {
  if (profileKey === 'cap') return { voiceMinutes: voiceQuota, textRequests: textQuota };
  const u = params.usageProfiles[profileKey];
  if (!u) throw new Error(`usageProfiles に ${profileKey} がありません`);
  return { voiceMinutes: Math.min(u.voiceMinutes, voiceQuota), textRequests: Math.min(u.textRequests, textQuota) };
}

function referralOf(params, rate, scheme = 'recurring', basis = 'contribution') {
  if (!(rate > 0)) return null;
  const r = params.referral;
  return { rate, scheme, basis, payoutMonths: r.payoutMonths, clawbackOnRefund: r.clawbackOnRefund, deductionPerCoveredMonth: r.deductionPerCoveredMonth };
}

/** 主要な結論の数字を、どの組み合わせでも同じ手順で出す。 */
export function analyze(sc) {
  const base = sc.params;
  const an = sc.analysis;
  const sel = sc.selection;
  const focus = an.focus;
  const refRate = an.focusReferralRate ?? 0.2;
  const target = an.targetMargin ?? 0;
  const horizon = an.horizonMonths ?? 24;
  const fxBase = sel.fx ?? base.fx;
  const out = { app: sc.app, asOf: sc.asOf, selection: { ...sel, fx: fxBase }, focus, targetMargin: target, focusReferralRate: refRate, horizonMonths: horizon };

  // 1. 単位原価
  out.voiceUnit = [];
  for (const vp of an.voiceProviders) for (const fx of an.fx) {
    const a = buildAssumptions(base, { ...sel, voiceProvider: vp, fx });
    const perQuota = an.voiceQuotas.map((q) => {
      const c = voiceMonthCost(q, a);
      return { quota: q, jpy: c.jpy, servedShare: c.servedShare, capHit: c.capHit };
    });
    const capFrom = costCapFromMinutes(a);
    const uncapped = voiceMonthCost(focus.voiceQuota, { ...a, costCapUsdPerMonth: Infinity });
    out.voiceUnit.push({ provider: vp, label: base.voiceProviders[vp].label ?? vp, fx, yenPerMinute: uncapped.jpy / focus.voiceQuota, perQuota, costCapFromMinutes: capFrom });
  }
  out.textUnit = [];
  for (const tm of an.textModels) for (const fx of an.fx) {
    const a = buildAssumptions(base, { ...sel, textModel: tm, fx });
    const perReq = textUsdPerRequest(a.textModel, a.textTokens) * a.safetyFactor * fx;
    out.textUnit.push({ model: tm, label: base.textModels[tm].label ?? tm, fx, yenPerRequest: perReq, perQuota: an.textQuotas.map((q) => ({ quota: q, jpy: perReq * q })) });
  }

  // 2. 価格×音声枠×プラン×手数料×利用（基準の事業者・為替）
  out.matrix = [];
  for (const pair of an.pricePairs) for (const vq of an.voiceQuotas) for (const plan of PLANS) for (const fee of an.storeFees) for (const prof of an.usageProfiles) {
    const params = withPrices(base, pair);
    const a = buildAssumptions(params, { ...sel, storeFee: fee, fx: fxBase });
    const usage = usageOf(params, prof, vq, focus.textQuota);
    const u0 = monthlyUnit(a, plan, usage);
    const u1 = monthlyUnit(a, plan, usage, { referral: referralOf(params, refRate) });
    const u2 = monthlyUnit(a, plan, usage, { referral: referralOf(params, refRate, 'recurring', 'contract') });
    out.matrix.push({ pricePair: pair, voiceQuota: vq, textQuota: focus.textQuota, plan, storeFee: fee, usage: prof, unit: u0, withReferral: u1, withReferralContract: u2 });
  }

  // 3. 上限まで使い切った時：事業者×為替、ストレス
  const focusParams = withPrices(base, focus.pricePair);
  const capUsage = { voiceMinutes: focus.voiceQuota, textRequests: focus.textQuota };
  const capRow = (params, s, label) => {
    const cells = [];
    for (const plan of PLANS) for (const fee of an.storeFees) {
      const a = buildAssumptions(params, { ...sel, ...s, storeFee: fee });
      const u = monthlyUnit(a, plan, capUsage, { referral: referralOf(params, refRate) });
      const c = monthlyUnit(a, plan, capUsage, { referral: referralOf(params, refRate, 'recurring', 'contract') });
      cells.push({ plan, storeFee: fee, ai: u.ai, contribution: u.contribution, afterReward: u.afterReward, margin: u.marginOfProceeds, afterRewardContract: c.afterReward, marginContract: c.marginOfProceeds, servedShare: u.voice.servedShare });
    }
    return { label, provider: s.voiceProvider, fx: s.fx, cells };
  };
  out.capByProvider = [];
  for (const vp of an.voiceProviders) for (const fx of an.fx) out.capByProvider.push(capRow(focusParams, { voiceProvider: vp, fx }, `${base.voiceProviders[vp].label ?? vp}・¥${fx}`));
  out.capStress = [];
  for (const [key, st] of Object.entries(an.stress ?? {})) {
    const params = withOverrides(focusParams, st.set ?? {});
    for (const vp of st.voiceProviders ?? [sel.voiceProvider]) for (const fx of st.fx ?? [fxBase]) {
      out.capStress.push({ key, ...capRow(params, { ...(st.selection ?? {}), voiceProvider: vp, fx }, `${st.label}／${base.voiceProviders[vp].label ?? vp}・¥${fx}`) });
    }
  }

  // 4. 紹介報酬（獲得1人の期間内の価値）
  const aFocus = buildAssumptions(focusParams, { ...sel, fx: fxBase });
  const refProfiles = an.referralUsageProfiles ?? ['typical', 'cap'];
  out.referral = [];
  for (const plan of PLANS) for (const prof of refProfiles) {
    const usage = usageOf(focusParams, prof, focus.voiceQuota, focus.textQuota);
    const none = cohortValue(aFocus, plan, usage, { horizonMonths: horizon });
    for (const scheme of an.referralSchemes) for (const rate of an.referralRates) {
      const c = cohortValue(aFocus, plan, usage, { horizonMonths: horizon, referral: referralOf(focusParams, rate, scheme, 'contribution') });
      out.referral.push({ plan, usage: prof, scheme, rate, before: none.contribution, reward: c.reward, after: c.afterReward, rewardShare: none.contribution > 0 ? c.reward / none.contribution : null, minPeriodAfterReward: c.minPeriodAfterReward });
    }
  }
  // 基準の違い（契約で計算できる基準と実際の貢献利益の差＝高利用者への払い過ぎ）
  out.referralBasis = [];
  for (const plan of PLANS) for (const prof of refProfiles) {
    const usage = usageOf(focusParams, prof, focus.voiceQuota, focus.textQuota);
    const row = { plan, usage: prof };
    for (const basis of ['contribution', 'contract', 'proceeds']) {
      row[basis] = cohortValue(aFocus, plan, usage, { horizonMonths: horizon, referral: referralOf(focusParams, refRate, 'recurring', basis) });
    }
    out.referralBasis.push(row);
  }
  // 紹介経由の継続率の低下
  const mult = focusParams.referral.referredChurnMultiplier ?? 1;
  out.referralChurn = PLANS.map((plan) => {
    const usage = usageOf(focusParams, 'typical', focus.voiceQuota, focus.textQuota);
    const normal = cohortValue(aFocus, plan, usage, { horizonMonths: horizon, referral: referralOf(focusParams, refRate, 'recurring') });
    const referred = cohortValue(aFocus, plan, usage, { horizonMonths: horizon, referral: referralOf(focusParams, refRate, 'recurring'), churnMultiplier: mult });
    return { plan, multiplier: mult, normal, referred };
  });

  // 5. 損益分岐（月額・年額の構成比で混ぜた1人の月次）
  const mix = focusParams.planMix;
  out.breakEven = [];
  for (const fee of an.storeFees) for (const prof of ['typical', 'cap']) for (const [rate, basis] of [[0, 'contribution'], [refRate, 'contribution'], [refRate, 'contract']]) {
    const a = buildAssumptions(focusParams, { ...sel, storeFee: fee, fx: fxBase });
    const usage = usageOf(focusParams, prof, focus.voiceQuota, focus.textQuota);
    const per = PLANS.reduce((s, plan) => s + mix[plan] * monthlyUnit(a, plan, usage, { referral: referralOf(focusParams, rate, 'recurring', basis) }).afterReward, 0);
    out.breakEven.push({ storeFee: fee, usage: prof, rate, basis, perSubscriber: per, tiers: breakEven(focusParams.fixedCostTiers, per) });
  }

  // 6. 許容できる音声の枠
  out.allowedQuota = [];
  for (const vp of an.voiceProviders) for (const fx of an.fx) for (const plan of PLANS) for (const fee of an.storeFees) {
    const a = buildAssumptions(focusParams, { ...sel, voiceProvider: vp, fx, storeFee: fee });
    const r = maxVoiceQuota(a, plan, { textRequests: focus.textQuota, targetMargin: target, referral: referralOf(focusParams, refRate) });
    const rc = maxVoiceQuota(a, plan, { textRequests: focus.textQuota, targetMargin: target, referral: referralOf(focusParams, refRate, 'recurring', 'contract') });
    out.allowedQuota.push({ provider: vp, fx, plan, storeFee: fee, ...r, maxMinutesContract: rc.maxMinutes, limitedByContract: rc.limitedBy });
  }

  out.flags = flagsOf(out, sc);
  out.provenance = sc.provenance;
  return out;
}

/** 機械的に分かるリスクだけを挙げる（推奨は人が書く）。 */
export function flagsOf(out, sc) {
  const flags = [];
  const PLAN = { monthly: '月額', annual: '年額' };
  const at = (c) => `${PLAN[c.plan]}・${sc.params.storeFees[c.storeFee]?.label ?? c.storeFee}`;
  for (const r of [...out.capByProvider, ...out.capStress]) {
    for (const c of r.cells) {
      if (c.servedShare < 1) flags.push({ level: 'product', text: `${r.label}：${at(c)} で原価上限が先に効き、宣伝した音声の枠の ${(c.servedShare * 100).toFixed(0)}% しか提供できない` });
      const worst = Math.min(c.afterReward, c.afterRewardContract);
      const worstMargin = Math.min(c.margin, c.marginContract);
      const which = c.afterRewardContract < c.afterReward ? '契約基準' : '貢献基準';
      if (worst < 0) flags.push({ level: 'loss', text: `${r.label}：${at(c)} で上限まで使うと報酬控除後が赤字（${which} ${Math.round(worst)}円／月）` });
      else if (worstMargin < out.targetMargin) flags.push({ level: 'margin', text: `${r.label}：${at(c)} で上限まで使うと受取比 ${(worstMargin * 100).toFixed(1)}%（${which}・目標 ${(out.targetMargin * 100).toFixed(0)}% 未満）` });
    }
  }
  for (const r of out.referral) {
    if (r.minPeriodAfterReward < 0) flags.push({ level: 'loss', text: `紹介 ${r.scheme}・${(r.rate * 100).toFixed(0)}%・${PLAN[r.plan]}・${r.usage}：報酬を払う課金のどれかで報酬控除後が赤字` });
  }
  for (const r of out.breakEven) {
    if (!(r.perSubscriber > 0)) flags.push({ level: 'loss', text: `損益分岐：${sc.params.storeFees[r.storeFee]?.label ?? r.storeFee}・${r.usage}・紹介${(r.rate * 100).toFixed(0)}%（${r.basis}） で1人の月次が0以下（固定費を回収できない）` });
  }
  return dedupe(flags);
}

function dedupe(flags) {
  const seen = new Set();
  return flags.filter((f) => (seen.has(f.text) ? false : (seen.add(f.text), true)));
}
