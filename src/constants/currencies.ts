export type CurrencyCode = 'USD' | 'KRW' | 'TWD' | 'THB' | 'EUR' | 'GBP';

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
};

export const CURRENCY_CODES = Object.keys(CURRENCIES) as CurrencyCode[];

/** 将来 JPY→外貨に対応するための換算方向型 */
export type ConversionDirection = 'TO_JPY' | 'FROM_JPY';
