/**
 * 旅レートカメラ_実装引き継ぎ資料.md §4 / §7 / §8 対応。
 * 価格・上限・回数などの「数値」はデザイントークンではなく差し替え前提のconfigに分離する。
 * 価格はRevenueCatのPackage（product.priceString等）を正とする。固定値は持たない。
 */
import { DEV_BYPASS_FREE_LIMITS } from './feature-flags';

// 無料版の上限（§7）
export const FREE_LIMITS = {
  trips: 1,
  saves: 10,
} as const;

/**
 * 旅行を新規作成できるか。development／__DEV__限定バイパス→Pro→無料上限の順に判定する唯一の入口。
 * FREE_LIMITS.tripsそのものは変更しない。isProの意味・RevenueCat判定には触れない。
 */
export function canCreateTrip(isPro: boolean, activeTripCount: number): boolean {
  if (DEV_BYPASS_FREE_LIMITS) return true;
  if (isPro) return true;
  return activeTripCount < FREE_LIMITS.trips;
}

/**
 * 保存を追加できるか。development／__DEV__限定バイパス→Pro→無料上限の順に判定する唯一の入口。
 * FREE_LIMITS.savesそのものは変更しない。isProの意味・RevenueCat判定には触れない。
 */
export function canSaveEntry(isPro: boolean, currentSaveCount: number): boolean {
  if (DEV_BYPASS_FREE_LIMITS) return true;
  if (isPro) return true;
  return currentSaveCount < FREE_LIMITS.saves;
}
