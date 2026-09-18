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
  // JPYは Math.round で整数円へ（2026-09-18に parseInt＝切り捨て から変更。repo全体の丸め規則に合わせた）
  deepEqual(jpy('12.5'), { ok: true, changed: true, foreignAmount: 13, jpyAmount: 13 });
  deepEqual(jpy('12.4'), { ok: true, changed: true, foreignAmount: 12, jpyAmount: 12 });
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

test('JPYは同値判定も Math.round 規則（丸めた後に比較）。previewJpy・一覧の formatJpy と同じ見え方になる', () => {
  // 画面のプレビュー（previewJpy）も一覧（formatJpy）も Math.round で表示するので、表示とDB値は一致する
  // （2026-09-18に parseInt＝切り捨て から変更。number-pad では小数点を入力できないため実機では到達しない経路）
  deepEqual(jpy('1200.4'), { ok: true, changed: false });
  deepEqual(jpy('1200.7'), { ok: true, changed: true, foreignAmount: 1201, jpyAmount: 1201 });
  deepEqual(jpy('1200.9'), { ok: true, changed: true, foreignAmount: 1201, jpyAmount: 1201 });
  // 丸めた結果が0になる値は不正（"0.4"→0）。"0.5"は1円として有効
  deepEqual(jpy('0.4'), { ok: false });
  deepEqual(jpy('0.5'), { ok: true, changed: true, foreignAmount: 1, jpyAmount: 1 });
  // 外貨は parseFloat なので小数の差は変更として扱う
  deepEqual(usd('38.5', 38), { ok: true, changed: true, foreignAmount: 38.5, jpyAmount: 5775 });
});

test('同値でない入力は表記に関係なく changed:true（同値判定が必要な更新を抑止しないこと）', () => {
  deepEqual(jpy('01201'), { ok: true, changed: true, foreignAmount: 1201, jpyAmount: 1201 });
  deepEqual(usd('38.01', 38), { ok: true, changed: true, foreignAmount: 38.01, jpyAmount: 5702 });
});

/**
 * 【2026-09-18・既知不具合3件目】既存の小数JPY記録（`jpy_amount = 1200.5`）を開き、金額欄を触らずに保存した場合。
 * 旧実装は JPY を `parseInt` で評価するため `"1200.5"` → 1200 となり、現在値 1200.5 と一致せず `changed:true`
 * を返していた。呼び出し側（`item-edit.tsx doSave`）は `changed:true` なら無条件に `updateAmount` を実行するので、
 * メモだけ直したつもりでも `jpy_amount` が 1200.5 → 1200 へ黙って書き換わる。
 * JPYの丸め規則は repo 全体で `Math.round`（`formatJpy`・`budget-core`・SQL `ROUND`・外貨編集の円換算）なので、
 * 編集欄の解析・同値判定もそれに合わせる（初期値 "1200.5" でも、丸めた初期値 "1201" でも changed:false）。
 */
test('既存の小数JPY記録を金額未変更のまま保存しても changed:false（jpy_amountを黙って書き換えない）', () => {
  deepEqual(jpy('1200.5', 1200.5), { ok: true, changed: false });
  deepEqual(jpy('1201', 1200.5), { ok: true, changed: false });
  deepEqual(jpy('1200.4', 1200.4), { ok: true, changed: false });
  deepEqual(jpy('1200', 1200.4), { ok: true, changed: false });
  // 外貨側は従来どおり foreign_amount 同士の比較（jpy_amount の小数は関与しない）
  deepEqual(
    resolveEditedAmount({ currency: 'USD', text: '38', currentForeignAmount: 38, currentJpyAmount: 5787.4, rateUsed: 152.3 }),
    { ok: true, changed: false },
  );
});

test('小数JPY記録の金額を明示的に変えた場合は整数円で changed:true', () => {
  deepEqual(jpy('1300', 1200.5), { ok: true, changed: true, foreignAmount: 1300, jpyAmount: 1300 });
  // 丸めると現在値の丸めと一致しない値は変更として扱う
  deepEqual(jpy('1200', 1200.5), { ok: true, changed: true, foreignAmount: 1200, jpyAmount: 1200 });
});
