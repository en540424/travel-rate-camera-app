import type { SQLiteDatabase } from 'expo-sqlite';

import type { CurrencyCode } from '@/constants/currencies';
import { CURRENCY_CODES } from '@/constants/currencies';

export interface RateRow {
  id: number;
  currency: CurrencyCode;
  rate: number;
  updated_at: string;
}

/** 全通貨のレートを取得。DBにない通貨はデフォルト0で補完 */
export async function getAllRates(
  db: SQLiteDatabase,
): Promise<Record<CurrencyCode, number>> {
  const rows = await db.getAllAsync<RateRow>(
    'SELECT * FROM exchange_rates',
  );

  const map = Object.fromEntries(CURRENCY_CODES.map((c) => [c, 0])) as Record<CurrencyCode, number>;
  for (const row of rows) {
    map[row.currency] = row.rate;
  }
  return map;
}

/** 1通貨のレートを upsert */
export async function upsertRate(
  db: SQLiteDatabase,
  currency: CurrencyCode,
  rate: number,
): Promise<void> {
  await db.runAsync(
    `INSERT INTO exchange_rates (currency, rate, updated_at)
     VALUES (?, ?, datetime('now'))
     ON CONFLICT(currency) DO UPDATE SET rate = excluded.rate, updated_at = excluded.updated_at`,
    currency,
    rate,
  );
}

/** 複数通貨を一括 upsert */
export async function upsertRates(
  db: SQLiteDatabase,
  rates: Partial<Record<CurrencyCode, number>>,
): Promise<void> {
  await db.withTransactionAsync(async () => {
    for (const [currency, rate] of Object.entries(rates)) {
      await upsertRate(db, currency as CurrencyCode, rate!);
    }
  });
}
