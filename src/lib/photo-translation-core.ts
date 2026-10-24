/**
 * 写真翻訳（`use-photo-translation.ts`）の純粋ロジック。React・nativeに依存しない（`photo-translation-core.test.mjs`）。
 *
 * 1枚の写真の全段落を1回の`translateBatch`で送ると、Apple Translationは全件の翻訳が終わるまで
 * 1件も返さない（`translations(from:)`は一括で返る）。そのため写真翻訳は小さなまとまりに分けて
 * **1つずつ順番に**送り、終わったまとまりから画面へ出す。翻訳の品質は変わらない
 * （Apple側も1件ずつ独立したRequestとして訳すため、まとめ方で訳文は変わらない）。
 */
import type { MemoTranslationErrorCode } from './translation-types';

/** 最初のまとまり。少なくして、最初の訳文をなるべく早く出す */
export const PHOTO_FIRST_CHUNK_SIZE = 2;
/** 2つ目以降のまとまり。nativeとの往復回数を増やしすぎない */
export const PHOTO_CHUNK_SIZE = 6;
/**
 * 翻訳が進まない時間がこれを超えたら「時間がかかっています（やり直す）」を出す。
 * **失敗扱いにはしない**（初回の言語データのダウンロードは正当に数十秒〜数分かかる）。
 */
export const PHOTO_TRANSLATION_STALL_HINT_MS = 15000;

export type PhotoBlockTranslation = {
  original: string;
  translated: string | null;
  /** 翻訳元（文字種から判定）。nullは翻訳不要（翻訳先と同じ言語・数字だけ等） */
  sourceLanguage: string | null;
  status: 'translated' | 'untranslated' | 'failed';
};

export type PhotoTranslationChunk = {
  sourceLanguage: string;
  texts: string[];
};

/**
 * 翻訳を送るまとまりを、画面の上から順に作る。同じ翻訳元の段落だけを1つのまとまりにし
 * （Appleの指針：1回の要求は同じ翻訳元）、同じ文は1回だけ送る。訳済み（cache由来を含む）の段落は送らない。
 */
export function planPhotoTranslationChunks(
  blocks: readonly PhotoBlockTranslation[],
  firstSize: number = PHOTO_FIRST_CHUNK_SIZE,
  restSize: number = PHOTO_CHUNK_SIZE,
): PhotoTranslationChunk[] {
  const chunks: PhotoTranslationChunk[] = [];
  const seen = new Set<string>();
  /** 翻訳元ごとの「まだ埋まっていない最後のまとまり」 */
  const open = new Map<string, PhotoTranslationChunk>();
  for (const block of blocks) {
    const source = block.sourceLanguage;
    if (source == null || block.translated != null || block.original.trim() === '') continue;
    const key = `${source}\n${block.original}`;
    if (seen.has(key)) continue;
    seen.add(key);

    let chunk = open.get(source);
    // 最初のまとまりだけ小さくする
    const limit = chunk != null && chunk === chunks[0] ? firstSize : restSize;
    if (chunk == null || chunk.texts.length >= limit) {
      chunk = { sourceLanguage: source, texts: [] };
      chunks.push(chunk);
      open.set(source, chunk);
    }
    chunk.texts.push(block.original);
  }
  return chunks;
}

/** 1つのまとまりの翻訳結果を段落へ反映する（訳せた段落だけを'translated'にする） */
export function applyPhotoChunkTranslations(
  blocks: readonly PhotoBlockTranslation[],
  sourceLanguage: string,
  translations: ReadonlyMap<string, string>,
): PhotoBlockTranslation[] {
  return blocks.map((block) => {
    if (block.sourceLanguage !== sourceLanguage || block.translated != null) return block;
    const translated = translations.get(block.original);
    return translated != null ? { ...block, translated, status: 'translated' } : block;
  });
}

/** 翻訳を終えた時点で訳文の無い段落（翻訳不要を除く）を'failed'にする */
export function finalizePhotoBlocks(blocks: readonly PhotoBlockTranslation[]): PhotoBlockTranslation[] {
  return blocks.map((block) =>
    block.sourceLanguage != null && block.translated == null ? { ...block, status: 'failed' } : block,
  );
}

/** 翻訳が必要な段落の数と、そのうち訳せた数（進捗表示用） */
export function countPhotoTranslationProgress(blocks: readonly PhotoBlockTranslation[]): {
  translated: number;
  total: number;
} {
  let translated = 0;
  let total = 0;
  for (const block of blocks) {
    if (block.sourceLanguage == null) continue;
    total += 1;
    if (block.translated != null) translated += 1;
  }
  return { translated, total };
}

/**
 * 「もう一度翻訳する」を出すか。訳せなかった段落があり、やり直して変わりうる時だけ出す
 * （iOS非対応・言語の組み合わせ非対応は、やり直しても結果が変わらない）。
 */
export function canRetryPhotoTranslation(
  errorCode: MemoTranslationErrorCode | null,
  blocks: readonly PhotoBlockTranslation[],
): boolean {
  if (errorCode === 'unsupported_os' || errorCode === 'unsupported_language') return false;
  return blocks.some((block) => block.status === 'failed');
}
