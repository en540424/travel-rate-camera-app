// シナリオ（JSON）の読み込み・検証・値の解決。
// 数値の葉は {"value": x, "status": "...", "source": "..."} の形で書き、出所と確度をレポートに残す。
// status：confirmed（公式資料で確認）／measured（実測）／estimate（実測からの推定）／assumption（仮定）／unverified（未確認）
import fs from 'node:fs';
import path from 'node:path';

export const STATUSES = ['confirmed', 'measured', 'estimate', 'assumption', 'unverified'];

const isLeaf = (x) => x !== null && typeof x === 'object' && !Array.isArray(x) && Object.hasOwn(x, 'value');

/** 葉の {value,...} を値へ置き換え、出所の一覧を返す。 */
export function resolveParams(node, at = '', provenance = []) {
  if (isLeaf(node)) {
    provenance.push({ path: at, value: node.value, status: node.status ?? null, source: node.source ?? null, note: node.note ?? null });
    return { value: node.value, provenance };
  }
  if (Array.isArray(node)) {
    return { value: node.map((x, i) => resolveParams(x, `${at}[${i}]`, provenance).value), provenance };
  }
  if (node !== null && typeof node === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(node)) {
      if (k.startsWith('$')) continue;
      out[k] = resolveParams(v, at ? `${at}.${k}` : k, provenance).value;
    }
    return { value: out, provenance };
  }
  return { value: node, provenance };
}

/** 点区切りのパスで値を差し替えた複製を返す（ストレスケース・CLIの --set 用）。存在しないパスは誤りにする。 */
export function withOverrides(params, overrides = {}) {
  const copy = structuredClone(params);
  for (const [p, v] of Object.entries(overrides)) {
    const keys = p.split('.');
    let cur = copy;
    for (const k of keys.slice(0, -1)) {
      if (cur[k] === undefined || cur[k] === null || typeof cur[k] !== 'object') throw new Error(`上書きのパスがありません：${p}`);
      cur = cur[k];
    }
    const last = keys[keys.length - 1];
    if (!Object.hasOwn(cur, last)) throw new Error(`上書きのパスがありません：${p}`);
    cur[last] = v;
  }
  return copy;
}

const num = (x) => typeof x === 'number' && Number.isFinite(x);

/** 解決済みの params と選択（ストア手数料・事業者・テキストのモデル）から、model.mjs に渡す前提を組む。 */
export function buildAssumptions(params, sel) {
  const pick = (group, key) => {
    const v = params[group]?.[key];
    if (!v) throw new Error(`${group} に ${key} がありません`);
    return v;
  };
  return {
    fx: sel.fx ?? params.fx,
    tax: params.tax,
    storeFee: pick('storeFees', sel.storeFee),
    plans: params.plans,
    quota: params.quota,
    trial: params.trial,
    voiceProvider: pick('voiceProviders', sel.voiceProvider),
    textModel: pick('textModels', sel.textModel),
    textTokens: params.textTokens,
    metering: params.metering,
    costCapUsdPerMonth: params.costCapUsdPerMonth ?? Infinity,
    costReport: params.costReport ?? { basis: 'provider' },
    safetyFactor: params.safetyFactor,
    refundRate: params.refundRate,
    revenuecatRate: params.revenuecatRate,
    serverPerSubscriberMonth: params.serverPerSubscriberMonth,
    retention: params.retention,
  };
}

/** 形と値域の検査。問題の一覧を返す（空なら通る）。 */
export function validateScenario(sc) {
  const problems = [];
  if (!sc || typeof sc !== 'object') return ['シナリオがオブジェクトではありません'];
  if (!sc.app?.id) problems.push('app.id がありません');
  if (!sc.params) return [...problems, 'params がありません'];
  const { value: p, provenance } = resolveParams(sc.params);
  for (const e of provenance) {
    if (!STATUSES.includes(e.status)) problems.push(`${e.path}：status は ${STATUSES.join('/')} のどれか（今：${e.status}）`);
    if (!e.source) problems.push(`${e.path}：source（出所）がありません`);
  }
  const rate = (x, at) => { if (!num(x) || x < 0 || x > 1) problems.push(`${at} は0〜1の数`); };
  const pos = (x, at) => { if (!num(x) || x <= 0) problems.push(`${at} は正の数`); };
  const nonneg = (x, at) => { if (!num(x) || x < 0) problems.push(`${at} は0以上の数`); };
  pos(p.fx, 'fx');
  rate(p.tax?.rate, 'tax.rate');
  if (!['standard', 'no_input_credit', 'cash'].includes(p.tax?.mode)) problems.push('tax.mode は standard/no_input_credit/cash');
  for (const [k, f] of Object.entries(p.storeFees ?? {})) { rate(f.firstYear, `storeFees.${k}.firstYear`); rate(f.afterFirstYear, `storeFees.${k}.afterFirstYear`); }
  for (const k of ['monthly', 'annual']) {
    pos(p.plans?.[k]?.price, `plans.${k}.price`);
    if (![1, 12].includes(p.plans?.[k]?.periodMonths)) problems.push(`plans.${k}.periodMonths は1か12`);
  }
  for (const [k, v] of Object.entries(p.voiceProviders ?? {})) if (!['per_token', 'per_minute', 'flat'].includes(v.kind)) problems.push(`voiceProviders.${k}.kind が不正`);
  for (const [k, v] of Object.entries(p.textModels ?? {})) { nonneg(v.inputUsdPerMTok, `textModels.${k}.inputUsdPerMTok`); nonneg(v.outputUsdPerMTok, `textModels.${k}.outputUsdPerMTok`); }
  pos(p.metering?.avgSessionMinutes, 'metering.avgSessionMinutes');
  if (!(num(p.metering?.billedPerUserMinute) && p.metering.billedPerUserMinute >= 1)) problems.push('metering.billedPerUserMinute は1以上（枠より短く請求される仮定は置かない）');
  if (!(num(p.safetyFactor) && p.safetyFactor >= 1)) problems.push('safetyFactor は1以上');
  rate(p.refundRate, 'refundRate');
  rate(p.revenuecatRate, 'revenuecatRate');
  rate(p.retention?.monthlyChurn, 'retention.monthlyChurn');
  rate(p.retention?.annualRenewalRate, 'retention.annualRenewalRate');
  if (p.costCapUsdPerMonth != null) nonneg(p.costCapUsdPerMonth, 'costCapUsdPerMonth');
  if (p.costReport) {
    if (!['per_user_minute', 'provider'].includes(p.costReport.basis)) problems.push('costReport.basis は per_user_minute / provider');
    if (p.costReport.basis === 'per_user_minute') pos(p.costReport.reportedUsdPerUserMinute, 'costReport.reportedUsdPerUserMinute');
  }
  if (p.trial) { if (!num(p.trial.conversion) || p.trial.conversion <= 0 || p.trial.conversion > 1) problems.push('trial.conversion は0より大きく1以下'); rate(p.trial.usageShare, 'trial.usageShare'); }
  if (p.planMix) { const sum = (p.planMix.monthly ?? 0) + (p.planMix.annual ?? 0); if (Math.abs(sum - 1) > 1e-9) problems.push(`planMix の合計が1ではない（${sum}）`); }
  if (p.referral) {
    nonneg(p.referral.deductionPerCoveredMonth, 'referral.deductionPerCoveredMonth');
    if (p.referral.payoutMonths != null && !(Number.isInteger(p.referral.payoutMonths) && p.referral.payoutMonths > 0)) problems.push('referral.payoutMonths は正の整数か null（上限なし）');
  }
  for (const [k, u] of Object.entries(p.usageProfiles ?? {})) { nonneg(u.voiceMinutes, `usageProfiles.${k}.voiceMinutes`); nonneg(u.textRequests, `usageProfiles.${k}.textRequests`); }
  const sel = sc.selection ?? {};
  for (const [g, k] of [['storeFees', sel.storeFee], ['voiceProviders', sel.voiceProvider], ['textModels', sel.textModel]]) {
    if (!p[g]?.[k]) problems.push(`selection：${g} に ${k} がありません`);
  }
  const an = sc.analysis ?? {};
  for (const k of an.voiceProviders ?? []) if (!p.voiceProviders?.[k]) problems.push(`analysis.voiceProviders：${k} がありません`);
  for (const k of an.textModels ?? []) if (!p.textModels?.[k]) problems.push(`analysis.textModels：${k} がありません`);
  for (const k of an.storeFees ?? []) if (!p.storeFees?.[k]) problems.push(`analysis.storeFees：${k} がありません`);
  for (const [name, s] of Object.entries(an.stress ?? {})) {
    try { withOverrides(p, s.set ?? {}); } catch (e) { problems.push(`analysis.stress.${name}：${e.message}`); }
  }
  return problems;
}

export function loadScenario(file) {
  const abs = path.resolve(file);
  const sc = JSON.parse(fs.readFileSync(abs, 'utf8'));
  const problems = validateScenario(sc);
  if (problems.length) throw new Error(`シナリオの問題 ${problems.length}件：\n- ${problems.join('\n- ')}`);
  const { value: params, provenance } = resolveParams(sc.params);
  return { ...sc, _file: abs, params, provenance };
}
