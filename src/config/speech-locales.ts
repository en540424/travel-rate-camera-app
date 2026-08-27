/**
 * 翻訳言語コード → 音声認識(STT) locale / 読み上げ(TTS) 言語 の解決。
 *
 * **react-native・nativeモジュール・`@/`エイリアスを一切importしない。**
 * `node --test`から直接importして検証できる状態を保つため（`text-translation-core.ts`と同じ規律）。
 *
 * ■ 最重要の原則: 静的表は「候補」であって対応言語の正本ではない
 *   - 翻訳の対応言語の正本 … 実機の`getSupportedLanguages()`（`modules/translation`）
 *   - 音声認識の対応言語の正本 … 実機の`getSupportedLocales()`（`expo-speech-recognition`）
 *   - 読み上げの対応voiceの正本 … 実機の`getAvailableVoicesAsync()`（`expo-speech`）
 *
 *   **この3つは別々の集合**であり、「翻訳はできるが音声認識はできない言語」が存在しうる。
 *   そのため本ファイルの表は候補を作るだけで、採否は必ず実機の一覧との突き合わせで決める。
 *   ここに無いコードが来ても壊れず、言語subtag一致のフォールバックで拾う
 *   （`translation-language-names.ts`が「一覧を持たない」のと同じ考え方）。
 *
 * ■ 翻訳stateへは一切書き戻さない
 *   解決は「現在選択されているsource/targetを読む → localeを派生する」の一方向のみ。
 *   解決結果でsource/target言語stateを書き換えてはならない（既存の実機合格仕様）。
 */

/**
 * 翻訳言語コード → 音声認識locale候補。
 *
 * `SFSpeechRecognizer`の対応localeは地域付き（`en-US`等）であるため、
 * 翻訳側の言語コード（`en`等）をそのまま使わず地域付き候補へ広げる。
 * ここに無いコードは`resolveSpeechLocale`が言語subtag一致で拾う。
 */
const SPEECH_LOCALE_CANDIDATES: Readonly<Record<string, string>> = {
  en: 'en-US',
  ja: 'ja-JP',
  ko: 'ko-KR',
  th: 'th-TH',
  // Apple Translation側も`zh-Hant`→`zh-TW`へ正規化する（実機確認済み。translation-language-names.ts参照）
  'zh-Hant': 'zh-TW',
  'zh-Hans': 'zh-CN',
};

/**
 * 翻訳言語コード → 読み上げ言語候補。
 *
 * `expo-speech`の`language`はBCP-47をそのまま受け付けるため、STTと違い地域付きへ広げる必要がない。
 * script subtag形式（`zh-Hant`/`zh-Hans`）だけはvoice解決に失敗しうるので地域付きへ寄せる。
 */
const TTS_LANGUAGE_CANDIDATES: Readonly<Record<string, string>> = {
  'zh-Hant': 'zh-TW',
  'zh-Hans': 'zh-CN',
};

/**
 * locale識別子を比較用に正規化する。
 *
 * Foundationの`Locale.identifier`はICU正準形のため`en_US`のようにアンダースコアで
 * 返ることがある一方、BCP-47表記は`en-US`である。**どちらで来ても取りこぼさない**ように
 * 区切りを`-`へ揃え、大文字小文字も無視する。
 * （ここを厳密一致にすると、対応しているのにマイクが無言で無効化される事故になる）
 */
export function normalizeLocale(locale: string): string {
  return locale.replace(/_/g, '-').toLowerCase();
}

/** 言語subtag（最初の区切りまで）を取り出す。`zh-Hant`→`zh`、`en-US`→`en` */
export function getLanguageSubtag(code: string): string {
  return normalizeLocale(code).split('-')[0] ?? '';
}

/** 翻訳言語コードに対する音声認識locale候補。表に無ければコード自身を候補とする */
export function getSpeechLocaleCandidate(languageCode: string): string {
  return SPEECH_LOCALE_CANDIDATES[languageCode] ?? languageCode;
}

/** 翻訳言語コードに対する読み上げ言語候補。表に無ければコード自身を候補とする */
export function getTtsLanguageCandidate(languageCode: string): string {
  return TTS_LANGUAGE_CANDIDATES[languageCode] ?? languageCode;
}

/**
 * 音声認識localeの解決結果。
 * `unsupported`のときはマイクを無効化する（言語選択自体は変更しない）。
 */
export type SpeechLocaleResolution =
  | { status: 'exact'; locale: string }
  | { status: 'fallback'; locale: string }
  | { status: 'unsupported' };

/**
 * 現在のsource言語から音声認識localeを決める。
 *
 * 1. 候補localeを得る（静的表 → 無ければコード自身）
 * 2. 実機の`supportedLocales`と完全一致すれば採用（`exact`）
 * 3. 無ければ言語subtagが一致する最初のlocaleへフォールバック（`fallback`）
 * 4. それも無ければ`unsupported`（この言語ではSTTを提供しない）
 *
 * **返す`locale`は必ず実機一覧に入っていた文字列そのもの**（正規化前の原文字列）。
 * 正規化した文字列を渡すと、端末が`en_US`形式で持っている場合に一致しなくなるため。
 *
 * `supportedLocales`が空（取得失敗・非対応環境）のときは常に`unsupported`。
 * 推測で候補localeを渡して実行時に失敗させない。
 */
export function resolveSpeechLocale(
  languageCode: string | null | undefined,
  supportedLocales: readonly string[],
): SpeechLocaleResolution {
  if (languageCode == null || languageCode === '') return { status: 'unsupported' };
  const list = supportedLocales ?? [];
  if (list.length === 0) return { status: 'unsupported' };

  const candidate = normalizeLocale(getSpeechLocaleCandidate(languageCode));

  const exact = list.find((locale) => normalizeLocale(locale) === candidate);
  if (exact !== undefined) return { status: 'exact', locale: exact };

  const subtag = getLanguageSubtag(languageCode);
  if (subtag !== '') {
    const sameLanguage = list.find((locale) => getLanguageSubtag(locale) === subtag);
    if (sameLanguage !== undefined) return { status: 'fallback', locale: sameLanguage };
  }

  return { status: 'unsupported' };
}

/**
 * 読み上げvoiceの解決に使う最小形。`expo-speech`の`Voice`から必要な分だけを受け取る。
 *
 * `quality`は`expo-speech`の`VoiceQuality`（`'Default' | 'Enhanced'`）を文字列として受ける。
 * ここで型を輸入しない（本ファイルはnativeモジュールを一切importしない規律のため）。
 * optionalにしているのは、呼び出し元が古い形（quality無し）を渡しても既存の言語解決
 * （`resolveTtsVoiceLanguage`）が壊れないようにするため。
 */
export type VoiceLike = { identifier: string; language: string; quality?: string };

/**
 * 読み上げvoiceの解決結果。
 * `unsupported`のときはスピーカーを無効化し、Humanへ明示エラーを出す
 * （**別言語のvoiceで代読しない**。無音で失敗させるのも不可）。
 */
export type TtsVoiceResolution =
  | { status: 'exact'; language: string }
  | { status: 'subtag'; language: string }
  | { status: 'unsupported' };

/**
 * 現在のtarget言語から読み上げ言語を決める。
 *
 * 1. 候補言語と完全一致するvoiceがあれば採用（`exact`）
 * 2. 無ければ言語subtagが一致するvoiceへフォールバック（`subtag`。`ja`→`ja-JP`等はここで解決される）
 * 3. それも無ければ`unsupported`
 *
 * 返す`language`は**実機のvoiceが持つ言語文字列**。`Speech.speak`の`language`へそのまま渡す
 * （voice identifierを固定せず言語で指定することで、OSが既定の最良voiceを選ぶ）。
 */
export function resolveTtsVoiceLanguage(
  languageCode: string | null | undefined,
  voices: readonly VoiceLike[],
): TtsVoiceResolution {
  if (languageCode == null || languageCode === '') return { status: 'unsupported' };
  const list = voices ?? [];
  if (list.length === 0) return { status: 'unsupported' };

  const candidate = normalizeLocale(getTtsLanguageCandidate(languageCode));

  const exact = list.find((voice) => normalizeLocale(voice.language) === candidate);
  if (exact !== undefined) return { status: 'exact', language: exact.language };

  const subtag = getLanguageSubtag(getTtsLanguageCandidate(languageCode));
  if (subtag !== '') {
    const sameLanguage = list.find((voice) => getLanguageSubtag(voice.language) === subtag);
    if (sameLanguage !== undefined) return { status: 'subtag', language: sameLanguage.language };
  }

  return { status: 'unsupported' };
}

/**
 * 解決済みの読み上げ言語に対して、Enhanced品質のvoiceがあればそのidentifierを返す。
 *
 * `resolveTtsVoiceLanguage`とは独立した別関数にしている。既存関数の戻り値へ
 * `voiceIdentifier`を足すと、`deepEqual`で戻り値全体を検証している既存テストが
 * 全て壊れるため（今回の変更を「voice選択の追加」1点に閉じるための分離）。
 *
 * 優先順位:
 * 1. `resolveTtsVoiceLanguage`が返したlanguageと完全一致 かつ quality === 'Enhanced'
 * 2. 言語subtagが一致 かつ quality === 'Enhanced'
 * 3. どちらも無ければ`undefined`（呼び出し側は`voice`を指定せず`language`のみで話させる）
 *
 * **`undefined`を返した場合、呼び出し側は`voice`キー自体を渡さないこと。**
 * 存在しない/不正なidentifierをiOSの`Speech.speak`へ渡すと無音で失敗しうるため、
 * 「見つかった時だけ指定する」を徹底し、voiceが無い言語では現状（language指定のみ）から
 * 悪化させない。
 */
/**
 * 翻訳言語コード → 読み上げrate（`expo-speech`の`rate`はOS既定速度への倍率。`1.0`が既定）。
 *
 * `rate`の実体はinstalled `expo-speech`のiOS実装で確認済み：
 * `utterance.rate = Float(rate) * AVSpeechUtteranceDefaultSpeechRate`
 * （`node_modules/expo-speech/ios/SpeechModule.swift`）。型定義のコメントを鵜呑みにせず
 * 実ソースで「1.0が絶対値ではなくOS既定への倍率」であることを確認したうえで値を決めている。
 *
 * Human実機確認（2026-08-27）で「日本語はちょうど良いが韓国語は早口すぎて聞き取れない」等、
 * 言語ごとに体感速度差が大きいと判明したための補正表。一律rateでは吸収できないため、
 * 翻訳言語コード単位で個別に持つ。pitchは対象外（今回未変更）。
 */
const TTS_RATE_BY_LANGUAGE: Readonly<Record<string, number>> = {
  ja: 1.0,
  th: 1.0,
  vi: 0.94,
  it: 0.88,
  'zh-Hans': 0.88,
  'zh-Hant': 0.88,
  en: 0.9,
  ko: 0.82,
};

/** 表に無い言語コードのrate。expo-speechの既定（`1.0`＝OS既定速度）と同じにし、悪化させない */
const DEFAULT_TTS_RATE = 1.0;

/**
 * 翻訳言語コードから読み上げrateを決める。表に無ければ`DEFAULT_TTS_RATE`。
 * `resolveTtsVoiceLanguage`と同じ入力（現在のtarget言語コード）を受け取る想定。
 */
export function resolveTtsRate(languageCode: string | null | undefined): number {
  if (languageCode == null || languageCode === '') return DEFAULT_TTS_RATE;
  return TTS_RATE_BY_LANGUAGE[languageCode] ?? DEFAULT_TTS_RATE;
}

export function selectEnhancedVoiceIdentifier(
  resolvedLanguage: string,
  voices: readonly VoiceLike[],
): string | undefined {
  const list = voices ?? [];
  if (list.length === 0) return undefined;

  const normalizedTarget = normalizeLocale(resolvedLanguage);
  const exactEnhanced = list.find(
    (voice) => normalizeLocale(voice.language) === normalizedTarget && voice.quality === 'Enhanced',
  );
  if (exactEnhanced !== undefined) return exactEnhanced.identifier;

  const subtag = getLanguageSubtag(resolvedLanguage);
  if (subtag !== '') {
    const subtagEnhanced = list.find(
      (voice) => getLanguageSubtag(voice.language) === subtag && voice.quality === 'Enhanced',
    );
    if (subtagEnhanced !== undefined) return subtagEnhanced.identifier;
  }

  return undefined;
}
