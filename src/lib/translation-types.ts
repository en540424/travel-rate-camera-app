/**
 * メモ候補の翻訳に関する型定義（実行時コードを持たない純粋な型モジュール）。
 *
 * ここにnativeモジュール・react-nativeへのimportを増やさないこと。
 * UI・テスト・Android/Webのいずれから読み込んでも副作用が起きない状態を保つ。
 *
 * 正本: Vault `AI-Workflow-System/07_project-kits/tabirate-camera/
 * 旅レートカメラ_多言語OCR・翻訳・テキスト入力_中核構想設計書_v1.md` §31
 */

/**
 * 候補1件の翻訳状態。
 * - idle … 翻訳を要求していない／要求が無効化された（空行・キャンセル）
 * - pending … 翻訳要求中
 * - translated … 訳文あり
 * - unavailable … この端末・この言語では翻訳自体ができない（原文のまま使う）
 * - failed … 翻訳を試みたが失敗した（原文のまま使う）
 */
export type MemoTranslationStatus = 'idle' | 'pending' | 'translated' | 'unavailable' | 'failed';

/**
 * 本番側のエラー分類。nativeの`TranslationErrorCode`をそのまま外へ出さず、ここへ正規化する。
 * nativeに実体のあるエラーだけを分類として持ち、推測でコードを増やさない
 * （model_not_ready / download_cancelled / timeout 等は実体未確認のため作らない）。
 *
 * - unsupported_os … iOS 18.0未満、またはTranslationモジュール自体が使えない環境（Android/Web）
 * - unsupported_language … `getAvailability`が`unsupported`を返した言語ペア
 * - host_unavailable … ホストViewが未マウント／処理中に外れた
 * - cancelled … 明示キャンセル・世代切り替えによる破棄（ユーザーへ見せるエラーではない）
 * - translation_failed … Translation framework側の失敗、および分類不能なエラー
 */
export type MemoTranslationErrorCode =
  | 'unsupported_os'
  | 'unsupported_language'
  | 'host_unavailable'
  | 'cancelled'
  | 'translation_failed';

/**
 * OCRのメモ候補1行。
 *
 * **`originalText`がidentityの正本。** UIのkey・Set・cacheキーのいずれも常にこれを使う。
 * `translatedText`・`resolvedSourceLanguage`をidentityに使ってはいけない
 * （実機確認済み: 會員價/会员价はどちらも「会員価格」へ、zh-Hantはzh-TWへ正規化される）。
 */
export type MemoCandidate = {
  /** OCR原文（`extractMemoLines`の出力そのもの）。識別子であり、失われることがない */
  originalText: string;
  /** 訳文。表示・メモ挿入用のペイロードとしてのみ扱う */
  translatedText?: string;
  /** 翻訳を要求したときのsource（通貨hint由来）。cacheキーに使う値 */
  requestedSourceLanguage?: string;
  /** Apple側が返した正規化後のsource（例: zh-Hant→zh-TW）。表示・診断用 */
  resolvedSourceLanguage?: string;
  translationStatus: MemoTranslationStatus;
  errorCode?: MemoTranslationErrorCode;
};

export type TranslateMemoLinesParams = {
  /** OCRのメモ候補行。順序・件数は呼び出し側の並びをそのまま維持して返す */
  lines: string[];
  /** 通貨hint由来のsource言語。Phase 1〜3では画面全体で単一 */
  sourceLanguage: string;
  /** 既定は`ja` */
  targetLanguage?: string;
  /**
   * OCR結果のライフサイクル世代。Serviceは判定に使わず、そのまま結果へ返すだけ。
   * 一致判定は呼び出し側（React state）の責務。永続データではない。
   */
  generation: number;
};

export type TranslateMemoLinesResult = {
  /** 要求時に渡された`generation`をそのまま返す */
  generation: number;
  /** `lines`と同じ順序・同じ件数 */
  candidates: MemoCandidate[];
};
