/**
 * GX-06 段階 b：国内の判定の共通化（設計書 `design/gx05-home-currency-design.md` §3・§12-2 S2）。
 * 1. 基準通貨が円の旅行・記録（既存のすべて）では、置き換える前の式（`trip.base_currency === 'JPY'`・
 *    `record.currency === 'JPY'`・`activeTrip?.base_currency === 'JPY'`）と同じ値
 * 2. 基準通貨が円以外の時の意味（訪日客の JPY は国内でない・USD の旅行で USD は国内）
 */
import { equal } from 'node:assert/strict';
import { register } from 'node:module';
import { test } from 'node:test';

register('../lib/proplus/ts-resolve-hook.mjs', import.meta.url);
const C = await import('./home-currency-core.ts');
const { CURRENCY_CODES } = await import('../constants/currencies.ts');

// 'JPY' と読まれる target_currency（既定・旧データ・壊れた値）
const READ_AS_JPY = ['JPY', undefined, null, '', ' ', 'jpy', 'usd', 'USD ', ' JPY', 'XYZ', 'toString', '__proto__', 0, {}, NaN];

test('旅行：基準通貨が円と読まれる旅行では、今の base_currency === "JPY" と同じ値', () => {
  for (const base of CURRENCY_CODES) {
    for (const target of READ_AS_JPY) {
      const trip = { base_currency: base, target_currency: target };
      equal(C.isDomesticTrip(trip), trip.base_currency === 'JPY', `${base}/${String(target)}`);
    }
  }
});

test('旅行が無い時は false（今の activeTrip?.base_currency === "JPY" と同じ）', () => {
  for (const t of [null, undefined]) {
    equal(C.isDomesticTrip(t), t?.base_currency === 'JPY');
    equal(C.isDomesticTrip(t), false);
  }
});

test('記録：基準通貨が円と読まれる記録では、今の currency === "JPY" と同じ値', () => {
  for (const cur of CURRENCY_CODES) {
    for (const home of READ_AS_JPY) {
      const rec = { currency: cur, home_currency: home };
      equal(C.isDomesticRecord(rec), rec.currency === 'JPY', `${cur}/${String(home)}`);
    }
  }
});

test('基準通貨が円以外：現地通貨＝基準通貨だけが国内（訪日客の JPY は国内でない）', () => {
  for (const home of CURRENCY_CODES) {
    for (const local of CURRENCY_CODES) {
      equal(C.isDomesticTrip({ base_currency: local, target_currency: home }), local === home, `trip ${local}/${home}`);
      equal(C.isDomesticRecord({ currency: local, home_currency: home }), local === home, `rec ${local}/${home}`);
    }
  }
  equal(C.isDomesticTrip({ base_currency: 'JPY', target_currency: 'USD' }), false);
  equal(C.isDomesticRecord({ currency: 'JPY', home_currency: 'KRW' }), false);
});

test('tripHomeCurrency は target_currency を正規化する', () => {
  equal(C.tripHomeCurrency({ target_currency: 'USD' }), 'USD');
  equal(C.tripHomeCurrency({ target_currency: '' }), 'JPY');
  equal(C.tripHomeCurrency({ target_currency: undefined }), 'JPY');
});
