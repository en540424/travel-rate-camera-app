/**
 * ライブ翻訳・スマートカメラの「メニュー1枚」を写した時の追跡と、商品名・説明・価格の対応（2026-11-25）。
 *
 * 実機（Build 5・iPhone 16 Pro）の撮影で見つかった問題を、カメラの映像を模した入力で再現して固定する:
 * - 円換算カードに別の商品の価格が出た（`Squeezed daily`に$3.20。カメラを動かした直後の読み落とし・読み違い）
 * - 同じ値段の商品が2つあると、追跡中の行が入れ替わり位置が混ざる
 * - 端末を少し回して持つと、価格が隣の行の商品と組になる
 * - 3列のメニュー（商品名｜説明｜価格）で、説明が商品名として出る
 * - メニュー1枚（40行超）で、一部の行が一度も表示されない（追跡の上限で毎フレーム切り捨て）
 *
 * 実行: npm test（node --test "src/**\/*.test.mjs"）
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

globalThis.__DEV__ = false;

const { extractPriceCandidates, extractConfidentPriceCandidates } = await import('../utils/extract-prices.ts');
const core = await import('./live-text-core.ts');
const {
  DEFAULT_TRACKER_OPTIONS,
  buildSmartCameraEntries,
  buildTranslationPriceEntries,
  estimateColumnSlope,
  extractTranslationPrices,
  isStableLine,
  mapBoxToView,
  selectOverlayLines,
  updateTrackedLines,
  viewRectToImageRegion,
  visibleRegionInImage,
} = core;

const usd = (text) => extractTranslationPrices(text, 'USD', (value) => extractConfidentPriceCandidates(value, 'USD'));

/** 縦向きの映像フレーム（1080×1920）。メニューの1行の間隔と文字の高さは実機の撮影から概算 */
const IMAGE = { width: 1080, height: 1920 };
const PITCH = 0.0173;
const TEXT_HEIGHT = 0.012;
const OPTIONS = { maxEntries: 8, maxTextLength: 80, minHits: 2, visibleRegion: { x: 0, y: 0, width: 1, height: 1 }, imageSize: IMAGE };

/** メニューボード（ライブカメラ翻訳素材「クラシックなカフェメニューボード」）の品目：商品名・説明・価格 */
const COFFEE = [
  ['Espresso', 0.14, 'Rich and bold coffee', 0.24, '$3.50'],
  ['Americano', 0.16, 'Espresso with hot water', 0.26, '$4.00'],
  ['Cappuccino', 0.18, 'Espresso with steamed milk foam', 0.36, '$5.20'],
  ['Cafe Latte', 0.16, 'Espresso with steamed milk', 0.3, '$5.40'],
  ['English Breakfast Tea', 0.26, 'Classic black tea', 0.2, '$4.20'],
  ['Iced Lemon Tea', 0.2, 'Black tea with lemon and ice', 0.32, '$4.80'],
  ['Orange Juice', 0.17, 'Chilled orange juice', 0.23, '$5.60'],
  ['Sparkling Water', 0.2, 'Carbonated mineral water', 0.29, '$3.20'],
];

/**
 * メニューを写した1フレームの認識結果。端末の回転（angleDeg）は画像の中心まわりの回転として、
 * Visionと同じ「傾いた文字を囲む軸に平行な四角」で返す。
 */
function menuFrame(rows, { y0 = 0.4, dy = 0, angleDeg = 0, drop = [], rename = {}, reverse = false } = {}) {
  const rad = (angleDeg * Math.PI) / 180;
  const cx = IMAGE.width / 2;
  const cy = IMAGE.height / 2;
  const lines = [];
  rows.forEach(([name, nameWidth, description, descriptionWidth, price], index) => {
    const y = y0 + index * PITCH + dy;
    const add = (text, x, width) => {
      if (drop.includes(text)) return;
      const corners = [
        [x, y],
        [x + width, y],
        [x, y + TEXT_HEIGHT],
        [x + width, y + TEXT_HEIGHT],
      ].map(([nx, ny]) => {
        const px = nx * IMAGE.width - cx;
        const py = ny * IMAGE.height - cy;
        return [px * Math.cos(rad) - py * Math.sin(rad) + cx, px * Math.sin(rad) + py * Math.cos(rad) + cy];
      });
      const xs = corners.map(([px]) => px / IMAGE.width);
      const ys = corners.map(([, py]) => py / IMAGE.height);
      lines.push({
        text: rename[text] ?? text,
        confidence: 0.9,
        box: { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) },
      });
    };
    add(name, 0.1, nameWidth);
    if (description) add(description, 0.42, descriptionWidth);
    add(price, 0.86, 0.09);
  });
  return reverse ? lines.reverse() : lines;
}

function track(frames, start = 1000, interval = 800) {
  let tracked = [];
  frames.forEach((frame, index) => {
    tracked = updateTrackedLines(tracked, frame, start + index * interval);
  });
  return tracked;
}

/** 正しい組（価格・商品名・説明）。名前を付けない（null）のは可、別の品目の名前・説明は不可 */
function assertNoWrongPair(entries, rows, context) {
  for (const entry of entries) {
    const amount = entry.amounts?.[0] ?? entry.amount;
    const candidates = rows.filter((row) => Number(row[4].slice(1)) === amount);
    assert.ok(candidates.length > 0, `${context}: 想定外の価格 ${amount}`);
    if (entry.label == null) continue;
    const ok = candidates.some(
      (row) => row[0] === entry.label && (entry.description == null || entry.description === row[2]),
    );
    assert.ok(ok, `${context}: $${amount} に「${entry.label}」「${entry.description}」が付いた`);
  }
}

test('3列のメニュー：商品名・説明・価格を分けて組にする', () => {
  const tracked = track([menuFrame(COFFEE), menuFrame(COFFEE)]);
  const entries = buildTranslationPriceEntries(tracked, usd, OPTIONS);
  assert.equal(entries.length, 8);
  const latte = entries.find((entry) => entry.amounts[0] === 5.4);
  assert.equal(latte.label, 'Cafe Latte');
  assert.equal(latte.description, 'Espresso with steamed milk');
  assertNoWrongPair(entries, COFFEE, '正面');
  assert.ok(entries.every((entry) => entry.label != null));
});

test('メインカメラ（スマートカメラ）も同じ組み立て：説明を商品名にしない', () => {
  const tracked = track([menuFrame(COFFEE.slice(0, 2)), menuFrame(COFFEE.slice(0, 2))]);
  const entries = buildSmartCameraEntries(tracked, (text) => extractPriceCandidates(text, 'USD'), {
    ...OPTIONS,
    maxEntries: 3,
    maxTextLength: 40,
  });
  const prices = entries.filter((entry) => entry.kind === 'price');
  assert.deepEqual(prices.map((entry) => entry.label).sort(), ['Americano', 'Espresso']);
  // 商品名・説明に使った行は、短文として重ねて出さない
  assert.equal(entries.filter((entry) => entry.kind === 'text').length, 0);
});

test('端末を回して持っても、隣の行の商品と組にしない（傾きを価格の列から推定）', () => {
  for (const angleDeg of [-3, -2, -1, -0.5, 0.5, 1, 2, 3]) {
    const frame = menuFrame(COFFEE, { angleDeg });
    const tracked = track([frame, frame]);
    const entries = buildTranslationPriceEntries(tracked, usd, OPTIONS);
    assertNoWrongPair(entries, COFFEE, `${angleDeg}°`);
    // 価格が縦に並んでいれば傾きを補正できる（全品目に名前が付く）
    assert.ok(
      entries.every((entry) => entry.label != null),
      `${angleDeg}°: 名前が付かない価格 ${entries.filter((e) => e.label == null).map((e) => e.amounts[0])}`,
    );
  }
});

test('価格が2つしか見えず傾きを推定できない時も、別の行の商品とは組にしない', () => {
  for (const angleDeg of [-2, -1.5, 1.5, 2]) {
    const rows = COFFEE.slice(4, 6);
    const frame = menuFrame(rows, { angleDeg });
    const entries = buildTranslationPriceEntries(track([frame, frame]), usd, OPTIONS);
    assertNoWrongPair(entries, rows, `${angleDeg}°・2行`);
  }
});

test('傾きの推定：右揃え・左揃えの列、2列のメニュー、並びが崩れた価格', () => {
  const column = (slope) =>
    [0, 1, 2, 3].map((index) => {
      const y = 0.3 + index * 0.05;
      return { x: 0.8 + (slope * (y * IMAGE.height)) / IMAGE.width, y, width: 0.08, height: 0.012 };
    });
  assert.ok(Math.abs(estimateColumnSlope(column(0.05), IMAGE) - 0.05) < 1e-6);
  assert.equal(estimateColumnSlope(column(0), IMAGE), 0);
  // 価格が少ない・ばらばら（列になっていない）時は推定しない
  assert.equal(estimateColumnSlope(column(0.05).slice(0, 2), IMAGE), 0);
  const scattered = [0.1, 0.6, 0.3, 0.8].map((x, index) => ({ x, y: 0.3 + index * 0.05, width: 0.08, height: 0.012 }));
  assert.equal(estimateColumnSlope(scattered, IMAGE), 0);
});

test('同じ値段の商品が2つあっても、入れ替わらない（1つを読み落とした直後も）', () => {
  const rows = [
    ['English Breakfast Tea', 0.26, 'Black tea with milk', 0.22, '$4.20'],
    ['Iced Lemon Tea', 0.2, 'Black tea with lemon and ice', 0.32, '$4.80'],
    ['Caesar Salad', 0.18, 'Romaine lettuce, cheese, and dressing', 0.4, '$9.20'],
    ['Cheesecake', 0.15, 'Baked cheesecake with cream', 0.32, '$4.20'],
  ];
  const full = menuFrame(rows);
  let skipped = false;
  const dropUpper = full.filter((line) => {
    if (line.text === '$4.20' && !skipped) {
      skipped = true;
      return false;
    }
    return true;
  });
  // Visionの返す順が入れ替わっても同じ
  const sequence = [full, menuFrame(rows, { reverse: true }), dropUpper, full, menuFrame(rows, { reverse: true }), full];
  for (let length = 2; length <= sequence.length; length += 1) {
    const tracked = track(sequence.slice(0, length));
    const entries = buildTranslationPriceEntries(tracked, usd, OPTIONS);
    assertNoWrongPair(entries, rows, `${length}フレーム目`);
    // 2つの$4.20は、それぞれ元の行の位置に留まる（位置が混ざらない）
    const tea = tracked.filter((line) => line.text === '$4.20').map((line) => line.box.y).sort((a, b) => a - b);
    assert.ok(Math.abs(tea[0] - 0.4) < 0.002, `${length}: 上の$4.20の位置 ${tea[0]}`);
    assert.ok(Math.abs(tea[1] - (0.4 + 3 * PITCH)) < 0.002, `${length}: 下の$4.20の位置 ${tea[1]}`);
  }
});

test('カメラを動かした直後に読み落とし・読み違いがあっても、別の商品の名前・説明を付けない（実機の$3.20の再現）', () => {
  const rows = [
    ['English Breakfast Tea', 0.26, 'Classic black tea', 0.2, '$4.20'],
    ['Iced Lemon Tea', 0.2, 'Black tea with lemon and ice', 0.34, '$4.80'],
    ['Fresh Orange Juice', 0.24, 'Squeezed daily', 0.17, '$5.60'],
    ['Sparkling Water', 0.2, 'Chilled mineral water', 0.26, '$3.20'],
  ];
  for (const rowsMoved of [0.5, 0.75, 1, 1.2, 1.4, 2]) {
    const dy = -rowsMoved * PITCH;
    const moved = menuFrame(rows, {
      dy,
      drop: ['Squeezed daily'],
      rename: { 'Chilled mineral water': 'Chilled mineral waler' },
    });
    const frames = [menuFrame(rows), menuFrame(rows), moved];
    for (let length = 3; length <= 5; length += 1) {
      const sequence = [...frames, ...Array(length - 3).fill(menuFrame(rows, { dy }))];
      const entries = buildTranslationPriceEntries(track(sequence), usd, OPTIONS);
      assertNoWrongPair(entries, rows, `${rowsMoved}行分動かした・${length}フレーム目`);
    }
  }
});

test('止めて写している時に価格を1回読み落としても、商品名は消えない（点滅しない）', () => {
  const full = menuFrame(COFFEE);
  const dropped = full.filter((line) => line.text !== '$5.40');
  const before = buildTranslationPriceEntries(track([full, full]), usd, OPTIONS);
  const after = buildTranslationPriceEntries(track([full, full, dropped]), usd, OPTIONS);
  const label = (entries) => entries.find((entry) => entry.amounts[0] === 5.4)?.label;
  assert.equal(label(before), 'Cafe Latte');
  assert.equal(label(after), 'Cafe Latte');
  // 商品名の行を1回読み落としても同じ
  const nameDropped = full.filter((line) => line.text !== 'Cafe Latte');
  assert.equal(label(buildTranslationPriceEntries(track([full, full, nameDropped]), usd, OPTIONS)), 'Cafe Latte');
});

test('2列のメニュー：左の列の商品名を右の列の価格に付けない', () => {
  const lines = [
    { text: 'Burger', confidence: 1, box: { x: 0.03, y: 0.4, width: 0.15, height: 0.012 } },
    { text: '$12.50', confidence: 1, box: { x: 0.3, y: 0.4, width: 0.1, height: 0.012 } },
    { text: 'Pasta', confidence: 1, box: { x: 0.55, y: 0.4, width: 0.12, height: 0.012 } },
    { text: '$9.00', confidence: 1, box: { x: 0.85, y: 0.4, width: 0.09, height: 0.012 } },
  ];
  const entries = buildTranslationPriceEntries(track([lines, lines]), usd, OPTIONS);
  const byAmount = Object.fromEntries(entries.map((entry) => [entry.amounts[0], entry.label]));
  assert.deepEqual(byAmount, { 12.5: 'Burger', 9: 'Pasta' });
});

test('説明と価格が1行に読まれた時：左の商品名を名前、その行の文字を説明にする', () => {
  const lines = [
    { text: 'Cafe Latte', confidence: 1, box: { x: 0.1, y: 0.4, width: 0.16, height: 0.012 } },
    { text: 'Espresso with steamed milk $5.40', confidence: 1, box: { x: 0.42, y: 0.4, width: 0.53, height: 0.012 } },
  ];
  const [entry] = buildTranslationPriceEntries(track([lines, lines]), usd, OPTIONS);
  assert.equal(entry.label, 'Cafe Latte');
  assert.equal(entry.description, 'Espresso with steamed milk');
});

test('追跡：メニュー1枚（45行）でも全ての行が表示の対象になる', () => {
  const lines = Array.from({ length: 45 }, (_, index) => ({
    text: `Line ${index}`,
    confidence: 0.9,
    box: { x: 0.1, y: 0.1 + index * 0.015, width: 0.3, height: 0.01 },
  }));
  const tracked = track([lines, lines, lines]);
  assert.equal(tracked.filter((line) => isStableLine(line)).length, 45);
  assert.ok(DEFAULT_TRACKER_OPTIONS.maxTracked >= 80);
});

test('追跡：カメラを動かした時、読めなかった行も同じだけずらして残す', () => {
  const rows = COFFEE.slice(0, 4);
  const dy = -1 * PITCH;
  const tracked = track([menuFrame(rows), menuFrame(rows), menuFrame(rows, { dy, drop: ['Espresso with hot water'] })]);
  const stale = tracked.find((line) => line.text === 'Espresso with hot water');
  assert.ok(Math.abs(stale.box.y - (0.4 + PITCH + dy)) < 1e-6, `読めなかった行の位置 ${stale.box.y}`);
  // 読めた行は、動いた先の位置へすぐ合う（追従の遅れで1行ずれない）
  const seen = tracked.find((line) => line.text === 'Espresso with steamed milk');
  assert.ok(Math.abs(seen.box.y - (0.4 + 3 * PITCH + dy)) < 1e-6, `読めた行の位置 ${seen.box.y}`);
});

test('追跡：動きを推定できる組が少ない・ばらつく時は、ずらさない（従来どおり）', () => {
  const one = [{ text: 'Bibimbap', confidence: 1, box: { x: 0.1, y: 0.1, width: 0.3, height: 0.04 } }];
  const moved = [{ text: 'Bibimbap', confidence: 1, box: { x: 0.3, y: 0.1, width: 0.3, height: 0.04 } }];
  const tracked = updateTrackedLines(updateTrackedLines([], one, 1000), moved, 1900, { ...DEFAULT_TRACKER_OPTIONS, smoothing: 0.5 });
  assert.ok(Math.abs(tracked[0].box.x - 0.2) < 1e-9);
});

test('訳を重ねる行：枠の下部が隠れている時は、見えている範囲の中央から選ぶ', () => {
  const view = { width: 370, height: 493 };
  const visible = visibleRegionInImage(IMAGE, view);
  // 枠の下 40% が価格の帯・タブバーで隠れている
  const unobstructed = viewRectToImageRegion({ left: 0, top: 0, width: view.width, height: view.height * 0.6 }, IMAGE, view);
  assert.ok(Math.abs(unobstructed.y - visible.y) < 1e-9);
  assert.ok(Math.abs(unobstructed.height - visible.height * 0.6) < 1e-9);
  // 逆変換：隠れていない範囲の下端は、ビューの0.6の位置
  const bottom = mapBoxToView({ x: 0, y: unobstructed.y + unobstructed.height, width: 0, height: 0 }, IMAGE, view);
  assert.ok(Math.abs(bottom.top - view.height * 0.6) < 1e-6);

  // 縦に20行並んだメニューが枠いっぱいに写っている
  const lines = Array.from({ length: 20 }, (_, index) => ({
    text: `Item number ${index}`,
    confidence: 0.9,
    box: { x: 0.4, y: visible.y + 0.02 + index * 0.035, width: 0.3, height: 0.012 },
  }));
  const tracked = track([lines, lines]);
  const pick = (region) =>
    selectOverlayLines(tracked, { maxEntries: 8, maxTextLength: 80, minHits: 2, visibleRegion: region }).map((entry) =>
      Number(entry.text.split(' ').pop()),
    );
  const whole = pick(visible);
  const seen = pick(unobstructed);
  // 隠れた範囲の行は選ばない
  const hiddenFrom = lines.findIndex((line) => line.box.y + line.box.height / 2 > unobstructed.y + unobstructed.height);
  assert.ok(seen.every((index) => index < hiddenFrom));
  // 枠全体の中央で選ぶと、見えている範囲の上の方の行は選ばれない（実機の「上側が訳されない」）
  assert.ok(Math.min(...whole) > Math.min(...seen));
});
