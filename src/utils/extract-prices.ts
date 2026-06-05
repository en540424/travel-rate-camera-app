/**
 * OCRテキストから価格候補を抽出する
 * （スコアリング・優先順位付けなし。全候補をOCR出現順で返す）
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
