/**
 * 写真翻訳用の静止画OCR（iOS・Apple Vision）。
 *
 * **既存の`modules/vision-ocr`（価格OCRと同じnative）をそのまま呼ぶだけで、価格OCRの経路
 * （`CameraPreview.native.tsx`の`recognizeText`）には触れない。** 価格OCRは通貨→言語、
 * こちらは翻訳元の言語→言語で認識言語を決める。
 *
 * 画像はOCRのために読むだけで、保存・送信しない。
 */
import { Platform } from 'react-native';

import { getVisionLanguagesForSource, type RecognizedLine } from './live-text-core';

type VisionOcrNative = typeof import('../../modules/vision-ocr');

let nativePromise: Promise<VisionOcrNative | null> | undefined;
let supportedLanguagesPromise: Promise<string[]> | undefined;

function loadVisionOcr(): Promise<VisionOcrNative | null> {
  if (Platform.OS !== 'ios') return Promise.resolve(null);
  if (nativePromise) return nativePromise;
  nativePromise = import('../../modules/vision-ocr').catch((error: unknown) => {
    if (__DEV__) console.warn('[PhotoOcr] vision-ocrを読み込めませんでした', error);
    return null;
  });
  return nativePromise;
}

function loadSupportedLanguages(native: VisionOcrNative): Promise<string[]> {
  if (supportedLanguagesPromise) return supportedLanguagesPromise;
  supportedLanguagesPromise = native.getSupportedLanguages('accurate').catch(() => {
    // 取得できなかった場合は次回また取りに行く
    supportedLanguagesPromise = undefined;
    return [];
  });
  return supportedLanguagesPromise;
}

export type PhotoRecognitionResult =
  | { status: 'ok'; lines: RecognizedLine[] }
  | { status: 'no_text' }
  | { status: 'unavailable' }
  | { status: 'failed'; message: string };

/** 写真の文字を行ごと（位置付き）に読み取る。**rejectしない。** */
export async function recognizePhotoText(uri: string, sourceLanguage: string): Promise<PhotoRecognitionResult> {
  const native = await loadVisionOcr();
  if (!native) return { status: 'unavailable' };

  const requested = getVisionLanguagesForSource(sourceLanguage);
  const supported = await loadSupportedLanguages(native);
  // 実機が対応しない言語を渡すとnativeがエラーにするため、対応する言語だけに絞る
  const languages = supported.length > 0 ? requested.filter((code) => supported.includes(code)) : requested;

  try {
    const result = await native.recognizeText(uri, {
      languages,
      recognitionLevel: 'accurate',
      usesLanguageCorrection: true,
      // 言語を1つも指定できない端末では、Visionの言語自動判定に任せる
      automaticallyDetectsLanguage: languages.length === 0,
      maxCandidates: 1,
    });
    const lines: RecognizedLine[] = result.lines
      .filter((line) => line.text.trim() !== '')
      .map((line) => ({
        text: line.text,
        confidence: line.confidence,
        // Visionの座標は左下原点。共有ロジックは左上原点で扱うため変換する
        box: {
          x: line.boundingBox.x,
          y: 1 - line.boundingBox.y - line.boundingBox.height,
          width: line.boundingBox.width,
          height: line.boundingBox.height,
        },
      }));
    return lines.length > 0 ? { status: 'ok', lines } : { status: 'no_text' };
  } catch (error) {
    const code = typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined;
    if (code === 'ERR_VISION_OCR_NO_RESULT') return { status: 'no_text' };
    return { status: 'failed', message: error instanceof Error ? error.message : String(error) };
  }
}
