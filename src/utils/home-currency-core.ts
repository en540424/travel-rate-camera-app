/**
 * 記録の基準通貨（GX-06 段階 a・2026-11-28）。設計書 `design/gx05-home-currency-design.md` §11 C1・C3・§13。
 *
 * - 記録の基準通貨＝その記録の旅行の `trips.target_currency`。旅行が無い（`trip_id` が NULL・旅行が見つからない）記録は 'JPY'
 * - 列は TEXT で CHECK 制約が無いので、7通貨に無い値（空文字・小文字・未知の通貨）も 'JPY' として読む（C3）
 * - `home_currency` は**読み出し専用の列**。DB・localStorage へは書かない（Web は保存の前に `stripHomeCurrency` で落とす）
 *
 * 既存の旅行はすべて `target_currency = 'JPY'`（書く経路がまだ無い）なので、今の利用者の記録はすべて 'JPY' と読まれる。
 */
import { CURRENCIES, type CurrencyCode } from '@/constants/currencies';

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
