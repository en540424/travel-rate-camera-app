// Web版履歴フック: expo-sqlite を使わず localStorage にフォールバック。
// Metro は .web.ts を Web ビルドで優先採用するため、
// use-history.ts（expo-sqlite 使用）は iOS/Android のみで使われる。
import { useCallback, useEffect, useState } from 'react';

import type { CurrencyCode } from '@/constants/currencies';
import { FREE_HISTORY_LIMIT } from '@/db/queries/history';
import type { HistoryRow } from '@/db/queries/history';
import { useIsPro } from '@/hooks/use-purchases';
import { useTripStore } from '@/stores/trip-store';

const STORAGE_KEY = 'travelrate:history';

let idCounter = Date.now();

function loadAll(): HistoryRow[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return (JSON.parse(raw) as Partial<HistoryRow & { purchase_date?: string }>[]).map((r) => ({
      id: r.id ?? 0,
      currency: (r.currency ?? 'USD') as CurrencyCode,
      foreign_amount: r.foreign_amount ?? 0,
      jpy_amount: r.jpy_amount ?? 0,
      rate_used: r.rate_used ?? 0,
      trip_id: r.trip_id ?? null,
      is_purchased: (r.is_purchased === 1 ? 1 : 0) as 0 | 1,
      // 旧フィールド purchase_date も読み込めるよう互換処理
      purchased_at: r.purchased_at ?? r.purchase_date ?? null,
      updated_at: r.updated_at ?? null,
      created_at: r.created_at ?? '',
      memo: r.memo ?? null,
      image_uri: r.image_uri ?? null,
      entry_date: r.entry_date ?? null,
    }));
  } catch {
    return [];
  }
}

function persistAll(rows: HistoryRow[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(rows));
  } catch {}
}

export function useHistory() {
  const isPro = useIsPro();
  const activeTrip = useTripStore((s) => s.activeTrip);
  const [history, setHistoryState] = useState<HistoryRow[]>([]);
  const [totalCount, setTotalCount] = useState(0);

  const load = useCallback(() => {
    const all = loadAll();
    const rows = activeTrip
      ? all.filter((r) => r.trip_id === activeTrip.id)
      : all;
    setTotalCount(rows.length);
    // 初回MVPは保存上限を露出しない方針のため、表示件数はFREE_HISTORY_LIMIT(30)で切らない（P0-04）。
    const limit = 500;
    setHistoryState(rows.slice(0, limit));
  }, [activeTrip]);

  useEffect(() => {
    load();
  }, [load]);

  /** 無料版は保存件数がFREE_LIMITS.saves以上ならブロックする（Proは無制限）。保存処理の唯一の入口。 */
  async function addEntry(
    currency: CurrencyCode,
    foreignAmount: number,
    jpyAmount: number,
    rateUsed: number,
    memo?: string,
    imageUri?: string,
    isPurchased?: boolean,
  ): Promise<{ blocked: boolean }> {
    if (!activeTrip) return { blocked: false };
    if (!isPro && totalCount >= FREE_HISTORY_LIMIT) return { blocked: true };
    const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
    const entry: HistoryRow = {
      id: idCounter++,
      currency,
      foreign_amount: foreignAmount,
      jpy_amount: jpyAmount,
      rate_used: rateUsed,
      trip_id: activeTrip.id,
      is_purchased: isPurchased ? 1 : 0,
      purchased_at: isPurchased ? now : null,
      updated_at: now,
      created_at: now,
      memo: memo ?? null,
      image_uri: imageUri ?? null,
      entry_date: null,
    };
    persistAll([entry, ...loadAll()]);
    load();
    return { blocked: false };
  }

  async function removeEntry(id: number) {
    persistAll(loadAll().filter((r) => r.id !== id));
    load();
  }

  async function clearAll() {
    if (activeTrip) {
      persistAll(loadAll().filter((r) => r.trip_id !== activeTrip.id));
    } else {
      persistAll([]);
    }
    load();
  }

  async function togglePurchased(id: number, currentValue: 0 | 1) {
    const isPurchased = currentValue === 0;
    const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
    persistAll(
      loadAll().map((r) =>
        r.id === id
          ? {
              ...r,
              is_purchased: (isPurchased ? 1 : 0) as 0 | 1,
              purchased_at: isPurchased ? now : null,
              updated_at: now,
            }
          : r,
      ),
    );
    load();
  }

  async function updateAmount(id: number, foreignAmount: number, jpyAmount: number) {
    const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
    persistAll(
      loadAll().map((r) =>
        r.id === id
          ? { ...r, foreign_amount: foreignAmount, jpy_amount: jpyAmount, updated_at: now }
          : r,
      ),
    );
    load();
  }

  async function updateMemo(id: number, memo: string | null) {
    const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
    persistAll(
      loadAll().map((r) =>
        r.id === id ? { ...r, memo, updated_at: now } : r,
      ),
    );
    load();
  }

  async function updateEntryDate(id: number, entryDate: string | null) {
    const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
    persistAll(
      loadAll().map((r) =>
        r.id === id ? { ...r, entry_date: entryDate, updated_at: now } : r,
      ),
    );
    load();
  }

  async function updateImageUri(id: number, imageUri: string | null) {
    const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
    persistAll(
      loadAll().map((r) =>
        r.id === id ? { ...r, image_uri: imageUri, updated_at: now } : r,
      ),
    );
    load();
  }

  const isAtFreeLimit = !isPro && totalCount >= FREE_HISTORY_LIMIT;

  return {
    history,
    totalCount,
    isAtFreeLimit,
    addEntry,
    removeEntry,
    clearAll,
    togglePurchased,
    updateAmount,
    updateMemo,
    updateEntryDate,
    updateImageUri,
    reload: load,
  };
}
