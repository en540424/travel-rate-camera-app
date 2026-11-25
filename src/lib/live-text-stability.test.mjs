/**
 * ライブ翻訳の表示の安定性（2026-11-25・Build 7 の実機確認から）。
 *
 * 実機（Build 7・3列のカフェメニューを固定して写す）で見つかった問題:
 * - カメラを止めていても、訳の札が消えたり別の行の訳に替わったりし続け、落ち着いて読めない
 * - 枠の下部の価格（最大3件）が次々に入れ替わり、一瞬だけ別の商品の価格が付く
 *   （Orange Juice に $3.20、Iced Lemon Tea に $5.60 等。正しくは $5.60・$4.80）
 *
 * 原因（シミュレーションとこのテストで確かめた範囲）:
 * - Vision は静止したメニューでも毎フレーム1割ほどの行を読み落とす。読み落としが2回続くと追跡の`staleMs`（1.5秒）を
 *   過ぎて行が消え、次に読めた時は新しい行として2フレーム目まで出なかった（札・価格の入れ替わりの大半）
 * - 同じ値段の行が2つある時、片方が追跡から外れると、残った方が別の行の同じ値段へ付け替わり、位置を滑らかに
 *   追従させるため2行の途中（間の別の商品の行）に置かれて、その行の商品名と組になった
 * - 少し傾けて持つと、商品名と説明の上下の重なりが「同じ行」の判定の境目（50%）付近になり、位置の揺れで
 *   説明を後回しにするかが毎フレーム変わって、選ばれる行が入れ替わった
 * - Vision が同じ行の商品名と説明を1行にまとめて読むと、新しい行として札・価格の名前が入れ替わった
 * 実機で上のどれがどの程度起きていたかは、このテストでは確定できない（実機確認が要る）。
 *
 * 「止めれば落ち着く」と「動かせば替わる」を両方確かめる。動かした時の替わり方は、修正前と同じかより早いこと。
 *
 * 実行: npm test（node --test "src/**\/*.test.mjs"）
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

globalThis.__DEV__ = false;

const { extractConfidentPriceCandidates } = await import('../utils/extract-prices.ts');
const core = await import('./live-text-core.ts');
const {
  buildSmartCameraEntries,
  buildTranslationPriceEntries,
  extractTranslationPrices,
  placeOverlayLabels,
  selectOverlayLines,
  textSimilarity,
  unobstructedRegionInImage,
  updateTrackedLines,
  visibleRegionInImage,
} = core;

const usd = (text) => extractTranslationPrices(text, 'USD', (value) => extractConfidentPriceCandidates(value, 'USD'));

/** 縦向きの映像フレームと、翻訳ページのカメラ枠（iPhone 16 Pro で約 370×493pt） */
const IMAGE = { width: 1080, height: 1920 };
const VIEW = { width: 370, height: 493 };
const REGION = visibleRegionInImage(IMAGE, VIEW);
const MAX_LABELS = 14;
const CHAR_WIDTH = 0.0105;
const TEXT_HEIGHT = 0.012;

/** 3列のメニュー（商品名｜説明｜価格）。同じ値段の品目を含む（$4.00・$4.20・$4.80・$5.20・$5.60） */
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
const PRICE_OF = new Map(ITEMS.map(([name, , price]) => [name, Number(price.slice(1))]));
/** 価格の名前に出うる文字（商品名・説明・まとめて読んだ行）→ その品目の価格 */
const PRICE_OF_TEXT = new Map(
  ITEMS.flatMap(([name, description, price]) => {
    const amount = Number(price.slice(1));
    return [
      [name, amount],
      [description, amount],
      [`${name} ${description}`, amount],
    ];
  }),
);

function random(seed) {
  let state = seed;
  return () => {
    state = (state * 16807) % 2147483647;
    return state / 2147483647;
  };
}

/**
 * メニューを写した1フレーム（Visionの読み方を模す）。
 * - `drop`：行ごとに読み落とす確率／`merge`：商品名と説明を1行にまとめて読む確率／順序は毎回入れ替わる
 * - `misread`：文字の行（価格以外）を1文字読み違える確率
 * - `slope`：端末を回して持った傾き（px の dx/dy）。文字の枠は傾いた文字を囲む分だけ縦に広がる
 * - `items`・`dy`：写っているもの・カメラを動かした分
 */
function menuFrame(
  rand,
  { items = ITEMS, dx = 0, dy = 0, drop = 0.1, merge = 0, slope = 0, jitter = 0.002, misread = 0 } = {},
) {
  const top = REGION.y + 0.03;
  const pitch = (REGION.height - 0.06) / 16;
  const noise = () => (rand() * 2 - 1) * jitter;
  const lines = [];
  items.forEach((row, index) => {
    const y = top + index * pitch + dy;
    const add = (original, x, spanTo = null) => {
      if (rand() < drop) return;
      const text = !/\d/.test(original) && rand() < misread ? garble(rand, original) : original;
      // まとめて読んだ行の枠は、商品名の左端から説明の右端まで（Visionは両方を囲む枠を返す）
      const width = spanTo ?? text.length * CHAR_WIDTH;
      const tilt = Math.abs(slope) * width * (IMAGE.width / IMAGE.height);
      lines.push({
        text,
        confidence: 1,
        box: {
          x: x + slope * (y - 0.5) * (IMAGE.height / IMAGE.width) + dx + noise(),
          y: y - slope * x * (IMAGE.width / IMAGE.height) - (slope > 0 ? tilt : 0) + noise(),
          width,
          height: TEXT_HEIGHT + tilt,
        },
      });
    };
    const [name, description, price] = row;
    if (description != null && rand() < merge) {
      add(`${name} ${description}`, 0.06, 0.33 + description.length * CHAR_WIDTH - 0.06);
    } else {
      add(name, 0.06);
      if (description != null) add(description, 0.33);
    }
    if (price != null) add(price, 0.85);
  });
  for (let i = lines.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [lines[i], lines[j]] = [lines[j], lines[i]];
  }
  return lines;
}

/** 1文字を読み違える（"Mocha"→"Mochi" 等） */
function garble(rand, text) {
  const index = Math.floor(rand() * text.length);
  const replacement = 'aeilo'[Math.floor(rand() * 5)];
  return text.slice(0, index) + (text[index] === replacement ? 'x' : replacement) + text.slice(index + 1);
}

const fakeTranslation = (text) => 'あ'.repeat(Math.max(2, Math.ceil(text.length * 0.45)));

/**
 * 翻訳ページのカメラと同じ流れ（追跡 → 価格 → 訳を重ねる行の選択 → 札の配置。前回の選択・配置を引き継ぐ）を
 * フレームごとに回し、各フレームで「出ている札（原文）」「下部の帯の価格（最大3件）」を返す。
 * フレームの間隔は認識の時間込みの 0.9〜1.2 秒（実機の 0.8 秒間隔＋認識の時間）
 */
function runCamera(frames, seed) {
  const rand = random(seed);
  let tracked = [];
  let previousSelection = new Set();
  let skippedLabels = new Set();
  let now = 1000;
  return frames.map((options) => {
    now += 900 + Math.floor(rand() * 300);
    tracked = updateTrackedLines(tracked, menuFrame(rand, options), now);
    const prices = buildTranslationPriceEntries(tracked, usd, {
      maxEntries: 6,
      maxTextLength: 80,
      minHits: 2,
      visibleRegion: unobstructedRegionInImage(IMAGE, VIEW, 0),
      imageSize: IMAGE,
    });
    const strip = prices.flatMap((entry) => entry.amounts.map((amount) => ({ name: entry.label, amount }))).slice(0, 3);
    const occluded = strip.length > 0 ? 12 + strip.length * 27 : 0;
    const selected = selectOverlayLines(tracked, {
      maxEntries: MAX_LABELS,
      maxTextLength: 80,
      minHits: 2,
      visibleRegion: unobstructedRegionInImage(IMAGE, VIEW, occluded),
      imageSize: IMAGE,
      previousIds: previousSelection,
    });
    previousSelection = new Set(selected.map((entry) => entry.id));
    const inputs = selected.map((entry) => ({
      id: entry.id,
      box: entry.box,
      translated: fakeTranslation(entry.text),
    }));
    const labels = placeOverlayLabels(inputs, tracked, {
      frameSize: IMAGE,
      viewSize: VIEW,
      occludedBottom: occluded,
      minHits: 2,
      skippedIds: skippedLabels,
    });
    const placed = new Set(labels.map((label) => label.id));
    skippedLabels = new Set(inputs.filter((input) => !placed.has(input.id)).map((input) => input.id));
    const lineOf = new Map(tracked.map((line) => [line.id, line]));
    return {
      now,
      labels: labels.map((label) => ({
        text: lineOf.get(label.id).text,
        box: lineOf.get(label.id).box,
      })),
      strip,
    };
  });
}

/** 前のフレームから札が替わった（出た・消えた）回数。最初の`skip`フレーム（出始め）は数えない */
function labelChanges(results, skip = 2) {
  let changes = 0;
  for (let i = skip + 1; i < results.length; i += 1) {
    const before = new Set(results[i - 1].labels.map((label) => label.text));
    const after = new Set(results[i].labels.map((label) => label.text));
    changes +=
      [...after].filter((text) => !before.has(text)).length + [...before].filter((text) => !after.has(text)).length;
  }
  return changes;
}

function stripChanges(results, skip = 2) {
  let changes = 0;
  const key = (result) => result.strip.map((row) => `${row.name}|${row.amount}`).join(' / ');
  for (let i = skip + 1; i < results.length; i += 1) if (key(results[i]) !== key(results[i - 1])) changes += 1;
  return changes;
}

/**
 * 帯に出た「名前と価格」のうち、その品目の価格でないもの（商品名・説明・まとめて読んだ行のどれを名前にしていても）。
 * 1文字読み違えた名前（"earl Grey"）は、いちばん近い文字の品目として比べる
 */
function priceOfName(name) {
  if (PRICE_OF_TEXT.has(name)) return PRICE_OF_TEXT.get(name);
  let best = null;
  let bestSimilarity = 0;
  for (const [text, amount] of PRICE_OF_TEXT) {
    const similarity = textSimilarity(text.toLowerCase(), name.toLowerCase());
    if (similarity > bestSimilarity) {
      bestSimilarity = similarity;
      best = amount;
    }
  }
  return bestSimilarity >= 0.8 ? best : undefined;
}
function mispairs(results) {
  return results.flatMap((result) =>
    result.strip.filter((row) => row.name != null && priceOfName(row.name) !== row.amount),
  );
}

const SEEDS = [101, 202, 303, 404, 505];
/** 原文の差し替えの上限（修正前の実測 20 回・修正後 20 回。途中で試した「場面の切り替え」の判定では読み違いの多い場面で数倍に増えたため採らなかった） */
const REPLACEMENT_LIMIT = 30;
const still = (count, options = {}) => Array.from({ length: count }, () => options);

// MARK: - A・B. 静止中（読み落とし・順序の入れ替わり・位置の揺れ）

test('静止中：1割の行を毎回読み落としても、札はほとんど替わらない（5回分×40フレームで修正前120回→2回）', () => {
  let total = 0;
  for (const seed of SEEDS) total += labelChanges(runCamera(still(40), seed));
  // 余裕を見て 5回分で15回まで
  assert.ok(total <= 15, `札の入れ替わり ${total} 回（5回分×40フレーム）`);
});

test('静止中：下部の価格3件は、読み落とし・読む順序・位置の揺れで入れ替わらない（5回分×40フレームで修正前27回→1回）', () => {
  let total = 0;
  for (const seed of SEEDS) total += stripChanges(runCamera(still(40), seed));
  assert.ok(total <= 5, `帯の入れ替わり ${total} 回（5回分×40フレーム）`);
});

test('静止中：読み落としが2回続いても、その行の札は消えない', () => {
  // 3フレーム目・4フレーム目に Mocha（中央付近の商品名）だけ読めない。他の行は読める（静止）
  const rand = random(7);
  let tracked = [];
  const shown = [];
  for (let frame = 0; frame < 6; frame += 1) {
    const lines = menuFrame(rand, { drop: 0 }).filter(
      (line) => !(line.text === 'Mocha' && (frame === 2 || frame === 3)),
    );
    tracked = updateTrackedLines(tracked, lines, 1000 + frame * 1100);
    const mocha = tracked.find((line) => line.text === 'Mocha');
    shown.push(mocha?.id ?? null);
  }
  // 同じ識別子のまま残る（新しい行として出直さない＝札が消えない・訳を取り直さない）
  assert.ok(
    shown.slice(1).every((id) => id != null && id === shown[1]),
    shown.join(' / '),
  );
});

test('静止中：傾けて持っても（約1.7°）札は落ち着く（5回分×40フレームで修正前96回→4回）', () => {
  let total = 0;
  for (const seed of SEEDS) total += labelChanges(runCamera(still(40, { slope: 0.03 }), seed));
  assert.ok(total <= 30, `札の入れ替わり ${total} 回（5回分×40フレーム）`);
});

test('静止中：商品名と説明を時々1行にまとめて読んでも、まとめた行を新しい札・価格の名前にしない', () => {
  const merged = new Set(ITEMS.map(([name, description]) => `${name} ${description}`));
  let mergedLabels = 0;
  let mergedNames = 0;
  for (const seed of SEEDS) {
    for (const result of runCamera(still(40, { merge: 0.05 }), seed)) {
      mergedLabels += result.labels.filter((label) => merged.has(label.text)).length;
      mergedNames += result.strip.filter((row) => merged.has(row.name)).length;
    }
  }
  // 修正前 5件→2件。2回続けてまとめて読んだ時は、その読みが正しい可能性もあるので出る（0にはしない）
  assert.ok(mergedLabels <= 3, `まとめた行の札 ${mergedLabels} 件`);
  assert.ok(mergedNames <= 3, `まとめた行を名前にした価格 ${mergedNames} 件`);
});

// MARK: - C. 商品と価格の対応

test('同じ値段の2行：片方が追跡から外れても、残った価格を2行の途中（別の商品の行）に置かない', () => {
  // 行0と行5が同じ $4.00。行3（Flat White）は価格が読めない。行5の価格が4回続けて読めず追跡から外れた後、
  // 行0の価格だけ読めないフレームが来る（修正前：行0の追跡が行5の$4.00へ付け替わり、途中の行3に置かれて Flat White=$4.00）
  const rows = [
    ['Americano', '$4.00'],
    ['Cafe Latte', '$5.40'],
    ['Mocha', '$5.60'],
    ['Flat White', null],
    ['Cold Brew', '$4.80'],
    ['Green Tea', '$4.00'],
  ];
  const line = (text, x, y) => ({
    text,
    confidence: 1,
    box: { x, y, width: text.length * CHAR_WIDTH, height: TEXT_HEIGHT },
  });
  const frame = (skip) =>
    rows.flatMap(([name, price], index) => [
      line(name, 0.06, 0.2 + index * 0.03),
      ...(price == null || skip.includes(index) ? [] : [line(price, 0.55, 0.2 + index * 0.03)]),
    ]);
  const sequence = [[], [], [5], [5], [5], [5], [0], [0]];
  let tracked = [];
  sequence.forEach((skip, index) => {
    tracked = updateTrackedLines(tracked, frame(skip), 1000 + index * 1100);
    const entries = buildTranslationPriceEntries(tracked, usd, {
      maxEntries: 6,
      maxTextLength: 80,
      minHits: 2,
      visibleRegion: { x: 0, y: 0, width: 1, height: 1 },
      imageSize: IMAGE,
    });
    const wrong = entries.filter(
      (entry) =>
        entry.label != null &&
        !rows.some(
          ([name, price]) => name === entry.label && price != null && entry.amounts.includes(Number(price.slice(1))),
        ),
    );
    assert.deepEqual(
      wrong.map((entry) => `${entry.label}=${entry.amounts}`),
      [],
      `${index + 1}フレーム目`,
    );
  });
});

test('静止中・手ぶれ・傾き・読み落とし3割でも、別の商品の価格を付けない（帯の全フレーム）', () => {
  const conditions = [{}, { drop: 0.3 }, { slope: 0.04, drop: 0.3 }, { merge: 0.05 }, { misread: 0.1, drop: 0.2 }];
  for (const condition of conditions) {
    for (const seed of SEEDS) {
      const frames = Array.from({ length: 30 }, (_, index) => ({
        ...condition,
        dx: 0.005 * Math.sin(index),
        dy: 0.02 * Math.sin(index * 1.7),
      }));
      const wrong = mispairs(runCamera(frames, seed));
      assert.deepEqual(wrong, [], `${JSON.stringify(condition)} seed ${seed} ${JSON.stringify(wrong)}`);
    }
  }
});

test('メインカメラ（同じ追跡を共有）：同じ値段の行の付け替わりで、別の商品の価格を出さない', () => {
  const rows = [
    ['Americano', '$4.00'],
    ['Cafe Latte', '$5.40'],
    ['Mocha', '$5.60'],
    ['Flat White', null],
    ['Cold Brew', '$4.80'],
    ['Green Tea', '$4.00'],
  ];
  const line = (text, x, y) => ({
    text,
    confidence: 1,
    box: { x, y, width: text.length * CHAR_WIDTH, height: TEXT_HEIGHT },
  });
  const frame = (skip) =>
    rows.flatMap(([name, price], index) => [
      line(name, 0.06, 0.2 + index * 0.03),
      ...(price == null || skip.includes(index) ? [] : [line(price, 0.55, 0.2 + index * 0.03)]),
    ]);
  let tracked = [];
  [[], [], [5], [5], [5], [5], [0], [0]].forEach((skip, index) => {
    tracked = updateTrackedLines(tracked, frame(skip), 1000 + index * 1100);
    const entries = buildSmartCameraEntries(tracked, (text) => extractConfidentPriceCandidates(text, 'USD'), {
      maxEntries: 6,
      maxTextLength: 40,
      minHits: 2,
      visibleRegion: { x: 0, y: 0, width: 1, height: 1 },
      imageSize: IMAGE,
    });
    for (const entry of entries) {
      if (entry.kind !== 'price' || entry.label == null) continue;
      const row = rows.find(([name]) => name === entry.label);
      assert.ok(
        row?.[1] != null && Number(row[1].slice(1)) === entry.amount,
        `${index + 1}フレーム目 ${entry.label}=${entry.amount}`,
      );
    }
  });
});

/**
 * 端末を回す・近づける動き（平行移動ではない）。画像の中心を軸に`scale`倍・`roll`ラジアン回したメニュー（商品名｜価格の2列）。
 * 平行移動だけで予測する追跡では、左右の列が逆向きに動くので、距離で対応を退けると正しい対応まで新しい行になり、
 * 古い価格の行が隣の商品と組になった（独立レビューの指摘）
 */
const TWO_COLUMN = ITEMS.map(([name, , price]) => [name, price]);
function transformedFrame(rand, { pitch = 0.026, scale = 1, roll = 0, dy = 0, drop = 0.1 }) {
  const lines = [];
  const top = 0.5 - ((TWO_COLUMN.length - 1) * pitch) / 2;
  TWO_COLUMN.forEach(([name, price], index) => {
    const y = top + index * pitch;
    for (const [text, x] of [
      [name, 0.15],
      [price, 0.75],
    ]) {
      if (rand() < drop) continue;
      const width = text.length * CHAR_WIDTH;
      const cx = (x + width / 2 - 0.5) * IMAGE.width;
      const cy = (y + TEXT_HEIGHT / 2 - 0.5) * IMAGE.height;
      const rx = (cx * Math.cos(roll) - cy * Math.sin(roll)) * scale;
      const ry = (cx * Math.sin(roll) + cy * Math.cos(roll)) * scale;
      const boxWidth = width * scale;
      const boxHeight = TEXT_HEIGHT * scale + (Math.abs(Math.sin(roll)) * width * scale * IMAGE.width) / IMAGE.height;
      lines.push({
        text,
        confidence: 1,
        box: {
          x: 0.5 + rx / IMAGE.width - boxWidth / 2 + (rand() * 2 - 1) * 0.002,
          y: 0.5 + ry / IMAGE.height - boxHeight / 2 + dy + (rand() * 2 - 1) * 0.002,
          width: boxWidth,
          height: boxHeight,
        },
      });
    }
  });
  for (let i = lines.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [lines[i], lines[j]] = [lines[j], lines[i]];
  }
  return lines;
}

test('回す・近づける・平行に動かす時：別の商品の価格を付けない（翻訳ページの帯・メインカメラ。修正前と同じく0件）', () => {
  const still = (count, options) => Array.from({ length: count }, () => options);
  const degree = Math.PI / 180;
  const motions = [];
  for (const pitch of [0.02, 0.026, 0.04]) {
    for (const step of [0.03, 0.05, 0.08]) {
      motions.push([
        `近づける ${step}`,
        [
          ...still(6, { pitch }),
          ...Array.from({ length: 5 }, (_, i) => ({ pitch, scale: 1 + step * (i + 1) })),
          ...still(5, { pitch, scale: 1 + step * 5 }),
        ],
      ]);
    }
    motions.push([
      '回す 1.5°×3',
      [
        ...still(6, { pitch }),
        ...Array.from({ length: 3 }, (_, i) => ({ pitch, roll: 1.5 * degree * (i + 1) })),
        ...still(5, { pitch, roll: 4.5 * degree }),
      ],
    ]);
    motions.push([
      '平行 0.03×5',
      [
        ...still(6, { pitch }),
        ...Array.from({ length: 5 }, (_, i) => ({ pitch, dy: 0.03 * (i + 1) })),
        ...still(5, { pitch, dy: 0.15 }),
      ],
    ]);
  }
  for (const [name, frames] of motions) {
    for (const seed of SEEDS) {
      const rand = random(seed);
      let tracked = [];
      let now = 1000;
      frames.forEach((options, index) => {
        now += 900 + Math.floor(rand() * 300);
        tracked = updateTrackedLines(tracked, transformedFrame(rand, options), now);
        const where = `${name} 行の間隔${options.pitch} seed ${seed} ${index + 1}フレーム目`;
        for (const entry of buildTranslationPriceEntries(tracked, usd, {
          maxEntries: 30,
          maxTextLength: 80,
          minHits: 2,
          visibleRegion: { x: 0, y: 0, width: 1, height: 1 },
          imageSize: IMAGE,
        })) {
          if (entry.label != null && PRICE_OF.has(entry.label)) {
            assert.ok(entry.amounts.includes(PRICE_OF.get(entry.label)), `${where} ${entry.label}=${entry.amounts}`);
          }
        }
        for (const entry of buildSmartCameraEntries(tracked, (text) => extractConfidentPriceCandidates(text, 'USD'), {
          maxEntries: 30,
          maxTextLength: 40,
          minHits: 2,
          visibleRegion: { x: 0, y: 0, width: 1, height: 1 },
          imageSize: IMAGE,
        })) {
          if (entry.kind === 'price' && entry.label != null && PRICE_OF.has(entry.label)) {
            assert.equal(entry.amount, PRICE_OF.get(entry.label), `メインカメラ ${where} ${entry.label}`);
          }
        }
      });
    }
  }
});

// MARK: - D・H. カメラを動かした時（古い表示を残さない・遅くしない）

/** 同じ並びの別のメニュー（向け直した先）と、その元のメニュー。価格は無し（訳の札だけを比べる） */
const MENU_A = ITEMS.map((_, index) => [`Alpha item ${index}`, `Alpha description of ${index}`]);
const OTHER_MENU = ITEMS.map((_, index) => [`Bravo item ${index}`, `Bravo description of ${index}`]);

test('別のメニューへ向けた時：新しい札は2フレーム目に出て3フレーム目に10件そろい、古い札は修正前より長く残らない', () => {
  // 修正前の実測（同じ乱数の種）：古い札が消えたのは 4・4・6・5・5 フレーム目。似た文字の行（"Alpha description of 5" と
  // "Bravo description of 5"）は同じ行として追跡され、原文の多数決で古い訳が数フレーム残る（修正前からの残存リスク）
  const before = { 101: 4, 202: 4, 303: 6, 404: 5, 505: 5 };
  for (const seed of SEEDS) {
    const results = runCamera([...still(10, { items: MENU_A }), ...still(8, { items: OTHER_MENU })], seed);
    const after = results.slice(10);
    const oldGone = after.findIndex((result) => result.labels.every((label) => !label.text.startsWith('Alpha'))) + 1;
    const newShown = after.findIndex((result) => result.labels.some((label) => label.text.startsWith('Bravo'))) + 1;
    const newFull =
      after.findIndex((result) => result.labels.filter((label) => label.text.startsWith('Bravo')).length >= 10) + 1;
    assert.ok(
      oldGone >= 1 && oldGone <= before[seed],
      `seed ${seed} 古い札が消えたのは ${oldGone} フレーム目（修正前 ${before[seed]}）`,
    );
    assert.ok(newShown >= 1 && newShown <= 2, `seed ${seed} 新しい札が出たのは ${newShown} フレーム目`);
    assert.ok(newFull >= 1 && newFull <= 3, `seed ${seed} 新しい札10件は ${newFull} フレーム目`);
    // 切り替えに要した時間（向けてから新しい札が出るまで）。認識2回分（約2.4秒以内）
    const elapsed = after[newShown - 1].now - results[9].now;
    assert.ok(elapsed <= 2400, `seed ${seed} ${elapsed}ms`);
  }
});

test('メニューの上で大きく動かした時：札・価格は文字の本当の位置に付いて動き、古い位置に残らない', () => {
  const top = REGION.y + 0.03;
  const pitch = (REGION.height - 0.06) / 16;
  for (const seed of SEEDS) {
    const frames = [...still(10, { dy: 0 }), { dy: -0.08 }, { dy: -0.16 }, { dy: -0.24 }, ...still(5, { dy: -0.24 })];
    const results = runCamera(frames, seed);
    results.slice(10).forEach((result, k) => {
      const dy = frames[10 + k].dy;
      for (const label of result.labels) {
        const index = ITEMS.findIndex(([name, description]) => name === label.text || description === label.text);
        if (index < 0) continue;
        const expectedY = top + index * pitch + dy;
        assert.ok(Math.abs(label.box.y - expectedY) <= 0.02, `seed ${seed} 動き始めて${k + 1}フレーム目 ${label.text}`);
      }
      for (const row of result.strip) {
        if (row.name != null && PRICE_OF.has(row.name))
          assert.equal(row.amount, PRICE_OF.get(row.name), `seed ${seed} ${row.name}`);
      }
    });
  }
});

test('同じ所の文字が替わった時（看板の表示が替わる等）：古い札を延長して残さず、新しい訳へ替わる', () => {
  const changed = MENU_A.map((row, index) => (index === 5 ? ['Totally different words', row[1]] : row));
  for (const seed of SEEDS) {
    const after = runCamera([...still(10, { items: MENU_A }), ...still(6, { items: changed })], seed).slice(10);
    const oldGone = after.findIndex((result) => !result.labels.some((label) => label.text === 'Alpha item 5')) + 1;
    const newShown =
      after.findIndex((result) => result.labels.some((label) => label.text === 'Totally different words')) + 1;
    assert.ok(oldGone >= 1 && oldGone <= 2, `seed ${seed} 古い札 ${oldGone}`);
    assert.ok(newShown >= 1 && newShown <= 3, `seed ${seed} 新しい札 ${newShown}`);
  }
});

test('静止→移動→静止：静止中は落ち着き、動かした直後に替わり、止めるとまた落ち着く', () => {
  for (const seed of SEEDS) {
    const frames = [...still(15, { items: MENU_A }), ...still(15, { items: OTHER_MENU })];
    const results = runCamera(frames, seed);
    const firstStill = labelChanges(results.slice(0, 15));
    const secondStill = labelChanges(results.slice(21), 0);
    assert.ok(firstStill <= 6, `seed ${seed} 1回目の静止中 ${firstStill} 回`);
    assert.ok(secondStill <= 6, `seed ${seed} 2回目の静止中 ${secondStill} 回`);
    // 動かした後：新しい札は2フレーム目に出て、古い札は6フレーム目までに消える（修正前と同じ）
    assert.ok(
      results[16].labels.some((label) => label.text.startsWith('Bravo')),
      `seed ${seed} 新しい札が出ない`,
    );
    assert.ok(
      results[20].labels.every((label) => label.text.startsWith('Bravo')),
      `seed ${seed} 動かした後に古い札が残る`,
    );
  }
});

test('1行だけの看板を横に大きく動かしても（動きを推定できない）、同じ行として追跡し続ける（札が出直さない）', () => {
  const sign = (x) => [
    {
      text: 'Platform 3',
      confidence: 1,
      box: { x, y: 0.5, width: 0.2, height: 0.04 },
    },
  ];
  let tracked = updateTrackedLines([], sign(0.1), 1000);
  const id = tracked[0].id;
  for (const [index, x] of [0.25, 0.4, 0.55].entries()) {
    tracked = updateTrackedLines(tracked, sign(x), 2000 + index * 1000);
    assert.equal(tracked.length, 1);
    assert.equal(tracked[0].id, id);
  }
});

// MARK: - E. 文字認識の揺れ・訳の遅れ

test('静止中の1回だけの読み違いでは、原文を差し替えない（多数決を保つ）', () => {
  const rand = random(11);
  let tracked = [];
  for (let frame = 0; frame < 4; frame += 1)
    tracked = updateTrackedLines(tracked, menuFrame(rand, { drop: 0 }), 1000 + frame * 1000);
  const misread = menuFrame(rand, { drop: 0 }).map((line) =>
    line.text === 'Cappuccino' ? { ...line, text: 'Cappuccin0' } : line,
  );
  tracked = updateTrackedLines(tracked, misread, 6000);
  assert.ok(tracked.some((line) => line.text === 'Cappuccino'));
  assert.ok(!tracked.some((line) => line.text === 'Cappuccin0'));
});

test('訳が届くまでの行は札にしない（訳が届いた時に出る）', () => {
  const box = (y) => ({ x: 0.1, y, width: 0.2, height: 0.012 });
  const rows = [
    { id: 'a', box: box(0.3), translated: null },
    { id: 'b', box: box(0.4), translated: 'エスプレッソ' },
  ];
  const layout = {
    frameSize: IMAGE,
    viewSize: VIEW,
    occludedBottom: 0,
    minHits: 2,
  };
  assert.deepEqual(
    placeOverlayLabels(rows, [], layout).map((label) => label.id),
    ['b'],
  );
  rows[0] = { ...rows[0], translated: 'アメリカーノ' };
  assert.deepEqual(
    placeOverlayLabels(rows, [], layout)
      .map((label) => label.id)
      .sort(),
    ['a', 'b'],
  );
});

const overlapping = [
  {
    id: 'center',
    box: { x: 0.1, y: 0.3, width: 0.2, height: 0.012 },
    translated: '中央寄りの訳',
  },
  {
    id: 'side',
    box: { x: 0.12, y: 0.302, width: 0.2, height: 0.012 },
    translated: '端の訳',
  },
];
const overlapLayout = {
  frameSize: IMAGE,
  viewSize: VIEW,
  occludedBottom: 0,
  minHits: 2,
};

test('重なる2つの札：前のフレームで省いた方は後に回す（優先度の順が揺れで入れ替わっても交代しない）', () => {
  // 1フレーム目：center が先（選んだ順）→ center を置き side を省く
  assert.deepEqual(
    placeOverlayLabels(overlapping, [], overlapLayout).map((label) => label.id),
    ['center'],
  );
  // 2フレーム目：位置の揺れで選んだ順が side→center になっても、前に省いた side は後に回すので center のまま
  const flipped = [overlapping[1], overlapping[0]];
  assert.deepEqual(
    placeOverlayLabels(flipped, [], {
      ...overlapLayout,
      skippedIds: new Set(['side']),
    }).map((label) => label.id),
    ['center'],
  );
});

test('重なる2つの札：端の札の訳が先に届いても、中央寄りの札の訳が届いたら中央寄りが出る（届いた順で固定しない）', () => {
  // 1フレーム目：center の訳がまだ → side だけ置かれる（center は訳が無いので「省いた」に入らない）
  const first = [{ ...overlapping[0], translated: null }, overlapping[1]];
  const placedFirst = placeOverlayLabels(first, [], overlapLayout).map((label) => label.id);
  assert.deepEqual(placedFirst, ['side']);
  const skipped = new Set(
    first.filter((row) => row.translated != null && !placedFirst.includes(row.id)).map((row) => row.id),
  );
  assert.equal(skipped.size, 0);
  // 2フレーム目：center の訳が届いた → 選んだ順どおり center
  assert.deepEqual(
    placeOverlayLabels(overlapping, [], {
      ...overlapLayout,
      skippedIds: skipped,
    }).map((label) => label.id),
    ['center'],
  );
});

// MARK: - 独立レビューで見つかった経路（読み違い・まとめ読み・付け替え）

const textLine = (text, x, y, height = TEXT_HEIGHT) => ({
  text,
  confidence: 1,
  box: { x, y, width: text.length * CHAR_WIDTH, height },
});
const usdEntries = (tracked) =>
  buildTranslationPriceEntries(tracked, usd, {
    maxEntries: 20,
    maxTextLength: 80,
    minHits: 2,
    visibleRegion: { x: 0, y: 0, width: 1, height: 1 },
    imageSize: IMAGE,
  });
/** 値札の周りの文字（静止。カメラの動きを確かめられる） */
const AROUND = [
  textLine('Fresh Bakery', 0.1, 0.1),
  textLine('Daily Specials', 0.1, 0.15),
  textLine('Open 7 days', 0.1, 0.8),
];

test('まとめ読み：値札の価格が替わった読み（"Bread" "$2.49" → "Bread $2.99"）を吸収して古い価格を出し続けない', () => {
  let tracked = [];
  for (let frame = 0; frame < 3; frame += 1) {
    tracked = updateTrackedLines(
      tracked,
      [...AROUND, textLine('Bread', 0.2, 0.5), textLine('$2.49', 0.3, 0.5)],
      1000 + frame * 1000,
    );
  }
  for (let frame = 3; frame < 9; frame += 1) {
    tracked = updateTrackedLines(tracked, [...AROUND, textLine('Bread $2.99', 0.2, 0.5)], 1000 + frame * 1000);
  }
  const amounts = usdEntries(tracked).flatMap((entry) => entry.amounts);
  assert.ok(!amounts.includes(2.49), `古い価格 ${amounts.join(',')}`);
  assert.ok(amounts.includes(2.99), `新しい価格 ${amounts.join(',')}`);
});

test('まとめ読み：1回だけ分けて読み、以後ずっと1行にまとめて読む値札も、価格が出る（吸収した行にも読みを数える）', () => {
  let tracked = updateTrackedLines([], [...AROUND, textLine('Bread', 0.2, 0.5), textLine('$2.49', 0.3, 0.5)], 1000);
  for (let frame = 1; frame < 4; frame += 1) {
    tracked = updateTrackedLines(tracked, [...AROUND, textLine('Bread $2.49', 0.2, 0.5)], 1000 + frame * 1000);
  }
  const amounts = usdEntries(tracked).flatMap((entry) => entry.amounts);
  assert.ok(amounts.includes(2.49), `価格 ${amounts.join(',')}`);
});

test('1回の読み違いで隣の商品と同じ値段になっても、その商品の名前で別の商品の価格を出さない（翻訳ページ・メインカメラ）', () => {
  // Mocha $5.60 を1フレームだけ $5.00 と読み、同じフレームで Flat White の $5.00 が読めない
  const rows = [
    ['Americano', '$4.00'],
    ['Cafe Latte', '$5.40'],
    ['Mocha', '$5.60'],
    ['Flat White', '$5.00'],
    ['Cold Brew', '$4.80'],
  ];
  // 行の間隔：文字の高さの約3.3倍（普通のメニュー）と約1.7倍（行の詰まったメニュー）
  for (const pitch of [0.04, 0.02]) {
    const frame = (override) =>
      rows.flatMap(([name, price], index) => {
        const y = 0.2 + index * pitch;
        const shown = override[name] === undefined ? price : override[name];
        return [textLine(name, 0.06, y), ...(shown == null ? [] : [textLine(shown, 0.55, y)])];
      });
    const sequence = [{}, {}, {}, { Mocha: '$5.00', 'Flat White': null }, {}, {}];
    let tracked = [];
    sequence.forEach((override, index) => {
      tracked = updateTrackedLines(tracked, frame(override), 1000 + index * 1000);
      for (const entry of usdEntries(tracked)) {
        if (entry.label == null) continue;
        const price = Number(rows.find(([name]) => name === entry.label)[1].slice(1));
        assert.ok(
          entry.amounts.every((amount) => amount === price),
          `行の間隔${pitch} ${index + 1}フレーム目 ${entry.label}=${entry.amounts}`,
        );
      }
      const smart = buildSmartCameraEntries(tracked, (text) => extractConfidentPriceCandidates(text, 'USD'), {
        maxEntries: 6,
        maxTextLength: 40,
        minHits: 2,
        visibleRegion: { x: 0, y: 0, width: 1, height: 1 },
        imageSize: IMAGE,
      });
      for (const entry of smart) {
        if (entry.kind !== 'price' || entry.label == null) continue;
        const price = Number(rows.find(([name]) => name === entry.label)[1].slice(1));
        assert.equal(entry.amount, price, `メインカメラ 行の間隔${pitch} ${index + 1}フレーム目 ${entry.label}`);
      }
    });
  }
});

test('読み違いの多い静止した注意書き（文字だけ・行の3割を毎回1文字読み違える）でも、原文の差し替えが増えない（多数決を保つ）', () => {
  const notice = [
    'Please wait here',
    'to be seated',
    'No outside food',
    'or drinks allowed',
    'Thank you for',
    'your cooperation',
  ];
  let replacements = 0;
  let garbledShown = 0;
  let shownTotal = 0;
  for (const seed of SEEDS) {
    const rand = random(seed);
    let tracked = [];
    let previousText = new Map();
    for (let frame = 0; frame < 40; frame += 1) {
      const lines = notice.map((text, index) =>
        textLine(rand() < 0.3 ? garble(rand, text) : text, 0.2, 0.3 + index * 0.05, 0.02),
      );
      tracked = updateTrackedLines(tracked, lines, 1000 + frame * 1000);
      for (const line of tracked) {
        if (previousText.has(line.id) && previousText.get(line.id) !== line.text) replacements += 1;
        if (line.hits >= 2) {
          shownTotal += 1;
          if (!notice.includes(line.text)) garbledShown += 1;
        }
      }
      previousText = new Map(tracked.map((line) => [line.id, line.text]));
    }
  }
  assert.ok(replacements <= REPLACEMENT_LIMIT, `原文の差し替え ${replacements} 回`);
  assert.ok(garbledShown / shownTotal <= 0.05, `崩れた原文の割合 ${(garbledShown / shownTotal).toFixed(3)}`);
});

// MARK: - F. レイアウト（中央優先・左右の釣り合いを保つ）

test('静止中も、商品名と説明の両方が訳され（各5件以上）、札は14件以内（Build 7 の左右の改善を保つ）', () => {
  const names = new Set(ITEMS.map(([name]) => name));
  const descriptions = new Set(ITEMS.map(([, description]) => description));
  for (const seed of SEEDS) {
    for (const result of runCamera(still(20), seed).slice(3)) {
      const texts = result.labels.map((label) => label.text);
      assert.ok(texts.length <= MAX_LABELS);
      assert.ok(texts.filter((text) => names.has(text)).length >= 5, texts.join(' / '));
      assert.ok(texts.filter((text) => descriptions.has(text)).length >= 5, texts.join(' / '));
    }
  }
});
