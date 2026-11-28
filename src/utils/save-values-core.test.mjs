/**
 * `utils/save-values-core.ts` の回帰テスト（GX-06 の最初の一手・2026-11-28）。
 * 切り出す前に画面へ直接書かれていた式（commit `1bf69ce`）を下の `old*` に1文字も変えずに写し、
 * 新しい関数と4つの値を `Object.is` で比べる（-0・NaN・Infinity の違いも拾う）。
 * 写すのは式の組み立てだけで、中の `convert`・`normalizeJpyInput` は本物（`utils/currency.ts`）を使う。
 */
import { ok } from 'node:assert/strict';
import { register } from 'node:module';
import { test } from 'node:test';

register('../lib/proplus/ts-resolve-hook.mjs', import.meta.url);
const S = await import('./save-values-core.ts');
const { convert, normalizeJpyInput } = await import('./currency.ts');

const CODES = ['JPY', 'USD', 'EUR', 'GBP', 'KRW', 'TWD', 'THB'];
const AMOUNTS = [0, -0, 1, 0.4, 0.5, 1.5, 2.5, -2.5, 12.99, 1200.5, 1000, 0.1 + 0.2, 6.666666666666667,
  1e21, 1e-7, -5, Infinity, -Infinity, NaN];
const RATES = [0, -1, 1, 0.0067, 0.41, 1 / 150, 150, 152.5, 1370, 9.2, Infinity, NaN, undefined];

// ---- 切り出す前の式（1bf69ce）の写し ----

// src/app/(tabs)/index.tsx:272-273 と src/app/(tabs)/index.web.tsx:62-63（同じ式）
function oldEntryAmounts(isJpyMode, rate, inputNum, isReverse) {
  const foreignAmount = isJpyMode ? normalizeJpyInput(inputNum) : (isReverse ? convert(inputNum, rate, 'FROM_JPY') : inputNum);
  const jpyAmount = isJpyMode ? normalizeJpyInput(inputNum) : (isReverse ? inputNum : convert(inputNum, rate, 'TO_JPY'));
  return { foreignAmount, jpyAmount };
}

// src/app/(tabs)/index.tsx:855-857（activeTrip.base_currency・activeTrip.manual_rate）→ addEntry の最初の4つの引数
function oldNativeSave(activeTrip, foreignAmount, jpyAmount) {
  const currencyToSave = activeTrip.base_currency;
  const rateToSave = currencyToSave === 'JPY' ? 1 : activeTrip.manual_rate;
  const foreignAmountToSave = currencyToSave === 'JPY' ? jpyAmount : foreignAmount;
  return [currencyToSave, foreignAmountToSave, jpyAmount, rateToSave];
}

// src/app/(tabs)/converter.tsx:62-67, 72（rates[tripCurrency] は ratesEntry で渡す）
function oldConverterAmounts(activeTrip, isJpyMode, tripRate, ratesEntry, amount, direction) {
  const effectiveRate = !activeTrip
    ? 0
    : isJpyMode
      ? 1
      : (tripRate > 0 ? tripRate : (ratesEntry ?? 0));
  const result = !activeTrip ? 0 : isJpyMode ? normalizeJpyInput(amount) : convert(amount, effectiveRate, direction);
  return { effectiveRate, result };
}

// src/app/(tabs)/converter.tsx:121 → addEntry の最初の4つの引数
function oldConverterSave(tripCurrency, isJpyMode, amount, result, effectiveRate) {
  return [tripCurrency, isJpyMode ? result : amount, result, effectiveRate];
}

// src/app/(tabs)/index.web.tsx:105-106 → addEntry の最初の4つの引数
function oldWebSave(isJpyMode, selectedCurrency, foreignAmount, jpyAmount, rate) {
  const currencyToSave = isJpyMode ? 'JPY' : selectedCurrency;
  return [currencyToSave, foreignAmount, jpyAmount, rate];
}

// ---- 比較 ----

const asArray = (v) => [v.currency, v.foreignAmount, v.jpyAmount, v.rate];

function sameAll(label, got, want) {
  ok(got.length === want.length, `${label}: 長さ`);
  for (let i = 0; i < want.length; i++) {
    ok(Object.is(got[i], want[i]), `${label}: [${i}] got=${String(got[i])} want=${String(want[i])}`);
  }
}

test('ホーム（ネイティブ・Web 共通）：描画時の額が切り出す前の式と同じ', () => {
  let n = 0;
  for (const isJpyMode of [true, false]) {
    for (const isReverse of [true, false]) {
      for (const rate of RATES) {
        for (const inputNum of AMOUNTS) {
          const got = S.deriveEntryAmounts({ isJpyMode, rate, inputNum, isReverse });
          const want = oldEntryAmounts(isJpyMode, rate, inputNum, isReverse);
          sameAll(`entry ${isJpyMode}/${isReverse}/${rate}/${inputNum}`,
            [got.foreignAmount, got.jpyAmount], [want.foreignAmount, want.jpyAmount]);
          n++;
        }
      }
    }
  }
  ok(n === 2 * 2 * RATES.length * AMOUNTS.length);
});

test('ホーム（ネイティブ）：保存する4つの値が切り出す前の式と同じ（7通貨×レート×額）', () => {
  for (const base of CODES) {
    for (const manualRate of RATES) {
      for (const f of AMOUNTS) {
        for (const j of AMOUNTS) {
          const got = S.nativeHomeSaveValues({ baseCurrency: base, manualRate, foreignAmount: f, jpyAmount: j });
          const want = oldNativeSave({ base_currency: base, manual_rate: manualRate }, f, j);
          sameAll(`native ${base}/${manualRate}/${f}/${j}`, asArray(got), want);
        }
      }
    }
  }
});

test('ホーム（ネイティブ）：画面と同じ順で作った値（描画時の額 → 保存）も同じ', () => {
  for (const base of CODES) {
    const isJpyMode = base === 'JPY';
    for (const manualRate of RATES) {
      // index.tsx:265-267（旅行がある時：rate = isJpyMode ? 1 : tripRate、tripRate = manual_rate ?? 0）
      const tripRate = manualRate ?? 0;
      const rate = isJpyMode ? 1 : tripRate;
      for (const isReverseInput of [true, false]) {
        const isReverse = !isJpyMode && isReverseInput;
        for (const inputNum of AMOUNTS) {
          const a = S.deriveEntryAmounts({ isJpyMode, rate, inputNum, isReverse });
          const got = S.nativeHomeSaveValues({ baseCurrency: base, manualRate, foreignAmount: a.foreignAmount, jpyAmount: a.jpyAmount });
          const o = oldEntryAmounts(isJpyMode, rate, inputNum, isReverse);
          const want = oldNativeSave({ base_currency: base, manual_rate: manualRate }, o.foreignAmount, o.jpyAmount);
          sameAll(`native-flow ${base}/${manualRate}/${isReverse}/${inputNum}`, asArray(got), want);
        }
      }
    }
  }
});

test('換算タブ：描画時のレート・換算結果が切り出す前の式と同じ（旅行なし・予備レートの有無を含む）', () => {
  for (const hasTrip of [true, false]) {
    for (const isJpyMode of [true, false]) {
      for (const tripRate of RATES) {
        for (const fallbackRate of RATES) {
          for (const direction of ['TO_JPY', 'FROM_JPY']) {
            for (const amount of AMOUNTS) {
              const got = S.converterAmounts({ hasTrip, isJpyMode, tripRate, fallbackRate, amount, direction });
              const want = oldConverterAmounts(hasTrip ? {} : null, isJpyMode, tripRate, fallbackRate, amount, direction);
              sameAll(`conv ${hasTrip}/${isJpyMode}/${tripRate}/${fallbackRate}/${direction}/${amount}`,
                [got.effectiveRate, got.result], [want.effectiveRate, want.result]);
            }
          }
        }
      }
    }
  }
});

test('換算タブ：保存する4つの値が切り出す前の式と同じ（旅行のレート0で予備レートを使う場合を含む）', () => {
  for (const tripCurrency of CODES) {
    const isJpyMode = tripCurrency === 'JPY';
    for (const tripRate of RATES) {
      for (const fallbackRate of RATES) {
        for (const amount of AMOUNTS) {
          const a = S.converterAmounts({ hasTrip: true, isJpyMode, tripRate, fallbackRate, amount, direction: 'TO_JPY' });
          const got = S.converterSaveValues({ tripCurrency, isJpyMode, amount, result: a.result, effectiveRate: a.effectiveRate });
          const o = oldConverterAmounts({}, isJpyMode, tripRate, fallbackRate, amount, 'TO_JPY');
          const want = oldConverterSave(tripCurrency, isJpyMode, amount, o.result, o.effectiveRate);
          sameAll(`conv-save ${tripCurrency}/${tripRate}/${fallbackRate}/${amount}`, asArray(got), want);
        }
      }
    }
  }
});

test('ホーム（Web）：保存する4つの値が切り出す前の式と同じ（選んだ通貨と旅行の通貨が違う場合を含む）', () => {
  for (const isJpyMode of [true, false]) {
    for (const selectedCurrency of CODES) {
      for (const rate of RATES) {
        for (const inputNum of AMOUNTS) {
          for (const isReverse of [true, false]) {
            const a = S.deriveEntryAmounts({ isJpyMode, rate, inputNum, isReverse });
            const got = S.webHomeSaveValues({ isJpyMode, selectedCurrency, foreignAmount: a.foreignAmount, jpyAmount: a.jpyAmount, rate });
            const o = oldEntryAmounts(isJpyMode, rate, inputNum, isReverse);
            const want = oldWebSave(isJpyMode, selectedCurrency, o.foreignAmount, o.jpyAmount, rate);
            sameAll(`web ${isJpyMode}/${selectedCurrency}/${rate}/${inputNum}/${isReverse}`, asArray(got), want);
          }
        }
      }
    }
  }
});

test('代表例：円の旅行で 1200.5 円 → 1201 円・レート1／USD 旅行で $0.41×150 → 61.49999999999999（保存時は丸めない）', () => {
  const jpy = S.deriveEntryAmounts({ isJpyMode: true, rate: 1, inputNum: 1200.5, isReverse: false });
  sameAll('jpy', asArray(S.nativeHomeSaveValues({ baseCurrency: 'JPY', manualRate: 0, ...jpy })), ['JPY', 1201, 1201, 1]);
  const usd = S.deriveEntryAmounts({ isJpyMode: false, rate: 150, inputNum: 0.41, isReverse: false });
  sameAll('usd', asArray(S.nativeHomeSaveValues({ baseCurrency: 'USD', manualRate: 150, ...usd })), ['USD', 0.41, 0.41 * 150, 150]);
  // 逆換算：¥1000 を 150 で → foreign 6.666666666666667・jpy 1000
  const rev = S.deriveEntryAmounts({ isJpyMode: false, rate: 150, inputNum: 1000, isReverse: true });
  sameAll('rev', asArray(S.nativeHomeSaveValues({ baseCurrency: 'USD', manualRate: 150, ...rev })), ['USD', 1000 / 150, 1000, 150]);
});
