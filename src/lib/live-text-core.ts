/**
 * スマートカメラ（メインカメラのリアルタイム翻訳・円換算）と、翻訳ページの
 * 写真翻訳・リアルタイムカメラ翻訳で共有する純粋ロジック。
 *
 * **react-native・nativeモジュール・`@/`エイリアス・相対importを一切持たない。**
 * `node --test`から直接importして検証できる自己完結モジュールにするため
 * （`csv-export-core.ts`と同じ規律）。価格抽出（`extractPriceCandidates`）は引数で受け取る。
 *
 * 役割分担（2026-10-05 Human決定）:
 * - メインカメラ … 「何があるか・いくらか」をその場で知る補助。商品名・短文・価格を優先し、
 *   長文は出さない。正式な価格OCR・保存フロー（シャッター）は置き換えない
 * - 翻訳ページのカメラ … 外国語を読むこと自体が目的。元の文字付近へ訳を出す
 * - 写真翻訳 … 長文・メニュー・注意書きを静止画で落ち着いて読む
 *
 * 座標はすべて「正立画像に対する0〜1の比率・左上原点」で扱う。
 */

// MARK: - 型

export type NormalizedBox = { x: number; y: number; width: number; height: number };

export type RecognizedLine = { text: string; confidence: number; box: NormalizedBox };

export type LiveTextFrame = {
  lines: RecognizedLine[];
  imageWidth: number;
  imageHeight: number;
  /** 認識完了時刻（epoch ms） */
  timestamp: number;
};

export type Size = { width: number; height: number };

export type ViewRect = { left: number; top: number; width: number; height: number };

// MARK: - テキスト整形

/** 連続する空白を1つにし、前後の空白を除く */
export function normalizeRecognizedText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** フレーム間で同じ行かを判定するための識別キー（大文字小文字の揺れを吸収する） */
export function textIdentityKey(text: string): string {
  return normalizeRecognizedText(text).toLowerCase();
}

/** 編集距離ベースの類似度（0〜1）。OCRの1〜2文字の揺れを同じ行とみなすために使う */
export function textSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  const left = a.slice(0, 80);
  const right = b.slice(0, 80);
  const maxLength = Math.max(left.length, right.length);
  if (maxLength === 0) return 1;
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= right.length; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      current.push(Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost));
    }
    previous = current;
  }
  return 1 - previous[right.length] / maxLength;
}

const CJK_OR_HANGUL = /[぀-ヿ㐀-䶿一-鿿豈-﫿가-힯฀-๿]/;

/**
 * 価格・数字・通貨記号を取り除いた「ラベル部分」を返す。
 * 例: "Garlic Grilled Chicken ₩18,000" → "Garlic Grilled Chicken"、"18,000원" → ""
 */
export function stripPriceTokens(text: string): string {
  return normalizeRecognizedText(
    text
      // 数字の並び（前後の通貨記号・通貨単位ごと）
      .replace(
        /(?:NT\$|US\$|[₩$€£¥฿￦＄￥])?\s*\d[\d,.\s]*(?:\s*(?:원|元|円|บาท|baht|won|krw|usd|eur|gbp|jpy|thb|twd|ntd))?/gi,
        ' ',
      )
      // 単独で残った通貨記号・通貨コード
      .replace(/NT\$|US\$|[₩$€£¥฿￦＄￥]/g, ' ')
      .replace(/\b(?:krw|usd|eur|gbp|jpy|thb|twd|ntd)\b/gi, ' ')
      // 区切り・装飾記号
      .replace(/[~〜\-–—:：·•・.,/|()（）[\]{}*+=_#@!?！？'"“”‘’]+/g, ' '),
  );
}

/**
 * 翻訳する意味のある文字列か。
 * ラテン文字は2文字以上、漢字・かな・ハングル・タイ文字は1文字以上を要求し、長すぎる文字列は除く。
 */
export function isTranslatableText(text: string, maxLength: number): boolean {
  const normalized = normalizeRecognizedText(text);
  if (normalized.length === 0 || normalized.length > maxLength) return false;
  if (CJK_OR_HANGUL.test(normalized)) return true;
  // Hermesでの互換性を優先し、Unicodeプロパティ（\p{L}）ではなく文字範囲で数える
  const letters = normalized.match(/[A-Za-zÀ-ɏͰ-ϿЀ-ӿḀ-ỿ]/g)?.length ?? 0;
  return letters >= 2;
}

// MARK: - 文字種と翻訳元言語

export type TextScript = 'hangul' | 'thai' | 'kana' | 'han' | 'latin' | 'cyrillic' | 'none';

const SCRIPT_PATTERNS: [Exclude<TextScript, 'kana' | 'none'>, RegExp][] = [
  ['hangul', /[ᄀ-ᇿ㄰-㆏가-힯]/g],
  ['thai', /[฀-๿]/g],
  ['han', /[㐀-䶿一-鿿豈-﫿]/g],
  ['latin', /[A-Za-zÀ-ɏ]/g],
  ['cyrillic', /[Ѐ-ӿ]/g],
];
const KANA = /[぀-ヿㇰ-ㇿｦ-ﾟ]/;

/** 文字列の主な文字種。かなが1文字でもあれば日本語として扱う（漢字だけでは中国語と区別できないため） */
export function detectDominantScript(text: string): TextScript {
  if (KANA.test(text)) return 'kana';
  let best: TextScript = 'none';
  let bestCount = 0;
  for (const [script, pattern] of SCRIPT_PATTERNS) {
    const count = text.match(pattern)?.length ?? 0;
    if (count > bestCount) {
      best = script;
      bestCount = count;
    }
  }
  return best;
}

function baseLanguage(code: string): string {
  return code.split('-')[0].toLowerCase();
}

/** 言語コード（BCP-47）の表記文字種 */
export function scriptOfLanguage(code: string): TextScript {
  switch (baseLanguage(code)) {
    case 'ko':
      return 'hangul';
    case 'th':
      return 'thai';
    case 'ja':
      return 'kana';
    case 'zh':
      return 'han';
    case 'ru':
    case 'uk':
    case 'bg':
      return 'cyrillic';
    default:
      return 'latin';
  }
}

/** 同じ言語か（中国語は簡体・繁体を別言語として扱う） */
export function isSameLanguage(a: string, b: string): boolean {
  if (a === b) return true;
  const base = baseLanguage(a);
  return base !== 'zh' && base === baseLanguage(b);
}

/**
 * 1行（1ブロック）を翻訳するときのsource言語を、文字種から決める。nullなら翻訳しない。
 *
 * 言語の推測を行ごとに切り替えると、翻訳セッションの設定が毎回入れ替わり
 * モデルDLの案内が繰り返し出る原因になるため、**文字種で確実に分かる範囲だけ**を使う:
 * - 主言語（通貨hint・翻訳ページの翻訳元）と同じ文字種 → 主言語
 * - ハングル／タイ文字／かな → 韓国語／タイ語／日本語（文字種で一意に決まる）
 * - 主言語が非ラテン文字の言語で、行がラテン文字 → 英語（韓国の店の英語メニュー等）
 * - 漢字だけの行は、主言語が中国語・日本語のときだけ主言語。それ以外は推測しない
 * - 翻訳先と同じ言語になる行は翻訳しない
 */
export function resolveSourceLanguageForText(
  text: string,
  primarySource: string,
  targetLanguage: string,
  latinFallback = 'en',
): string | null {
  const script = detectDominantScript(text);
  if (script === 'none') return null;
  const primaryScript = scriptOfLanguage(primarySource);

  let source: string | null = null;
  if (script === primaryScript) {
    source = primarySource;
  } else if (script === 'han' && primaryScript === 'kana') {
    source = primarySource;
  } else if (script === 'hangul') {
    source = 'ko';
  } else if (script === 'thai') {
    source = 'th';
  } else if (script === 'kana') {
    source = 'ja';
  } else if (script === 'latin') {
    source = latinFallback;
  }

  if (source == null || isSameLanguage(source, targetLanguage)) return null;
  return source;
}

/**
 * 翻訳元言語から、Vision OCRへ渡す認識言語を決める（翻訳ページのカメラ・写真翻訳用）。
 * メインカメラは既存の`getOcrLanguagesForCurrency`（通貨→言語）をそのまま使う。
 * 価格・英数字の混在に備えてen-USを併記する。実機が対応しない言語はnative側で除外される。
 */
export function getVisionLanguagesForSource(source: string): string[] {
  const VISION_LANGUAGE: Record<string, string> = {
    en: 'en-US',
    ko: 'ko-KR',
    ja: 'ja-JP',
    th: 'th-TH',
    fr: 'fr-FR',
    de: 'de-DE',
    es: 'es-ES',
    it: 'it-IT',
    pt: 'pt-BR',
    ru: 'ru-RU',
    uk: 'uk-UA',
    vi: 'vi-VT',
  };
  let primary: string;
  if (source === 'zh-Hant' || source === 'zh-TW' || source === 'zh-HK') {
    primary = 'zh-Hant';
  } else if (baseLanguage(source) === 'zh') {
    primary = 'zh-Hans';
  } else {
    primary = VISION_LANGUAGE[baseLanguage(source)] ?? 'en-US';
  }
  return primary === 'en-US' ? ['en-US'] : [primary, 'en-US'];
}

// MARK: - 座標

export function boxCenter(box: NormalizedBox): { x: number; y: number } {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

export function boxIoU(a: NormalizedBox, b: NormalizedBox): number {
  const left = Math.max(a.x, b.x);
  const top = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  if (right <= left || bottom <= top) return 0;
  const intersection = (right - left) * (bottom - top);
  const union = a.width * a.height + b.width * b.height - intersection;
  return union > 0 ? intersection / union : 0;
}

export function unionBox(a: NormalizedBox, b: NormalizedBox): NormalizedBox {
  const left = Math.min(a.x, b.x);
  const top = Math.min(a.y, b.y);
  const right = Math.max(a.x + a.width, b.x + b.width);
  const bottom = Math.max(a.y + a.height, b.y + b.height);
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function lerp(from: number, to: number, amount: number): number {
  return from + (to - from) * amount;
}

/** 前回位置へ寄せて位置の揺れを抑える（amount=1で新しい位置そのまま） */
export function smoothBox(previous: NormalizedBox, next: NormalizedBox, amount: number): NormalizedBox {
  return {
    x: lerp(previous.x, next.x, amount),
    y: lerp(previous.y, next.y, amount),
    width: lerp(previous.width, next.width, amount),
    height: lerp(previous.height, next.height, amount),
  };
}

/**
 * カメラのプレビューは「アスペクト比を保って枠全体を埋める（はみ出しは切る）」表示
 * （expo-cameraのプレビューは`resizeAspectFill`）。正立画像の座標をプレビュー枠の座標へ変換する。
 */
export function mapBoxToView(box: NormalizedBox, image: Size, view: Size): ViewRect {
  if (image.width <= 0 || image.height <= 0 || view.width <= 0 || view.height <= 0) {
    return { left: 0, top: 0, width: 0, height: 0 };
  }
  const scale = Math.max(view.width / image.width, view.height / image.height);
  const offsetX = (view.width - image.width * scale) / 2;
  const offsetY = (view.height - image.height * scale) / 2;
  return {
    left: box.x * image.width * scale + offsetX,
    top: box.y * image.height * scale + offsetY,
    width: box.width * image.width * scale,
    height: box.height * image.height * scale,
  };
}

/** プレビュー枠に実際に写っている範囲（正立画像の0〜1座標）。枠外で切れた部分の文字を除くために使う */
export function visibleRegionInImage(image: Size, view: Size): NormalizedBox {
  if (image.width <= 0 || image.height <= 0 || view.width <= 0 || view.height <= 0) {
    return { x: 0, y: 0, width: 1, height: 1 };
  }
  const scale = Math.max(view.width / image.width, view.height / image.height);
  const visibleWidth = Math.min(1, view.width / (image.width * scale));
  const visibleHeight = Math.min(1, view.height / (image.height * scale));
  return {
    x: (1 - visibleWidth) / 2,
    y: (1 - visibleHeight) / 2,
    width: visibleWidth,
    height: visibleHeight,
  };
}

/** 行の中心が範囲内にあるか */
export function isBoxInRegion(box: NormalizedBox, region: NormalizedBox): boolean {
  const center = boxCenter(box);
  return (
    center.x >= region.x &&
    center.x <= region.x + region.width &&
    center.y >= region.y &&
    center.y <= region.y + region.height
  );
}

// MARK: - フレーム間の追跡（表示の安定化・古い文字の除去）

export type TrackedLine = {
  /** 初めて見えた時に決まり、以後変わらない識別子（Reactのkey用） */
  id: string;
  /** 表示・翻訳に使う原文 */
  text: string;
  confidence: number;
  /** 平滑化した位置 */
  box: NormalizedBox;
  /** 何フレームで見えたか */
  hits: number;
  firstSeenAt: number;
  lastSeenAt: number;
};

export type TrackerOptions = {
  /** 見えなくなってから消すまでの時間(ms)。カメラが一瞬ぶれても表示がチカチカしないようにする */
  staleMs: number;
  /** 位置の追従率（0〜1）。小さいほど前回位置に留まる */
  smoothing: number;
  /** 保持する行数の上限 */
  maxTracked: number;
  /** これ未満のconfidenceの行は捨てる */
  minConfidence: number;
};

export const DEFAULT_TRACKER_OPTIONS: TrackerOptions = {
  staleMs: 1500,
  smoothing: 0.6,
  maxTracked: 40,
  minConfidence: 0.3,
};

/** 表示してよい安定した行か（2フレーム以上で見えた行だけ出す。1フレームだけの誤認識を出さない） */
export function isStableLine(line: TrackedLine, minHits = 2): boolean {
  return line.hits >= minHits;
}

/**
 * 新しいフレームの認識結果で追跡中の行を更新する。
 * - 同じ文字列（大文字小文字は無視）または「位置が重なり文字列がほぼ同じ」行は同一行として扱う
 * - 同一行は識別子・原文を保ったまま位置だけ滑らかに追従させる（OCRの揺れで訳が変わらないように）
 * - 今回見えなかった行は`staleMs`経過まで残し、それを過ぎたら消す
 */
export function updateTrackedLines(
  previous: readonly TrackedLine[],
  lines: readonly RecognizedLine[],
  now: number,
  options: TrackerOptions = DEFAULT_TRACKER_OPTIONS,
): TrackedLine[] {
  const used = new Set<number>();
  const next: TrackedLine[] = [];

  lines.forEach((line, lineIndex) => {
    const text = normalizeRecognizedText(line.text);
    if (text === '' || line.confidence < options.minConfidence) return;
    const key = textIdentityKey(text);

    let matchIndex = previous.findIndex((p, index) => !used.has(index) && textIdentityKey(p.text) === key);
    const exact = matchIndex >= 0;
    if (!exact) {
      let bestScore = 0;
      previous.forEach((p, index) => {
        if (used.has(index)) return;
        const iou = boxIoU(p.box, line.box);
        if (iou < 0.3) return;
        const similarity = textSimilarity(textIdentityKey(p.text), key);
        if (similarity < 0.6) return;
        const score = iou + similarity;
        if (score > bestScore) {
          bestScore = score;
          matchIndex = index;
        }
      });
    }

    if (matchIndex >= 0) {
      used.add(matchIndex);
      const p = previous[matchIndex];
      // 揺れた読み取りでは原文を差し替えない。明らかに確度が上がった時だけ新しい読みを採る
      const adoptNewText = exact ? true : line.confidence > p.confidence + 0.15;
      next.push({
        id: p.id,
        text: adoptNewText ? text : p.text,
        confidence: adoptNewText ? line.confidence : p.confidence,
        box: smoothBox(p.box, line.box, options.smoothing),
        hits: p.hits + 1,
        firstSeenAt: p.firstSeenAt,
        lastSeenAt: now,
      });
    } else {
      next.push({
        id: `${key}@${now}#${lineIndex}`,
        text,
        confidence: line.confidence,
        box: line.box,
        hits: 1,
        firstSeenAt: now,
        lastSeenAt: now,
      });
    }
  });

  previous.forEach((p, index) => {
    if (!used.has(index) && now - p.lastSeenAt <= options.staleMs) next.push(p);
  });

  return next
    .sort((a, b) => b.lastSeenAt - a.lastSeenAt || b.hits - a.hits)
    .slice(0, options.maxTracked);
}

// MARK: - 価格と商品名の組み立て

export type PriceExtractor = (text: string) => string[];

export type LivePriceEntry = {
  kind: 'price';
  id: string;
  /** 価格（現地通貨。extractPriceCandidatesの値を数値化したもの） */
  amount: number;
  /** 商品名などのラベル（価格と同じ行の文字、または左隣・直上の行）。見つからなければnull */
  label: string | null;
  box: NormalizedBox;
  centerDistance: number;
};

export type LiveTextEntry = {
  kind: 'text';
  id: string;
  text: string;
  box: NormalizedBox;
  centerDistance: number;
};

export type SmartCameraEntry = LivePriceEntry | LiveTextEntry;

export type SmartCameraEntryOptions = {
  /** 1画面に出す最大件数（画面を価格表示で埋めない） */
  maxEntries: number;
  /** ラベル・短文として扱う最大文字数（長文はメインカメラでは出さない） */
  maxTextLength: number;
  minHits: number;
  /** プレビューに写っている範囲。範囲外の行は使わない */
  visibleRegion: NormalizedBox;
};

export const DEFAULT_SMART_CAMERA_OPTIONS: SmartCameraEntryOptions = {
  maxEntries: 3,
  maxTextLength: 40,
  minHits: 2,
  visibleRegion: { x: 0, y: 0, width: 1, height: 1 },
};

function distanceFromRegionCenter(box: NormalizedBox, region: NormalizedBox): number {
  const center = boxCenter(box);
  const regionCenter = boxCenter(region);
  return Math.hypot(center.x - regionCenter.x, center.y - regionCenter.y);
}

function verticalOverlapRatio(a: NormalizedBox, b: NormalizedBox): number {
  const top = Math.max(a.y, b.y);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  const overlap = Math.max(0, bottom - top);
  const minHeight = Math.min(a.height, b.height);
  return minHeight > 0 ? overlap / minHeight : 0;
}

function horizontalOverlap(a: NormalizedBox, b: NormalizedBox): number {
  const left = Math.max(a.x, b.x);
  const right = Math.min(a.x + a.width, b.x + b.width);
  return Math.max(0, right - left);
}

/**
 * 価格の行に対応する商品名の行を探す。
 * 1. 同じ高さで左側にある行（「商品名 …… 価格」型のメニュー）
 * 2. すぐ上にある行（値札の「商品名／価格」型）
 */
function findLabelLine(price: TrackedLine, candidates: readonly TrackedLine[]): TrackedLine | null {
  let best: TrackedLine | null = null;
  let bestGap = Infinity;
  for (const candidate of candidates) {
    if (candidate.id === price.id) continue;
    if (verticalOverlapRatio(candidate.box, price.box) < 0.5) continue;
    const candidateRight = candidate.box.x + candidate.box.width;
    if (candidateRight > price.box.x + 0.02) continue;
    const gap = price.box.x - candidateRight;
    if (gap <= 0.6 && gap < bestGap) {
      best = candidate;
      bestGap = gap;
    }
  }
  if (best) return best;

  const maxVerticalGap = Math.min(0.12, price.box.height * 3);
  for (const candidate of candidates) {
    if (candidate.id === price.id) continue;
    const candidateBottom = candidate.box.y + candidate.box.height;
    if (candidateBottom > price.box.y + price.box.height * 0.3) continue;
    const gap = price.box.y - candidateBottom;
    if (gap > maxVerticalGap) continue;
    const aligned =
      horizontalOverlap(candidate.box, price.box) > 0 ||
      Math.abs(candidate.box.x - price.box.x) <= 0.25;
    if (!aligned) continue;
    if (gap < bestGap) {
      best = candidate;
      bestGap = gap;
    }
  }
  return best;
}

/**
 * メインカメラに出す項目を組み立てる。
 * - 価格が読めた行は「商品名（あれば）＋価格」の1項目にする
 * - 価格が無い短文（看板・商品名）は、価格項目が足りない分だけ出す
 * - 画面中央に近い順に並べ、`maxEntries`件までに絞る
 */
export function buildSmartCameraEntries(
  tracked: readonly TrackedLine[],
  extractPrices: PriceExtractor,
  options: SmartCameraEntryOptions = DEFAULT_SMART_CAMERA_OPTIONS,
): SmartCameraEntry[] {
  const stable = tracked.filter(
    (line) => isStableLine(line, options.minHits) && isBoxInRegion(line.box, options.visibleRegion),
  );

  const priceLines: { line: TrackedLine; amount: number }[] = [];
  const textLines: TrackedLine[] = [];
  for (const line of stable) {
    const prices = extractPrices(line.text);
    const amount = prices.length > 0 ? Number(prices[0]) : NaN;
    if (Number.isFinite(amount) && amount > 0) {
      priceLines.push({ line, amount });
    } else if (isTranslatableText(stripPriceTokens(line.text), options.maxTextLength)) {
      textLines.push(line);
    }
  }

  const usedLabelIds = new Set<string>();
  const priceEntries: LivePriceEntry[] = priceLines.map(({ line, amount }) => {
    const ownLabel = stripPriceTokens(line.text);
    let label: string | null = null;
    let box = line.box;
    if (isTranslatableText(ownLabel, options.maxTextLength)) {
      label = ownLabel;
    } else {
      const labelLine = findLabelLine(line, textLines);
      if (labelLine) {
        label = normalizeRecognizedText(labelLine.text);
        usedLabelIds.add(labelLine.id);
        box = unionBox(line.box, labelLine.box);
      }
    }
    return {
      kind: 'price',
      id: line.id,
      amount,
      label,
      box,
      centerDistance: distanceFromRegionCenter(box, options.visibleRegion),
    };
  });

  const textEntries: LiveTextEntry[] = textLines
    .filter((line) => !usedLabelIds.has(line.id))
    .map((line) => ({
      kind: 'text',
      id: line.id,
      text: normalizeRecognizedText(line.text),
      box: line.box,
      centerDistance: distanceFromRegionCenter(line.box, options.visibleRegion),
    }));

  priceEntries.sort((a, b) => a.centerDistance - b.centerDistance);
  textEntries.sort((a, b) => a.centerDistance - b.centerDistance);

  const entries: SmartCameraEntry[] = priceEntries.slice(0, options.maxEntries);
  for (const entry of textEntries) {
    if (entries.length >= options.maxEntries) break;
    entries.push(entry);
  }
  return entries;
}

/**
 * 翻訳ページのカメラで、元の文字付近に訳を出す行を選ぶ。
 * 価格・数字だけの行は除き、中央に近い順に`maxEntries`件まで。
 */
export function selectOverlayLines(
  tracked: readonly TrackedLine[],
  options: { maxEntries: number; maxTextLength: number; minHits: number; visibleRegion: NormalizedBox },
): LiveTextEntry[] {
  return tracked
    .filter(
      (line) =>
        isStableLine(line, options.minHits) &&
        isBoxInRegion(line.box, options.visibleRegion) &&
        isTranslatableText(stripPriceTokens(line.text), options.maxTextLength),
    )
    .map((line) => ({
      kind: 'text' as const,
      id: line.id,
      text: normalizeRecognizedText(line.text),
      box: line.box,
      centerDistance: distanceFromRegionCenter(line.box, options.visibleRegion),
    }))
    .sort((a, b) => a.centerDistance - b.centerDistance)
    .slice(0, options.maxEntries);
}

// MARK: - 写真翻訳の段落分割

export type TextBlock = { text: string; lines: RecognizedLine[]; box: NormalizedBox };

/** 読み順（上から下、同じ高さなら左から右）に並べる */
export function sortLinesInReadingOrder(lines: readonly RecognizedLine[]): RecognizedLine[] {
  return [...lines].sort((a, b) => {
    const sameRow = Math.abs(a.box.y - b.box.y) < Math.min(a.box.height, b.box.height) * 0.5;
    if (!sameRow) return a.box.y - b.box.y;
    return a.box.x - b.box.x;
  });
}

const SENTENCE_END = /[.!?。！？:：]$/;
const NO_SPACE_SCRIPT = /[぀-ヿ㐀-䶿一-鿿豈-﫿฀-๿]/;

/** 折り返された2行をつなぐ。かな・漢字・タイ文字どうしは空白を入れない。英語の行末ハイフンはつなげる */
export function joinWrappedLines(previous: string, next: string): string {
  if (/[A-Za-z]-$/.test(previous) && /^[a-z]/.test(next)) {
    return previous.slice(0, -1) + next;
  }
  const last = previous.slice(-1);
  const first = next.slice(0, 1);
  if (NO_SPACE_SCRIPT.test(last) && NO_SPACE_SCRIPT.test(first)) {
    return previous + next;
  }
  return `${previous} ${next}`;
}

/**
 * 写真翻訳用に、OCRの行を「1つの文章（段落）」のまとまりへ分ける。
 *
 * メニューの品目どうしを1文にまとめると訳がおかしくなるため、**つなぐのは折り返しが明らかな時だけ**:
 * - 前の行が横に長い（画像幅の35%以上）＝文章が右端まで来て折り返している
 * - 文末記号で終わっていない
 * - 行間が狭く、文字の高さが近く、左端が揃っている
 * - どちらの行にも価格（数字）が含まれない
 */
export function groupLinesIntoBlocks(
  lines: readonly RecognizedLine[],
  hasPrice: (text: string) => boolean = () => false,
): TextBlock[] {
  const ordered = sortLinesInReadingOrder(
    lines.filter((line) => normalizeRecognizedText(line.text) !== ''),
  );
  const blocks: TextBlock[] = [];

  for (const line of ordered) {
    const text = normalizeRecognizedText(line.text);
    // 段組みに備え、直近の数ブロックの中からつなげる先を探す
    let target: TextBlock | null = null;
    for (let index = blocks.length - 1; index >= 0 && index >= blocks.length - 3; index -= 1) {
      const block = blocks[index];
      const last = block.lines[block.lines.length - 1];
      const lastText = normalizeRecognizedText(last.text);
      const gap = line.box.y - (last.box.y + last.box.height);
      const minHeight = Math.min(last.box.height, line.box.height);
      const heightRatio =
        Math.max(last.box.height, line.box.height) / Math.max(minHeight, Number.EPSILON);
      const leftAligned = Math.abs(last.box.x - line.box.x) <= Math.max(last.box.height, line.box.height) * 1.5;
      const wrapped = last.box.width >= 0.35 && !SENTENCE_END.test(lastText);
      if (
        wrapped &&
        gap >= -minHeight * 0.3 &&
        gap <= minHeight * 0.8 &&
        heightRatio <= 1.35 &&
        leftAligned &&
        !hasPrice(lastText) &&
        !hasPrice(text)
      ) {
        target = block;
        break;
      }
    }

    if (target) {
      target.text = joinWrappedLines(target.text, text);
      target.lines.push(line);
      target.box = unionBox(target.box, line.box);
    } else {
      blocks.push({ text, lines: [line], box: line.box });
    }
  }

  return blocks;
}

// MARK: - 翻訳キャッシュ・翻訳要求の計画

/** 挿入順に古いものから捨てるLRUキャッシュ */
export class LruCache<V> {
  private readonly entries = new Map<string, V>();
  private readonly limit: number;

  constructor(limit: number) {
    this.limit = Math.max(1, limit);
  }

  get(key: string): V | undefined {
    const value = this.entries.get(key);
    if (value === undefined) return undefined;
    this.entries.delete(key);
    this.entries.set(key, value);
    return value;
  }

  has(key: string): boolean {
    return this.entries.has(key);
  }

  set(key: string, value: V): void {
    this.entries.delete(key);
    this.entries.set(key, value);
    while (this.entries.size > this.limit) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.entries.delete(oldest.value);
    }
  }

  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }
}

export type TranslationPlanItem = { text: string; sourceLanguage: string | null };

export type TranslationRequestPlan = { sourceLanguage: string; texts: string[] };

/**
 * 翻訳が必要な文字列を、source言語ごとの要求へまとめる。
 * - 翻訳済み（キャッシュあり）・sourceなし・止めている言語ペアは送らない
 * - 同じ文字列は1回だけ送る
 * - 並び順（＝優先度。中央に近い順）を保ち、1要求あたり`maxPerRequest`件まで
 */
export function planTranslationRequests(
  items: readonly TranslationPlanItem[],
  isCached: (sourceLanguage: string, text: string) => boolean,
  isPairBlocked: (sourceLanguage: string) => boolean,
  maxPerRequest: number,
): TranslationRequestPlan[] {
  const plans: TranslationRequestPlan[] = [];
  const queued = new Set<string>();
  for (const item of items) {
    const source = item.sourceLanguage;
    if (source == null || isPairBlocked(source)) continue;
    const text = normalizeRecognizedText(item.text);
    if (text === '' || isCached(source, text)) continue;
    const dedupeKey = JSON.stringify([source, text]);
    if (queued.has(dedupeKey)) continue;
    let plan = plans.find((candidate) => candidate.sourceLanguage === source);
    if (!plan) {
      plan = { sourceLanguage: source, texts: [] };
      plans.push(plan);
    }
    if (plan.texts.length >= maxPerRequest) continue;
    queued.add(dedupeKey);
    plan.texts.push(text);
  }
  return plans;
}

// MARK: - 言語ペアの状態（モデルDLの案内を繰り返し出さないための遮断）

/**
 * - unknown … まだ確認していない（自動翻訳してよい）
 * - ready … 翻訳できた／端末に導入済み
 * - needs_download … 端末に翻訳データが無い。自動では送らず、利用者の明示操作を待つ
 * - unsupported … この言語ペアは翻訳できない
 * - failed … 失敗した。自動では再送せず、利用者の明示操作を待つ
 */
export type PairStatus = 'unknown' | 'ready' | 'needs_download' | 'unsupported' | 'failed';

export type PairEvent =
  | 'availability_installed'
  | 'availability_supported'
  | 'availability_unsupported'
  | 'translate_succeeded'
  | 'translate_failed'
  | 'translate_unavailable';

export function nextPairStatus(current: PairStatus, event: PairEvent): PairStatus {
  switch (event) {
    case 'availability_installed':
      return current === 'unknown' ? 'ready' : current;
    case 'availability_supported':
      return current === 'unknown' ? 'needs_download' : current;
    case 'availability_unsupported':
      return 'unsupported';
    case 'translate_succeeded':
      return 'ready';
    case 'translate_failed':
      // 一度でも成功した組み合わせ（ready）でも、失敗したら自動送信を止める。
      // 失敗の多くは翻訳データDLの拒否・中断で、自動で再送するとDLの案内が繰り返し出るため
      return current === 'unsupported' ? current : 'failed';
    case 'translate_unavailable':
      return 'unsupported';
    default:
      return current;
  }
}

/** 利用者の操作なしに翻訳要求を送ってよい状態か */
export function canAutoTranslate(status: PairStatus): boolean {
  return status === 'unknown' || status === 'ready';
}
