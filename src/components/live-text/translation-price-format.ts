// 翻訳ページ（カメラ翻訳・写真翻訳）の価格表示。「$12.50」と「約¥2,038」を組で作る。
// 換算は既存の`convert`、表示は既存の`formatForeign`・`formatJpy`（保存・メインカメラと同じ丸め）を使う。
import type { CurrencyCode } from '@/constants/currencies';
import type { TripPriceConversion } from '@/lib/live-text-core';
import { convert } from '@/utils/currency';
import { formatForeign, formatJpy } from '@/utils/format';

export type TranslationPriceConversion = TripPriceConversion<CurrencyCode>;

export type TranslationPriceText = {
  /** 現地通貨の価格（例: "$12.50"） */
  foreign: string;
  /** 円換算（例: "約¥2,038"）。レート未設定ならnull */
  jpy: string | null;
};

export function formatTranslationPrice(amount: number, conversion: TranslationPriceConversion): TranslationPriceText {
  const jpyAmount = conversion.rate > 0 ? convert(amount, conversion.rate, 'TO_JPY') : 0;
  return {
    foreign: formatForeign(amount, conversion.currency),
    jpy: conversion.rate > 0 && Number.isFinite(jpyAmount) && jpyAmount > 0 ? `約${formatJpy(jpyAmount)}` : null,
  };
}
