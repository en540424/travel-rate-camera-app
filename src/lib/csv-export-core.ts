/**
 * CSV書き出しの文字列組み立て（純粋関数）。
 *
 * **react-native・nativeモジュール・`@/`エイリアス・相対importを一切持たない。**
 * `node --test`から直接importして検証できる自己完結モジュールにするため
 * （`speech-locales.ts`・`tts-voice-preferences-core.ts`と同じ規律）。
 * ファイル書き込み・共有は`csv-export-service.ts`側が担う。
 *
 * ■ カテゴリーラベルは注入で受け取る
 *   `config/categories.ts`の`getCategoryLabel`を直接importすると相対import
 *   （拡張子無し）になり`node --test`のtype strippingで解決できない。
 *   そのため**ラベル解決関数を引数で受け取る**。呼び出し側は必ず
 *   `config/categories.ts`の`getCategoryLabel`を渡すこと（別のcategory mapを作らない）。
 */

/** CSVの区切り・改行。Excel/Numbers/Google Sheetsが揃って解釈できるCRLFを使う */
const DELIMITER = ',';
const NEWLINE = '\r\n';

/**
 * UTF-8 BOM。
 *
 * Windows版Excelは BOM 無しUTF-8 CSVをShift_JISとして開くため日本語が文字化けする。
 * BOMを先頭に置くとUTF-8として認識される。macOS Numbers・Google Sheets・
 * macOS Excelはいずれも BOM 付きUTF-8を正しく読むため、付けて困る環境が無い。
 * （U+FEFF はUTF-8へエンコードされると EF BB BF の3バイトになる）
 * 不可視文字を生で埋め込まず、エスケープ表記で明示する（editor・diff・レビューで見えなくなるのを防ぐ）。
 */
export const UTF8_BOM = '\uFEFF';

/**
 * Excel等がセル内容を数式として解釈しうる先頭文字。
 *
 * `=SUM(...)`のような文字列がメモに入っていた場合、CSVを開いただけで数式として
 * 評価されうる（CSV injection）。`\t`と`\r`も一部の実装で数式行の起点になる。
 */
const FORMULA_TRIGGERS = ['=', '+', '-', '@', '\t', '\r'];

/**
 * 文字列セルを安全な形へ整える。
 *
 * 1. 数式として解釈されうる先頭文字を持つ場合、`'`を前置する
 *    （Excel/Google Sheetsの「以降はテキスト」マーカー。セル表示上は`'`が出ない）
 * 2. `"`・`,`・改行のいずれかを含む場合、全体を`"`で囲み内部の`"`を`""`へエスケープ
 *
 * **数式ガードは文字列セル専用。** 数値セルは`formatNumberCell`を通すため、
 * 負数（`-500`）が`'-500`になって数値として読めなくなる事故は起きない。
 * `null`・`undefined`は空セルにする（`"null"`という文字列を書き出さない）。
 */
export function escapeCsvField(value: string | null | undefined): string {
  if (value == null) return '';

  let text = value;
  if (text.length > 0 && FORMULA_TRIGGERS.includes(text[0])) {
    text = `'${text}`;
  }

  if (text.includes('"') || text.includes(DELIMITER) || text.includes('\n') || text.includes('\r')) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

/**
 * 数値セルを整える。数式ガードは通さない（負数をそのまま数値として書き出すため）。
 * 有限でない値（NaN・Infinity）は空セルにする（`NaN`という文字列を残さない）。
 */
export function formatNumberCell(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '';
  return String(value);
}

/**
 * JPY建て記録の金額を整数円へ丸める（表示の`formatJpy`と同じ`Math.round`）。
 * 非有限値はそのまま返し、空セル化の判断は`formatNumberCell`に任せる（`Math.round(NaN)`もNaNのまま）。
 * `utils/currency.ts`の`normalizeJpyInput`は非有限を0にするため、ここでは流用しない（0を書き出さない）。
 */
function roundJpy(value: number): number {
  return Number.isFinite(value) ? Math.round(value) : value;
}

/** 1行分のセル配列をCSVの1行にする（各セルは整形済みであること） */
export function toCsvLine(cells: readonly string[]): string {
  return cells.join(DELIMITER);
}

/** CSV書き出し1件分。`HistoryRow`から必要な列だけを写した形 */
export type CsvHistoryRow = {
  /** `created_at`（DBの保存日時。"YYYY-MM-DD HH:MM:SS"想定） */
  createdAt: string;
  /** `entry_date`（カレンダー上の記録日。未設定はnull） */
  entryDate: string | null;
  /** `category`の生値（slug）。ラベル変換は`categoryLabelOf`が行う */
  category: string | null;
  memo: string | null;
  /** `is_purchased === 1` */
  isPurchased: boolean;
  currency: string;
  foreignAmount: number;
  jpyAmount: number;
  rateUsed: number;
  /**
   * 記録の基準通貨（`HistoryRow.home_currency`。GX-06 段階 c-3）。未指定は 'JPY'。
   * 全行が 'JPY' なら CSV は今と同じ列・見出し・値（設計書 `design/gx05-home-currency-design.md` §7）。
   * 型では必須（渡し忘れると円以外の記録が「換算金額(円)」のまま出るので tsc で止める）。実行時の未指定は 'JPY'
   */
  homeCurrency: string;
};

/** CSVの見出し行。列の順序はここが正 */
export const CSV_HEADERS = [
  '保存日時',
  '記録日',
  '旅行名',
  'カテゴリー',
  'メモ',
  '状態',
  '元通貨',
  '元金額',
  '換算金額(円)',
  'レート',
] as const;

export type BuildHistoryCsvOptions = {
  /** 全行に入る旅行名（書き出し対象は1旅行なので行ごとには持たない） */
  tripName: string;
  /**
   * カテゴリーslug→表示ラベルの変換。
   * **必ず`config/categories.ts`の`getCategoryLabel`を渡すこと。**
   * ここで別のcategory mapを新設しないための注入点。
   */
  categoryLabelOf: (slug: string | null) => string;
  /**
   * 基準通貨の桁で1件の額を丸める（GX-06 段階 c-3・S8：このモジュールは値の import を持たないので注入する）。
   * 呼び出し側は `home-currency-core.ts` の `roundInHomeCurrency`（`money-core` の `roundMoney`）を渡すこと。
   * 'JPY' 以外の基準通貨の記録がある時だけ使う
   */
  roundInHome?: (amount: number, homeCurrency: string) => number;
  /**
   * 'JPY' 以外の基準通貨の記録がある時の見出し（表示言語の文言。辞書 `csv.header.*` から渡す）。
   * 「換算金額(円)」の位置を `convertedAmount` に替え、その右に `convertedCurrency` の列を足す
   */
  multiCurrencyHeaders?: { convertedAmount: string; convertedCurrency: string };
};

/** 'JPY' 以外の基準通貨の記録があるか（あれば見出しと列を変える。無ければ今と同じ CSV） */
export function hasNonJpyHome(rows: readonly CsvHistoryRow[]): boolean {
  return (rows ?? []).some((row) => (row.homeCurrency ?? 'JPY') !== 'JPY');
}

/** 'JPY' 以外の基準通貨を含む CSV の見出し（「換算金額(円)」を置き換え、その右に「換算通貨」） */
function multiCurrencyHeaderRow(labels: { convertedAmount: string; convertedCurrency: string }): string[] {
  const headers: string[] = [];
  CSV_HEADERS.forEach((header, i) => {
    if (i === CONVERTED_AMOUNT_COLUMN) headers.push(labels.convertedAmount, labels.convertedCurrency);
    else headers.push(header);
  });
  return headers;
}

/** `CSV_HEADERS` の「換算金額(円)」の位置（テストで見出しと一致を固定） */
export const CONVERTED_AMOUNT_COLUMN = 8;

/**
 * 履歴行からCSV本文を組み立てる（BOMは付けない。付与は`withUtf8Bom`の責務）。
 *
 * ■ 絞り込みはしない
 *   分析画面は「購入済みかつ期間内」で絞るが、CSVは**保存履歴の書き出し**であり
 *   目的が違う。対象旅行の保存データをそのまま全件出し、購入/候補は「状態」列で表す
 *   （受け取った側がExcel/Sheets上で自由に絞れる形にする）。
 *
 * 0件でも見出し行だけのCSVを返す。「書き出せる記録がありません」の判定は
 * 呼び出し側（UI）が行い、ここでは文字列組み立てに徹する。
 *
 * ■ 基準通貨（GX-06 段階 c-3・設計書 §7）
 *   全行の基準通貨が 'JPY' なら今と同じ列・見出し・値。'JPY' 以外を含む時だけ、見出しの「換算金額(円)」を
 *   注入した文言に替え、その右に「換算通貨」の列を足す。丸めるのは**国内の記録（記録の通貨＝その記録の基準通貨）だけ**で、
 *   基準通貨が 'JPY' なら今と同じ `Math.round`、それ以外は注入した `roundInHome`（基準通貨の桁）。
 *   外貨の記録は元金額・換算金額とも生値のまま（訪日客の JPY の記録を円として丸めない）。
 */
export function buildHistoryCsv(
  rows: readonly CsvHistoryRow[],
  options: BuildHistoryCsvOptions,
): string {
  const multiCurrency = hasNonJpyHome(rows);
  const { roundInHome, multiCurrencyHeaders } = options;
  if (multiCurrency && (!roundInHome || !multiCurrencyHeaders)) {
    // 円以外の基準通貨の記録を、丸めと見出しの文言なしに書き出さない（呼び出し側の配線漏れを黙って通さない）
    throw new Error('buildHistoryCsv: roundInHome and multiCurrencyHeaders are required for non-JPY home currencies');
  }
  const headers = multiCurrency && multiCurrencyHeaders ? multiCurrencyHeaderRow(multiCurrencyHeaders) : CSV_HEADERS;
  const lines: string[] = [toCsvLine(headers.map((header) => escapeCsvField(header)))];

  for (const row of rows ?? []) {
    // JPY建て記録は整数円が正本（`formatJpy`・`normalizeJpyInput`・SQL `ROUND(jpy_amount)`と同じ`Math.round`）。
    // 2026-09-18以前に保存された小数JPY（例: 1200.5）がDBに残り得るが、画面は常に¥1,201なので
    // CSVも同じ値にする（DBは書き換えない。書き出し時の表現だけ）。JPY記録は`foreign_amount`にも同じ円が
    // 入っているため「元金額」も揃えて丸める。**外貨記録は元金額・換算円とも生値のまま**（内部換算値の契約は変えない）。
    // 基準通貨が 'JPY' の記録では「国内の記録」＝`row.currency === 'JPY'` で、今と同じ判定・同じ丸め。
    const home = row.homeCurrency ?? 'JPY';
    const isDomesticRecord = row.currency === home;
    // 有限でない額は丸めずに空セルにする（`roundMoney` は NaN を 0 にするので、先に除く。`roundJpy` は NaN のまま返す）
    const roundHome = (value: number) =>
      home === 'JPY' || !roundInHome || !Number.isFinite(value) ? roundJpy(value) : roundInHome(value, home);
    const foreignAmount = isDomesticRecord ? roundHome(row.foreignAmount) : row.foreignAmount;
    const homeAmount = isDomesticRecord ? roundHome(row.jpyAmount) : row.jpyAmount;
    const cells = [
      escapeCsvField(row.createdAt),
      escapeCsvField(row.entryDate),
      escapeCsvField(options.tripName),
      escapeCsvField(options.categoryLabelOf(row.category)),
      escapeCsvField(row.memo),
      escapeCsvField(row.isPurchased ? '購入済み' : '候補'),
      escapeCsvField(row.currency),
      formatNumberCell(foreignAmount),
      formatNumberCell(homeAmount),
    ];
    if (multiCurrency) cells.push(escapeCsvField(home));
    cells.push(formatNumberCell(row.rateUsed));
    lines.push(toCsvLine(cells));
  }

  // 末尾にも改行を置く（POSIXのテキストファイル慣習。Excel/Sheetsとも空行として読まない）
  return lines.join(NEWLINE) + NEWLINE;
}

/** 先頭にUTF-8 BOMを付ける。既に付いていれば二重に付けない */
export function withUtf8Bom(csv: string): string {
  return csv.startsWith(UTF8_BOM) ? csv : `${UTF8_BOM}${csv}`;
}

/**
 * ファイル名に使えない文字（Windows/macOS/iOSの和集合）と、制御文字の範囲。
 * ハイフンと半角スペースは対象外（日付`2026-08-28`や旅行名中のハイフンを壊さないため）。
 */
const UNSAFE_FILENAME_CHARS = /[/\\:*?"<>|\u0000-\u001f]/g;

/**
 * ファイル名の一部として安全な文字列にする。
 *
 * 使えない文字を`_`へ、空白の連続を1つへ、前後の空白と`.`を落とす
 * （先頭の`.`は隠しファイル扱い、末尾の`.`はWindowsで無効なため）。
 * 空になった場合は呼び出し側がfallbackできるよう空文字を返す。
 * 長さは40文字で切る（旅行名が長くても共有シートで読めるファイル名に収める）。
 */
export function sanitizeFilenamePart(value: string | null | undefined, maxLength = 40): string {
  if (value == null) return '';
  const cleaned = value
    .replace(UNSAFE_FILENAME_CHARS, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .replace(/\.+$/, '')
    .trim();
  return cleaned.slice(0, maxLength);
}

/**
 * 共有時に分かりやすいCSVファイル名を作る。
 * 例: `travel-rate-camera_韓国旅行_2026-08-28.csv`
 *
 * 旅行名がsanitize後に空になった場合は旅行名部分を省く
 * （`travel-rate-camera__2026-08-28.csv`のような二重区切りを作らない）。
 */
export function buildCsvFilename(tripName: string | null | undefined, dateKey: string): string {
  const safeTrip = sanitizeFilenamePart(tripName);
  const safeDate = sanitizeFilenamePart(dateKey, 10);
  const parts = ['travel-rate-camera', safeTrip, safeDate].filter((part) => part !== '');
  return `${parts.join('_')}.csv`;
}
