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

export interface PriceCandidates {
  /** キーワード文脈からおすすめと判定した価格（high スコア） */
  recommended: string[];
  /** 判定保留・低優先の価格（normal + low スコア） */
  others: string[];
}

export function extractPriceCandidates(text: string): PriceCandidates {
  // テキスト全体を最初に正規化（大文字化 + 空白・改行を単一スペースに統一）
  // これにより "PRICE\nAT\nREGISTER" → "PRICE AT REGISTER" となりキーワードマッチが確実に動く
  const norm = text.toUpperCase().replace(/\s+/g, ' ');

  const seen = new Set<string>();
  const scored: { value: string; score: PriceScore; idx: number }[] = [];

  function scoreAtIndex(idx: number): PriceScore {
    const ctx = norm.slice(Math.max(0, idx - 200), idx + 200);
    for (const kw of HIGH_KEYWORDS) if (ctx.includes(kw)) return 'high';
    for (const kw of LOW_KEYWORDS) if (ctx.includes(kw)) return 'low';
    return 'normal';
  }

  function add(numStr: string, idx: number) {
    const n = parseFloat(numStr.replace(',', '.'));
    if (!isFinite(n) || n <= 0 || n >= 10000) return;
    const key = n.toFixed(2);
    if (!seen.has(key)) {
      seen.add(key);
      scored.push({ value: key, score: scoreAtIndex(idx), idx });
    }
  }

  // 正規化済みテキスト上で正規表現を実行（インデックスのズレなし）
  const dollarRe = /\$\s*(\d{1,4}(?:[.,]\d{1,2})?)/g;
  let m: RegExpExecArray | null;
  while ((m = dollarRe.exec(norm)) !== null) add(m[1], m.index);

  const decRe = /\b(\d{1,3}\.\d{2})\b/g;
  while ((m = decRe.exec(norm)) !== null) add(m[1], m.index);

  const ORDER: Record<PriceScore, number> = { high: 0, normal: 1, low: 2 };
  scored.sort((a, b) => ORDER[a.score] - ORDER[b.score] || a.idx - b.idx);

  console.log(
    '[extractPrices v4]',
    scored.map((p) => `${p.value}=${p.score}`).join(', '),
  );

  return {
    recommended: scored.filter((p) => p.score === 'high').map((p) => p.value),
    others: scored.filter((p) => p.score !== 'high').map((p) => p.value),
  };
}
