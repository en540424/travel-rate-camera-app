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
