/**
 * 写真翻訳（翻訳ページ）。写真を撮る／選ぶ → 静止画OCR → 段落にまとめる → 翻訳。
 *
 * リアルタイム（その場で見る）とは役割が違い、長文・メニュー・注意書きを落ち着いて読むためのもの。
 * 翻訳は共有の`translateSceneTexts`（Apple Translation・端末内）を使い、別実装を増やさない。
 *
 * 翻訳の送り方（2026-10-24）: 全段落を1回で送ると全件が終わるまで1件も出ないため、
 * 小さなまとまりに分けて**1つずつ順番に**送り、終わったまとまりから表示する（`photo-translation-core.ts`）。
 * `translateBatch`にtimeoutは掛けない（初回のモデルDLは正当に長い）。代わりに、進まない時間が長い時は
 * 「時間がかかっています（やり直す）」を出し、やり直しでは翻訳ホストを作り直してから送り直す
 * （native側で応答が返らない要求が残っていても、その後ろに並んで待ち続けないようにするため）。
 *
 * 写真の扱い: OCR・表示のためにアプリのキャッシュ領域の一時ファイルを読むだけで、DB・写真ライブラリ・
 * クラウドへは保存しない。新しい写真に替えた時・クリア時・画面を閉じた時に一時ファイルを削除する。
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  extractTranslationPrices,
  groupLinesIntoBlocks,
  resolveSourceLanguageForText,
  type TextBlock,
} from '@/lib/live-text-core';
import {
  PHOTO_TRANSLATION_STALL_HINT_MS,
  applyPhotoChunkTranslations,
  countPhotoTranslationProgress,
  finalizePhotoBlocks,
  planPhotoTranslationChunks,
  type PhotoBlockTranslation,
} from '@/lib/photo-translation-core';
import { recognizePhotoText } from '@/lib/photo-text-recognition';
import {
  getCachedSceneTranslation,
  getScenePairAvailability,
  translateSceneTexts,
} from '@/lib/scene-translation-service';
import type { MemoTranslationErrorCode } from '@/lib/translation-types';
import { extractPriceCandidates } from '@/utils/extract-prices';

export type { PhotoBlockTranslation } from '@/lib/photo-translation-core';

/** 1枚の写真から翻訳するまとまりの上限（極端に文字の多い写真で固まらないように） */
const MAX_BLOCKS = 60;

/** 翻訳ホストを作り直してから送り直すまでの待ち（新しいホストがnativeへ登録されるのを待つ） */
const HOST_RESET_SETTLE_MS = 300;

export type PhotoTranslationState =
  | { phase: 'idle' }
  | { phase: 'recognizing'; uri: string }
  | {
      phase: 'translating';
      uri: string;
      blocks: PhotoBlockTranslation[];
      /** 言語ペアの翻訳データが端末に無い（Appleのダウンロード案内・ダウンロード待ちになる） */
      needsDownload: boolean;
      /** 翻訳が進まないまま一定時間たった（失敗ではない。やり直しを出す） */
      slow: boolean;
    }
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

/** いずれかの言語ペアの翻訳データが未導入か（参考情報。取得できなければfalse） */
async function needsLanguageDownload(sources: readonly string[], target: string): Promise<boolean> {
  const statuses = await Promise.all(sources.map((source) => getScenePairAvailability(source, target)));
  return statuses.includes('supported');
}

export function usePhotoTranslation({
  sourceLanguage,
  targetLanguage,
  priceCurrency = null,
  onResetTranslationHost,
}: {
  sourceLanguage: string | null;
  targetLanguage: string | null;
  /**
   * 円換算する旅行の通貨（国内・旅行なしはnull）。価格の行を前後の文章とつながない（1段落に複数品目の
   * 価格が混ざらない）ようにするためだけに使う。円換算の表示は`PhotoTranslationPanel`が行う
   */
  priceCurrency?: string | null;
  /** 翻訳ホストを作り直す（やり直し時）。未指定なら作り直さずに送り直す */
  onResetTranslationHost?: () => void;
}) {
  const [state, setState] = useState<PhotoTranslationState>({ phase: 'idle' });
  const generationRef = useRef(0);
  const currentUriRef = useRef<string | null>(null);
  /** OCR結果の再利用（言語を変えた時の再翻訳でOCRをやり直さない）。キーは「写真＋翻訳元」 */
  const ocrCacheRef = useRef<{ key: string; blocks: TextBlock[] } | null>(null);
  const stallTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearStallTimer = useCallback(() => {
    if (stallTimerRef.current) {
      clearTimeout(stallTimerRef.current);
      stallTimerRef.current = null;
    }
  }, []);

  const clearTimers = useCallback(() => {
    clearStallTimer();
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
  }, [clearStallTimer]);

  const run = useCallback(
    async (uri: string, source: string, target: string) => {
      const generation = generationRef.current + 1;
      generationRef.current = generation;
      const isCurrent = () => generationRef.current === generation;
      clearStallTimer();

      const ocrKey = `${uri}|${source}|${priceCurrency ?? ''}`;
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
        const hasPrice =
          priceCurrency == null
            ? undefined
            : (text: string) =>
                extractTranslationPrices(text, priceCurrency, (value) => extractPriceCandidates(value, priceCurrency))
                  .length > 0;
        blocks = groupLinesIntoBlocks(recognized.lines, hasPrice).slice(0, MAX_BLOCKS);
        ocrCacheRef.current = { key: ocrKey, blocks };
      }

      // 訳済み（cache）の段落は最初から訳文を出す（言語の切替で戻した時・やり直し時に待たせない）
      let current: PhotoBlockTranslation[] = blocks.map((block) => {
        const blockSource = resolveSourceLanguageForText(block.text, source, target);
        const cached = blockSource == null ? undefined : getCachedSceneTranslation(blockSource, target, block.text);
        return cached !== undefined
          ? { original: block.text, translated: cached, sourceLanguage: blockSource, status: 'translated', box: block.box }
          : { original: block.text, translated: null, sourceLanguage: blockSource, status: 'untranslated', box: block.box };
      });
      setState({ phase: 'translating', uri, blocks: current, needsDownload: false, slow: false });

      const chunks = planPhotoTranslationChunks(current);

      // 参考：未導入の言語ペアなら「ダウンロードが必要」を出す（並行して調べ、翻訳の開始は待たせない）。
      // 1件でも訳せた後に返ってきた場合は、もう導入済みなので出さない
      const chunkSources = [...new Set(chunks.map((chunk) => chunk.sourceLanguage))];
      if (chunkSources.length > 0) {
        void needsLanguageDownload(chunkSources, target).then((needs) => {
          if (!needs || !isCurrent()) return;
          setState((prev) =>
            prev.phase === 'translating' && countPhotoTranslationProgress(prev.blocks).translated === 0
              ? { ...prev, needsDownload: true }
              : prev,
          );
        });
      }

      // 進まない時間が長い時だけ「時間がかかっています」を出す（失敗扱いにはしない）
      const armStallHint = () => {
        clearStallTimer();
        stallTimerRef.current = setTimeout(() => {
          stallTimerRef.current = null;
          if (!isCurrent()) return;
          setState((prev) => (prev.phase === 'translating' ? { ...prev, slow: true } : prev));
        }, PHOTO_TRANSLATION_STALL_HINT_MS);
      };

      // まとまりごとに順番に送る（同時に複数送らない）。終わったまとまりから表示する
      let errorCode: MemoTranslationErrorCode | null = null;
      const stoppedSources = new Set<string>();
      for (const chunk of chunks) {
        // 失敗した翻訳元の残りは送らない（ダウンロード案内を閉じた後、まとまりの数だけ案内が出直さないように）
        if (stoppedSources.has(chunk.sourceLanguage)) continue;
        armStallHint();
        const result = await translateSceneTexts({
          texts: chunk.texts,
          sourceLanguage: chunk.sourceLanguage,
          targetLanguage: target,
        });
        if (!isCurrent()) return;
        current = applyPhotoChunkTranslations(current, chunk.sourceLanguage, result.translations);
        if (result.status !== 'done') {
          stoppedSources.add(chunk.sourceLanguage);
          errorCode ??= result.errorCode ?? 'translation_failed';
          continue;
        }
        const progressed = current;
        setState((prev) =>
          prev.phase === 'translating' ? { ...prev, blocks: progressed, needsDownload: false, slow: false } : prev,
        );
      }
      clearStallTimer();

      setState({ phase: 'done', uri, blocks: finalizePhotoBlocks(current), errorCode });
    },
    [clearStallTimer, priceCurrency],
  );

  /** 新しい写真で翻訳を始める（前の一時ファイルは削除する） */
  const start = useCallback(
    (uri: string) => {
      const previous = currentUriRef.current;
      currentUriRef.current = uri;
      ocrCacheRef.current = null;
      clearTimers();
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
    [clearTimers, run, sourceLanguage, targetLanguage],
  );

  /**
   * 翻訳をやり直す（失敗・時間がかかっている時）。未導入の言語ならApple標準のDL案内が出る。
   * 実行中の要求の結果は捨て、翻訳ホストを作り直してから送り直す。訳せた段落はcacheからすぐ出る。
   */
  const retry = useCallback(() => {
    const uri = currentUriRef.current;
    if (uri == null || sourceLanguage == null || targetLanguage == null) return;
    clearTimers();
    if (onResetTranslationHost == null) {
      void run(uri, sourceLanguage, targetLanguage);
      return;
    }
    generationRef.current += 1;
    const generation = generationRef.current;
    setState((prev) =>
      prev.phase === 'translating' || prev.phase === 'done'
        ? {
            phase: 'translating',
            uri,
            blocks: prev.blocks.map((block) =>
              block.status === 'failed' ? { ...block, status: 'untranslated' } : block,
            ),
            needsDownload: false,
            slow: false,
          }
        : prev,
    );
    onResetTranslationHost();
    retryTimerRef.current = setTimeout(() => {
      retryTimerRef.current = null;
      if (generationRef.current !== generation) return;
      void run(uri, sourceLanguage, targetLanguage);
    }, HOST_RESET_SETTLE_MS);
  }, [clearTimers, onResetTranslationHost, run, sourceLanguage, targetLanguage]);

  const clear = useCallback(() => {
    generationRef.current += 1;
    clearTimers();
    const previous = currentUriRef.current;
    currentUriRef.current = null;
    ocrCacheRef.current = null;
    setState({ phase: 'idle' });
    void deleteTemporaryPhoto(previous);
  }, [clearTimers]);

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
      clearTimers();
      void deleteTemporaryPhoto(currentUriRef.current);
    };
  }, [clearTimers]);

  return { state, start, retry, clear };
}
