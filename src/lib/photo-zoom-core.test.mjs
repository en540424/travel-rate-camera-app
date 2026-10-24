/**
 * 写真翻訳の拡大表示の判定のテスト。
 *
 * 実行: node --test src/lib/photo-zoom-core.test.mjs
 *
 * 注意：TestFlight 1.0.0 (4) で「写真をタップしても拡大表示が開かない」不具合があった（2026-10-24）。
 * タップの伝わり方・Modalの表示はnodeでは再現できないため、ここでは判定だけを確かめる。
 * 表示の不具合そのものはiPhone実機（TEST_CHECKLIST #78）で確認する。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { openPhotoViewerUri, isPhotoTap, isDoubleTap, zoomRectAround } = await import('./photo-zoom-core.ts');

test('開いている写真：今の写真と同じ時だけ開く', async (t) => {
  await t.test('タップした写真を開く', () => {
    assert.equal(openPhotoViewerUri('file:///a.jpg', 'file:///a.jpg'), 'file:///a.jpg');
  });
  await t.test('閉じている', () => {
    assert.equal(openPhotoViewerUri(null, 'file:///a.jpg'), null);
  });
  await t.test('撮り直し・選び直しで写真が替わったら閉じる（前の写真を開いたままにしない）', () => {
    assert.equal(openPhotoViewerUri('file:///a.jpg', 'file:///b.jpg'), null);
  });
  await t.test('クリアして写真が無くなったら閉じる', () => {
    assert.equal(openPhotoViewerUri('file:///a.jpg', null), null);
    assert.equal(openPhotoViewerUri(null, null), null);
  });
});

test('タップ：1本指でほとんど動かさず短く離した時だけ', async (t) => {
  const start = { x: 100, y: 200, time: 1000, maxTouches: 1 };
  await t.test('タップ', () => {
    assert.equal(isPhotoTap(start, { x: 103, y: 204, time: 1120 }), true);
  });
  await t.test('ピンチ（2本指）はタップにしない', () => {
    assert.equal(isPhotoTap({ ...start, maxTouches: 2 }, { x: 100, y: 200, time: 1100 }), false);
  });
  await t.test('ドラッグ（指を動かした）はタップにしない', () => {
    assert.equal(isPhotoTap(start, { x: 160, y: 200, time: 1100 }), false);
  });
  await t.test('長押しはタップにしない', () => {
    assert.equal(isPhotoTap(start, { x: 100, y: 200, time: 1600 }), false);
  });
});

test('ダブルタップ：直前のタップと近い場所・短い間隔', async (t) => {
  const first = { x: 100, y: 200, time: 1000 };
  await t.test('2回目のタップ', () => {
    assert.equal(isDoubleTap(first, { x: 110, y: 210, time: 1200 }), true);
  });
  await t.test('1回目のタップ（直前が無い）', () => {
    assert.equal(isDoubleTap(null, first), false);
  });
  await t.test('間隔が空いた2回のタップは別々のタップ', () => {
    assert.equal(isDoubleTap(first, { x: 100, y: 200, time: 1400 }), false);
  });
  await t.test('離れた場所のタップは別々のタップ', () => {
    assert.equal(isDoubleTap(first, { x: 250, y: 200, time: 1100 }), false);
  });
});

test('拡大の範囲：タップした所を中心に、写真の外へはみ出さない', async (t) => {
  const W = 393;
  const H = 852;
  await t.test('中央をタップ', () => {
    const r = zoomRectAround(196.5, 426, W, H, 2.5);
    assert.ok(Math.abs(r.width - W / 2.5) < 1e-9);
    assert.ok(Math.abs(r.height - H / 2.5) < 1e-9);
    assert.ok(Math.abs(r.x + r.width / 2 - 196.5) < 1e-9);
    assert.ok(Math.abs(r.y + r.height / 2 - 426) < 1e-9);
  });
  await t.test('左上の角は端で止める', () => {
    const r = zoomRectAround(0, 0, W, H, 2.5);
    assert.equal(r.x, 0);
    assert.equal(r.y, 0);
  });
  await t.test('右下の角は端で止める', () => {
    const r = zoomRectAround(W, H, W, H, 2.5);
    assert.ok(Math.abs(r.x + r.width - W) < 1e-9);
    assert.ok(Math.abs(r.y + r.height - H) < 1e-9);
  });
  await t.test('横向きの画面でも同じ', () => {
    const r = zoomRectAround(800, 10, 852, 393, 2.5);
    assert.ok(r.x + r.width <= 852 + 1e-9);
    assert.equal(r.y, 0);
  });
});
