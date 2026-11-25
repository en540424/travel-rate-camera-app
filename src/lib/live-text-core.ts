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
/**
 * プレビュー枠の一部（ビューの座標）が、正立画像のどの範囲に当たるか（`mapBoxToView`の逆）。
 * 枠の下部が他の表示（価格の帯・タブバー）に隠れている時、利用者に実際に見えている範囲を求めるのに使う。
 */
export function viewRectToImageRegion(rect: ViewRect, image: Size, view: Size): NormalizedBox {
  if (image.width <= 0 || image.height <= 0 || view.width <= 0 || view.height <= 0) {
    return { x: 0, y: 0, width: 1, height: 1 };
  }
  const scale = Math.max(view.width / image.width, view.height / image.height);
  const offsetX = (view.width - image.width * scale) / 2;
  const offsetY = (view.height - image.height * scale) / 2;
  const left = Math.max(0, Math.min(1, (rect.left - offsetX) / (image.width * scale)));
  const top = Math.max(0, Math.min(1, (rect.top - offsetY) / (image.height * scale)));
  const right = Math.max(left, Math.min(1, (rect.left + rect.width - offsetX) / (image.width * scale)));
  const bottom = Math.max(top, Math.min(1, (rect.top + rect.height - offsetY) / (image.height * scale)));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/**
 * プレビュー枠のうち、画面の下端（下タブ等）に隠れている高さ(pt)。枠の位置は画面（window）の座標。
 * 隠れていなければ0。測り違いで枠のほとんどを捨てないよう、枠の高さの半分までにする。
 */
export function hiddenFrameBottom(
  frame: { top: number; height: number },
  windowHeight: number,
  bottomObstruction: number,
): number {
  if (!(frame.height > 0)) return 0;
  const visibleBottom = windowHeight - bottomObstruction;
  return Math.max(0, Math.min(frame.height * 0.5, frame.top + frame.height - visibleBottom));
}

/**
 * 枠の下から`occludedBottom`(pt)が隠れている時に、利用者に見えている部分が正立画像のどの範囲に当たるか。
 * 隠れた分が大きすぎても、枠の上`minFraction`は必ず残す。
 */
export function unobstructedRegionInImage(
  image: Size,
  view: Size,
  occludedBottom: number,
  minFraction = 0.3,
): NormalizedBox {
  const height = Math.max(view.height * minFraction, view.height - Math.max(0, occludedBottom));
  return viewRectToImageRegion({ left: 0, top: 0, width: view.width, height }, image, view);
}

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
  /**
   * 直近の読み（新しいものが後ろ・最大`MAX_READINGS`件）。原文は多数決で決める（2026-11-25）。
   * 無い時（テスト等で直接組み立てた行）は、`text`を`hits`回読んだものとして扱う
   */
  readings?: string[];
};

/** 原文の多数決に使う直近の読みの数 */
const MAX_READINGS = 5;

/**
 * 直近の読みの多数決（大文字小文字・空白の揺れは同じ読み）。同数なら今の読みを保ち、今の読みが負けていれば
 * 多い読みのうち最も新しいもの。返す文字は、その読みの最も新しい書き方
 */
function majorityReading(readings: readonly string[], currentKey: string): { text: string; key: string; count: number } {
  const counts = new Map<string, number>();
  for (const reading of readings) {
    const key = textIdentityKey(reading);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const top = Math.max(...counts.values());
  let key = currentKey;
  if (counts.get(currentKey) !== top) {
    for (let i = readings.length - 1; i >= 0; i -= 1) {
      const candidate = textIdentityKey(readings[i]);
      if (counts.get(candidate) === top) {
        key = candidate;
        break;
      }
    }
  }
  let text = readings[readings.length - 1];
  for (let i = readings.length - 1; i >= 0; i -= 1) {
    if (textIdentityKey(readings[i]) === key) {
      text = readings[i];
      break;
    }
  }
  return { text, key, count: counts.get(key) ?? 0 };
}

/** 今の原文と同じ読みが直近で何回あったか（読みの記録が無い行は`hits`） */
function readingSupport(line: TrackedLine): number {
  if (line.readings == null) return line.hits;
  const key = textIdentityKey(line.text);
  return line.readings.filter((reading) => textIdentityKey(reading) === key).length;
}

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
  // native（LiveTextFrameProcessor）が1フレームで返す行数の上限と同じ。これより小さいと、メニュー1枚（40行超）で
  // 新しく見えた行が毎フレーム切り捨てられ、2フレーム目に届かず一度も表示されない行が出る（2026-11-25）
  maxTracked: 80,
  minConfidence: 0.3,
};

/** カメラの動きを推定するのに要る「前後のフレームで1つずつしか無い文字」の組の数 */
const MIN_MOTION_PAIRS = 2;
/** 推定に使う組どうしの動きのばらつきの許容（正規化座標）。超えたら動きなしとみなす */
const MOTION_AGREEMENT = 0.02;

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * 前のフレームからのカメラの動き（画面全体の平行移動）。
 * 前後のフレームで1つずつしか無い文字（取り違えようがない組）の移動量の中央値。組が少なすぎる・ばらつく時は0。
 */
export function estimateFrameMotion(
  previous: readonly TrackedLine[],
  lines: readonly { key: string; box: NormalizedBox }[],
): { dx: number; dy: number } {
  const previousByKey = new Map<string, TrackedLine[]>();
  for (const p of previous) {
    const key = textIdentityKey(p.text);
    previousByKey.set(key, [...(previousByKey.get(key) ?? []), p]);
  }
  const currentCount = new Map<string, number>();
  for (const line of lines) currentCount.set(line.key, (currentCount.get(line.key) ?? 0) + 1);

  const dxs: number[] = [];
  const dys: number[] = [];
  for (const line of lines) {
    const candidates = previousByKey.get(line.key);
    if (candidates?.length !== 1 || currentCount.get(line.key) !== 1) continue;
    const from = boxCenter(candidates[0].box);
    const to = boxCenter(line.box);
    dxs.push(to.x - from.x);
    dys.push(to.y - from.y);
  }
  if (dxs.length < MIN_MOTION_PAIRS) return { dx: 0, dy: 0 };
  const dx = median(dxs);
  const dy = median(dys);
  // 3組未満は全組がそろっている時だけ信じる（1組の取り違えで全体を動かさない）
  if (dxs.length < 3) {
    const agree = dxs.every((value, index) => Math.abs(value - dx) <= MOTION_AGREEMENT && Math.abs(dys[index] - dy) <= MOTION_AGREEMENT);
    if (!agree) return { dx: 0, dy: 0 };
  }
  return { dx, dy };
}

function shiftBox(box: NormalizedBox, motion: { dx: number; dy: number }): NormalizedBox {
  return { ...box, x: box.x + motion.dx, y: box.y + motion.dy };
}

function centerDistance(a: NormalizedBox, b: NormalizedBox): number {
  const ca = boxCenter(a);
  const cb = boxCenter(b);
  return Math.hypot(ca.x - cb.x, ca.y - cb.y);
}

/**
 * 表示してよい安定した行か（2フレーム以上で見えた行だけ出す。1フレームだけの誤認識を出さない）。
 * 数字を含む行（価格）は、今の読みそのものが`minHits`回以上読めている時だけ（読みが割れている間は出さない。
 * `$5.60`を1回`$5.00`と読んだ直後に、どちらとも決まらない価格で円換算を出さない。2026-11-25）。
 * 同じ読みが続く時は従来と同じ（2回目で出る）
 */
export function isStableLine(line: TrackedLine, minHits = 2): boolean {
  if (line.hits < minHits) return false;
  return !/\d/.test(line.text) || readingSupport(line) >= minHits;
}

/**
 * 新しいフレームの認識結果で追跡中の行を更新する。
 * - 同じ文字列（大文字小文字は無視）または「位置が重なり文字列がほぼ同じ」行は同一行として扱う
 * - 同じ文字列が複数ある時（同じ値段が2品など）は、位置の近いものどうしを対応させる（取り違えて位置が混ざらないように）
 * - 同一行は識別子・原文を保ったまま位置だけ滑らかに追従させる（OCRの揺れで訳が変わらないように）
 * - カメラの動き（画面全体の平行移動）を推定し、前回の位置をその分ずらしてから比べ・追従させる。
 *   今回読めなかった行もその分ずらして残す（古い位置に残った行が隣の行の価格と組になる・訳が1行ずれるのを防ぐ。2026-11-25）
 * - 今回見えなかった行は`staleMs`経過まで残し、それを過ぎたら消す
 * - 原文は直近の読みの多数決（2026-11-25）。以前は「揺れた読みは確度が0.15以上上がった時だけ採る」だったため、
 *   最初の1フレームの読み違い（`$5.60`→`$5.00`）が、確度の同じ正しい読みが続いても残り続けた
 *   （Visionの`.accurate`の確度は1.0になりやすく、1.0より0.15高い確度は無い）
 */
export function updateTrackedLines(
  previous: readonly TrackedLine[],
  lines: readonly RecognizedLine[],
  now: number,
  options: TrackerOptions = DEFAULT_TRACKER_OPTIONS,
): TrackedLine[] {
  const incoming = lines
    .map((line, lineIndex) => ({ line, lineIndex, text: normalizeRecognizedText(line.text) }))
    .filter(({ line, text }) => text !== '' && line.confidence >= options.minConfidence)
    .map((item) => ({ ...item, key: textIdentityKey(item.text), box: item.line.box }));

  const motion = estimateFrameMotion(previous, incoming);
  const predicted = previous.map((p) => shiftBox(p.box, motion));
  const previousKeys = previous.map((p) => textIdentityKey(p.text));

  // 1. 同じ文字列どうし：近い組から順に対応させる
  const used = new Set<number>();
  const matchOf = new Map<number, { index: number; exact: boolean }>();
  const exactPairs: { incomingIndex: number; previousIndex: number; distance: number }[] = [];
  incoming.forEach((item, incomingIndex) => {
    previousKeys.forEach((key, previousIndex) => {
      if (key === item.key) {
        exactPairs.push({ incomingIndex, previousIndex, distance: centerDistance(predicted[previousIndex], item.box) });
      }
    });
  });
  exactPairs.sort((a, b) => a.distance - b.distance);
  for (const pair of exactPairs) {
    if (matchOf.has(pair.incomingIndex) || used.has(pair.previousIndex)) continue;
    matchOf.set(pair.incomingIndex, { index: pair.previousIndex, exact: true });
    used.add(pair.previousIndex);
  }

  // 2. 読みが1〜2文字揺れた行：（動きを補正した）位置が重なり、文字列がほぼ同じもの
  incoming.forEach((item, incomingIndex) => {
    if (matchOf.has(incomingIndex)) return;
    let bestScore = 0;
    let bestIndex = -1;
    previous.forEach((p, index) => {
      if (used.has(index)) return;
      const iou = boxIoU(predicted[index], item.box);
      if (iou < 0.3) return;
      const similarity = textSimilarity(previousKeys[index], item.key);
      if (similarity < 0.6) return;
      const score = iou + similarity;
      if (score > bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    });
    if (bestIndex >= 0) {
      matchOf.set(incomingIndex, { index: bestIndex, exact: false });
      used.add(bestIndex);
    }
  });

  const next: TrackedLine[] = incoming.map((item, incomingIndex) => {
    const match = matchOf.get(incomingIndex);
    if (match == null) {
      return {
        id: `${item.key}@${now}#${item.lineIndex}`,
        text: item.text,
        confidence: item.line.confidence,
        box: item.box,
        hits: 1,
        firstSeenAt: now,
        lastSeenAt: now,
        readings: [item.text],
      };
    }
    const p = previous[match.index];
    // 原文は直近の読みの多数決。1回だけ揺れた読みでは差し替えない（訳が変わらない）・同数なら今の原文を保つ
    const priorReadings = p.readings ?? Array.from({ length: Math.min(p.hits, MAX_READINGS) }, () => p.text);
    const readings = [...priorReadings, item.text].slice(-MAX_READINGS);
    const winner = majorityReading(readings, textIdentityKey(p.text));
    return {
      id: p.id,
      text: winner.text,
      confidence: winner.key === item.key ? item.line.confidence : p.confidence,
      box: smoothBox(predicted[match.index], item.box, options.smoothing),
      hits: p.hits + 1,
      firstSeenAt: p.firstSeenAt,
      lastSeenAt: now,
      readings,
    };
  });

  previous.forEach((p, index) => {
    if (!used.has(index) && now - p.lastSeenAt <= options.staleMs) next.push({ ...p, box: predicted[index] });
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
  /** 商品名（価格と同じ行の左端の文字、または直上の行）。見つからない・確かでなければnull */
  label: string | null;
  /** 説明（同じ行で商品名と価格の間にある文字）。無ければnull */
  description: string | null;
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
  /** 認識した画像の大きさ(px)。行の傾きの推定に使う（無ければ縦横同じ比率として扱う） */
  imageSize?: Size;
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

// MARK: 価格と商品名・説明の対応付け（2026-11-25 改訂）
//
// 実機（Build 5）で、円換算カードに別の商品の価格が出た（`Squeezed daily`に$3.20）。原因と対策:
// - 価格の「左隣で一番近い行」を名前にしていたため、3列のメニュー（商品名｜説明｜価格）では説明が商品名になっていた
//   → 同じ行の左端を商品名、その間を説明として分けて持つ
// - 端末を少し回して持つと行が傾き、価格の列が隣の行と重なる → 価格の列のずれから傾きを推定し、傾きに沿って同じ行を探す
// - 2つの価格が同じ文字を名前に取り合う・同じ行に縦に重なる文字があるなど、確かでない時は名前を付けない
//   （誤った商品の円換算を出すより、名前なしの方を選ぶ）
// - 2列に並んだメニューで、左の列の商品名を右の列の価格に付けない（左にある別の価格の所で探すのを止める）

/** 傾きの推定に使う最少の価格の数 */
const MIN_COLUMN_PRICES = 3;
/** 推定する傾きの上限（列のずれ dx/dy。約8.5°）。これを超える推定は使わない */
const MAX_COLUMN_SLOPE = 0.15;
/** 同じ行とみなす重なりの割合 */
const ROW_OVERLAP = 0.5;
/** 「半分ずれて同じ行にかかっている」とみなす重なりの割合（行の続きを取りこぼしている目印） */
const PARTIAL_ROW_OVERLAP = 0.2;
/** 価格から左の商品名・説明までの最大の隙間（正規化座標） */
const MAX_LABEL_GAP = 0.6;

const UNIT_SIZE: Size = { width: 1, height: 1 };

/**
 * 価格の列の傾き（px単位の dx/dy）。端末を回して持つと縦の列が傾き、横の行も同じだけ傾く。
 * 価格が3つ以上縦に並ぶ列について、左端・右端のどちらかがまっすぐ並ぶ（左揃え・右揃え）時だけ推定し、
 * 並びが崩れている・価格が少ない時は0（傾きなし）を返す。
 */
export function estimateColumnSlope(boxes: readonly NormalizedBox[], image: Size = UNIT_SIZE): number {
  if (boxes.length < MIN_COLUMN_PRICES) return 0;
  const points = boxes
    .map((box) => ({
      y: (box.y + box.height / 2) * image.height,
      left: box.x * image.width,
      right: (box.x + box.width) * image.width,
      center: (box.x + box.width / 2) * image.width,
      height: box.height * image.height,
    }))
    .sort((a, b) => a.center - b.center);

  // 横に離れた価格は別の列（2列のメニュー）。いちばん多い列だけで推定する
  const columns: (typeof points)[] = [[points[0]]];
  for (let i = 1; i < points.length; i += 1) {
    if (points[i].center - points[i - 1].center > image.width * 0.12) columns.push([]);
    columns[columns.length - 1].push(points[i]);
  }
  const column = columns.reduce((a, b) => (b.length > a.length ? b : a));
  if (column.length < MIN_COLUMN_PRICES) return 0;

  const lineHeight = median(column.map((point) => point.height));
  const ys = column.map((point) => point.y);
  if (Math.max(...ys) - Math.min(...ys) < lineHeight * 3) return 0;

  const meanY = ys.reduce((sum, y) => sum + y, 0) / ys.length;
  const varianceY = ys.reduce((sum, y) => sum + (y - meanY) ** 2, 0);
  let best: { slope: number; rms: number } | null = null;
  for (const edge of ['left', 'right'] as const) {
    const xs = column.map((point) => point[edge]);
    const meanX = xs.reduce((sum, x) => sum + x, 0) / xs.length;
    const covariance = column.reduce((sum, point, index) => sum + (point.y - meanY) * (xs[index] - meanX), 0);
    const slope = covariance / varianceY;
    const rms = Math.sqrt(
      column.reduce((sum, point, index) => sum + (xs[index] - (meanX + slope * (point.y - meanY))) ** 2, 0) /
        column.length,
    );
    if (best == null || rms < best.rms) best = { slope, rms };
  }
  if (best == null || best.rms > Math.max(3, lineHeight * 0.35) || Math.abs(best.slope) > MAX_COLUMN_SLOPE) return 0;
  return best.slope;
}

/** 傾きに沿った「行の位置」（px）と、傾きで太った分を除いた文字の高さ */
function rowSpan(box: NormalizedBox, slope: number, image: Size): { top: number; bottom: number } {
  const centerX = (box.x + box.width / 2) * image.width;
  const centerY = (box.y + box.height / 2) * image.height;
  const height = box.height * image.height;
  const trueHeight = Math.max(height * 0.5, height - Math.abs(slope) * box.width * image.width);
  // 列が dx/dy=slope で傾く時、行は dy/dx=-slope で傾く。行の上では y + slope*x が一定
  const position = centerY + slope * centerX;
  return { top: position - trueHeight / 2, bottom: position + trueHeight / 2 };
}

function rowOverlapRatio(a: NormalizedBox, b: NormalizedBox, slope: number, image: Size): number {
  const spanA = rowSpan(a, slope, image);
  const spanB = rowSpan(b, slope, image);
  const overlap = Math.max(0, Math.min(spanA.bottom, spanB.bottom) - Math.max(spanA.top, spanB.top));
  const minHeight = Math.min(spanA.bottom - spanA.top, spanB.bottom - spanB.top);
  return minHeight > 0 ? overlap / minHeight : 0;
}

function boxRight(box: NormalizedBox): number {
  return box.x + box.width;
}

type PriceLabelClaim = {
  nameLine: TrackedLine | null;
  descriptionLines: TrackedLine[];
  /** 商品名の行との重なり（取り合いの優先度） */
  score: number;
  ambiguous: boolean;
};

export type PriceLabelAssignment = {
  /** 商品名。確かでなければnull */
  label: string | null;
  /** 説明。無ければnull */
  description: string | null;
  /** 価格と、使った商品名・説明を合わせた範囲 */
  box: NormalizedBox;
  /** 商品名・説明に使った行の識別子 */
  usedLineIds: string[];
};

/**
 * 価格の行ごとに、商品名・説明を決める（メインカメラ・翻訳ページのカメラで共有）。
 * 1. 同じ行（傾きを補正）で価格より左にある文字。左端を商品名、それより右（価格まで）を説明にする。
 *    左に別の価格があれば、そこより右だけを見る（2列のメニュー）
 * 2. 同じ行に何も無ければ、すぐ上にある行（値札の「商品名／価格」型）
 * 価格の行自体に文字があれば（"Classic Burger $12.50"）、それを商品名にし、左は探さない。
 * 確かでない時（同じ行で縦に重なる文字がある・複数の価格が同じ文字を取り合う）は商品名を付けない。
 */
export function assignPriceLabels(
  priceLines: readonly TrackedLine[],
  textLines: readonly TrackedLine[],
  options: { maxTextLength: number; imageSize?: Size },
): Map<string, PriceLabelAssignment> {
  const image = options.imageSize ?? UNIT_SIZE;
  // 傾きの推定は画像の大きさ(px)が分かる時だけ（正規化座標のままでは「まっすぐ並んでいるか」を判定できない）
  const slope =
    options.imageSize != null
      ? estimateColumnSlope(
          priceLines.map((line) => line.box),
          image,
        )
      : 0;
  const sameRow = (a: NormalizedBox, b: NormalizedBox) => rowOverlapRatio(a, b, slope, image) >= ROW_OVERLAP;
  const ownLabelOf = (price: TrackedLine): string | null => {
    const ownText = stripPriceTokens(price.text);
    return isTranslatableText(ownText, options.maxTextLength) ? ownText : null;
  };

  const claims = new Map<string, PriceLabelClaim>();
  for (const price of priceLines) {
    // 価格の行自体に文字があれば（"Classic Burger $12.50"・値札の"Bread $2.49"）それが商品名。左は探さない
    // （隣に並んだ別の値札の商品名を取らない。メインカメラの従来の挙動）
    if (ownLabelOf(price) != null) continue;
    // 左にある別の価格（同じ行）。そこより左は別の品目
    const boundary = priceLines
      .filter((other) => other.id !== price.id && sameRow(other.box, price.box) && boxRight(other.box) <= price.box.x + 0.02)
      .reduce((edge, other) => Math.max(edge, boxRight(other.box)), -Infinity);
    const row = textLines
      .filter(
        (line) =>
          sameRow(line.box, price.box) && boxRight(line.box) <= price.box.x + 0.02 && line.box.x >= boundary - 0.005,
      )
      .sort((a, b) => a.box.x - b.box.x);
    const nearestGap = row.length > 0 ? price.box.x - Math.max(...row.map((line) => boxRight(line.box))) : Infinity;
    if (row.length === 0 || nearestGap > MAX_LABEL_GAP) {
      claims.set(price.id, { nameLine: null, descriptionLines: [], score: 0, ambiguous: false });
      continue;
    }
    // 確かでない組：
    // - 同じ行の中で横に重なる文字が2つある＝上下の行にまたがっている（行の境目にある価格）
    // - 隣り合う文字どうし（商品名と説明）が同じ行にない＝傾いて別の行の文字を拾っている（傾きを推定できない時）
    // - 左端の文字のさらに左に、半分ずれて同じ行にかかる文字がある＝行の続き（商品名）を取りこぼしている
    const leftmost = row[0];
    const ambiguous =
      row.some((a, i) => row.some((b, j) => j > i && horizontalOverlap(a.box, b.box) > 0)) ||
      row.some((line, i) => i > 0 && !sameRow(row[i - 1].box, line.box)) ||
      textLines.some(
        (line) =>
          !row.includes(line) &&
          boxRight(line.box) <= leftmost.box.x + 0.005 &&
          line.box.x >= boundary - 0.005 &&
          rowOverlapRatio(line.box, leftmost.box, slope, image) >= PARTIAL_ROW_OVERLAP,
      );
    claims.set(price.id, {
      nameLine: row[0],
      descriptionLines: row.slice(1),
      score: rowOverlapRatio(row[0].box, price.box, slope, image),
      ambiguous,
    });
  }

  // 同じ文字を複数の価格が商品名・説明に取り合ったら、重なりの大きい方だけに付ける
  const owner = new Map<string, { priceId: string; score: number }>();
  for (const [priceId, claim] of claims) {
    if (claim.ambiguous || claim.nameLine == null) continue;
    for (const line of [claim.nameLine, ...claim.descriptionLines]) {
      const current = owner.get(line.id);
      if (current == null || claim.score > current.score) owner.set(line.id, { priceId, score: claim.score });
    }
  }
  const conflicted = new Set<string>();
  for (const [priceId, claim] of claims) {
    if (claim.nameLine == null) continue;
    if ([claim.nameLine, ...claim.descriptionLines].some((line) => owner.get(line.id)?.priceId !== priceId)) {
      conflicted.add(priceId);
    }
  }
  const usedIds = new Set<string>();
  for (const [priceId, claim] of claims) {
    if (claim.nameLine == null || conflicted.has(priceId)) continue;
    usedIds.add(claim.nameLine.id);
    for (const line of claim.descriptionLines) usedIds.add(line.id);
  }

  const result = new Map<string, PriceLabelAssignment>();
  for (const price of priceLines) {
    const claim = claims.get(price.id);
    const ownLabel = ownLabelOf(price);
    let nameLine: TrackedLine | null = null;
    let descriptionLines: TrackedLine[] = [];

    if (ownLabel == null) {
      if (claim?.nameLine != null) {
        // 確かでない時は名前を付けない
        if (!claim.ambiguous && !conflicted.has(price.id)) {
          nameLine = claim.nameLine;
          descriptionLines = claim.descriptionLines;
        }
      } else {
        nameLine = findLineAbove(price, textLines, usedIds);
        if (nameLine != null) usedIds.add(nameLine.id);
      }
    }

    const descriptions = descriptionLines.map((line) => normalizeRecognizedText(line.text));
    const label = nameLine != null ? normalizeRecognizedText(nameLine.text) : ownLabel;
    const used = [...(nameLine ? [nameLine] : []), ...descriptionLines];
    result.set(price.id, {
      label,
      description: label != null && descriptions.length > 0 ? descriptions.join(' ') : null,
      box: used.reduce((box, line) => unionBox(box, line.box), price.box),
      usedLineIds: used.map((line) => line.id),
    });
  }
  return result;
}

/** 値札の「商品名／価格」型：価格のすぐ上にある行（他の価格に使った行は除く） */
function findLineAbove(
  price: TrackedLine,
  candidates: readonly TrackedLine[],
  usedIds: ReadonlySet<string>,
): TrackedLine | null {
  let best: TrackedLine | null = null;
  let bestGap = Infinity;
  const maxVerticalGap = Math.min(0.12, price.box.height * 3);
  for (const candidate of candidates) {
    if (candidate.id === price.id || usedIds.has(candidate.id)) continue;
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

  const assignments = assignPriceLabels(
    priceLines.map(({ line }) => line),
    textLines,
    options,
  );
  const usedLabelIds = new Set<string>();
  const priceEntries: LivePriceEntry[] = priceLines.map(({ line, amount }) => {
    const assignment = assignments.get(line.id);
    for (const id of assignment?.usedLineIds ?? []) usedLabelIds.add(id);
    const box = assignment?.box ?? line.box;
    return {
      kind: 'price',
      id: line.id,
      amount,
      label: assignment?.label ?? null,
      description: assignment?.description ?? null,
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

// MARK: 訳を重ねる行の選び方（2026-11-25 改訂・Build 6 の実機確認から）
//
// 実機（3列のカフェメニューを固定して写す）で、中央の列（説明）ばかり訳され、左の列の商品名が英語のまま残った。
// 下の価格一覧には商品名の訳が出ていた＝OCRは読めていて、選び方の問題。原因と対策:
// - 中央からの距離を正規化座標（幅・高さとも0〜1）で測っていた。縦長の映像（1080×1920）では横の0.1が縦の0.18と
//   同じ扱いになり、左右の文字が画面上の見た目より遠い扱いだった → 映像の大きさが分かる時は画面上の距離（px）で測る
// - 中央の列の説明は横の距離がほぼ0なので、上下に離れた行の説明でも、同じ行の左の商品名より先に選ばれた
//   → 同じ行で左に別の文字がある文字（説明・続き）は、距離に一定の値を足す。中央の行の説明は残しつつ、
//     左右の行の先頭（商品名・見出し）も入る。価格だけの行・大きな隙間の向こうは別の品目として扱う（2列のメニュー）
// - 周りより大きい文字（見出し）は少し優先する
// - 前回選んだ行は少し優先する（静止中に札が入れ替わり続けない）
// 1行に1つの文字しか無い看板・案内板で横位置が揃っていれば、選び方は従来と同じ（上下の中央に近い順）。

/** 同じ行で左に別の文字がある文字（説明・行の続き）に足す距離（映像の高さに対する割合） */
const FOLLOWER_PENALTY = 0.1;
/** これより大きい隙間（映像の幅に対する割合）の向こうは別の品目（左右に並んだ看板・2列のメニュー） */
const MAX_SEGMENT_GAP = 0.2;
/**
 * 周りの文字より大きい（高さが中央値のこの倍以上）文字＝見出しを優先する。大きいほど強く（高さの比−1 に比例）、
 * 上限あり（中央の文字より常に先にはしない）
 */
const HEADING_RATIO = 1.4;
const HEADING_BONUS_PER_RATIO = 0.075;
const MAX_HEADING_BONUS = 0.15;
/** 前回選んだ行を優先する量（位置の揺れで札が入れ替わり続けない） */
const SELECTION_HYSTERESIS = 0.02;

export type OverlaySelectionOptions = {
  maxEntries: number;
  maxTextLength: number;
  minHits: number;
  visibleRegion: NormalizedBox;
  /** 認識した画像の大きさ(px)。あれば画面上の距離で測る（無ければ正規化座標のまま＝従来） */
  imageSize?: Size;
  /** 前回選んだ行の識別子 */
  previousIds?: ReadonlySet<string>;
};

/** 中央からの距離。映像の大きさが分かる時は、横を画面上の比率に直す（縦は従来と同じ値） */
function overlayDistance(box: NormalizedBox, region: NormalizedBox, image: Size | undefined): number {
  const center = boxCenter(box);
  const regionCenter = boxCenter(region);
  const xScale = image != null && image.height > 0 ? image.width / image.height : 1;
  return Math.hypot((center.x - regionCenter.x) * xScale, center.y - regionCenter.y);
}

/** 価格・数字だけの行（訳さない。品目の区切りに使う） */
function isPriceOnlyLine(line: TrackedLine): boolean {
  return /\d/.test(line.text) && stripPriceTokens(line.text) === '';
}

/**
 * 同じ行の左に、同じ品目の別の文字があるか（＝この文字は説明・行の続き）。
 * 間に価格だけの行がある・隙間が大きい時は別の品目なので、先頭として扱う
 */
function isRowFollower(line: TrackedLine, candidates: readonly TrackedLine[], priceLines: readonly TrackedLine[]): boolean {
  return candidates.some((left) => {
    if (left.id === line.id) return false;
    if (verticalOverlapRatio(left.box, line.box) < ROW_OVERLAP) return false;
    const leftRight = boxRight(left.box);
    if (leftRight > line.box.x + 0.01 || line.box.x - leftRight > MAX_SEGMENT_GAP) return false;
    return !priceLines.some(
      (price) =>
        verticalOverlapRatio(price.box, line.box) >= ROW_OVERLAP &&
        price.box.x >= leftRight - 0.005 &&
        boxRight(price.box) <= line.box.x + 0.01,
    );
  });
}

/**
 * 翻訳ページのカメラで、元の文字付近に訳を出す行を選ぶ（中央に近い順を基本に、上の調整を加えて`maxEntries`件まで）。
 * 価格・数字だけの行は除く。
 */
export function selectOverlayLines(tracked: readonly TrackedLine[], options: OverlaySelectionOptions): LiveTextEntry[] {
  const visible = tracked.filter(
    (line) => isStableLine(line, options.minHits) && isBoxInRegion(line.box, options.visibleRegion),
  );
  const priceLines = visible.filter(isPriceOnlyLine);
  const candidates = visible.filter((line) => isTranslatableText(stripPriceTokens(line.text), options.maxTextLength));
  const medianHeight = candidates.length >= 3 ? median(candidates.map((line) => line.box.height)) : null;

  return candidates
    .map((line) => {
      const distance = overlayDistance(line.box, options.visibleRegion, options.imageSize);
      let score = distance;
      if (isRowFollower(line, candidates, priceLines)) score += FOLLOWER_PENALTY;
      if (medianHeight != null && medianHeight > 0 && line.box.height >= medianHeight * HEADING_RATIO) {
        score -= Math.min(MAX_HEADING_BONUS, HEADING_BONUS_PER_RATIO * (line.box.height / medianHeight - 1));
      }
      if (options.previousIds?.has(line.id)) score -= SELECTION_HYSTERESIS;
      return {
        entry: {
          kind: 'text' as const,
          id: line.id,
          text: normalizeRecognizedText(line.text),
          box: line.box,
          centerDistance: distance,
        },
        score,
      };
    })
    .sort((a, b) => a.score - b.score || (a.entry.id < b.entry.id ? -1 : a.entry.id > b.entry.id ? 1 : 0))
    .slice(0, options.maxEntries)
    .map(({ entry }) => entry);
}

// MARK: 訳の札の置き方（2026-11-25 にコンポーネントから切り出し）

export type OverlayLabelInput = { id: string; box: NormalizedBox; translated: string | null };

export type PlacedOverlayLabel = {
  id: string;
  left: number;
  top: number;
  /** 重なり判定に使った札の大きさ（見積もり） */
  width: number;
  height: number;
  /** 札の最大幅（同じ行の右の文字の手前まで）。入りきらない訳は文字を縮める */
  maxWidth: number;
  fontSize: number;
  text: string;
};

/** 訳の札の幅の見積もり（日本語は1文字≒文字の大きさ、英数字はその約0.6倍）。重なり判定にだけ使う */
export function estimateLabelWidth(text: string, fontSize: number): number {
  let width = 0;
  for (const char of text) width += /[\u0000-ɏ]/.test(char) ? fontSize * 0.6 : fontSize;
  return width + 10;
}

/**
 * 元の文字の位置へ訳の札を置く（1行・元の文字の高さに合わせる）。
 * - 渡された順（選んだ順＝優先度の高い順）に置き、先に置いた札と重なる札は省く（下の一覧には全件出る）
 * - 訳が届くまでは出さない（原文の上に同じ原文を重ねて隠さない）
 * - 札の右端は同じ行で右にある文字（説明・価格）の手前まで。和訳は英語より横に長くなりがちで、商品名の札が
 *   説明の札にかかって省かれていた（2026-11-25）。入りきらない訳は折り返さず文字を縮める（呼び出し側）
 */
export function placeOverlayLabels(
  rows: readonly OverlayLabelInput[],
  tracked: readonly TrackedLine[],
  layout: { frameSize: Size; viewSize: Size; occludedBottom: number; minHits: number },
): PlacedOverlayLabel[] {
  const { frameSize, viewSize, occludedBottom } = layout;
  const neighbors = tracked
    .filter((line) => line.hits >= layout.minHits)
    .map((line) => ({ id: line.id, rect: mapBoxToView(line.box, frameSize, viewSize) }));
  const placed: PlacedOverlayLabel[] = [];
  for (const row of rows) {
    if (row.translated == null) continue;
    const rect = mapBoxToView(row.box, frameSize, viewSize);
    const fontSize = Math.min(16, Math.max(10, rect.height * 0.85));
    const labelHeight = fontSize * 1.3 + 2;
    const left = Math.min(Math.max(rect.left - 2, 4), Math.max(4, viewSize.width - 64));
    const top = Math.min(
      Math.max(rect.top + rect.height / 2 - labelHeight / 2, 4),
      Math.max(4, viewSize.height - occludedBottom - labelHeight),
    );
    const centerY = rect.top + rect.height / 2;
    const rightLimit = neighbors
      .filter(
        (other) =>
          other.id !== row.id &&
          other.rect.left >= rect.left + rect.width - 2 &&
          centerY >= other.rect.top &&
          centerY <= other.rect.top + other.rect.height,
      )
      .reduce((limit, other) => Math.min(limit, other.rect.left - 4), viewSize.width - 4);
    const maxWidth = Math.max(64, rightLimit - left);
    const width = Math.min(maxWidth, estimateLabelWidth(row.translated, fontSize));
    const height = labelHeight - 2;
    const overlaps = placed.some(
      (other) => left < other.left + other.width && left + width > other.left && top < other.top + other.height && top + height > other.top,
    );
    if (overlaps) continue;
    placed.push({ id: row.id, left, top, width, height, maxWidth, fontSize, text: row.translated });
  }
  return placed;
}

// MARK: - 翻訳ページの価格・円換算（2026-10-24）
//
// 翻訳ページ（カメラ翻訳・写真翻訳）で、写っている価格に円換算を添えるための判定。
// 価格の抽出そのものは既存の`extractPriceCandidates`（保存の価格OCRと同じ）を呼び出し側から受け取り、
// ここでは「翻訳ページで円換算を出してよい価格か」の絞り込みだけを足す（抽出処理自体は変えない）。
// 翻訳ページは値札だけを狙う価格OCRより価格以外の数字（日付・時刻・量・電話番号）が多く写るため:
// - 日付・時刻・割合・量（g・ml等）の数字は価格として扱わない
// - 旅行の通貨以外の通貨記号・通貨コードがある行は換算しない（€12.00をUSDのレートで換算しない）
// - 抽出値が行内の数字の一部だけの時（"$1,250.00"→1.25）は採らない（誤った円換算より、出さない方を選ぶ）

/** 価格の数値（現地通貨）を返す抽出関数。`extractTranslationPrices`を部分適用したもの */
export type PriceAmountExtractor = (text: string) => number[];

/** 旅行の通貨・レート（1現地通貨あたりの円）。レート未設定は0 */
export type TripPriceConversion<C extends string = string> = { currency: C; rate: number };

/**
 * 翻訳ページで円換算に使う旅行の通貨・レート。保存と同じ`trips.manual_rate`を使い、為替の取得はしない。
 * 旅行が無い・国内（JPY）の旅行ではnull（円換算を出さない）。
 */
export function resolveTripPriceConversion<C extends string>(
  trip: { base_currency: C; manual_rate: number | null | undefined } | null | undefined,
): TripPriceConversion<C> | null {
  if (trip == null || trip.base_currency === 'JPY') return null;
  const rate = trip.manual_rate;
  return {
    currency: trip.base_currency,
    rate: typeof rate === 'number' && Number.isFinite(rate) && rate > 0 ? rate : 0,
  };
}

/** 行に書かれている通貨（記号・単位・通貨コード）。`NT$`は台湾ドルとして`$`より先に見る */
function detectCurrencyMarkers(text: string, tripCurrency: string): Set<string> {
  const found = new Set<string>();
  let rest = text;
  if (/NT\$|\bNTD\b|\bTWD\b|元/i.test(rest)) found.add('TWD');
  rest = rest.replace(/NT\$/gi, ' ');
  if (/US\$|\bUSD\b/i.test(rest)) found.add('USD');
  rest = rest.replace(/US\$/gi, ' ');
  // 台湾では「$120」も台湾ドル（既存の価格OCRのTWDモードと同じ扱い）
  if (rest.includes('$')) found.add(tripCurrency === 'TWD' ? 'TWD' : 'USD');
  if (/€|\bEUR\b/i.test(rest)) found.add('EUR');
  if (/£|\bGBP\b/i.test(rest)) found.add('GBP');
  if (/[₩￦원]|\bKRW\b/i.test(rest)) found.add('KRW');
  if (/[¥￥円]|\bJPY\b/i.test(rest)) found.add('JPY');
  if (/฿|บาท|\bTHB\b|\bbaht\b/i.test(rest)) found.add('THB');
  return found;
}

/** 価格ではない数字（日付・時刻・割合・量・電話番号）を空白に置き換える */
function maskNonPriceNumbers(text: string): string {
  return text
    .replace(/\d{1,4}[./-]\d{1,2}[./-]\d{1,4}/g, ' ')
    .replace(/\d{1,2}\s*:\s*\d{2}(?:\s*:\s*\d{2})?(?:\s*[ap]\.?m\.?)?/gi, ' ')
    .replace(/\d[\d.,]*\s*%/g, ' ')
    .replace(
      /\d[\d.,]*\s*(?:kcal|cal|ml|cl|l|kg|mg|g|oz|lbs?|cm|mm|pcs?|pieces?|servings?|mins?|hrs?)(?![A-Za-z])/gi,
      // 通貨記号の付いた金額は量にしない（"M $5.25 L $6.00"のLはサイズ）
      (match: string, offset: number, whole: string) =>
        /(?:NT\$|US\$|[$€£¥￥₩￦฿])\s*$/.test(whole.slice(0, offset)) ? match : ' ',
    )
    .replace(/\d{2,4}-\d{3,4}-\d{4}/g, ' ');
}

/**
 * 行内の数字のまとまり（"1,250.00"・"4,99"・"18,000"等）が表しうる値。
 * 桁区切りが「,」でも「.」でも読めるよう両方の解釈を返す（形として成り立つものだけ）。
 * 小数部は1〜2桁に限る（区切りの後ろが3桁なら桁区切り。"1,250"を1.25と読まない）。
 */
function numericTokenValues(text: string): number[] {
  const values: number[] = [];
  for (const raw of text.match(/\d[\d.,]*/g) ?? []) {
    const token = raw.replace(/[.,]+$/, '');
    if (/^\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?$/.test(token) || /^\d+(?:\.\d{1,2})?$/.test(token)) {
      values.push(Number(token.replace(/,/g, '')));
    }
    if (/^\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?$/.test(token) || /^\d+,\d{1,2}$/.test(token)) {
      values.push(Number(token.replace(/\./g, '').replace(',', '.')));
    }
  }
  return values;
}

function sameAmount(a: number, b: number): boolean {
  return Math.abs(a - b) < 0.005;
}

/**
 * 小数部が崩れた読み（2026-11-25）。`$5.60`を`$5. 60`・`$5 .60`・`$5.G0`と読むと、抽出は整数部だけの5を返し、
 * 翻訳ページに`$5.00`の円換算が出る。こう読めた行の価格は出さない（誤った円換算より、出さない方を選ぶ）。
 * `$5.6O`（英字のO）は抽出が0と読むので対象外。
 * 普通の文の「1, 2」を弾かないよう、通貨記号の直後か、行が数字だけの時に限る
 */
const BROKEN_DECIMAL_TAIL = String.raw`\d+(?:[.,]\s+\d|\s+[.,]\d|[.,][A-NP-Za-np-z]\d)`;
const BROKEN_DECIMAL = new RegExp(
  String.raw`(?:NT\$|US\$|[$€£¥￥₩￦฿])\s*${BROKEN_DECIMAL_TAIL}|^\s*${BROKEN_DECIMAL_TAIL}[\d\s]*$`,
);

/**
 * 翻訳ページで円換算を添えてよい価格（現地通貨の数値・出現順・重複なし）。
 * `extractPrices`には既存の`extractPriceCandidates`を旅行の通貨で部分適用して渡す。
 */
export function extractTranslationPrices(text: string, tripCurrency: string, extractPrices: PriceExtractor): number[] {
  const markers = detectCurrencyMarkers(text, tripCurrency);
  for (const marker of markers) {
    if (marker !== tripCurrency) return [];
  }
  const masked = maskNonPriceNumbers(text);
  if (!/\d/.test(masked) || BROKEN_DECIMAL.test(masked)) return [];
  const tokenValues = numericTokenValues(masked);
  const amounts: number[] = [];
  for (const candidate of extractPrices(masked)) {
    const amount = Number(candidate);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    if (!tokenValues.some((value) => sameAmount(value, amount))) continue;
    if (amounts.some((existing) => sameAmount(existing, amount))) continue;
    amounts.push(amount);
  }
  return amounts;
}

function hasTranslatableLabel(text: string): boolean {
  return isTranslatableText(stripPriceTokens(text), Number.POSITIVE_INFINITY);
}

function addAmounts(target: number[], amounts: readonly number[]): void {
  for (const amount of amounts) {
    if (!target.some((existing) => sameAmount(existing, amount))) target.push(amount);
  }
}

export type TranslationPriceEntry = {
  /** 価格の行の識別子（Reactのkey用） */
  id: string;
  /** 価格（現地通貨）。1行に複数の価格（S/M/L等）があれば出現順に全て */
  amounts: number[];
  /** 商品名（同じ行の左端の文字、または直上の行）。見つからない・確かでなければnull */
  label: string | null;
  /** 説明（同じ行で商品名と価格の間の文字）。無ければnull */
  description: string | null;
  box: NormalizedBox;
  centerDistance: number;
};

/**
 * 翻訳ページのカメラで、円換算を出す価格を選ぶ（メインカメラの`buildSmartCameraEntries`と同じ組み立て）。
 * 追跡中の行から毎回作り直すため、カメラを動かして見えなくなった価格は追跡の`staleMs`経過で自然に消える。
 */
export function buildTranslationPriceEntries(
  tracked: readonly TrackedLine[],
  extractAmounts: PriceAmountExtractor,
  options: SmartCameraEntryOptions,
): TranslationPriceEntry[] {
  const stable = tracked.filter(
    (line) => isStableLine(line, options.minHits) && isBoxInRegion(line.box, options.visibleRegion),
  );
  const priceLines: { line: TrackedLine; amounts: number[] }[] = [];
  const textLines: TrackedLine[] = [];
  for (const line of stable) {
    const amounts = extractAmounts(line.text);
    if (amounts.length > 0) {
      priceLines.push({ line, amounts });
    } else if (isTranslatableText(stripPriceTokens(line.text), options.maxTextLength)) {
      textLines.push(line);
    }
  }

  const assignments = assignPriceLabels(
    priceLines.map(({ line }) => line),
    textLines,
    options,
  );
  return priceLines
    .map(({ line, amounts }) => {
      const assignment = assignments.get(line.id);
      const box = assignment?.box ?? line.box;
      return {
        id: line.id,
        amounts,
        label: assignment?.label ?? null,
        description: assignment?.description ?? null,
        box,
        centerDistance: distanceFromRegionCenter(box, options.visibleRegion),
      };
    })
    .sort((a, b) => a.centerDistance - b.centerDistance)
    .slice(0, options.maxEntries);
}

export type PhotoPriceBlock = { original: string; box?: NormalizedBox | null };

export type PhotoBlockPrices = {
  /** この段落に添える価格（自分の価格＋結び付けた「価格だけの段落」の価格。重複なし） */
  amounts: number[];
  /** 価格だけの段落（訳す文字が無い） */
  priceOnly: boolean;
  /** 商品名の段落へ結び付けたため、単独の行としては出さない「価格だけの段落」の結び付け先 */
  mergedInto: number | null;
};

/**
 * 写真翻訳の段落ごとに、円換算を添える価格を決める（段落の並び・原文・翻訳には触れない）。
 *
 * 「価格だけの段落」は、商品名の段落との対応が位置から一意に決まる時だけその段落へ結び付ける:
 * 1. 同じ高さで左にある、いちばん近い商品名（間に別の価格が無いこと）＝「商品名 …… 価格」型のメニュー
 * 2. 1が無い時、すぐ上にある商品名がちょうど1つ＝「商品名／価格」型の値札
 * 対応が分からない価格は、無理に結び付けず単独の行として円換算を出す。
 */
export function annotatePhotoBlockPrices(
  blocks: readonly PhotoPriceBlock[],
  extractAmounts: PriceAmountExtractor,
): PhotoBlockPrices[] {
  const own = blocks.map((block) => extractAmounts(block.original));
  const priceOnly = blocks.map((block, index) => own[index].length > 0 && !hasTranslatableLabel(block.original));
  const result: PhotoBlockPrices[] = blocks.map((_, index) => ({
    amounts: [...own[index]],
    priceOnly: priceOnly[index],
    mergedInto: null,
  }));

  const isLabel = (index: number) =>
    own[index].length === 0 && blocks[index].box != null && hasTranslatableLabel(blocks[index].original);

  blocks.forEach((block, index) => {
    const priceBox = block.box;
    if (!priceOnly[index] || priceBox == null) return;

    // 1. 同じ高さで左にある、いちばん近い商品名
    let target: number | null = null;
    let labelBox: NormalizedBox | null = null;
    let bestGap = Infinity;
    for (let candidateIndex = 0; candidateIndex < blocks.length; candidateIndex += 1) {
      const box = blocks[candidateIndex].box;
      if (!isLabel(candidateIndex) || box == null) continue;
      if (verticalOverlapRatio(box, priceBox) < 0.5) continue;
      const right = box.x + box.width;
      if (right > priceBox.x + 0.02) continue;
      const gap = priceBox.x - right;
      if (gap <= 0.6 && gap < bestGap) {
        bestGap = gap;
        target = candidateIndex;
        labelBox = box;
      }
    }
    if (labelBox != null) {
      const left = labelBox.x + labelBox.width;
      // 間に別の価格があれば、その価格の商品名かもしれないので結び付けない
      const blocked = blocks.some((other, otherIndex) => {
        const box = other.box;
        if (otherIndex === index || own[otherIndex].length === 0 || box == null) return false;
        return (
          verticalOverlapRatio(box, priceBox) >= 0.5 &&
          box.x >= left - 0.02 &&
          box.x + box.width <= priceBox.x + 0.02
        );
      });
      if (blocked) target = null;
    } else {
      // 2. すぐ上にある商品名がちょうど1つ
      const maxGap = Math.max(priceBox.height * 1.5, 0.02);
      const above = blocks
        .map((candidate, candidateIndex) => ({ candidate, candidateIndex }))
        .filter(({ candidate, candidateIndex }) => {
          const box = candidate.box;
          if (!isLabel(candidateIndex) || box == null) return false;
          const gap = priceBox.y - (box.y + box.height);
          if (gap < -priceBox.height * 0.3 || gap > maxGap) return false;
          return horizontalOverlap(box, priceBox) > 0 || Math.abs(box.x - priceBox.x) <= 0.1;
        });
      if (above.length === 1) target = above[0].candidateIndex;
    }

    if (target == null) return;
    result[index].mergedInto = target;
    addAmounts(result[target].amounts, own[index]);
  });

  return result;
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
