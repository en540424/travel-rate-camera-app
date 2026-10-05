/**
 * スマートカメラ（メインカメラの「かざして翻訳・円換算」）のON/OFFを端末へ保存する。
 *
 * `tts-voice-preferences.ts`と同じく`expo-sqlite/kv-store`を使う（アプリ本体のDB`travelrate.db`・
 * `schema.ts`・migrationには一切触れない）。読み書きに失敗してもカメラ本体は壊さない。
 */
import { Storage } from 'expo-sqlite/kv-store';

const STORAGE_KEY = 'smart_camera_enabled_v1';

/** 既定はON（「カメラを向けるだけで分かる」ことが機能の目的のため） */
export const SMART_CAMERA_DEFAULT_ENABLED = true;

export async function getSmartCameraEnabled(): Promise<boolean> {
  try {
    const raw = await Storage.getItemAsync(STORAGE_KEY);
    if (raw === 'false') return false;
    if (raw === 'true') return true;
    return SMART_CAMERA_DEFAULT_ENABLED;
  } catch {
    return SMART_CAMERA_DEFAULT_ENABLED;
  }
}

export async function setSmartCameraEnabled(enabled: boolean): Promise<void> {
  try {
    await Storage.setItemAsync(STORAGE_KEY, enabled ? 'true' : 'false');
  } catch {
    // 保存できなくても、この起動中の画面stateには反映済みなので何もしない
  }
}
