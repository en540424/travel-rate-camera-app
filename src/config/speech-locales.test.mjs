/**
 * 音声認識locale / 読み上げvoice解決の純粋関数テスト。
 *
 * 実行: node --test src/config/speech-locales.test.mjs
 * （既存の src/lib/text-translation-core.test.mjs・src/utils/extract-prices.test.mjs と同じ方式。
 *  jest等を新規導入せず、Node組み込みのtest runnerで追加依存なしに実行する。
 *  .mjsはtsconfig.jsonのinclude対象外のため`tsc --noEmit`のスコープに影響しない）
 *
 * 対象モジュールがreact-native・nativeモジュール・`@/`エイリアスをimportしないことが前提。
 * import解決に失敗するようになったら、対象側に実行時importが混入した合図。
 * **packageやnativeをここから直接呼ばない**（純粋resolverだけを検証する）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

const {
  getLanguageSubtag,
  getSpeechLocaleCandidate,
  getTtsLanguageCandidate,
  normalizeLocale,
  resolveSpeechLocale,
  resolveTtsVoiceLanguage,
  selectEnhancedVoiceIdentifier,
} = await import('./speech-locales.ts');

/** 実機のSFSpeechRecognizer.supportedLocales()を模した一覧（地域付き） */
const SUPPORTED_LOCALES = [
  'ar-SA',
  'de-DE',
  'en-AU',
  'en-GB',
  'en-US',
  'es-ES',
  'fr-FR',
  'it-IT',
  'ja-JP',
  'ko-KR',
  'pt-BR',
  'ru-RU',
  'th-TH',
  'zh-CN',
  'zh-HK',
  'zh-TW',
];

// MARK: - 候補表

test('getSpeechLocaleCandidate: 翻訳言語コードから音声認識locale候補を作る', async (t) => {
  await t.test('en → en-US', () => {
    assert.equal(getSpeechLocaleCandidate('en'), 'en-US');
  });
  await t.test('ja → ja-JP', () => {
    assert.equal(getSpeechLocaleCandidate('ja'), 'ja-JP');
  });
  await t.test('ko → ko-KR', () => {
    assert.equal(getSpeechLocaleCandidate('ko'), 'ko-KR');
  });
  await t.test('th → th-TH', () => {
    assert.equal(getSpeechLocaleCandidate('th'), 'th-TH');
  });
  await t.test('zh-Hant → zh-TW', () => {
    assert.equal(getSpeechLocaleCandidate('zh-Hant'), 'zh-TW');
  });
  await t.test('zh-Hans → zh-CN', () => {
    assert.equal(getSpeechLocaleCandidate('zh-Hans'), 'zh-CN');
  });
  await t.test('表に無いコードはコード自身を候補にする（推測で地域を足さない）', () => {
    assert.equal(getSpeechLocaleCandidate('vi'), 'vi');
  });
});

test('getTtsLanguageCandidate: 読み上げは中国語系だけ地域付きへ寄せる', async (t) => {
  await t.test('ja / en / ko / th はそのまま', () => {
    assert.equal(getTtsLanguageCandidate('ja'), 'ja');
    assert.equal(getTtsLanguageCandidate('en'), 'en');
    assert.equal(getTtsLanguageCandidate('ko'), 'ko');
    assert.equal(getTtsLanguageCandidate('th'), 'th');
  });
  await t.test('zh-Hant → zh-TW / zh-Hans → zh-CN', () => {
    assert.equal(getTtsLanguageCandidate('zh-Hant'), 'zh-TW');
    assert.equal(getTtsLanguageCandidate('zh-Hans'), 'zh-CN');
  });
});

// MARK: - 正規化

test('normalizeLocale: アンダースコア区切り・大文字小文字を吸収する', async (t) => {
  await t.test('en_US と en-US を同一視できる形にする', () => {
    assert.equal(normalizeLocale('en_US'), normalizeLocale('en-US'));
  });
  await t.test('大文字小文字を無視する', () => {
    assert.equal(normalizeLocale('ZH-hant'), 'zh-hant');
  });
});

test('getLanguageSubtag: 言語subtagだけを取り出す', async (t) => {
  await t.test('zh-Hant → zh', () => {
    assert.equal(getLanguageSubtag('zh-Hant'), 'zh');
  });
  await t.test('en-US → en', () => {
    assert.equal(getLanguageSubtag('en-US'), 'en');
  });
  await t.test('ja → ja', () => {
    assert.equal(getLanguageSubtag('ja'), 'ja');
  });
});

// MARK: - 音声認識localeの解決

test('resolveSpeechLocale: 候補が実機一覧に完全一致すればexact', async (t) => {
  await t.test('en → en-US', () => {
    assert.deepEqual(resolveSpeechLocale('en', SUPPORTED_LOCALES), {
      status: 'exact',
      locale: 'en-US',
    });
  });
  await t.test('ja → ja-JP', () => {
    assert.deepEqual(resolveSpeechLocale('ja', SUPPORTED_LOCALES), {
      status: 'exact',
      locale: 'ja-JP',
    });
  });
  await t.test('ko → ko-KR', () => {
    assert.deepEqual(resolveSpeechLocale('ko', SUPPORTED_LOCALES), {
      status: 'exact',
      locale: 'ko-KR',
    });
  });
  await t.test('th → th-TH', () => {
    assert.deepEqual(resolveSpeechLocale('th', SUPPORTED_LOCALES), {
      status: 'exact',
      locale: 'th-TH',
    });
  });
  await t.test('zh-Hant → zh-TW', () => {
    assert.deepEqual(resolveSpeechLocale('zh-Hant', SUPPORTED_LOCALES), {
      status: 'exact',
      locale: 'zh-TW',
    });
  });
  await t.test('zh-Hans → zh-CN', () => {
    assert.deepEqual(resolveSpeechLocale('zh-Hans', SUPPORTED_LOCALES), {
      status: 'exact',
      locale: 'zh-CN',
    });
  });
});

test('resolveSpeechLocale: 実機一覧がアンダースコア形式でも取りこぼさない', () => {
  // Foundationの`Locale.identifier`がICU正準形（en_US）で返るケース。
  // ここで落ちると「対応しているのにマイクが無効」になるため必ず拾う。
  assert.deepEqual(resolveSpeechLocale('en', ['en_US', 'ja_JP']), {
    status: 'exact',
    locale: 'en_US',
  });
});

test('resolveSpeechLocale: 候補が無ければ言語subtag一致でフォールバックする', async (t) => {
  await t.test('en-USが無くen-GBだけある端末', () => {
    assert.deepEqual(resolveSpeechLocale('en', ['en-GB', 'ja-JP']), {
      status: 'fallback',
      locale: 'en-GB',
    });
  });
  await t.test('zh-TWが無くzh-CNだけある端末（同じzh）', () => {
    assert.deepEqual(resolveSpeechLocale('zh-Hant', ['zh-CN', 'ja-JP']), {
      status: 'fallback',
      locale: 'zh-CN',
    });
  });
  await t.test('候補表に無い言語も実機にあれば拾える', () => {
    assert.deepEqual(resolveSpeechLocale('vi', ['vi-VN', 'ja-JP']), {
      status: 'fallback',
      locale: 'vi-VN',
    });
  });
});

test('resolveSpeechLocale: 該当が無ければunsupported（マイクを無効化する）', async (t) => {
  await t.test('実機一覧に同じ言語が一切ない', () => {
    assert.deepEqual(resolveSpeechLocale('th', ['en-US', 'ja-JP']), { status: 'unsupported' });
  });
  await t.test('実機一覧が空（取得失敗・非対応環境）', () => {
    assert.deepEqual(resolveSpeechLocale('ja', []), { status: 'unsupported' });
  });
  await t.test('source未確定（null / 空文字）', () => {
    assert.deepEqual(resolveSpeechLocale(null, SUPPORTED_LOCALES), { status: 'unsupported' });
    assert.deepEqual(resolveSpeechLocale('', SUPPORTED_LOCALES), { status: 'unsupported' });
  });
});

test('resolveSpeechLocale: 翻訳側stateを書き換えない純粋変換である', () => {
  // 入力（source言語コード・実機一覧）を破壊しないこと。
  // 言語選択stateは音声側の都合で書き換えてはならない、という実機合格仕様の担保。
  const languageCode = 'zh-Hant';
  const supported = [...SUPPORTED_LOCALES];

  const first = resolveSpeechLocale(languageCode, supported);
  const second = resolveSpeechLocale(languageCode, supported);

  assert.equal(languageCode, 'zh-Hant', 'source言語コードが変化していない');
  assert.deepEqual(supported, SUPPORTED_LOCALES, '実機一覧が変化していない');
  assert.deepEqual(first, second, '同じ入力に対して常に同じ結果を返す');
});

// MARK: - 読み上げvoiceの解決

/** 実機のgetAvailableVoicesAsync()を模した一覧 */
const VOICES = [
  { identifier: 'com.apple.voice.ja-JP.1', language: 'ja-JP' },
  { identifier: 'com.apple.voice.en-US.1', language: 'en-US' },
  { identifier: 'com.apple.voice.ko-KR.1', language: 'ko-KR' },
  { identifier: 'com.apple.voice.th-TH.1', language: 'th-TH' },
  { identifier: 'com.apple.voice.zh-TW.1', language: 'zh-TW' },
];

test('resolveTtsVoiceLanguage: 完全一致するvoiceがあればexact', async (t) => {
  await t.test('zh-Hant → zh-TW（候補表で地域付きへ寄せた上で完全一致）', () => {
    assert.deepEqual(resolveTtsVoiceLanguage('zh-Hant', VOICES), {
      status: 'exact',
      language: 'zh-TW',
    });
  });
});

test('resolveTtsVoiceLanguage: 言語subtag一致でフォールバックする', async (t) => {
  await t.test('ja → ja-JP voice', () => {
    assert.deepEqual(resolveTtsVoiceLanguage('ja', VOICES), {
      status: 'subtag',
      language: 'ja-JP',
    });
  });
  await t.test('en → en-US voice', () => {
    assert.deepEqual(resolveTtsVoiceLanguage('en', VOICES), {
      status: 'subtag',
      language: 'en-US',
    });
  });
  await t.test('ko → ko-KR voice', () => {
    assert.deepEqual(resolveTtsVoiceLanguage('ko', VOICES), {
      status: 'subtag',
      language: 'ko-KR',
    });
  });
  await t.test('th → th-TH voice', () => {
    assert.deepEqual(resolveTtsVoiceLanguage('th', VOICES), {
      status: 'subtag',
      language: 'th-TH',
    });
  });
});

test('resolveTtsVoiceLanguage: 該当voiceが無ければunsupported', async (t) => {
  await t.test('別言語のvoiceで代読しない', () => {
    // ここでen-USへ落とすと「タイ語をアメリカ英語の音声で読む」事故になる
    assert.deepEqual(resolveTtsVoiceLanguage('th', [VOICES[1]]), { status: 'unsupported' });
  });
  await t.test('voice一覧が空', () => {
    assert.deepEqual(resolveTtsVoiceLanguage('ja', []), { status: 'unsupported' });
  });
  await t.test('target未確定（null / 空文字）', () => {
    assert.deepEqual(resolveTtsVoiceLanguage(null, VOICES), { status: 'unsupported' });
    assert.deepEqual(resolveTtsVoiceLanguage('', VOICES), { status: 'unsupported' });
  });
});

// MARK: - Enhanced voice選択

/** quality付きのvoice一覧。同一言語にDefault/Enhancedが混在する端末を模す */
const VOICES_WITH_QUALITY = [
  { identifier: 'com.apple.voice.ja-JP.Default', language: 'ja-JP', quality: 'Default' },
  { identifier: 'com.apple.voice.ja-JP.Enhanced', language: 'ja-JP', quality: 'Enhanced' },
  { identifier: 'com.apple.voice.en-US.Default', language: 'en-US', quality: 'Default' },
  { identifier: 'com.apple.voice.ko-KR.Default', language: 'ko-KR', quality: 'Default' },
];

test('selectEnhancedVoiceIdentifier: 完全一致するEnhanced voiceを優先する', () => {
  assert.equal(
    selectEnhancedVoiceIdentifier('ja-JP', VOICES_WITH_QUALITY),
    'com.apple.voice.ja-JP.Enhanced',
  );
});

test('selectEnhancedVoiceIdentifier: 完全一致が無ければ言語subtag一致のEnhancedへフォールバックする', () => {
  const voices = [
    { identifier: 'com.apple.voice.ja-JP.Enhanced', language: 'ja-JP', quality: 'Enhanced' },
  ];
  // 完全一致は無い（要求は`ja`単体）が、subtag「ja」が一致するEnhanced voiceを拾う
  assert.equal(selectEnhancedVoiceIdentifier('ja', voices), 'com.apple.voice.ja-JP.Enhanced');
});

test('selectEnhancedVoiceIdentifier: Enhancedが存在しない場合はundefined（languageのみで話させる）', () => {
  // en-USはDefaultしか無い。存在しないidentifierを捏造しない
  assert.equal(selectEnhancedVoiceIdentifier('en-US', VOICES_WITH_QUALITY), undefined);
});

test('selectEnhancedVoiceIdentifier: voice一覧が空ならundefined', () => {
  assert.equal(selectEnhancedVoiceIdentifier('ja-JP', []), undefined);
});

test('selectEnhancedVoiceIdentifier: qualityが無いvoice（旧形式）はEnhanced扱いしない', () => {
  // VoiceLike.qualityはoptional。古い形のvoiceが混じっても誤ってEnhanced判定しない
  const voices = [{ identifier: 'legacy-voice', language: 'ja-JP' }];
  assert.equal(selectEnhancedVoiceIdentifier('ja-JP', voices), undefined);
});

test('selectEnhancedVoiceIdentifier: 同一言語に複数Enhancedがあっても最初の1件を返す', () => {
  const voices = [
    { identifier: 'first-enhanced', language: 'ja-JP', quality: 'Enhanced' },
    { identifier: 'second-enhanced', language: 'ja-JP', quality: 'Enhanced' },
  ];
  assert.equal(selectEnhancedVoiceIdentifier('ja-JP', voices), 'first-enhanced');
});
