import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import type { CustomerInfo, PurchasesPackage } from 'react-native-purchases';

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
import { usePurchasesStore } from '@/stores/purchases-store';

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
        return;
      }

      usePurchasesStore.getState().setLoading(true);
      addCustomerInfoListener(listener);

      try {
        const [customerInfo, offering] = await Promise.all([
          fetchCustomerInfo(),
          fetchDefaultOffering(),
        ]);
        if (!mounted) return;
        usePurchasesStore.getState().setCustomerInfo(customerInfo);
        usePurchasesStore.getState().setOffering(offering);
        usePurchasesStore.getState().setError(null);
      } catch {
        // RevenueCat通信失敗時も無料機能を止めない。詳細はユーザー画面・ログへ露出しない。
        if (!mounted) return;
        usePurchasesStore.getState().setError('revenuecat_init_failed');
      } finally {
        if (mounted) {
          usePurchasesStore.getState().setLoading(false);
          usePurchasesStore.getState().setInitialized(true);
        }
      }
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

  const refreshOfferings = useCallback(async () => {
    if (!usePurchasesStore.getState().isConfigured) return;
    try {
      const offering = await fetchDefaultOffering();
      usePurchasesStore.getState().setOffering(offering);
      usePurchasesStore.getState().setError(null);
    } catch {
      usePurchasesStore.getState().setError('revenuecat_refresh_offerings_failed');
    }
  }, []);

  const purchase = useCallback(async (pkg: PurchasesPackage): Promise<PurchaseOutcome> => {
    if (purchasingRef.current) return { status: 'error' };
    if (!usePurchasesStore.getState().isConfigured) return { status: 'error' };
    purchasingRef.current = true;
    setIsPurchasing(true);
    try {
      const outcome = await purchasePackageOnDevice(pkg);
      if (outcome.status === 'success') {
        usePurchasesStore.getState().setCustomerInfo(outcome.customerInfo);
        usePurchasesStore.getState().setError(null);
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
