/** Apple Visionの認識精度モード（VNRequestTextRecognitionLevel）。 */
export type VisionOcrRecognitionLevel = 'accurate' | 'fast';

export type VisionOcrOptions = {
  /** 認識対象言語（Visionの言語コード。例: 'en-US', 'ja-JP'）。未指定または空配列でVisionの既定挙動に委ねる。 */
  languages?: string[];
  /** 認識モード。デフォルト 'accurate'。 */
  recognitionLevel?: VisionOcrRecognitionLevel;
  /** Appleの言語補正（自動テキスト訂正）を使うか。デフォルト true。 */
  usesLanguageCorrection?: boolean;
  /** 言語自動判定。iOS 16未満では無視される（設定がスキップされるだけで、他の設定・OCR自体はそのまま実行される）。デフォルト false。 */
  automaticallyDetectsLanguage?: boolean;
  /** 検出する最小テキスト高さ（画像高さに対する比率、0〜1）。0または未指定でフィルタなし（Visionの既定と同じ）。 */
  minimumTextHeight?: number;
  /** 行ごとに返す認識候補数の上限。1〜5にクランプされる。デフォルト 3。 */
  maxCandidates?: number;
};

export type VisionOcrCandidate = {
  text: string;
  confidence: number;
};

/**
 * Apple Visionの正規化座標をそのまま保持する（画面描画用の変換はしていない）。
 * 原点は画像の「左下」。x/y/width/heightはすべて画像サイズに対する 0〜1 の比率値。
 */
export type VisionOcrBoundingBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type VisionOcrLine = {
  text: string;
  confidence: number;
  boundingBox: VisionOcrBoundingBox;
  candidates: VisionOcrCandidate[];
};

export type VisionOcrResult = {
  fullText: string;
  lines: VisionOcrLine[];
  /** 実際にVisionへ渡した言語指定（未指定なら空配列）。 */
  requestedLanguages: string[];
  /** 指定したrecognitionLevelで実機がサポートする言語一覧。静的な想定ではなく実機取得値。 */
  supportedLanguages: string[];
  recognitionLevel: VisionOcrRecognitionLevel;
  /** ネイティブ側（画像読み込み〜Vision処理完了）の所要時間(ms)。 */
  elapsedMs: number;
};

/**
 * ネイティブ側Exceptionのクラス名から自動生成されるエラーコード
 * （例: VisionOcrFileNotFoundException → ERR_VISION_OCR_FILE_NOT_FOUND）。
 * 「OCR failed」に丸めず、原因ごとに区別するために使う。
 */
export type VisionOcrErrorCode =
  | 'ERR_VISION_OCR_FILE_NOT_FOUND'
  | 'ERR_VISION_OCR_INVALID_URI'
  | 'ERR_VISION_OCR_IMAGE_DECODE_FAILED'
  | 'ERR_VISION_OCR_CG_IMAGE_CONVERSION_FAILED'
  | 'ERR_VISION_OCR_UNSUPPORTED_LANGUAGE'
  | 'ERR_VISION_OCR_REQUEST_FAILED'
  | 'ERR_VISION_OCR_NO_RESULT'
  | 'ERR_VISION_OCR_OS_NOT_SUPPORTED';

/** ネイティブ側の生のオプション形（すべて必須・JS側でデフォルトを埋めてから渡す）。 */
export type VisionOcrNativeOptions = {
  languages: string[];
  recognitionLevel: VisionOcrRecognitionLevel;
  usesLanguageCorrection: boolean;
  automaticallyDetectsLanguage: boolean;
  minimumTextHeight: number;
  maxCandidates: number;
};
