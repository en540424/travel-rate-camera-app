import * as FileSystem from 'expo-file-system/legacy';
import { Platform } from 'react-native';

const DOCUMENTS_MARKER = '/Documents/';

/**
 * DBに保存された画像URI（絶対パス）を、現在のアプリコンテナ基準のパスへ再解決する。
 *
 * iOSはアプリの再インストール・新しいビルドの導入のたびにアプリコンテナのUUIDが変わることがあり、
 * 過去に絶対パスとして保存したURI（file:///.../Application/<旧UUID>/Documents/photos/xxx.jpg）が
 * 無効になることがある（Documents配下の相対位置＝実ファイルの所在自体は保持される前提）。
 * DB側のimage_uriは書き換えず、表示時にだけ現在の FileSystem.documentDirectory 基準へ組み直す。
 */
export function resolveImageUri(storedUri: string | null | undefined): string | null {
  if (!storedUri) return null;
  if (Platform.OS === 'web') return storedUri;

  const docsDir = FileSystem.documentDirectory;
  if (!docsDir) return storedUri;

  // 既に現在のdocumentDirectory配下ならそのまま使う（新規保存分はここに該当）
  if (storedUri.startsWith(docsDir)) return storedUri;

  const idx = storedUri.indexOf(DOCUMENTS_MARKER);
  if (idx === -1) return storedUri;

  const relative = storedUri.slice(idx + DOCUMENTS_MARKER.length);
  if (!relative) return storedUri;

  return `${docsDir}${relative}`;
}
