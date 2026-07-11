import type {
  CustomerInfo,
  CustomerInfoUpdateListener,
  PurchasesOffering,
  PurchasesPackage,
} from 'react-native-purchases';

/**
 * Web版のスタブ。react-native-purchasesはネイティブ専用SDKのため、
 * Webビルド（expo start --web 等）ではモジュール自体を読み込まない。
 * 実装は revenuecat.native.ts を参照。
 */

export function isRevenueCatSupported(): boolean {
  return false;
}

export function isRevenueCatConfigured(): boolean {
  return false;
}

export function configureRevenueCat(): boolean {
  return false;
}

export async function fetchCustomerInfo(): Promise<CustomerInfo> {
  throw new Error('RevenueCat is not supported on web');
}

export async function fetchDefaultOffering(): Promise<PurchasesOffering | null> {
  return null;
}

export function addCustomerInfoListener(_listener: CustomerInfoUpdateListener): void {}

export function removeCustomerInfoListener(_listener: CustomerInfoUpdateListener): void {}

export type PurchaseOutcome =
  | { status: 'success'; customerInfo: CustomerInfo }
  | { status: 'cancelled' }
  | { status: 'error' };

export type RestoreOutcome =
  | { status: 'success'; customerInfo: CustomerInfo; hasEntitlement: boolean }
  | { status: 'error' };

export async function purchasePackage(_pkg: PurchasesPackage): Promise<PurchaseOutcome> {
  return { status: 'error' };
}

export async function restorePurchases(): Promise<RestoreOutcome> {
  return { status: 'error' };
}
