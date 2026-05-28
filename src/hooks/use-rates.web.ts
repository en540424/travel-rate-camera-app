// Web版レートフック: expo-sqlite を使わず localStorage にフォールバック。
// Metro は .web.ts を Web ビルドで優先採用するため、
// use-rates.ts（expo-sqlite 使用）は iOS/Android のみで使われる。
import { useEffect } from 'react';

import type { CurrencyCode } from '@/constants/currencies';
import { useRateStore } from '@/stores/rate-store';

const STORAGE_KEY = 'travelrate:rates';

function loadFromStorage(): Partial<Record<CurrencyCode, number>> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Partial<Record<CurrencyCode, number>>) : {};
  } catch {
    return {};
  }
}

function persistToStorage(rates: Partial<Record<CurrencyCode, number>>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(rates));
  } catch {
    // localStorage が使えない環境（SSR 等）ではメモリのみ
  }
}

export function useRates() {
  const { rates, setRates, setRate } = useRateStore();

  // マウント時に localStorage から読み込む
  useEffect(() => {
    const stored = loadFromStorage();
    if (Object.keys(stored).length > 0) {
      setRates(stored);
    }
  }, [setRates]);

  async function saveRate(currency: CurrencyCode, rate: number) {
    setRate(currency, rate);
    // Zustand ストアの最新状態を取得して全体を上書き保存
    const current = useRateStore.getState().rates;
    persistToStorage({ ...current, [currency]: rate });
  }

  return { rates, saveRate };
}
