/**
 * `utils/edit-amount-core.ts`の検証（`node --test src/utils/edit-amount-core.test.mjs`）。
 *
 * 最重要：金額欄が不正なら`{ ok: false }`を返し、呼び出し側（`item-edit.tsx`）はDBへ一切書かず画面に留まる。
 * 旧実装（金額だけ黙ってスキップし、メモ等は保存して画面を閉じる）には「不正」という結果が存在せず、
 * この契約を満たせなかった。その再発防止。
 */
import { deepEqual } from 'node:assert/strict';
import { test } from 'node:test';

import { resolveEditedAmount } from './edit-amount-core.ts';

const jpy = (text, currentJpyAmount = 1200) =>
  resolveEditedAmount({ currency: 'JPY', text, currentForeignAmount: currentJpyAmount, currentJpyAmount, rateUsed: 1 });

const usd = (text, currentForeignAmount = 10, rateUsed = 150) =>
  resolveEditedAmount({
    currency: 'USD',
    text,
    currentForeignAmount,
    currentJpyAmount: Math.round(currentForeignAmount * rateUsed),
    rateUsed,
  });

test('不正な入力は ok:false（DBへ書かない）', () => {
  for (const text of ['', '   ', '0', '-5', 'abc', 'Infinity', 'NaN', '.']) {
    deepEqual(jpy(text), { ok: false }, `JPY "${text}"`);
    deepEqual(usd(text), { ok: false }, `USD "${text}"`);
  }
  // 桁が大きすぎて非有限になる値も拒否する
  deepEqual(usd('1e400'), { ok: false });
});

test('有効だが現在値と同じなら changed:false（DBへ触らない）', () => {
  deepEqual(jpy('1200'), { ok: true, changed: false });
  deepEqual(jpy(' 1200 '), { ok: true, changed: false });
  deepEqual(usd('10'), { ok: true, changed: false });
  deepEqual(usd('10.0'), { ok: true, changed: false });
});

test('JPYは整数で foreign=jpy の同値を返す', () => {
  deepEqual(jpy('1500'), { ok: true, changed: true, foreignAmount: 1500, jpyAmount: 1500 });
  // 旧実装と同じparseInt規則（小数点以下は切り捨て。規則自体はこの修正で変えない）
  deepEqual(jpy('12.5'), { ok: true, changed: true, foreignAmount: 12, jpyAmount: 12 });
});

test('外貨は記録ごとのrate_usedで円換算する（旅行の現在レートではない）', () => {
  deepEqual(usd('12.5'), { ok: true, changed: true, foreignAmount: 12.5, jpyAmount: 1875 });
  // 端数は四捨五入（旧実装のMath.roundと同じ）
  deepEqual(usd('1.005', 10, 150), { ok: true, changed: true, foreignAmount: 1.005, jpyAmount: 151 });
  deepEqual(usd('3', 10, 0.11), { ok: true, changed: true, foreignAmount: 3, jpyAmount: 0 });
});

test('読み込み時の初期値（String(現在値)）は必ず有効かつ changed:false', () => {
  // 金額を触らずメモだけ直した場合に保存がブロックされないことの保証
  deepEqual(jpy(String(1200)), { ok: true, changed: false });
  deepEqual(usd(String(10), 10), { ok: true, changed: false });
  deepEqual(usd(String(0.5), 0.5), { ok: true, changed: false });
});

/**
 * 【仕様固定・2026-09-18】数値として同じなら表記が違っても `changed:false`。
 *
 * `changed`は「`UPDATE conversion_history SET foreign_amount, jpy_amount` を実行する必要があるか」だけを
 * 意味する。DBは `foreign_amount`/`jpy_amount`（REAL）しか持たず金額の文字列表記は保存しないし、
 * 編集欄の初期値も毎回 `String(現在値)` から生成される。したがって `01200`・`1200.0`・`38.00` のような
 * 表記差には保存すべき実体が無く、同値ならDBへ触らないのが正しい（旧実装からの挙動で、不具合ではない）。
 * メモ・カテゴリー・状態・写真は `doSave()` 内でそれぞれ独立に判定・保存され、この結果に左右されない。
 */
test('数値として同じなら表記が違っても changed:false（DBへ書かない＝仕様）', () => {
  // JPY：leading zero・小数点表記・末尾 .0
  deepEqual(jpy('01200'), { ok: true, changed: false });
  deepEqual(jpy('1200.0'), { ok: true, changed: false });
  deepEqual(jpy('1200.00'), { ok: true, changed: false });
  deepEqual(jpy('001200'), { ok: true, changed: false });
  // 外貨：小数表記の桁数差・leading zero
  deepEqual(usd('38.00', 38), { ok: true, changed: false });
  deepEqual(usd('38', 38), { ok: true, changed: false });
  deepEqual(usd('038', 38), { ok: true, changed: false });
  deepEqual(usd('38.0', 38), { ok: true, changed: false });
  deepEqual(usd('0.50', 0.5), { ok: true, changed: false });
});

test('外貨で入力が同値なら rate_used の値に関わらず changed:false（rate_usedは同値判定に関与しない）', () => {
  // rate_usedは「変更あり」の時の円換算にだけ使う。同値なら換算も書き込みも起きない
  for (const rate of [150, 0.11, 1, 999999]) {
    deepEqual(usd('38', 38, rate), { ok: true, changed: false }, `rate ${rate}`);
  }
});

test('JPYは同値判定も parseInt 規則（小数点以下切り捨て後に比較）。previewJpy と同じ見え方になる', () => {
  // 画面のプレビューも parseInt で ¥1200 と表示するので、表示とDB値は一致する（規則自体はこの修正で変えない）
  deepEqual(jpy('1200.7'), { ok: true, changed: false });
  deepEqual(jpy('1200.9'), { ok: true, changed: false });
  // 外貨は parseFloat なので小数の差は変更として扱う
  deepEqual(usd('38.5', 38), { ok: true, changed: true, foreignAmount: 38.5, jpyAmount: 5775 });
});

test('同値でない入力は表記に関係なく changed:true（同値判定が必要な更新を抑止しないこと）', () => {
  deepEqual(jpy('01201'), { ok: true, changed: true, foreignAmount: 1201, jpyAmount: 1201 });
  deepEqual(usd('38.01', 38), { ok: true, changed: true, foreignAmount: 38.01, jpyAmount: 5702 });
});
