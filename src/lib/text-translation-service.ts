/**
 * 専用翻訳ページ（自由入力テキスト）のnative呼び出しラッパー。
 *
 * **既存のOCRメモ候補翻訳（`translation-service.ts`）とは並列の別経路。**
 * あちらは`target='ja'`固定・`MemoCandidate[]`戻り値・重複原文の排除・セッション内cacheを
 * 前提としたメモ候補専用の形であり、汎用化すると本番OCR経路へ回帰が直撃する。
 * そのため既存側は一切変更せず、ここに薄い層をもう1本置く。
 *
 * 責務: OS可否の判定・対応言語の取得・任意のsource/targetでの1件翻訳・エラー正規化。
 * 責務外: UI文字列、React state、世代の一致判定（呼び出し側）、`TranslationHost`のマウント（React側）。
 *
 * cacheは持たない。自由入力は同一文の再ヒット率が低く、`translation-service.ts`の
 * モジュールレベルcache（カメラ画面と共有）を汚す方が有害なため。
 */
import { normalizeTranslationError } from './translation-service';
import type { MemoTranslationErrorCode } from './translation-types';

type TranslationNative = typeof import('../../modules/translation');

/**
 * nativeモジュールの遅延読み込み。`translation-service.ts`と同じ規律の再実装。
 *
 * 静的importにしないのは、Androidに`TabirateTranslationModule`の実体が無く
 * `requireNativeModule`がimport時点で例外を投げるため。読めない環境ではnullを返す。
 *
 * 既存側のloaderを共有せず複製しているのは、`translation-service.ts`を変更しないため。
 * ESモジュールは解決結果がキャッシュされるので、二重に読み込まれることはない。
 */
let nativeModulePromise: Promise<TranslationNative | null> | undefined;

function loadTranslationNative(): Promise<TranslationNative | null> {
  if (nativeModulePromise) return nativeModulePromise;
  nativeModulePromise = import('../../modules/translation').catch((error: unknown) => {
    if (typeof __DEV__ !== 'undefined' && __DEV__) {
      console.warn('[TextTranslation] translation moduleを読み込めませんでした', error);
    }
    return null;
  });
  return nativeModulePromise;
}

/** iOS 18.0以降か。nativeが応答しない場合も非対応として扱う */
function isTranslationOsSupported(native: TranslationNative): boolean {
  try {
    return native.isSupportedOs();
  } catch {
    return false;
  }
}

export type TranslationEnvironment = {
  /** iOS 18.0以降 かつ nativeモジュールが読める環境か */
  osSupported: boolean;
  /** 実機が対応する翻訳言語（BCP-47 minimal form）。非対応環境では空配列 */
  supportedLanguages: string[];
};

/**
 * 画面の初期化に必要な環境情報をまとめて取得する。
 *
 * **`isSupportedOs()`がfalseなら`getSupportedLanguages()`を呼ばない。**
 * native側はiOS 18.0未満で`getSupportedLanguages`をrejectするため（`unsupported_os`）、
 * 呼んでも空振りする上に、画面側が「取得失敗」と「非対応OS」を区別できなくなる。
 */
export async function getTranslationEnvironment(): Promise<TranslationEnvironment> {
  const native = await loadTranslationNative();
  if (!native || !isTranslationOsSupported(native)) {
    return { osSupported: false, supportedLanguages: [] };
  }
  try {
    const supportedLanguages = await native.getSupportedLanguages();
    return { osSupported: true, supportedLanguages };
  } catch {
    // OSは対応しているが一覧が取れなかった。画面側は空配列を「言語を選べない」状態として扱う
    return { osSupported: true, supportedLanguages: [] };
  }
}

export type TextTranslationStatus = 'done' | 'unavailable' | 'failed' | 'cancelled';

export type TextTranslationResult = {
  /** 要求時に渡された`generation`をそのまま返す。一致判定は呼び出し側の責務 */
  generation: number;
  status: TextTranslationStatus;
  translatedText?: string;
  /** Translation frameworkが実際に解決したsource（例: zh-Hant→zh-TW）。補助表示用 */
  resolvedSourceLanguage?: string;
  errorCode?: MemoTranslationErrorCode;
};

export type TranslateFreeTextParams = {
  text: string;
  sourceLanguage: string;
  targetLanguage: string;
  generation: number;
};

/**
 * 自由入力テキストを1件翻訳する。
 *
 * **rejectしない。** 常に`TextTranslationResult`を返し、失敗は`status`/`errorCode`で表す。
 *
 * 実装上の約束（いずれも既知の回帰を避けるためのもの。変更しないこと）:
 * - **`translateBatch`にtimeoutを掛けない。** 初回の言語モデルDLはApple側の管理下で
 *   正当に数十秒かかりうるため、打ち切るとDL中のユーザーを誤って失敗扱いにする
 *   （`translation-service.ts`の同趣旨のコメントを参照）。
 * - **`prepare()`を呼ばない。** モデル未導入ならApple標準のDL許可UIが`translateBatch`時に出る。
 * - **`getAvailability()`で事前判定しない。** availabilityは参考情報にすぎず
 *   （`installed`でもDL UIが出る）、最終判断は`translateBatch`の成否に委ねる既存方針に合わせる。
 * - **`cancelAll()`を呼ばない。** nativeの`configuration`がnilのまま残り、以後の要求が
 *   drainされずPromiseが永久にsettleしなくなる既知の事象があるため。stale結果の遮断は
 *   `generation`の一致判定（呼び出し側）とホストViewのアンマウントで行う。
 *
 * 呼び出し規約: `TabirateTranslationHost`がマウントされている間しか成功しない
 * （未マウントなら`host_unavailable`）。
 */
export async function translateFreeText({
  text,
  sourceLanguage,
  targetLanguage,
  generation,
}: TranslateFreeTextParams): Promise<TextTranslationResult> {
  const native = await loadTranslationNative();
  if (!native || !isTranslationOsSupported(native)) {
    return { generation, status: 'unavailable', errorCode: 'unsupported_os' };
  }

  try {
    // 初版の主案: 入力全文を1つのRequestとして送り、文脈と改行構造を保つ
    const response = await native.translateBatch([text], sourceLanguage, targetLanguage);
    const first = response.results[0];
    if (!first) {
      return { generation, status: 'failed', errorCode: 'translation_failed' };
    }
    return {
      generation,
      status: 'done',
      translatedText: first.translatedText,
      resolvedSourceLanguage: first.sourceLanguage,
    };
  } catch (error) {
    const { errorCode } = normalizeTranslationError(error);
    if (errorCode === 'cancelled') {
      // ユーザーへ見せるエラーではない。新しい世代の結果で置き換わる前提
      return { generation, status: 'cancelled', errorCode };
    }
    const status: TextTranslationStatus =
      errorCode === 'unsupported_os' || errorCode === 'unsupported_language'
        ? 'unavailable'
        : 'failed';
    return { generation, status, errorCode };
  }
}
