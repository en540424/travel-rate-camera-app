/**
 * `utils/currency.ts`の検証（`node --test src/utils/currency.test.mjs`）。
 * 主眼はJPY建て入力の保存値正規化（`normalizeJpyInput`）。外貨→円の`toJpy`は丸めないことも併せて固定する。
 */
import { equal } from 'node:assert/strict';
import { test } from 'node:test';

import { normalizeJpyInput, toJpy } from './currency.ts';

test('normalizeJpyInput: 整数はそのまま', () => {
  equal(normalizeJpyInput(1200), 1200);
  equal(normalizeJpyInput(1), 1);
});

test('normalizeJpyInput: 小数JPYは Math.round で整数円へ（表示の formatJpy と同じ値になる）', () => {
  equal(normalizeJpyInput(1200.5), 1201);
  equal(normalizeJpyInput(1200.4), 1200);
  equal(normalizeJpyInput(1200.49), 1200);
});

test('normalizeJpyInput: 丸めて0になる値・非有限値は0（呼び出し側の「0より大きい」判定で保存不可になる）', () => {
  equal(normalizeJpyInput(0.4), 0);
  equal(normalizeJpyInput(0), 0);
  equal(normalizeJpyInput(NaN), 0);
  equal(normalizeJpyInput(Infinity), 0);
});

test('toJpy: 外貨→円の換算値は丸めない（外貨記録の jpy_amount は従来どおり小数を保持する）', () => {
  equal(toJpy(38.5, 152.3), 38.5 * 152.3);
  equal(toJpy(10, 0.11), 10 * 0.11);
});
