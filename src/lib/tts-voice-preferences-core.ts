/**
 * TTS voice設定JSONのparse・更新ロジック（純粋関数）。
 *
 * **react-native・nativeモジュール・`@/`エイリアスを一切importしない。**
 * `node --test`から直接importして検証できる状態を保つため
 * （`text-translation-core.ts`・`speech-transcript-accumulator.ts`と同じ規律）。
 * 実際の永続化（`expo-sqlite/kv-store`）は`tts-voice-preferences.ts`側が担う。
 */

export type VoicePreferences = Readonly<Record<string, string>>;

/**
 * 保存済みJSON文字列を安全にparseする。
 * `null`・壊れたJSON・オブジェクト以外・配列・非文字列値は無視し、空オブジェクト扱いにする
 * （読み込み失敗時にTTS本体を壊さないため。呼び出し側は例外を気にせず使える）。
 */
export function parseVoicePreferences(raw: string | null | undefined): VoicePreferences {
  if (raw == null) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) return {};

    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === 'string' && value !== '') result[key] = value;
    }
    return result;
  } catch {
    return {};
  }
}

/**
 * 指定言語のvoice設定を更新した新しいpreferencesを返す。
 * `identifier`が`null`ならその言語をauto（キー削除）へ戻す。元のオブジェクトは変更しない。
 */
export function mergeVoicePreference(
  prefs: VoicePreferences,
  languageCode: string,
  identifier: string | null,
): VoicePreferences {
  if (identifier == null) {
    return Object.fromEntries(Object.entries(prefs).filter(([key]) => key !== languageCode));
  }
  return { ...prefs, [languageCode]: identifier };
}
