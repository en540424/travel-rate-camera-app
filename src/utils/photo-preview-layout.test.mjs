/**
 * `utils/photo-preview-layout.ts`の検証（`node --test src/utils/photo-preview-layout.test.mjs`）。
 *
 * 守ること（2026-10-20 Human実機確認）：
 *   1. 写真全体が見える（枠の形＝写真の形なので、containでも切り抜きも余白も出ない）
 *   2. 縦撮り写真が細く小さく見えない（固定の横長枠の中央に細い写真、を繰り返さない）
 *   3. 小さいiPhoneでも金額・メモ・保存UIを押し下げすぎない（高さに上限）
 */
import { deepEqual, equal, ok } from 'node:assert/strict';
import { test } from 'node:test';

import {
  FALLBACK_PHOTO_ASPECT,
  fitPhotoBox,
  getPhotoBoxSize,
  getPhotoSurfaceLimit,
  MAX_PHOTO_FRAME_ASPECT,
  MIN_PHOTO_FRAME_ASPECT,
  photoAspectFromSize,
} from './photo-preview-layout.ts';

const PORTRAIT = 3 / 4; // iPhoneの縦撮り
const LANDSCAPE = 4 / 3; // iPhoneの横撮り
const NEAR_SQUARE = 1.05;

// 画面の縦幅（pt）
const SE = 667;
const IPHONE_15 = 852;
const PRO_MAX = 932;

// 親の幅（pt）。撮影結果画面＝画面幅−左右余白15×2−カード枠1×2−カード内余白8×2、商品詳細＝画面幅−左右余白18×2
const RESULT_WIDTH = { se: 375 - 48, iphone15: 393 - 48, proMax: 430 - 48 };
const DETAIL_WIDTH = { se: 375 - 36, iphone15: 393 - 36, proMax: 430 - 36 };

test('画像の幅・高さから縦横比。取れない値はnull', () => {
  equal(photoAspectFromSize(3024, 4032), 0.75);
  equal(photoAspectFromSize(4032, 3024), 4032 / 3024);
  for (const [w, h] of [
    [undefined, 4032],
    [3024, undefined],
    [0, 4032],
    [3024, 0],
    [-1, 4032],
    [Number.NaN, 4032],
    [Number.POSITIVE_INFINITY, 4032],
    ['3024', '4032'],
    [null, null],
  ]) {
    equal(photoAspectFromSize(w, h), null, `${w}x${h}`);
  }
});

test('枠の形は写真の形と同じ（containでも切り抜き・余白が出ない）', () => {
  for (const aspect of [PORTRAIT, LANDSCAPE, NEAR_SQUARE, 1, 9 / 16, 16 / 9]) {
    for (const [maxWidth, maxHeight] of [
      [345, 307],
      [357, 409],
      [136, 180],
      [72, 72],
      [56, 56],
    ]) {
      const box = fitPhotoBox(aspect, maxWidth, maxHeight);
      ok(box.width <= maxWidth && box.height <= maxHeight, `収まる aspect=${aspect} ${maxWidth}x${maxHeight}`);
      // 丸めによる差だけ（1pt未満）
      ok(Math.abs(box.width - box.height * aspect) <= 1, `形が一致 aspect=${aspect} → ${box.width}x${box.height}`);
      // 幅か高さのどちらかは上限いっぱい（不要に小さくしない）
      ok(box.width === maxWidth || box.height === maxHeight, `上限いっぱい aspect=${aspect}`);
    }
  }
});

test('撮影結果画面：縦撮り写真は高さの上限で決まり、幅の大半を使う（細く小さく見えない）', () => {
  // 旧（Build 7fa16f73）：固定の横長枠（iPhone 15で幅345×高さ204）に縦撮りを収め、写真は幅153（44%）だった
  const iphone15 = getPhotoBoxSize('ocrResult', PORTRAIT, IPHONE_15, RESULT_WIDTH.iphone15);
  deepEqual(iphone15, { width: 230, height: 307 });
  ok(iphone15.width / RESULT_WIDTH.iphone15 >= 0.6, '幅の6割以上');

  const proMax = getPhotoBoxSize('ocrResult', PORTRAIT, PRO_MAX, RESULT_WIDTH.proMax);
  deepEqual(proMax, { width: 252, height: 336 });
  ok(proMax.width / RESULT_WIDTH.proMax >= 0.6, '幅の6割以上');
});

test('撮影結果画面：小さいiPhone（SE）でも旧サイズより大きく、高さは抑える', () => {
  const se = getPhotoBoxSize('ocrResult', PORTRAIT, SE, RESULT_WIDTH.se);
  deepEqual(se, { width: 180, height: 240 });
  // 旧「履歴に残す写真」120×160・旧「読み取った値札」の写真部分120×160（SE）より大きい
  ok(se.width > 120 && se.height > 160);
  // 円換算ヒーロー・金額候補を押し下げすぎない
  ok(se.height <= 240);
});

test('撮影結果画面・商品詳細：横撮り写真はほぼ幅いっぱい（SEだけ高さの上限が先に効く）', () => {
  for (const [windowHeight, width] of [
    [SE, RESULT_WIDTH.se],
    [IPHONE_15, RESULT_WIDTH.iphone15],
    [PRO_MAX, RESULT_WIDTH.proMax],
  ]) {
    const box = getPhotoBoxSize('ocrResult', LANDSCAPE, windowHeight, width);
    ok(box.width / width >= 0.95, `ocrResult windowHeight=${windowHeight} → ${box.width}/${width}`);
  }
  deepEqual(getPhotoBoxSize('ocrResult', LANDSCAPE, SE, RESULT_WIDTH.se), { width: 320, height: 240 });
  deepEqual(getPhotoBoxSize('ocrResult', LANDSCAPE, IPHONE_15, RESULT_WIDTH.iphone15), { width: 345, height: 259 });
  for (const [windowHeight, width] of [
    [SE, DETAIL_WIDTH.se],
    [IPHONE_15, DETAIL_WIDTH.iphone15],
    [PRO_MAX, DETAIL_WIDTH.proMax],
  ]) {
    const box = getPhotoBoxSize('detail', LANDSCAPE, windowHeight, width);
    equal(box.width, width, `detail windowHeight=${windowHeight}`);
  }
});

test('ほぼ正方形の写真：高さの上限で決まり、幅も十分使う', () => {
  const box = getPhotoBoxSize('ocrResult', NEAR_SQUARE, IPHONE_15, RESULT_WIDTH.iphone15);
  equal(box.height, 307);
  ok(box.width / RESULT_WIDTH.iphone15 >= 0.9);
});

test('商品詳細：縦撮り写真を大きく（写真が主役）、ただし高さに上限', () => {
  deepEqual(getPhotoBoxSize('detail', PORTRAIT, SE, DETAIL_WIDTH.se), { width: 240, height: 320 });
  deepEqual(getPhotoBoxSize('detail', PORTRAIT, IPHONE_15, DETAIL_WIDTH.iphone15), { width: 307, height: 409 });
  deepEqual(getPhotoBoxSize('detail', PORTRAIT, PRO_MAX, DETAIL_WIDTH.proMax), { width: 330, height: 440 });
  // 旧：全幅×220の枠に縦撮りを収め、写真は幅165（SE〜iPhone 15）だった
  ok(getPhotoBoxSize('detail', PORTRAIT, SE, DETAIL_WIDTH.se).width > 165);
});

test('保存の設定「履歴に残す写真」：縦撮りは旧120×160より大きく、横に説明文の列を残す', () => {
  const portrait = getPhotoBoxSize('savePhoto', PORTRAIT, SE, null);
  deepEqual(portrait, { width: 135, height: 180 });
  ok(portrait.width >= 120 && portrait.height >= 160);
  deepEqual(getPhotoBoxSize('savePhoto', LANDSCAPE, SE, null), { width: 136, height: 102 });
  deepEqual(getPhotoBoxSize('savePhoto', 1, SE, null), { width: 136, height: 136 });
  // SEの行幅（約289pt）− 写真 − 間隔12 ≥ 130pt（説明文の列）
  ok(289 - getPhotoSurfaceLimit('savePhoto', SE).maxWidth - 12 >= 130);
});

test('サムネイル（履歴編集72・比較56）も写真の形で全体表示', () => {
  deepEqual(getPhotoBoxSize('editThumb', PORTRAIT, IPHONE_15, null), { width: 54, height: 72 });
  deepEqual(getPhotoBoxSize('editThumb', LANDSCAPE, IPHONE_15, null), { width: 72, height: 54 });
  deepEqual(getPhotoBoxSize('compareThumb', PORTRAIT, IPHONE_15, null), { width: 42, height: 56 });
  deepEqual(getPhotoBoxSize('compareThumb', LANDSCAPE, IPHONE_15, null), { width: 56, height: 42 });
});

test('縦横比が取れない（読み込み前・読み込み失敗）は縦撮り3:4の枠で表示する', () => {
  equal(FALLBACK_PHOTO_ASPECT, 0.75);
  for (const aspect of [null, undefined, 0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    deepEqual(
      getPhotoBoxSize('ocrResult', aspect, IPHONE_15, RESULT_WIDTH.iphone15),
      { width: 230, height: 307 },
      `aspect=${aspect}`,
    );
  }
});

test('極端に細長い画像は枠の形だけ上限・下限で止める（写真はcontainで全体表示）', () => {
  const tall = fitPhotoBox(0.2, 345, 307); // 長いスクリーンショット
  equal(tall.height, 307);
  equal(tall.width, Math.round(307 * MIN_PHOTO_FRAME_ASPECT));
  const wide = fitPhotoBox(5, 345, 307); // パノラマ
  equal(wide.width, 345);
  equal(wide.height, Math.round(345 / MAX_PHOTO_FRAME_ASPECT));
});

test('親の幅をまだ測れていない間は高さだけで決める（縦撮りは測った後も同じ大きさ＝ずれない）', () => {
  deepEqual(getPhotoBoxSize('ocrResult', PORTRAIT, IPHONE_15, null), { width: 230, height: 307 });
  deepEqual(getPhotoBoxSize('ocrResult', PORTRAIT, IPHONE_15, 0), { width: 230, height: 307 });
  deepEqual(
    getPhotoBoxSize('ocrResult', PORTRAIT, IPHONE_15, null),
    getPhotoBoxSize('ocrResult', PORTRAIT, IPHONE_15, RESULT_WIDTH.iphone15),
  );
});

test('画面の高さの上限：小さい画面は下限、大きい画面は上限で止まる。取れない値は下限', () => {
  equal(getPhotoSurfaceLimit('ocrResult', 568).maxHeight, 230);
  equal(getPhotoSurfaceLimit('ocrResult', 2000).maxHeight, 340);
  equal(getPhotoSurfaceLimit('detail', 568).maxHeight, 300);
  equal(getPhotoSurfaceLimit('detail', 2000).maxHeight, 440);
  for (const windowHeight of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    equal(getPhotoSurfaceLimit('ocrResult', windowHeight).maxHeight, 230, `windowHeight=${windowHeight}`);
    equal(getPhotoSurfaceLimit('detail', windowHeight).maxHeight, 300, `windowHeight=${windowHeight}`);
  }
});

test('上限が0・不正なら枠も0（描画しない）', () => {
  deepEqual(fitPhotoBox(PORTRAIT, 0, 307), { width: 0, height: 0 });
  deepEqual(fitPhotoBox(PORTRAIT, 345, 0), { width: 0, height: 0 });
  deepEqual(fitPhotoBox(PORTRAIT, 345, Number.NaN), { width: 0, height: 0 });
});
