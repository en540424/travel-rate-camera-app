import * as FileSystem from 'expo-file-system/legacy';
import { Platform } from 'react-native';

import { resolveImageUriWith } from './resolve-image-uri-core';

/**
 * DBに保存された画像URI（絶対パス）を、現在のアプリコンテナ基準のパスへ再解決する。
 * 変換規則と理由は`resolve-image-uri-core.ts`を参照（ここは実行環境の値を注入するだけの薄い層）。
 *
 * 表示（`resilient-photo.tsx`）だけでなく、**写真fileの削除**（記録削除・写真差替え・全削除）でも
 * 必ずこれを通す。保存された旧コンテナのURIをそのまま`deleteAsync`へ渡すと、iOSで
 * コンテナUUIDが変わった後は実ファイルへ到達できず（`idempotent`で無音no-op）孤児fileが残る。
 */
export function resolveImageUri(storedUri: string | null | undefined): string | null {
  return resolveImageUriWith(storedUri, FileSystem.documentDirectory, Platform.OS === 'web');
}

/**
 * 保存URIが指す写真fileを、現在のコンテナ基準へ解決してから削除する。
 * 存在しないfileは`idempotent`で正常終了（従来どおり）。それ以外の失敗は呼び出し側が
 * 既存契約どおり扱う（各画面ともDB確定後に呼び、失敗しても画面遷移を止めない）。
 */
export async function deleteStoredPhotoFile(storedUri: string): Promise<void> {
  const target = resolveImageUri(storedUri);
  if (!target) return;
  await FileSystem.deleteAsync(target, { idempotent: true });
}
