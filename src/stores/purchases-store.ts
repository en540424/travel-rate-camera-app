import { create } from 'zustand';
import type { CustomerInfo, PurchasesOffering, PurchasesPackage } from 'react-native-purchases';

import {
  REVENUECAT_ANNUAL_PRODUCT_ID,
  REVENUECAT_MONTHLY_PRODUCT_ID,
  REVENUECAT_PRO_PLUS_ANNUAL_PRODUCT_ID,
  REVENUECAT_PRO_PLUS_MONTHLY_PRODUCT_ID,
} from '@/config/revenuecat';
import { getPlanTier } from '@/lib/plan-tier';
import { hasProAccess, type PlanTier } from '@/lib/plan-tier-core';
import type { OfferingLoadState } from '@/lib/proplus/proplus-purchase-core';
import { resolveAnnualPackage, resolveMonthlyPackage, resolvePackageByProductId } from '@/lib/revenuecat-package-core';

// Pro+の商品が誤って`default`へ入っても、Proの月額・年額として拾わない（Pro+の商品はPro+専用のOfferingに置く運用）
const PRO_PLUS_PRODUCT_IDS: readonly string[] = [REVENUECAT_PRO_PLUS_MONTHLY_PRODUCT_ID, REVENUECAT_PRO_PLUS_ANNUAL_PRODUCT_ID];

interface PurchasesStore {
  /** Purchases.configure が完了しているか（非対応環境/Key未設定ならfalseのまま） */
  isConfigured: boolean;
  /** 初回のCustomerInfo取得が完了したか（成功/失敗を問わない） */
  isInitialized: boolean;
  isLoading: boolean;
  /** 契約プラン（正本はCustomerInfo。導出は`lib/plan-tier.ts`）。`isPro`と必ず同じ`set()`で更新する */
  planTier: PlanTier;
  /** Pro以上（Pro・Pro+）の権利があるか。`planTier`から導出した既存の判定。参照元（`useIsPro()`等）は変えない */
  isPro: boolean;
  customerInfo: CustomerInfo | null;
  offering: PurchasesOffering | null;
  monthlyPackage: PurchasesPackage | null;
  annualPackage: PurchasesPackage | null;
  error: string | null;
  /**
   * Pro+専用のOffering（`pro_plus`）と、その中のPro+の商品（Product IDの完全一致だけ）。Pro+の購入画面を開いた時だけ読む。
   * `default`（Proの2商品）の読み込み・解決には一切関わらない（Free・Proの購入画面の挙動を変えない）
   */
  proPlusOfferingState: OfferingLoadState;
  proPlusOffering: PurchasesOffering | null;
  proPlusMonthlyPackage: PurchasesPackage | null;
  proPlusAnnualPackage: PurchasesPackage | null;

  setConfigured: (isConfigured: boolean) => void;
  setLoading: (isLoading: boolean) => void;
  setInitialized: (isInitialized: boolean) => void;
  setCustomerInfo: (customerInfo: CustomerInfo | null) => void;
  setOffering: (offering: PurchasesOffering | null) => void;
  setError: (error: string | null) => void;
  setProPlusOfferingState: (state: OfferingLoadState) => void;
  setProPlusOffering: (offering: PurchasesOffering | null) => void;
}

export const usePurchasesStore = create<PurchasesStore>((set) => ({
  isConfigured: false,
  isInitialized: false,
  isLoading: false,
  planTier: 'free',
  isPro: false,
  customerInfo: null,
  offering: null,
  monthlyPackage: null,
  annualPackage: null,
  error: null,
  proPlusOfferingState: 'idle',
  proPlusOffering: null,
  proPlusMonthlyPackage: null,
  proPlusAnnualPackage: null,

  setConfigured: (isConfigured) => set({ isConfigured }),
  setLoading: (isLoading) => set({ isLoading }),
  setInitialized: (isInitialized) => set({ isInitialized }),

  setCustomerInfo: (customerInfo) => {
    const planTier = getPlanTier(customerInfo);
    set({ customerInfo, planTier, isPro: hasProAccess(planTier) });
  },

  // `offering.monthly` / `.annual`はDashboardで定義済みidentifier（$rc_monthly等）を
  // 使っている場合しか埋まらない。独自identifier構成でも価格が出るよう、
  // packageType → Product ID の順にフォールバックする（revenuecat-package-core.ts）。
  setOffering: (offering) =>
    set({
      offering,
      monthlyPackage: resolveMonthlyPackage(offering, REVENUECAT_MONTHLY_PRODUCT_ID, PRO_PLUS_PRODUCT_IDS),
      annualPackage: resolveAnnualPackage(offering, REVENUECAT_ANNUAL_PRODUCT_ID, PRO_PLUS_PRODUCT_IDS),
    }),

  setError: (error) => set({ error }),

  setProPlusOfferingState: (proPlusOfferingState) => set({ proPlusOfferingState }),
  // Pro+の商品はProduct IDの完全一致だけで拾う（`offering.monthly`・packageTypeは見ない。Proの商品を取り違えないため）
  setProPlusOffering: (offering) =>
    set({
      proPlusOffering: offering,
      proPlusOfferingState: 'loaded',
      proPlusMonthlyPackage: resolvePackageByProductId(offering, REVENUECAT_PRO_PLUS_MONTHLY_PRODUCT_ID),
      proPlusAnnualPackage: resolvePackageByProductId(offering, REVENUECAT_PRO_PLUS_ANNUAL_PRODUCT_ID),
    }),
}));
