import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import type { CustomerInfo, PurchasesPackage } from 'react-native-purchases';

import { REVENUECAT_ANNUAL_PRODUCT_ID, REVENUECAT_ENTITLEMENT_ID, REVENUECAT_MONTHLY_PRODUCT_ID } from '@/config/revenuecat';
import {
  addCustomerInfoListener,
  configureRevenueCat,
  fetchCustomerInfo,
  fetchDefaultOffering,
  isRevenueCatConfigured,
  purchasePackage as purchasePackageOnDevice,
  removeCustomerInfoListener,
  restorePurchases as restorePurchasesOnDevice,
} from '@/lib/revenuecat';
import type { PurchaseOutcome, RestoreOutcome } from '@/lib/revenuecat';
import { diagnosePurchaseSetup } from '@/lib/revenuecat-package-core';
import { usePurchasesStore } from '@/stores/purchases-store';

/**
 * 価格が出ない原因を次回Buildで切り分けるための診断ログ。
 *
 * 出すのは**件数とidentifierだけ**。APIキー・レシート・ユーザー識別子・
 * CustomerInfoの中身は一切出さない（identifierはApp Store Connect上の公開値）。
 * `console.warn`で出すのは、Preview Build（release JS）でもXcode/Consoleから拾えるようにするため。
 */
function logPurchaseDiagnostics(): void {
  const state = usePurchasesStore.getState();
  const diagnosis = diagnosePurchaseSetup({
    isConfigured: state.isConfigured,
    offering: state.offering,
    monthlyResolved: state.monthlyPackage != null,
    annualResolved: state.annualPackage != null,
  });
  const packages = state.offering?.availablePackages ?? [];
  console.warn(
    '[PurchaseDiag]',
    JSON.stringify({
      diagnosis,
      configured: state.isConfigured,
      // どれが欠けているかを一目で切り分けるための最小情報
      offeringId: state.offering?.identifier ?? null,
      packageCount: packages.length,
      packageIds: packages.map((p) => p.identifier),
      packageTypes: packages.map((p) => p.packageType),
      productIds: packages.map((p) => p.product?.identifier ?? null),
      monthlyResolved: state.monthlyPackage != null,
      annualResolved: state.annualPackage != null,
    }),
  );
}

/**
 * Offeringの取得を1本に束ねる（重複要求の防止）。
 *
 * 起動時・画面mount時・フォアグラウンド復帰時から同時に呼ばれても、実行中の要求があれば
 * それを共有し、SDKへ二重に問い合わせない。取得できたかどうかに関わらず要求は1回で終わる
 * （無限retryはしない。再試行は次のトリガー＝画面再入場・復帰・「再試行」操作でのみ起きる）。
 * `fetchDefaultOffering()`はOffering未定義のとき**nullを正常値として返す**ため、
 * 「nullだから失敗」とみなしてループさせない。
 */
let offeringsRequest: Promise<void> | null = null;

function loadOfferingsOnce(): Promise<void> {
  if (offeringsRequest) return offeringsRequest;
  offeringsRequest = (async () => {
    try {
      const offering = await fetchDefaultOffering();
      usePurchasesStore.getState().setOffering(offering);
    } catch {
      // 価格未取得のまま。購入画面は「価格情報を取得できませんでした」＋再試行で扱う。
      // CustomerInfo（Pro権利）とは独立した失敗なので、storeのerror（プラン確認失敗）には流さない。
    } finally {
      offeringsRequest = null;
    }
  })();
  return offeringsRequest;
}

/**
 * アプリ起動時に1回だけ呼び出す初期化hook。RootLayoutなど単一の場所からのみ呼ぶこと。
 * RevenueCat通信の完了を待たずに呼び出し元の描画をブロックしない（非同期・fire-and-forget）。
 */
export function usePurchasesInit(): void {
  useEffect(() => {
    let mounted = true;
    const listener = (info: CustomerInfo) => {
      if (mounted) usePurchasesStore.getState().setCustomerInfo(info);
    };

    async function init() {
      const configured = configureRevenueCat();
      usePurchasesStore.getState().setConfigured(configured);

      if (!configured) {
        usePurchasesStore.getState().setInitialized(true);
        // ここで止まる＝iOS以外か、EXPO_PUBLIC_REVENUECAT_IOS_KEYがBuildへ埋まっていない。
        // 前者はWeb/Android、後者はEAS環境変数の未設定が原因になる。
        logPurchaseDiagnostics();
        return;
      }

      usePurchasesStore.getState().setLoading(true);
      addCustomerInfoListener(listener);

      // CustomerInfo（Pro権利）とOffering（価格）は独立して反映する。
      // 片方の失敗でもう片方の成功結果を捨てない（旧Promise.allでは一方の失敗で両方未反映になっていた）。
      // Offeringの失敗は価格未取得として画面側で扱い、Pro権利の確認失敗（error）とは区別する。
      const [customerInfoResult] = await Promise.allSettled([
        fetchCustomerInfo(),
        loadOfferingsOnce(),
      ]);
      if (!mounted) return;
      if (customerInfoResult.status === 'fulfilled') {
        usePurchasesStore.getState().setCustomerInfo(customerInfoResult.value);
        usePurchasesStore.getState().setError(null);
      } else {
        // RevenueCat通信失敗時も無料機能を止めない。詳細はユーザー画面・ログへ露出しない。
        usePurchasesStore.getState().setError('revenuecat_init_failed');
      }
      usePurchasesStore.getState().setLoading(false);
      usePurchasesStore.getState().setInitialized(true);
      logPurchaseDiagnostics();
    }

    init();

    return () => {
      mounted = false;
      removeCustomerInfoListener(listener);
    };
  }, []);

  // アプリがバックグラウンドから復帰した時にCustomerInfoを再取得する。
  // 他端末での購入・解約・期限切れなどをできるだけ早く反映するため。
  // オフライン時はSDK側の端末内キャッシュがそのまま返る（ここでは独自キャッシュを持たない）。
  useEffect(() => {
    const appState = { current: AppState.currentState };
    const subscription = AppState.addEventListener('change', (next: AppStateStatus) => {
      const cameToForeground = appState.current.match(/inactive|background/) && next === 'active';
      appState.current = next;
      if (!cameToForeground) return;
      if (!isRevenueCatConfigured()) return;
      fetchCustomerInfo()
        .then((info) => usePurchasesStore.getState().setCustomerInfo(info))
        .catch(() => {
          /* オフライン等は無視。無料機能は継続利用可能なまま */
        });
      // offline起動→online復帰で価格が永久に「—」のままにならないよう、
      // Offering未取得のときだけ復帰ごとに1回だけ取り直す（取得済みなら触らない）。
      if (usePurchasesStore.getState().offering == null) void loadOfferingsOnce();
    });
    return () => subscription.remove();
  }, []);
}

/** Pro状態・Offering情報・購入/復元処理を画面から参照するためのhook。 */
export function usePurchases() {
  const state = usePurchasesStore();
  const [isPurchasing, setIsPurchasing] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  // 二重タップ防止用。setStateの非同期反映を待たず即座に判定するためrefでも保持する。
  const purchasingRef = useRef(false);
  const restoringRef = useRef(false);
  // Offering未取得のまま画面（購入画面等）へ入った時の取り直しは、mountごとに1回だけ。
  // `offering == null`はOffering未定義の正常値でもあり得るため、依存配列で追いかけてループさせない。
  const offeringsAttemptedRef = useRef(false);

  const { isConfigured, isInitialized, offering } = state;
  useEffect(() => {
    if (!isConfigured || !isInitialized || offering != null) return;
    if (offeringsAttemptedRef.current) return;
    offeringsAttemptedRef.current = true;
    void loadOfferingsOnce();
  }, [isConfigured, isInitialized, offering]);

  const refreshCustomerInfo = useCallback(async () => {
    if (!usePurchasesStore.getState().isConfigured) return;
    try {
      const info = await fetchCustomerInfo();
      usePurchasesStore.getState().setCustomerInfo(info);
      usePurchasesStore.getState().setError(null);
    } catch {
      usePurchasesStore.getState().setError('revenuecat_refresh_customer_info_failed');
    }
  }, []);

  /** 価格情報（Offering）の取り直し。購入画面の「再取得」など明示操作から呼ぶ。実行中なら相乗りする */
  const refreshOfferings = useCallback(async () => {
    if (!usePurchasesStore.getState().isConfigured) return;
    await loadOfferingsOnce();
  }, []);

  const purchase = useCallback(async (pkg: PurchasesPackage): Promise<PurchaseOutcome> => {
    if (purchasingRef.current) return { status: 'error' };
    if (!usePurchasesStore.getState().isConfigured) return { status: 'error' };
    purchasingRef.current = true;
    setIsPurchasing(true);
    try {
      // 購入前のPro状態を渡す（例外後の救済で既存Proを今回の成功と誤認しないため）
      const outcome = await purchasePackageOnDevice(pkg, { wasProBefore: usePurchasesStore.getState().isPro });
      if (outcome.status === 'success') {
        usePurchasesStore.getState().setCustomerInfo(outcome.customerInfo);
        usePurchasesStore.getState().setError(null);
      } else if (outcome.status === 'entitlement_missing' && outcome.customerInfo) {
        // 最新のCustomerInfo（pro無効）は反映しておく。Pro開放はしない
        usePurchasesStore.getState().setCustomerInfo(outcome.customerInfo);
      }
      return outcome;
    } finally {
      purchasingRef.current = false;
      setIsPurchasing(false);
    }
  }, []);

  const restore = useCallback(async (): Promise<RestoreOutcome> => {
    if (restoringRef.current) return { status: 'error' };
    if (!usePurchasesStore.getState().isConfigured) return { status: 'error' };
    restoringRef.current = true;
    setIsRestoring(true);
    try {
      const outcome = await restorePurchasesOnDevice();
      if (outcome.status === 'success') {
        usePurchasesStore.getState().setCustomerInfo(outcome.customerInfo);
        usePurchasesStore.getState().setError(null);
      }
      return outcome;
    } finally {
      restoringRef.current = false;
      setIsRestoring(false);
    }
  }, []);

  return { ...state, isPurchasing, isRestoring, refreshCustomerInfo, refreshOfferings, purchase, restore };
}

/** Pro権利の有無だけを参照する軽量セレクタ。正本はRevenueCatのCustomerInfo。 */
export function useIsPro(): boolean {
  return usePurchasesStore((s) => s.isPro);
}

export interface ProPlanDetails {
  /** Product IDから確実に判定できた場合のみ 'monthly' / 'annual'。判定できなければnull（推測しない）。 */
  planPeriod: 'monthly' | 'annual' | null;
  /** pro Entitlementの有効期限（ISO8601）。買い切り等でnullの場合あり。 */
  expirationDate: string | null;
  /** 自動更新されるか。CustomerInfoから取得できない場合はnull。 */
  willRenew: boolean | null;
  /** iOSの正規サブスクリプション管理画面URL。RevenueCatが返せない場合はnull（呼び出し側でフォールバックURLを使う）。 */
  managementURL: string | null;
}

/**
 * 現在のPro契約の詳細（月額/年額・有効期限・自動更新・管理URL）をCustomerInfoからのみ導出するセレクタ。
 * ローカルの推測や「最後に選んだプラン」は使わない。確実に判定できない項目はnullを返す。
 */
export function useProPlanDetails(): ProPlanDetails {
  const customerInfo = usePurchasesStore((s) => s.customerInfo);
  const entitlement = customerInfo?.entitlements.active[REVENUECAT_ENTITLEMENT_ID] ?? null;
  const productIdentifier = entitlement?.productIdentifier ?? null;

  let planPeriod: 'monthly' | 'annual' | null = null;
  if (productIdentifier === REVENUECAT_MONTHLY_PRODUCT_ID) planPeriod = 'monthly';
  else if (productIdentifier === REVENUECAT_ANNUAL_PRODUCT_ID) planPeriod = 'annual';

  return {
    planPeriod,
    expirationDate: entitlement?.expirationDate ?? null,
    willRenew: entitlement?.willRenew ?? null,
    managementURL: customerInfo?.managementURL ?? null,
  };
}
