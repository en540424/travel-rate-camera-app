/**
 * AI翻訳の初回同意（送信先と送信内容の確認。App Review 5.1.2(i)）。同意したら端末内に記録する。
 * 既存の設定・DBとは別のファイルに置く（既存データに触れない）。
 */
import * as FileSystem from 'expo-file-system/legacy';

const FILE = `${FileSystem.documentDirectory ?? ''}proplus/ai-consent-v1.json`;

export const AI_CONSENT_VERSION = 1;

export async function hasAiConsent(): Promise<boolean> {
  try {
    const info = await FileSystem.getInfoAsync(FILE);
    if (!info.exists) return false;
    const raw = JSON.parse(await FileSystem.readAsStringAsync(FILE)) as { version?: number };
    return raw.version === AI_CONSENT_VERSION;
  } catch {
    return false;
  }
}

export async function saveAiConsent(): Promise<boolean> {
  try {
    const dir = FILE.slice(0, FILE.lastIndexOf('/') + 1);
    if (!(await FileSystem.getInfoAsync(dir)).exists) await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
    await FileSystem.writeAsStringAsync(FILE, JSON.stringify({ version: AI_CONSENT_VERSION, at: new Date().toISOString() }));
    return true;
  } catch {
    return false;
  }
}
