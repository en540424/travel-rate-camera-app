// 現行OCR(expo-text-extractor)とApple Vision OCR(modules/vision-ocr)の比較用ユーティリティ。
// __DEV__限定の検証基盤専用。本番の保存フロー・onOcrResultには接続しない。
// extractPriceCandidates / extractMemoLines は既存の後処理をそのまま使い、変更しない。
import { extractMemoLines, extractPriceCandidates } from '@/utils/extract-prices';
import type { VisionOcrOptions, VisionOcrRecognitionLevel } from '../../modules/vision-ocr';

export type VisionOcrBenchmarkEngine = 'legacy' | 'vision';
export type VisionOcrBenchmarkArmKind = 'default' | 'extra';
export type VisionOcrBenchmarkStatus = 'idle' | 'running' | 'success' | 'error';

export type VisionOcrBenchmarkArmId =
  | 'legacy'
  | 'vision_en'
  | 'vision_ja'
  | 'vision_ko'
  | 'vision_th'
  | 'vision_zh_hans_en'
  | 'vision_zh_hant_en'
  | 'vision_ja_en'
  | 'vision_auto'
  | 'vision_zh_hant_ja';

export type VisionOcrBenchmarkArmDefinition = {
  id: VisionOcrBenchmarkArmId;
  label: string;
  kind: VisionOcrBenchmarkArmKind;
  engine: VisionOcrBenchmarkEngine;
  /** engine === 'vision' のときだけ使用 */
  options?: VisionOcrOptions;
  /** 追加検証アームの補足説明（UI表示用） */
  note?: string;
};

// 基準（旧方式）+ デフォルト比較アーム（新方式）。撮影ごとに自動実行はせず、パネルからの手動実行のみ。
export const DEFAULT_BENCHMARK_ARMS: VisionOcrBenchmarkArmDefinition[] = [
  { id: 'legacy', label: '旧: expo-text-extractor', kind: 'default', engine: 'legacy' },
  { id: 'vision_en', label: 'Vision: en-US', kind: 'default', engine: 'vision', options: { languages: ['en-US'] } },
  { id: 'vision_ja', label: 'Vision: ja-JP', kind: 'default', engine: 'vision', options: { languages: ['ja-JP'] } },
  { id: 'vision_ko', label: 'Vision: ko-KR', kind: 'default', engine: 'vision', options: { languages: ['ko-KR'] } },
  { id: 'vision_th', label: 'Vision: th-TH', kind: 'default', engine: 'vision', options: { languages: ['th-TH'] } },
  {
    id: 'vision_zh_hans_en',
    label: 'Vision: zh-Hans + en-US',
    kind: 'default',
    engine: 'vision',
    options: { languages: ['zh-Hans', 'en-US'] },
  },
  {
    id: 'vision_zh_hant_en',
    label: 'Vision: zh-Hant + en-US',
    kind: 'default',
    engine: 'vision',
    options: { languages: ['zh-Hant', 'en-US'] },
  },
  {
    id: 'vision_ja_en',
    label: 'Vision: ja-JP + en-US',
    kind: 'default',
    engine: 'vision',
    options: { languages: ['ja-JP', 'en-US'] },
  },
  {
    id: 'vision_auto',
    label: 'Vision: 言語未指定 + 自動判定',
    kind: 'default',
    engine: 'vision',
    options: { languages: [], automaticallyDetectsLanguage: true },
  },
];

// 追加検証アーム：公式仕様上の可否が不明な組み合わせ。まとめて実行には含めず、常に個別の手動実行のみ。
export const EXTRA_BENCHMARK_ARMS: VisionOcrBenchmarkArmDefinition[] = [
  {
    id: 'vision_zh_hant_ja',
    label: '[検証] Vision: zh-Hant + ja-JP',
    kind: 'extra',
    engine: 'vision',
    options: { languages: ['zh-Hant', 'ja-JP'] },
    note: '公式仕様上の可否が不明な組み合わせ。正常動作/エラー/指定無視/精度劣化のどれになるかを実機で確認する。',
  },
];

export type VisionOcrBenchmarkResult = {
  status: VisionOcrBenchmarkStatus;
  fullText?: string;
  priceCandidates?: string[];
  memoLines?: string[];
  /** JS側の壁時計時間（呼び出し〜応答）。旧新どちらも同じ方法で計測し、比較に使う。 */
  elapsedMs?: number;
  /** ネイティブ側(画像読み込み〜Vision処理完了)の所要時間。Vision側のみ。 */
  nativeElapsedMs?: number;
  requestedLanguages?: string[];
  supportedLanguages?: string[];
  recognitionLevel?: VisionOcrRecognitionLevel;
  usesLanguageCorrection?: boolean;
  automaticallyDetectsLanguage?: boolean;
  minimumTextHeight?: number;
  lineConfidences?: { text: string; confidence: number }[];
  errorMessage?: string;
  errorCode?: string;
};

function normalizeError(e: unknown): { message: string; code?: string } {
  if (e instanceof Error) {
    const code = (e as Error & { code?: string }).code;
    return { message: e.message, code };
  }
  return { message: String(e) };
}

/**
 * 1つの比較アームを実行する。
 * vision-ocrはdynamic importで読み込む。development buildに新しいネイティブコードが
 * まだ含まれていない場合でも、この関数を呼ぶまでは例外が起きないようにするため。
 */
export async function runBenchmarkArm(
  arm: VisionOcrBenchmarkArmDefinition,
  uri: string,
  currency: string,
): Promise<VisionOcrBenchmarkResult> {
  const startedAt = Date.now();

  try {
    if (arm.engine === 'legacy') {
      const { extractTextFromImage } = await import('expo-text-extractor');
      const raw = await extractTextFromImage(uri);
      const fullText = Array.isArray(raw) ? raw.join('\n') : String(raw ?? '');
      return {
        status: 'success',
        fullText,
        priceCandidates: extractPriceCandidates(fullText, currency),
        memoLines: extractMemoLines(fullText),
        elapsedMs: Date.now() - startedAt,
      };
    }

    const { recognizeText } = await import('../../modules/vision-ocr');
    const options = arm.options ?? {};
    const result = await recognizeText(uri, options);
    return {
      status: 'success',
      fullText: result.fullText,
      priceCandidates: extractPriceCandidates(result.fullText, currency),
      memoLines: extractMemoLines(result.fullText),
      elapsedMs: Date.now() - startedAt,
      nativeElapsedMs: result.elapsedMs,
      requestedLanguages: result.requestedLanguages,
      supportedLanguages: result.supportedLanguages,
      recognitionLevel: result.recognitionLevel,
      usesLanguageCorrection: options.usesLanguageCorrection ?? true,
      automaticallyDetectsLanguage: options.automaticallyDetectsLanguage ?? false,
      minimumTextHeight: options.minimumTextHeight ?? 0,
      lineConfidences: result.lines.map((line) => ({ text: line.text, confidence: line.confidence })),
    };
  } catch (e) {
    const { message, code } = normalizeError(e);
    return {
      status: 'error',
      elapsedMs: Date.now() - startedAt,
      errorMessage: message,
      errorCode: code,
    };
  }
}

/** 実機のsupportedLanguagesを取得する。静的な想定リストではなく、都度実機から取得した値を正とする。 */
export async function fetchSupportedLanguages(
  recognitionLevel: VisionOcrRecognitionLevel = 'accurate',
): Promise<{ languages: string[]; errorMessage?: string }> {
  try {
    const { getSupportedLanguages } = await import('../../modules/vision-ocr');
    const languages = await getSupportedLanguages(recognitionLevel);
    return { languages };
  } catch (e) {
    const { message } = normalizeError(e);
    return { languages: [], errorMessage: message };
  }
}
