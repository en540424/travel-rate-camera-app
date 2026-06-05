import { create } from 'zustand';

import type { CurrencyCode } from '@/constants/currencies';
import { FOREIGN_CURRENCY_CODES } from '@/constants/currencies';

export type RateMap = Partial<Record<CurrencyCode, number>>;

const DEFAULT_RATES: RateMap = Object.fromEntries(
  FOREIGN_CURRENCY_CODES.map((c) => [c, 0]),
);

interface RateStore {
  rates: RateMap;
  /** DB から読み込んだレートをストアに反映 */
  setRates: (rates: Partial<RateMap>) => void;
  /** 1通貨のレートを更新 */
  setRate: (currency: CurrencyCode, rate: number) => void;
}

export const useRateStore = create<RateStore>((set) => ({
  rates: DEFAULT_RATES,

  setRates: (rates) =>
    set((state) => ({ rates: { ...state.rates, ...rates } })),

  setRate: (currency, rate) =>
    set((state) => ({ rates: { ...state.rates, [currency]: rate } })),
}));
