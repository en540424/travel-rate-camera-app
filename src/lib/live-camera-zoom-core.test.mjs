/**
 * 翻訳ページのカメラ翻訳のズーム（ピンチ・ダブルタップ）の判定のテスト。
 *
 * 実行: node --test src/lib/live-camera-zoom-core.test.mjs
 *
 * ジェスチャーの伝わり方・実際のカメラの倍率・拡大後の文字の位置はnodeでは再現できないため、
 * ここでは倍率の計算だけを確かめる。実機での動きはiPhone（TEST_CHECKLIST #81）で確認する。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { LIVE_CAMERA_ZOOM, clampLiveCameraZoom, pinchStepLiveCameraZoom, isLiveCameraZoomed, toggleLiveCameraZoom } =
  await import('./live-camera-zoom-core.ts');

test('倍率の値：メインカメラ（価格OCR）の「2×」・ピンチの上限・感度と同じ値', () => {
  // メインカメラ `CameraPreview.native.tsx` の ZOOM_STEPS = [0, 0.25, 0.5]・PINCH_SENSITIVITY = 0.5
  assert.equal(LIVE_CAMERA_ZOOM.min, 0);
  assert.equal(LIVE_CAMERA_ZOOM.doubleTap, 0.25);
  assert.equal(LIVE_CAMERA_ZOOM.max, 0.5);
  assert.equal(LIVE_CAMERA_ZOOM.pinchSensitivity, 0.5);
  // expo-cameraのzoomは0〜1。端末の能力を超える倍率を要求しない
  assert.ok(LIVE_CAMERA_ZOOM.max <= 1);
  assert.ok(LIVE_CAMERA_ZOOM.doubleTap > LIVE_CAMERA_ZOOM.min && LIVE_CAMERA_ZOOM.doubleTap <= LIVE_CAMERA_ZOOM.max);
});

test('範囲：元の倍率〜上限へ収める', async (t) => {
  await t.test('範囲内はそのまま', () => {
    assert.equal(clampLiveCameraZoom(0), 0);
    assert.equal(clampLiveCameraZoom(0.3), 0.3);
    assert.equal(clampLiveCameraZoom(0.5), 0.5);
  });
  await t.test('下限より小さい → 元の倍率', () => {
    assert.equal(clampLiveCameraZoom(-0.2), 0);
  });
  await t.test('上限より大きい → 上限', () => {
    assert.equal(clampLiveCameraZoom(0.9), 0.5);
    assert.equal(clampLiveCameraZoom(1), 0.5);
  });
  await t.test('数でない値 → 元の倍率', () => {
    assert.equal(clampLiveCameraZoom(Number.NaN), 0);
    assert.equal(clampLiveCameraZoom(Number.POSITIVE_INFINITY), 0);
  });
});

/** ピンチの指の開き具合（ピンチ開始時＝1）の列を、onChangeと同じ形（scale・scaleChange）で順に当てる */
function applyPinch(startZoom, scales) {
  let zoom = startZoom;
  let previous = 1;
  for (const scale of scales) {
    zoom = pinchStepLiveCameraZoom(zoom, scale, scale / previous);
    previous = scale;
  }
  return zoom;
}

test('ピンチ：指の開き具合の変化だけ増減する', async (t) => {
  await t.test('指を開く → 拡大', () => {
    assert.equal(pinchStepLiveCameraZoom(0, 1.5, 1.5), 0.25);
  });
  await t.test('指が動いていない（scaleChange=1） → そのまま', () => {
    assert.equal(pinchStepLiveCameraZoom(0.25, 1.3, 1), 0.25);
  });
  await t.test('拡大中に指を閉じる → 縮小', () => {
    assert.equal(applyPinch(0.5, [0.75, 0.5]), 0.25);
  });
  await t.test('端で止まらなければ「開始時＋(scale−1)×感度」と同じ', () => {
    const zoom = applyPinch(0.1, [1.1, 1.25, 1.2, 1.4]);
    assert.ok(Math.abs(zoom - (0.1 + (1.4 - 1) * 0.5)) < 1e-9);
  });
  await t.test('大きく開いても上限で止まる', () => {
    assert.equal(applyPinch(0, [2, 3, 4]), 0.5);
  });
  await t.test('上限で止まった後に指を戻すと、すぐ縮小する', () => {
    const zoom = applyPinch(0.4, [2, 3, 2.8]);
    assert.ok(Math.abs(zoom - (0.5 - 0.2 * 0.5)) < 1e-9);
  });
  await t.test('元の倍率より小さくはならない', () => {
    assert.equal(applyPinch(0, [0.6, 0.3]), 0);
    assert.equal(applyPinch(0.1, [0.5, 0.2]), 0);
  });
  await t.test('数でない・0以下の値 → 今のzoom（範囲内）のまま', () => {
    assert.equal(pinchStepLiveCameraZoom(0.25, Number.NaN, 1), 0.25);
    assert.equal(pinchStepLiveCameraZoom(0.25, 1.2, Number.NaN), 0.25);
    assert.equal(pinchStepLiveCameraZoom(0.25, 1.2, 0), 0.25);
    assert.equal(pinchStepLiveCameraZoom(2, 1.2, Number.NaN), 0.5);
  });
});

test('拡大中かどうか', async (t) => {
  await t.test('元の倍率 → 拡大していない', () => {
    assert.equal(isLiveCameraZoomed(0), false);
  });
  await t.test('ほとんど動いていない（誤差） → 拡大していない', () => {
    assert.equal(isLiveCameraZoomed(0.0005), false);
  });
  await t.test('少しでも拡大 → 拡大中', () => {
    assert.equal(isLiveCameraZoomed(0.01), true);
    assert.equal(isLiveCameraZoomed(0.25), true);
    assert.equal(isLiveCameraZoomed(0.5), true);
  });
});

test('ダブルタップ：元の倍率 ⇄ 2×', async (t) => {
  await t.test('元の倍率 → 2×', () => {
    assert.equal(toggleLiveCameraZoom(0), LIVE_CAMERA_ZOOM.doubleTap);
  });
  await t.test('2× → 元の倍率', () => {
    assert.equal(toggleLiveCameraZoom(LIVE_CAMERA_ZOOM.doubleTap), 0);
  });
  await t.test('ピンチで途中の倍率（2×より小さい） → 元の倍率', () => {
    assert.equal(toggleLiveCameraZoom(0.12), 0);
  });
  await t.test('ピンチで上限まで拡大 → 元の倍率', () => {
    assert.equal(toggleLiveCameraZoom(0.5), 0);
  });
  await t.test('2回続けると元に戻る', () => {
    assert.equal(toggleLiveCameraZoom(toggleLiveCameraZoom(0)), 0);
  });
  await t.test('ほとんど動いていない（誤差）の時は拡大する', () => {
    assert.equal(toggleLiveCameraZoom(0.0005), LIVE_CAMERA_ZOOM.doubleTap);
  });
});
