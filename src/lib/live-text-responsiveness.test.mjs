/**
 * ライブ翻訳の応答の速さ（2026-11-25・Build 8 の実機確認から）。
 *
 * 実機（Build 8）で残った体感の問題:
 * ① カメラを起動してから最初の日本語が出るまで少し待つ
 * ② 読みにくい所でカメラを止めていると、待っても訳がなかなか出ない（少し動かすと出始める）
 * ③ 下部の価格は出ているのに、商品名が「価格」・英語から日本語になるまで遅れる
 *
 * 模擬（このファイル。翻訳は1要求8件・同時に1要求・1要求の時間を仮に0.3／0.8秒とした）で確かめた原因:
 * - 翻訳を送るのは、行が表示の条件（2フレームで読めた）を満たしてからだった → 最初の札は「2フレーム目＋翻訳1要求
 *   （初回は言語ペアの導入状態の確認も）」の後
 * - 帯の商品名は、訳を重ねる行（最大14件）の後ろに並んでいたため、2〜3回目の要求まで英語のままだった
 * - 読める行が少ない所では「同じ場面を読み続けているか」を確かめられず（3行以上が要る）、読み落としが2回続いた行は消えて、
 *   次に読めた時も1回目として数え直していた → 2回続けて読めるまで一度も出なかった
 *   （まだ表示していない行だけを覚えるようにした。表示した行の残し方・消し方は Build 8 と同じ）
 * 実機での各工程の時間（OCR・翻訳1要求・描画）は未測定。ここでの数値は模擬の比較で、実機の速さそのものではない。
 *
 * Build 8 との比較:
 * - 翻訳の順・時期は、Build 8 の並べ方（訳を重ねる行 → 価格の商品名・説明。表示の条件を満たした行だけ）をこのファイルに
 *   そのまま写して比べる
 * - 追跡は、`dormant`（覚えているだけの行）を毎フレーム取り除くと Build 8 と同じ動きになる（他の変更は覚えている行の
 *   扱いだけ）ので、それを Build 8 として比べる
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
  isStableLine,
  orderLiveTranslationTexts,
  placeOverlayLabels,
  planTranslationRequests,
  resolveSourceLanguageForText,
  selectOverlayLines,
  selectPrefetchLines,
  unobstructedRegionInImage,
  updateTrackedLines,
  visibleRegionInImage,
} = core;

const usd = (text) => extractTranslationPrices(text, 'USD', (value) => extractConfidentPriceCandidates(value, 'USD'));

const IMAGE = { width: 1080, height: 1920 };
const VIEW = { width: 370, height: 493 };
const REGION = visibleRegionInImage(IMAGE, VIEW);
const CHAR_WIDTH = 0.0105;
const TEXT_HEIGHT = 0.012;
/** 翻訳の1要求の件数（`use-live-text-translation.ts`の`MAX_TEXTS_PER_REQUEST`） */
const TEXTS_PER_REQUEST = 8;
/** 先に訳しておく件数（`LiveTranslationCamera.tsx`の`MAX_PREFETCH_TEXTS`） */
const PREFETCH = 8;
const SEEDS = [101, 202, 303, 404, 505];

/** 3列のメニュー（商品名｜説明｜価格）。同じ値段の品目を含む */
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
const PRICE_OF_TEXT = new Map(
  ITEMS.flatMap(([name, description, price]) => [
    [name, Number(price.slice(1))],
    [description, Number(price.slice(1))],
  ]),
);
const NAMES = new Set(ITEMS.map(([name]) => name));

function random(seed) {
  let state = seed;
  return () => {
    state = (state * 16807) % 2147483647;
    return state / 2147483647;
  };
}

/**
 * メニューを写した1フレーム。`dropOf(text)`で行ごとの読み落としの確率を変えられる（読みにくい所）。
 * `pitch`：行の間隔（`null`は枠に16行が収まる間隔）
 */
function menuFrame(rand, { items = ITEMS, dy = 0, drop = 0.1, dropOf = null, jitter = 0.002, pitch = null } = {}) {
  const top = REGION.y + 0.03;
  const rowPitch = pitch ?? (REGION.height - 0.06) / 16;
  const noise = () => (rand() * 2 - 1) * jitter;
  const lines = [];
  items.forEach((row, index) => {
    const y = top + index * rowPitch + dy;
    const add = (text, x) => {
      if (rand() < (dropOf ? dropOf(text) : drop)) return;
      lines.push({
        text,
        confidence: 1,
        box: { x: x + noise(), y: y + noise(), width: text.length * CHAR_WIDTH, height: TEXT_HEIGHT },
      });
    };
    const [name, description, price] = row;
    add(name, 0.06);
    if (description != null) add(description, 0.33);
    if (price != null) add(price, 0.85);
  });
  for (let i = lines.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [lines[i], lines[j]] = [lines[j], lines[i]];
  }
  return lines;
}

const fakeTranslation = (text) => `訳:${text}`;
const source = (text) => resolveSourceLanguageForText(text, 'en', 'ja');

/** Build 8 の翻訳の並べ方（`LiveTranslationCamera.tsx`の Build 8 時点のまま）：訳を重ねる行 → 価格の商品名・説明 */
function build8Texts({ overlay, prices }) {
  const texts = overlay.map((entry) => entry.text);
  const seen = new Set(texts);
  for (const entry of prices) {
    for (const text of [entry.label, entry.description]) {
      if (text == null || seen.has(text)) continue;
      seen.add(text);
      texts.push(text);
    }
  }
  return texts;
}

/** 今の翻訳の並べ方（`LiveTranslationCamera.tsx`と同じ組み立て） */
function currentTexts({ overlay, prices, tracked }) {
  const prefetch = selectPrefetchLines(tracked, {
    maxEntries: PREFETCH,
    maxTextLength: 80,
    minHits: 2,
    visibleRegion: unobstructedRegionInImage(IMAGE, VIEW, 0),
    imageSize: IMAGE,
  });
  return orderLiveTranslationTexts({
    overlayTexts: overlay.map((entry) => entry.text),
    priceEntries: prices,
    prefetchTexts: prefetch.map((entry) => entry.text),
    stripRows: 3,
  });
}

const BUILD8 = { texts: build8Texts, prewarm: false, build8Tracker: true };
const CURRENT = { texts: currentTexts, prewarm: true, build8Tracker: false };

/**
 * 翻訳ページのカメラと同じ流れを、時間付きで回す。
 * - フレームは 0.9〜1.2 秒ごと（実機の 0.8 秒間隔＋認識の時間）
 * - 翻訳は1要求`TEXTS_PER_REQUEST`件・同時に1要求・1要求`latency`ms。言語ペアの導入状態の確認（初回だけ）は`availabilityMs`
 *   （`prewarm`ならカメラの準備中に済んでいる）
 * - 描画はフレームごとと、翻訳が届くたび。前回の選択・重なって省いた札は画面と同じく引き継ぐ
 * - `build8Tracker`：覚えているだけの行を毎フレーム取り除く（Build 8 の追跡と同じ）
 */
function simulate(frames, seed, variant, { latency = 400, availabilityMs = 150, cache = new Map() } = {}) {
  const rand = random(seed);
  const requested = [];
  const renders = [];
  let inFlight = null;
  let availabilityDone = variant.prewarm;
  let tracked = [];
  let previousSelection = new Set();
  let skipped = new Set();
  let carried = new Set();
  let lastTracked = null;
  let now = 0;
  let frameIndex = 0;

  const render = (at, isFrame) => {
    const prices = buildTranslationPriceEntries(tracked, usd, {
      maxEntries: 6,
      maxTextLength: 80,
      minHits: 2,
      visibleRegion: unobstructedRegionInImage(IMAGE, VIEW, 0),
      imageSize: IMAGE,
    });
    const strip = prices
      .flatMap((entry) => entry.amounts.map((amount) => ({ id: entry.id, label: entry.label, amount })))
      .slice(0, 3);
    const occluded = strip.length > 0 ? 12 + strip.length * 27 : 0;
    const overlay = selectOverlayLines(tracked, {
      maxEntries: 14,
      maxTextLength: 80,
      minHits: 2,
      visibleRegion: unobstructedRegionInImage(IMAGE, VIEW, occluded),
      imageSize: IMAGE,
      previousIds: previousSelection,
    });
    previousSelection = new Set(overlay.map((entry) => entry.id));
    const texts = variant.texts({ overlay, prices, tracked });
    const inputs = overlay.map((entry) => ({ id: entry.id, box: entry.box, translated: cache.get(entry.text) ?? null }));
    const newFrame = lastTracked !== tracked;
    const carry = newFrame ? skipped : carried;
    const labels = placeOverlayLabels(inputs, tracked, {
      frameSize: IMAGE,
      viewSize: VIEW,
      occludedBottom: occluded,
      minHits: 2,
      skippedIds: carry,
    });
    const placed = new Set(labels.map((label) => label.id));
    skipped = new Set(inputs.filter((input) => input.translated != null && !placed.has(input.id)).map((input) => input.id));
    carried = carry;
    lastTracked = tracked;
    const lineOf = new Map(tracked.map((line) => [line.id, line]));
    renders.push({
      at,
      isFrame,
      frameIndex,
      labels: labels.map((label) => ({ ...label, original: lineOf.get(label.id).text })),
      strip: strip.map((row) => ({ ...row, translated: row.label != null && cache.has(row.label) })),
      descriptions: prices.map((entry) => entry.description).filter((text) => text != null),
    });
    return texts;
  };

  const pump = (at, texts) => {
    if (inFlight) return;
    const plan = planTranslationRequests(
      texts.map((text) => ({ text, sourceLanguage: source(text) })),
      (_source, text) => cache.has(text),
      () => false,
      TEXTS_PER_REQUEST,
    )[0];
    if (!plan) return;
    const wait = availabilityDone ? 0 : availabilityMs;
    availabilityDone = true;
    inFlight = { texts: plan.texts, doneAt: at + wait + latency };
    requested.push(...plan.texts);
  };

  for (const options of frames) {
    const frameAt = now + 900 + Math.floor(rand() * 300);
    while (inFlight && inFlight.doneAt <= frameAt) {
      const done = inFlight;
      inFlight = null;
      for (const text of done.texts) cache.set(text, fakeTranslation(text));
      pump(done.doneAt, render(done.doneAt, false));
    }
    now = frameAt;
    frameIndex += 1;
    const next = updateTrackedLines(tracked, menuFrame(rand, options), now);
    tracked = variant.build8Tracker ? next.filter((line) => line.dormant !== true) : next;
    pump(now, render(now, true));
  }
  return { renders, requested, cache };
}

const still = (count, options = {}) => Array.from({ length: count }, () => options);
const firstFrameAt = (result) => result.renders.find((render) => render.isFrame).at;
const frameAt = (result, index) => result.renders.find((render) => render.isFrame && render.frameIndex === index).at;
const firstTime = (result, predicate) => result.renders.find(predicate)?.at ?? Infinity;
const average = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

/** 帯の各行：価格が初めて出てから、商品名が日本語になるまで(ms)。名前の付かない行は数えない */
function stripNameDelays(result) {
  const rows = new Map();
  for (const render of result.renders) {
    for (const row of render.strip) {
      const key = `${row.id}|${row.amount}`;
      if (!rows.has(key)) rows.set(key, { priceAt: render.at, translatedAt: null });
      const entry = rows.get(key);
      if (row.translated && entry.translatedAt == null) entry.translatedAt = render.at;
    }
  }
  return [...rows.values()].filter((row) => row.translatedAt != null).map((row) => row.translatedAt - row.priceAt);
}

/** 帯に出た「名前と価格」のうち、その品目の価格でないもの */
function mispairs(result) {
  return result.renders.flatMap((render) =>
    render.strip.filter((row) => row.label != null && PRICE_OF_TEXT.has(row.label) && PRICE_OF_TEXT.get(row.label) !== row.amount),
  );
}

/** 前のフレームから札が替わった回数（フレームごとの描画で比べる。最初の`skip`フレームは数えない） */
function labelChanges(result, skip = 2) {
  const frames = result.renders.filter((render) => render.isFrame);
  let changes = 0;
  for (let i = skip + 1; i < frames.length; i += 1) {
    const before = new Set(frames[i - 1].labels.map((label) => label.original));
    const after = new Set(frames[i].labels.map((label) => label.original));
    changes += [...after].filter((text) => !before.has(text)).length + [...before].filter((text) => !after.has(text)).length;
  }
  return changes;
}

function stripChanges(result, skip = 2) {
  const frames = result.renders.filter((render) => render.isFrame);
  const key = (render) => render.strip.map((row) => `${row.label}|${row.amount}`).join(' / ');
  let changes = 0;
  for (let i = skip + 1; i < frames.length; i += 1) if (key(frames[i]) !== key(frames[i - 1])) changes += 1;
  return changes;
}

// MARK: - A. 起動してから最初の訳が出るまで

test('起動直後：最初の札は2フレーム目に出る（Build 8 の並べ方では2フレーム目＋言語ペアの確認＋翻訳1要求の後）', () => {
  for (const latency of [300, 800]) {
    const before = [];
    const after = [];
    for (const seed of SEEDS) {
      const old = simulate(still(6), seed, BUILD8, { latency });
      const now = simulate(still(6), seed, CURRENT, { latency });
      before.push(firstTime(old, (render) => render.labels.length > 0) - firstFrameAt(old));
      after.push(firstTime(now, (render) => render.labels.length > 0) - firstFrameAt(now));
      // 2フレーム目の描画の時点で札が出ている（表示の条件＝2フレーム目は変えていない）
      assert.equal(firstTime(now, (render) => render.labels.length > 0), frameAt(now, 2), `seed ${seed} ${latency}ms`);
      // 1フレーム目には出さない（1回だけの読みで札を出さない）
      assert.ok(now.renders.filter((render) => render.frameIndex === 1).every((render) => render.labels.length === 0));
    }
    // 修正前（模擬）：翻訳0.3秒で平均約1.47秒・0.8秒で約1.97秒 → 修正後は2フレーム目（約1.0秒）
    assert.ok(average(after) + latency * 0.9 <= average(before), `${latency}ms: ${average(before)} → ${average(after)}`);
  }
});

test('起動直後：2フレーム目に中央寄りの札が5件以上そろう', () => {
  for (const seed of SEEDS) {
    const result = simulate(still(6), seed, CURRENT, { latency: 800 });
    const second = result.renders.filter((render) => render.frameIndex === 2 && render.isFrame)[0];
    assert.ok(second.labels.length >= 5, `seed ${seed}: ${second.labels.length}件`);
  }
});

test('翻訳のキャッシュ：同じメニューを開き直した時は翻訳を送らずに2フレーム目に出る・同じ文字を2回送らない', () => {
  for (const seed of SEEDS) {
    const first = simulate(still(10), seed, CURRENT, { latency: 400 });
    assert.equal(new Set(first.requested).size, first.requested.length, '同じ文字を2回送らない');
    const again = simulate(still(6), seed, CURRENT, { latency: 400, cache: first.cache });
    assert.equal(again.requested.length, 0);
    assert.equal(firstTime(again, (render) => render.labels.length > 0), frameAt(again, 2));
  }
});

test('翻訳が遅い・フレームより後に届く時も、要求は1つずつで積み上がらず、札は原文の訳だけ（別の行の訳を付けない）', () => {
  for (const seed of SEEDS) {
    // 翻訳1要求がフレームの間隔より長い（2.5秒）。届いた時には次のフレームに進んでいる
    const result = simulate([...still(4), ...Array.from({ length: 6 }, (_, i) => ({ dy: 0.02 * (i + 1) })), ...still(4)], seed, CURRENT, {
      latency: 2500,
    });
    assert.equal(new Set(result.requested).size, result.requested.length);
    for (const render of result.renders) {
      for (const label of render.labels) assert.equal(label.text, fakeTranslation(label.original));
    }
  }
});

// MARK: - B. 読みにくい所で止めた時

/** 読める行が少ない静止した場面（各行を毎回`drop`の確率で読み落とす） */
const SPARSE = [['Espresso'], ['Cappuccino'], ['Earl Grey'], ['Orange Juice']];
const HARD_SEEDS = [11, 22, 33, 44, 55, 66, 77, 88, 99, 111];

function sparseStats(variant, drop) {
  const firstShown = [];
  let never = 0;
  let shownFrames = 0;
  let total = 0;
  for (const seed of HARD_SEEDS) {
    const result = simulate(still(30, { items: SPARSE, drop }), seed, variant, { latency: 100, availabilityMs: 0 });
    const frames = result.renders.filter((render) => render.isFrame);
    for (const [name] of SPARSE) {
      total += 1;
      const index = frames.findIndex((render) => render.labels.some((label) => label.original === name));
      if (index < 0) never += 1;
      else firstShown.push(index + 1);
      shownFrames += frames.filter((render) => render.labels.some((label) => label.original === name)).length;
    }
  }
  return { median: median(firstShown), max: Math.max(...firstShown), never, shownRatio: shownFrames / (total * 30) };
}

test('読みにくい所で止めた時（各行を3〜5割しか読めない）：訳が出始めるのが同じか早く、一度も出ない行が無く、出ている時間が長い', () => {
  let medianGain = 0;
  for (const drop of [0.5, 0.6, 0.7]) {
    const before = sparseStats(BUILD8, drop);
    const after = sparseStats(CURRENT, drop);
    // 修正前（模擬）：初めて出るまで中央値5・7・8フレーム／出ている割合50・36・22% → 修正後：5・6・6フレーム／53・41・28%
    assert.ok(after.median <= before.median, `${drop}: 中央値 ${before.median} → ${after.median}`);
    assert.ok(after.never <= before.never && after.never === 0, `${drop}: 一度も出ない ${before.never} → ${after.never}`);
    assert.ok(after.shownRatio >= before.shownRatio + 0.02, `${drop}: 出ている割合 ${before.shownRatio} → ${after.shownRatio}`);
    medianGain += before.median - after.median;
  }
  assert.ok(medianGain >= 2, `中央値の短縮 計${medianGain}フレーム`);
});

test('1回だけ読めた行を覚えている間は、札・価格・札の右端の計算に使わない・同じ所でまた読めたら2回目として出る', () => {
  const box = (y, x = 0.1) => ({ x, y, width: 0.2, height: 0.02 });
  const read = (y) => [
    { text: 'Mocha', confidence: 1, box: box(y) },
    { text: '$5.60', confidence: 1, box: box(y, 0.6) },
  ];
  // 1回だけ読めて、2回読めなかった（staleMs を過ぎた）→ 覚えているだけ（Build 8 ではここで消えていた）
  let tracked = updateTrackedLines([], read(0.3), 1000);
  tracked = updateTrackedLines(tracked, [], 2100);
  tracked = updateTrackedLines(tracked, [], 3200);
  assert.ok(tracked.length === 2 && tracked.every((line) => line.dormant === true && !isStableLine(line)));
  const region = { x: 0, y: 0, width: 1, height: 1 };
  assert.deepEqual(selectOverlayLines(tracked, { maxEntries: 14, maxTextLength: 80, minHits: 2, visibleRegion: region }), []);
  assert.deepEqual(buildTranslationPriceEntries(tracked, usd, { maxEntries: 6, maxTextLength: 80, minHits: 2, visibleRegion: region }), []);
  assert.deepEqual(
    buildSmartCameraEntries(tracked, (text) => extractConfidentPriceCandidates(text, 'USD'), {
      maxEntries: 3,
      maxTextLength: 40,
      minHits: 2,
      visibleRegion: region,
    }),
    [],
  );
  const placed = placeOverlayLabels([{ id: 'x', box: box(0.3, 0.05), translated: '長い長い訳の文字' }], tracked, {
    frameSize: { width: 1000, height: 1000 },
    viewSize: { width: 300, height: 300 },
    occludedBottom: 0,
    minHits: 1,
  });
  assert.equal(placed[0].maxWidth, 300 - 4 - placed[0].left, '覚えているだけの行で札の右端を縮めない');
  // 同じ所でまた読めたら、元の行（同じ識別子）として2回目に数え、すぐ出る（価格は組になる）
  const ids = new Set(tracked.map((line) => line.id));
  const back = updateTrackedLines(tracked, read(0.301), 4300);
  assert.ok(back.every((line) => ids.has(line.id) && line.dormant !== true && isStableLine(line)));
  assert.deepEqual(
    buildTranslationPriceEntries(back, usd, { maxEntries: 6, maxTextLength: 80, minHits: 2, visibleRegion: region }).map(
      (entry) => [entry.label, entry.amounts],
    ),
    [['Mocha', [5.6]]],
  );
  // 離れた所（行の高さより遠い）で同じ文字が読めても戻さない（新しい行として2フレーム目から）
  const far = updateTrackedLines(tracked, read(0.33), 4300).filter((line) => line.dormant !== true);
  assert.ok(far.length === 2 && far.every((line) => !ids.has(line.id) && !isStableLine(line)));
  // 4回より多く続けて読めなければ忘れる
  let forgotten = tracked;
  for (let frame = 1; frame <= 3; frame += 1) forgotten = updateTrackedLines(forgotten, [], 3200 + frame * 1100);
  assert.equal(forgotten.length, 0);
});

test('表示したことのある行は覚えない（読めなくなった時の残し方・消し方は Build 8 と同じ）', () => {
  const line = { text: 'Bibimbap', confidence: 1, box: { x: 0.1, y: 0.1, width: 0.2, height: 0.02 } };
  let tracked = updateTrackedLines([], [line], 1000);
  tracked = updateTrackedLines(tracked, [line], 1900);
  assert.ok(isStableLine(tracked[0]));
  assert.equal(updateTrackedLines(updateTrackedLines(tracked, [], 2900), [], 3500).length, 0);
});

test('止めた時の札・帯の落ち着きは Build 8 と同じ（翻訳の遅れも入れて、同じシードで比べる）', () => {
  for (const options of [{}, { drop: 0.3 }]) {
    let labelsBefore = 0;
    let labelsAfter = 0;
    let stripBefore = 0;
    let stripAfter = 0;
    for (const seed of SEEDS) {
      // 翻訳が出そろうまで（先に訳しておく分だけ早くそろう）を除くため、5フレーム目から数える
      const old = simulate(still(40, options), seed, BUILD8, { latency: 400 });
      const now = simulate(still(40, options), seed, CURRENT, { latency: 400 });
      labelsBefore += labelChanges(old, 5);
      labelsAfter += labelChanges(now, 5);
      stripBefore += stripChanges(old, 5);
      stripAfter += stripChanges(now, 5);
    }
    assert.ok(labelsAfter <= labelsBefore, `${JSON.stringify(options)} 札 ${labelsBefore} → ${labelsAfter}`);
    assert.ok(stripAfter <= stripBefore, `${JSON.stringify(options)} 帯 ${stripBefore} → ${stripAfter}`);
  }
});

// MARK: - C. 下部の価格の商品名

test('下部の帯：価格が出てから商品名が日本語になるまでが短くなる（翻訳0.3秒・0.8秒）', () => {
  for (const latency of [300, 800]) {
    const before = [];
    const after = [];
    for (const seed of SEEDS) {
      before.push(...stripNameDelays(simulate(still(12), seed, BUILD8, { latency })));
      after.push(...stripNameDelays(simulate(still(12), seed, CURRENT, { latency })));
    }
    // 修正前（模擬）：平均 約0.48秒（0.3秒）・約1.15秒（0.8秒） → 修正後：約0.12秒・約0.38秒
    assert.ok(average(after) < average(before) * 0.6, `${latency}ms: ${average(before)} → ${average(after)}`);
  }
});

test('下部の帯：翻訳の順を替えても、商品名と価格の組は変わらない（同じ値段の商品が複数・読み落とし・手ぶれ）', () => {
  for (const options of [{}, { drop: 0.3 }, { dropOf: (text) => (NAMES.has(text) ? 0.4 : 0.1) }]) {
    for (const seed of SEEDS) {
      const frames = Array.from({ length: 25 }, (_, index) => ({ ...options, dy: 0.01 * Math.sin(index) }));
      const old = simulate(frames, seed, BUILD8, { latency: 800 });
      const now = simulate(frames, seed, CURRENT, { latency: 800 });
      // 誤対応は Build 8 と同じか少ない。手ぶれ＋読み落とし3割の1つのシードでは Build 8 にも同じ2フレームの誤対応がある
      // （既知の残るリスク。今回の変更で増えも減りもしない）。読み落とし無しでは0件
      assert.ok(mispairs(now).length <= mispairs(old).length, `${seed} ${JSON.stringify(mispairs(now))}`);
      if (!('drop' in options)) assert.deepEqual(mispairs(now), [], `${seed}`);
      // 帯の名前と価格は、翻訳の順に関係なく Build 8 と同じ組（翻訳は名前の表示言語を変えるだけ）
      const pairs = (result) =>
        result.renders.filter((render) => render.isFrame).map((render) => render.strip.map((row) => `${row.label}|${row.amount}`).join(','));
      if (!('drop' in options) && !('dropOf' in options)) assert.deepEqual(pairs(now), pairs(old));
    }
  }
});

test('下部の帯：商品名の訳が届くまでは、その商品の原文の名前のまま（別の商品の訳を付けない）', () => {
  for (const seed of SEEDS) {
    const result = simulate(still(10), seed, CURRENT, { latency: 3000 });
    for (const render of result.renders) {
      for (const row of render.strip) {
        if (row.label == null) continue;
        assert.equal(PRICE_OF_TEXT.get(row.label), row.amount);
      }
    }
  }
});

test('密なメニュー（行の間隔が文字の高さの1.3倍）で同じ値段の行が隣り合っても、覚えていた行を隣の行に付け替えない', () => {
  for (const seed of SEEDS) {
    const frames = still(30, { drop: 0.45, pitch: TEXT_HEIGHT * 1.3 });
    const now = mispairs(simulate(frames, seed, CURRENT, { latency: 200 }));
    const old = mispairs(simulate(frames, seed, BUILD8, { latency: 200 }));
    assert.ok(now.length <= old.length, `seed ${seed}: ${old.length} → ${now.length} ${JSON.stringify(now)}`);
  }
});

// MARK: - カメラを動かした時・中央と左右上下・重なり・余分な翻訳

test('別のメニューへ向けた時：新しい札が出るのは Build 8 と同じか早く、古いメニューの札が残るのは Build 8 より長くない', () => {
  const other = ITEMS.map(([name, description], index) => [`Bravo ${name}`, `Bravo ${description}`, `$${(9 + index * 0.1).toFixed(2)}`]);
  for (const seed of SEEDS) {
    const frames = [...still(8), ...still(8, { items: other })];
    const old = simulate(frames, seed, BUILD8, { latency: 400 });
    const now = simulate(frames, seed, CURRENT, { latency: 400 });
    const firstNew = (result) =>
      firstTime(result, (render) => render.labels.some((label) => label.original.startsWith('Bravo'))) - frameAt(result, 9);
    // 模擬：Build 8 は向け直してから 1.3〜2.5 秒 → 0.9〜2.5 秒
    assert.ok(firstNew(now) <= firstNew(old), `seed ${seed}: ${firstNew(old)} → ${firstNew(now)}`);
    // 元のメニューの札が残る最後のフレームは Build 8 と同じか早い（Build 8 も向け直して2〜3フレーム目まで残る）
    const lastOld = (result) =>
      Math.max(
        0,
        ...result.renders
          .filter((render) => render.frameIndex >= 9 && render.labels.some((label) => !label.original.startsWith('Bravo')))
          .map((render) => render.frameIndex),
      );
    assert.ok(lastOld(now) <= lastOld(old), `seed ${seed}: ${lastOld(old)} → ${lastOld(now)}`);
  }
});

test('止めた後の札は Build 8 と同じ行（中央・左右・上下の選び方を変えていない）・札どうしは重ならない', () => {
  for (const seed of SEEDS) {
    const old = simulate(still(12), seed, BUILD8, { latency: 300 });
    const now = simulate(still(12), seed, CURRENT, { latency: 300 });
    const last = (result) => result.renders.filter((render) => render.isFrame).at(-1).labels.map((label) => label.original).sort();
    assert.deepEqual(last(now), last(old));
    const names = last(now).filter((text) => NAMES.has(text)).length;
    assert.ok(names >= 5 && last(now).length - names >= 5, `商品名 ${names}・説明 ${last(now).length - names}`);
    for (const render of now.renders) {
      render.labels.forEach((a, i) =>
        render.labels.slice(i + 1).forEach((b) => {
          const overlaps = a.left < b.left + b.width && a.left + a.width > b.left && a.top < b.top + b.height && a.top + a.height > b.top;
          assert.ok(!overlaps, `${a.original} / ${b.original}`);
        }),
      );
    }
  }
});

test('余分な翻訳：止めたメニューでは数件だけ・大きく振り回して毎回別の文字が映る間は先に訳さない', () => {
  // 止めたメニュー：12フレームで、結局表示しなかった文字の翻訳は数件
  for (const seed of SEEDS) {
    const result = simulate(still(12), seed, CURRENT, { latency: 400 });
    const shown = new Set(
      result.renders.flatMap((render) => [
        ...render.labels.map((label) => label.original),
        ...render.strip.map((row) => row.label).filter((text) => text != null),
        ...render.descriptions,
      ]),
    );
    const wasted = result.requested.filter((text) => !shown.has(text)).length;
    assert.ok(wasted <= 6, `seed ${seed}: ${wasted}件`);
  }
  // 毎フレーム別の文字（20フレーム）：Build 8 より増えるのは数要求分まで（先に訳す条件を絞らないと、毎フレーム8件ずつ増えた）
  const word = (n) => `Word${String.fromCharCode(65 + (n % 26))}${String.fromCharCode(65 + (Math.floor(n / 26) % 26))} item`;
  const frames = Array.from({ length: 20 }, (_, f) => ({
    dy: (f % 2) * 0.03,
    items: Array.from({ length: 16 }, (_, i) => [word(f * 97 + i * 7 + 1), null, null]),
  }));
  for (const seed of SEEDS.slice(0, 3)) {
    const now = simulate(frames, seed, CURRENT, { latency: 300 }).requested.length;
    const old = simulate(frames, seed, BUILD8, { latency: 300 }).requested.length;
    // 模擬：Build 8 42〜50件 → 56〜62件
    assert.ok(now <= old + 3 * TEXTS_PER_REQUEST, `seed ${seed}: ${old} → ${now}件`);
  }
});

// MARK: - 部品（純関数）

test('翻訳を送る順：帯の商品名 → 訳を重ねる行 → 残りの商品名・説明 → 先に訳しておく行（同じ文字は1回）', () => {
  const texts = orderLiveTranslationTexts({
    overlayTexts: ['Mocha', 'Rich and bold coffee', 'Espresso'],
    priceEntries: [
      { label: 'Espresso', description: 'Rich and bold coffee', amounts: [3.5] },
      { label: 'Latte', description: null, amounts: [4, 5] },
      { label: 'Tea', description: 'Black', amounts: [3] },
      { label: null, description: null, amounts: [2] },
    ],
    prefetchTexts: ['Cold Brew', 'Mocha'],
    stripRows: 3,
  });
  // 帯の3行 = Espresso（1行）＋ Latte（2つの価格で2行）。Tea は帯の外
  assert.deepEqual(texts, ['Espresso', 'Latte', 'Mocha', 'Rich and bold coffee', 'Tea', 'Black', 'Cold Brew']);
});

test('先に訳しておく行：今回読めた・まだ表示の条件を満たしていない行だけ、中央寄りから', () => {
  const line = (text, y, extra = {}) => ({
    id: `${text}#${y}`,
    text,
    confidence: 1,
    box: { x: 0.3, y, width: 0.3, height: 0.02 },
    hits: 1,
    firstSeenAt: 0,
    lastSeenAt: 0,
    readings: [text],
    misses: 0,
    ...extra,
  });
  const options = { maxEntries: 2, maxTextLength: 80, minHits: 2, visibleRegion: { x: 0, y: 0, width: 1, height: 1 } };
  // 読み始め（前のフレームの行が無い）：中央寄りの2件
  assert.deepEqual(
    selectPrefetchLines([line('Far', 0.05), line('Center', 0.49), line('Near', 0.4)], options).map((entry) => entry.text),
    ['Center', 'Near'],
  );
  // 表示中の行・読めなかった行・覚えているだけの行は送らない
  const mixed = [
    line('Shown', 0.5, { hits: 3, readings: ['Shown', 'Shown', 'Shown'] }),
    line('New', 0.45),
    line('Missed', 0.48, { misses: 1 }),
    line('Dormant', 0.47, { misses: 3, dormant: true }),
  ];
  assert.deepEqual(selectPrefetchLines(mixed, options).map((entry) => entry.text), ['New']);
  // 前のフレームの行が1つも読めていない（大きく振り回している）時は送らない
  assert.deepEqual(selectPrefetchLines([line('Old', 0.5, { hits: 3, misses: 1 }), line('New', 0.45)], options), []);
});
