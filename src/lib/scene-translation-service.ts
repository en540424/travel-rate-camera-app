/**
 * カメラ・写真に写った文字（短い行・段落の一覧）を翻訳するnative呼び出しラッパー。
 * スマートカメラ（メインカメラ）・翻訳ページのカメラ翻訳・写真翻訳で共有する。
 *
 * **翻訳エンジンは既存と同じApple Translation（オンデバイス・追加費用なし）。**
 * `modules/translation`の`translateBatch`を、既存の`TranslationHost`（画面フォーカス中だけマウント）
 * 経由で使う。新しい翻訳サービス・外部APIは使わない。
 *
 * 既存2経路との関係:
 * - `translation-service.ts`（OCRメモ候補）… target=ja固定・`MemoCandidate[]`専用。変更しない。
 *   ここでは同ファイルの純粋関数（結果の突き合わせ・エラー正規化）だけを再利用する
 * - `text-translation-service.ts`（自由入力1件）… cacheを持たない。変更しない
 *
 * 守る約束（既存と同じ。理由は`text-translation-service.ts`の同趣旨コメントを参照）:
 * - `translateBatch`にtimeoutを掛けない（初回のモデルDLは正当に数十秒かかる）
 * - `cancelAll()`を呼ばない（nativeのconfigurationがnilのまま残る既知事象）
 * - `prepare()`を呼ばない（未導入ならApple標準のDL案内が`translateBatch`時に出る）
 *
 * 呼び出し側（リアルタイム）は**同時に1要求まで**に絞ること（`use-live-text-translation.ts`）。
 */
import { LruCache } from './live-text-core';
import {
  buildTranslationCacheKey,
  normalizeTranslationError,
  resolveTranslationsByOriginalText,
} from './translation-service';
import type { MemoTranslationErrorCode } from './translation-types';
import type { TranslationAvailabilityStatus } from '../../modules/translation';

type TranslationNative = typeof import('../../modules/translation');

/** 画面のセッション中に同じ文字を何度も翻訳しないためのcache（メモリのみ・永続化しない） */
const sceneCache = new LruCache<string>(500);
const availabilityCache = new Map<string, TranslationAvailabilityStatus>();

/** `getAvailability`のハングガード（`translation-service.ts`と同じ値・同じ理由） */
const AVAILABILITY_TIMEOUT_MS = 5000;

let nativeModulePromise: Promise<TranslationNative | null> | undefined;

function loadTranslationNative(): Promise<TranslationNative | null> {
  if (nativeModulePromise) return nativeModulePromise;
  nativeModulePromise = import('../../modules/translation').catch((error: unknown) => {
    if (typeof __DEV__ !== 'undefined' && __DEV__) {
      console.warn('[SceneTranslation] translation moduleを読み込めませんでした', error);
    }
    return null;
  });
  return nativeModulePromise;
}

function isTranslationOsSupported(native: TranslationNative): boolean {
  try {
    return native.isSupportedOs();
  } catch {
    return false;
  }
}

/** 翻訳済みの訳文（無ければundefined）。描画中に同期で引けるようにする */
export function getCachedSceneTranslation(
  sourceLanguage: string,
  targetLanguage: string,
  text: string,
): string | undefined {
  return sceneCache.get(buildTranslationCacheKey(sourceLanguage, targetLanguage, text));
}

export function hasCachedSceneTranslation(
  sourceLanguage: string,
  targetLanguage: string,
  text: string,
): boolean {
  return sceneCache.has(buildTranslationCacheKey(sourceLanguage, targetLanguage, text));
}

export type SceneTranslationStatus = 'done' | 'unavailable' | 'failed' | 'cancelled';

export type SceneTranslationResult = {
  status: SceneTranslationStatus;
  /** 原文 → 訳文（cache由来を含む） */
  translations: Map<string, string>;
  errorCode?: MemoTranslationErrorCode;
};

/**
 * 複数の文字列を1つのsource言語でまとめて翻訳する。**rejectしない。**
 * cache済みの文字列はnativeへ送らず、結果にだけ含める。
 */
export async function translateSceneTexts({
  texts,
  sourceLanguage,
  targetLanguage,
}: {
  texts: readonly string[];
  sourceLanguage: string;
  targetLanguage: string;
}): Promise<SceneTranslationResult> {
  const translations = new Map<string, string>();
  const toRequest: string[] = [];
  for (const text of texts) {
    if (text.trim() === '' || translations.has(text) || toRequest.includes(text)) continue;
    const cached = getCachedSceneTranslation(sourceLanguage, targetLanguage, text);
    if (cached !== undefined) {
      translations.set(text, cached);
    } else {
      toRequest.push(text);
    }
  }
  if (toRequest.length === 0) return { status: 'done', translations };

  const native = await loadTranslationNative();
  if (!native || !isTranslationOsSupported(native)) {
    return { status: 'unavailable', translations, errorCode: 'unsupported_os' };
  }

  try {
    const response = await native.translateBatch(toRequest, sourceLanguage, targetLanguage);
    const resolved = resolveTranslationsByOriginalText(toRequest, response.results);
    for (const [originalText, translation] of resolved) {
      sceneCache.set(
        buildTranslationCacheKey(sourceLanguage, targetLanguage, originalText),
        translation.translatedText,
      );
      translations.set(originalText, translation.translatedText);
    }
    return { status: 'done', translations };
  } catch (error) {
    const { errorCode } = normalizeTranslationError(error);
    if (errorCode === 'cancelled') return { status: 'cancelled', translations, errorCode };
    const status: SceneTranslationStatus =
      errorCode === 'unsupported_os' || errorCode === 'unsupported_language' ? 'unavailable' : 'failed';
    return { status, translations, errorCode };
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('TIMEOUT')), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/**
 * 言語ペアの導入状態（参考情報）。取得できなければ'unknown'。
 * リアルタイム翻訳で「未導入（supported）」のペアへ自動送信してDL案内を繰り返し出さないために使う。
 * 'installed'は結果が変わらないのでcacheする。'supported'はDL後に変わるためcacheしない。
 */
export async function getScenePairAvailability(
  sourceLanguage: string,
  targetLanguage: string,
): Promise<TranslationAvailabilityStatus> {
  const key = `${sourceLanguage}>${targetLanguage}`;
  const cached = availabilityCache.get(key);
  if (cached) return cached;

  const native = await loadTranslationNative();
  if (!native || !isTranslationOsSupported(native)) return 'unsupported';
  try {
    const availability = await withTimeout(
      native.getAvailability(sourceLanguage, targetLanguage),
      AVAILABILITY_TIMEOUT_MS,
    );
    if (availability.status === 'installed' || availability.status === 'unsupported') {
      availabilityCache.set(key, availability.status);
    }
    return availability.status;
  } catch {
    return 'unknown';
  }
}

/** Apple Translationが使える端末か（iOS 18以降・native読込可） */
export async function isSceneTranslationSupported(): Promise<boolean> {
  const native = await loadTranslationNative();
  return native != null && isTranslationOsSupported(native);
}
