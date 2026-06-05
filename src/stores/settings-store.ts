import { create } from 'zustand';

import type { CurrencyCode } from '@/constants/currencies';

interface SettingsStore {
  /** 現在選択中の通貨 */
  selectedCurrency: CurrencyCode;
  setSelectedCurrency: (currency: CurrencyCode) => void;

  /**
   * Pro課金状態
   * 初期は false。RevenueCat 連携後にここを更新する。
   */
  isPro: boolean;
  setIsPro: (isPro: boolean) => void;

  /** 換算タブ → カメラ画面への金額受け渡し用 */
  pendingCameraAmount: string | null;
  setPendingCameraAmount: (v: string | null) => void;
}

export const useSettingsStore = create<SettingsStore>((set) => ({
  selectedCurrency: 'USD',
  setSelectedCurrency: (currency) => set({ selectedCurrency: currency }),

  isPro: false,
  setIsPro: (isPro) => set({ isPro }),

  pendingCameraAmount: null,
  setPendingCameraAmount: (v) => set({ pendingCameraAmount: v }),
}));
