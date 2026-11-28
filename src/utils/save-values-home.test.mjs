/**
 * `utils/save-values-core.ts` に基準通貨（`homeCurrency`）を足した段階 d（GX-06・2026-11-28）のテスト。
 * 切り出す前の式との比較（`save-values-core.test.mjs`）は1文字も変えずに残し、ここでは次を確かめる。
 *   1. 基準通貨に 'JPY' を明示しても、未指定・7通貨に無い値でも、切り出す前の式（commit `1bf69ce`）と `Object.is` で同じ
 *   2. 基準通貨が円以外：国内（現地通貨＝基準通貨）だけ基準通貨の桁で丸め・レート1・現地の額＝基準通貨の額
 *   3. 予備のレート（`exchange_rates`＝1単位あたりの円）は基準通貨が円の時だけ（換算タブ・Web のホームの両方）
 *   4. 画面と同じ順（`isDomesticTrip`・`tripHomeCurrency` → 額 → 保存）で 7×7 の組の国内の判定が1つにそろう
 */
import { ok } from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import { test } from 'node:test';

register('../lib/proplus/ts-resolve-hook.mjs', import.meta.url);
const S = await import('./save-values-core.ts');
const { convert, normalizeJpyInput } = await import('./currency.ts');
const { roundMoney } = await import('./money-core.ts');
const { isDomesticTrip, tripHomeCurrency } = await import('./home-currency-core.ts');

const CODES = ['JPY', 'USD', 'EUR', 'GBP', 'KRW', 'TWD', 'THB'];
const NON_JPY = CODES.filter((c) => c !== 'JPY');
const AMOUNTS = [0, -0, 1, 0.4, 0.5, 1.5, 2.5, -2.5, -0.5, 12.99, 12.345, 12.005, 1200.5, 1000, 0.1 + 0.2, 6.666666666666667,
  1e21, 1e-7, -5, Infinity, -Infinity, NaN];
const RATES = [0, -1, 1, 0.0067, 0.41, 1 / 150, 150, 152.5, 1370, 9.2, Infinity, NaN, undefined];
/** 実行時に 'JPY' と読む値（未指定・7通貨に無い値） */
const JPY_LIKE = ['JPY', undefined, null, '', 'jpy', 'XXX', 0];

// ---- 切り出す前の式（1bf69ce）の写し（save-values-core.test.mjs と同じ） ----
function oldEntryAmounts(isJpyMode, rate, inputNum, isReverse) {
  const foreignAmount = isJpyMode ? normalizeJpyInput(inputNum) : (isReverse ? convert(inputNum, rate, 'FROM_JPY') : inputNum);
  const jpyAmount = isJpyMode ? normalizeJpyInput(inputNum) : (isReverse ? inputNum : convert(inputNum, rate, 'TO_JPY'));
  return { foreignAmount, jpyAmount };
}
function oldNativeSave(activeTrip, foreignAmount, jpyAmount) {
  const currencyToSave = activeTrip.base_currency;
  const rateToSave = currencyToSave === 'JPY' ? 1 : activeTrip.manual_rate;
  const foreignAmountToSave = currencyToSave === 'JPY' ? jpyAmount : foreignAmount;
  return [currencyToSave, foreignAmountToSave, jpyAmount, rateToSave];
}
function oldConverterAmounts(activeTrip, isJpyMode, tripRate, ratesEntry, amount, direction) {
  const effectiveRate = !activeTrip ? 0 : isJpyMode ? 1 : (tripRate > 0 ? tripRate : (ratesEntry ?? 0));
  const result = !activeTrip ? 0 : isJpyMode ? normalizeJpyInput(amount) : convert(amount, effectiveRate, direction);
  return { effectiveRate, result };
}
function oldConverterSave(tripCurrency, isJpyMode, amount, result, effectiveRate) {
  return [tripCurrency, isJpyMode ? result : amount, result, effectiveRate];
}
// src/app/(tabs)/index.web.tsx:58-60（1bf69ce）：globalRate = rates[selectedCurrency] ?? 0
function oldWebRate(isJpyMode, tripRate, ratesEntry) {
  const globalRate = ratesEntry ?? 0;
  return isJpyMode ? 1 : (tripRate > 0 ? tripRate : globalRate);
}
function oldWebSave(isJpyMode, selectedCurrency, foreignAmount, jpyAmount, rate) {
  return [isJpyMode ? 'JPY' : selectedCurrency, foreignAmount, jpyAmount, rate];
}

const asArray = (v) => [v.currency, v.foreignAmount, v.jpyAmount, v.rate];
function sameAll(label, got, want) {
  ok(got.length === want.length, `${label}: 長さ`);
  for (let i = 0; i < want.length; i++) {
    ok(Object.is(got[i], want[i]), `${label}: [${i}] got=${String(got[i])} want=${String(want[i])}`);
  }
}

// ───────────── 1. 基準通貨が円（明示・未指定・壊れた値）なら切り出す前と同じ ─────────────

test('基準通貨が円（明示・未指定・7通貨に無い値）：4つの関数の値が切り出す前の式と同じ', () => {
  let n = 0;
  for (const home of JPY_LIKE) {
    for (const isJpyMode of [true, false]) {
      for (const isReverse of [true, false]) {
        for (const rate of RATES) {
          for (const inputNum of AMOUNTS) {
            const got = S.deriveEntryAmounts({ isJpyMode, rate, inputNum, isReverse, homeCurrency: home });
            const want = oldEntryAmounts(isJpyMode, rate, inputNum, isReverse);
            sameAll(`entry ${home}/${isJpyMode}/${isReverse}/${rate}/${inputNum}`,
              [got.foreignAmount, got.jpyAmount], [want.foreignAmount, want.jpyAmount]);
            n++;
          }
        }
      }
    }
    for (const base of CODES) {
      for (const manualRate of RATES) {
        for (const f of AMOUNTS) {
          for (const j of [0, 1201, 61.49999999999999, NaN, -0]) {
            const got = S.nativeHomeSaveValues({ baseCurrency: base, manualRate, foreignAmount: f, jpyAmount: j, homeCurrency: home });
            sameAll(`native ${home}/${base}/${manualRate}/${f}/${j}`, asArray(got), oldNativeSave({ base_currency: base, manual_rate: manualRate }, f, j));
            n++;
          }
        }
      }
    }
    for (const hasTrip of [true, false]) {
      for (const isJpyMode of [true, false]) {
        for (const tripRate of RATES) {
          for (const fallbackRate of RATES) {
            for (const direction of ['TO_JPY', 'FROM_JPY']) {
              for (const amount of AMOUNTS) {
                const got = S.converterAmounts({ hasTrip, isJpyMode, tripRate, fallbackRate, amount, direction, homeCurrency: home });
                const want = oldConverterAmounts(hasTrip ? {} : null, isJpyMode, tripRate, fallbackRate, amount, direction);
                sameAll(`conv ${home}/${hasTrip}/${isJpyMode}/${tripRate}/${fallbackRate}/${direction}/${amount}`,
                  [got.effectiveRate, got.result], [want.effectiveRate, want.result]);
                n++;
              }
            }
          }
          const got = S.webEntryRate({ isJpyMode, tripRate, fallbackRate: 150, homeCurrency: home });
          ok(Object.is(got, oldWebRate(isJpyMode, tripRate, 150)), `webRate ${home}/${isJpyMode}/${tripRate}`);
        }
      }
    }
    for (const isJpyMode of [true, false]) {
      for (const selectedCurrency of CODES) {
        for (const tripRate of RATES) {
          for (const fallbackRate of RATES) {
            const got = S.webEntryRate({ isJpyMode, tripRate, fallbackRate, homeCurrency: home });
            ok(Object.is(got, oldWebRate(isJpyMode, tripRate, fallbackRate)), `webRate ${home}/${isJpyMode}/${tripRate}/${fallbackRate}`);
            n++;
          }
        }
        for (const rate of [0, 1, 150, NaN]) {
          for (const inputNum of AMOUNTS) {
            const a = S.deriveEntryAmounts({ isJpyMode, rate, inputNum, isReverse: false, homeCurrency: home });
            const got = S.webHomeSaveValues({ isJpyMode, selectedCurrency, foreignAmount: a.foreignAmount, jpyAmount: a.jpyAmount, rate, homeCurrency: home });
            const o = oldEntryAmounts(isJpyMode, rate, inputNum, false);
            sameAll(`web ${home}/${isJpyMode}/${selectedCurrency}/${rate}/${inputNum}`, asArray(got), oldWebSave(isJpyMode, selectedCurrency, o.foreignAmount, o.jpyAmount, rate));
            n++;
          }
        }
      }
    }
  }
  ok(n > 100000, `組の数 ${n}`);
});

test('基準通貨が円の旅行：画面と同じ順（isDomesticTrip → 額 → 保存）で3経路とも切り出す前と同じ', () => {
  for (const base of CODES) {
    for (const target of ['JPY', null, '', 'jpy']) {
      const trip = { base_currency: base, target_currency: target, manual_rate: 150 };
      const isDomestic = isDomesticTrip(trip);
      const home = tripHomeCurrency(trip);
      const oldIsJpy = base === 'JPY';
      ok(isDomestic === oldIsJpy && home === 'JPY', `判定 ${base}/${target}`);
      for (const manualRate of RATES) {
        for (const isRev of [true, false]) {
          for (const inputNum of AMOUNTS) {
            // ホーム（ネイティブ）index.tsx
            const rate = isDomestic ? 1 : (manualRate ?? 0);
            const isReverse = !isDomestic && isRev;
            const a = S.deriveEntryAmounts({ isJpyMode: isDomestic, rate, inputNum, isReverse, homeCurrency: home });
            const got = S.nativeHomeSaveValues({ baseCurrency: base, manualRate, ...a, homeCurrency: home });
            const o = oldEntryAmounts(oldIsJpy, oldIsJpy ? 1 : (manualRate ?? 0), inputNum, !oldIsJpy && isRev);
            sameAll(`native-flow ${base}/${target}/${manualRate}/${isRev}/${inputNum}`, asArray(got),
              oldNativeSave({ base_currency: base, manual_rate: manualRate }, o.foreignAmount, o.jpyAmount));
            // 換算タブ converter.tsx（保存は TO_JPY だけ）
            for (const fallbackRate of [undefined, 0, 150]) {
              const c = S.converterAmounts({ hasTrip: true, isJpyMode: isDomestic, tripRate: manualRate ?? 0, fallbackRate, amount: inputNum, direction: 'TO_JPY', homeCurrency: home });
              const cv = S.converterSaveValues({ tripCurrency: base, isJpyMode: isDomestic, amount: inputNum, result: c.result, effectiveRate: c.effectiveRate });
              const oc = oldConverterAmounts({}, oldIsJpy, manualRate ?? 0, fallbackRate, inputNum, 'TO_JPY');
              sameAll(`conv-flow ${base}/${target}/${manualRate}/${fallbackRate}/${inputNum}`, asArray(cv),
                oldConverterSave(base, oldIsJpy, inputNum, oc.result, oc.effectiveRate));
            }
            // ホーム（Web）index.web.tsx
            for (const sel of ['USD', 'KRW']) {
              for (const fallbackRate of [undefined, 9.2]) {
                const wr = S.webEntryRate({ isJpyMode: isDomestic, tripRate: manualRate ?? 0, fallbackRate, homeCurrency: home });
                const wa = S.deriveEntryAmounts({ isJpyMode: isDomestic, rate: wr, inputNum, isReverse, homeCurrency: home });
                const wv = S.webHomeSaveValues({ isJpyMode: isDomestic, selectedCurrency: sel, ...wa, rate: wr, homeCurrency: home });
                const owr = oldWebRate(oldIsJpy, manualRate ?? 0, fallbackRate);
                const owa = oldEntryAmounts(oldIsJpy, owr, inputNum, !oldIsJpy && isRev);
                sameAll(`web-flow ${base}/${target}/${manualRate}/${sel}/${fallbackRate}/${inputNum}`, asArray(wv),
                  oldWebSave(oldIsJpy, sel, owa.foreignAmount, owa.jpyAmount, owr));
              }
            }
          }
        }
      }
    }
  }
});

// ───────────── 2. 基準通貨が円以外 ─────────────

test('基準通貨が円以外・国内（L＝H）：入力を基準通貨の桁で丸め、レート1・現地の額＝基準通貨の額で保存する', () => {
  for (const home of NON_JPY) {
    for (const inputNum of AMOUNTS) {
      const a = S.deriveEntryAmounts({ isJpyMode: true, rate: 1, inputNum, isReverse: false, homeCurrency: home });
      const r = roundMoney(inputNum, home);
      ok(Object.is(a.foreignAmount, r) && Object.is(a.jpyAmount, r), `${home}/${inputNum}`);
      const v = S.nativeHomeSaveValues({ baseCurrency: home, manualRate: 0, ...a, homeCurrency: home });
      sameAll(`native ${home}/${inputNum}`, asArray(v), [home, r, r, 1]);
      const c = S.converterAmounts({ hasTrip: true, isJpyMode: true, tripRate: 0, fallbackRate: 150, amount: inputNum, direction: 'TO_JPY', homeCurrency: home });
      ok(Object.is(c.effectiveRate, 1) && Object.is(c.result, r), `conv ${home}/${inputNum}`);
      sameAll(`conv-save ${home}/${inputNum}`, asArray(S.converterSaveValues({ tripCurrency: home, isJpyMode: true, amount: inputNum, result: c.result, effectiveRate: c.effectiveRate })), [home, r, r, 1]);
      const w = S.webHomeSaveValues({ isJpyMode: true, selectedCurrency: 'GBP', ...a, rate: 1, homeCurrency: home });
      sameAll(`web ${home}/${inputNum}`, asArray(w), [home, r, r, 1]);
    }
  }
  // 代表例：小数の通貨は 0.01 単位、0桁の通貨（KRW・TWD）は整数
  const usd = S.deriveEntryAmounts({ isJpyMode: true, rate: 1, inputNum: 12.345, isReverse: false, homeCurrency: 'USD' });
  ok(usd.jpyAmount === 12.35 && usd.foreignAmount === 12.35, `USD 12.345 → ${usd.jpyAmount}`);
  ok(S.deriveEntryAmounts({ isJpyMode: true, rate: 1, inputNum: 12.005, isReverse: false, homeCurrency: 'EUR' }).jpyAmount === 12.01, 'EUR 12.005 → 12.01');
  ok(S.deriveEntryAmounts({ isJpyMode: true, rate: 1, inputNum: 1200.5, isReverse: false, homeCurrency: 'KRW' }).jpyAmount === 1201, 'KRW 1200.5 → 1201');
  ok(S.deriveEntryAmounts({ isJpyMode: true, rate: 1, inputNum: 0.4, isReverse: false, homeCurrency: 'TWD' }).jpyAmount === 0, 'TWD 0.4 → 0（保存できない額）');
  ok(S.deriveEntryAmounts({ isJpyMode: true, rate: 1, inputNum: 0.004, isReverse: false, homeCurrency: 'USD' }).jpyAmount === 0, 'USD 0.004 → 0（保存できない額）');
  // 有限でない入力は0（保存できない）
  for (const home of NON_JPY) {
    for (const x of [NaN, Infinity, -Infinity]) {
      const a = S.deriveEntryAmounts({ isJpyMode: true, rate: 1, inputNum: x, isReverse: false, homeCurrency: home });
      ok(a.jpyAmount === 0 && a.foreignAmount === 0, `${home}/${x}`);
    }
  }
});

test('基準通貨が円以外・外貨（L≠H）：今の円の外貨と同じ規則（丸めない・レートは旅行のレート・逆換算は基準通貨の額をそのまま）', () => {
  for (const home of NON_JPY) {
    for (const base of CODES.filter((c) => c !== home)) {
      for (const manualRate of [0.41, 1 / 150, 1.08, 9.2, 0]) {
        for (const inputNum of [0.41, 12.345, 1000, 0.1 + 0.2]) {
          const fwd = S.deriveEntryAmounts({ isJpyMode: false, rate: manualRate, inputNum, isReverse: false, homeCurrency: home });
          ok(Object.is(fwd.foreignAmount, inputNum) && Object.is(fwd.jpyAmount, convert(inputNum, manualRate, 'TO_JPY')), `fwd ${home}/${base}/${manualRate}/${inputNum}`);
          sameAll(`native-fwd ${home}/${base}`, asArray(S.nativeHomeSaveValues({ baseCurrency: base, manualRate, ...fwd, homeCurrency: home })),
            [base, inputNum, convert(inputNum, manualRate, 'TO_JPY'), manualRate]);
          const rev = S.deriveEntryAmounts({ isJpyMode: false, rate: manualRate, inputNum, isReverse: true, homeCurrency: home });
          ok(Object.is(rev.jpyAmount, inputNum) && Object.is(rev.foreignAmount, convert(inputNum, manualRate, 'FROM_JPY')), `rev ${home}/${base}/${manualRate}/${inputNum}`);
        }
      }
    }
  }
  // 訪日客（L='JPY'・H='USD'）：国内として扱わない（レート1・整数円に丸めない）
  const visitor = { base_currency: 'JPY', target_currency: 'USD', manual_rate: 0.0067 };
  ok(isDomesticTrip(visitor) === false, '訪日客は国内ではない');
  const a = S.deriveEntryAmounts({ isJpyMode: false, rate: 0.0067, inputNum: 1980, isReverse: false, homeCurrency: 'USD' });
  sameAll('visitor', asArray(S.nativeHomeSaveValues({ baseCurrency: 'JPY', manualRate: 0.0067, ...a, homeCurrency: 'USD' })),
    ['JPY', 1980, 1980 * 0.0067, 0.0067]);
  const c = S.converterAmounts({ hasTrip: true, isJpyMode: false, tripRate: 0.0067, fallbackRate: 1, amount: 1980.5, direction: 'TO_JPY', homeCurrency: 'USD' });
  ok(Object.is(c.effectiveRate, 0.0067) && Object.is(c.result, 1980.5 * 0.0067), '訪日客の換算タブ：円の入力を整数に丸めない');
});

// ───────────── 3. 予備のレートは基準通貨が円の時だけ ─────────────

test('予備のレート：換算タブ・Web のホームとも、基準通貨が円の時だけ使い、円以外では「レート未設定」（0）', () => {
  for (const home of CODES) {
    for (const fallbackRate of [undefined, 0, 150, 0.0067]) {
      for (const tripRate of [0, -1, NaN, 152.5]) {
        const c = S.converterAmounts({ hasTrip: true, isJpyMode: false, tripRate, fallbackRate, amount: 10, direction: 'TO_JPY', homeCurrency: home });
        const w = S.webEntryRate({ isJpyMode: false, tripRate, fallbackRate, homeCurrency: home });
        const want = tripRate > 0 ? tripRate : (home === 'JPY' ? (fallbackRate ?? 0) : 0);
        ok(Object.is(c.effectiveRate, want), `conv ${home}/${tripRate}/${fallbackRate} got=${c.effectiveRate}`);
        ok(Object.is(w, want), `web ${home}/${tripRate}/${fallbackRate} got=${w}`);
        if (home !== 'JPY' && !(tripRate > 0)) {
          // 換算タブの「保存できるか」（hasRate = isDomestic || effectiveRate > 0）が false
          ok(!(c.effectiveRate > 0) && c.result === 0, `conv 保存できない ${home}/${tripRate}/${fallbackRate}`);
          ok(!(w > 0), `web 保存できない ${home}/${tripRate}/${fallbackRate}`);
        }
      }
    }
  }
});

// ───────────── 4. 国内の判定が1つにそろう ─────────────

test('7×7 の旅行（L・H）：画面と同じ順で作ると、L＝H の時だけレート1・現地の額＝基準通貨の額', () => {
  for (const base of CODES) {
    for (const target of CODES) {
      const trip = { base_currency: base, target_currency: target, manual_rate: 1.5 };
      const isDomestic = isDomesticTrip(trip);
      const home = tripHomeCurrency(trip);
      ok(isDomestic === (base === target) && home === target, `判定 ${base}/${target}`);
      for (const inputNum of [1, 12.345, 1200.5]) {
        const a = S.deriveEntryAmounts({ isJpyMode: isDomestic, rate: isDomestic ? 1 : 1.5, inputNum, isReverse: false, homeCurrency: home });
        const v = S.nativeHomeSaveValues({ baseCurrency: base, manualRate: 1.5, ...a, homeCurrency: home });
        ok(v.currency === base, `通貨 ${base}/${target}`);
        if (base === target) {
          ok(v.rate === 1 && Object.is(v.foreignAmount, v.jpyAmount) && v.jpyAmount === roundMoney(inputNum, home), `国内 ${base}/${target}/${inputNum}`);
        } else {
          ok(v.rate === 1.5 && v.foreignAmount === inputNum && Object.is(v.jpyAmount, inputNum * 1.5), `外貨 ${base}/${target}/${inputNum}`);
        }
      }
    }
  }
});

// ───────────── 5. 3画面の配線（Fable SF2：純粋関数のテストだけでは、画面が旧い判定に戻っても円の旅行では気づけない） ─────────────

test('配線：3画面とも計算・保存に isDomesticTrip と tripHomeCurrency を渡し、旧い isJpyMode を計算に使わない', () => {
  const DECL = [
    'const isDomestic = isDomesticTrip(activeTrip);',
    "const homeCurrency: CurrencyCode = activeTrip ? tripHomeCurrency(activeTrip) : 'JPY';",
  ];
  const WIRING = {
    '../app/(tabs)/index.tsx': [
      ...DECL,
      'const rate = activeTrip ? (isDomestic ? 1 : tripRate) : globalRate;',
      "const isReverse = !isDomestic && inputMode === 'FROM_JPY';",
      'deriveEntryAmounts({ isJpyMode: isDomestic, rate, inputNum, isReverse, homeCurrency })',
      'const canSave = isDomestic\n',
      '      jpyAmount,\n      homeCurrency,\n    });',
      '{!isDomestic && (\n                    manualOpenByDefault',
    ],
    '../app/(tabs)/converter.tsx': [
      ...DECL,
      "const isReverse = !!activeTrip && !isDomestic && direction === 'FROM_JPY';",
      '    isJpyMode: isDomestic,\n    tripRate,\n    fallbackRate: rates[tripCurrency as CurrencyCode],\n    amount,\n    direction,\n    homeCurrency,\n  });',
      'const hasRate = isDomestic || effectiveRate > 0;',
      '(!isDomestic || result > 0)',
      'converterSaveValues({ tripCurrency, isJpyMode: isDomestic, amount, result, effectiveRate })',
      '{!isDomestic && (\n            <View style={styles.segment}>',
    ],
    '../app/(tabs)/index.web.tsx': [
      ...DECL,
      'webEntryRate({ isJpyMode: isDomestic, tripRate, fallbackRate: rates[selectedCurrency], homeCurrency })',
      "const isReverse = !isDomestic && inputMode === 'FROM_JPY';",
      'deriveEntryAmounts({ isJpyMode: isDomestic, rate, inputNum, isReverse, homeCurrency })',
      'const canSave = isDomestic\n',
      'webHomeSaveValues({ isJpyMode: isDomestic, selectedCurrency, foreignAmount, jpyAmount, rate, homeCurrency })',
      '{!isDomestic && (\n                <View style={styles.inputModeRow}>',
    ],
  };
  for (const [p, needles] of Object.entries(WIRING)) {
    const src = readFileSync(new URL(p, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
    for (const n of needles) ok(src.includes(n), `${p}: ${n}`);
    // 旧い判定を計算・保存の関数へ渡していない（表示用の isJpyMode は S2・S3 まで残る）
    ok(!/isJpyMode(,| \})/.test(src.replace(/isJpyMode: isDomestic/g, '')), `${p}: isJpyMode を関数へ渡している`);
    ok(!src.includes('globalRate = rates[selectedCurrency]') || p.endsWith('index.tsx'), `${p}: 予備のレートを直接使っている`);
  }
});
