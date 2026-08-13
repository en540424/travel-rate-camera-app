import VisionOcrModule from './src/VisionOcrModule';
import type { VisionOcrOptions, VisionOcrRecognitionLevel, VisionOcrResult } from './src/VisionOcr.types';

export type {
  VisionOcrBoundingBox,
  VisionOcrCandidate,
  VisionOcrErrorCode,
  VisionOcrLine,
  VisionOcrOptions,
  VisionOcrRecognitionLevel,
  VisionOcrResult,
} from './src/VisionOcr.types';

const DEFAULT_RECOGNITION_LEVEL: VisionOcrRecognitionLevel = 'accurate';
const DEFAULT_MAX_CANDIDATES = 3;
const MIN_MAX_CANDIDATES = 1;
const MAX_MAX_CANDIDATES = 5;

function clampMaxCandidates(value: number | undefined): number {
  if (value == null || Number.isNaN(value)) return DEFAULT_MAX_CANDIDATES;
  return Math.min(Math.max(Math.round(value), MIN_MAX_CANDIDATES), MAX_MAX_CANDIDATES);
}

/**
 * Apple Vision (`VNRecognizeTextRequest`) でテキストを認識する。
 * iOSの通常OCR経路（CameraPreview.native.tsx）と、__DEV__のOCR比較検証パネルの両方から呼ばれる。
 * この関数自体は保存処理を行わない（認識結果を返すのみ）。
 */
export async function recognizeText(
  uri: string,
  options: VisionOcrOptions = {},
): Promise<VisionOcrResult> {
  return VisionOcrModule.recognizeText(uri, {
    languages: options.languages ?? [],
    recognitionLevel: options.recognitionLevel ?? DEFAULT_RECOGNITION_LEVEL,
    usesLanguageCorrection: options.usesLanguageCorrection ?? true,
    automaticallyDetectsLanguage: options.automaticallyDetectsLanguage ?? false,
    minimumTextHeight: options.minimumTextHeight ?? 0,
    maxCandidates: clampMaxCandidates(options.maxCandidates),
  });
}

/**
 * 指定した認識モードで、実機がサポートする言語一覧を取得する。
 * 静的な想定リストではなく、実機のVisionから都度取得する。
 */
export async function getSupportedLanguages(
  recognitionLevel: VisionOcrRecognitionLevel = DEFAULT_RECOGNITION_LEVEL,
): Promise<string[]> {
  return VisionOcrModule.getSupportedLanguages(recognitionLevel);
}
