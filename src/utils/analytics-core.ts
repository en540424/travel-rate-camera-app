/**
 * 分析画面（`analytics.tsx`）の集計・グラフ表示用の純粋関数。
 *
 * **react-native・nativeモジュール・`@/`エイリアス・相対の値importを一切持たない自己完結モジュール。**
 * `node --test`から直接importして検証できる状態を保つ（`history-date-core.ts`・`categories.ts`と同じ規律）。
 *
 * ■ 集計の意味は従来の`analytics.tsx`内のuseMemoと同じ（2026-10-20・分析画面再設計で移しただけ）
 *   - 期間の判定は呼び出し側から`isInPeriod`（＝`matchesPeriod(dateKey, ...)`）を受け取る
 *   - 保存件数・候補合計は期間内の全件、購入済み合計・棒グラフ・カテゴリー別は**期間内の購入済みだけ**
 *   - 金額は`jpy_amount`の生値を足す（丸めは表示時の`formatJpy`だけ。外貨記録は小数を持ち得る）
 *   旧実装は棒1本ごとに全件を走査し（月表示で31×件数）、そのたびに日付キーを作り直していた。
 *   ここでは日付キーを呼び出し側で1回だけ作り、1回の走査で合計・棒・カテゴリー入力をまとめて出す。
 *
 * ■ 「購入済み合計＝棒グラフの合計＝カテゴリー別の合計」が常に成り立つ
 *   3つとも同じ走査の同じ条件（期間内かつ購入済み）で足しているため。テストで固定している。
 */

/** 1件の記録（`HistoryRow`から分析に要る列だけを取り出したもの） */
export interface SpendEntry {
  /** `rowToDateKey(row)`の結果（`YYYY-MM-DD`） */
  dateKey: string;
  isPurchased: boolean;
  /** 円換算済み金額（`HistoryRow.jpy_amount`） */
  jpyAmount: number;
  /** `HistoryRow.category`の生値（未設定・未知の値の扱いは`aggregateByCategory`に任せる） */
  category: string | null;
}

/** 棒グラフ1本 */
export interface SpendBucket {
  /** 年表示は`m1`〜`m12`、月表示は`d1`〜`d31` */
  key: string;
  /** 年表示は月（1〜12）、月表示は日（1〜31） */
  index: number;
  /** その期間の購入済み合計（円・生値） */
  amount: number;
  /** 月表示のみ：曜日（0=日〜6=土） */
  weekday?: number;
}

export type SpendChartKind = 'year' | 'month' | 'none';

export interface PeriodSpendSummary {
  /** 期間内の購入済み合計（円・生値） */
  purchasedTotal: number;
  /** 期間内の候補合計（円・生値） */
  candidateTotal: number;
  /** 期間内の保存件数（候補＋購入済み） */
  totalCount: number;
  /** 期間内の購入済み件数 */
  purchasedCount: number;
  /** 棒グラフ。`chartKind === 'none'`（今日表示）は空配列 */
  buckets: SpendBucket[];
  /** カテゴリー別集計（`aggregateByCategory`）へそのまま渡す入力。期間内の購入済みだけ */
  categoryInputs: { category: string | null; jpyAmount: number }[];
}

/** `month`は1〜12 */
function daysInMonthOf(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

/**
 * 期間内の記録を1回の走査で集計する。
 * `chartYear`／`chartMonth`は棒グラフの対象（年表示は`chartMonth`を使わない）。
 */
export function summarizePeriodSpending(
  entries: readonly SpendEntry[],
  isInPeriod: (dateKey: string) => boolean,
  chartKind: SpendChartKind,
  chartYear: number,
  chartMonth: number,
): PeriodSpendSummary {
  let buckets: SpendBucket[] = [];
  if (chartKind === 'year') {
    buckets = Array.from({ length: 12 }, (_, i) => ({ key: `m${i + 1}`, index: i + 1, amount: 0 }));
  } else if (chartKind === 'month') {
    const days = daysInMonthOf(chartYear, chartMonth);
    buckets = Array.from({ length: days }, (_, i) => ({
      key: `d${i + 1}`,
      index: i + 1,
      amount: 0,
      weekday: new Date(chartYear, chartMonth - 1, i + 1).getDay(),
    }));
  }

  let purchasedTotal = 0;
  let candidateTotal = 0;
  let totalCount = 0;
  let purchasedCount = 0;
  const categoryInputs: { category: string | null; jpyAmount: number }[] = [];

  for (const entry of entries) {
    if (!isInPeriod(entry.dateKey)) continue;
    totalCount++;
    if (!entry.isPurchased) {
      candidateTotal += entry.jpyAmount;
      continue;
    }
    purchasedTotal += entry.jpyAmount;
    purchasedCount++;
    categoryInputs.push({ category: entry.category, jpyAmount: entry.jpyAmount });

    if (chartKind === 'none') continue;
    const [y, m, d] = entry.dateKey.split('-').map(Number);
    if (y !== chartYear) continue;
    if (chartKind === 'year') {
      const bucket = buckets[m - 1];
      if (bucket) bucket.amount += entry.jpyAmount;
    } else if (m === chartMonth) {
      const bucket = buckets[d - 1];
      if (bucket) bucket.amount += entry.jpyAmount;
    }
  }

  return { purchasedTotal, candidateTotal, totalCount, purchasedCount, buckets, categoryInputs };
}

/** 金額が最も大きい棒（同額は先に来た方）。全て0以下ならnull */
export function findPeakBucket(buckets: readonly SpendBucket[]): SpendBucket | null {
  let peak: SpendBucket | null = null;
  for (const bucket of buckets) {
    if (bucket.amount > 0 && (peak === null || bucket.amount > peak.amount)) peak = bucket;
  }
  return peak;
}

/**
 * 縦軸の上端に使う「きりのいい金額」。`max`以上で、1・1.5・2・3・4・5・6・8×10^nのうち最小のもの
 * （刻みを細かくして、いちばん高い棒の上に大きな空きができないようにする）。
 * 2.5は使わない：半分の目盛りが1.25×10^nになり、短い表記（「¥1.3万」等）で不正確になるため。
 * 例：4,719→5,000／12,760→15,000／21,000→30,000／32,400→40,000／84,320→100,000。0以下・非数は0。
 */
export function niceAxisMax(max: number): number {
  if (!Number.isFinite(max) || max <= 0) return 0;
  const exponent = Math.floor(Math.log10(max));
  const base = 10 ** exponent;
  for (const step of [1, 1.5, 2, 3, 4, 5, 6, 8, 10]) {
    const candidate = step * base;
    // 浮動小数の誤差（例：0.1+0.2）で1段上へ飛ばないよう、ごく小さい許容差で比べる
    if (candidate >= max - base * 1e-9) return candidate;
  }
  return 10 * base;
}

/**
 * 縦棒の高さ（px）。0円は0（描かない）。0円より大きければ`minPx`以上にして、
 * 大きい金額と混在しても「記録がある」ことが見えるようにする。
 */
export function barHeightPx(amount: number, axisMax: number, chartHeight: number, minPx = 4): number {
  if (!(amount > 0) || !(axisMax > 0)) return 0;
  const raw = Math.round((amount / axisMax) * chartHeight);
  return Math.min(chartHeight, Math.max(minPx, raw));
}

function withThousandsSeparator(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** 1桁小数まで。末尾の`.0`は付けない（2.5→"2.5"、12→"12"） */
function trimOneDecimal(n: number): string {
  const rounded = Math.round(n * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

type YenUnit = 'yen' | 'man' | 'oku';

function formatYenIn(amount: number, unit: YenUnit): string {
  if (!Number.isFinite(amount) || amount <= 0) return '¥0';
  if (unit === 'oku') return `¥${trimOneDecimal(amount / 100_000_000)}億`;
  if (unit === 'man') return `¥${trimOneDecimal(amount / 10_000)}万`;
  // 1円未満の端数は通常出ないが、10円未満の端数（例 ¥1.5）は整数に丸めずに出す
  if (!Number.isInteger(amount) && amount < 10) return `¥${trimOneDecimal(amount)}`;
  return `¥${withThousandsSeparator(Math.round(amount))}`;
}

/**
 * 短い円表記。1万未満はそのまま（¥5,000）、1万以上は「万」、1億以上は「億」。
 * 例：0→"¥0"、2500→"¥2,500"、20000→"¥2万"、25000→"¥2.5万"、150000000→"¥1.5億"
 */
export function formatCompactYen(amount: number): string {
  return formatYenIn(amount, amount >= 100_000_000 ? 'oku' : amount >= 10_000 ? 'man' : 'yen');
}

/** 縦軸の目盛りを桁区切りの円で出す上限（上端がこれ未満なら「¥40,000」、以上なら「¥15万」） */
const AXIS_FULL_YEN_LIMIT = 100_000;

/**
 * 縦軸の目盛り1つ分の表記。`formatYenIn`と違い、万・億の数字にも桁区切りを付け（「¥8,000万」）、
 * 1円未満の端数は有効数字3桁まで出す（`niceAxisMax`の刻みの半分は有効数字2桁以内なので丸めにならない）。
 */
function formatAxisValue(amount: number, unit: YenUnit): string {
  if (!Number.isFinite(amount) || amount <= 0) return '¥0';
  if (unit === 'oku' || unit === 'man') {
    const scaled = amount / (unit === 'oku' ? 100_000_000 : 10_000);
    const rounded = Math.round(scaled * 10) / 10;
    const [int, frac] = String(rounded).split('.');
    return `¥${withThousandsSeparator(Number(int))}${frac ? `.${frac}` : ''}${unit === 'oku' ? '億' : '万'}`;
  }
  if (amount < 10 && !Number.isInteger(amount)) return `¥${Number(amount.toPrecision(3))}`;
  return `¥${withThousandsSeparator(Math.round(amount))}`;
}

/**
 * 縦軸の目盛り（上端・半分・0）の表記。**同じ軸の3つは同じ単位にそろえる**
 * （「¥4万」と「¥20,000」のように万表記と桁区切りが混ざらないようにする）。
 * - 上端が10万円未満：桁区切りの円（読み取り欄の金額「¥33,120」と同じ書き方）。例：40,000→"¥40,000"/"¥20,000"/"¥0"
 * - 上端が10万円以上：「万」。例：150,000→"¥15万"/"¥7.5万"/"¥0"、1,000,000→"¥100万"/"¥50万"/"¥0"
 * - 半分が1億円以上：「億」。例：300,000,000→"¥3億"/"¥1.5億"/"¥0"
 * `niceAxisMax`の刻みなら、上端・半分とも丸めずに正確な値を表せる。上端が0（棒がない）なら3つとも"¥0"。
 */
export function formatAxisLabels(axisMax: number): { top: string; half: string; zero: string } {
  const top = Number.isFinite(axisMax) && axisMax > 0 ? axisMax : 0;
  const half = top / 2;
  const unit: YenUnit = half >= 100_000_000 ? 'oku' : top >= AXIS_FULL_YEN_LIMIT ? 'man' : 'yen';
  return { top: formatAxisValue(top, unit), half: formatAxisValue(half, unit), zero: '¥0' };
}

/**
 * 構成比の表示用の整数%。最大剰余法で丸め、合計がちょうど100になるようにする
 * （四捨五入だけだと33+33+33=99%のように合計がずれて見えるため）。
 * 剰余が同じ場合は配列の前（＝金額の大きい側。呼び出し側で降順に並べてある）を優先する。
 * 合計が0以下なら全て0。負・非数の金額は0として扱う。
 */
export function toDisplayPercents(amounts: readonly number[]): number[] {
  const values = amounts.map((a) => (Number.isFinite(a) && a > 0 ? a : 0));
  const total = values.reduce((sum, v) => sum + v, 0);
  if (total <= 0) return values.map(() => 0);

  const exact = values.map((v) => (v / total) * 100);
  const floors = exact.map((e) => Math.floor(e));
  let remaining = 100 - floors.reduce((sum, f) => sum + f, 0);

  const order = exact
    .map((e, i) => ({ i, remainder: e - floors[i] }))
    .sort((a, b) => (b.remainder !== a.remainder ? b.remainder - a.remainder : a.i - b.i));
  for (const { i } of order) {
    if (remaining <= 0) break;
    floors[i] += 1;
    remaining -= 1;
  }
  return floors;
}

/**
 * 構成比のラベル。0%に丸まっても金額があれば「<1%」、他に金額のある行があるのに
 * 100%に丸まった場合は「>99%」にして、「0円ではないのに0%」「他もあるのに100%」と見えないようにする。
 */
export function buildShareLabels(amounts: readonly number[]): string[] {
  const percents = toDisplayPercents(amounts);
  const positiveCount = amounts.filter((a) => Number.isFinite(a) && a > 0).length;
  return percents.map((pct, i) => {
    const amount = amounts[i];
    const hasAmount = Number.isFinite(amount) && amount > 0;
    if (hasAmount && pct === 0) return '<1%';
    if (pct === 100 && positiveCount > 1) return '>99%';
    return `${pct}%`;
  });
}
