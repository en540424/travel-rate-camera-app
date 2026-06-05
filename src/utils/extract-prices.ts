/**
 * OCRテキストから価格候補・メモ候補行を抽出する
 */

/**
 * 外貨モード（デフォルト）: $XX.XX / XX.XX の小数価格を抽出
 * JPYモード: ¥298 / 298円 / 1,280円 などの整数円価格を抽出
 */
export function extractPriceCandidates(text: string, isJpyMode: boolean = false): string[] {
  if (isJpyMode) return extractJpyPriceCandidates(text);

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

/** JPYモード専用: 整数円価格を抽出（小数は一切扱わない） */
function extractJpyPriceCandidates(text: string): string[] {
  const seen = new Set<string>();
  const results: { value: string; idx: number }[] = [];

  function addJpy(numStr: string, idx: number) {
    const n = parseInt(numStr.replace(/,/g, ''), 10);
    if (!isFinite(n) || n <= 0 || n > 999999) return;
    const key = String(n);
    if (!seen.has(key)) {
      seen.add(key);
      results.push({ value: key, idx });
    }
  }

  let m: RegExpExecArray | null;

  // Priority 1: ¥/￥ + 整数（¥298, ¥1,280）
  const yenRe = /[¥￥]\s*(\d{1,3}(?:,\d{3})*|\d{1,6})/g;
  while ((m = yenRe.exec(text)) !== null) addJpy(m[1], m.index);

  // Priority 2: 整数 + 円（298円, 1,280円）
  const enRe = /(\d{1,3}(?:,\d{3})*|\d{1,6})円/g;
  while ((m = enRe.exec(text)) !== null) addJpy(m[1], m.index);

  // Priority 3: 税込/税抜/価格/値段 + 整数
  const taxRe = /(?:税込|税抜|税別|価格|値段)\s*[¥￥]?\s*(\d{1,3}(?:,\d{3})*|\d{1,6})/g;
  while ((m = taxRe.exec(text)) !== null) addJpy(m[1], m.index);

  // Priority 4: 文脈なし整数（行単位でノイズ除外）
  const LONG_DIGITS = /\d{7,}/;          // バーコード・JAN（7桁以上）
  const DATE_PATTERN = /\d{4}[\/\-\.]\d{1,2}[\/\-\.]\d{1,2}|\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}/;
  const PHONE_PATTERN = /\d{2,4}-\d{2,4}-\d{4}/;
  const HAS_DECIMAL = /\d+\.\d+/;        // 小数を含む行は除外

  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (LONG_DIGITS.test(line)) continue;
    if (DATE_PATTERN.test(line)) continue;
    if (PHONE_PATTERN.test(line)) continue;
    if (HAS_DECIMAL.test(line)) continue;

    const plainRe = /\b(\d{2,6})\b/g;
    while ((m = plainRe.exec(line)) !== null) {
      const n = parseInt(m[1], 10);
      if (n < 10 || n > 99999) continue;
      // ¥/円なし文脈での西暦年を除外
      if (n >= 1900 && n <= 2099) continue;
      addJpy(m[1], m.index);
    }
  }

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
