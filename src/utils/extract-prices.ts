/**
 * OCRテキストから価格候補を抽出する
 *
 * 抽出ルール:
 * - Pass1: $XX.XX など通貨記号付き（優先）
 * - Pass2: XX.XX など小数2桁（1〜3桁の整数部）
 * - 0以下・10000以上は除外（商品番号・大きな数値を弾く）
 * - 重複は除外（先に見つかった方を優先）
 */
export function extractPriceCandidates(text: string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  function add(raw: string) {
    const n = parseFloat(raw.replace(',', '.'));
    if (!isFinite(n) || n <= 0 || n >= 10000) return;
    const key = n.toFixed(2);
    if (!seen.has(key)) {
      seen.add(key);
      result.push(key);
    }
  }

  // Pass 1: $XX, $XX.XX, $X,XXX.XX (通貨記号付き)
  const dollarRe = /\$\s*(\d{1,4}(?:[.,]\d{1,2})?)/g;
  let m: RegExpExecArray | null;
  while ((m = dollarRe.exec(text)) !== null) {
    add(m[1]);
  }

  // Pass 2: XX.XX (小数2桁、整数部1〜3桁)
  const decRe = /\b(\d{1,3}\.\d{2})\b/g;
  while ((m = decRe.exec(text)) !== null) {
    add(m[1]);
  }

  return result;
}
