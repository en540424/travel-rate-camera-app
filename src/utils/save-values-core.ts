/**
 * 記録を保存する時の「4つの値」（通貨・現地通貨の額・基準通貨の額・レート）を作る純粋関数（GX-06 の最初の一手・2026-11-28）。
 *
 * 保存の経路は3つ（設計書 `design/gx05-home-currency-design.md` §12-1 B3）。
 *   - ホーム（ネイティブ）`src/app/(tabs)/index.tsx`
 *   - 換算タブ `src/app/(tabs)/converter.tsx`
 *   - ホーム（Web）`src/app/(tabs)/index.web.tsx`
 *
 * **この段階では式を変えない**。どの関数も、切り出す前に各画面へ直接書かれていた式を1文字も変えずに写したもので、
 * 基準通貨は円だけを扱う（円以外の基準通貨は GX-06 の後の段階で引数を足す）。
 * 同じ値になることは `save-values-core.test.mjs` が、切り出す前の式（commit `1bf69ce`）と `Object.is` で比べて確かめる。
 * 経路ごとの違い（Web は選んだ通貨で保存する・換算タブは旅行のレートが0なら予備のレートで保存する）も今のまま残す。
 */
import type { ConversionDirection, CurrencyCode } from '@/constants/currencies';

import { convert, normalizeJpyInput } from './currency';

/** 保存する4つの値（`addEntry` の最初の4つの引数と同じ並び） */
export interface SaveValues {
  currency: CurrencyCode;
  foreignAmount: number;
  jpyAmount: number;
  rate: number;
}

/**
 * ホーム（ネイティブ・Web 共通）の描画時の額。
 * 元の式：`index.tsx:272-273`・`index.web.tsx:62-63`（どちらも同じ式）
 */
export function deriveEntryAmounts(input: {
  isJpyMode: boolean;
  rate: number;
  inputNum: number;
  isReverse: boolean;
}): { foreignAmount: number; jpyAmount: number } {
  const { isJpyMode, rate, inputNum, isReverse } = input;
  const foreignAmount = isJpyMode ? normalizeJpyInput(inputNum) : (isReverse ? convert(inputNum, rate, 'FROM_JPY') : inputNum);
  const jpyAmount = isJpyMode ? normalizeJpyInput(inputNum) : (isReverse ? inputNum : convert(inputNum, rate, 'TO_JPY'));
  return { foreignAmount, jpyAmount };
}

/**
 * ホーム（ネイティブ）の保存。元の式：`index.tsx:855-857`
 * `manualRate` は `activeTrip.manual_rate` をそのまま渡す（描画用の `?? 0` 付きの値で代用しない）。
 */
export function nativeHomeSaveValues(input: {
  baseCurrency: CurrencyCode;
  manualRate: number;
  foreignAmount: number;
  jpyAmount: number;
}): SaveValues {
  const { baseCurrency, manualRate, foreignAmount, jpyAmount } = input;
  const currencyToSave = baseCurrency;
  const rateToSave = currencyToSave === 'JPY' ? 1 : manualRate;
  const foreignAmountToSave = currencyToSave === 'JPY' ? jpyAmount : foreignAmount;
  return { currency: currencyToSave, foreignAmount: foreignAmountToSave, jpyAmount, rate: rateToSave };
}

/**
 * 換算タブの描画時のレートと換算結果。元の式：`converter.tsx:62-67, 72`
 * `fallbackRate` は `rates[tripCurrency as CurrencyCode]`（予備のレート・無ければ undefined）をそのまま渡す。
 */
export function converterAmounts(input: {
  hasTrip: boolean;
  isJpyMode: boolean;
  tripRate: number;
  fallbackRate: number | undefined;
  amount: number;
  direction: ConversionDirection;
}): { effectiveRate: number; result: number } {
  const { hasTrip, isJpyMode, tripRate, fallbackRate, amount, direction } = input;
  const effectiveRate = !hasTrip
    ? 0
    : isJpyMode
      ? 1
      : (tripRate > 0 ? tripRate : (fallbackRate ?? 0));
  const result = !hasTrip ? 0 : isJpyMode ? normalizeJpyInput(amount) : convert(amount, effectiveRate, direction);
  return { effectiveRate, result };
}

/** 換算タブの保存。元の式：`converter.tsx:121`（`addEntry` の最初の4つの引数） */
export function converterSaveValues(input: {
  tripCurrency: CurrencyCode;
  isJpyMode: boolean;
  amount: number;
  result: number;
  effectiveRate: number;
}): SaveValues {
  const { tripCurrency, isJpyMode, amount, result, effectiveRate } = input;
  return { currency: tripCurrency, foreignAmount: isJpyMode ? result : amount, jpyAmount: result, rate: effectiveRate };
}

/**
 * ホーム（Web）の保存。元の式：`index.web.tsx:105-106`
 * Web は旅行の通貨ではなく選んだ通貨（`selectedCurrency`）で保存する（ネイティブと食い違う既存の挙動。
 * 設計書 §8・§12-2 S11 で別の commit として直すまで変えない）。
 */
export function webHomeSaveValues(input: {
  isJpyMode: boolean;
  selectedCurrency: CurrencyCode;
  foreignAmount: number;
  jpyAmount: number;
  rate: number;
}): SaveValues {
  const { isJpyMode, selectedCurrency, foreignAmount, jpyAmount, rate } = input;
  const currencyToSave: CurrencyCode = isJpyMode ? 'JPY' : selectedCurrency;
  return { currency: currencyToSave, foreignAmount, jpyAmount, rate };
}
