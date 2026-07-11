import { Platform } from 'react-native';
import Purchases from 'react-native-purchases';
import type {
  CustomerInfo,
  CustomerInfoUpdateListener,
  PurchasesOffering,
  PurchasesPackage,
} from 'react-native-purchases';

import { getRevenueCatIosApiKey, REVENUECAT_ENTITLEMENT_ID, REVENUECAT_OFFERING_ID } from '@/config/revenuecat';

let configured = false;

/** RevenueCatを実行してよい環境か（iOS実機/シミュレータのみ。Android/Webは対象外） */
export function isRevenueCatSupported(): boolean {
  return Platform.OS === 'ios';
}

export function isRevenueCatConfigured(): boolean {
  return configured;
}

/**
 * Purchases.configure を1回だけ実行する。
 * 非対応プラットフォーム、またはAPI Key未設定の場合は何もせずfalseを返す（呼び出し元はクラッシュしない）。
 */
export function configureRevenueCat(): boolean {
  if (configured) return true;
  if (!isRevenueCatSupported()) return false;

  const apiKey = getRevenueCatIosApiKey();
  if (!apiKey) return false;

  // WARN以下にすると、購入キャンセルのような正常操作までSDKがログとして出し、
  // 開発ビルドのLogBoxにトースト状の警告表示として出てしまう。ERRORのみに絞る。
  Purchases.setLogLevel(Purchases.LOG_LEVEL.ERROR);
  Purchases.configure({ apiKey });
  configured = true;
  return true;
}

export async function fetchCustomerInfo(): Promise<CustomerInfo> {
  return Purchases.getCustomerInfo();
}

export async function fetchDefaultOffering(): Promise<PurchasesOffering | null> {
  const offerings = await Purchases.getOfferings();
  return offerings.all[REVENUECAT_OFFERING_ID] ?? offerings.current ?? null;
}

export function addCustomerInfoListener(listener: CustomerInfoUpdateListener): void {
  Purchases.addCustomerInfoUpdateListener(listener);
}

export function removeCustomerInfoListener(listener: CustomerInfoUpdateListener): void {
  Purchases.removeCustomerInfoUpdateListener(listener);
}

export type PurchaseOutcome =
  | { status: 'success'; customerInfo: CustomerInfo }
  | { status: 'cancelled' }
  | { status: 'error' };

export type RestoreOutcome =
  | { status: 'success'; customerInfo: CustomerInfo; hasEntitlement: boolean }
  | { status: 'error' };

function isUserCancelledError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const e = error as { userCancelled?: unknown; code?: unknown };
  // userCancelledに加えてcodeも見る（SDK/プラットフォームにより片方しか立たない場合の保険）
  return e.userCancelled === true || e.code === 'PURCHASE_CANCELLED_ERROR';
}

/** Packageを購入する。キャンセルは 'cancelled'、それ以外の失敗は 'error' を返す（詳細は露出しない）。 */
export async function purchasePackage(pkg: PurchasesPackage): Promise<PurchaseOutcome> {
  try {
    const result = await Purchases.purchasePackage(pkg);
    return { status: 'success', customerInfo: result.customerInfo };
  } catch (error) {
    if (isUserCancelledError(error)) return { status: 'cancelled' };
    return { status: 'error' };
  }
}

/** 購入履歴を復元する。 */
export async function restorePurchases(): Promise<RestoreOutcome> {
  try {
    const customerInfo = await Purchases.restorePurchases();
    return {
      status: 'success',
      customerInfo,
      hasEntitlement: REVENUECAT_ENTITLEMENT_ID in customerInfo.entitlements.active,
    };
  } catch {
    return { status: 'error' };
  }
}
