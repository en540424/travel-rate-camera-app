// 下タブ切替時のスクロール先頭リセット用の小さな登録簿。
// 各主要タブ画面（index/history/calendar/analytics/settings）が自身のscrollToTop関数を
// registerTabScrollResetで登録し、(tabs)/_layout.tsxのtabPress（タブバー押下）イベントから
// triggerTabScrollResetで該当タブの関数だけを呼び出す。
// タブ内の詳細/編集画面から戻る操作ではtabPressが発火しないため、この仕組みはスクロール位置の
// 維持を壊さない。
type ResetFn = () => void;

const registry = new Map<string, ResetFn>();

export function registerTabScrollReset(routeName: string, fn: ResetFn): () => void {
  registry.set(routeName, fn);
  return () => {
    if (registry.get(routeName) === fn) registry.delete(routeName);
  };
}

export function triggerTabScrollReset(routeName: string): void {
  registry.get(routeName)?.();
}
