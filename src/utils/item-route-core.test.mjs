/**
 * 商品の詳細・編集のroute（`node --test src/utils/item-route-core.test.mjs`）。
 *
 * 2026-10-25 TestFlight 1.0.0 (4)の実機（Human確認）：カレンダーで日付の記録をタップすると商品の詳細が開くが、
 * 左上が「履歴」で、戻ると履歴一覧へ移動していた。原因はカレンダーが履歴タブのStackの`/history/item-detail`へ
 * pushしていたこと（別のタブに属するURLへのpushは下タブを切り替え、戻るとそのタブのStackをpopする。Expo Router公式
 * 「Going back to the tab you came from」）。修正：カレンダータブにもStack（`calendar/_layout.tsx`）を置き、
 * 同じ詳細・編集画面を再exportで登録して、そこへpushする。
 *
 * 画面遷移そのものは実機でしか確かめられない（TEST_CHECKLIST #86）。ここでは
 *   (1) 詳細から開く編集・戻れない時の戻り先が、開いているタブのStackの中で決まること（純粋関数）
 *   (2) ルートの組み方が崩れていないこと（Typed Routesの型生成がこのworktreeには無く、tscではパスの誤りを検出できないため、
 *       ソースを読んで固定する）
 * を確かめる。
 */
import { deepEqual, equal, ok } from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { itemEditPathnameFor, itemStackBaseOf } from './item-route-core.ts';

// ─── (1) 純粋関数 ─────────────────────────────────────────────

test('カレンダータブの中なら、編集・戻り先はカレンダーのStack', () => {
  equal(itemStackBaseOf('/calendar/item-detail'), '/calendar');
  equal(itemStackBaseOf('/calendar/item-edit'), '/calendar');
  equal(itemStackBaseOf('/calendar'), '/calendar');
  equal(itemEditPathnameFor('/calendar/item-detail'), '/calendar/item-edit');
});

test('履歴タブの中は従来どおり履歴のStack', () => {
  equal(itemStackBaseOf('/history/item-detail'), '/history');
  equal(itemStackBaseOf('/history/item-edit'), '/history');
  equal(itemEditPathnameFor('/history/item-detail'), '/history/item-edit');
});

test('それ以外・不明なpathnameは従来どおり履歴（壊れた戻り先を作らない）', () => {
  for (const p of ['/trip-record-edit', '/', '', '/calendarx/item-detail', '/history', undefined, null]) {
    equal(itemStackBaseOf(p), '/history', String(p));
    equal(itemEditPathnameFor(p), '/history/item-edit', String(p));
  }
});

// ─── (2) ルートの組み方 ───────────────────────────────────────

const TABS = fileURLToPath(new URL('../app/(tabs)/', import.meta.url));
const read = (rel) => readFileSync(TABS + rel, 'utf8');

test('カレンダーは1つだけ：旧`(tabs)/calendar.tsx`が残っていない（下タブの二重生成を防ぐ）', () => {
  ok(!existsSync(TABS + 'calendar.tsx'));
  ok(existsSync(TABS + 'calendar/index.tsx'));
  ok(existsSync(TABS + 'calendar/_layout.tsx'));
});

test('下タブの構成は従来どおり（`calendar`・`history`のTabs.Screenは1つずつ）', () => {
  const tabs = read('_layout.tsx');
  const names = [...tabs.matchAll(/<Tabs\.Screen\s+name="([^"]+)"/g)].map((m) => m[1]);
  deepEqual(names, ['index', 'translation', 'converter', 'history', 'calendar', 'analytics', 'settings']);
});

test('カレンダーのStack：詳細（戻るは「カレンダー」）・編集を登録し、直接開いてもカレンダー本体が下に入る', () => {
  const layout = read('calendar/_layout.tsx');
  ok(/<Stack\.Screen name="index"/.test(layout));
  // 同じ<Stack.Screen>のoptionsの中だけを見る（隣の画面の戻るタイトルにマッチしないように）
  ok(/name="item-detail"\s*options=\{\{[^}]*headerBackTitle: 'カレンダー'/.test(layout));
  ok(/name="item-edit"\s*options=\{\{[^}]*headerBackTitle: '商品の詳細'/.test(layout));
  ok(/anchor: 'index'/.test(layout));
});

test('カレンダーの詳細・編集は履歴と同じ画面の再export（別実装を持たない）', () => {
  ok(/export \{ default \} from '\.\.\/history\/item-detail';/.test(read('calendar/item-detail.tsx')));
  ok(/export \{ default \} from '\.\.\/history\/item-edit';/.test(read('calendar/item-edit.tsx')));
});

test('カレンダーの記録は自分のタブの詳細へpushし、履歴タブのURLへは行かない', () => {
  const calendar = read('calendar/index.tsx');
  ok(calendar.includes("pathname: '/calendar/item-detail'"));
  ok(!calendar.includes("'/history/item-detail'"));
  ok(!calendar.includes("'/history/item-edit'"));
});

test('詳細画面の「編集する」は、開いているタブのStackの編集画面へ（`/history/item-edit`を直書きしない）', () => {
  const detail = read('history/item-detail.tsx');
  ok(detail.includes('itemEditPathnameFor(pathname)'));
  ok(!detail.includes("pathname: '/history/item-edit'"));
});

test('履歴タブのStackは従来どおり（戻るは「履歴」）', () => {
  const layout = read('history/_layout.tsx');
  ok(/name="item-detail"\s*options=\{\{[^}]*headerBackTitle: '履歴'/.test(layout));
  ok(/name="item-edit"\s*options=\{\{[^}]*headerBackTitle: '商品の詳細'/.test(layout));
  ok(read('history/index.tsx').includes("pathname: '/history/item-detail'"));
});
