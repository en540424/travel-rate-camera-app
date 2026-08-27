/**
 * TTS読み上げvoiceの言語別ユーザー設定を端末へ永続化する。
 *
 * **`expo-sqlite/kv-store`を利用する。** `travelrate.db`（アプリ本体の`SQLiteProvider`が管理する
 * DB。`src/db/schema.ts`が正本）とは完全に別のSQLiteファイル（`ExpoSQLiteStorage`。
 * `expo-sqlite`パッケージ自身が内部で自己完結して管理し、本ファイルからはkey-value APIとしてのみ触る）。
 * `schema.ts` / `migrateDatabase` / `travelrate.db`には一切触れない。
 * `expo-sqlite`は本アプリの中核依存として既に組み込み済みのため、新規package追加・native変更も無い。
 *
 * 保存構造は「languageCode → voiceIdentifier」のJSON blob 1個。
 * キーが無ければ自動（auto）、値があれば手動選択（manual）を表す。`mode`フィールドは持たない。
 *
 * JSONのparse・更新ロジック自体は`tts-voice-preferences-core.ts`（純粋関数、`node --test`で検証可能）
 * に分離している。本ファイルは`expo-sqlite/kv-store`とのI/Oだけを担う薄いラッパー。
 *
 * 読み込み・保存に失敗してもTTS本体は壊さない。あくまで利便性機能であり、
 * 読み上げそのものの必須依存にはしない。
 */
import { Storage } from 'expo-sqlite/kv-store';

import { mergeVoicePreference, parseVoicePreferences, type VoicePreferences } from './tts-voice-preferences-core';

export type { VoicePreferences };

const STORAGE_KEY = 'tts_voice_preferences_v1';

/** 保存済みの全言語分preferencesを読み込む。読み込み・parse失敗時は空オブジェクト */
export async function getVoicePreferences(): Promise<VoicePreferences> {
  try {
    const raw = await Storage.getItemAsync(STORAGE_KEY);
    return parseVoicePreferences(raw);
  } catch {
    return {};
  }
}

/**
 * 指定言語のvoice設定を更新する。
 * `identifier`が`null`ならその言語をautoへ戻す（キーを削除する）。
 * 保存失敗はTTS本体を止めない（呼び出し側はUI上の反映だけ行えばよく、次回起動時は
 * 保存できていなければ単にautoへ戻るだけで、読み上げ機能自体は壊れない）。
 */
export async function setVoicePreference(languageCode: string, identifier: string | null): Promise<void> {
  try {
    const prefs = await getVoicePreferences();
    const next = mergeVoicePreference(prefs, languageCode, identifier);
    await Storage.setItemAsync(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // 保存できなくても読み上げ本体（自動選択）は成立させる
  }
}
