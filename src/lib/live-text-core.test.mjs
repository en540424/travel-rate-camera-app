/**
 * live-text-core（スマートカメラ・写真翻訳・カメラ翻訳の共有ロジック）のテスト。
 *
 * 実行: npm test（node --test "src/**\/*.test.mjs"）
 * 価格抽出は本物の`extractPriceCandidates`を渡して検証する（モックで仕様をずらさないため）。
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

// extract-prices.ts の dbg() が __DEV__ を参照するため、読み込み前に定義する
globalThis.__DEV__ = false;

const { extractPriceCandidates } = await import('../utils/extract-prices.ts');
const { convert } = await import('../utils/currency.ts');
const core = await import('./live-text-core.ts');

const {
  DEFAULT_TRACKER_OPTIONS,
  LruCache,
  boxIoU,
  buildSmartCameraEntries,
  canAutoTranslate,
  detectDominantScript,
  getVisionLanguagesForSource,
  groupLinesIntoBlocks,
  isSameLanguage,
  isStableLine,
  isTranslatableText,
  joinWrappedLines,
  mapBoxToView,
  nextPairStatus,
  normalizeRecognizedText,
  planTranslationRequests,
  resolveSourceLanguageForText,
  selectOverlayLines,
  sortLinesInReadingOrder,
  stripPriceTokens,
  textSimilarity,
  updateTrackedLines,
  visibleRegionInImage,
} = core;

const line = (text, x, y, width = 0.3, height = 0.04, confidence = 1) => ({
  text,
  confidence,
  box: { x, y, width, height },
});

/** 同じ行を2フレーム見せて「安定した行」にする */
function trackTwice(lines, start = 1000) {
  const first = updateTrackedLines([], lines, start);
  return updateTrackedLines(first, lines, start + 900);
}

test('テキスト整形', async (t) => {
  await t.test('連続空白を1つにして前後を除く', () => {
    assert.equal(normalizeRecognizedText('  Garlic   Grilled\nChicken '), 'Garlic Grilled Chicken');
  });
  await t.test('価格部分を取り除いてラベルだけ残す', () => {
    assert.equal(stripPriceTokens('Garlic Grilled Chicken ₩18,000'), 'Garlic Grilled Chicken');
    assert.equal(stripPriceTokens('18,000원'), '');
    assert.equal(stripPriceTokens('$12.99'), '');
    assert.equal(stripPriceTokens('Coffee 4,500 KRW'), 'Coffee');
  });
  await t.test('翻訳対象の判定（ラテン2文字以上・CJK/ハングル/タイ1文字以上・長さ上限）', () => {
    assert.equal(isTranslatableText('Garlic Chicken', 40), true);
    assert.equal(isTranslatableText('A', 40), false);
    assert.equal(isTranslatableText('면', 40), true);
    assert.equal(isTranslatableText('ชา', 40), true);
    assert.equal(isTranslatableText('12,000', 40), false);
    assert.equal(isTranslatableText('a'.repeat(41), 40), false);
  });
  await t.test('類似度：1文字の揺れは高く、別の文字列は低い', () => {
    assert.ok(textSimilarity('garlic chicken', 'garlic chickcn') > 0.9);
    assert.ok(textSimilarity('garlic chicken', 'beef bulgogi') < 0.5);
  });
});

test('文字種と翻訳元言語', async (t) => {
  await t.test('文字種の判定', () => {
    assert.equal(detectDominantScript('김치찌개'), 'hangul');
    assert.equal(detectDominantScript('ต้มยำกุ้ง'), 'thai');
    assert.equal(detectDominantScript('牛丼'), 'han');
    assert.equal(detectDominantScript('おにぎり定食'), 'kana');
    assert.equal(detectDominantScript('Garlic Chicken'), 'latin');
    assert.equal(detectDominantScript('12,000'), 'none');
  });
  await t.test('韓国の英語メニューは英語として翻訳する（ウォン旅行でも）', () => {
    assert.equal(resolveSourceLanguageForText('Garlic Grilled Chicken', 'ko', 'ja'), 'en');
  });
  await t.test('ハングルは韓国語', () => {
    assert.equal(resolveSourceLanguageForText('김치찌개', 'ko', 'ja'), 'ko');
    assert.equal(resolveSourceLanguageForText('김치찌개', 'en', 'ja'), 'ko');
  });
  await t.test('翻訳先と同じ言語の行は翻訳しない', () => {
    assert.equal(resolveSourceLanguageForText('おにぎり', 'ko', 'ja'), null);
    assert.equal(resolveSourceLanguageForText('Coffee', 'ko', 'en'), null);
  });
  await t.test('漢字だけの行は主言語が中国語・日本語の時だけ翻訳する', () => {
    assert.equal(resolveSourceLanguageForText('牛肉麵', 'zh-Hant', 'ja'), 'zh-Hant');
    assert.equal(resolveSourceLanguageForText('牛丼', 'ja', 'en'), 'ja');
    assert.equal(resolveSourceLanguageForText('牛肉麵', 'ko', 'ja'), null);
  });
  await t.test('ラテン文字の主言語はそのまま使う（EURの既存方針＝en）', () => {
    assert.equal(resolveSourceLanguageForText('Poulet rôti', 'en', 'ja'), 'en');
    assert.equal(resolveSourceLanguageForText('Poulet rôti', 'fr', 'ja'), 'fr');
  });
  await t.test('数字だけの行は翻訳しない', () => {
    assert.equal(resolveSourceLanguageForText('18,000', 'ko', 'ja'), null);
  });
  await t.test('中国語の簡体・繁体は別言語として扱う', () => {
    assert.equal(isSameLanguage('zh-Hans', 'zh-Hant'), false);
    assert.equal(isSameLanguage('en', 'en-US'), true);
  });
  await t.test('Vision OCRの認識言語', () => {
    assert.deepEqual(getVisionLanguagesForSource('ko'), ['ko-KR', 'en-US']);
    assert.deepEqual(getVisionLanguagesForSource('en'), ['en-US']);
    assert.deepEqual(getVisionLanguagesForSource('zh-TW'), ['zh-Hant', 'en-US']);
    assert.deepEqual(getVisionLanguagesForSource('zh-Hans'), ['zh-Hans', 'en-US']);
    assert.deepEqual(getVisionLanguagesForSource('vi'), ['vi-VT', 'en-US']);
    assert.deepEqual(getVisionLanguagesForSource('xx'), ['en-US']);
  });
});

test('座標の変換（プレビューはアスペクト比を保って枠を埋める）', async (t) => {
  // 正立画像 1440x1920（3:4）を 400x500（4:5）の枠へ → 横幅基準で拡大し、上下が少し切れる
  const image = { width: 1440, height: 1920 };
  const view = { width: 400, height: 500 };
  await t.test('画像の中心は枠の中心に来る', () => {
    const rect = mapBoxToView({ x: 0.5, y: 0.5, width: 0, height: 0 }, image, view);
    assert.ok(Math.abs(rect.left - 200) < 1e-6);
    assert.ok(Math.abs(rect.top - 250) < 1e-6);
  });
  await t.test('左上の角は上方向へはみ出す（切れる）', () => {
    const rect = mapBoxToView({ x: 0, y: 0, width: 1, height: 1 }, image, view);
    assert.ok(Math.abs(rect.left) < 1e-6);
    assert.ok(rect.top < 0);
    assert.ok(Math.abs(rect.width - 400) < 1e-6);
  });
  await t.test('枠に写っている範囲', () => {
    const region = visibleRegionInImage(image, view);
    assert.ok(Math.abs(region.x) < 1e-6);
    assert.ok(Math.abs(region.width - 1) < 1e-6);
    assert.ok(region.y > 0 && region.height < 1);
  });
  await t.test('サイズ0でも例外にしない', () => {
    assert.deepEqual(mapBoxToView({ x: 0, y: 0, width: 1, height: 1 }, { width: 0, height: 0 }, view), {
      left: 0,
      top: 0,
      width: 0,
      height: 0,
    });
  });
  await t.test('IoU', () => {
    assert.equal(boxIoU({ x: 0, y: 0, width: 1, height: 1 }, { x: 2, y: 2, width: 1, height: 1 }), 0);
    assert.equal(boxIoU({ x: 0, y: 0, width: 1, height: 1 }, { x: 0, y: 0, width: 1, height: 1 }), 1);
  });
});

test('フレーム間の追跡（安定化・古い文字の除去）', async (t) => {
  await t.test('1フレームだけの行は安定扱いにしない／2フレームで安定', () => {
    const once = updateTrackedLines([], [line('Bibimbap', 0.1, 0.1)], 1000);
    assert.equal(isStableLine(once[0]), false);
    const twice = updateTrackedLines(once, [line('Bibimbap', 0.11, 0.1)], 1900);
    assert.equal(twice.length, 1);
    assert.equal(isStableLine(twice[0]), true);
    assert.equal(twice[0].id, once[0].id);
  });
  await t.test('OCRの1文字揺れは同じ行として扱い、原文を差し替えない', () => {
    const once = updateTrackedLines([], [line('Garlic Chicken', 0.1, 0.1)], 1000);
    const twice = updateTrackedLines(once, [line('Garlic Chickcn', 0.1, 0.1)], 1900);
    assert.equal(twice.length, 1);
    assert.equal(twice[0].text, 'Garlic Chicken');
    assert.equal(twice[0].hits, 2);
  });
  await t.test('見えなくなった行はstaleMsまで残り、その後消える', () => {
    const tracked = trackTwice([line('Bibimbap', 0.1, 0.1)]);
    const stillThere = updateTrackedLines(tracked, [], 1900 + 1000);
    assert.equal(stillThere.length, 1);
    const gone = updateTrackedLines(stillThere, [], 1900 + DEFAULT_TRACKER_OPTIONS.staleMs + 1);
    assert.equal(gone.length, 0);
  });
  await t.test('位置は前回位置へ寄せて滑らかに追従する', () => {
    const once = updateTrackedLines([], [line('Bibimbap', 0.1, 0.1)], 1000);
    const twice = updateTrackedLines(once, [line('Bibimbap', 0.3, 0.1)], 1900, {
      ...DEFAULT_TRACKER_OPTIONS,
      smoothing: 0.5,
    });
    assert.ok(Math.abs(twice[0].box.x - 0.2) < 1e-9);
  });
  await t.test('confidenceの低い行は捨てる', () => {
    const tracked = updateTrackedLines([], [line('noise', 0.1, 0.1, 0.3, 0.04, 0.1)], 1000);
    assert.equal(tracked.length, 0);
  });
});

test('メインカメラの項目（商品名＋価格＋円換算）', async (t) => {
  const extractKrw = (text) => extractPriceCandidates(text, 'KRW');

  await t.test('同じ行の「商品名 価格」を1項目にする', () => {
    const tracked = trackTwice([line('Garlic Grilled Chicken ₩18,000', 0.2, 0.45, 0.6)]);
    const entries = buildSmartCameraEntries(tracked, extractKrw);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].kind, 'price');
    assert.equal(entries[0].amount, 18000);
    assert.equal(entries[0].label, 'Garlic Grilled Chicken');
    // 円換算は既存のconvert（1ウォン=0.11円）でそのまま計算できる
    assert.equal(Math.round(convert(entries[0].amount, 0.11, 'TO_JPY')), 1980);
  });

  await t.test('別の行の価格は、左隣の商品名と組にする', () => {
    const tracked = trackTwice([line('Bibimbap', 0.1, 0.4, 0.3), line('₩12,000', 0.6, 0.405, 0.2)]);
    const entries = buildSmartCameraEntries(tracked, extractKrw);
    const price = entries.find((entry) => entry.kind === 'price');
    assert.equal(price.label, 'Bibimbap');
    assert.equal(price.amount, 12000);
    // ラベルに使った行を短文として重複表示しない
    assert.equal(entries.filter((entry) => entry.kind === 'text').length, 0);
  });

  await t.test('値札型（商品名の真下に価格）も組にする', () => {
    const tracked = trackTwice([line('신라면', 0.3, 0.4, 0.3, 0.05), line('1,500원', 0.32, 0.46, 0.2, 0.05)]);
    const entries = buildSmartCameraEntries(tracked, extractKrw);
    assert.equal(entries[0].kind, 'price');
    assert.equal(entries[0].label, '신라면');
    assert.equal(entries[0].amount, 1500);
  });

  await t.test('最大件数で打ち切り、中央に近い価格を優先する', () => {
    const tracked = trackTwice([
      line('₩1,000', 0.0, 0.0, 0.1),
      line('₩2,000', 0.45, 0.48, 0.1),
      line('₩3,000', 0.85, 0.9, 0.1),
      line('₩4,000', 0.4, 0.6, 0.1),
    ]);
    const entries = buildSmartCameraEntries(tracked, extractKrw, {
      maxEntries: 2,
      maxTextLength: 40,
      minHits: 2,
      visibleRegion: { x: 0, y: 0, width: 1, height: 1 },
    });
    assert.deepEqual(
      entries.map((entry) => entry.amount),
      [2000, 4000],
    );
  });

  await t.test('価格の無い短文は、価格項目が足りない分だけ出す。長文は出さない', () => {
    const tracked = trackTwice([
      line('Exit', 0.4, 0.4, 0.2),
      line('This is a very long notice text that should not be shown on the main camera', 0.1, 0.6, 0.8),
    ]);
    const entries = buildSmartCameraEntries(tracked, extractKrw);
    assert.deepEqual(
      entries.map((entry) => entry.kind === 'text' && entry.text),
      ['Exit'],
    );
  });

  await t.test('1フレームしか見えていない行は出さない', () => {
    const tracked = updateTrackedLines([], [line('₩12,000', 0.4, 0.4)], 1000);
    assert.equal(buildSmartCameraEntries(tracked, extractKrw).length, 0);
  });

  await t.test('枠の外に切れた行は出さない', () => {
    const tracked = trackTwice([line('₩12,000', 0.4, 0.01, 0.2, 0.02)]);
    const entries = buildSmartCameraEntries(tracked, extractKrw, {
      maxEntries: 3,
      maxTextLength: 40,
      minHits: 2,
      visibleRegion: { x: 0, y: 0.05, width: 1, height: 0.9 },
    });
    assert.equal(entries.length, 0);
  });
});

test('翻訳ページのカメラ：元の文字付近に出す行', () => {
  const tracked = trackTwice([
    line('비빔밥', 0.1, 0.2),
    line('12,000', 0.6, 0.2, 0.2),
    line('불고기', 0.1, 0.5),
  ]);
  const overlay = selectOverlayLines(tracked, {
    maxEntries: 8,
    maxTextLength: 80,
    minHits: 2,
    visibleRegion: { x: 0, y: 0, width: 1, height: 1 },
  });
  assert.deepEqual(overlay.map((entry) => entry.text).sort(), ['불고기', '비빔밥']);
});

test('写真翻訳の段落分割', async (t) => {
  const hasPrice = (text) => extractPriceCandidates(text, 'USD').length > 0;

  await t.test('折り返した文章は1つの段落にまとめる', () => {
    const blocks = groupLinesIntoBlocks([
      line('Please do not touch the', 0.1, 0.1, 0.7, 0.04),
      line('items on display.', 0.1, 0.15, 0.4, 0.04),
    ]);
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].text, 'Please do not touch the items on display.');
  });

  await t.test('メニューの品目どうしはまとめない（短い行）', () => {
    const blocks = groupLinesIntoBlocks([
      line('Bibimbap', 0.1, 0.1, 0.2, 0.04),
      line('Bulgogi', 0.1, 0.15, 0.2, 0.04),
    ]);
    assert.deepEqual(
      blocks.map((block) => block.text),
      ['Bibimbap', 'Bulgogi'],
    );
  });

  await t.test('価格を含む行はまとめない', () => {
    const blocks = groupLinesIntoBlocks(
      [line('Grilled chicken with garlic sauce $12.99', 0.1, 0.1, 0.8, 0.04), line('Rice and salad', 0.1, 0.15, 0.4, 0.04)],
      hasPrice,
    );
    assert.equal(blocks.length, 2);
  });

  await t.test('文末記号で終わる行の次は新しい段落', () => {
    const blocks = groupLinesIntoBlocks([
      line('No smoking in this area.', 0.1, 0.1, 0.7, 0.04),
      line('Thank you for your cooperation', 0.1, 0.15, 0.7, 0.04),
    ]);
    assert.equal(blocks.length, 2);
  });

  await t.test('見出し（文字が大きい）と本文はまとめない', () => {
    const blocks = groupLinesIntoBlocks([
      line('Important information for guests', 0.1, 0.1, 0.8, 0.08),
      line('The museum closes at five on Mondays', 0.1, 0.19, 0.8, 0.04),
    ]);
    assert.equal(blocks.length, 2);
  });

  await t.test('日本語・中国語の折り返しは空白を入れずにつなぐ／英語の行末ハイフンはつなぐ', () => {
    assert.equal(joinWrappedLines('本日のおすすめは', '海鮮丼です'), '本日のおすすめは海鮮丼です');
    assert.equal(joinWrappedLines('오늘의', '추천 메뉴'), '오늘의 추천 메뉴');
    assert.equal(joinWrappedLines('infor-', 'mation'), 'information');
  });

  await t.test('読み順（上から下、同じ高さなら左から右）', () => {
    const ordered = sortLinesInReadingOrder([line('B', 0.6, 0.1), line('A', 0.1, 0.105), line('C', 0.1, 0.3)]);
    assert.deepEqual(
      ordered.map((item) => item.text),
      ['A', 'B', 'C'],
    );
  });
});

test('翻訳キャッシュと翻訳要求の計画', async (t) => {
  await t.test('LRU：上限を超えたら古いものから捨て、参照したものは残す', () => {
    const cache = new LruCache(2);
    cache.set('a', '1');
    cache.set('b', '2');
    assert.equal(cache.get('a'), '1');
    cache.set('c', '3');
    assert.equal(cache.has('b'), false);
    assert.equal(cache.has('a'), true);
    assert.equal(cache.size, 2);
  });

  await t.test('翻訳済み・重複・止めている言語ペアは送らず、言語ごとにまとめる', () => {
    const cached = new Set(['ko|김치']);
    const plans = planTranslationRequests(
      [
        { text: '김치', sourceLanguage: 'ko' },
        { text: '비빔밥', sourceLanguage: 'ko' },
        { text: '비빔밥', sourceLanguage: 'ko' },
        { text: 'Bibimbap', sourceLanguage: 'en' },
        { text: 'ต้มยำ', sourceLanguage: 'th' },
        { text: '12,000', sourceLanguage: null },
      ],
      (source, text) => cached.has(`${source}|${text}`),
      (source) => source === 'th',
      10,
    );
    assert.deepEqual(plans, [
      { sourceLanguage: 'ko', texts: ['비빔밥'] },
      { sourceLanguage: 'en', texts: ['Bibimbap'] },
    ]);
  });

  await t.test('1要求あたりの件数上限', () => {
    const plans = planTranslationRequests(
      ['a1', 'a2', 'a3'].map((text) => ({ text: `word ${text}`, sourceLanguage: 'en' })),
      () => false,
      () => false,
      2,
    );
    assert.equal(plans[0].texts.length, 2);
  });
});

test('言語ペアの状態（翻訳データDLの案内を繰り返し出さない）', async (t) => {
  await t.test('導入済みなら自動翻訳する', () => {
    assert.equal(nextPairStatus('unknown', 'availability_installed'), 'ready');
    assert.equal(canAutoTranslate('ready'), true);
    assert.equal(canAutoTranslate('unknown'), true);
  });
  await t.test('未導入（DLが必要）なら自動では送らない', () => {
    const status = nextPairStatus('unknown', 'availability_supported');
    assert.equal(status, 'needs_download');
    assert.equal(canAutoTranslate(status), false);
  });
  await t.test('失敗したら自動送信を止め、明示操作で成功すれば再開する', () => {
    const failed = nextPairStatus('ready', 'translate_failed');
    assert.equal(failed, 'failed');
    assert.equal(canAutoTranslate(failed), false);
    assert.equal(nextPairStatus(failed, 'translate_succeeded'), 'ready');
  });
  await t.test('非対応の言語ペアは非対応のまま', () => {
    assert.equal(nextPairStatus('unknown', 'availability_unsupported'), 'unsupported');
    assert.equal(nextPairStatus('unsupported', 'translate_failed'), 'unsupported');
    assert.equal(canAutoTranslate('unsupported'), false);
  });
});
