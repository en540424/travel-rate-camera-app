/**
 * 写真翻訳（翻訳ページ）。写真を撮る／選ぶ → 静止画OCR → 段落にまとめる → 翻訳。
 *
 * リアルタイム（その場で見る）とは役割が違い、長文・メニュー・注意書きを落ち着いて読むためのもの。
 * 翻訳は共有の`translateSceneTexts`（Apple Translation・端末内）を使い、別実装を増やさない。
 *
 * 写真の扱い: OCR・表示のためにアプリのキャッシュ領域の一時ファイルを読むだけで、DB・写真ライブラリ・
 * クラウドへは保存しない。新しい写真に替えた時・クリア時・画面を閉じた時に一時ファイルを削除する。
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { groupLinesIntoBlocks, resolveSourceLanguageForText, type TextBlock } from '@/lib/live-text-core';
import { recognizePhotoText } from '@/lib/photo-text-recognition';
import { translateSceneTexts } from '@/lib/scene-translation-service';
import type { MemoTranslationErrorCode } from '@/lib/translation-types';

/** 1枚の写真から翻訳するまとまりの上限（極端に文字の多い写真で固まらないように） */
const MAX_BLOCKS = 60;

export type PhotoBlockTranslation = {
  original: string;
  translated: string | null;
  /** 翻訳元（文字種から判定）。nullは翻訳不要（翻訳先と同じ言語・数字だけ等） */
  sourceLanguage: string | null;
  status: 'translated' | 'untranslated' | 'failed';
};

export type PhotoTranslationState =
  | { phase: 'idle' }
  | { phase: 'recognizing'; uri: string }
  | { phase: 'translating'; uri: string; blocks: PhotoBlockTranslation[] }
  | {
      phase: 'done';
      uri: string;
      blocks: PhotoBlockTranslation[];
      /** 一部でも翻訳に失敗した時のエラー（訳せた分は表示する） */
      errorCode: MemoTranslationErrorCode | null;
    }
  | { phase: 'no_text'; uri: string }
  | { phase: 'error'; uri: string | null; reason: 'ocr_failed' | 'ocr_unavailable' };

async function deleteTemporaryPhoto(uri: string | null): Promise<void> {
  if (!uri) return;
  try {
    const FileSystem = await import('expo-file-system/legacy');
    // アプリのキャッシュ領域の一時ファイルだけを消す（撮影・選択時にコピーされたもの）
    const cacheDir = FileSystem.cacheDirectory;
    if (!cacheDir || !uri.startsWith(cacheDir)) return;
    await FileSystem.deleteAsync(uri, { idempotent: true });
  } catch {
    // 削除できなくてもOSがキャッシュとして後で消す。画面は止めない
  }
}

export function usePhotoTranslation({
  sourceLanguage,
  targetLanguage,
}: {
  sourceLanguage: string | null;
  targetLanguage: string | null;
}) {
  const [state, setState] = useState<PhotoTranslationState>({ phase: 'idle' });
  const generationRef = useRef(0);
  const currentUriRef = useRef<string | null>(null);
  /** OCR結果の再利用（言語を変えた時の再翻訳でOCRをやり直さない）。キーは「写真＋翻訳元」 */
  const ocrCacheRef = useRef<{ key: string; blocks: TextBlock[] } | null>(null);

  const run = useCallback(
    async (uri: string, source: string, target: string) => {
      const generation = generationRef.current + 1;
      generationRef.current = generation;
      const isCurrent = () => generationRef.current === generation;

      const ocrKey = `${uri}|${source}`;
      let blocks = ocrCacheRef.current?.key === ocrKey ? ocrCacheRef.current.blocks : null;

      if (blocks == null) {
        setState({ phase: 'recognizing', uri });
        const recognized = await recognizePhotoText(uri, source);
        if (!isCurrent()) return;
        if (recognized.status === 'no_text') {
          setState({ phase: 'no_text', uri });
          return;
        }
        if (recognized.status === 'unavailable') {
          setState({ phase: 'error', uri, reason: 'ocr_unavailable' });
          return;
        }
        if (recognized.status === 'failed') {
          setState({ phase: 'error', uri, reason: 'ocr_failed' });
          return;
        }
        blocks = groupLinesIntoBlocks(recognized.lines).slice(0, MAX_BLOCKS);
        ocrCacheRef.current = { key: ocrKey, blocks };
      }

      const pending: PhotoBlockTranslation[] = blocks.map((block) => {
        const blockSource = resolveSourceLanguageForText(block.text, source, target);
        return {
          original: block.text,
          translated: null,
          sourceLanguage: blockSource,
          status: 'untranslated',
        };
      });
      setState({ phase: 'translating', uri, blocks: pending });

      // 翻訳元ごとにまとめ、順番に送る（同時に複数送らない）
      const sources = [...new Set(pending.map((block) => block.sourceLanguage).filter((s): s is string => s != null))];
      const translations = new Map<string, Map<string, string>>();
      let errorCode: MemoTranslationErrorCode | null = null;
      for (const blockSource of sources) {
        const texts = pending.filter((block) => block.sourceLanguage === blockSource).map((block) => block.original);
        const result = await translateSceneTexts({ texts, sourceLanguage: blockSource, targetLanguage: target });
        if (!isCurrent()) return;
        translations.set(blockSource, result.translations);
        if (result.status !== 'done' && result.status !== 'cancelled') {
          errorCode = result.errorCode ?? 'translation_failed';
        }
      }

      const finished: PhotoBlockTranslation[] = pending.map((block) => {
        if (block.sourceLanguage == null) return block;
        const translated = translations.get(block.sourceLanguage)?.get(block.original) ?? null;
        return translated != null
          ? { ...block, translated, status: 'translated' }
          : { ...block, status: 'failed' };
      });
      setState({ phase: 'done', uri, blocks: finished, errorCode });
    },
    [],
  );

  /** 新しい写真で翻訳を始める（前の一時ファイルは削除する） */
  const start = useCallback(
    (uri: string) => {
      const previous = currentUriRef.current;
      currentUriRef.current = uri;
      ocrCacheRef.current = null;
      if (sourceLanguage == null || targetLanguage == null) {
        // 言語の取得待ち。表示を新しい写真へ切り替えておき、言語が揃った時点のeffectで翻訳する
        generationRef.current += 1;
        setState({ phase: 'recognizing', uri });
      } else {
        void run(uri, sourceLanguage, targetLanguage);
      }
      // 表示が新しい写真へ切り替わってから、前の一時ファイルを消す
      if (previous && previous !== uri) void deleteTemporaryPhoto(previous);
    },
    [run, sourceLanguage, targetLanguage],
  );

  /** 失敗した翻訳をやり直す（未導入の言語ならApple標準のDL案内が出る） */
  const retry = useCallback(() => {
    const uri = currentUriRef.current;
    if (uri == null || sourceLanguage == null || targetLanguage == null) return;
    void run(uri, sourceLanguage, targetLanguage);
  }, [run, sourceLanguage, targetLanguage]);

  const clear = useCallback(() => {
    generationRef.current += 1;
    const previous = currentUriRef.current;
    currentUriRef.current = null;
    ocrCacheRef.current = null;
    setState({ phase: 'idle' });
    void deleteTemporaryPhoto(previous);
  }, []);

  // 翻訳元・翻訳先を変えたら、同じ写真で翻訳し直す（翻訳元が変わった時はOCRからやり直す）
  useEffect(() => {
    const uri = currentUriRef.current;
    if (uri == null || sourceLanguage == null || targetLanguage == null) return;
    void run(uri, sourceLanguage, targetLanguage);
  }, [run, sourceLanguage, targetLanguage]);

  // 画面が破棄される時は一時ファイルを消す
  useEffect(() => {
    return () => {
      generationRef.current += 1;
      void deleteTemporaryPhoto(currentUriRef.current);
    };
  }, []);

  return { state, start, retry, clear };
}
