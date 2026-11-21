/**
 * Pro+のデータ（場所・紐付け・予定）の保存。既存DB（travelrate.db）とは別のJSONファイルに置く。
 * 理由と移行の方針は `proplus-store-core.ts` 冒頭（DB v8はHuman承認H-P5の後）。
 *
 * データ保護：
 * - 書き込みは一時ファイル→置き換えの順（途中で落ちても前の内容が残る）
 * - 読み込めないファイル（壊れた・新しい版）は**上書きしない**。`blocked` を返し、書き込みを止める
 * - 削除系の関数は持たない（論理削除はstore-core側）
 */
import * as FileSystem from 'expo-file-system/legacy';

import { EMPTY_PROPLUS_STATE, parseProPlusState, type ProPlusState } from './proplus-store-core';

const DIR = `${FileSystem.documentDirectory ?? ''}proplus/`;
const FILE = `${DIR}proplus-v1.json`;
const TMP = `${DIR}proplus-v1.json.tmp`;

export type LoadResult =
  | { status: 'ok'; state: ProPlusState }
  | { status: 'empty'; state: ProPlusState }
  | { status: 'blocked'; reason: 'newer_version' | 'invalid' | 'read_error'; state: ProPlusState };

export async function loadProPlusState(): Promise<LoadResult> {
  try {
    const info = await FileSystem.getInfoAsync(FILE);
    if (!info.exists) return { status: 'empty', state: EMPTY_PROPLUS_STATE };
    const text = await FileSystem.readAsStringAsync(FILE);
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      return { status: 'blocked', reason: 'invalid', state: EMPTY_PROPLUS_STATE };
    }
    const parsed = parseProPlusState(raw);
    if (!parsed.ok) return { status: 'blocked', reason: parsed.reason, state: EMPTY_PROPLUS_STATE };
    return { status: 'ok', state: parsed.state };
  } catch {
    return { status: 'blocked', reason: 'read_error', state: EMPTY_PROPLUS_STATE };
  }
}

export async function saveProPlusState(state: ProPlusState): Promise<void> {
  if (!FileSystem.documentDirectory) throw new Error('documentDirectory unavailable');
  const dir = await FileSystem.getInfoAsync(DIR);
  if (!dir.exists) await FileSystem.makeDirectoryAsync(DIR, { intermediates: true });
  await FileSystem.writeAsStringAsync(TMP, JSON.stringify(state));
  await FileSystem.moveAsync({ from: TMP, to: FILE });
}
