/**
 * `config/categories.ts`の検証（`node --test src/config/categories.test.mjs`）。
 *
 * 最重要の観点は「DBへ保存するのは英字id」であること。日本語ラベルが保存値として
 * 漏れ出すと、ラベルを言い換えた瞬間に既存recordが孤児になる（一方通行の事故）。
 */
import { deepEqual, equal, ok } from 'node:assert/strict';
import { test } from 'node:test';

import {
  CATEGORIES,
  UNCATEGORIZED_LABEL,
  aggregateByCategory,
  getCategoryLabel,
  isCategoryId,
  normalizeCategoryId,
} from './categories.ts';

test('CATEGORIES: 想定6カテゴリーを定義順で持つ', () => {
  deepEqual(
    CATEGORIES.map((c) => c.id),
    ['food', 'souvenir', 'clothing', 'transport', 'entertainment', 'other'],
  );
  deepEqual(
    CATEGORIES.map((c) => c.label),
    ['食事', 'お土産', '衣類', '交通', '娯楽', 'その他'],
  );
});

test('CATEGORIES: idは全て英字slug（日本語ラベルをidにしない）', () => {
  for (const c of CATEGORIES) {
    ok(/^[a-z]+$/.test(c.id), `id "${c.id}" が英小文字のみではない`);
  }
});

test('CATEGORIES: idが重複していない', () => {
  equal(new Set(CATEGORIES.map((c) => c.id)).size, CATEGORIES.length);
});

test('isCategoryId: 既知のidだけtrue', () => {
  equal(isCategoryId('food'), true);
  equal(isCategoryId('other'), true);
  equal(isCategoryId('unknown'), false);
  equal(isCategoryId('食事'), false); // 日本語ラベルはidではない
  equal(isCategoryId(''), false);
  equal(isCategoryId(null), false);
  equal(isCategoryId(undefined), false);
});

test('normalizeCategoryId: 未知・未設定はnullへ寄せる', () => {
  equal(normalizeCategoryId('souvenir'), 'souvenir');
  equal(normalizeCategoryId('legacy_removed_category'), null);
  equal(normalizeCategoryId(null), null);
  equal(normalizeCategoryId(undefined), null);
  equal(normalizeCategoryId(''), null);
});

test('getCategoryLabel: idを日本語ラベルへ変換する', () => {
  equal(getCategoryLabel('food'), '食事');
  equal(getCategoryLabel('souvenir'), 'お土産');
  equal(getCategoryLabel('clothing'), '衣類');
  equal(getCategoryLabel('transport'), '交通');
  equal(getCategoryLabel('entertainment'), '娯楽');
  equal(getCategoryLabel('other'), 'その他');
});

test('getCategoryLabel: 未設定・未知の値は「未分類」（「その他」に寄せない）', () => {
  equal(getCategoryLabel(null), UNCATEGORIZED_LABEL);
  equal(getCategoryLabel(undefined), UNCATEGORIZED_LABEL);
  equal(getCategoryLabel('unknown'), UNCATEGORIZED_LABEL);
  equal(UNCATEGORIZED_LABEL, '未分類');
  // 「その他」は選んだ結果であり、未分類とは別物であることを明示的に固定する
  ok(getCategoryLabel('other') !== getCategoryLabel(null));
});

test('aggregateByCategory: カテゴリー別に件数と金額合計を出す', () => {
  const rows = aggregateByCategory([
    { category: 'food', jpyAmount: 1000 },
    { category: 'food', jpyAmount: 500 },
    { category: 'souvenir', jpyAmount: 2000 },
  ]);
  deepEqual(
    rows.map((r) => ({ id: r.id, total: r.total, count: r.count })),
    [
      { id: 'souvenir', total: 2000, count: 1 },
      { id: 'food', total: 1500, count: 2 },
    ],
  );
});

test('aggregateByCategory: 金額合計の降順で並ぶ', () => {
  const rows = aggregateByCategory([
    { category: 'food', jpyAmount: 100 },
    { category: 'transport', jpyAmount: 900 },
    { category: 'clothing', jpyAmount: 500 },
  ]);
  deepEqual(rows.map((r) => r.id), ['transport', 'clothing', 'food']);
});

test('aggregateByCategory: 同額はCATEGORIESの定義順で安定する', () => {
  const rows = aggregateByCategory([
    { category: 'entertainment', jpyAmount: 300 },
    { category: 'food', jpyAmount: 300 },
    { category: 'clothing', jpyAmount: 300 },
  ]);
  // 定義順は food(0) → clothing(2) → entertainment(4)
  deepEqual(rows.map((r) => r.id), ['food', 'clothing', 'entertainment']);
});

test('aggregateByCategory: 構成比（share）は金額比で0〜1', () => {
  const rows = aggregateByCategory([
    { category: 'food', jpyAmount: 750 },
    { category: 'souvenir', jpyAmount: 250 },
  ]);
  equal(rows[0].share, 0.75);
  equal(rows[1].share, 0.25);
  equal(rows.reduce((sum, r) => sum + r.share, 0), 1);
});

test('aggregateByCategory: 合計0円でもshareは0（0除算しない）', () => {
  const rows = aggregateByCategory([
    { category: 'food', jpyAmount: 0 },
    { category: 'souvenir', jpyAmount: 0 },
  ]);
  equal(rows.length, 2);
  for (const r of rows) equal(r.share, 0);
});

test('aggregateByCategory: nullは「未分類」として独立集計する（その他と統合しない）', () => {
  const rows = aggregateByCategory([
    { category: null, jpyAmount: 1000 },
    { category: 'other', jpyAmount: 1000 },
  ]);
  equal(rows.length, 2);
  const uncategorized = rows.find((r) => r.id === null);
  const other = rows.find((r) => r.id === 'other');
  equal(uncategorized.label, '未分類');
  equal(other.label, 'その他');
  equal(uncategorized.count, 1);
  equal(other.count, 1);
});

test('aggregateByCategory: 未分類は同額でも常に最後に並ぶ', () => {
  const rows = aggregateByCategory([
    { category: null, jpyAmount: 500 },
    { category: 'food', jpyAmount: 500 },
  ]);
  deepEqual(rows.map((r) => r.id), ['food', null]);
});

test('aggregateByCategory: 未知のカテゴリー値は未分類へ寄せる', () => {
  const rows = aggregateByCategory([
    { category: 'legacy_removed', jpyAmount: 100 },
    { category: undefined, jpyAmount: 200 },
  ]);
  equal(rows.length, 1);
  equal(rows[0].id, null);
  equal(rows[0].count, 2);
  equal(rows[0].total, 300);
});

test('aggregateByCategory: 空入力は空配列（0円の行で埋めない）', () => {
  deepEqual(aggregateByCategory([]), []);
});

test('aggregateByCategory: 数値でない金額は0として扱い、集計を壊さない', () => {
  const rows = aggregateByCategory([
    { category: 'food', jpyAmount: Number.NaN },
    { category: 'food', jpyAmount: 100 },
  ]);
  equal(rows.length, 1);
  equal(rows[0].total, 100);
  equal(rows[0].count, 2); // 件数としては数える
});
