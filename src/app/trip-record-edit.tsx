/**
 * 「旅行の記録」（trip-records）から開く記録の編集画面。
 *
 * 中身は履歴タブの編集画面（`(tabs)/history/item-edit.tsx`）と同一のコンポーネントを再利用する（別実装を持たない）。
 * trip-recordsはルートStackの画面で、履歴タブのネストStackへpushすると下タブ側のStackへ移ってしまうため、
 * ルートStackにも同じ画面を登録して、戻ると「旅行の記録」へ帰るようにしている。
 */
export { default } from './(tabs)/history/item-edit';
