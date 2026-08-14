/**
 * メモ候補チップの「表示」だけを決める純粋関数。
 *
 * React state・OCR・翻訳サービス・DBには依存しない（nodeで直接検証できるようにするため）。
 *
 * **ここはメモ本文へ挿入する文字列を決める場所ではない。**
 * 挿入文字列はPhase 3Bでは原文のままで、変更予定はPhase 3C（`src/utils/memo-text.ts`側の責務）。
 */

import type { MemoCandidate } from '@/lib/translation-types';

/** チップ1件の表示内容。`secondaryText`がnullなら1段表示 */
export type MemoCandidateDisplay = {
  /** 主表示。訳文があればそれ、無ければ原文 */
  primaryText: string;
  /** 補助表示。訳文を主表示にしたときだけ原文が入る。1段表示ならnull */
  secondaryText: string | null;
};

/**
 * OCRのメモ候補行と翻訳結果を突き合わせ、チップ描画用のMemoCandidate列を作る。
 *
 * **並び・件数は必ず`lines`のまま**（`MEMO_PREVIEW_COUNT`の折りたたみ条件・「さらに◯件」の
 * 意味を翻訳の有無で変えないため）。翻訳結果は`originalText`をキーに引き当てるだけで、
 * 候補の増減には関与しない。翻訳がまだ無い／翻訳対象外の通貨／本番ビルドでは
 * `translationStatus: 'idle'`の素の候補になり、従来どおり原文1段で表示される。
 */
export function mergeMemoCandidates(
  lines: string[],
  candidates: MemoCandidate[] | null,
): MemoCandidate[] {
  if (candidates == null || candidates.length === 0) {
    return lines.map((line) => ({ originalText: line, translationStatus: 'idle' as const }));
  }

  // identityは常にoriginalText。訳文・resolvedSourceLanguageをキーにしてはいけない
  // （異なる原文が同じ訳文になることがあるため）
  const byOriginalText = new Map<string, MemoCandidate>();
  for (const candidate of candidates) {
    if (!byOriginalText.has(candidate.originalText)) {
      byOriginalText.set(candidate.originalText, candidate);
    }
  }

  return lines.map(
    (line) => byOriginalText.get(line) ?? { originalText: line, translationStatus: 'idle' as const },
  );
}

/**
 * 候補1件の表示内容を決める。
 *
 * - 訳文があり、原文と実質異なる → 訳文を主表示・原文を補助表示（2段）
 * - 訳文が無い（未翻訳・pending・失敗・翻訳不可） → 原文のみ（1段）
 * - 訳文が原文と同じ → 同じ文字を重ねず原文のみ（1段）
 *
 * `translationStatus`では分岐しない。pending・failedでも訳文が無いだけで原文候補は残す、
 * という扱いを「訳文の有無」1本で表現する。
 */
export function resolveMemoCandidateDisplay(candidate: MemoCandidate): MemoCandidateDisplay {
  const translated = candidate.translatedText?.trim();
  if (!translated || translated === candidate.originalText.trim()) {
    return { primaryText: candidate.originalText, secondaryText: null };
  }
  return { primaryText: candidate.translatedText as string, secondaryText: candidate.originalText };
}
