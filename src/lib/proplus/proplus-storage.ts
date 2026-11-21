/**
 * Pro+のデータ（場所・紐付け・予定）の保存。既存DB（travelrate.db）とは別のJSONファイルに置く。
 * 理由と移行の方針は `proplus-store-core.ts` 冒頭（DB v8はHuman承認H-P5の後）。
 *
 * データ保護：
 * - iOSの `moveAsync` は「移動先を消してから移動」するため、置き換えの途中で落ちると本体が消え得る。
 *   そのため3つのファイルを使い、どの時点で落ちても少なくとも1つに直前の内容が残るようにする：
 *     1. 新しい内容を `.tmp` に書く  2. 本体を `.bak` へ移す  3. `.tmp` を本体へ移す
 *   読み込みは 本体 → `.tmp` → `.bak` の順で、最初に読めたものを使う（本体が無い場合だけ次を見る）
 * - 本体が壊れている・新しい版なら**上書きしない**（`blocked`）。自動で古い控えへ戻さない（新しい内容を失わないため）
 * - 削除系の関数は持たない（論理削除はstore-core側）
 */
import * as FileSystem from 'expo-file-system/legacy';

import { EMPTY_PROPLUS_STATE, parseProPlusState, type ProPlusState } from './proplus-store-core';

const DIR = `${FileSystem.documentDirectory ?? ''}proplus/`;
const FILE = `${DIR}proplus-v1.json`;
const TMP = `${DIR}proplus-v1.json.tmp`;
const BAK = `${DIR}proplus-v1.json.bak`;

export type LoadResult =
  | { status: 'ok'; state: ProPlusState; recoveredFrom?: 'tmp' | 'bak' }
  | { status: 'empty'; state: ProPlusState }
  | { status: 'blocked'; reason: 'newer_version' | 'invalid' | 'read_error'; state: ProPlusState };

type ReadOne = { kind: 'missing' } | { kind: 'ok'; state: ProPlusState } | { kind: 'bad'; reason: 'newer_version' | 'invalid' };

async function readOne(uri: string): Promise<ReadOne> {
  const info = await FileSystem.getInfoAsync(uri);
  if (!info.exists) return { kind: 'missing' };
  const text = await FileSystem.readAsStringAsync(uri);
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { kind: 'bad', reason: 'invalid' };
  }
  const parsed = parseProPlusState(raw);
  return parsed.ok ? { kind: 'ok', state: parsed.state } : { kind: 'bad', reason: parsed.reason };
}

export async function loadProPlusState(): Promise<LoadResult> {
  try {
    const main = await readOne(FILE);
    if (main.kind === 'ok') return { status: 'ok', state: main.state };
    if (main.kind === 'bad') return { status: 'blocked', reason: main.reason, state: EMPTY_PROPLUS_STATE };
    // 本体が無い：置き換えの途中で落ちた可能性。.tmp（新しい方）→ .bak（直前）の順に読む
    for (const [uri, from] of [[TMP, 'tmp'], [BAK, 'bak']] as const) {
      const r = await readOne(uri);
      if (r.kind === 'ok') return { status: 'ok', state: r.state, recoveredFrom: from };
      if (r.kind === 'bad' && r.reason === 'newer_version') return { status: 'blocked', reason: r.reason, state: EMPTY_PROPLUS_STATE };
    }
    return { status: 'empty', state: EMPTY_PROPLUS_STATE };
  } catch {
    return { status: 'blocked', reason: 'read_error', state: EMPTY_PROPLUS_STATE };
  }
}

/** 保存する。呼び出しは1本ずつに揃えること（`proplus-store.ts` が順番に流す）。 */
export async function saveProPlusState(state: ProPlusState): Promise<void> {
  if (!FileSystem.documentDirectory) throw new Error('documentDirectory unavailable');
  const dir = await FileSystem.getInfoAsync(DIR);
  if (!dir.exists) await FileSystem.makeDirectoryAsync(DIR, { intermediates: true });
  await FileSystem.writeAsStringAsync(TMP, JSON.stringify(state));
  if ((await FileSystem.getInfoAsync(FILE)).exists) {
    await FileSystem.moveAsync({ from: FILE, to: BAK });
  }
  await FileSystem.moveAsync({ from: TMP, to: FILE });
}
