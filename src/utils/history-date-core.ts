/**
 * 分析（`analytics.tsx`）・カレンダー（`calendar.tsx`）の「日付キー」と取得範囲の判定（純粋関数）。
 *
 * **react-native・nativeモジュール・値のimportを一切持たない自己完結モジュール。**
 * `node --test`から直接importして検証できる状態を保つ（`budget-core.ts`等と同じ規律）。
 *
 * ■ 日付キー（`YYYY-MM-DD`）の決め方（両画面で従来から同じ規則。ここへ移しただけで変えていない）
 *   - `entry_date`が入っていればそれをそのまま使う（`YYYY-MM-DD`）。
 *   - 無ければ`created_at`（SQLiteの`datetime('now')`＝UTC、`YYYY-MM-DD HH:MM:SS`）を**端末ローカル**の
 *     日付へ変換する。つまり同じ`created_at`でも端末のタイムゾーンで日付が前後1日ずれ得る。
 *
 * ■ なぜ取得範囲（`DateKeyRange`）が必要か（2026-09-18・既知不具合修正 候補C）
 *   旧実装は`useAllHistory()`が全旅行の履歴を`ORDER BY created_at DESC LIMIT 2000`で取得し、分析の
 *   合計・グラフ・旅行別・カテゴリー別と、カレンダーの日付マップ・月合計を**その2000件の配列**からJS側で
 *   集計していた。2001件目以降（`created_at`が古い側）は黙って落ち、分析の合計が不足し、カレンダーの
 *   古い月で記録が見えなくなる。しかも切り落としは`created_at`順・表示は`entry_date ?? created_at`のため、
 *   「後から日付を古い日に直した最近の記録は残るのに、古い記録は消える」という説明できない欠け方になる。
 *
 *   修正は「画面が実際に見る期間（分析：今日／月／年、カレンダー：表示月）の行だけをDBから取得する」。
 *   件数上限を撤廃しつつ、取得量は**期間内の件数**で決まり、生涯の総件数に比例して増えない。
 *
 * ■ SQL側の範囲条件（`createdAtBoundsForRange`）は**広め**に取り、正確な判定はJS側の`rowToDateKey`に任せる
 *   `created_at`はUTC、日付キーは端末ローカルなので、同じ日付キーになる`created_at`のUTC日付は
 *   キーの前後1日に収まる（オフセットは±14時間以内）。そこでSQLは`created_at`を「from−1日 ≦ … ＜ to+2日」
 *   で切り、画面側が従来どおり`rowToDateKey`で厳密に絞る。SQLでローカル日付を再現しない
 *   （SQLiteの`localtime`とJSの`Date`で日付境界の解釈が食い違う余地を作らない）ので、
 *   2000件窓の撤廃で日付の割り当てが1件も変わらない。`entry_date`は`YYYY-MM-DD`の文字列比較で厳密に絞れる。
 */

/** `YYYY-MM-DD` の閉区間 */
export interface DateKeyRange {
  from: string;
  to: string;
}

/** 分析画面の期間種別（`analytics.tsx`と同じ） */
export type AnalyticsPeriod = 'today' | 'month' | 'year';

/** 日付キーの判定に必要な列だけ（`HistoryRow`の部分型） */
export interface DateKeySource {
  entry_date: string | null;
  created_at: string;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/** 端末ローカルの`Date`→`YYYY-MM-DD` */
export function toDateKey(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** 履歴行の表示日付キー。`entry_date`優先、無ければ`created_at`（UTC）を端末ローカル日付へ */
export function rowToDateKey(row: DateKeySource): string {
  if (row.entry_date) return row.entry_date;
  const iso = row.created_at.includes('T') ? row.created_at : `${row.created_at.replace(' ', 'T')}Z`;
  return toDateKey(new Date(iso));
}

/** `month`は1〜12 */
export function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

/** `month`は1〜12。その月の1日〜末日 */
export function monthDateKeyRange(year: number, month: number): DateKeyRange {
  return {
    from: `${year}-${pad2(month)}-01`,
    to: `${year}-${pad2(month)}-${pad2(daysInMonth(year, month))}`,
  };
}

export function yearDateKeyRange(year: number): DateKeyRange {
  return { from: `${year}-01-01`, to: `${year}-12-31` };
}

/** 分析画面が集計に使う期間。`matchesPeriod`が真になり得る日付キーを全て含む */
export function dateKeyRangeForPeriod(
  period: AnalyticsPeriod,
  anchorYear: number,
  anchorMonth: number,
  todayKey: string,
): DateKeyRange {
  if (period === 'today') return { from: todayKey, to: todayKey };
  if (period === 'year') return yearDateKeyRange(anchorYear);
  return monthDateKeyRange(anchorYear, anchorMonth);
}

/** 分析画面の期間判定（従来`analytics.tsx`内にあったものをそのまま移動） */
export function matchesPeriod(
  dateKey: string,
  period: AnalyticsPeriod,
  anchorYear: number,
  anchorMonth: number,
  todayKey: string,
): boolean {
  if (period === 'today') return dateKey === todayKey;
  const [ry, rm] = dateKey.split('-').map(Number);
  if (period === 'year') return ry === anchorYear;
  return ry === anchorYear && rm === anchorMonth;
}

export function isDateKeyInRange(dateKey: string, range: DateKeyRange): boolean {
  return dateKey >= range.from && dateKey <= range.to;
}

/** 日付キーを`days`日ずらす（ローカル日付の加減算。DSTの影響を受けないよう正午基準で計算） */
export function shiftDateKey(dateKey: string, days: number): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  return toDateKey(new Date(y, m - 1, d + days, 12));
}

/**
 * SQLの`created_at`（UTC文字列）に掛ける広めの範囲。
 * `created_at >= from AND created_at < toExclusive` の文字列比較で使う
 * （`YYYY-MM-DD`は`YYYY-MM-DD HH:MM:SS`・`YYYY-MM-DDTHH:MM:SS.sssZ`のどちらの接頭辞にもなる）。
 * 詳細はファイル先頭の「SQL側の範囲条件」。
 */
export function createdAtBoundsForRange(range: DateKeyRange): { from: string; toExclusive: string } {
  return { from: shiftDateKey(range.from, -1), toExclusive: shiftDateKey(range.to, 2) };
}

/**
 * `getHistoryInDateKeyRange`のWHERE句（bind順：entryFrom, entryTo, createdFrom, createdToExclusive）。
 * `entry_date`の空文字は`rowToDateKey`と同じく「無し」扱い。
 */
export const HISTORY_DATE_KEY_RANGE_WHERE_SQL = `
  (COALESCE(entry_date, '') <> '' AND entry_date >= ? AND entry_date <= ?)
  OR (COALESCE(entry_date, '') = '' AND created_at >= ? AND created_at < ?)`;

/** `HISTORY_DATE_KEY_RANGE_WHERE_SQL`へ渡すbind値 */
export function historyDateKeyRangeParams(range: DateKeyRange): [string, string, string, string] {
  const bounds = createdAtBoundsForRange(range);
  return [range.from, range.to, bounds.from, bounds.toExclusive];
}
