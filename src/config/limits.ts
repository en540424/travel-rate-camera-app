/**
 * 旅レートカメラ_実装引き継ぎ資料.md §4 / §7 / §8 対応。
 * 価格・上限・回数などの「数値」はデザイントークンではなく差し替え前提のconfigに分離する。
 * 価格はRevenueCatのPackage（product.priceString等）を正とする。固定値は持たない。
 */

// 無料版の上限（§7）
export const FREE_LIMITS = {
  trips: 1,
  saves: 30,
  hiOcrTrial: 3,
} as const;

// Proの高性能OCR月間/年間/買い切り回数（§8）。初回Pro（保存/旅行数上限解除）には未接続。将来のクラウド機能バッチ用に定義のみ残す。
export const PRO_OCR_QUOTA = {
  month: 50,
  year: 100,
  oneTime: 10,
} as const;
