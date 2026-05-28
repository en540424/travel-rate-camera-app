import type { CurrencyCode } from '@/constants/currencies';
import { CURRENCIES } from '@/constants/currencies';

/**
 * JPY金額を日本円表示にフォーマット
 * 例: 1980 → "¥1,980"
 */
export function formatJpy(amount: number): string {
  const rounded = Math.round(amount);
  return `¥${rounded.toLocaleString('ja-JP')}`;
}

/**
 * 外貨金額を通貨記号付きでフォーマット
 * 例: formatForeign(12.99, 'USD') → "$12.99"
 */
export function formatForeign(amount: number, code: CurrencyCode): string {
  const currency = CURRENCIES[code];
  const formatted = amount.toLocaleString('en-US', {
    minimumFractionDigits: currency.decimals,
    maximumFractionDigits: currency.decimals,
  });
  return `${currency.symbol}${formatted}`;
}

/**
 * レート表示
 * 例: formatRate(152.5, 'USD') → "1 USD = ¥152.50"
 */
export function formatRate(ratePerUnit: number, code: CurrencyCode): string {
  if (ratePerUnit <= 0) return 'レート未設定';
  return `1 ${code} = ¥${ratePerUnit.toLocaleString('ja-JP', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * 数字入力文字列を数値にパース（不正値は0）
 */
export function parseInputAmount(input: string): number {
  const n = parseFloat(input);
  return isFinite(n) && n >= 0 ? n : 0;
}
