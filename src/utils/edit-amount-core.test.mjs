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
