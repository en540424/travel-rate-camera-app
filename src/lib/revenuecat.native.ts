import { Platform } from 'react-native';
import Purchases from 'react-native-purchases';
import type { CustomerInfo, CustomerInfoUpdateListener, PurchasesOffering } from 'react-native-purchases';

import { getRevenueCatIosApiKey, REVENUECAT_OFFERING_ID } from '@/config/revenuecat';

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

  Purchases.setLogLevel(__DEV__ ? Purchases.LOG_LEVEL.WARN : Purchases.LOG_LEVEL.ERROR);
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

// 購入処理・復元処理（purchasePackage / restorePurchases）は後続バッチでこのファイルへ追加する。
