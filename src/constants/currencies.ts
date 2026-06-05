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
