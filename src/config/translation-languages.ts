/**
 * 通貨からApple Translationのsource言語を決める唯一の入口。
 *
 * **`src/config/ocr-languages.ts`（Vision OCRの認識言語）とは別物。**
 * Visionは`ko-KR`・`th-TH`・`en-US`のようなロケール付き識別子を使うが、
 * Translationのsourceは`Locale.Language(identifier:)`へ渡され`minimalIdentifier`へ正規化される。
 * OCRの言語セットをそのままTranslationへ渡さないこと（en-US併記などの都合も混ざるため）。
 *
 * Phase 1〜3ではsourceの自動判定を行わず、この通貨hintを明示的に使う
 * （nativeの`source`が非Optionalで、auto-detect経路は実機未検証のため。正本§31）。
 * 通貨が実際の表示言語を保証しない限界（TWD旅行でタイ語の値札等）は、
 * OCR言語hintと同じくここでも引き継ぐ。誤ったsourceでの失敗は原文フォールバックで吸収する。
 */
import type { CurrencyCode } from '@/constants/currencies';

/** nullは「翻訳しない」。CurrencyCodeに存在しない通貨（CNY等）は推測で追加しない */
const CURRENCY_TRANSLATION_SOURCE: Record<CurrencyCode, string | null> = {
  USD: 'en',
  GBP: 'en',
  EUR: 'en',
  KRW: 'ko',
  TWD: 'zh-Hant',
  THB: 'th',
  // 国内旅行。翻訳先が`ja`なのでja→jaとなり翻訳する意味がない。
  // 日本の値札に英語が混ざる可能性はあるが、行ごとの言語判定はPhase 2の範囲外（過剰実装）。
  JPY: null,
};

/**
 * 翻訳のsource言語。nullならその通貨では翻訳を行わない。
 *
 * EURは実際には多言語圏だが、Vision OCR側も`en-US`単独で扱っている現行方針に合わせる
 * （ここだけ別の推測を持ち込まない）。
 */
export function getTranslationSourceLanguage(currency: CurrencyCode): string | null {
  return CURRENCY_TRANSLATION_SOURCE[currency];
}
