import { useSQLiteContext } from 'expo-sqlite';
import { useEffect } from 'react';

import type { CurrencyCode } from '@/constants/currencies';
import { getAllRates, upsertRate } from '@/db/queries/rates';
import { useRateStore } from '@/stores/rate-store';

/**
 * DB連携レートフック
 * - マウント時にDBから全レートを読み込んでストアに反映
 * - saveRate でDBとストア両方を更新
 */
export function useRates() {
  const db = useSQLiteContext();
  const { rates, setRates, setRate } = useRateStore();

  useEffect(() => {
    getAllRates(db).then(setRates).catch(console.error);
  }, [db, setRates]);

  async function saveRate(currency: CurrencyCode, rate: number) {
    await upsertRate(db, currency, rate);
    setRate(currency, rate);
  }

  return { rates, saveRate };
}
