/**
 * OCRテキストから価格候補・メモ候補行を抽出する
 */

export function extractPriceCandidates(text: string): string[] {
  const norm = text.toUpperCase().replace(/\s+/g, ' ');
  const seen = new Set<string>();
  const results: { value: string; idx: number }[] = [];

  function add(numStr: string, idx: number) {
    const n = parseFloat(numStr.replace(',', '.'));
    if (!isFinite(n) || n <= 0 || n >= 10000) return;
    const key = n.toFixed(2);
    if (!seen.has(key)) {
      seen.add(key);
      results.push({ value: key, idx });
    }
  }

  // Pass 1: $XX.XX など通貨記号付き（優先）
  const dollarRe = /\$\s*(\d{1,4}(?:[.,]\d{1,2})?)/g;
  let m: RegExpExecArray | null;
  while ((m = dollarRe.exec(norm)) !== null) add(m[1], m.index);

  // Pass 2: XX.XX（小数2桁）
  const decRe = /\b(\d{1,3}\.\d{2})\b/g;
  while ((m = decRe.exec(norm)) !== null) add(m[1], m.index);

  // OCR出現順
  results.sort((a, b) => a.idx - b.idx);
  return results.map((r) => r.value);
}

/**
 * OCRテキストから商品名メモ候補行を抽出する
 *
 * 除外: 価格行・バーコード数字・3文字未満・50文字超
 * ソート: 英字比率が高い行（商品名らしい）を上位に
 */
export function extractMemoLines(text: string): string[] {
  // 行単体が価格パターン（$7.99 / 7.99 など）
  const PRICE_LINE = /^(\$\s*)?\d{1,4}([.,]\d{1,2})?$/;
  // バーコード / 6桁以上の連続数字
  const BARCODE = /^\d{6,}$/;
  // 行内に価格パターンを含む（$7.99, 10.99 など）
  const CONTAINS_PRICE = /\$\s*\d|\b\d{1,3}\.\d{2}\b/;

  const seen = new Set<string>();
  const candidates: { line: string; score: number }[] = [];

  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line.length < 3 || line.length > 50) continue;
    if (PRICE_LINE.test(line)) continue;
    if (BARCODE.test(line)) continue;
    if (CONTAINS_PRICE.test(line)) continue;

    const key = line.toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);

    const letters = (line.match(/[A-Za-z]/g) || []).length;
    const ratio = letters / line.length;
    // 英字比率でスコア: 0=商品名らしい、1=混在、2=数字多め
    const score = ratio > 0.7 ? 0 : ratio > 0.3 ? 1 : 2;
    candidates.push({ line, score });
  }

  // スコア昇順（同スコアは出現順を維持）
  candidates.sort((a, b) => a.score - b.score);
  return candidates.slice(0, 8).map((c) => c.line);
}
