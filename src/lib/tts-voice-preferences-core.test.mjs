/**
 * TTS voice設定JSONのparse・更新ロジックの純粋関数テスト。
 *
 * 実行: node --test src/lib/tts-voice-preferences-core.test.mjs
 * （既存の src/config/speech-locales.test.mjs 等と同じ方式）
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { mergeVoicePreference, parseVoicePreferences } = await import('./tts-voice-preferences-core.ts');

// MARK: - parseVoicePreferences

test('parseVoicePreferences: 正常なJSONをそのままオブジェクトへ変換する', () => {
  const result = parseVoicePreferences('{"ja":"voice-a","en":"voice-b"}');
  assert.deepEqual(result, { ja: 'voice-a', en: 'voice-b' });
});

test('parseVoicePreferences: nullは空オブジェクト（初回起動・未保存）', () => {
  assert.deepEqual(parseVoicePreferences(null), {});
});

test('parseVoicePreferences: undefinedは空オブジェクト', () => {
  assert.deepEqual(parseVoicePreferences(undefined), {});
});

test('parseVoicePreferences: 壊れたJSONは空オブジェクト（TTS本体を壊さない）', () => {
  assert.deepEqual(parseVoicePreferences('{not valid json'), {});
});

test('parseVoicePreferences: 配列はオブジェクトではないため空オブジェクト', () => {
  assert.deepEqual(parseVoicePreferences('["ja","en"]'), {});
});

test('parseVoicePreferences: nullリテラルは空オブジェクト', () => {
  assert.deepEqual(parseVoicePreferences('null'), {});
});

test('parseVoicePreferences: 数値・真偽値等の非文字列値は無視する', () => {
  const result = parseVoicePreferences('{"ja":"voice-a","en":123,"ko":true,"it":null}');
  assert.deepEqual(result, { ja: 'voice-a' });
});

test('parseVoicePreferences: 空文字列の値は無視する（削除済みキーの名残を拾わない）', () => {
  const result = parseVoicePreferences('{"ja":"voice-a","en":""}');
  assert.deepEqual(result, { ja: 'voice-a' });
});

test('parseVoicePreferences: 空オブジェクトは空オブジェクトのまま', () => {
  assert.deepEqual(parseVoicePreferences('{}'), {});
});

// MARK: - mergeVoicePreference

test('mergeVoicePreference: 新しい言語のvoiceを追加する', () => {
  const result = mergeVoicePreference({ ja: 'voice-a' }, 'en', 'voice-b');
  assert.deepEqual(result, { ja: 'voice-a', en: 'voice-b' });
});

test('mergeVoicePreference: 既存言語のvoiceを上書きする', () => {
  const result = mergeVoicePreference({ ja: 'voice-a' }, 'ja', 'voice-new');
  assert.deepEqual(result, { ja: 'voice-new' });
});

test('mergeVoicePreference: identifier=nullでその言語をauto（キー削除）へ戻す', () => {
  const result = mergeVoicePreference({ ja: 'voice-a', en: 'voice-b' }, 'ja', null);
  assert.deepEqual(result, { en: 'voice-b' });
});

test('mergeVoicePreference: 存在しない言語をnullで戻しても何も起きない', () => {
  const result = mergeVoicePreference({ ja: 'voice-a' }, 'ko', null);
  assert.deepEqual(result, { ja: 'voice-a' });
});

test('mergeVoicePreference: 他言語の設定には影響しない', () => {
  const prefs = { ja: 'voice-a', en: 'voice-b', ko: 'voice-c' };
  const result = mergeVoicePreference(prefs, 'en', 'voice-new');
  assert.deepEqual(result, { ja: 'voice-a', en: 'voice-new', ko: 'voice-c' });
});

test('mergeVoicePreference: 元のオブジェクトを変更しない（イミュータブル）', () => {
  const prefs = { ja: 'voice-a' };
  mergeVoicePreference(prefs, 'ja', null);
  assert.deepEqual(prefs, { ja: 'voice-a' });
});
