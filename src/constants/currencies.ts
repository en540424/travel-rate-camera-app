export type CurrencyCode = 'USD' | 'KRW' | 'TWD' | 'THB' | 'EUR' | 'GBP' | 'JPY';

export interface Currency {
  code: CurrencyCode;
  name: string;
  nameJa: string;
  symbol: string;
  /** 小数点以下の表示桁数 */
  decimals: number;
  flag: string;
}

export const CURRENCIES: Record<CurrencyCode, Currency> = {
  USD: { code: 'USD', name: 'US Dollar',       nameJa: '米ドル',       symbol: '$',  decimals: 2, flag: '🇺🇸' },
  KRW: { code: 'KRW', name: 'Korean Won',       nameJa: '韓国ウォン',   symbol: '₩',  decimals: 0, flag: '🇰🇷' },
  TWD: { code: 'TWD', name: 'Taiwan Dollar',    nameJa: '台湾ドル',     symbol: 'NT$', decimals: 0, flag: '🇹🇼' },
  THB: { code: 'THB', name: 'Thai Baht',        nameJa: 'タイバーツ',   symbol: '฿',  decimals: 2, flag: '🇹🇭' },
  EUR: { code: 'EUR', name: 'Euro',             nameJa: 'ユーロ',       symbol: '€',  decimals: 2, flag: '🇪🇺' },
  GBP: { code: 'GBP', name: 'British Pound',    nameJa: '英ポンド',     symbol: '£',  decimals: 2, flag: '🇬🇧' },
  JPY: { code: 'JPY', name: 'Japanese Yen',     nameJa: '円（国内）',   symbol: '¥',  decimals: 0, flag: '🇯🇵' },
};

/** 全通貨コード（JPY 含む）。旅行作成・編集の通貨選択に使用 */
export const CURRENCY_CODES = Object.keys(CURRENCIES) as CurrencyCode[];

/** 外貨コードのみ（JPY 除く）。レート入力・グローバル通貨設定・cycleCurrency に使用 */
export const FOREIGN_CURRENCY_CODES: CurrencyCode[] = CURRENCY_CODES.filter((c) => c !== 'JPY');

/** 将来 JPY→外貨に対応するための換算方向型 */
export type ConversionDirection = 'TO_JPY' | 'FROM_JPY';

/**
 * 手入力レート欄の**入力例**（1通貨あたりの円）。
 *
 * ■ これは「最新レート」ではない
 *   本アプリは為替APIを持たず、レートはユーザーの手入力が正本
 *   （`exchange_rates`テーブルと`trips.manual_rate`はいずれも手入力値の保存先）。
 *   ここの値は**桁感を示すためだけの例**であり、実勢レートとして使わない。
 *   表示側は必ず「例 150」のように例であると分かる形にすること。
 *
 * ■ なぜ通貨ごとに持つのか
 *   以前は全通貨で`148.5`固定のplaceholderだったため、
 *   「1 KRW = 148.5円」「1 THB = 148.5円」のように桁が明確に誤っていた。
 *   桁を間違えた手入力を誘発するため、通貨ごとの桁感に合わせる。
 */
const RATE_INPUT_EXAMPLE: Record<CurrencyCode, string> = {
  USD: '150',
  KRW: '0.11',
  TWD: '4.8',
  THB: '4.5',
  EUR: '175',
  GBP: '200',
  JPY: '1',
};

/** 手入力レート欄のplaceholder用の入力例文字列。実勢レートではない（上のコメント参照） */
export function getRateInputExample(currency: CurrencyCode): string {
  return RATE_INPUT_EXAMPLE[currency] ?? '150';
}
