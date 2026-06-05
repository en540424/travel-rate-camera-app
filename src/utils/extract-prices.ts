/**
 * OCRテキストから価格候補を抽出し、キーワード文脈でスコアリングする
 *
 * HIGH → recommended（おすすめ）
 * NORMAL / LOW → others（その他）
 */

const HIGH_KEYWORDS = [
  'PRICE AT REGISTER',
  'ROLLBACK',
  'SALE PRICE',
  'SALE',
  'NOW',
  'OUR PRICE',
  'YOUR PRICE',
];

const LOW_KEYWORDS = [
  'WAS',
  'RETAIL',
  'REGULAR',
  'COMPARE',
  'SAVINGS',
  'SAVE',
  'PER UNIT',
  'EACH',
  'DISCOUNT',
  'REG ',
];

type PriceScore = 'high' | 'normal' | 'low';

function scorePrice(upperText: string, matchIndex: number): PriceScore {
  // マッチ位置の前後テキストでキーワード検索
  const context = upperText.slice(Math.max(0, matchIndex - 150), matchIndex + 60);
  for (const kw of HIGH_KEYWORDS) {
    if (context.includes(kw)) return 'high';
  }
  for (const kw of LOW_KEYWORDS) {
    if (context.includes(kw)) return 'low';
  }
  return 'normal';
}

export interface PriceCandidates {
  /** キーワード文脈からおすすめと判定した価格（high スコア） */
  recommended: string[];
  /** 判定保留・低優先の価格（normal + low スコア） */
  others: string[];
}

export function extractPriceCandidates(text: string): PriceCandidates {
  const upper = text.toUpperCase();
  const seen = new Set<string>();
  const scored: { value: string; score: PriceScore; idx: number }[] = [];

  function add(numStr: string, idx: number) {
    const n = parseFloat(numStr.replace(',', '.'));
    if (!isFinite(n) || n <= 0 || n >= 10000) return;
    const key = n.toFixed(2);
    if (!seen.has(key)) {
      seen.add(key);
      scored.push({ value: key, score: scorePrice(upper, idx), idx });
    }
  }

  // Pass 1: $XX, $XX.XX, $X,XXX.XX（通貨記号付き優先）
  const dollarRe = /\$\s*(\d{1,4}(?:[.,]\d{1,2})?)/g;
  let m: RegExpExecArray | null;
  while ((m = dollarRe.exec(text)) !== null) add(m[1], m.index);

  // Pass 2: XX.XX（小数2桁、整数部1〜3桁）
  const decRe = /\b(\d{1,3}\.\d{2})\b/g;
  while ((m = decRe.exec(text)) !== null) add(m[1], m.index);

  // high → normal → low → OCR出現順（安定ソート）
  const ORDER: Record<PriceScore, number> = { high: 0, normal: 1, low: 2 };
  scored.sort((a, b) => ORDER[a.score] - ORDER[b.score] || a.idx - b.idx);

  return {
    recommended: scored.filter((p) => p.score === 'high').map((p) => p.value),
    others: scored.filter((p) => p.score !== 'high').map((p) => p.value),
  };
}
