/**
 * 辞書の検査（GX-03 の一部・2026-11-28）。全言語が ja と同じキー・同じ補間名・同じ形（文字列か複数形か）を持つ。
 * キーの欠けは `tsc`（`Record<MessageKey, …>`）でも止まるが、補間名と形は型では見えないのでここで見る。
 */
import { deepEqual, equal, ok } from 'node:assert/strict';
import { register } from 'node:module';
import { test } from 'node:test';

register('../lib/proplus/ts-resolve-hook.mjs', import.meta.url);
const { DICTIONARIES } = await import('./dict/index.ts');
const { APP_LANGUAGES, placeholdersOf } = await import('./i18n-core.ts');

const ja = DICTIONARIES.ja;
const jaKeys = Object.keys(ja).sort();

test('全言語の辞書がある', () => {
  deepEqual(Object.keys(DICTIONARIES).sort(), [...APP_LANGUAGES].sort());
});

for (const lang of APP_LANGUAGES) {
  const dict = DICTIONARIES[lang];
  test(`${lang}: ja と同じキー（欠け・余りなし）`, () => {
    deepEqual(Object.keys(dict).sort(), jaKeys);
  });
  test(`${lang}: 補間名と形が ja と一致・空の訳が無い`, () => {
    for (const key of jaKeys) {
      const v = dict[key];
      const base = ja[key];
      equal(typeof v, typeof base, `${lang} ${key}: 形が違う`);
      deepEqual(placeholdersOf(v), placeholdersOf(base), `${lang} ${key}: 補間名が違う`);
      const texts = typeof v === 'string' ? [v] : [v.other, ...(v.one !== undefined ? [v.one] : [])];
      for (const t of texts) ok(t.trim().length > 0, `${lang} ${key}: 空の訳`);
    }
  });
}

test('en の複数形は one と other の両方を持つ', () => {
  for (const key of jaKeys) {
    const v = DICTIONARIES.en[key];
    if (typeof v !== 'string') ok(v.one !== undefined, `en ${key}: one が無い`);
  }
});

test('ko・zh-Hant の訳に英語の訳がそのまま残っていない・仮名が混ざっていない', () => {
  const allowSame = new Set(['common.ok']); // 'OK' は英字2文字なので下の判定にかからないが、意図して同じにする値はここへ書く
  for (const lang of ['ko', 'zh-Hant']) {
    for (const key of jaKeys) {
      const v = DICTIONARIES[lang][key];
      const e = DICTIONARIES.en[key];
      if (typeof v === 'string' && typeof e === 'string' && v === e && !allowSame.has(key) && /[A-Za-z]{3,}/.test(v)) {
        throw new Error(`${lang} ${key}: 英語の訳が残っている`);
      }
      const texts = typeof v === 'string' ? [v] : [v.other, ...(v.one !== undefined ? [v.one] : [])];
      for (const s of texts) if (/[぀-ヿ]/.test(s)) throw new Error(`${lang} ${key}: 仮名が残っている`);
    }
  }
});
