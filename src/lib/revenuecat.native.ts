import { Platform } from 'react-native';
import Purchases from 'react-native-purchases';
import type {
  CustomerInfo,
  CustomerInfoUpdateListener,
  LogHandler,
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

// SDKの既定ログハンドラは、ログの重大度（ERROR/WARN等）をそのままconsole.error/warnへ流す。
// 購入キャンセルはSDK側でERROR相当のネイティブログとして送出されるため、
// setLogLevelの閾値（ERROR）を下げても素通りし、開発ビルドでLogBoxの黒い表示として出る。
// setLogLevelはそのままにしつつ、購入キャンセルを示す既知のログ文言だけをconsole出力の手前で
// 取り除く。アプリの挙動（Alert表示の要否）は引き続きisUserCancelledError（公式の
// userCancelled/error.code判定）を正とし、ここはログ出力の抑止のみが目的。
function isPurchaseCancelledLogMessage(message: string): boolean {
  const normalized = message.toLowerCase();
  return normalized.includes('purchase') && normalized.includes('cancel');
}

const revenueCatLogHandler: LogHandler = (logLevel, message) => {
  if (isPurchaseCancelledLogMessage(message)) return;
  switch (logLevel) {
    case Purchases.LOG_LEVEL.DEBUG:
      console.debug(`[RevenueCat] ${message}`);
      break;
    case Purchases.LOG_LEVEL.INFO:
      console.info(`[RevenueCat] ${message}`);
      break;
    case Purchases.LOG_LEVEL.WARN:
      console.warn(`[RevenueCat] ${message}`);
      break;
    case Purchases.LOG_LEVEL.ERROR:
      // SDK内部の診断ログ（StoreKit通信エラー等）はアプリ側の未処理例外ではないため、
      // console.errorへ流してLogBoxを開かせない。実際の購入成否は購入呼び出し側で
      // CustomerInfoのpro Entitlementを再確認して判定する（このログ出力はUI判定に使わない）。
      console.warn(`[RevenueCat] ${message}`);
      break;
    default:
      console.log(`[RevenueCat] ${message}`);
  }
};

/**
 * Purchases.configure を1回だけ実行する。
 * 非対応プラットフォーム、またはAPI Key未設定の場合は何もせずfalseを返す（呼び出し元はクラッシュしない）。
 */
export function configureRevenueCat(): boolean {
  if (configured) return true;
  if (!isRevenueCatSupported()) return false;

  const apiKey = getRevenueCatIosApiKey();
  if (!apiKey) return false;

  // configure()より前にsetLogHandlerを呼ぶことで、SDK既定のハンドラ（無条件にconsoleへ流す）
  // を差し替える。configure()後に呼ぶと既定ハンドラが先に登録されてしまう。
  Purchases.setLogHandler(revenueCatLogHandler);
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

/**
 * Packageを購入する。キャンセルは 'cancelled'、それ以外の失敗は 'error' を返す（詳細は露出しない）。
 *
 * purchasePackageが例外を投げても、Apple側では購入・Entitlement付与が成立している場合がある
 * （例: 購入完了直後のStoreKit.StoreKitError.unknown）。ユーザーキャンセル以外の例外時は、
 * 最新のCustomerInfoを1回だけ再取得し、pro Entitlementが有効ならそれを正として成功扱いにする。
 * 再取得自体が失敗、またはEntitlementが有効でなければ、本当の購入失敗として 'error' を返す。
 * 同じpurchasePackageは再実行しない（呼び出しは常に1回のみ）。
 */
export async function purchasePackage(pkg: PurchasesPackage): Promise<PurchaseOutcome> {
  try {
    const result = await Purchases.purchasePackage(pkg);
    return { status: 'success', customerInfo: result.customerInfo };
  } catch (error) {
    if (isUserCancelledError(error)) return { status: 'cancelled' };
    try {
      const customerInfo = await Purchases.getCustomerInfo();
      if (REVENUECAT_ENTITLEMENT_ID in customerInfo.entitlements.active) {
        return { status: 'success', customerInfo };
      }
    } catch {
      // CustomerInfo再取得自体が失敗した場合は、下の本当の失敗として扱う
    }
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
