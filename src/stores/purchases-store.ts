import { create } from 'zustand';
import type { CustomerInfo, PurchasesOffering, PurchasesPackage } from 'react-native-purchases';

import {
  REVENUECAT_ANNUAL_PRODUCT_ID,
  REVENUECAT_ENTITLEMENT_ID,
  REVENUECAT_MONTHLY_PRODUCT_ID,
} from '@/config/revenuecat';
import { resolveAnnualPackage, resolveMonthlyPackage } from '@/lib/revenuecat-package-core';

interface PurchasesStore {
  /** Purchases.configure が完了しているか（非対応環境/Key未設定ならfalseのまま） */
  isConfigured: boolean;
  /** 初回のCustomerInfo取得が完了したか（成功/失敗を問わない） */
  isInitialized: boolean;
  isLoading: boolean;
  isPro: boolean;
  customerInfo: CustomerInfo | null;
  offering: PurchasesOffering | null;
  monthlyPackage: PurchasesPackage | null;
  annualPackage: PurchasesPackage | null;
  error: string | null;

  setConfigured: (isConfigured: boolean) => void;
  setLoading: (isLoading: boolean) => void;
  setInitialized: (isInitialized: boolean) => void;
  setCustomerInfo: (customerInfo: CustomerInfo | null) => void;
  setOffering: (offering: PurchasesOffering | null) => void;
  setError: (error: string | null) => void;
}

export const usePurchasesStore = create<PurchasesStore>((set) => ({
  isConfigured: false,
  isInitialized: false,
  isLoading: false,
  isPro: false,
  customerInfo: null,
  offering: null,
  monthlyPackage: null,
  annualPackage: null,
  error: null,

  setConfigured: (isConfigured) => set({ isConfigured }),
  setLoading: (isLoading) => set({ isLoading }),
  setInitialized: (isInitialized) => set({ isInitialized }),

  setCustomerInfo: (customerInfo) =>
    set({
      customerInfo,
      isPro: customerInfo != null && REVENUECAT_ENTITLEMENT_ID in customerInfo.entitlements.active,
    }),

  // `offering.monthly` / `.annual`はDashboardで定義済みidentifier（$rc_monthly等）を
  // 使っている場合しか埋まらない。独自identifier構成でも価格が出るよう、
  // packageType → Product ID の順にフォールバックする（revenuecat-package-core.ts）。
  setOffering: (offering) =>
    set({
      offering,
      monthlyPackage: resolveMonthlyPackage(offering, REVENUECAT_MONTHLY_PRODUCT_ID),
      annualPackage: resolveAnnualPackage(offering, REVENUECAT_ANNUAL_PRODUCT_ID),
    }),

  setError: (error) => set({ error }),
}));
