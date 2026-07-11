/**
 * 初回MVPリリース時の機能フラグ。単一ソース。
 *
 * SHOW_PRO: Pro導線・保存/旅行数上限の露出を一括制御する。
 * 現在は実機確認用に true（RevenueCatバッチ1: 購入・復元・実価格表示は接続済み。
 * 実購入・FREE_LIMITS enforcementはまだ未実装）。
 * 設定画面の導線・Pro関連ルート（pro / pro-features / purchase-confirm / purchase-complete / purchase-restore）・
 * 保存上限バナーがこのフラグで一括制御される。
 */
export const SHOW_PRO = true;
