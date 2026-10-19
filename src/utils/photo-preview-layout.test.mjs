/**
 * `utils/photo-preview-layout.ts`の検証（`node --test src/utils/photo-preview-layout.test.mjs`）。
 *
 * 保存前プレビューは旧110ptより大きく、かつ小さいiPhoneで金額・メモ・保存UIを押し下げすぎないこと。
 */
import { equal, ok } from 'node:assert/strict';
import { test } from 'node:test';

import {
  getOcrPhotoPreviewHeight,
  OCR_PHOTO_PREVIEW_MAX_HEIGHT,
  OCR_PHOTO_PREVIEW_MIN_HEIGHT,
} from './photo-preview-layout.ts';

// 旧プレビュー枠（横長・縦スクロールで中央約1/4だけ表示）の高さ
const LEGACY_FRAME_HEIGHT = 110;

test('どのiPhoneでも旧110pt枠より大きい', () => {
  for (const windowHeight of [568, 667, 812, 844, 852, 926, 932, 956]) {
    ok(getOcrPhotoPreviewHeight(windowHeight) > LEGACY_FRAME_HEIGHT, `windowHeight=${windowHeight}`);
  }
});

test('小さいiPhone（SE 667pt）は下限、大きいiPhone（Pro Max 932pt）は上限で止まる', () => {
  equal(getOcrPhotoPreviewHeight(667), OCR_PHOTO_PREVIEW_MIN_HEIGHT);
  equal(getOcrPhotoPreviewHeight(568), OCR_PHOTO_PREVIEW_MIN_HEIGHT);
  equal(getOcrPhotoPreviewHeight(932), OCR_PHOTO_PREVIEW_MAX_HEIGHT);
  equal(getOcrPhotoPreviewHeight(2000), OCR_PHOTO_PREVIEW_MAX_HEIGHT);
});

test('標準サイズ（iPhone 15 852pt）は画面比例の中間値', () => {
  equal(getOcrPhotoPreviewHeight(852), 204);
  equal(getOcrPhotoPreviewHeight(844), 203);
});

test('画面サイズが取れない値（0・負数・NaN・Infinity）は下限へ倒す', () => {
  for (const windowHeight of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    equal(getOcrPhotoPreviewHeight(windowHeight), OCR_PHOTO_PREVIEW_MIN_HEIGHT, `windowHeight=${windowHeight}`);
  }
});
