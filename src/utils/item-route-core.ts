/**
 * 商品の詳細・編集画面のroute（純粋関数）。
 *
 * **react-native・`@/`エイリアス・相対の値importを一切持たない自己完結モジュール。**
 * `node --test`から直接importして検証できる状態を保つ（`analytics-core.ts`等と同じ規律）。
 *
 * ■ 詳細・編集は2つのタブのStackに同じ画面として登録している
 *   - 履歴タブ：`(tabs)/history/_layout.tsx`（`/history/item-detail`・`/history/item-edit`）
 *   - カレンダータブ：`(tabs)/calendar/_layout.tsx`（`/calendar/item-detail`・`/calendar/item-edit`。中身は再export）
 *   別のタブに属するURLへpushすると下タブがそちらへ切り替わり、戻るとそのタブのStackをpopする
 *   （Expo Router公式「Going back to the tab you came from」）。2026-10-25まではカレンダーから
 *   `/history/item-detail`へpushしていたため、戻ると履歴一覧へ着いていた。
 *   詳細から開く編集・戻れない時の戻り先は、**いま詳細を開いているタブのStackの中**で決める。
 */

export type ItemStackBase = '/history' | '/calendar';

/**
 * いま開いている画面のpathname（`usePathname()`。route groupの`(tabs)`は含まない）から、
 * 詳細・編集を積むStackを返す。カレンダータブの中なら`/calendar`、それ以外はすべて従来どおり`/history`。
 */
export function itemStackBaseOf(pathname: string | null | undefined): ItemStackBase {
  if (typeof pathname !== 'string') return '/history';
  return pathname === '/calendar' || pathname.startsWith('/calendar/') ? '/calendar' : '/history';
}

/** 詳細画面の「編集する」で開く編集画面のpathname（詳細と同じタブのStackへ積む） */
export function itemEditPathnameFor(pathname: string | null | undefined): `${ItemStackBase}/item-edit` {
  return `${itemStackBaseOf(pathname)}/item-edit`;
}
