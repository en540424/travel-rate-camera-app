import type { ConversionDirection, CurrencyCode } from '@/constants/currencies';

/** 1外貨単位あたりのJPYレートのマップ */
export type RateMap = Partial<Record<CurrencyCode, number>>;

/**
 * 外貨 → JPY 換算
 * @param amount 外貨金額
 * @param ratePerUnit 1外貨単位あたりのJPY
 */
export function toJpy(amount: number, ratePerUnit: number): number {
  if (ratePerUnit <= 0 || !isFinite(ratePerUnit)) return 0;
  return amount * ratePerUnit;
}

/**
 * JPY → 外貨換算（将来対応）
 * @param jpyAmount JPY金額
 * @param ratePerUnit 1外貨単位あたりのJPY
 */
export function fromJpy(jpyAmount: number, ratePerUnit: number): number {
  if (ratePerUnit <= 0 || !isFinite(ratePerUnit)) return 0;
  return jpyAmount / ratePerUnit;
}

/**
 * 汎用換算関数（将来 JPY→外貨に対応）
 */
export function convert(
  amount: number,
  ratePerUnit: number,
  direction: ConversionDirection = 'TO_JPY',
): number {
  return direction === 'TO_JPY'
    ? toJpy(amount, ratePerUnit)
    : fromJpy(amount, ratePerUnit);
}

/**
 * JPY建て（`base_currency === 'JPY'`の旅行）で入力された金額を、保存する整数円へ正規化する。
 *
 * JPYの丸め規則は repo 全体で`Math.round`（`formatJpy`・`budget-core`・SQL `ROUND(jpy_amount)`・
 * `edit-amount-core`）。入力欄は`decimal-pad`＋`parseFloat`のため`1200.5`のような小数JPYが
 * そのまま`jpy_amount`へ入り得たが（2026-09-18確認）、表示は常に¥1,201になるので保存値も同じ値へ揃える。
 * 非有限値は0（保存不可扱い）。**外貨→円の換算値（`toJpy`）には適用しない**（外貨記録の`jpy_amount`は従来どおり）。
 */
export function normalizeJpyInput(amount: number): number {
  return Number.isFinite(amount) ? Math.round(amount) : 0;
}
