/**
 * Free・Proの境界（`config/limits.ts`の各ゲート）の検証。数値（FREE_LIMITS）と判定は変えず、現行の挙動を固定する。
 * 正本：AI_CONTEXT.md（saves＝1旅行につき10件・trips＝記録中の旅行1件・終了した旅行は無料版で再開不可・閲覧のみの範囲）。
 * production相当（__DEV__=false）で読み込む（DEV_BYPASS_FREE_LIMITSが効かない状態）。
 */
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { test } from 'node:test';

globalThis.__DEV__ = false;
register('../lib/proplus/ts-resolve-hook.mjs', import.meta.url);
const L = await import('./limits.ts');
const { hasProAccess } = await import('../lib/plan-tier-core.ts');

test('FREE_LIMITSの値（1旅行10件・記録中の旅行1件）', () => {
  assert.deepEqual({ ...L.FREE_LIMITS }, { trips: 1, saves: 10 });
});

test('保存：無料版は1旅行につき9件目まで保存でき、10件で止まる。Proは無制限', () => {
  assert.equal(L.canSaveEntry(false, 9), true);
  assert.equal(L.canSaveEntry(false, 10), false);
  assert.equal(L.canSaveEntry(false, 11), false, '上限を超えた既存データがあっても追加はできない');
  assert.equal(L.canSaveEntry(true, 10_000), true);
});

test('旅行：無料版は記録中の旅行が0件なら作成でき、1件あれば作成できない。Proは何件でも', () => {
  assert.equal(L.canCreateTrip(false, 0), true);
  assert.equal(L.canCreateTrip(false, 1), false);
  assert.equal(L.canCreateTrip(true, 5), true);
});

test('終了した旅行の再開：無料版は不可（記録中が0件でも）、Proは可', () => {
  assert.equal(L.canRestoreTrip(false), false);
  assert.equal(L.canRestoreTrip(true), true);
});

test('切替と閲覧のみ：無料版は記録対象以外へ切り替えられず、記録対象以外は閲覧のみ。Proは制限なし', () => {
  assert.equal(L.canSwitchTrip(false, 2, 1), false);
  assert.equal(L.canSwitchTrip(true, 2, 1), true);
  assert.equal(L.isTripReadOnly(false, 1, 1), false, '記録対象は編集できる');
  assert.equal(L.isTripReadOnly(false, 2, 1), true);
  assert.equal(L.isTripReadOnly(true, 2, 1), false);
});

test('Pro+はProを包含する：pro_plusでもisPro（=hasProAccess）が真になり、保存・旅行の制限が外れる', () => {
  for (const tier of ['pro', 'pro_plus']) {
    const isPro = hasProAccess(tier);
    assert.equal(isPro, true, tier);
    assert.equal(L.canSaveEntry(isPro, 10), true);
    assert.equal(L.canCreateTrip(isPro, 3), true);
    assert.equal(L.canRestoreTrip(isPro), true);
  }
  assert.equal(hasProAccess('free'), false);
});
