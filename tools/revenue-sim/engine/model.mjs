// E-NEXUS共通 収益シミュレーション：計算の本体（純関数・I/Oなし）。
// アプリ固有の値は scenario（JSON）にだけ置き、ここには数値を書かない。
//
// 用語（混同しないために1か所で定義する）
//   gross        税込の販売価格（利用者が払う額）。ストアの手数料はこの額に掛かる
//   proceeds     税と手数料を引いた後の開発者の受取（税の扱いは proceedsOf だけで決める）
//   variable     利用者ごとに増える費用：AI音声・AIテキスト・サーバー・返金・RevenueCat・無料体験
//   contribution 紹介報酬を引く前の貢献利益 = proceeds − variable
//   reward       紹介報酬。contribution から引いて「報酬控除後の貢献利益」にする
//   fixed        契約者数に比例しない費用（別の層。contribution に混ぜない）
// 金額はすべて scenario の通貨（JPY）の実数。USD の原価は fx で換算する。端数処理は表示の時だけ。

export const YEAR_MONTHS = 12;

/** 税込 gross と手数料率 feeRate から受取を求める。税を引くのはここだけ（二重控除を防ぐ）。 */
export function proceedsOf(gross, feeRate, tax) {
  const t = tax.rate;
  switch (tax.mode) {
    // 本則課税：売上の消費税を納め、手数料（税込）に含まれる消費税を控除する → 税抜価格×(1−手数料率)
    case 'standard': return (gross / (1 + t)) * (1 - feeRate);
    // 手数料の消費税を控除できない場合
    case 'no_input_credit': return gross * (1 - feeRate) - (gross * t) / (1 + t);
    // 税を考えない現金の受取（免税事業者など。見込みには使わない）
    case 'cash': return gross * (1 - feeRate);
    default: throw new RangeError(`未知の税の扱い：${tax.mode}`);
  }
}

/** その課金の前までに同じ購読で払われた月数から、ストア手数料率を決める（日本：有料1年を超えた購読は低い率）。 */
export function storeFeeRate(fee, paidMonthsBefore) {
  return paidMonthsBefore < YEAR_MONTHS ? fee.firstYear : fee.afterFirstYear;
}

/** 事業者の課金単価を「請求される音声1分あたりのUSD」へ。 */
export function voiceUsdPerBilledMinute(p) {
  const mult = p.priceMultiplier ?? 1;
  if (p.kind === 'per_token') {
    return ((p.tokensPerSec * 60 * (p.inputUsdPerMTok + p.outputUsdPerMTok * p.outputRatio)) / 1e6) * mult;
  }
  if (p.kind === 'per_minute') {
    const basis = { input: 1, output: p.outputRatio, both: 1 + p.outputRatio }[p.billedOn];
    if (basis === undefined) throw new RangeError(`未知の課金の基準：${p.billedOn}`);
    return (p.translateUsdPerMin + (p.includeTranscribe ? p.transcribeUsdPerMin : 0)) * basis * mult;
  }
  if (p.kind === 'flat') return p.usdPerMin * mult;
  throw new RangeError(`未知の事業者の課金方式：${p.kind}`);
}

/**
 * 利用者の消費（分）から、事業者に請求される分数を求める。
 * billedPerUserMinute：利用者の枠1分に対して請求される長さ（無音を枠に数えないと1より大きくなる）
 * 1セッションごとに接続・排出の付加分、異常終了ごとにリース1回分を足す。
 */
export function billedVoiceMinutes(userMinutes, metering, roundUpPerSession = false) {
  if (!(userMinutes > 0)) return 0;
  const realMinutes = userMinutes * metering.billedPerUserMinute; // 接続している実時間（無音を枠に数えない場合は枠より長い）
  const sessions = Math.max(1, Math.ceil(realMinutes / metering.avgSessionMinutes));
  const perSession = realMinutes / sessions + metering.overheadSecPerSession / 60;
  const body = roundUpPerSession ? sessions * Math.ceil(perSession) : sessions * perSession;
  return body + (metering.abnormalEndsPerMonth * metering.leaseSecPerAbnormalEnd) / 60;
}

/**
 * 1か月の音声の原価。中継の原価上限（costCapUsdPerMonth）は「中継が報告した原価」で止める。報告の作り（costReport）は2通り：
 *   per_user_minute  利用者の枠1分あたり一定額（reportedUsdPerUserMinute）を報告する（今の中継の実装：利用者1msあたり1µUSD）。
 *                    上限は事業者の単価に関係なく「上限÷一定額」の分で効き、事業者の値上げ・無音の課金からは守らない
 *   provider         事業者の実原価を報告する（将来の設計）。上限が実費の天井になる
 * 上限が先に効くと、宣伝した分数を提供できない（servedShare < 1）。実費は提供した分の請求×安全係数。
 */
export function voiceMonthCost(userMinutes, a) {
  const p = a.voiceProvider;
  const billed = billedVoiceMinutes(userMinutes, a.metering, p.roundUpPerSession ?? false);
  const providerUsd = billed * voiceUsdPerBilledMinute(p);
  const report = a.costReport ?? { basis: 'provider' };
  const reportedUsd = report.basis === 'per_user_minute' ? Math.max(0, userMinutes) * report.reportedUsdPerUserMinute : providerUsd;
  const cap = a.costCapUsdPerMonth ?? Infinity;
  const servedShare = reportedUsd > cap ? cap / reportedUsd : 1;
  const actualUsd = providerUsd * servedShare * a.safetyFactor;
  return { billedMinutes: billed, providerUsd, reportedUsd, actualUsd, jpy: actualUsd * a.fx, servedShare, capHit: servedShare < 1 };
}

export function textUsdPerRequest(model, tokens) {
  return ((tokens.inputPerRequest * model.inputUsdPerMTok + tokens.outputPerRequest * model.outputUsdPerMTok) / 1e6) * (model.priceMultiplier ?? 1);
}

export function textMonthCost(requests, a) {
  const usd = Math.max(0, requests) * textUsdPerRequest(a.textModel, a.textTokens) * a.safetyFactor;
  return { usd, jpy: usd * a.fx };
}

/** 1か月のAI原価（音声＋テキスト）。usage は {voiceMinutes, textRequests}。 */
export function aiMonthCost(usage, a) {
  const voice = voiceMonthCost(usage.voiceMinutes, a);
  const text = textMonthCost(usage.textRequests, a);
  return { voice, text, jpy: voice.jpy + text.jpy };
}

/** 新しい有料の契約者1人あたりの無料体験の原価（体験の枠の使用率と、体験から有料への転換率で割り戻す）。 */
export function trialCostPerNewSubscriber(a) {
  const t = a.trial;
  if (!t || !(t.conversion > 0)) return 0;
  const cost = aiMonthCost({ voiceMinutes: t.voiceMinutes * t.usageShare, textRequests: t.textRequests * t.usageShare }, a).jpy;
  return cost / t.conversion;
}

/** 契約者1人が1か月に入れ替わる割合（定常状態で体験の原価を月へ割り付けるため）。 */
export function monthlyReplacement(a, planKey, churnMultiplier = 1) {
  const r = a.retention;
  if (a.plans[planKey].periodMonths === 1) return Math.min(1, r.monthlyChurn * churnMultiplier);
  return Math.min(1, (1 - r.annualRenewalRate) * churnMultiplier) / YEAR_MONTHS;
}

/**
 * 1回の課金（期間 k、0始まり）の損益。年額は1回で12か月分のAI枠を持つ（毎月更新される前提で12倍）。
 * 返す値はその課金1回分（年額なら12か月分）。月換算は monthly* を使う。
 */
export function periodEconomics(a, planKey, k, usage) {
  const plan = a.plans[planKey];
  const months = plan.periodMonths;
  const gross = plan.price;
  const fee = storeFeeRate(a.storeFee, k * months);
  const proceeds = proceedsOf(gross, fee, a.tax);
  const refund = proceeds * a.refundRate;
  const revenuecat = gross * a.revenuecatRate;
  const ai = aiMonthCost(usage, a);
  const aiCost = ai.jpy * months;
  const server = a.serverPerSubscriberMonth * months;
  const contribution = proceeds - refund - revenuecat - aiCost - server;
  return { planKey, k, months, gross, feeRate: fee, proceeds, refund, revenuecat, aiCost, server, contribution, ai };
}

/** 紹介報酬の対象か（方式ごと）。年額では「初回のみ」と「初年度のみ」が同じ1回の課金になる。 */
export function rewardEligible(ref, k, months) {
  const before = k * months;
  if (ref.scheme === 'first_purchase') return k === 0;
  if (ref.scheme === 'first_year') return before < YEAR_MONTHS;
  if (ref.scheme === 'recurring') return ref.payoutMonths == null || before < ref.payoutMonths;
  throw new RangeError(`未知の報酬方式：${ref.scheme}`);
}

/**
 * en-partner-hub の推定手取り（commission.mjs と同じ順序：税込から税の割合を引き、その後に手数料率を掛ける）。
 * 税の扱い（tax.mode）に依存しない。RevenueCat の推定の税率は税込に対する割合 t/(1+t) とする。
 */
export function hubProceeds(gross, feeRate, taxRate) {
  const afterTax = gross - gross * (taxRate / (1 + taxRate));
  return afterTax - afterTax * feeRate;
}

/**
 * 1回の課金に対する紹介報酬（期待値）。基準：
 *   proceeds     推定手取り（hubProceeds）に率を掛ける（en-partner-hub の控除なしの式と同じ）
 *   contract     推定手取り − 契約で合意した1か月あたりの固定控除×カバー月数（en-partner-hub で計算できる形）
 *   contribution 実際の貢献利益（利用者ごとの実原価を引く。partner-hub は利用者別の原価を持たないので、そのままでは計算できない）
 * 返金の取消（clawback）は proceeds／contract の基準で返金率の分を戻す。contribution は返金の影響を既に含む。
 */
export function referralReward(a, ref, period) {
  if (!ref || !(ref.rate > 0) || !rewardEligible(ref, period.k, period.months)) return 0;
  let base;
  const hub = hubProceeds(period.gross, period.feeRate, a.tax.rate);
  if (ref.basis === 'proceeds') base = hub;
  else if (ref.basis === 'contract') base = Math.max(0, hub - ref.deductionPerCoveredMonth * period.months);
  else if (ref.basis === 'contribution') return Math.max(0, period.contribution) * ref.rate;
  else throw new RangeError(`未知の報酬の基準：${ref.basis}`);
  return base * ref.rate * (ref.clawbackOnRefund ? 1 - a.refundRate : 1);
}

/** 購読がその期間まで続いている確率。 */
export function survival(a, planKey, k, churnMultiplier = 1) {
  const r = a.retention;
  if (a.plans[planKey].periodMonths === 1) return Math.pow(1 - Math.min(1, r.monthlyChurn * churnMultiplier), k);
  return Math.pow(1 - Math.min(1, (1 - r.annualRenewalRate) * churnMultiplier), k);
}

/**
 * 定常状態の1人あたり月次（feeYear：'first'＝有料1年目の手数料、'after'＝1年を超えた後）。
 * 報酬は「その課金が報酬の対象なら」の値（方式で対象外なら0）。
 */
export function monthlyUnit(a, planKey, usage, { feeYear = 'first', referral = null, churnMultiplier = 1 } = {}) {
  const months = a.plans[planKey].periodMonths;
  const k = feeYear === 'first' ? 0 : Math.ceil(YEAR_MONTHS / months);
  const p = periodEconomics(a, planKey, k, usage);
  const trial = trialCostPerNewSubscriber(a) * monthlyReplacement(a, planKey, churnMultiplier);
  const contribution = p.contribution / months - trial;
  // 報酬の基準は課金1回の貢献利益（体験の原価は含めない。cohortValue と同じ）
  const reward = referralReward(a, referral, p) / months;
  const gross = p.gross / months;
  const proceeds = p.proceeds / months;
  return {
    planKey, feeYear, feeRate: p.feeRate, gross, net: gross / (1 + a.tax.rate), proceeds,
    refund: p.refund / months, revenuecat: p.revenuecat / months, ai: p.ai.jpy, voice: p.ai.voice, text: p.ai.text,
    server: p.server / months, trial, contribution, reward, afterReward: contribution - reward,
    marginOfProceeds: proceeds > 0 ? (contribution - reward) / proceeds : 0,
  };
}

/**
 * 獲得した有料契約者1人の期間内の価値（horizonMonths の間の期待値）。紹介の方式・継続率の低下を比べる。
 */
export function cohortValue(a, planKey, usage, { referral = null, horizonMonths = 24, churnMultiplier = 1 } = {}) {
  const months = a.plans[planKey].periodMonths;
  const periods = Math.floor(horizonMonths / months);
  let contribution = -trialCostPerNewSubscriber(a);
  let reward = 0;
  let gross = 0;
  let expectedPeriods = 0;
  let minPeriodAfterReward = Infinity;
  for (let k = 0; k < periods; k++) {
    const s = survival(a, planKey, k, churnMultiplier);
    const p = periodEconomics(a, planKey, k, usage);
    const r = referralReward(a, referral, p);
    contribution += s * p.contribution;
    reward += s * r;
    gross += s * p.gross;
    expectedPeriods += s;
    minPeriodAfterReward = Math.min(minPeriodAfterReward, p.contribution - r);
  }
  return { planKey, horizonMonths, expectedPeriods, gross, contribution, reward, afterReward: contribution - reward, minPeriodAfterReward };
}

/** 固定費（段階）から、その契約者数での月の固定費を返す。 */
export function fixedCostAt(tiers, subscribers) {
  const t = tiers.find((x) => x.upToSubscribers == null || subscribers <= x.upToSubscribers);
  return t ? t.jpyPerMonth : tiers[tiers.length - 1].jpyPerMonth;
}

/**
 * 損益分岐：各段の固定費を、1人あたりの報酬控除後の月次（月額・年額の構成比で混ぜる）で割った人数。
 * 段の上限を超える分岐は「その段では回収できない」（null）。
 */
export function breakEven(tiers, perSubscriber) {
  return tiers.map((t, i) => {
    const lower = i === 0 ? 1 : (tiers[i - 1].upToSubscribers ?? 0) + 1;
    const n = perSubscriber > 0 ? Math.ceil(t.jpyPerMonth / perSubscriber) : null;
    // above：段の上限より多く要る（その段では回収できない）／below：段の下限で既に黒字
    const position = n == null ? 'never' : t.upToSubscribers != null && n > t.upToSubscribers ? 'above' : n < lower ? 'below' : 'within';
    return { fromSubscribers: lower, upToSubscribers: t.upToSubscribers, fixed: t.jpyPerMonth, subscribers: n, position, withinTier: position === 'within' || position === 'below' };
  });
}

/** 音声の原価上限が先に効き始める分（利用者の枠の分）。上限に当たらなければ null。 */
export function costCapFromMinutes(a, { stepMinutes = 0.5, limitMinutes = 600 } = {}) {
  for (let i = 1; i * stepMinutes <= limitMinutes; i++) {
    if (voiceMonthCost(i * stepMinutes, a).capHit) return i * stepMinutes;
  }
  return null;
}

/**
 * 許容できる音声の月の枠（分）：全員が枠を使い切っても、報酬控除後の貢献利益が受取の targetMargin 以上に残り、
 * かつ原価上限に当たらずに最後まで提供できる最大値。原価上限に当たる分（costCapFromMinutes）も返す。
 */
export function maxVoiceQuota(a, planKey, { textRequests, feeYear = 'first', referral = null, targetMargin = 0, stepMinutes = 0.5, limitMinutes = 600 } = {}) {
  const capFrom = costCapFromMinutes(a, { stepMinutes, limitMinutes });
  let best = null;
  for (let i = 0; i * stepMinutes <= limitMinutes; i++) {
    const v = i * stepMinutes;
    if (capFrom != null && v >= capFrom) break;
    const u = monthlyUnit(a, planKey, { voiceMinutes: v, textRequests }, { feeYear, referral });
    if (u.marginOfProceeds >= targetMargin) best = v;
    else break;
  }
  let limitedBy = 'margin';
  if (best != null && capFrom != null && best + stepMinutes >= capFrom) limitedBy = 'cost_cap';
  else if (best != null && best + stepMinutes > limitMinutes) limitedBy = 'search_limit';
  return { maxMinutes: best, costCapFromMinutes: capFrom, limitedBy };
}
