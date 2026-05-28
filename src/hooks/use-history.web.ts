// Web版履歴フック: expo-sqlite を使わず localStorage にフォールバック。
// Metro は .web.ts を Web ビルドで優先採用するため、
// use-history.ts（expo-sqlite 使用）は iOS/Android のみで使われる。
import { useCallback, useEffect, useState } from 'react';

import type { CurrencyCode } from '@/constants/currencies';
import { FREE_HISTORY_LIMIT } from '@/db/queries/history';
import type { HistoryRow } from '@/db/queries/history';
import { useSettingsStore } from '@/stores/settings-store';

const STORAGE_KEY = 'travelrate:history';

// Web 用簡易 ID（セッションをまたいでも重複しにくいよう timestamp ベース）
let idCounter = Date.now();

function loadAll(): HistoryRow[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as HistoryRow[]) : [];
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
  const isPro = useSettingsStore((s) => s.isPro);
  const [history, setHistoryState] = useState<HistoryRow[]>([]);
  const [totalCount, setTotalCount] = useState(0);

  const load = useCallback(() => {
    const all = loadAll();
    setTotalCount(all.length);
    const limit = isPro ? 500 : FREE_HISTORY_LIMIT;
    setHistoryState(all.slice(0, limit));
  }, [isPro]);

  useEffect(() => {
    load();
  }, [load]);

  async function addEntry(
    currency: CurrencyCode,
    foreignAmount: number,
    jpyAmount: number,
    rateUsed: number,
  ) {
    const all = loadAll();
    const entry: HistoryRow = {
      id: idCounter++,
      currency,
      foreign_amount: foreignAmount,
      jpy_amount: jpyAmount,
      rate_used: rateUsed,
      trip_id: null,
      // SQLite の datetime('now') に合わせた形式
      created_at: new Date().toISOString().replace('T', ' ').slice(0, 19),
    };
    persistAll([entry, ...all]);
    load();
  }

  async function removeEntry(id: number) {
    persistAll(loadAll().filter((r) => r.id !== id));
    load();
  }

  async function clearAll() {
    persistAll([]);
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
    /** localStorage から再読込（タブフォーカス時など） */
    reload: load,
  };
}
