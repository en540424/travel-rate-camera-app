/**
 * メニューの言い回しの訳直し（英語→日本語）。カメラ・写真に写った短い行の訳にだけ使う純粋ロジック。
 *
 * **import 0件**（`node --test`から直接読み込んで検証する）。
 *
 * なぜ必要か（2026-11-25）:
 * 翻訳は端末内のApple Translationで、1行ずつ単独で訳す。Appleの翻訳APIには文脈・分野・用語集を渡す口が無い
 * （`TranslationSession.Request`は原文と識別子だけ。公式ドキュメントで確認）。そのため飲食店のメニューの
 * 決まった言い回しが直訳になる（実機：Rich and bold coffee →「濃厚で大胆なコーヒー」、Squeezed daily →「毎日絞る」）。
 *
 * 守ること:
 * - 1つの規則は「原文にその英語がある」かつ「訳にその直訳がある」時だけ働く。原文に無い意味は足さない
 * - 規則は実機で確認した直訳と、それと同じ形の言い回しに限る。テスト用のメニューの行を丸ごと差し替えない
 * - 英語→日本語・短い行（カメラで1行として読んだ文字）だけ。長い段落（写真翻訳の文章）には使わない
 * - 新しい翻訳サービス・外部APIは使わない
 */

type MenuTermRule = {
  /** 原文にこの英語がある時だけ */
  source: RegExp;
  /** さらに原文にこの語（料理・飲み物の文脈）がある時だけ */
  context?: RegExp;
  /** 原文にこの語がある時は使わない */
  unless?: RegExp;
  /** 訳のこの直訳を */
  from: RegExp;
  /** この言い方へ */
  to: string;
};

const DRINK_CONTEXT = /\b(?:coffee|espresso|roast|blend|brew|latte|americano|cappuccino|flavou?r|taste)\b/i;

/** 上から順に当てる（具体的な言い回しを先に） */
const RULES: readonly MenuTermRule[] = [
  // Espresso with hot water（アメリカーノの説明）：「ホットウォーターでエスプレッソ」→ お湯で割ったエスプレッソ
  {
    source: /\bespresso with hot water\b/i,
    from: /(?:ホットウォーター|お湯)でエスプレッソ/g,
    to: 'エスプレッソのお湯割り',
  },
  // hot water ＝ お湯
  { source: /\bhot water\b/i, from: /ホットウォーター/g, to: 'お湯' },
  // bold（コーヒーの味）＝ 大胆 ではなく、しっかりした味わい
  { source: /\bbold\b/i, context: DRINK_CONTEXT, from: /大胆な/g, to: 'しっかりした味わいの' },
  // strong（コーヒー・紅茶）＝ 濃い
  { source: /\bstrong\b/i, context: /\b(?:coffee|espresso|tea|brew)\b/i, from: /強い/g, to: '濃い' },
  // black coffee ＝ ブラックコーヒー
  { source: /\bblack coffee\b/i, from: /黒い\s*コーヒー/g, to: 'ブラックコーヒー' },
  // smooth（コーヒーの口当たり）＝ まろやか
  { source: /\bsmooth\b/i, context: DRINK_CONTEXT, unless: /\bcreamy\b/i, from: /クリーミー(?:な)?/g, to: 'まろやかな' },
  // steamed milk ＝ スチームミルク（「蒸しミルク」「蒸した牛乳」は直訳）
  { source: /\bsteamed milk\b/i, from: /蒸し(?:た)?(?:ミルク|牛乳)/g, to: 'スチームミルク' },
  // squeezed daily ＝ 毎日搾りたて
  { source: /\bsqueezed\b/i, context: /\bdaily\b/i, from: /毎日(?:絞|搾)る/g, to: '毎日搾りたて' },
  // squeezed（果汁）＝ 搾る（「絞る」は布などを絞る字）
  { source: /\bsqueezed\b/i, from: /絞/g, to: '搾' },
  // flaky（パイ・クロワッサン）＝ サクサク
  { source: /\bflaky\b/i, from: /カリカリ(?:した|の)/g, to: 'サクサクの' },
];

/** 訳直しを使う原文の最大文字数（カメラで1行として読む長さ。長い段落には使わない） */
const MAX_SOURCE_LENGTH = 80;

function baseLanguage(code: string): string {
  return code.split(/[-_]/)[0].toLowerCase();
}

/**
 * 端末内翻訳の訳を、メニューの言い方へ直す。当てはまる規則が無ければ訳をそのまま返す。
 */
export function polishMenuTranslation(
  sourceText: string,
  translatedText: string,
  sourceLanguage: string,
  targetLanguage: string,
): string {
  if (baseLanguage(sourceLanguage) !== 'en' || baseLanguage(targetLanguage) !== 'ja') return translatedText;
  if (sourceText.length > MAX_SOURCE_LENGTH || translatedText === '') return translatedText;
  let result = translatedText;
  for (const rule of RULES) {
    if (!rule.source.test(sourceText)) continue;
    if (rule.context != null && !rule.context.test(sourceText)) continue;
    if (rule.unless != null && rule.unless.test(sourceText)) continue;
    result = result.replace(rule.from, rule.to);
  }
  return result;
}
