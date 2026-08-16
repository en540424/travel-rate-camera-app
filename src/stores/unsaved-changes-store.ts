import { create } from 'zustand';

interface UnsavedChangesStore {
  /**
   * 商品編集画面で未保存の変更があるかどうか。
   * (tabs)/_layout.tsx のtabPressリスナーが下タブ移動の確認Alert判定に使う。
   */
  hasUnsavedChanges: boolean;
  setHasUnsavedChanges: (v: boolean) => void;
  /**
   * 「破棄して移動」が選ばれた時に、編集画面側の下書きを読み込み時点へ戻すための後始末。
   *
   * 下タブ移動（tabPress）では編集画面はアンマウントされず、履歴スタックに載ったまま残る。
   * そのためフラグを下ろすだけでは編集中のstateが生き続け、次にその画面へ戻った時に
   * 「破棄したはずの変更」が表示されてしまう。写真の場合は下書きfileを削除した後の
   * URIを指したままになり、サムネイルが壊れる。編集画面が自身のrevert処理をここへ
   * 登録し、ガード側は中身を知らないまま呼ぶ。
   */
  discardHandler: (() => void) | null;
  setDiscardHandler: (fn: (() => void) | null) => void;
}

export const useUnsavedChangesStore = create<UnsavedChangesStore>((set) => ({
  hasUnsavedChanges: false,
  setHasUnsavedChanges: (v) => set({ hasUnsavedChanges: v }),
  discardHandler: null,
  setDiscardHandler: (fn) => set({ discardHandler: fn }),
}));
