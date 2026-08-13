/** LanguageAvailability.Status に対応。unknownは将来Appleがcaseを追加した場合の受け皿。 */
export type TranslationAvailabilityStatus = 'installed' | 'supported' | 'unsupported' | 'unknown';

export type TranslationAvailability = {
  /** 実際に解決された言語識別子（BCP-47 minimal form。例: 'th', 'zh-Hant'） */
  sourceLanguage: string;
  targetLanguage: string;
  status: TranslationAvailabilityStatus;
};

export type TranslationResult = {
  sourceText: string;
  translatedText: string;
  /** Vision OCR側の指定ではなく、Translation frameworkが返した実際の言語 */
  sourceLanguage: string;
  targetLanguage: string;
  /** リクエスト順のindexを文字列化したもの。順序対応の確認に使う */
  clientIdentifier: string;
};

export type TranslationBatchResponse = {
  /** リクエストと同じ順序で返る（Apple公式記載のtranslations(from:)の挙動） */
  results: TranslationResult[];
  elapsedMs: number;
};

export type TranslationPrepareResponse = {
  prepared: boolean;
  elapsedMs: number;
};

/**
 * ネイティブ側が返すエラーコード。
 * - ERR_TRANSLATION_UNSUPPORTED_OS … iOS 18.0未満
 * - ERR_TRANSLATION_HOST_UNAVAILABLE … ホストViewが未マウント
 * - ERR_TRANSLATION_HOST_UNMOUNTED … 処理待ち・処理中にホストViewが外れた
 * - ERR_TRANSLATION_CANCELLED … キャンセル
 * - ERR_TRANSLATION_FAILED … Translation framework側のエラー（言語未導入・DL拒否など）
 */
export type TranslationErrorCode =
  | 'ERR_TRANSLATION_UNSUPPORTED_OS'
  | 'ERR_TRANSLATION_HOST_UNAVAILABLE'
  | 'ERR_TRANSLATION_HOST_UNMOUNTED'
  | 'ERR_TRANSLATION_CANCELLED'
  | 'ERR_TRANSLATION_FAILED';
