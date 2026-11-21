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

/**
 * DEV_BYPASS_FREE_LIMITS: development build／__DEV__時のみ、無料版の旅行数・保存数上限と
 * それに伴うPro案内シート表示を無視する（実機検証専用）。
 * __DEV__はMetro接続のdevelopment client（distribution: internal, developmentClient: true）でのみtrueになり、
 * preview/production/TestFlightビルドはJSがrelease modeでバンドルされるため常にfalse。
 * RevenueCat Entitlement・isPro・Pro画面表示・FREE_LIMITSの数値そのものには一切影響しない。
 */
export const DEV_BYPASS_FREE_LIMITS = __DEV__;

/**
 * SHOW_PRO_PLUS: Pro+（買い物マップ・旅行スケジュール・AI翻訳）の入口を出すか。**初回の正式公開まではfalse。**
 * Pro+の商品（ASC・RevenueCat）・価格・利用枠・DB v8（H-P5）・AIの中継サーバーがHuman承認前のため、本番では一切出さない。
 * 判定は `lib/proplus/proplus-access-core.ts`（フラグ無効なら全プランで非表示）。
 */
export const SHOW_PRO_PLUS = false;

/**
 * DEV_PRO_PLUS_PREVIEW: development build／__DEV__時のみ、Pro+の入口を出し、Pro+の契約がある扱いにする（実機検証専用）。
 * preview/production/TestFlightビルドでは常にfalse（`DEV_BYPASS_FREE_LIMITS`と同じ考え方）。
 * RevenueCatの判定（planTier・isPro）・購入・復元には一切影響しない。
 */
export const DEV_PRO_PLUS_PREVIEW = __DEV__;
