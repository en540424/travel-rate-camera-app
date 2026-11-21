/**
 * Pro+のデータの状態（場所・記録との紐付け・予定）。操作の中身は `lib/proplus/proplus-store-core.ts`（純粋関数・テスト済み）。
 * ここは読み込み・保存とReactへの受け渡しだけを持つ。
 *
 * - 操作と保存は1本の列（キュー）で順番に流す。連打しても保存が重ならず、一時ファイルを取り合わない
 * - 保存に失敗したら状態を戻し、呼び出し側へエラーを返す（画面は保存されたと誤認しない）
 * - 読み込めないファイルがある時（blocked）は書き込みをすべて止める（上書きして利用者のデータを失わないため）
 */
import { create } from 'zustand';

import {
  addEvent, addPlace, deleteEvent, deletePlace, EMPTY_PROPLUS_STATE, newLocalId, reconcileWithRecords,
  setRecordPlace, updateEvent, updatePlace, type Clock, type OpResult, type ProPlusState,
} from '@/lib/proplus/proplus-store-core';
import { loadProPlusState, saveProPlusState } from '@/lib/proplus/proplus-storage';

const clock: Clock = { now: () => new Date().toISOString(), newId: newLocalId };

type Status = 'idle' | 'loading' | 'ready' | 'blocked';

type ProPlusStore = {
  status: Status;
  blockedReason: string | null;
  data: ProPlusState;
  load: () => Promise<void>;
  /** 純粋な操作を適用して保存する。保存に失敗したら元に戻してエラーを返す */
  apply: <T>(op: (s: ProPlusState, c: Clock) => OpResult<T>) => Promise<OpResult<T>>;
  /**
   * 記録の削除後に、消えた記録への紐付けを整理する。**全旅行の記録IDを渡すこと**
   * （一部だけを渡すと、渡さなかった記録の場所が消える）。現時点で呼び出し元は無い（DB v8の承認後に削除処理と合わせて接続する）
   */
  reconcileAllRecords: (allHistoryIds: ReadonlySet<number>) => Promise<void>;
};

// 操作と保存を1本ずつ流す列
let queue: Promise<unknown> = Promise.resolve();
function enqueue<T>(job: () => Promise<T>): Promise<T> {
  const run = queue.then(job, job);
  queue = run.catch(() => undefined);
  return run;
}

export const useProPlusStore = create<ProPlusStore>((set, get) => ({
  status: 'idle',
  blockedReason: null,
  data: EMPTY_PROPLUS_STATE,
  load: async () => {
    if (get().status !== 'idle') return;
    set({ status: 'loading' });
    const r = await loadProPlusState();
    if (r.status === 'blocked') set({ status: 'blocked', blockedReason: r.reason, data: r.state });
    else set({ status: 'ready', blockedReason: null, data: r.state });
  },
  apply: (op) =>
    enqueue(async () => {
      if (get().status !== 'ready') return { ok: false as const, errors: ['Pro+のデータを読み込めていないため保存できません'] };
      const prev = get().data;
      const r = op(prev, clock);
      if (!r.ok) return r;
      set({ data: r.state });
      try {
        await saveProPlusState(r.state);
        return r;
      } catch (e) {
        // 列で1本ずつ流しているので、ここで戻す先（prev）は直前に保存できた状態
        set({ data: prev });
        if (__DEV__) console.warn('[proplus] save failed', e);
        return { ok: false as const, errors: ['保存できませんでした。もう一度お試しください'] };
      }
    }),
  reconcileAllRecords: (ids) =>
    enqueue(async () => {
      if (get().status !== 'ready') return;
      const prev = get().data;
      const next = reconcileWithRecords(prev, ids, clock);
      if (next === prev) return;
      set({ data: next });
      try {
        await saveProPlusState(next);
      } catch {
        set({ data: prev });
      }
    }),
}));

export const proPlusOps = { addPlace, updatePlace, deletePlace, setRecordPlace, addEvent, updateEvent, deleteEvent };
