import { create } from 'zustand';

import type { CurrencyCode } from '@/constants/currencies';

interface SettingsStore {
  /** 現在選択中の通貨 */
  selectedCurrency: CurrencyCode;
  setSelectedCurrency: (currency: CurrencyCode) => void;

  /** 換算タブ → カメラ画面への金額受け渡し用 */
  pendingCameraAmount: string | null;
  setPendingCameraAmount: (v: string | null) => void;
}

// Pro課金状態（isPro）はここでは持たない。正本は RevenueCat の CustomerInfo。
// @/hooks/use-purchases の useIsPro() を参照すること。
export const useSettingsStore = create<SettingsStore>((set) => ({
  selectedCurrency: 'USD',
  setSelectedCurrency: (currency) => set({ selectedCurrency: currency }),

  pendingCameraAmount: null,
  setPendingCameraAmount: (v) => set({ pendingCameraAmount: v }),
}));
