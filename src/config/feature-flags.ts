/**
 * 初回MVPリリース時の機能フラグ。単一ソース。
 *
 * SHOW_PRO: Pro（RevenueCat）は未実装のため、Pro導線・保存/旅行数上限の露出をすべて隠す。
 * Pro実装が完了しリリースする時に true へ切り替えるだけで、
 * 設定画面の導線・Pro関連ルート（pro / pro-features / purchase-confirm / purchase-complete / purchase-restore）・
 * 保存上限バナーが一括で復活する想定。
 */
export const SHOW_PRO = false;
