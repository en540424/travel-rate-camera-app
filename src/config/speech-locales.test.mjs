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
  getPreviewSampleText,
  getSpeechLocaleCandidate,
  getTtsLanguageCandidate,
  listVoiceOptionsForLanguage,
  normalizeLocale,
  resolveManualVoice,
  resolveSpeechLocale,
  resolveTtsRate,
  resolveTtsVoiceLanguage,
  resolveVoiceSelection,
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

test('resolveTtsRate: 日本語は既定速度(1.0)のまま', () => {
  assert.equal(resolveTtsRate('ja'), 1.0);
});

test('resolveTtsRate: タイ語は既定速度(1.0)のまま', () => {
  assert.equal(resolveTtsRate('th'), 1.0);
});

test('resolveTtsRate: 英語は既定よりやや遅い', () => {
  const rate = resolveTtsRate('en');
  assert.ok(rate < 1.0 && rate >= 0.85, `expected 0.85-1.0, got ${rate}`);
});

test('resolveTtsRate: 韓国語は既定よりかなり遅い（実機で早口すぎた言語）', () => {
  const rate = resolveTtsRate('ko');
  assert.ok(rate < 0.9 && rate >= 0.75, `expected 0.75-0.9, got ${rate}`);
});

test('resolveTtsRate: イタリア語は既定よりやや遅い', () => {
  const rate = resolveTtsRate('it');
  assert.ok(rate < 1.0 && rate >= 0.8, `expected 0.8-1.0, got ${rate}`);
});

test('resolveTtsRate: ベトナム語は既定よりわずかに遅い', () => {
  const rate = resolveTtsRate('vi');
  assert.ok(rate < 1.0 && rate >= 0.9, `expected 0.9-1.0, got ${rate}`);
});

test('resolveTtsRate: 簡体字中国語は既定よりやや遅い', () => {
  const rate = resolveTtsRate('zh-Hans');
  assert.ok(rate < 1.0 && rate >= 0.8, `expected 0.8-1.0, got ${rate}`);
});

test('resolveTtsRate: 繁体字中国語も簡体字と同じ補正', () => {
  assert.equal(resolveTtsRate('zh-Hant'), resolveTtsRate('zh-Hans'));
});

test('resolveTtsRate: 表に無い言語コードは既定速度(1.0)にfallbackする', () => {
  assert.equal(resolveTtsRate('fr'), 1.0);
  assert.equal(resolveTtsRate('unknown-code'), 1.0);
});

test('resolveTtsRate: null/undefined/空文字は既定速度(1.0)にfallbackする', () => {
  assert.equal(resolveTtsRate(null), 1.0);
  assert.equal(resolveTtsRate(undefined), 1.0);
  assert.equal(resolveTtsRate(''), 1.0);
});

// MARK: - voice選択UI（listVoiceOptionsForLanguage / resolveManualVoice / resolveVoiceSelection）

/** name付きのvoice一覧。同一言語にDefault/Enhancedが混在し、他言語のvoiceも混じる端末を模す */
const NAMED_VOICES = [
  { identifier: 'com.apple.voice.ja-JP.Kyoko', name: 'Kyoko', language: 'ja-JP', quality: 'Default' },
  { identifier: 'com.apple.voice.ja-JP.Otoya.Enhanced', name: 'Otoya', language: 'ja-JP', quality: 'Enhanced' },
  { identifier: 'com.apple.voice.en-US.Samantha', name: 'Samantha', language: 'en-US', quality: 'Default' },
  { identifier: 'com.apple.voice.ko-KR.Yuna', name: 'Yuna', language: 'ko-KR', quality: 'Default' },
];

test('listVoiceOptionsForLanguage: 完全一致するlocaleのvoiceだけを返す（exact locale）', () => {
  const options = listVoiceOptionsForLanguage('ja', NAMED_VOICES);
  assert.equal(options.length, 2);
  assert.ok(options.every((v) => v.identifier.includes('ja-JP')));
});

test('listVoiceOptionsForLanguage: 完全一致が無い時は言語subtag一致へフォールバックする', () => {
  // 表にja→ja-JPの候補はあるが、完全一致するidentifierが無い状況を模すため
  // en-USしか無い端末で`en`を要求するケースで検証する
  const voices = [{ identifier: 'x', name: 'Test Voice', language: 'en-US', quality: 'Default' }];
  const options = listVoiceOptionsForLanguage('en', voices);
  assert.equal(options.length, 1);
  assert.equal(options[0].identifier, 'x');
});

test('listVoiceOptionsForLanguage: wrong-language voiceを候補に混入させない', () => {
  const options = listVoiceOptionsForLanguage('ko', NAMED_VOICES);
  assert.equal(options.length, 1);
  assert.equal(options[0].identifier, 'com.apple.voice.ko-KR.Yuna');
});

test('listVoiceOptionsForLanguage: 空voice一覧は空配列を返す', () => {
  assert.deepEqual(listVoiceOptionsForLanguage('ja', []), []);
});

test('listVoiceOptionsForLanguage: 対応言語が無ければ空配列を返す', () => {
  assert.deepEqual(listVoiceOptionsForLanguage('th', NAMED_VOICES), []);
});

test('listVoiceOptionsForLanguage: Enhanced qualityがそのまま表示用に渡る', () => {
  const options = listVoiceOptionsForLanguage('ja', NAMED_VOICES);
  const enhanced = options.find((v) => v.identifier.includes('Otoya'));
  assert.equal(enhanced.quality, 'Enhanced');
});

test('listVoiceOptionsForLanguage: Default qualityもそのまま表示用に渡る', () => {
  const options = listVoiceOptionsForLanguage('ja', NAMED_VOICES);
  const normal = options.find((v) => v.identifier.includes('Kyoko'));
  assert.equal(normal.quality, 'Default');
});

test('resolveManualVoice: 保存identifierが現在のvoices一覧に存在すれば採用する', () => {
  const result = resolveManualVoice('ja', 'com.apple.voice.ja-JP.Kyoko', NAMED_VOICES);
  assert.ok(result !== null);
  assert.equal(result.identifier, 'com.apple.voice.ja-JP.Kyoko');
});

test('resolveManualVoice: 保存identifierが消失していればnull（呼び出し側はautoへfallback）', () => {
  const result = resolveManualVoice('ja', 'com.apple.voice.ja-JP.NoLongerInstalled', NAMED_VOICES);
  assert.equal(result, null);
});

test('resolveManualVoice: 別言語向けのidentifierが紛れ込んでも採用しない（wrong-language除外）', () => {
  // 'com.apple.voice.en-US.Samantha'は実在するidentifierだが、要求言語は'ja'
  const result = resolveManualVoice('ja', 'com.apple.voice.en-US.Samantha', NAMED_VOICES);
  assert.equal(result, null);
});

test('resolveManualVoice: identifier未指定（auto）はnull', () => {
  assert.equal(resolveManualVoice('ja', null, NAMED_VOICES), null);
  assert.equal(resolveManualVoice('ja', undefined, NAMED_VOICES), null);
});

test('resolveVoiceSelection: manual identifierが存在すればそれを使う', () => {
  const result = resolveVoiceSelection('ja', 'com.apple.voice.ja-JP.Kyoko', NAMED_VOICES);
  assert.equal(result.voiceIdentifier, 'com.apple.voice.ja-JP.Kyoko');
  assert.equal(result.language, 'ja-JP');
});

test('resolveVoiceSelection: manual identifierが消失していればEnhanced優先の自動選択へfallbackする', () => {
  const result = resolveVoiceSelection('ja', 'com.apple.voice.ja-JP.NoLongerInstalled', NAMED_VOICES);
  // 自動選択は既存のselectEnhancedVoiceIdentifierと同じ結果になるはず
  assert.equal(result.voiceIdentifier, selectEnhancedVoiceIdentifier('ja-JP', NAMED_VOICES));
  assert.equal(result.voiceIdentifier, 'com.apple.voice.ja-JP.Otoya.Enhanced');
});

test('resolveVoiceSelection: manual未設定（auto）は既存のEnhanced優先選択と一致する', () => {
  const result = resolveVoiceSelection('ja', null, NAMED_VOICES);
  assert.equal(result.voiceIdentifier, selectEnhancedVoiceIdentifier('ja-JP', NAMED_VOICES));
});

test('resolveVoiceSelection: 言語が変わればmanual設定も別々に解決される', () => {
  // 'ja'用のmanual identifierを'en'の解決に渡しても採用されない（wrong-language除外を経由）
  const forJa = resolveVoiceSelection('ja', 'com.apple.voice.ja-JP.Kyoko', NAMED_VOICES);
  const forEn = resolveVoiceSelection('en', 'com.apple.voice.ja-JP.Kyoko', NAMED_VOICES);
  assert.equal(forJa.voiceIdentifier, 'com.apple.voice.ja-JP.Kyoko');
  assert.notEqual(forEn.voiceIdentifier, 'com.apple.voice.ja-JP.Kyoko');
});

test('resolveVoiceSelection: 対応言語が無ければnull', () => {
  assert.equal(resolveVoiceSelection('th', null, NAMED_VOICES), null);
});

// MARK: - 試聴サンプル文

test('getPreviewSampleText: 対応言語コードごとに固定サンプル文を返す', () => {
  assert.equal(typeof getPreviewSampleText('ja'), 'string');
  assert.ok(getPreviewSampleText('ja').length > 0);
  assert.ok(getPreviewSampleText('en').length > 0);
});

test('getPreviewSampleText: 表に無い言語コードは英語文にfallbackする', () => {
  assert.equal(getPreviewSampleText('fr'), getPreviewSampleText('en'));
});

test('getPreviewSampleText: null/undefined/空文字は英語文にfallbackする', () => {
  assert.equal(getPreviewSampleText(null), getPreviewSampleText('en'));
  assert.equal(getPreviewSampleText(undefined), getPreviewSampleText('en'));
  assert.equal(getPreviewSampleText(''), getPreviewSampleText('en'));
});
