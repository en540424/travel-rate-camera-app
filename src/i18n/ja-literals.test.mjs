/**
 * 日本語の直書きが増えていないかの検査（GX-03・GX-13・2026-11-28）。
 * 新しい画面・機能は翻訳キー（`useT()`・`src/i18n/dict/`）で書く。既存の直書きはファイルごとの基準値まで許し、
 * キー化（GX-07）で減ったら `node scripts/i18n/ja-literals.mjs --update` で基準値を下げる。
 */
import { deepEqual } from 'node:assert/strict';
import { test } from 'node:test';

import { readBaseline, regressions, scan, staleBaselines } from '../../scripts/i18n/ja-literals.mjs';

const current = scan();
const baseline = readBaseline();

test('日本語の直書きが基準値より増えていない（新しいファイルは0）', () => {
  deepEqual(regressions(current, baseline), []);
});

test('減ったファイルは基準値も下げてある（下げ忘れで新しい直書きが通らないように）', () => {
  deepEqual(staleBaselines(current, baseline), []);
});
