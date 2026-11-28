/**
 * 記録を保存する時の「4つの値」（通貨・現地通貨の額・基準通貨の額・レート）を作る純粋関数（GX-06 の最初の一手・2026-11-28）。
 *
 * 保存の経路は3つ（設計書 `design/gx05-home-currency-design.md` §12-1 B3）。
 *   - ホーム（ネイティブ）`src/app/(tabs)/index.tsx`
 *   - 換算タブ `src/app/(tabs)/converter.tsx`
 *   - ホーム（Web）`src/app/(tabs)/index.web.tsx`
 *
 * どの関数も、切り出す前に各画面へ直接書かれていた式の写しに、段階 d で基準通貨（`homeCurrency`）を足したもの。
 * 基準通貨が円（未指定を含む）なら切り出す前の式と同じ値になることを `save-values-core.test.mjs` が、
 * 切り出す前の式（commit `1bf69ce`）と `Object.is` で比べて確かめる。
 * 経路ごとの違い（Web は選んだ通貨で保存する・換算タブは旅行のレートが0なら予備のレートで保存する）も今のまま残す。
 */
import type { ConversionDirection, CurrencyCode } from '@/constants/currencies';
import { normalizeHomeCurrency } from '@/utils/home-currency-core';
import { roundMoney } from '@/utils/money-core';

import { convert, normalizeJpyInput } from './currency';

/*
 * ■ 基準通貨（GX-06 段階 d・設計書 §4・§6・§12-1 B3・S1）
 *   `homeCurrency` は旅行の基準通貨（`tripHomeCurrency(activeTrip)`）。型では必須にして、3画面で渡し忘れたら tsc が
 *   止める。実行時に未指定・7通貨に無い値なら 'JPY' と読む（切り出す前の式と同じ値になる）。
 *   - 引数の `isJpyMode` は「国内（現地通貨＝基準通貨）」の意味（名前は回帰テストの呼び出しを変えないため既存のまま）。
 *     画面は `isDomesticTrip(activeTrip)` を渡す。基準通貨が円の旅行では今の `base_currency === 'JPY'` と同じ値
 *   - **基準通貨が円の時は、今の式を1文字も変えずに通す**（国内の入力の丸めは `normalizeJpyInput`＝`Math.round`。
 *     `roundMoney(x, 'JPY')` で代用しない：負の値・-0 の扱いが違う）。円以外の国内の入力だけ `roundMoney(x, H)`
 *   - 逆換算で入力した基準通貨の額・外貨から換算した基準通貨の額は、今と同じく丸めない
 *   - 予備のレート（`exchange_rates`＝1単位あたりの円）は **基準通貨が円の時だけ**使う（§6・S1）。円以外の旅行で
 *     旅行のレートが0なら「レート未設定」（0）にして保存させない
 */

/** 実行時の基準通貨（未指定・7通貨に無い値は 'JPY'） */
function homeOf(homeCurrency: CurrencyCode | undefined): CurrencyCode {
  return normalizeHomeCurrency(homeCurrency);
}

/** 国内の入力の丸め：基準通貨が円なら今の `normalizeJpyInput`、それ以外は基準通貨の桁（`roundMoney`） */
function roundDomesticInput(amount: number, home: CurrencyCode): number {
  return home === 'JPY' ? normalizeJpyInput(amount) : roundMoney(amount, home);
}

/** 予備のレート：基準通貨が円の時だけ（円以外は使わない＝0） */
function fallbackRateFor(fallbackRate: number | undefined, home: CurrencyCode): number {
  return home === 'JPY' ? (fallbackRate ?? 0) : 0;
}

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
  /** 国内（現地通貨＝基準通貨）。画面は `isDomesticTrip(activeTrip)` */
  isJpyMode: boolean;
  rate: number;
  inputNum: number;
  isReverse: boolean;
  homeCurrency: CurrencyCode;
}): { foreignAmount: number; jpyAmount: number } {
  const { isJpyMode, rate, inputNum, isReverse } = input;
  const home = homeOf(input.homeCurrency);
  const foreignAmount = isJpyMode ? roundDomesticInput(inputNum, home) : (isReverse ? convert(inputNum, rate, 'FROM_JPY') : inputNum);
  const jpyAmount = isJpyMode ? roundDomesticInput(inputNum, home) : (isReverse ? inputNum : convert(inputNum, rate, 'TO_JPY'));
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
  homeCurrency: CurrencyCode;
}): SaveValues {
  const { baseCurrency, manualRate, foreignAmount, jpyAmount } = input;
  const home = homeOf(input.homeCurrency);
  const currencyToSave = baseCurrency;
  // 国内＝現地通貨と基準通貨が同じ（`isDomesticTrip` と同じ判定。基準通貨が円なら今の `=== 'JPY'` と同じ）
  const rateToSave = currencyToSave === home ? 1 : manualRate;
  const foreignAmountToSave = currencyToSave === home ? jpyAmount : foreignAmount;
  return { currency: currencyToSave, foreignAmount: foreignAmountToSave, jpyAmount, rate: rateToSave };
}

/**
 * 換算タブの描画時のレートと換算結果。元の式：`converter.tsx:62-67, 72`
 * `fallbackRate` は `rates[tripCurrency as CurrencyCode]`（予備のレート・無ければ undefined）をそのまま渡す。
 * 予備のレートは基準通貨が円の時だけ使う（円以外で旅行のレートが0なら `effectiveRate` は0＝保存できない。§12-1 B3）。
 */
export function converterAmounts(input: {
  hasTrip: boolean;
  /** 国内（現地通貨＝基準通貨）。画面は `isDomesticTrip(activeTrip)` */
  isJpyMode: boolean;
  tripRate: number;
  fallbackRate: number | undefined;
  amount: number;
  direction: ConversionDirection;
  homeCurrency: CurrencyCode;
}): { effectiveRate: number; result: number } {
  const { hasTrip, isJpyMode, tripRate, fallbackRate, amount, direction } = input;
  const home = homeOf(input.homeCurrency);
  const effectiveRate = !hasTrip
    ? 0
    : isJpyMode
      ? 1
      : (tripRate > 0 ? tripRate : fallbackRateFor(fallbackRate, home));
  const result = !hasTrip ? 0 : isJpyMode ? roundDomesticInput(amount, home) : convert(amount, effectiveRate, direction);
  return { effectiveRate, result };
}

/**
 * 換算タブの保存。元の式：`converter.tsx:121`（`addEntry` の最初の4つの引数）。
 * 基準通貨には依存しない（国内の判定は `converterAmounts` と同じ `isJpyMode` を受け取り、国内の額は `converterAmounts` の
 * `result` が基準通貨の桁で丸め済み）
 */
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
 * ホーム（Web）の描画時のレート。元の式：`index.web.tsx:58-60`（`globalRate = rates[selectedCurrency] ?? 0`）
 * `fallbackRate` は `rates[selectedCurrency]` をそのまま渡す。予備のレートは基準通貨が円の時だけ使う（§6・S1）
 */
export function webEntryRate(input: {
  /** 国内（現地通貨＝基準通貨）。画面は `isDomesticTrip(activeTrip)` */
  isJpyMode: boolean;
  tripRate: number;
  fallbackRate: number | undefined;
  homeCurrency: CurrencyCode;
}): number {
  const { isJpyMode, tripRate, fallbackRate } = input;
  const home = homeOf(input.homeCurrency);
  return isJpyMode ? 1 : (tripRate > 0 ? tripRate : fallbackRateFor(fallbackRate, home));
}

/**
 * ホーム（Web）の保存。元の式：`index.web.tsx:105-106`
 * Web は旅行の通貨ではなく選んだ通貨（`selectedCurrency`）で保存する（ネイティブと食い違う既存の挙動。
 * 設計書 §8・§12-2 S11 で別の commit として直すまで変えない）。国内の時は基準通貨で保存する（基準通貨が円なら今の 'JPY'）。
 * 注意（S11 の残り）：外貨の旅行で「選んだ通貨＝基準通貨」を選ぶと、保存した記録は国内の記録として読まれる
 */
export function webHomeSaveValues(input: {
  /** 国内（現地通貨＝基準通貨）。画面は `isDomesticTrip(activeTrip)` */
  isJpyMode: boolean;
  selectedCurrency: CurrencyCode;
  foreignAmount: number;
  jpyAmount: number;
  rate: number;
  homeCurrency: CurrencyCode;
}): SaveValues {
  const { isJpyMode, selectedCurrency, foreignAmount, jpyAmount, rate } = input;
  const home = homeOf(input.homeCurrency);
  const currencyToSave: CurrencyCode = isJpyMode ? home : selectedCurrency;
  return { currency: currencyToSave, foreignAmount, jpyAmount, rate };
}
