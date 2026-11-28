/**
 * 記録・旅行の基準通貨と国内の判定（GX-06 段階 a〈読み出し〉・段階 b〈表示側の国内の判定〉・2026-11-28）。
 * 設計書 `design/gx05-home-currency-design.md` §3・§11 C1・C3・§12-2 S2・§13。
 *
 * - 記録の基準通貨＝その記録の旅行の `trips.target_currency`。旅行が無い（`trip_id` が NULL・旅行が見つからない）記録は 'JPY'
 * - 列は TEXT で CHECK 制約が無いので、7通貨に無い値（空文字・小文字・未知の通貨）も 'JPY' として読む（C3）
 * - `home_currency` は**読み出し専用の列**。DB・localStorage へは書かない（Web は保存の前に `stripHomeCurrency` で落とす）
 *
 * 既存の旅行はすべて `target_currency = 'JPY'`（書く経路がまだ無い）なので、今の利用者の記録はすべて 'JPY' と読まれる。
 */
import { CURRENCIES, type CurrencyCode } from '@/constants/currencies';
import {
  budgetTotalsByTripFromGroupRows,
  sumBudgetTotals,
  sumBudgetTotalsInMinorUnits,
  type BudgetInputRow,
  type BudgetTotals,
  type MinorUnits,
} from '@/utils/budget-core';
import type { EditHomeContext } from '@/utils/edit-amount-core';
import { decimalsOf, fromMinorUnits, isDomestic, roundMoney, toMinorUnits } from '@/utils/money-core';

/** 7通貨のどれかならその値、それ以外（null・undefined・空文字・小文字・未知の通貨・文字列以外）は 'JPY' */
export function normalizeHomeCurrency(value: unknown): CurrencyCode {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(CURRENCIES, value)
    ? (value as CurrencyCode)
    : 'JPY';
}

/** 行に基準通貨を付ける（既に `home_currency` があれば正規化して上書き。列の並びは変えない） */
export function withHomeCurrency<T extends object>(
  row: T,
  home: unknown,
): Omit<T, 'home_currency'> & { home_currency: CurrencyCode } {
  return { ...row, home_currency: normalizeHomeCurrency(home) };
}

/**
 * Web 版：旅行の一覧から各記録の基準通貨を引いて付ける。
 * 記録の行と同じ同期処理の中で読んだ旅行を渡すこと（React の state や store の `activeTrip` は使わない：
 * 初期値が空の間に 'JPY' と誤読するため。設計書 §11 C1 で `tripMap` 方式を使わない理由と同じ）
 */
export function attachHomeCurrencyFromTrips<T extends { trip_id: number | null }>(
  rows: readonly T[],
  trips: readonly { id: number; target_currency: unknown }[],
): (Omit<T, 'home_currency'> & { home_currency: CurrencyCode })[] {
  const homeById = new Map<number, unknown>();
  for (const t of trips) homeById.set(t.id, t.target_currency);
  return rows.map((r) => withHomeCurrency(r, r.trip_id == null ? undefined : homeById.get(r.trip_id)));
}

/** Web 版：localStorage の旅行（`travelrate:trips` の JSON）から id と基準通貨だけを読む。壊れていれば空 */
export function tripHomesFromJson(raw: string | null): { id: number; target_currency: unknown }[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((t: { id?: number; target_currency?: unknown } | null) => ({
      id: t?.id ?? 0,
      target_currency: t?.target_currency ?? 'JPY',
    }));
  } catch {
    return [];
  }
}

/** 保存の前に読み出し専用の列を落とす（型だけでは余分なキーを止められないので実行時に落とす） */
export function stripHomeCurrency<T extends object>(row: T): Omit<T, 'home_currency'> {
  const { home_currency: _readOnly, ...rest } = row as T & { home_currency?: unknown };
  return rest;
}

/** 旅行の基準通貨（`target_currency` を正規化した値） */
export function tripHomeCurrency(trip: { target_currency: unknown }): CurrencyCode {
  return normalizeHomeCurrency(trip.target_currency);
}

/**
 * 旅行が国内か（現地通貨＝基準通貨。換算しない）。旅行が無い時は false（設計書 §12-2 S2）。
 * 基準通貨が円の旅行（既存の旅行はすべて）では、今の `trip.base_currency === 'JPY'` と同じ値（GX-06 段階 b）
 */
export function isDomesticTrip(
  trip: { base_currency: CurrencyCode; target_currency: unknown } | null | undefined,
): boolean {
  return trip != null && isDomestic(trip.base_currency, tripHomeCurrency(trip));
}

/**
 * 記録が国内か（記録の通貨＝記録の基準通貨）。記録の基準通貨は読み出し時に付いた `home_currency`（§11 C1）。
 * 基準通貨が円の記録（既存の記録はすべて）では、今の `record.currency === 'JPY'` と同じ値
 */
export function isDomesticRecord(record: { currency: CurrencyCode; home_currency: unknown }): boolean {
  return isDomestic(record.currency, normalizeHomeCurrency(record.home_currency));
}

/**
 * 記録の編集（`edit-amount-core.ts`）に渡す基準通貨と丸め（GX-06 段階 c）。`edit-amount-core` は値の import を
 * 持たない（S8）ので、丸めはここで `roundMoney` を注入する。基準通貨が円の記録では `edit-amount-core` が今の規則の
 * 分岐を通るので、丸め関数は使われない。記録の通貨が7通貨に無い（壊れた値）時は、記録の通貨の丸めをしない
 */
export function editHomeContextFor(record: { currency: string; home_currency: unknown }): EditHomeContext {
  const home = normalizeHomeCurrency(record.home_currency);
  const local = record.currency;
  const localKnown = Object.prototype.hasOwnProperty.call(CURRENCIES, local);
  return {
    homeCurrency: home,
    roundHome: (amount) => roundMoney(amount, home),
    roundLocal: (amount) => (localKnown ? roundMoney(amount, local as CurrencyCode) : amount),
  };
}

/* ───────────── 旅行ごとの合計（GX-06 段階 c-2・設計書 §12-2 S7） ─────────────
 * 基準通貨が0桁（JPY・KRW・TWD・7通貨に無い値＝JPY と読む値）の旅行は、今の SQL `SUM(ROUND(jpy_amount))`・
 * `sumBudgetTotals` をそのまま使う（同じ値を構造で保証する）。**小数の基準通貨（USD・EUR・GBP・THB）の旅行だけ**、
 * 行を読み直して最小単位の整数で足した合計に置き換える。1つの合計に違う基準通貨の旅行を混ぜない（旅行ごとに出す）。
 */

/** 基準通貨が小数の通貨ならその通貨、0桁か7通貨に無い値（＝JPY と読む）なら null。判定は `normalizeHomeCurrency` を通す */
export function fractionalHomeCurrency(value: unknown): CurrencyCode | null {
  const home = normalizeHomeCurrency(value);
  return decimalsOf(home) > 0 ? home : null;
}

/** `budget-core` に注入する最小単位の変換（`money-core` の `toMinorUnits`・`fromMinorUnits`） */
export function minorUnitsFor(home: CurrencyCode): MinorUnits {
  return {
    toMinor: (amount) => toMinorUnits(amount, home),
    fromMinor: (minor) => fromMinorUnits(minor, home),
  };
}

/** 残り予算の計算（`computeBudgetStatsFromTotals` の `units`）に渡す値。0桁の基準通貨なら undefined＝今の式 */
export function budgetUnitsForHome(value: unknown): MinorUnits | undefined {
  const frac = fractionalHomeCurrency(value);
  return frac ? minorUnitsFor(frac) : undefined;
}

/** 1つの旅行の記録の合計。0桁の基準通貨は今の `sumBudgetTotals` を1文字も変えずに通す */
export function budgetTotalsForHome(rows: readonly BudgetInputRow[], home: unknown): BudgetTotals {
  const frac = fractionalHomeCurrency(home);
  return frac ? sumBudgetTotalsInMinorUnits(rows, minorUnitsFor(frac)) : sumBudgetTotals(rows);
}

/** 旅行の一覧（id と基準通貨）から、その旅行の基準通貨を引く。見つからない・旅行なしは 'JPY'（§11 C1 と同じ） */
export function homeCurrencyOfTrip(
  tripId: number | null | undefined,
  trips: readonly { id: number; target_currency: unknown }[],
): CurrencyCode {
  if (tripId == null) return 'JPY';
  // 同じ id が重なった壊れた一覧では後の旅行を使う（`attachHomeCurrencyFromTrips` の Map と同じ向き）
  let home: unknown;
  for (const t of trips) if (t.id === tripId) home = t.target_currency;
  return normalizeHomeCurrency(home);
}

/**
 * Web 版：記録の全行から旅行ごとの合計（native の `getBudgetTotalsByTrip`〈SQL＋小数の旅行の置き換え〉と同じ値）。
 * 0桁の基準通貨の旅行は変更前の Web のコード（1行ずつ `Math.round` して `budgetTotalsByTripFromGroupRows`）の値のまま。
 * `trip_id` が NULL の記録はどの旅行にも入れない（native と同じ）。旅行は終了済みも含めて渡すこと
 */
export function budgetTotalsByTripFromRows(
  rows: readonly (BudgetInputRow & { trip_id: number | null })[],
  trips: readonly { id: number; target_currency: unknown }[],
): Map<number, BudgetTotals> {
  const map = budgetTotalsByTripFromGroupRows(
    rows.map((r) => ({
      trip_id: r.trip_id,
      is_purchased: r.is_purchased ?? null,
      count: 1,
      total: Number.isFinite(r.jpy_amount) ? Math.round(r.jpy_amount) : 0,
    })),
  );
  // 同じ id が重なった壊れた一覧では後の旅行を使う（`homeCurrencyOfTrip`・`attachHomeCurrencyFromTrips` と同じ向き）
  const homeById = new Map<number, unknown>();
  for (const t of trips) homeById.set(t.id, t.target_currency);
  for (const [tripId, value] of homeById) {
    const frac = fractionalHomeCurrency(value);
    if (!frac) continue;
    const tripRows = rows.filter((r) => r.trip_id === tripId);
    if (tripRows.length === 0) map.delete(tripId);
    else map.set(tripId, sumBudgetTotalsInMinorUnits(tripRows, minorUnitsFor(frac)));
  }
  return map;
}
