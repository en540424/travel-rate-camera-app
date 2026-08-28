/**
 * CSVの一時ファイル書き出しと共有シート表示を包む中間層。
 *
 * **`expo-file-system` / `expo-sharing`を画面から直接呼ばせず、この層だけが触る。**
 * CSV文字列の組み立ては`csv-export-core.ts`（純粋関数・`node --test`で検証済み）の責務で、
 * ここはI/Oだけを担う（`speech-synthesis-service.ts`と同じ分担）。
 *
 * ■ 動的import
 * どちらもnativeを要求するため、載っていないBuild・Web環境で画面を壊さないよう
 * 動的importにする（既存の`speech-synthesis-service.ts`・`translation.tsx`と同じ規律）。
 *
 * ■ 一時ファイルの置き場
 * `Paths.cache`（OSが必要に応じて回収するcacheディレクトリ）へ書く。
 * ユーザーデータではないので`Paths.document`やDBへは残さない。
 * 同名衝突は「書く前に同名を消す」だけで足りるため、独自のcleanup機構は作らない
 * （cacheの回収はOSに任せる。ここで凝ったcleanup architectureを新設しない）。
 */
import { Platform } from 'react-native';

export type CsvShareResult =
  | { status: 'shared' }
  /** 共有シートを出せない環境（Web・共有非対応端末） */
  | { status: 'unavailable' }
  | { status: 'error' };

/**
 * CSV文字列を一時ファイルへ書き出し、OSの共有シートを開く。
 *
 * `content`は**BOM付与済みの完成した文字列**を渡すこと（BOMを付けるかの判断は
 * `csv-export-core.ts`の`withUtf8Bom`側で完結させ、この層では文字列を加工しない）。
 *
 * 共有シートのキャンセルは`shareAsync`が正常終了するため`shared`を返す。
 * 「ユーザーが実際に保存したか」はOS側の情報で、アプリからは判別できない。
 */
export async function shareCsv(fileName: string, content: string): Promise<CsvShareResult> {
  // Webの共有APIはローカルファイルURIを扱えない（公式ドキュメント明記）。
  // 専用のWeb向けダウンロード実装は今回作らず、非対応として明示する。
  if (Platform.OS === 'web') return { status: 'unavailable' };

  let FileSystem: typeof import('expo-file-system');
  let Sharing: typeof import('expo-sharing');
  try {
    [FileSystem, Sharing] = await Promise.all([import('expo-file-system'), import('expo-sharing')]);
  } catch (error) {
    if (typeof __DEV__ !== 'undefined' && __DEV__) {
      console.warn('[CsvExport] moduleを読み込めませんでした', error);
    }
    return { status: 'unavailable' };
  }

  try {
    if (!(await Sharing.isAvailableAsync())) return { status: 'unavailable' };
  } catch {
    return { status: 'unavailable' };
  }

  try {
    const file = new FileSystem.File(FileSystem.Paths.cache, fileName);
    // 同名の書き出しが残っていると`create()`が失敗するため、先に消してから作る
    if (file.exists) file.delete();
    file.create();
    file.write(content);

    await Sharing.shareAsync(file.uri, {
      // iOS: UTIを明示しないと共有先アプリがCSVとして受け取れないことがある
      UTI: 'public.comma-separated-values-text',
      mimeType: 'text/csv',
      dialogTitle: 'CSVを書き出す',
    });
    return { status: 'shared' };
  } catch (error) {
    if (typeof __DEV__ !== 'undefined' && __DEV__) {
      console.warn('[CsvExport] 書き出し・共有に失敗しました', error);
    }
    return { status: 'error' };
  }
}
