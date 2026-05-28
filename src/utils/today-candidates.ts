import { Platform } from 'react-native';

import type { HistoryRow } from '@/db/queries/history';

/** use-history.web.ts と同じキー（Web の集計用） */
const WEB_HISTORY_STORAGE_KEY = 'travelrate:history';

function getTodayKey(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * created_at は UTC の "YYYY-MM-DD HH:mm:ss"（末尾 Z なし）で保存されている前提。
 */
export function isCreatedAtToday(createdAt: string): boolean {
  const isoUtc = createdAt.includes('T')
    ? createdAt
    : `${createdAt.replace(' ', 'T')}Z`;
  const local = new Date(isoUtc);
  const y = local.getFullYear();
  const m = String(local.getMonth() + 1).padStart(2, '0');
  const day = String(local.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}` === getTodayKey();
}

function loadAllFromWebStorage(): HistoryRow[] {
  try {
    const raw = localStorage.getItem(WEB_HISTORY_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as HistoryRow[]) : [];
  } catch {
    return [];
  }
}

export interface TodayCandidateStats {
  todayCount: number;
  /** 保存時の jpy_amount を丸めて合計（formatJpy と整合） */
  todayTotalJpy: number;
}

/**
 * 今日の候補集計。金額は保存済みの jpy_amount のみ（現在のデモ価格は含めない）。
 */
export function getTodayCandidateStats(rows: HistoryRow[]): TodayCandidateStats {
  const todayRows = rows.filter((r) => isCreatedAtToday(r.created_at));
  const todayTotalJpy = todayRows.reduce(
    (sum, r) => sum + Math.round(r.jpy_amount),
    0,
  );
  return { todayCount: todayRows.length, todayTotalJpy };
}

/**
 * 画面表示用。Web は hook の slice 済み state ではなく localStorage 全件から集計し、
 * タブ間でズレないようにする。
 */
export function getTodayCandidateStatsForDisplay(
  hookRows: HistoryRow[],
): TodayCandidateStats {
  const rows =
    Platform.OS === 'web' ? loadAllFromWebStorage() : hookRows;
  return getTodayCandidateStats(rows);
}
