/**
 * 初回MVPリリース時の機能フラグ。単一ソース。
 *
 * SHOW_PRO: Pro導線・保存/旅行数上限の露出を一括制御する。
 * 現在は true（購入・復元・実価格表示に加え、FREE_LIMITS実制御（保存/旅行数上限のブロックとPro導線表示）
 * まで接続済み。2026-07-13確認、詳細は`.claude/mvp-tasks.md`項目7参照）。
 * 設定画面の導線・Pro関連ルート（pro / pro-features / purchase-confirm / purchase-complete / purchase-restore）・
 * 保存上限バナーがこのフラグで一括制御される。
 */
export const SHOW_PRO = true;
