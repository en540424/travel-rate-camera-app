/**
 * 旅レートカメラ_実装引き継ぎ資料.md §4 / §7 / §8 対応。
 * 価格・上限・回数などの「数値」はデザイントークンではなく差し替え前提のconfigに分離する。
 * 価格はRevenueCatのPackage（product.priceString等）を正とする。固定値は持たない。
 */
import { canSwitchTripOnFree, isTripLockedOnFree } from '@/utils/trip-recording-core';

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
 * 終了済み（アーカイブ済み）の旅行を記録中へ戻せるか。
 *
 * 無料版では終了した旅行は「記録を締めた旅行」で、記録中の旅行が0件でも再開できない（2026-10-20 Human確定）。
 * 再開できると「終了→新しい旅行→前の旅行を再開」で複数の旅行へ記録できてしまうため。Proは再開できる。
 */
export function canRestoreTrip(isPro: boolean): boolean {
  if (DEV_BYPASS_FREE_LIMITS) return true;
  return isPro;
}

/**
 * 使用中の旅行を切り替えられるか。無料版は記録対象（`recordingTripId`）がある間、別の旅行へ切り替えられない
 * （切り替えると記録対象が移り、複数の旅行へ交互に記録できてしまう）。Proは複数の旅行を切り替えて記録できる。
 */
export function canSwitchTrip(isPro: boolean, targetTripId: number, recordingTripId: number | null): boolean {
  if (DEV_BYPASS_FREE_LIMITS) return true;
  if (isPro) return true;
  return canSwitchTripOnFree(targetTripId, recordingTripId);
}

/**
 * この旅行が「閲覧のみ」か（無料版で、記録対象以外の旅行＝終了済み・Proで記録していた他の旅行）。
 * 閲覧のみの旅行では、新しい記録の追加・旅行の編集・再開・切替ができない。保存済みの記録の閲覧・編集（訂正）・削除・
 * 候補/購入済みの切替はできる（2026-10-20 Human確定。記録の編集はこの判定でゲートしない）。データは書き換えない。
 * Proは常にfalse（終了済みの旅行も従来どおり編集・再開できる）。
 */
export function isTripReadOnly(isPro: boolean, tripId: number | null | undefined, recordingTripId: number | null): boolean {
  if (DEV_BYPASS_FREE_LIMITS) return false;
  if (isPro) return false;
  return isTripLockedOnFree(tripId, recordingTripId);
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
