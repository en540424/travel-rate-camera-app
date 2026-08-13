/**
 * 保存用メモ本文（`conversion_history.memo`へ入る単一文字列）に対する、
 * 候補テキストの追加・削除だけを担当する純粋関数。
 *
 * React state・OCR・翻訳・DBには一切依存しない（nodeで直接検証できるようにするため）。
 *
 * **現行`handleToggleMemoLine`の挙動をそのまま移したもので、仕様は変えていない。**
 * 区切りは半角スペース1つ、追加時は既存本文と候補の両方をtrimしてから連結する。
 */

/** メモ候補を連結するときの区切り（現行実装どおり半角スペース1つ） */
const MEMO_SEPARATOR = ' ';

/** 保存用メモの上限。TextInputの`maxLength`と一致させること */
export const MEMO_MAX_LENGTH = 100;

/**
 * メモ本文へ候補テキストを追加した結果を返す。
 *
 * 現行挙動をそのまま維持している点（Phase 3Cで見直す予定）:
 * - 上限を超える分は**文字列の途中で切り捨てる**。そのため実際に入った文字列が
 *   `insertText`と一致しないことがあり、その場合は`removeMemoText`で消せなくなる。
 *   Phase 3Cで「入りきらないなら追加しない」へ変更し、この不一致を構造的に無くす。
 */
export function appendMemoText(
  memo: string,
  insertText: string,
  maxLength: number = MEMO_MAX_LENGTH,
): string {
  const trimmed = insertText.trim();
  if (!trimmed) return memo;

  // 既存本文側もtrimする（末尾スペースをそのまま残さない現行挙動）
  const current = memo.trim();
  if (!current) return trimmed.slice(0, maxLength);
  return `${current}${MEMO_SEPARATOR}${trimmed}`.slice(0, maxLength);
}

/**
 * メモ本文から、追加時に実際に挿入した文字列だけを取り除いた結果を返す。
 *
 * 探すのは「呼び出し側が記録しておいた挿入文字列」であり、候補の原文でも訳文でもない。
 * 先頭・中間・末尾・単独のいずれの位置でも、区切りのスペースを二重に残さず取り除く。
 *
 * ユーザーが手入力でメモを書き換えて一致箇所が見つからない場合は、
 * **本文を変えずにそのまま返す**（現行どおり。呼び出し側はチェックだけ外す）。
 */
export function removeMemoText(memo: string, insertedText: string): string {
  const trimmed = insertedText.trim();
  if (!trimmed) return memo;

  if (memo === trimmed) return '';
  if (memo.startsWith(`${trimmed}${MEMO_SEPARATOR}`)) {
    return memo.slice(trimmed.length + MEMO_SEPARATOR.length);
  }
  if (memo.endsWith(`${MEMO_SEPARATOR}${trimmed}`)) {
    return memo.slice(0, memo.length - trimmed.length - MEMO_SEPARATOR.length);
  }

  const middle = `${MEMO_SEPARATOR}${trimmed}${MEMO_SEPARATOR}`;
  const index = memo.indexOf(middle);
  if (index === -1) return memo;
  // 前後の区切りを1つに詰める（" A B C " → " A C "にならないよう1つ残す）
  return memo.slice(0, index) + MEMO_SEPARATOR + memo.slice(index + middle.length);
}
