import { create } from 'zustand';

interface UnsavedChangesStore {
  /**
   * 商品編集画面で未保存の変更があるかどうか。
   * (tabs)/_layout.tsx のtabPressリスナーが下タブ移動の確認Alert判定に使う。
   */
  hasUnsavedChanges: boolean;
  setHasUnsavedChanges: (v: boolean) => void;
}

export const useUnsavedChangesStore = create<UnsavedChangesStore>((set) => ({
  hasUnsavedChanges: false,
  setHasUnsavedChanges: (v) => set({ hasUnsavedChanges: v }),
}));
