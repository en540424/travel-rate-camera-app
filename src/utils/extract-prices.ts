/**
 * OCRテキストから価格候補・メモ候補行を抽出する
 */

// 開発ビルドでのみ出力する診断ログ。本番では何もしない（P0-06）。
// 呼び出し箇所・引数・ロジックは変更せず、console.log の宛先だけをこの関数に差し替える。
function dbg(...args: unknown[]): void {
  if (__DEV__) {
    console.log(...args);
  }
}

/**
 * currency に応じて抽出戦略を切り替える
 * - 'JPY': ¥298 / 298円 / 1,280円 などの整数円価格
 * - 'KRW': ₩2,000 / 2,000원 / W 2,000 などの整数ウォン価格
 * - 'EUR': €4.99 / 4,99€ / 4.\n99 などの小数ユーロ価格
 * - 'THB': ฿120 / 120 บาท / 1,200 などの整数バーツ価格
 * - 'TWD': NT$120 / 120元 / TWD 120 などの整数台湾ドル価格
 * - 'GBP': £4.99 / 4,99 GBP / 4/99 などの小数ポンド価格
 * - その他(デフォルト): $XX.XX / XX.XX の小数価格（USD特化）
 */
export function extractPriceCandidates(text: string, currency: string = 'USD'): string[] {
  // [診断ログ] OCR候補抽出前 — リリース前に削除
  dbg('[OCR Candidate Input]', JSON.stringify(text.substring(0, 300)));

  if (currency === 'JPY') {
    const r = extractJpyPriceCandidates(text);
    dbg('[OCR Amount Candidates] JPYモード:', r);
    if (r.length === 0) dbg('[OCR Candidate Empty] JPYモード — 数字あり:', /\d/.test(text));
    return r;
  }

  if (currency === 'KRW') {
    const r = extractKrwPriceCandidates(text);
    dbg('[OCR Amount Candidates] KRWモード:', r);
    if (r.length === 0) dbg('[OCR Candidate Empty] KRWモード — 数字あり:', /\d/.test(text));
    return r;
  }

  if (currency === 'THB') {
    // [THB診断] THB分岐確認 — リリース前に削除
    dbg('[THB OCR Branch] THB分岐に入りました / text.length:', text.length);
    const r = extractThbPriceCandidates(text);
    dbg('[THB OCR Candidates] candidates:', r, '/ count:', r.length);
    dbg('[OCR Amount Candidates] THBモード:', r);
    if (r.length === 0) dbg('[OCR Candidate Empty] THBモード — 数字あり:', /\d/.test(text));
    return r;
  }

  if (currency === 'TWD') {
    // [TWD診断] TWD分岐確認 — リリース前に削除
    dbg('[TWD OCR Branch] TWD分岐に入りました / text.length:', text.length);
    const r = extractTwdPriceCandidates(text);
    dbg('[TWD OCR Candidates] candidates:', r, '/ count:', r.length);
    dbg('[OCR Amount Candidates] TWDモード:', r);
    if (r.length === 0) dbg('[OCR Candidate Empty] TWDモード — 数字あり:', /\d/.test(text));
    return r;
  }

  if (currency === 'GBP') {
    // [GBP診断] GBP分岐確認 — リリース前に削除
    dbg('[GBP OCR Branch] GBP分岐に入りました / text.length:', text.length);
    const r = extractGbpPriceCandidates(text);
    dbg('[GBP OCR Candidates] candidates:', r, '/ count:', r.length);
    dbg('[OCR Amount Candidates] GBPモード:', r);
    if (r.length === 0) dbg('[OCR Candidate Empty] GBPモード — 数字あり:', /\d/.test(text));
    return r;
  }

  if (currency === 'EUR') {
    // [EUR診断] EUR分岐確認 — リリース前に削除
    dbg('[EUR OCR Branch] EUR分岐に入りました / text.length:', text.length, '/ currency:', currency);
    const r = extractEurPriceCandidates(text);
    dbg('[EUR OCR Candidates] candidates:', r, '/ count:', r.length);
    dbg('[OCR Amount Candidates] EURモード:', r);
    if (r.length === 0) dbg('[OCR Candidate Empty] EURモード — 数字あり:', /\d/.test(text));
    return r;
  }

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
  const out = results.map((r) => r.value);
  dbg('[OCR Amount Candidates] FOREIGNモード(USD特化):', out);
  if (out.length === 0) {
    dbg('[OCR Candidate Empty] FOREIGNモード — 数字あり:', /\d/.test(text), '/ テキスト長:', text.length);
  }
  return out;
}

/** KRWモード専用: 整数ウォン価格を抽出 */
function extractKrwPriceCandidates(text: string): string[] {
  const seen = new Set<string>();
  const results: { value: string; idx: number }[] = [];

  function addKrw(numStr: string, idx: number) {
    const n = parseInt(numStr.replace(/,/g, ''), 10);
    if (!isFinite(n) || n < 10 || n > 9_999_999) return;
    const key = String(n);
    if (!seen.has(key)) {
      seen.add(key);
      results.push({ value: key, idx });
    }
  }

  let m: RegExpExecArray | null;

  // Priority 1: ₩ + 整数（₩2,000 / ₩ 2,000）— \s*を改行なし空白に限定
  const wonSignRe = /₩[ \t]*(\d{1,3}(?:,\d{3})*|\d{1,7})/g;
  while ((m = wonSignRe.exec(text)) !== null) addKrw(m[1], m.index);

  // Priority 2: 整数 + 원（2,000원 / 2000원）
  const wonWordRe = /(\d{1,3}(?:,\d{3})*|\d{1,7})원/g;
  while ((m = wonWordRe.exec(text)) !== null) addKrw(m[1], m.index);

  // Priority 3: 원 + 整数（원 2,000）— 改行またぎを防ぐため水平空白のみ
  const wonPrefixRe = /원[ \t]*(\d{1,3}(?:,\d{3})*|\d{1,7})/g;
  while ((m = wonPrefixRe.exec(text)) !== null) addKrw(m[1], m.index);

  // Priority 4: W + 整数 / KRW + 整数（W 2,000 / KRW 12,900）
  const wRe = /\bW[ \t]*(\d{1,3}(?:,\d{3})*|\d{1,7})/gi;
  while ((m = wRe.exec(text)) !== null) addKrw(m[1], m.index);

  const krwRe = /\bKRW\s*(\d{1,3}(?:,\d{3})+|\d{1,7}(?!\d))/gi;
  while ((m = krwRe.exec(text)) !== null) addKrw(m[1], m.index);

  // P4.5・P5共通ガード（カンマ整数フォールバックと裸整数フォールバックの両方で使用）
  const LONG_DIGITS     = /\d{7,}/;
  const DATE_PATTERN    = /\d{4}[\/\-\.]\d{1,2}[\/\-\.]\d{1,2}|\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}/;
  const PHONE_PATTERN   = /\d{2,4}-\d{2,4}-\d{4}/;
  const HAS_DECIMAL     = /\d+\.\d+/;
  const URL_LINE        = /https?:\/\/|\bwww\./i;
  const DOMAIN_LINE     = /\b\w+\.(com|net|org|kr|co)\b/i;
  const IMAGE_SIZE      = /\d+\s*[xX×]\s*\d+/;
  const FILENAME_LINE   = /\b(?:IMG|DSC|DCIM|DSCF|Screenshot|photo)[_\-]\d+\b|\.\b(?:png|jpe?g|gif|webp|heic|bmp)\b/i;
  const HAS_PERCENT     = /%/;
  const UNIT_MEASURE    = /\b\d+(?:\.\d+)?\s*(?:cal|kcal|g|kg|ml|l|oz|lb)\b/i;
  const HAS_ALPHA       = /[A-Za-z]/;
  // 商品コード・管理番号のラベル（SKU 123,456 等）。P4.5専用: 英字が同居していても
  // 「PORK BAKE 4,900」のような商品名＋価格（₩記号がOCRで欠落したケース）は救済したいが、
  // 商品コードのラベル付き数字は price として拾わない（extractMemoLinesのCODE_LABELと同じ考え方）。
  const CODE_LABEL      = /\b(?:SKU|ITEM\s*NO\.?|ITEM\s*NUMBER|PRODUCT\s*CODE|BARCODE)\b.{0,12}\d/i;

  // Priority 4.5: カンマ区切り整数（₩/원なし文脈でも拾う。例: 12,900 / 100,000）
  // 行単位でP5相当のガードを適用（kcal・栄養成分・日付・電話番号・商品コード等の非価格数字を除外）。
  // HAS_ALPHAは使わない: ₩記号がOCRで欠落し、同じ行に英字の商品名/キャプション（PORK BAKE等）が
  // 同居しているケースを価格として救済するため。英字ラベル付き商品コードのみCODE_LABELで個別に除外する。
  // KRW_MARKER_LINEは適用しない（\d{1,3},\d{3}自体を含むため、この段の対象行を自己除外してしまう）
  const commaIntRe = /\b(\d{1,3}(?:,\d{3})+)\b/g;
  for (const raw45 of text.split('\n')) {
    const line45 = raw45.trim();
    if (!line45) continue;
    if (LONG_DIGITS.test(line45))   continue;
    if (DATE_PATTERN.test(line45))  continue;
    if (PHONE_PATTERN.test(line45)) continue;
    if (HAS_DECIMAL.test(line45))   continue;
    if (URL_LINE.test(line45))      continue;
    if (DOMAIN_LINE.test(line45))   continue;
    if (IMAGE_SIZE.test(line45))    continue;
    if (FILENAME_LINE.test(line45)) continue;
    if (HAS_PERCENT.test(line45))   continue;
    if (UNIT_MEASURE.test(line45))  continue;
    if (CODE_LABEL.test(line45))    continue;

    while ((m = commaIntRe.exec(line45)) !== null) {
      const n = parseInt(m[1].replace(/,/g, ''), 10);
      if (n > 999_999) continue; // "1,223,803 results" 等の検索件数ノイズを除外
      addKrw(m[1], m.index);
    }
  }

  // Priority 5: 文脈なし整数フォールバック（行単位でノイズ除外）
  // KRW記号またはカンマ整数がある行は P1–4.5 で処理済みのためスキップ
  const KRW_MARKER_LINE = /[₩원]|\bW\b|\bKRW\b|\d{1,3},\d{3}/i;
  const STANDALONE_YEAR = /^(19|20)\d{2}$/;

  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (KRW_MARKER_LINE.test(line))  continue;
    if (LONG_DIGITS.test(line))      continue;
    if (DATE_PATTERN.test(line))     continue;
    if (PHONE_PATTERN.test(line))    continue;
    if (HAS_DECIMAL.test(line))      continue;
    if (URL_LINE.test(line))         continue;
    if (DOMAIN_LINE.test(line))      continue;
    if (IMAGE_SIZE.test(line))       continue;
    if (FILENAME_LINE.test(line))    continue;
    if (HAS_PERCENT.test(line))      continue;
    if (UNIT_MEASURE.test(line))     continue;
    if (HAS_ALPHA.test(line))        continue;
    if (STANDALONE_YEAR.test(line))  continue;

    const plainRe = /\b(\d{2,7})\b/g;
    while ((m = plainRe.exec(line)) !== null) {
      const n = parseInt(m[1], 10);
      if (n < 100 || n > 999_999) continue; // フォールバック専用: 100〜999999
      addKrw(m[1], m.index);
    }
  }

  results.sort((a, b) => a.idx - b.idx);
  return results.map((r) => r.value);
}

/** THBモード専用: タイバーツ整数価格を抽出
 *  ฿120 / 120 บาท / 1,200 / 120.- / 120.00 などに対応
 */
function extractThbPriceCandidates(text: string): string[] {
  const seen = new Set<string>();
  const results: { value: string; idx: number }[] = [];

  function addThb(numStr: string, idx: number) {
    const s = numStr.replace(/,/g, '').replace(/\.-$/, '');
    const n = parseFloat(s);
    if (!isFinite(n) || n < 1 || n > 999999) return;
    const key = String(Math.round(n));
    if (!seen.has(key)) {
      seen.add(key);
      results.push({ value: key, idx });
    }
  }

  let m: RegExpExecArray | null;

  // P1-P5 共通数値パターン（2択構造）:
  //   alt1: カンマ区切り整数 + オプション小数/.- (1,200 / 1,200.00)
  //   alt2: プレーン整数（最大6桁）+ オプション小数/.-。7桁以上は (?!\d) で不一致。
  // 例: 120 / 1200 / 999999 / 120.00 / 120.-

  // P1: ฿ prefix — ฿120 / ฿ 120 / ฿1,200 / ฿999999
  const bathPfxRe = /฿[ \t]*(\d{1,3}(?:,\d{3})+(?:\.\d{1,2}|\.-)?|\d{1,6}(?:\.\d{1,2}|\.-)?(?!\d))/g;
  while ((m = bathPfxRe.exec(text)) !== null) addThb(m[1], m.index);

  // P2: ฿ suffix — 120฿ / 1,200฿
  const bathSfxRe = /(\d{1,3}(?:,\d{3})+(?:\.\d{1,2}|\.-)?|\d{1,6}(?:\.\d{1,2}|\.-)?(?!\d))\s*฿/g;
  while ((m = bathSfxRe.exec(text)) !== null) addThb(m[1], m.index);

  // P3: THB keyword — THB 120 / 120 THB / BAHT 1200
  const thbPfxRe = /\bTHB[ \t]+(\d{1,3}(?:,\d{3})+(?:\.\d{1,2}|\.-)?|\d{1,6}(?:\.\d{1,2}|\.-)?(?!\d))/gi;
  while ((m = thbPfxRe.exec(text)) !== null) addThb(m[1], m.index);
  const thbSfxRe = /(\d{1,3}(?:,\d{3})+(?:\.\d{1,2}|\.-)?|\d{1,6}(?:\.\d{1,2}|\.-)?(?!\d))\s+THB\b/gi;
  while ((m = thbSfxRe.exec(text)) !== null) addThb(m[1], m.index);

  // P4: Baht keyword — Baht 120 / 120 Baht
  const bahtPfxRe = /\bBaht[ \t]+(\d{1,3}(?:,\d{3})+(?:\.\d{1,2}|\.-)?|\d{1,6}(?:\.\d{1,2}|\.-)?(?!\d))/gi;
  while ((m = bahtPfxRe.exec(text)) !== null) addThb(m[1], m.index);
  const bahtSfxRe = /(\d{1,3}(?:,\d{3})+(?:\.\d{1,2}|\.-)?|\d{1,6}(?:\.\d{1,2}|\.-)?(?!\d))\s+Baht\b/gi;
  while ((m = bahtSfxRe.exec(text)) !== null) addThb(m[1], m.index);

  // P5: บาท keyword — 120 บาท / 1,200 บาท
  const batThaiRe = /(\d{1,3}(?:,\d{3})+(?:\.\d{1,2}|\.-)?|\d{1,6}(?:\.\d{1,2}|\.-)?(?!\d))\s*บาท/g;
  while ((m = batThaiRe.exec(text)) !== null) addThb(m[1], m.index);

  // [THB診断] P1-P5 中間結果 — リリース前に削除
  if (results.length > 0) {
    dbg('[THB OCR Match] P1-P5 matched:', results.map((r) => r.value));
  } else {
    dbg('[THB OCR Match] P1-P5: no matches (฿/THB/Baht/บาท marker なし)');
  }

  // P6-P7 共通ノイズフィルター
  const HAS_OTHER_CURR = /[$¥₩￥€]|\b(?:KRW|JPY|USD|EUR|TWD|GBP)\b/i;
  const LONG_DIGITS    = /\d{7,}/;
  const DATE_PATTERN   = /\d{4}[\/\-\.]\d{1,2}[\/\-\.]\d{1,2}|\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}/;
  const PHONE_PATTERN  = /\d{2,4}-\d{2,4}-\d{4}/;
  const HAS_UNIT       = /\b\d+(?:\.\d+)?\s*(?:cal|kcal|g|kg|ml|liter|litre|grams?|oz|lb)\b/i;
  const HAS_PCT        = /%/;
  const HAS_DECIMAL    = /\d+\.\d/;
  // P7専用: KRW/JPYの文脈なしフォールバックは最小値100で時刻断片(10:35等)を自然に除外できるが、
  // THB/TWDは少額の裸価格（10バーツ等）まで拾う必要があるため最小値を下げられない。
  // そのため時刻パターンだけは明示的に行ごと除外する。
  const TIME_PATTERN   = /\b\d{1,2}:\d{2}\b/;
  // KRW/JPYの文脈なしフォールバックと同じガード。英字を含む行（250 kcal, SKU 123456等）は
  // 裸数字フォールバックの対象から外す（正式なマーカー付き価格はP1-P5で先に処理済みのため、
  // ここに到達する時点でこのガードの影響を受けない）。
  const HAS_ALPHA      = /[A-Za-z]/;

  // P6: カンマ区切り整数フォールバック（行単位でノイズ除外）— ฿/THB/Baht/บาท なし
  const P6_THB_MARKER = /[฿]|\bTHB\b|\bBaht\b|บาท/i;
  for (const raw6 of text.split('\n')) {
    const line6 = raw6.trim();
    if (!line6) continue;
    if (P6_THB_MARKER.test(line6))  continue;  // P1-P5 で処理済み
    if (HAS_OTHER_CURR.test(line6)) continue;
    if (LONG_DIGITS.test(line6))    continue;
    if (HAS_UNIT.test(line6))       continue;
    if (HAS_PCT.test(line6))        continue;
    const commaRe = /\b(\d{1,3}(?:,\d{3})+)\b/g;
    while ((m = commaRe.exec(line6)) !== null) addThb(m[1], m.index);
  }

  // P7: 文脈なし整数フォールバック（THBモード限定）
  // マーカー行チェック（THB_MARKER_LINE等）がHAS_ALPHAより先にあるため、
  // 「THB 120」のように英字を含む正式なマーカー付き価格行はここへ到達する前に除外される
  // （＝HAS_ALPHA追加で壊れない）。
  const THB_MARKER_LINE = /[฿]|\bTHB\b|\bBaht\b|บาท|\d{1,3},\d{3}/i;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (THB_MARKER_LINE.test(line))  continue;
    if (HAS_OTHER_CURR.test(line))   continue;
    if (LONG_DIGITS.test(line))      continue;
    if (DATE_PATTERN.test(line))     continue;
    if (PHONE_PATTERN.test(line))    continue;
    if (HAS_UNIT.test(line))         continue;
    if (HAS_PCT.test(line))          continue;
    if (HAS_DECIMAL.test(line))      continue;
    if (TIME_PATTERN.test(line))     continue;
    if (HAS_ALPHA.test(line))        continue;

    const plainRe = /\b(\d{1,6})\b/g;
    while ((m = plainRe.exec(line)) !== null) {
      const n = parseInt(m[1], 10);
      if (n < 1 || n > 999999) continue;
      if (n >= 1900 && n <= 2099) continue;
      addThb(m[1], m.index);
    }
  }

  results.sort((a, b) => a.idx - b.idx);
  return results.map((r) => r.value);
}

/** TWDモード専用: 台湾ドル整数価格を抽出
 *  NT$120 / 120元 / TWD 120 / $120(TWDモード限定) などに対応
 */
function extractTwdPriceCandidates(text: string): string[] {
  const seen = new Set<string>();
  const results: { value: string; idx: number }[] = [];

  function addTwd(numStr: string, idx: number) {
    const s = numStr.replace(/,/g, '').replace(/\.-$/, '');
    const n = parseFloat(s);
    if (!isFinite(n) || n < 1 || n > 999999) return;
    const key = String(Math.round(n));
    if (!seen.has(key)) {
      seen.add(key);
      results.push({ value: key, idx });
    }
  }

  let m: RegExpExecArray | null;

  // P1-P5 共通数値パターン（2択構造）:
  //   alt1: カンマ区切り整数 + オプション小数/.- (1,200 / 1,200.00)
  //   alt2: プレーン整数（最大6桁）。7桁以上は (?!\d) で不一致。

  // P1: NT$ prefix — NT$120 / NT$ 120 / NT$1,200
  const ntdPfxRe = /NT\$[ \t]*(\d{1,3}(?:,\d{3})+(?:\.\d{1,2}|\.-)?|\d{1,6}(?:\.\d{1,2}|\.-)?(?!\d))/g;
  while ((m = ntdPfxRe.exec(text)) !== null) addTwd(m[1], m.index);

  // P2: TWD keyword — TWD 120 / 120 TWD
  const twdPfxRe = /\bTWD[ \t]+(\d{1,3}(?:,\d{3})+(?:\.\d{1,2}|\.-)?|\d{1,6}(?:\.\d{1,2}|\.-)?(?!\d))/gi;
  while ((m = twdPfxRe.exec(text)) !== null) addTwd(m[1], m.index);
  const twdSfxRe = /(\d{1,3}(?:,\d{3})+(?:\.\d{1,2}|\.-)?|\d{1,6}(?:\.\d{1,2}|\.-)?(?!\d))\s+TWD\b/gi;
  while ((m = twdSfxRe.exec(text)) !== null) addTwd(m[1], m.index);

  // P3: NTD keyword — NTD 120 / 120 NTD
  const ntdKwPfxRe = /\bNTD[ \t]+(\d{1,3}(?:,\d{3})+(?:\.\d{1,2}|\.-)?|\d{1,6}(?:\.\d{1,2}|\.-)?(?!\d))/gi;
  while ((m = ntdKwPfxRe.exec(text)) !== null) addTwd(m[1], m.index);
  const ntdKwSfxRe = /(\d{1,3}(?:,\d{3})+(?:\.\d{1,2}|\.-)?|\d{1,6}(?:\.\d{1,2}|\.-)?(?!\d))\s+NTD\b/gi;
  while ((m = ntdKwSfxRe.exec(text)) !== null) addTwd(m[1], m.index);

  // P4: $ prefix（TWDモード限定）— $120 / $1,200
  const dollarPfxRe = /\$[ \t]*(\d{1,3}(?:,\d{3})+(?:\.\d{1,2}|\.-)?|\d{1,6}(?:\.\d{1,2}|\.-)?(?!\d))/g;
  while ((m = dollarPfxRe.exec(text)) !== null) addTwd(m[1], m.index);

  // P5: 元 suffix / prefix — 120元 / 元120 / 1,200元
  const yuanSfxRe = /(\d{1,3}(?:,\d{3})+(?:\.\d{1,2}|\.-)?|\d{1,6}(?:\.\d{1,2}|\.-)?(?!\d))\s*元/g;
  while ((m = yuanSfxRe.exec(text)) !== null) addTwd(m[1], m.index);
  const yuanPfxRe = /元[ \t]*(\d{1,3}(?:,\d{3})+(?:\.\d{1,2}|\.-)?|\d{1,6}(?:\.\d{1,2}|\.-)?(?!\d))/g;
  while ((m = yuanPfxRe.exec(text)) !== null) addTwd(m[1], m.index);

  // [TWD診断] P1-P5 中間結果 — リリース前に削除
  if (results.length > 0) {
    dbg('[TWD OCR Match] P1-P5 matched:', results.map((r) => r.value));
  } else {
    dbg('[TWD OCR Match] P1-P5: no matches (NT$/TWD/NTD/$/元 marker なし)');
  }

  // P6-P7 共通ノイズフィルター
  // HAS_OTHER_CURR: $ はTWDとして扱うため除外しない。USDキーワードは除外。
  const HAS_OTHER_CURR = /[¥₩￥€฿]|\b(?:KRW|JPY|USD|EUR|THB|GBP)\b/i;
  const LONG_DIGITS    = /\d{7,}/;
  const DATE_PATTERN   = /\d{4}[\/\-\.]\d{1,2}[\/\-\.]\d{1,2}|\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}/;
  const PHONE_PATTERN  = /\d{2,4}-\d{2,4}-\d{4}/;
  const HAS_UNIT       = /\b\d+(?:\.\d+)?\s*(?:cal|kcal|g|kg|ml|liter|litre|grams?|oz|lb)\b/i;
  const HAS_PCT        = /%/;
  const HAS_DECIMAL    = /\d+\.\d/;
  // P7専用: KRW/JPYの文脈なしフォールバックは最小値100で時刻断片(10:35等)を自然に除外できるが、
  // TWDは少額の裸価格（10元等）まで拾う必要があるため最小値を下げられない。
  // そのため時刻パターンだけは明示的に行ごと除外する。
  const TIME_PATTERN   = /\b\d{1,2}:\d{2}\b/;
  // KRW/JPYの文脈なしフォールバックと同じガード。英字を含む行（250 kcal, SKU 123456等）は
  // 裸数字フォールバックの対象から外す（正式なマーカー付き価格はP1-P5で先に処理済みのため、
  // ここに到達する時点でこのガードの影響を受けない）。
  const HAS_ALPHA      = /[A-Za-z]/;

  // P6: カンマ区切り整数フォールバック（行単位でノイズ除外）— NT$/TWD/NTD/$/元 なし
  const P6_TWD_MARKER = /NT\$|\bTWD\b|\bNTD\b|\$|元/i;
  for (const raw6 of text.split('\n')) {
    const line6 = raw6.trim();
    if (!line6) continue;
    if (P6_TWD_MARKER.test(line6))  continue;  // P1-P5 で処理済み
    if (HAS_OTHER_CURR.test(line6)) continue;
    if (LONG_DIGITS.test(line6))    continue;
    if (HAS_UNIT.test(line6))       continue;
    if (HAS_PCT.test(line6))        continue;
    const commaRe = /\b(\d{1,3}(?:,\d{3})+)\b/g;
    while ((m = commaRe.exec(line6)) !== null) addTwd(m[1], m.index);
  }

  // P7: 文脈なし整数フォールバック（TWDモード限定）
  // マーカー行チェック（TWD_MARKER_LINE等）がHAS_ALPHAより先にあるため、
  // 「TWD 120」のように英字を含む正式なマーカー付き価格行はここへ到達する前に除外される
  // （＝HAS_ALPHA追加で壊れない）。
  const TWD_MARKER_LINE = /NT\$|\bTWD\b|\bNTD\b|\$|元|\d{1,3},\d{3}/i;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (TWD_MARKER_LINE.test(line))  continue;
    if (HAS_OTHER_CURR.test(line))   continue;
    if (LONG_DIGITS.test(line))      continue;
    if (DATE_PATTERN.test(line))     continue;
    if (PHONE_PATTERN.test(line))    continue;
    if (HAS_UNIT.test(line))         continue;
    if (HAS_PCT.test(line))          continue;
    if (HAS_DECIMAL.test(line))      continue;
    if (TIME_PATTERN.test(line))     continue;
    if (HAS_ALPHA.test(line))        continue;

    const plainRe = /\b(\d{1,6})\b/g;
    while ((m = plainRe.exec(line)) !== null) {
      const n = parseInt(m[1], 10);
      if (n < 1 || n > 999999) continue;
      if (n >= 1900 && n <= 2099) continue;
      addTwd(m[1], m.index);
    }
  }

  results.sort((a, b) => a.idx - b.idx);
  return results.map((r) => r.value);
}

/** GBPモード専用: 小数ポンド価格を抽出
 *  £1.99 / 1.99 GBP / 4/99(OCR崩れ) / 1 99(OCR崩れ) / £1,299 などに対応
 */
function extractGbpPriceCandidates(text: string): string[] {
  const seen = new Set<string>();
  const results: { value: string; idx: number }[] = [];

  function addGbp(numStr: string, idx: number) {
    const s = numStr.replace(/[ \t]/g, '');
    let n: number;
    // カンマ千区切り: 1,299 / 1,299.99
    if (/^\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?$/.test(s)) {
      n = parseFloat(s.replace(/,/g, ''));
    } else {
      n = parseFloat(s.replace(',', '.'));
    }
    if (!isFinite(n) || n <= 0 || n > 9999.99) return;
    const key = n.toFixed(2);
    if (!seen.has(key)) {
      seen.add(key);
      results.push({ value: key, idx });
    }
  }

  // GBP数値パターン共通:
  //   Alt1: カンマ千区切り + オプション小数 (1,299 / 1,299.99)
  //   Alt2: 小数ドット (1.99 / 9.99)
  //   Alt3: 整数 (%直後は除外)

  let m: RegExpExecArray | null;

  // P1: £ prefix — £1.99 / £ 1.99 / £1,299
  const gbpPfxRe =
    /£[ \t]*(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+\.\d{1,2}|\d+\b(?!\s*%))/g;
  while ((m = gbpPfxRe.exec(text)) !== null) addGbp(m[1], m.index);

  // P2: £ suffix — 1.99£ / 9.99 £
  const gbpSfxRe =
    /(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+\.\d{1,2}|\d+\b(?!\s*%))[ \t]*£/g;
  while ((m = gbpSfxRe.exec(text)) !== null) addGbp(m[1], m.index);

  // P3: GBP suffix — 1.99 GBP
  const gbpCodeSfxRe =
    /(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+\.\d{1,2}|\d+\b(?!\s*%))[ \t]+GBP\b/gi;
  while ((m = gbpCodeSfxRe.exec(text)) !== null) addGbp(m[1], m.index);

  // P4: GBP prefix — GBP 1.99
  const gbpCodePfxRe =
    /\bGBP[ \t]+(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+\.\d{1,2}|\d+\b(?!\s*%))/gi;
  while ((m = gbpCodePfxRe.exec(text)) !== null) addGbp(m[1], m.index);

  // [GBP診断] P1-P4 中間結果 — リリース前に削除
  if (results.length > 0) {
    dbg('[GBP OCR Match] P1-P4 matched:', results.map((r) => r.value));
  } else {
    dbg('[GBP OCR Match] P1-P4: no matches (£/GBP marker なし)');
  }

  // 共通フィルタ
  const GBP_MARKER_LINE    = /[£]|\bGBP\b/i;
  const HAS_OTHER_CURRENCY = /[$¥₩￥€฿]|\b(?:KRW|JPY|USD|EUR|THB|TWD)\b/i;
  const P5_LONG_DIGITS     = /\d{8,}/;
  const P5_DATE_PATTERN    =
    /\d{4}[\/\-\.]\d{1,2}[\/\-\.]\d{1,2}|\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}/;
  const P5_PHONE_PATTERN   = /\d{2,4}-\d{2,4}-\d{4}/;
  const HAS_ALPHA          = /[A-Za-z]/;
  const HAS_PCT            = /%/;

  // P5: 文脈なし小数＋カンマ整数フォールバック (£/GBP欠落ケース)
  // グローバルオフセットを追跡して P1-P4 の結果と正しく並べ替えられるようにする
  let p5TextOffset = 0;
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    const trimLeading = line.length > 0 ? rawLine.indexOf(line[0]) : 0;
    if (line) {
      if (!GBP_MARKER_LINE.test(line) && !HAS_OTHER_CURRENCY.test(line) &&
          !P5_LONG_DIGITS.test(line) && !P5_DATE_PATTERN.test(line) && !P5_PHONE_PATTERN.test(line)) {
        // 小数価格: 4.99 / 9.99
        const decRe = /\b(\d{1,4}\.\d{2})\b(?!\s*%)/g;
        while ((m = decRe.exec(line)) !== null) {
          const intPart = parseInt(m[1], 10);
          if (intPart >= 1900 && intPart <= 2099) continue;
          addGbp(m[1], p5TextOffset + trimLeading + m.index);
        }
        // カンマ整数: 1,299
        const commaRe = /\b(\d{1,3}(?:,\d{3})+)\b/g;
        while ((m = commaRe.exec(line)) !== null) addGbp(m[1], p5TextOffset + trimLeading + m.index);
      }
    }
    p5TextOffset += rawLine.length + 1;
  }

  // P6: 空白小数 OCR崩れ — "1 99" / "12 50" 形式 (EUR P6 と同じ)
  const P6_SPACE_DEC = /^(\d{1,3})\s+(\d{2})$/;
  for (const rawLine6 of text.split('\n')) {
    const line6 = rawLine6.trim();
    if (!line6) continue;
    if (HAS_PCT.test(line6))   continue;
    if (HAS_ALPHA.test(line6)) continue;
    if (P5_LONG_DIGITS.test(line6)) continue;
    const pm = P6_SPACE_DEC.exec(line6);
    if (!pm) continue;
    const intPart6 = parseInt(pm[1], 10);
    if (intPart6 >= 1900 && intPart6 <= 2099) continue;
    addGbp(pm[1] + '.' + pm[2], 0);
  }

  // P7: スラッシュ小数 OCR崩れ — "4/99" / "4 / 99" / "4. / 99"
  // UK値札で小数点がスラッシュとしてOCR出力されるケース
  const P7_SLASH_DEC = /^(\d{1,3})\.?[ \t]*\/[ \t]*(\d{2})$/;
  for (const rawLine7 of text.split('\n')) {
    const line7 = rawLine7.trim();
    if (!line7) continue;
    if (HAS_PCT.test(line7))   continue;
    if (HAS_ALPHA.test(line7)) continue;
    const pm7 = P7_SLASH_DEC.exec(line7);
    if (!pm7) continue;
    const intPart7 = parseInt(pm7[1], 10);
    if (intPart7 >= 1900 && intPart7 <= 2099) continue;
    addGbp(pm7[1] + '.' + pm7[2], 0);
  }

  // P8: 行またぎ小数 — "4.\n99" / "1,\n99" → 4.99 (EUR P7 相当)
  const P8_INT_DEC = /^(\d{1,3})[.,]$/;
  const P8_FRAC    = /^(\d{2})$/;
  const p8Lines = text.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
  for (let i = 0; i < p8Lines.length - 1; i++) {
    const lineA = p8Lines[i];
    if (HAS_PCT.test(lineA) || HAS_ALPHA.test(lineA)) continue;
    const mA = P8_INT_DEC.exec(lineA);
    if (!mA) continue;
    const lineB = p8Lines[i + 1];
    if (HAS_PCT.test(lineB) || HAS_ALPHA.test(lineB)) continue;
    const mB = P8_FRAC.exec(lineB);
    if (!mB) continue;
    addGbp(mA[1] + '.' + mB[1], 0);
  }

  // P9: 完全分離 — "4\n99" → 4.99 (EUR P8 相当)
  const P9_INT  = /^(\d{1,2})$/;
  const P9_FRAC = /^(\d{2})$/;
  const p9Lines = text.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
  for (let i = 0; i < p9Lines.length - 1; i++) {
    const lineA = p9Lines[i];
    const mA = P9_INT.exec(lineA);
    if (!mA) continue;
    const lineB = p9Lines[i + 1];
    const mB = P9_FRAC.exec(lineB);
    if (!mB) continue;
    addGbp(mA[1] + '.' + mB[1], 0);
  }

  // P10: 文脈なし整数フォールバック（GBPモード限定）
  // 英字を含む行は除外し、3–4桁の整数のみ候補化
  // (1–2桁はOCR崩れパターンの構成要素として誤検知リスクが高いため除外)
  for (const rawLineI of text.split('\n')) {
    const lineI = rawLineI.trim();
    if (!lineI) continue;
    if (GBP_MARKER_LINE.test(lineI))       continue; // P1-P4 で処理済み
    if (HAS_PCT.test(lineI))               continue;
    if (HAS_ALPHA.test(lineI))             continue;
    if (P5_LONG_DIGITS.test(lineI))        continue;
    if (P5_DATE_PATTERN.test(lineI))       continue;
    if (P5_PHONE_PATTERN.test(lineI))      continue;
    if (/\d+\.\d/.test(lineI))             continue; // 小数行はP5で処理済み
    if (/\d{1,3}(?:,\d{3})+/.test(lineI)) continue; // カンマ整数行はP5で処理済み
    const intRe = /\b(\d{3,4})\b/g;
    while ((m = intRe.exec(lineI)) !== null) {
      const n = parseInt(m[1], 10);
      if (n <= 0 || n > 9999) continue;
      if (n >= 1900 && n <= 2099) continue;
      addGbp(m[1], m.index);
    }
  }

  results.sort((a, b) => a.idx - b.idx);
  return results.map((r) => r.value);
}

/** EURモード専用: 小数ユーロ価格を抽出
 *  小数ドット (4.99) / 小数カンマ (4,99) / 欧州桁区切り (1.234,56) に対応
 */
function extractEurPriceCandidates(text: string): string[] {
  const seen = new Set<string>();
  const results: { value: string; idx: number }[] = [];

  function addEur(numStr: string, idx: number) {
    let n: number;
    // OCR崩れの空白を除去してから解析（例: "4, 99" → "4,99"）
    const s = numStr.replace(/[ \t]/g, '');
    // 欧州式桁区切り: 1.234,56 → 1234.56
    if (/^\d{1,3}(?:\.\d{3})+,\d{1,2}$/.test(s)) {
      n = parseFloat(s.replace(/\./g, '').replace(',', '.'));
    } else {
      // 小数カンマ (4,99→4.99) / 小数ドット (4.99) / 整数 (12)
      n = parseFloat(s.replace(',', '.'));
    }
    if (!isFinite(n) || n <= 0 || n > 9999.99) return;
    const key = n.toFixed(2);
    if (!seen.has(key)) {
      seen.add(key);
      results.push({ value: key, idx });
    }
  }

  let m: RegExpExecArray | null;

  // EUR数値パターン（改行またぎ防止）
  // Alt1: 欧州桁区切り (1.234,56)
  // Alt2: 小数（カンマ/ドット周囲のOCR崩れスペース許容: 4,99 / 4, 99 / 4.99 / 4. 99）
  // Alt3: 整数 (12)。ただし 25% のようなパーセント表記は除外

  // Priority 1: € prefix（€4.99 / €4,99 / € 4, 99 / €1.234,56）
  const eurPfxRe = /€[ \t]*(\d{1,3}(?:\.\d{3})+,\d{1,2}|\d+[ \t]*[.,][ \t]*\d{1,2}|\d+\b(?!\s*%))/g;
  while ((m = eurPfxRe.exec(text)) !== null) addEur(m[1], m.index);

  // Priority 2: € suffix（4.99€ / 4,99€ / 4, 99€ / 4, 99 €）
  const eurSfxRe = /(\d{1,3}(?:\.\d{3})+,\d{1,2}|\d+[ \t]*[.,][ \t]*\d{1,2}|\d+\b(?!\s*%))[ \t]*€/g;
  while ((m = eurSfxRe.exec(text)) !== null) addEur(m[1], m.index);

  // Priority 3: EUR suffix（4.99 EUR / 4,99 EUR / 4, 99 EUR）
  const eurCodeSfxRe = /(\d{1,3}(?:\.\d{3})+,\d{1,2}|\d+[ \t]*[.,][ \t]*\d{1,2}|\d+\b(?!\s*%))[ \t]+EUR\b/gi;
  while ((m = eurCodeSfxRe.exec(text)) !== null) addEur(m[1], m.index);

  // Priority 4: EUR prefix（EUR 4.99 / EUR 4,99 / EUR 4, 99）
  const eurCodePfxRe = /\bEUR[ \t]+(\d{1,3}(?:\.\d{3})+,\d{1,2}|\d+[ \t]*[.,][ \t]*\d{1,2}|\d+\b(?!\s*%))/gi;
  while ((m = eurCodePfxRe.exec(text)) !== null) addEur(m[1], m.index);

  // [EUR診断] P1-P4 中間結果 — リリース前に削除
  if (results.length > 0) {
    dbg('[EUR OCR Match] P1-P4 matched:', results.map((r) => r.value));
  } else {
    dbg('[EUR OCR Match] P1-P4: no matches (€/EUR marker なし or なし)');
  }

  // Priority 5: 文脈なし小数（€/EUR記号が OCR で欠落した場合のフォールバック）
  // €/EUR がある行は P1–P4 で処理済みのためスキップ
  const EUR_MARKER_LINE = /[€]|\bEUR\b/i;
  const HAS_OTHER_CURRENCY = /[$¥₩￥]|\b(?:KRW|JPY|USD|TWD|THB|GBP)\b/i;
  const P5_LONG_DIGITS = /\d{8,}/;
  const P5_DATE_PATTERN = /\d{4}[\/\-\.]\d{1,2}[\/\-\.]\d{1,2}|\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}/;
  const P5_PHONE_PATTERN = /\d{2,4}-\d{2,4}-\d{4}/;

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    const lineShort = line.substring(0, 50);
    if (EUR_MARKER_LINE.test(line)) {
      dbg('[EUR OCR P5] skip(€/EUR marker):', lineShort); continue;
    }
    if (HAS_OTHER_CURRENCY.test(line)) {
      dbg('[EUR OCR P5] skip(other currency):', lineShort); continue;
    }
    if (P5_LONG_DIGITS.test(line)) {
      dbg('[EUR OCR P5] skip(long digits/barcode):', lineShort); continue;
    }
    if (P5_DATE_PATTERN.test(line)) {
      dbg('[EUR OCR P5] skip(date pattern):', lineShort); continue;
    }
    if (P5_PHONE_PATTERN.test(line)) {
      dbg('[EUR OCR P5] skip(phone pattern):', lineShort); continue;
    }

    // XX.XX または XX,XX（小数2桁のみ・%直後は除外）
    const decRe = /\b(\d{1,4}[.,]\d{2})\b(?!\s*%)/g;
    while ((m = decRe.exec(line)) !== null) {
      const intPart = parseInt(m[1], 10);
      if (intPart >= 1900 && intPart <= 2099) {
        dbg('[EUR OCR P5] skip(year filter):', m[1], '/ line:', lineShort);
        continue;
      }
      dbg('[EUR OCR P5] match:', m[1], '/ line:', lineShort);
      addEur(m[1], m.index);
    }
  }

  // P6: OCR空白小数フォールバック（"1 99" / "12 50" 形式）
  // 区切り文字が空白として出力されるOCR崩れ専用。行全体一致で誤爆を最小化。
  const P6_HAS_PCT    = /%/;
  const P6_HAS_ALPHA  = /[A-Za-z]/;
  const P6_LONG_DIGS  = /\d{6,}/;
  const P6_SPACE_DEC  = /^(\d{1,3})\s+(\d{2})$/;

  for (const rawLine6 of text.split('\n')) {
    const line6 = rawLine6.trim();
    if (!line6) continue;
    if (P6_HAS_PCT.test(line6))   continue;
    if (P6_HAS_ALPHA.test(line6)) continue;
    if (P6_LONG_DIGS.test(line6)) continue;
    const pm = P6_SPACE_DEC.exec(line6);
    if (!pm) continue;
    const intPart6 = parseInt(pm[1], 10);
    if (intPart6 >= 1900 && intPart6 <= 2099) continue;
    const numStr6 = pm[1] + '.' + pm[2];
    dbg('[EUR OCR P6] match:', numStr6, '/ line:', line6);
    addEur(numStr6, 0);
  }

  // P7: EUR OCR行またぎ小数フォールバック（"4.\n15" / "1,\n99" → 4.15 / 1.99）
  // 小数区切りが改行を跨いでOCR出力された場合の対応。
  const P7_INT_DEC   = /^(\d{1,3})[.,]$/;  // "4." / "12," etc.
  const P7_FRAC      = /^(\d{2})$/;          // "15" / "99" etc.
  const P7_HAS_PCT   = /%/;
  const P7_HAS_ALPHA = /[A-Za-z]/;

  const p7Lines = text.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
  for (let i = 0; i < p7Lines.length - 1; i++) {
    const lineA = p7Lines[i];
    if (P7_HAS_PCT.test(lineA) || P7_HAS_ALPHA.test(lineA)) continue;
    const mA = P7_INT_DEC.exec(lineA);
    if (!mA) continue;
    const lineB = p7Lines[i + 1];
    if (P7_HAS_PCT.test(lineB))   { dbg('[EUR OCR P7] skip(% in next):', lineA, '/', lineB); continue; }
    if (P7_HAS_ALPHA.test(lineB)) { dbg('[EUR OCR P7] skip(alpha in next):', lineA, '/', lineB); continue; }
    const mB = P7_FRAC.exec(lineB);
    if (!mB) { dbg('[EUR OCR P7] skip(next not 2-digit):', lineA, '/', lineB); continue; }
    const numStr7 = mA[1] + '.' + mB[1];
    dbg('[EUR OCR P7] match line', i, '+', i + 1, ':', lineA, '/', lineB, '->', numStr7);
    addEur(numStr7, 0);
  }

  // P8: EUR OCR整数・小数完全分離行フォールバック（"1\n99" / "4\n15" → 1.99 / 4.15）
  // 整数部と小数部が記号なしで完全に別行に分裂したOCR崩れ専用。
  // ^\d{1,2}$ / ^\d{2}$ のアンカーにより、英字・記号・% を含む行は regex 上マッチしない。
  const P8_INT  = /^(\d{1,2})$/;
  const P8_FRAC = /^(\d{2})$/;

  const p8Lines = text.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
  for (let i = 0; i < p8Lines.length - 1; i++) {
    const lineA = p8Lines[i];
    const mA = P8_INT.exec(lineA);
    if (!mA) continue;
    const lineB = p8Lines[i + 1];
    const mB = P8_FRAC.exec(lineB);
    if (!mB) { dbg('[EUR OCR P8] skip(next not 2-digit):', lineA, '/', lineB); continue; }
    const numStr8 = mA[1] + '.' + mB[1];
    dbg('[EUR OCR P8] match line', i, '+', i + 1, ':', lineA, '/', lineB, '->', numStr8);
    addEur(numStr8, 0);
  }

  results.sort((a, b) => a.idx - b.idx);
  return results.map((r) => r.value);
}

/** JPYモード専用: 整数円価格を抽出（小数は一切扱わない） */
function extractJpyPriceCandidates(text: string): string[] {
  const seen = new Set<string>();
  const results: { value: string; idx: number }[] = [];

  function addJpy(numStr: string, idx: number) {
    const n = parseInt(numStr.replace(/,/g, ''), 10);
    if (!isFinite(n) || n < 10 || n > 9_999_999) return;
    const key = String(n);
    if (!seen.has(key)) {
      seen.add(key);
      results.push({ value: key, idx });
    }
  }

  let m: RegExpExecArray | null;

  // Priority 1: ¥/￥ + 整数（¥298 / ¥1,280）— 改行またぎ防止
  const yenRe = /[¥￥][ \t]*(\d{1,3}(?:,\d{3})*|\d{1,7})/g;
  while ((m = yenRe.exec(text)) !== null) addJpy(m[1], m.index);

  // Priority 2: 整数 + 円（298円 / 1,280円）
  const enRe = /(\d{1,3}(?:,\d{3})*|\d{1,7})円/g;
  while ((m = enRe.exec(text)) !== null) addJpy(m[1], m.index);

  // Priority 3: 円 + 整数（円 1,980）— 改行またぎ防止
  const enPrefixRe = /円[ \t]*(\d{1,3}(?:,\d{3})*|\d{1,7})/g;
  while ((m = enPrefixRe.exec(text)) !== null) addJpy(m[1], m.index);

  // Priority 4: JPY + 整数（JPY 12,800）
  const jpyRe = /\bJPY[ \t]*(\d{1,3}(?:,\d{3})+|\d{1,7}(?!\d))/gi;
  while ((m = jpyRe.exec(text)) !== null) addJpy(m[1], m.index);

  // Priority 5: 税込/税抜/価格/値段 + 整数
  const taxRe = /(?:税込|税抜|税別|価格|値段)[ \t]*[¥￥]?[ \t]*(\d{1,3}(?:,\d{3})*|\d{1,7})/g;
  while ((m = taxRe.exec(text)) !== null) addJpy(m[1], m.index);

  // P5.5・P6共通ガード（カンマ整数フォールバックと裸整数フォールバックの両方で使用）
  const LONG_DIGITS     = /\d{7,}/;
  const DATE_PATTERN    = /\d{4}[\/\-\.]\d{1,2}[\/\-\.]\d{1,2}|\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}/;
  const PHONE_PATTERN   = /\d{2,4}-\d{2,4}-\d{4}/;
  const HAS_DECIMAL     = /\d+\.\d+/;
  const URL_LINE        = /https?:\/\/|\bwww\./i;
  const DOMAIN_LINE     = /\b\w+\.(com|net|org|jp|co)\b/i;
  const IMAGE_SIZE      = /\d+\s*[xX×]\s*\d+/;
  const FILENAME_LINE   = /\b(?:IMG|DSC|DCIM|DSCF|Screenshot|photo)[_\-]\d+\b|\.\b(?:png|jpe?g|gif|webp|heic|bmp)\b/i;
  const HAS_PERCENT     = /%/;
  const UNIT_MEASURE    = /\b\d+(?:\.\d+)?\s*(?:cal|kcal|g|kg|ml|l|oz|lb)\b/i;
  const HAS_ALPHA       = /[A-Za-z]/;
  // 商品コード・管理番号のラベル（SKU 1,234 等）。P5.5専用: KRW P4.5と同じ理由で、
  // ¥記号がOCRで欠落し英字の商品名/キャプションと同居する価格を救済するため、
  // HAS_ALPHAではなくCODE_LABELで商品コードだけを個別に除外する。
  const CODE_LABEL      = /\b(?:SKU|ITEM\s*NO\.?|ITEM\s*NUMBER|PRODUCT\s*CODE|BARCODE)\b.{0,12}\d/i;

  // Priority 5.5: カンマ区切り整数（¥/円なし文脈でも拾う）
  // 行単位でP6相当のガードを適用（kcal・栄養成分・日付・電話番号・商品コード等の非価格数字を除外）。
  // HAS_ALPHAは使わない（KRW P4.5と同じ理由）。
  // JPY_MARKER_LINEは適用しない（\d{1,3},\d{3}自体を含むため、この段の対象行を自己除外してしまう）
  const commaIntRe = /\b(\d{1,3}(?:,\d{3})+)\b/g;
  for (const raw55 of text.split('\n')) {
    const line55 = raw55.trim();
    if (!line55) continue;
    if (LONG_DIGITS.test(line55))   continue;
    if (DATE_PATTERN.test(line55))  continue;
    if (PHONE_PATTERN.test(line55)) continue;
    if (HAS_DECIMAL.test(line55))   continue;
    if (URL_LINE.test(line55))      continue;
    if (DOMAIN_LINE.test(line55))   continue;
    if (IMAGE_SIZE.test(line55))    continue;
    if (FILENAME_LINE.test(line55)) continue;
    if (HAS_PERCENT.test(line55))   continue;
    if (UNIT_MEASURE.test(line55))  continue;
    if (CODE_LABEL.test(line55))    continue;

    while ((m = commaIntRe.exec(line55)) !== null) {
      const n = parseInt(m[1].replace(/,/g, ''), 10);
      if (n > 999_999) continue; // "1,223,803 results" 等の検索件数ノイズを除外
      addJpy(m[1], m.index);
    }
  }

  // Priority 6: 文脈なし整数フォールバック（行単位でノイズ除外）
  // JPY記号またはカンマ整数がある行は P1–5.5 で処理済みのためスキップ
  const JPY_MARKER_LINE = /[¥￥円]|\bJPY\b|\d{1,3},\d{3}/i;
  const STANDALONE_YEAR = /^(19|20)\d{2}$/;

  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (JPY_MARKER_LINE.test(line)) continue;
    if (LONG_DIGITS.test(line))     continue;
    if (DATE_PATTERN.test(line))    continue;
    if (PHONE_PATTERN.test(line))   continue;
    if (HAS_DECIMAL.test(line))     continue;
    if (URL_LINE.test(line))        continue;
    if (DOMAIN_LINE.test(line))     continue;
    if (IMAGE_SIZE.test(line))      continue;
    if (FILENAME_LINE.test(line))   continue;
    if (HAS_PERCENT.test(line))     continue;
    if (UNIT_MEASURE.test(line))    continue;
    if (HAS_ALPHA.test(line))       continue;
    if (STANDALONE_YEAR.test(line)) continue;

    const plainRe = /\b(\d{2,7})\b/g;
    while ((m = plainRe.exec(line)) !== null) {
      const n = parseInt(m[1], 10);
      if (n < 100 || n > 999_999) continue; // フォールバック専用: 100〜999999
      addJpy(m[1], m.index);
    }
  }

  results.sort((a, b) => a.idx - b.idx);
  return results.map((r) => r.value);
}

/**
 * OCRテキストから商品名メモ候補行を抽出する
 *
 * 除外: 価格行・純粋数字・パーセント・拡張子・URL・ファイル名・販促語・電話番号・
 *       商品コード（SKU/ITEM NO等）・単独時刻・短すぎ・長すぎ
 * ティア: 0=商品名, 1=商品情報（カロリー・容量・重量・栄養・賞味期限）, 2=文字数字混在, 3=数字多め
 *       （商品情報はノイズではないため除外せず、商品名より下・その他行より上へ安定ソートする）
 */
export function extractMemoLines(text: string): string[] {
  // 行単体が価格パターン（$7.99 / 7.99 など）
  const PRICE_LINE     = /^(\$\s*)?\d{1,4}([.,]\d{1,2})?$/;
  // 数字のみの行（バーコード・価格残欠など）
  const PURE_DIGITS    = /^\d+$/;
  // 行内に価格パターンを含む（$7.99, 10.99 など）
  const CONTAINS_PRICE = /\$\s*\d|\b\d{1,3}\.\d{2}\b/;
  // 通貨記号だけで構成された価格行（¥298, ฿80, 3,500원 など）
  const CURRENCY_PRICE_LINE = /^[¥₩฿€£]\s*[\d,]+$|^[\d,]+\s*[¥₩฿€£원円元]\s*$/;
  // パーセント含む行（割引率・成分表示など）
  const HAS_PERCENT    = /%/;
  // 画像・動画拡張子キーワード（jpeg/png/jpg など）
  const FILE_EXT_LINE  = /\b(?:jpe?g|png|gif|webp|bmp|tiff?|heic|heif|mov|mp4|avi)\b/i;
  // URL（http/www）またはドメイン名（ene.com など）
  const URL_LIKE       = /https?:\/\/|\bwww\./i;
  const DOMAIN_LIKE    = /\b\w+\.(?:com|net|org|jp|nl|de|fr|uk|kr|th)\b/i;
  // カメラアプリのファイル名パターン（IMG_1234, DSC_0001 など）またはパス区切り
  const FILENAME_LIKE  = /\b(?:IMG|DSC|DCIM|DSCF|Screenshot)[_\-]\d+\b/i;
  const PATH_CHARS     = /[\/\\]/;
  // 賞味期限・消費期限の行は、日付の「/」がPATH_CHARSに誤反応して消えないよう先に救済する
  // （EXP 2026/08/30 等）。日付parserは追加しない・キーワードの有無だけで判定する。
  const EXPIRY_KEYWORD = /\b(?:EXP|EXPIRY|BEST\s*BEFORE)\b|賞味期限|消費期限/i;
  // 欧州系販促ワード（KORTING=割引, HALVE PRIJS=半額 など）
  const PROMO_WORD     = /\b(?:bonus|korting|aanbieding|halve|prijs|prijis|sale|discount)\b/i;
  // 電話番号パターン
  const PHONE_LIKE     = /\d{2,4}[-\s]\d{2,4}[-\s]\d{2,4}/;
  // 既知のOCRアーティファクト（ファイル管理アプリ名など）
  const SYSTEM_NAME    = /^(?:Dropbox|iCloud|OneDrive)$/i;
  // 商品コード・管理番号のラベル＋数字（SKU 123456, ITEM NO. 583920 等）。
  // 「6桁だから商品コード」という数字だけの判定はしない。英字ラベルの有無で判断する。
  const CODE_LABEL     = /\b(?:SKU|ITEM\s*NO\.?|ITEM\s*NUMBER|PRODUCT\s*CODE|BARCODE)\b.{0,12}\d/i;
  // 単独の時刻（10:35等）。日付・賞味期限の大規模parserは追加しない。
  const STANDALONE_TIME = /^\d{1,2}:\d{2}$/;
  // 東アジア文字（日本語・韓国語・タイ語）→ 最小文字数を2に緩和・スコアも商品名扱い
  const HAS_EAST_ASIAN = /[぀-鿿가-힯฀-๿]/;

  // 商品情報（ティア1）判定。ノイズとして除外せず、商品名より下へ分類するためのパターン。
  // 巨大な辞書にはせず、現実的な主要パターンに限定する。
  // - 単位＋数字が直接つながっている（500g, 250 ml, 1.5 L, 12 oz, 250 kcal, 580 - 850 cal.）
  const UNIT_WITH_NUMBER = /\b\d+(?:\.\d+)?\s*(?:g|kg|mg|ml|l|liter|litre|oz|lb|gram|cal|kcal)\b/i;
  // - 栄養キーワードの近く（10文字以内）に数字がある（Protein 20g, Sodium 200mg, 内容量 500g）。
  //   数字が近くにない「HIGH PROTEIN BAR」等の商品名（マーケティング表記）と区別するため、
  //   キーワード単独ではなく数字との近接を必須にする。
  const NUTRITION_NEAR_NUMBER =
    /\b(?:protein|sugar|fat|carbs?|carbohydrates?|sodium|serving\s*size)\b.{0,10}\d|(?:内容量|容量|重量|カロリー|たんぱく質|タンパク質|糖質|脂質|炭水化物|食塩|ナトリウム).{0,10}\d/i;
  const isProductInfo = (line: string): boolean =>
    UNIT_WITH_NUMBER.test(line) || NUTRITION_NEAR_NUMBER.test(line) || EXPIRY_KEYWORD.test(line);

  const seen = new Set<string>();
  const candidates: { line: string; tier: number }[] = [];

  for (const raw of text.split('\n')) {
    const line = raw.trim();
    const minLen = HAS_EAST_ASIAN.test(line) ? 2 : 3;
    if (line.length < minLen || line.length > 50) continue;
    if (PRICE_LINE.test(line)) continue;
    if (PURE_DIGITS.test(line)) continue;
    if (CONTAINS_PRICE.test(line)) continue;
    if (CURRENCY_PRICE_LINE.test(line)) continue;
    // 商品情報（栄養成分等）は%併記が一般的なため、isProductInfoに該当する行は%があっても除外しない
    if (HAS_PERCENT.test(line) && !isProductInfo(line)) continue;
    if (FILE_EXT_LINE.test(line)) continue;
    if (URL_LIKE.test(line) || DOMAIN_LIKE.test(line)) continue;
    // 賞味期限行だけは、日付の区切り文字（EXP 2026/08/30の「/」・BEST BEFORE 2026-08-30の「-」）が
    // PATH_CHARS/PHONE_LIKEに誤反応して消えないよう例外にする
    if ((FILENAME_LIKE.test(line) || PATH_CHARS.test(line)) && !EXPIRY_KEYWORD.test(line)) continue;
    if (PROMO_WORD.test(line)) continue;
    if (PHONE_LIKE.test(line) && !EXPIRY_KEYWORD.test(line)) continue;
    if (SYSTEM_NAME.test(line)) continue;
    if (CODE_LABEL.test(line)) continue;
    if (STANDALONE_TIME.test(line)) continue;

    const key = line.toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);

    let tier: number;
    if (isProductInfo(line)) {
      tier = 1;
    } else {
      const letters  = (line.match(/[A-Za-z]/g) || []).length;
      const cjkCount = (line.match(/[぀-鿿가-힯฀-๿]/g) || []).length;
      const alphaRatio = letters / line.length;
      const cjkRatio   = cjkCount / line.length;
      // 英字比率または東アジア文字比率でティア判定: 0=商品名らしい, 2=混在, 3=数字多め
      tier =
        alphaRatio > 0.7 || cjkRatio > 0.7 ? 0 :
        alphaRatio > 0.3 || cjkRatio > 0.3 ? 2 : 3;
    }
    candidates.push({ line, tier });
  }

  // ティア昇順（同ティアは出現順を維持）
  candidates.sort((a, b) => a.tier - b.tier);
  return candidates.slice(0, 12).map((c) => c.line);
}
