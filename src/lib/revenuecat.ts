// tsc用のフォールバック解決先（TypeScriptはMetroのプラットフォーム別解決を認識しないため必要）。
// 実行時はMetroが .native.ts（iOS/Android）/ .web.ts（Web）を優先採用し、このファイルは読み込まれない。
export * from './revenuecat.native';
