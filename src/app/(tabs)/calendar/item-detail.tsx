/**
 * カレンダーの「選択日の記録」から開く商品の詳細画面。
 *
 * 中身は履歴タブの詳細画面（`(tabs)/history/item-detail.tsx`）と同一のコンポーネントを再利用する（別実装を持たない）。
 * 履歴タブのネストStackへpushすると下タブが履歴へ切り替わり、戻ると履歴一覧へ着いてしまうため、
 * カレンダータブのStackにも同じ画面を登録して、戻るとカレンダーへ帰るようにしている（`trip-record-edit.tsx`と同じ方式）。
 */
export { default } from '../history/item-detail';
