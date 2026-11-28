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
import { isDomestic } from '@/utils/money-core';

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
