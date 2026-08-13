/**
 * 通貨からVision OCR（modules/vision-ocr）へ渡す言語セットを決める唯一の入口。
 * 通貨圏の言語を先頭に、価格・数字表記で混在しやすい英数字用にen-USを併記する
 * （USD/GBP/EURはもともと英語圏想定のためen-US単独）。
 * CurrencyCodeに存在しない通貨（例: CNY）は推測で追加しない。
 */
import type { CurrencyCode } from '@/constants/currencies';

const CURRENCY_OCR_LANGUAGES: Record<CurrencyCode, string[]> = {
  USD: ['en-US'],
  GBP: ['en-US'],
  EUR: ['en-US'],
  JPY: ['ja-JP', 'en-US'],
  KRW: ['ko-KR', 'en-US'],
  TWD: ['zh-Hant', 'en-US'],
  THB: ['th-TH', 'en-US'],
};

export function getOcrLanguagesForCurrency(currency: CurrencyCode): string[] {
  return CURRENCY_OCR_LANGUAGES[currency];
}
