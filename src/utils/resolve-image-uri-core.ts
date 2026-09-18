/**
 * DBに保存された画像URI（絶対パス）を、現在のアプリコンテナ基準のパスへ再解決する純粋関数。
 *
 * **react-native・expo-file-system等のimportを一切持たない自己完結モジュール。**
 * `node --test`から直接importして検証できる状態を保つ（`budget-core.ts`・`edit-amount-core.ts`と同じ規律）。
 * 実行環境の値（`Platform.OS`・`FileSystem.documentDirectory`）は`resolve-image-uri.ts`が注入する。
 *
 * ■ なぜ必要か
 *   iOSはアプリの再インストール・新しいビルドの導入のたびにアプリコンテナのUUIDが変わることがあり、
 *   過去に絶対パスとして保存したURI（file:///.../Application/<旧UUID>/Documents/photos/xxx.jpg）が
 *   無効になる。Documents配下の相対位置＝実ファイルの所在自体は保持される前提で、
 *   DB側のimage_uriは書き換えず、**表示時と削除時**に現在の documentDirectory 基準へ組み直す。
 *
 * ■ 責務
 *   「保存URI → 現在有効なfile URI」の変換だけ。存在確認・scheme判定・削除はしない。
 *   変換できない入力（web／documentDirectory不明／`/Documents/`を含まない）は**入力をそのまま返す**。
 *   この既定は表示（`resilient-photo.tsx`）と削除（各画面の`deleteAsync`）の両方が依存している契約なので変えない。
 */

const DOCUMENTS_MARKER = '/Documents/';

export function resolveImageUriWith(
  storedUri: string | null | undefined,
  docsDir: string | null | undefined,
  isWeb: boolean,
): string | null {
  if (!storedUri) return null;
  if (isWeb) return storedUri;
  if (!docsDir) return storedUri;

  // 既に現在のdocumentDirectory配下ならそのまま使う（新規保存分・同セッションの下書きfileはここに該当）
  if (storedUri.startsWith(docsDir)) return storedUri;

  const idx = storedUri.indexOf(DOCUMENTS_MARKER);
  if (idx === -1) return storedUri;

  const relative = storedUri.slice(idx + DOCUMENTS_MARKER.length);
  if (!relative) return storedUri;

  return `${docsDir}${relative}`;
}
