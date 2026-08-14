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
 * `appendMemoText`の結果。
 *
 * 追加できなかった場合に**理由を返す**のは、呼び出し側が
 * 「上限で追加しなかった」ときだけユーザーへ案内を出すため。
 * `ok: false`のときは呼び出し側は**メモ本文も追加済みMapも更新してはいけない**。
 */
export type AppendMemoTextResult =
  | { ok: true; memo: string }
  | { ok: false; reason: 'empty' | 'too_long' };

/**
 * メモ本文へ候補テキストを追加した結果を返す。
 *
 * **Phase 3C正式仕様：上限を超えるなら追加しない（途中で切らない）。**
 * 以前は`slice(maxLength)`で文字列の途中を切り捨てていたため、実際にメモへ入った文字列が
 * `insertText`と一致せず`removeMemoText`で消せなくなることがあった。
 * 「入るなら丸ごと入れる／入らないなら何もしない」に統一し、この不一致を構造的に無くしている
 * （＝`ok: true`のとき、返したメモには必ず`insertText.trim()`がそのまま含まれる）。
 */
export function appendMemoText(
  memo: string,
  insertText: string,
  maxLength: number = MEMO_MAX_LENGTH,
): AppendMemoTextResult {
  const trimmed = insertText.trim();
  if (!trimmed) return { ok: false, reason: 'empty' };

  // 既存本文側もtrimする（末尾スペースをそのまま残さない現行挙動）
  const current = memo.trim();
  const next = current ? `${current}${MEMO_SEPARATOR}${trimmed}` : trimmed;
  if (next.length > maxLength) return { ok: false, reason: 'too_long' };
  return { ok: true, memo: next };
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
