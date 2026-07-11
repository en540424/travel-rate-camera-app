import { useCallback, useEffect } from 'react';
import type { CustomerInfo } from 'react-native-purchases';

import {
  addCustomerInfoListener,
  configureRevenueCat,
  fetchCustomerInfo,
  fetchDefaultOffering,
  removeCustomerInfoListener,
} from '@/lib/revenuecat';
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
}

/** Pro状態・Offering情報を画面から参照するためのhook。 */
export function usePurchases() {
  const state = usePurchasesStore();

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

  return { ...state, refreshCustomerInfo, refreshOfferings };
}
