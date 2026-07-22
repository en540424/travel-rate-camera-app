/**
 * 旅レートカメラ_実装引き継ぎ資料.md §4 / §7 / §8 対応。
 * 価格・上限・回数などの「数値」はデザイントークンではなく差し替え前提のconfigに分離する。
 * 価格はRevenueCatのPackage（product.priceString等）を正とする。固定値は持たない。
 */

// 無料版の上限（§7）
export const FREE_LIMITS = {
  trips: 1,
  saves: 30,
} as const;
