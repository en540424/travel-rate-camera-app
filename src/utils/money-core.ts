/**
 * 通貨のコア（GX-04・2026-11-28）。基準通貨（利用者が金額を確かめたい通貨）と現地通貨（値札の通貨）を
 * 円に固定せずに扱う純粋関数。**為替 API は使わない**（レートは手入力が正本・オフラインで動く）。
 *
 * ■ 用語
 *   - 現地通貨 L：旅行の `base_currency`（OCR・値札の通貨）
 *   - 基準通貨 H：旅行の `target_currency`（換算先。既存の旅行はすべて 'JPY'）
 *   - レート r：「1 L あたりの H」（既存の `manual_rate`＝1現地通貨あたりの円 と同じ意味を H へ広げたもの）
 *   - 国内：L と H が同じ（換算しない）。既存の「JPY の旅行＝国内モード」は H='JPY' の時のこの判定と同じ
 *
 * ■ 丸め（既存の規則を H へ広げる）
 *   - 1件の額は H の桁（JPY・KRW・TWD は0桁、他は2桁）で四捨五入する（既存の `toRecordJpy`＝`Math.round` と同じ）
 *   - 合計は**1件ずつ丸めてから最小単位の整数で足す**（既存の「一覧の各額を足した値＝合計」の不変条件を小数の通貨でも守る）
 *   - 換算した値そのもの（保存する `jpy_amount` 相当）は丸めない（既存の `toJpy` と同じ）
 *
 * ■ 書式
 *   既存の表示と同じ形：記号＋3桁区切り（`formatJpy` は `¥` と 'ja-JP'、`formatForeign` は記号と 'en-US'）。
 *   ja・en・ko・zh-TW の3桁区切りはどれも `,` なので、表示言語で記号の位置や形を変えない（`US$` 等に揺れない）。
 */
import { CURRENCIES, type CurrencyCode } from '@/constants/currencies';

export function decimalsOf(code: CurrencyCode): number {
  return CURRENCIES[code].decimals;
}

function factor(code: CurrencyCode): number {
  return 10 ** decimalsOf(code);
}

/**
 * 最短の10進表記（`String(x)`）を d 桁で四捨五入した
 * 最小単位の整数。0.5 は 0 から遠い向き（ECMA-402 の既定の `halfExpand`）。
 * - 正の値で d=0 の時は `Math.round(x)` と必ず同じ（k+0.5 は浮動小数で正確に表せ、最短表記はその同じ側にある）
 *   → 円の `toRecordJpy`・SQL `ROUND(jpy_amount)`・`formatJpy` と同じ（61.49999999999999 → 61）
 * - d=2 では V8 の `toLocaleString(…, { maximumFractionDigits: 2 })` と同じ規則（1.005 → 1.01、0.004999999999999999 → 0.00）。
 *   既存の `formatForeign` と同じ表示になることは Node（V8）で確かめた。iPhone（Hermes）の `toLocaleString` の丸めは未確認
 *   （TEST_CHECKLIST の多言語・多通貨の節）。この関数は丸めた後の値を書式へ渡すので、実行環境の丸めに左右されない
 * - 正確なのは額が 2^53/10^d 未満（d=2 で約 90兆）まで。それを超える額・1e21 以上は近似（金額としては出ない）
 * - 負の値は符号を外して丸める（-0.5 → -1）。既存の円は `Math.round`（-0.5 → 0）だが、負の額は保存・表示されない
 *   （保存は 0 より大きい額だけ・残り予算は 0 で止める）。返金・値引きを扱う時に決め直す
 */
function decimalRoundToMinor(x: number, d: number): number {
  const abs = Math.abs(x);
  let minor: number;
  const str = String(abs);
  if (/e/i.test(str)) {
    // 1e21 以上か 1e-7 未満。極小は 0、極大は通常の掛け算（金額としては出ない範囲）
    minor = abs < 1 ? 0 : Math.round(abs * 10 ** d);
  } else {
    const [intPart, fracPart = ''] = str.split('.');
    const kept = (fracPart + '0'.repeat(d)).slice(0, d);
    const next = fracPart.charCodeAt(d) - 48;
    minor = Number(intPart + kept) + (next >= 5 ? 1 : 0);
  }
  return (x < 0 ? -minor : minor) + 0;
}

/** 金額を最小単位の整数へ（JPY 1980 → 1980、USD 12.345 → 1235）。有限でない値・表せない大きさは0 */
export function toMinorUnits(amount: number, code: CurrencyCode): number {
  if (!Number.isFinite(amount)) return 0;
  const minor = decimalRoundToMinor(amount, decimalsOf(code));
  return Number.isFinite(minor) ? minor : 0;
}

export function fromMinorUnits(minor: number, code: CurrencyCode): number {
  return minor / factor(code);
}

/** 1件の額を通貨の桁で丸める（H が JPY なら既存の `toRecordJpy` と同じ値） */
export function roundMoney(amount: number, code: CurrencyCode): number {
  return fromMinorUnits(toMinorUnits(amount, code), code);
}

/** 合計：1件ずつ丸めて最小単位で足す（同じ通貨の額だけを渡すこと。混ざった通貨は `sumByCurrency`） */
export function sumMoney(amounts: readonly number[], code: CurrencyCode): number {
  let minor = 0;
  for (const a of amounts) minor += toMinorUnits(a, code);
  return fromMinorUnits(minor, code);
}

/** 通貨ごとに分けた合計（異なる通貨の額をそのまま足さない）。出てきた順に並べる */
export function sumByCurrency(
  entries: readonly { amount: number; currency: CurrencyCode }[],
): { currency: CurrencyCode; total: number }[] {
  const minor = new Map<CurrencyCode, number>();
  for (const e of entries) minor.set(e.currency, (minor.get(e.currency) ?? 0) + toMinorUnits(e.amount, e.currency));
  return [...minor].map(([currency, m]) => ({ currency, total: fromMinorUnits(m, currency) }));
}

/** 国内か（現地通貨と基準通貨が同じ＝換算しない） */
export function isDomestic(local: CurrencyCode, home: CurrencyCode): boolean {
  return local === home;
}

export function isValidRate(rate: number): boolean {
  return Number.isFinite(rate) && rate > 0;
}

/** 現地通貨の額 → 基準通貨の額（丸めない。既存の `toJpy` と同じ）。レートが不正なら0 */
export function localToHome(localAmount: number, rate: number): number {
  return isValidRate(rate) ? localAmount * rate : 0;
}

/** 基準通貨の額 → 現地通貨の額（逆換算。丸めない。既存の `fromJpy` と同じ）。レートが不正なら0 */
export function homeToLocal(homeAmount: number, rate: number): number {
  return isValidRate(rate) ? homeAmount / rate : 0;
}

/** 逆向きのレート（1 H あたりの L）。不正なら0 */
export function invertRate(rate: number): number {
  if (!isValidRate(rate)) return 0;
  const inv = 1 / rate;
  return isValidRate(inv) ? inv : 0;
}

/**
 * 円を軸にしたレートの表（既存の `exchange_rates`＝1単位あたりの円）から「1 L あたりの H」を作る。
 * 円の値は1として扱う。どちらかが不正なら0（呼び出し側で「レート未設定」）。
 * 注意：この表は円を基準通貨にする利用者のための値なので、基準通貨が円以外の時に予備のレートとして使うかは
 * 呼び出し側で決める（GX-05）。ここは計算だけ。
 */
export function crossRateFromJpyTable(
  local: CurrencyCode,
  home: CurrencyCode,
  jpyPerUnit: Partial<Record<CurrencyCode, number>>,
): number {
  if (local === home) return 1;
  const l = local === 'JPY' ? 1 : (jpyPerUnit[local] ?? 0);
  const h = home === 'JPY' ? 1 : (jpyPerUnit[home] ?? 0);
  if (!isValidRate(l) || !isValidRate(h)) return 0;
  const r = l / h;
  return isValidRate(r) ? r : 0;
}

/** 3桁区切りのロケール（ja・en・ko・zh-TW のどれも `,` なので1つに固定する） */
const GROUPING_LOCALE = 'en-US';

/**
 * 金額の表示（記号＋3桁区切り・通貨の桁）。
 * - JPY は既存の `formatJpy` と同じ（`¥1,980`・四捨五入）
 * - 他は既存の `formatForeign` と同じ（`$12.99`・`₩15,000`・`NT$120`）
 * - 負の値は `-¥100`
 */
export function formatMoney(amount: number, code: CurrencyCode): string {
  const c = CURRENCIES[code];
  const value = roundMoney(Number.isFinite(amount) ? amount : 0, code);
  const abs = Math.abs(value).toLocaleString(GROUPING_LOCALE, {
    minimumFractionDigits: c.decimals,
    maximumFractionDigits: c.decimals,
  });
  return `${value < 0 ? '-' : ''}${c.symbol}${abs}`;
}

/**
 * レートの数値の表示（記号なし）。小さいレートでも0にしない：
 * - 100以上：小数2桁まで（1,370.25）
 * - 1以上100未満：小数4桁まで（4.8・152.5）
 * - 1未満：有効数字4桁（0.006667・0.0007299）
 * 末尾の0は出さない。丸めは自前（`decimalRoundToMinor`・`toPrecision`＝ECMAScript の仕様どおり）で行い、
 * 3桁区切りだけを `toLocaleString` に任せる（実行環境の丸めの違いに左右されない）。
 * 1e-6 未満・1e12 以上のレートは '0'（人が入れる値ではない）。
 */
export function formatRateNumber(rate: number): string {
  if (!isValidRate(rate) || rate < 1e-6 || rate >= 1e12) return '0';
  if (rate < 1) {
    const rounded = Number(rate.toPrecision(4));
    return rounded >= 1 ? '1' : rounded.toFixed(Math.max(0, 3 - Math.floor(Math.log10(rounded)))).replace(/\.?0+$/, '');
  }
  const d = rate >= 100 ? 2 : 4;
  const rounded = decimalRoundToMinor(rate, d) / 10 ** d;
  const frac = rounded.toFixed(d).split('.')[1].replace(/0+$/, '');
  const int = Math.trunc(rounded).toLocaleString(GROUPING_LOCALE);
  return frac ? `${int}.${frac}` : int;
}

/**
 * レートの説明。
 * - `direction: 'readable'`（既定）：数が1以上になる向き（1 USD = 1,370 KRW・1 USD = 150 JPY）
 * - `direction: 'local_first'`：入力した向きのまま「1 L = r H」（KRW→JPY 0.11 は `1 KRW = 0.11 JPY`）
 * 基準通貨が円の旅行の既存の表示（`formatRate`：`1 USD = ¥152.50`）は置き換えない。円以外の基準通貨で使う。
 * 数は表示用に丸める（`formatRateNumber`）ので、編集欄の初期値には使わない（保存値は `manual_rate` のまま）。
 */
export function describeRate(
  local: CurrencyCode,
  home: CurrencyCode,
  rate: number,
  direction: 'readable' | 'local_first' = 'readable',
): { from: CurrencyCode; to: CurrencyCode; value: number; text: string } | null {
  if (!isValidRate(rate) || local === home) return null;
  const forward = direction === 'local_first' || rate >= 1;
  const from = forward ? local : home;
  const to = forward ? home : local;
  const value = forward ? rate : invertRate(rate);
  if (!isValidRate(value)) return null;
  const shown = formatRateNumber(value);
  if (shown === '0') return null; // 極端なレート（local_first で極小になる時を含む）は説明しない
  return { from, to, value, text: `1 ${from} = ${shown} ${to}` };
}

/**
 * 人が入れた向きのレートを「1 L あたりの H」へ直す。
 * `inputDirection` が 'home_per_local'（1 L = x H）ならそのまま、'local_per_home'（1 H = x L）なら逆数。
 */
export function normalizeRateInput(value: number, inputDirection: 'home_per_local' | 'local_per_home'): number {
  if (!isValidRate(value)) return 0;
  return inputDirection === 'home_per_local' ? value : invertRate(value);
}
