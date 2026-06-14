/**
 * 旅レートカメラ_実装引き継ぎ資料.md §4 / §7 / §8 対応。
 * 価格・上限・回数などの「数値」はデザイントークンではなく差し替え前提のconfigに分離する。
 * 価格は最終的に RevenueCat の offering（localizedPriceString）を正とする。
 * 下記 PRICE_PLACEHOLDER はUI仮表示のみ。
 */

// 無料版の上限（§7）
export const FREE_LIMITS = {
  trips: 1,
  saves: 30,
  hiOcrTrial: 3,
} as const;

// Proの高性能OCR月間/年間/買い切り回数（§8）
export const PRO_OCR_QUOTA = {
  month: 50,
  year: 100,
  oneTime: 10,
} as const;

// UI仮表示用の価格（実値はRevenueCatのlocalizedPriceStringを使用）
export const PRICE_PLACEHOLDER = {
  month: '¥480',
  year: '¥3,800',
  oneTime: '¥5,800',
} as const;
