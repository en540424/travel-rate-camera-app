/**
 * メモ候補をタップしたときに、**実際にメモ本文へ入れる文字列**を決める純粋関数。
 *
 * `memo-candidate-display.ts`（表示の決定）とは意図的に別モジュールにしている。
 * 表示は「2段にするか」を決めるが、こちらは「保存される文字列」を決める。
 * 片方の都合でもう片方が変わってはいけないため、共通化しない。
 *
 * React state・OCR・翻訳サービス・DBには依存しない（nodeで直接検証できるようにするため）。
 */

import type { MemoCandidate } from '@/lib/translation-types';

/**
 * この候補をタップしたときにメモへ挿入する文字列を返す。
 *
 * - 訳文があればそれ（Phase 3Cからの本命動作）
 * - 訳文が無い・空・空白だけなら原文（未翻訳・pending・failed・unavailableはすべてここ）
 *
 * `translationStatus`では分岐しない。失敗を理由に候補操作を止めないため、
 * 「使える訳文があるか」だけで決める。
 *
 * **戻り値はtrim済み。** 呼び出し側はこれをそのまま`addedMemoEntries`のvalueへ入れる。
 * `appendMemoText`もtrimしてから連結するため、メモ本文に現れる部分文字列と
 * Mapのvalueが必ず一致し、`removeMemoText`が確実に対象を消せる。
 *
 * **タップ時点の候補で確定させること。** 後から翻訳が届いて`translatedText`が変わっても、
 * 既にメモへ入れた文字列を作り直してはいけない（削除対象がずれるため）。
 */
export function resolveMemoInsertText(candidate: MemoCandidate): string {
  const translated = candidate.translatedText?.trim();
  if (translated) return translated;
  return candidate.originalText.trim();
}
