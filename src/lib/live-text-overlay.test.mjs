/**
 * ライブ翻訳の「訳を重ねる行の選び方・札の置き方」と、価格の一時的な読み違いの扱い（2026-11-25・Build 6 の実機確認から）。
 *
 * 実機（Build 6・iPhone 16 Pro・3列のカフェメニューを固定して写す）で見つかった問題:
 * - 中央の列（説明）ばかり訳され、左の列の商品名（Espresso・Cafe Latte 等）が英語のまま残る。
 *   下の価格一覧には商品名の訳が出ている＝OCRは商品名を読めていて、訳を重ねる行の選び方の問題
 * - `Orange Juice $5.60` の一覧に一時的に `$5.00 約¥815` が出た（別の時刻は `$5.60 約¥913` で正しい）
 *
 * メニューだけに合わせないよう、看板（1行に1つの文字）・左右に動かした時・上下の範囲も同じ選び方で確かめる。
 *
 * 実行: npm test（node --test "src/**\/*.test.mjs"）
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

globalThis.__DEV__ = false;

const { extractConfidentPriceCandidates, extractPriceCandidates } = await import('../utils/extract-prices.ts');
const core = await import('./live-text-core.ts');
const {
  buildSmartCameraEntries,
  buildTranslationPriceEntries,
  extractTranslationPrices,
  isStableLine,
  placeOverlayLabels,
  selectOverlayLines,
  updateTrackedLines,
  visibleRegionInImage,
} = core;

const usd = (text) => extractTranslationPrices(text, 'USD', (value) => extractConfidentPriceCandidates(value, 'USD'));

/** 縦向きの映像フレームと、翻訳ページのカメラ枠（iPhone 16 Pro で約 370×493pt） */
const IMAGE = { width: 1080, height: 1920 };
const VIEW = { width: 370, height: 493 };
const REGION = visibleRegionInImage(IMAGE, VIEW);
const MAX_LABELS = 14;

/** 品目（商品名・説明・価格）。幅は文字数からの概算 */
const ITEMS = [
  ['Espresso', 'Rich and bold coffee', '$3.50'],
  ['Americano', 'Espresso with hot water', '$4.00'],
  ['Cappuccino', 'Espresso with steamed milk foam', '$5.20'],
  ['Cafe Latte', 'Espresso with steamed milk', '$5.40'],
  ['Mocha', 'Espresso with chocolate and milk', '$5.60'],
  ['Flat White', 'Espresso with velvety milk', '$5.00'],
  ['Cold Brew', 'Slow steeped for 12 hours', '$4.80'],
  ['English Breakfast Tea', 'Classic black tea', '$4.20'],
  ['Earl Grey', 'Black tea with bergamot', '$4.20'],
  ['Green Tea', 'Japanese sencha', '$4.00'],
  ['Iced Lemon Tea', 'Black tea with lemon and ice', '$4.80'],
  ['Orange Juice', 'Squeezed daily', '$5.60'],
  ['Apple Juice', 'Fresh pressed apples', '$5.20'],
  ['Sparkling Water', 'Carbonated mineral water', '$3.20'],
  ['Still Water', 'Natural mineral water', '$2.80'],
  ['Hot Chocolate', 'Rich cocoa with cream', '$4.60'],
];
const CHAR_WIDTH = 0.0105;
const TEXT_HEIGHT = 0.012;

/**
 * 3列のメニュー（商品名｜説明｜価格）が見えている範囲いっぱいに写った1フレーム。
 * `dx`・`dy`：カメラを動かした分（映像の中で文字が動く量・正規化座標）
 */
function menuFrame({ dx = 0, dy = 0, jitter = 0, seed = 1, overrides = {} } = {}) {
  let state = seed;
  const noise = () => {
    state = (state * 16807) % 2147483647;
    return ((state / 2147483647) * 2 - 1) * jitter;
  };
  const top = REGION.y + 0.03;
  const pitch = (REGION.height - 0.06) / ITEMS.length;
  const lines = [];
  ITEMS.forEach(([name, description, price], index) => {
    const y = top + index * pitch + dy;
    const add = (text, x) =>
      lines.push({
        text: overrides[text] ?? text,
        confidence: 1,
        box: { x: x + dx + noise(), y: y + noise(), width: text.length * CHAR_WIDTH, height: TEXT_HEIGHT },
      });
    add(name, 0.06);
    add(description, 0.33);
    add(price, 0.85);
  });
  return lines;
}

function track(frames, start = 1000, interval = 800) {
  let tracked = [];
  frames.forEach((frame, index) => {
    tracked = updateTrackedLines(tracked, frame, start + index * interval);
  });
  return tracked;
}

const NAMES = new Set(ITEMS.map((item) => item[0]));
const DESCRIPTIONS = new Set(ITEMS.map((item) => item[1]));
const select = (tracked, extra = {}) =>
  selectOverlayLines(tracked, {
    maxEntries: MAX_LABELS,
    maxTextLength: 80,
    minHits: 2,
    visibleRegion: REGION,
    imageSize: IMAGE,
    ...extra,
  });
const countOf = (entries, set) => entries.filter((entry) => set.has(entry.text)).length;
/** 見えている範囲の中央に最も近い行の番号 */
function centerRowIndex(dy = 0) {
  const top = REGION.y + 0.03;
  const pitch = (REGION.height - 0.06) / ITEMS.length;
  const centerY = REGION.y + REGION.height / 2;
  let best = 0;
  ITEMS.forEach((_, index) => {
    const y = top + index * pitch + dy + TEXT_HEIGHT / 2;
    const bestY = top + best * pitch + dy + TEXT_HEIGHT / 2;
    if (Math.abs(y - centerY) < Math.abs(bestY - centerY)) best = index;
  });
  return best;
}

// MARK: - A. 3列のメニュー

test('3列のメニュー：中央の説明だけでなく、左の商品名も訳の候補に入る（中央の行は両方）', () => {
  const tracked = track([menuFrame(), menuFrame()]);
  const picked = select(tracked);
  assert.equal(picked.length, MAX_LABELS);
  const names = countOf(picked, NAMES);
  const descriptions = countOf(picked, DESCRIPTIONS);
  // 実機（Build 6）では14件のうち商品名は2件程度だった
  assert.ok(names >= 5, `商品名 ${names} 件・説明 ${descriptions} 件`);
  assert.ok(descriptions >= 5, `商品名 ${names} 件・説明 ${descriptions} 件`);
  // 中央の行は商品名と説明の両方
  const center = ITEMS[centerRowIndex()];
  const texts = picked.map((entry) => entry.text);
  assert.ok(texts.includes(center[0]) && texts.includes(center[1]), texts.join(' / '));
  // 価格だけの行は訳さない
  assert.ok(picked.every((entry) => !/^\$/.test(entry.text)));
});

test('3列のメニュー：実際に置かれる札も商品名と説明の両方・重ならない', () => {
  const tracked = track([menuFrame(), menuFrame()]);
  const picked = select(tracked);
  // 和訳は英語より横に長くなりがち（商品名の札が説明の札にかからないか）
  const rows = picked.map((entry) => ({
    id: entry.id,
    box: entry.box,
    translated: NAMES.has(entry.text) ? `${entry.text}の訳語です` : `${entry.text}（訳）`,
  }));
  const labels = placeOverlayLabels(rows, tracked, { frameSize: IMAGE, viewSize: VIEW, occludedBottom: 0, minHits: 2 });
  const byId = new Map(picked.map((entry) => [entry.id, entry.text]));
  const names = labels.filter((label) => NAMES.has(byId.get(label.id))).length;
  const descriptions = labels.filter((label) => DESCRIPTIONS.has(byId.get(label.id))).length;
  assert.ok(names >= 4, `置かれた商品名 ${names} 件・説明 ${descriptions} 件`);
  assert.ok(descriptions >= 4, `置かれた商品名 ${names} 件・説明 ${descriptions} 件`);
  // 札どうしは重ならず、同じ行の右の文字（説明・価格）の手前で止まる
  for (const a of labels) {
    for (const b of labels) {
      if (a === b) continue;
      const overlap = a.left < b.left + b.width && a.left + a.width > b.left && a.top < b.top + b.height && a.top + a.height > b.top;
      assert.ok(!overlap, `${byId.get(a.id)} と ${byId.get(b.id)} の札が重なる`);
    }
  }
  for (const label of labels.filter((item) => NAMES.has(byId.get(item.id)))) {
    // 説明の列（映像の x=0.33）の手前まで
    assert.ok(label.left + label.maxWidth <= 0.33 * VIEW.width + 1, `${byId.get(label.id)} の札が説明にかかる`);
  }
});

// MARK: - B. 看板・案内板（1行に1つの文字）

test('看板：1行に1つの文字（中央揃え）なら、従来と同じく上下の中央に近い順（上下の選び方を変えない）', () => {
  const texts = ['Gate 12', 'Please keep your belongings with you', 'Baggage Claim', 'No smoking', 'Restrooms', 'Taxi and Bus', 'Exit'];
  const sign = texts.map((text, index) => {
    const width = text.length * CHAR_WIDTH;
    return { text, confidence: 1, box: { x: 0.5 - width / 2, y: 0.2 + index * 0.09, width, height: TEXT_HEIGHT } };
  });
  const tracked = track([sign, sign]);
  const region = { x: 0, y: 0.125, width: 1, height: 0.75 };
  const centerY = region.y + region.height / 2;
  const expected = [...sign]
    .sort((a, b) => Math.abs(a.box.y + a.box.height / 2 - centerY) - Math.abs(b.box.y + b.box.height / 2 - centerY))
    .slice(0, 4)
    .map((line) => line.text);
  const picked = selectOverlayLines(tracked, { maxEntries: 4, maxTextLength: 80, minHits: 2, visibleRegion: region, imageSize: IMAGE });
  assert.deepEqual(
    picked.map((entry) => entry.text),
    expected,
  );
  // 映像の大きさを渡さない呼び方（従来）とも同じ
  const legacy = selectOverlayLines(tracked, { maxEntries: 4, maxTextLength: 80, minHits: 2, visibleRegion: region });
  assert.deepEqual(
    legacy.map((entry) => entry.text),
    expected,
  );
});

test('看板：中央以外にある大きな見出しも候補に入る', () => {
  const sign = [
    { text: 'WELCOME TO HONOLULU', confidence: 1, box: { x: 0.2, y: 0.18, width: 0.6, height: 0.04 } },
    ...Array.from({ length: 16 }, (_, index) => ({
      text: `Information line number ${index + 1}`,
      confidence: 1,
      box: { x: 0.2, y: 0.3 + index * 0.026, width: 0.5, height: TEXT_HEIGHT },
    })),
  ];
  const tracked = track([sign, sign]);
  const picked = selectOverlayLines(tracked, {
    maxEntries: MAX_LABELS,
    maxTextLength: 80,
    minHits: 2,
    visibleRegion: { x: 0, y: 0.125, width: 1, height: 0.75 },
    imageSize: IMAGE,
  });
  assert.ok(picked.some((entry) => entry.text === 'WELCOME TO HONOLULU'), picked.map((entry) => entry.text).join(' / '));
});

test('2列の看板・メニュー（左右に別の品目）：右の列の先頭の文字も説明扱いにしない', () => {
  const lines = [];
  for (let index = 0; index < 10; index += 1) {
    const y = 0.2 + index * 0.06;
    lines.push({ text: `Left item ${index}`, confidence: 1, box: { x: 0.05, y, width: 0.2, height: TEXT_HEIGHT } });
    lines.push({ text: '$4.50', confidence: 1, box: { x: 0.3, y, width: 0.08, height: TEXT_HEIGHT } });
    lines.push({ text: `Right item ${index}`, confidence: 1, box: { x: 0.55, y, width: 0.2, height: TEXT_HEIGHT } });
    lines.push({ text: '$6.50', confidence: 1, box: { x: 0.82, y, width: 0.08, height: TEXT_HEIGHT } });
  }
  const tracked = track([lines, lines]);
  const picked = selectOverlayLines(tracked, { maxEntries: 10, maxTextLength: 80, minHits: 2, visibleRegion: REGION, imageSize: IMAGE });
  const left = picked.filter((entry) => entry.text.startsWith('Left')).length;
  const right = picked.filter((entry) => entry.text.startsWith('Right')).length;
  assert.ok(left >= 3 && right >= 3, `左 ${left}・右 ${right}`);
});

// MARK: - C. 左右に動かす

for (const [label, dx] of [
  ['中央に固定', 0],
  ['左へ少し向ける（文字は右へ）', 0.08],
  ['右へ少し向ける（文字は左へ）', -0.08],
]) {
  test(`左右の向き：${label}でも、中央に最も近い文字が選ばれ、商品名と説明の両方が出る`, () => {
    const tracked = track([menuFrame({ dx }), menuFrame({ dx })]);
    const picked = select(tracked);
    assert.ok(countOf(picked, NAMES) >= 3, `商品名 ${countOf(picked, NAMES)}`);
    assert.ok(countOf(picked, DESCRIPTIONS) >= 3, `説明 ${countOf(picked, DESCRIPTIONS)}`);
    // 中央に最も近い文字（説明の列の中央の行）は必ず入る
    const center = ITEMS[centerRowIndex()][1];
    assert.ok(picked.some((entry) => entry.text === center));
  });
}

test('静止中：位置が少し揺れても、選ばれる行が入れ替わり続けない', () => {
  let tracked = [];
  let previousIds = new Set();
  let changes = 0;
  let previous = null;
  for (let index = 0; index < 12; index += 1) {
    tracked = updateTrackedLines(tracked, menuFrame({ jitter: 0.004, seed: index + 7 }), 1000 + index * 800);
    const picked = select(tracked, { previousIds });
    const key = picked.map((entry) => entry.id).sort().join('|');
    if (index >= 2 && previous != null && key !== previous) changes += 1;
    previous = key;
    previousIds = new Set(picked.map((entry) => entry.id));
  }
  assert.ok(changes <= 1, `選ばれる行が ${changes} 回入れ替わった`);
});

// MARK: - D. 上下の範囲（Build 6 の改善を保つ）

test('上下の範囲：見えている範囲の上側の行も選ばれ、範囲外の行は選ばない', () => {
  const tracked = track([menuFrame(), menuFrame()]);
  const upper = { ...REGION, height: REGION.height * 0.6 };
  const picked = select(tracked, { visibleRegion: upper });
  assert.ok(picked.length > 0);
  for (const entry of picked) {
    const centerY = entry.box.y + entry.box.height / 2;
    assert.ok(centerY >= upper.y && centerY <= upper.y + upper.height);
  }
  // 範囲の上から3行のどれかは選ばれる（上側が排除されない）
  const topRows = new Set(ITEMS.slice(0, 3).flatMap((item) => [item[0], item[1]]));
  assert.ok(picked.some((entry) => topRows.has(entry.text)));
});

// MARK: - F. 価格の一時的な読み違い

test('価格：最初の1フレームだけ$5.60を$5.00と読んでも、その後の正しい読みで$5.60になる（読み違いが残らない）', () => {
  const misread = menuFrame({ overrides: { '$5.60': '$5.00' } });
  const tracked = track([misread, menuFrame(), menuFrame()]);
  const entries = buildTranslationPriceEntries(tracked, usd, {
    maxEntries: 40,
    maxTextLength: 80,
    minHits: 2,
    visibleRegion: REGION,
    imageSize: IMAGE,
  });
  const juice = entries.find((entry) => entry.label === 'Orange Juice');
  assert.ok(juice != null);
  assert.deepEqual(juice.amounts, [5.6]);
});

test('価格：読みが割れている間は、その価格を出さない（2回目で確定・同じ読みが続けば従来どおり2回目で出す）', () => {
  const lines = (text) => [
    { text: 'Orange Juice', confidence: 1, box: { x: 0.1, y: 0.5, width: 0.2, height: TEXT_HEIGHT } },
    { text, confidence: 1, box: { x: 0.8, y: 0.5, width: 0.08, height: TEXT_HEIGHT } },
  ];
  const options = { maxEntries: 6, maxTextLength: 80, minHits: 2, visibleRegion: { x: 0, y: 0, width: 1, height: 1 }, imageSize: IMAGE };
  // 読みが割れた2回目は出さない
  const split = track([lines('$5.00'), lines('$5.60')]);
  assert.deepEqual(buildTranslationPriceEntries(split, usd, options), []);
  // 3回目で多い方（$5.60）に決まる
  const settled = track([lines('$5.00'), lines('$5.60'), lines('$5.60')]);
  assert.deepEqual(buildTranslationPriceEntries(settled, usd, options).map((entry) => entry.amounts), [[5.6]]);
  // 同じ読みが続く時は、従来どおり2回目で出る（価格が出るのを遅らせない）
  const steady = track([lines('$5.60'), lines('$5.60')]);
  assert.deepEqual(buildTranslationPriceEntries(steady, usd, options).map((entry) => entry.amounts), [[5.6]]);
  // 確定した後の1回だけの読み違いでは変わらない
  const blip = track([lines('$5.60'), lines('$5.60'), lines('$5.00')]);
  assert.deepEqual(buildTranslationPriceEntries(blip, usd, options).map((entry) => entry.amounts), [[5.6]]);
  // メインカメラも同じ追跡を使う
  const smart = buildSmartCameraEntries(blip, (text) => extractPriceCandidates(text, 'USD'), options);
  assert.deepEqual(smart.filter((entry) => entry.kind === 'price').map((entry) => entry.amount), [5.6]);
  assert.equal(isStableLine(split.find((line) => /\$/.test(line.text))), false);
});

test('数字を含む普通の文：英字だけ1文字ずつ揺れても、2回目から出て途中で消えない（訳も差し替わらない）', () => {
  const readings = [
    'Slow steeped for 12 hours',
    'Slow steeped for 12 houre',
    'Slow stceped for 12 hours',
    'SIow steeped for 12 hours',
    'Slow steeped tor 12 hours',
    'Slow steeped for 12 hourS',
    'Slow steepcd for 12 hours',
  ];
  let tracked = [];
  readings.forEach((text, index) => {
    tracked = updateTrackedLines(
      tracked,
      [{ text, confidence: 1, box: { x: 0.3, y: 0.5, width: 0.3, height: TEXT_HEIGHT } }],
      1000 + index * 800,
    );
    assert.equal(tracked.length, 1);
    if (index >= 1) {
      assert.equal(isStableLine(tracked[0]), true, `${index + 1}回目に表示されない`);
      // 大文字小文字だけの違い（hourS）は同じ読み（最新の書き方を採るのは従来どおり）
      assert.equal(tracked[0].text.toLowerCase(), readings[0].toLowerCase(), `${index + 1}回目に原文が替わった`);
    }
  });
});

test('数字の無い行：直近の読みがすべて違っても、原文は替わらない（訳を取り直して札が消えない）', () => {
  const readings = ['Japanese sencha', 'Japanese scncha', 'Japancse sencha', 'Japanese sencba', 'Japanese sench a', 'Japanesc sencha'];
  let tracked = [];
  readings.forEach((text, index) => {
    tracked = updateTrackedLines(tracked, [{ text, confidence: 1, box: { x: 0.3, y: 0.5, width: 0.3, height: TEXT_HEIGHT } }], 1000 + index * 800);
  });
  assert.equal(tracked[0].text, 'Japanese sencha');
  assert.equal(isStableLine(tracked[0]), true);
});

test('読みの確度が明らかに上がった時は、従来どおりすぐその読みを採る', () => {
  let tracked = updateTrackedLines([], [{ text: 'Garlic Chickcn', confidence: 0.5, box: { x: 0.3, y: 0.5, width: 0.3, height: TEXT_HEIGHT } }], 1000);
  tracked = updateTrackedLines(tracked, [{ text: 'Garlic Chicken', confidence: 1, box: { x: 0.3, y: 0.5, width: 0.3, height: TEXT_HEIGHT } }], 1800);
  assert.equal(tracked[0].text, 'Garlic Chicken');
});

test('価格：小数部が崩れた読み（$5. 60・$5 .60・$5.G0）は$5.00として出さない', () => {
  for (const text of ['$5. 60', '$5 .60', '$5.G0', 'Orange Juice $5. 60', '5. 60']) {
    assert.deepEqual(usd(text), [], text);
  }
  // 正しい読み・よくある書き方は従来どおり
  assert.deepEqual(usd('$5.60'), [5.6]);
  assert.deepEqual(usd('$5'), [5]);
  assert.deepEqual(usd('$5.6O'), [5.6]);
  assert.deepEqual(usd('M $5.25 L $6.00'), [5.25, 6]);
  assert.deepEqual(usd('$5.60 $5.00'), [5.6, 5]);
  // 普通の文の「1, 2」は崩れた小数にしない
  assert.deepEqual(usd('Pick 1, 2 or 3 toppings $9.50'), [9.5]);
});

test('価格：円換算の式は正しい（実機の約¥815は$5.00×163、約¥913は$5.60×163＝換算でなく読んだ価格の違い）', async () => {
  const { convert } = await import('../utils/currency.ts');
  assert.equal(Math.round(convert(5.6, 163, 'TO_JPY')), 913);
  assert.equal(Math.round(convert(5, 163, 'TO_JPY')), 815);
});
