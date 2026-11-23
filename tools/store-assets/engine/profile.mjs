// アプリ設定（profile.json）の読み込みと検証。アプリ固有の値はすべて設定側に置き、エンジンには書かない。
// 設定の形はREADME「アプリ設定」を参照。
import fs from 'node:fs';
import path from 'node:path';

import { checkClaims } from './provenance.mjs';
import { TARGETS } from './specs.mjs';
import { AD_LAYOUTS, STORE_LAYOUTS, TONES } from './templates.mjs';
import { INTERACT_COMMANDS } from './drivers/interact.mjs';

const FEATURE_STATUSES = ['released', 'flagged', 'planned'];

function validRect(r) {
  return Array.isArray(r) && r.length === 4 && r.every((v) => typeof v === 'number' && v >= 0 && v <= 1)
    && r[2] > 0 && r[3] > 0 && r[0] + r[2] <= 1 + 1e-9 && r[1] + r[3] <= 1 + 1e-9;
}

/** 画面の操作（interact）の形。操作の道具に渡す命令は許可した名前だけ。 */
export function validateInteract(it) {
  const errors = [];
  if (!it || typeof it !== 'object') return ['interact がオブジェクトでない'];
  if (it.driver !== 'maestro') errors.push('interact.driver は maestro');
  if (!Array.isArray(it.steps) || it.steps.length === 0) errors.push('interact.steps が空');
  for (const [i, st] of (it.steps ?? []).entries()) {
    const keys = st && typeof st === 'object' ? Object.keys(st) : [];
    if (keys.length !== 1 || !INTERACT_COMMANDS.includes(keys[0])) errors.push(`interact.steps[${i}] は ${INTERACT_COMMANDS.join('|')} のどれか1つ`);
  }
  const ex = [...(it.expectVisible ?? []), ...(it.expectNotVisible ?? [])];
  if (!(it.expectVisible ?? []).length) errors.push('interact.expectVisible が空（操作の結果を確かめずに撮らない）');
  if (!ex.every((x) => typeof x === 'string' && x.length > 0)) errors.push('interact.expect* は空でない文字列');
  if (it.timeoutSeconds !== undefined && !(Number.isInteger(it.timeoutSeconds) && it.timeoutSeconds > 0 && it.timeoutSeconds <= 900)) errors.push('interact.timeoutSeconds は1〜900の整数');
  return errors;
}

/** 設定の不備を一覧で返す（空なら合格）。読み込み前の純粋な検証。 */
export function validateProfile(p) {
  const errors = [];
  const need = (cond, msg) => { if (!cond) errors.push(msg); };
  need(p && typeof p === 'object', '設定がオブジェクトでない');
  if (errors.length) return errors;

  need(typeof p.app?.id === 'string' && /^[a-z0-9-]+$/.test(p.app.id), 'app.id は英小文字・数字・ハイフン');
  need(Array.isArray(p.locales) && p.locales.length > 0, 'locales が空');
  need(p.brand && typeof p.brand.primary === 'string', 'brand.primary が無い');

  const features = p.features ?? {};
  for (const [id, f] of Object.entries(features)) {
    need(FEATURE_STATUSES.includes(f?.status), `features.${id}.status は ${FEATURE_STATUSES.join('|')}`);
  }

  const screens = new Map((p.capture?.screens ?? []).map((s) => [s.id, s]));
  need(screens.size > 0, 'capture.screens が空');
  for (const s of screens.values()) {
    need(typeof s.route === 'string' || typeof s.deepLink === 'string', `screen ${s.id}: route か deepLink が必要`);
    if (s.interact !== undefined) for (const e of validateInteract(s.interact)) errors.push(`screen ${s.id}: ${e}`);
  }

  const shotIds = new Set();
  for (const shot of p.shots ?? []) {
    need(!shotIds.has(shot.id), `shot ${shot.id} が重複`);
    shotIds.add(shot.id);
    need(screens.has(shot.screen), `shot ${shot.id}: 未定義の screen ${shot.screen}`);
    for (const e of checkClaims(shot.features, features)) errors.push(`shot ${shot.id}: ${e}`);
    for (const loc of p.locales) {
      need(typeof shot.caption?.[loc]?.title === 'string', `shot ${shot.id}: caption.${loc}.title が無い`);
    }
    if (shot.layout !== undefined) need(STORE_LAYOUTS.includes(shot.layout), `shot ${shot.id}: layout は ${STORE_LAYOUTS.join('|')}`);
    if (shot.tone !== undefined) need(TONES.includes(shot.tone), `shot ${shot.id}: tone は ${TONES.join('|')}`);
    if (shot.callout !== undefined) need(validRect(shot.callout?.rect), `shot ${shot.id}: callout.rect は [x,y,w,h]（0〜1・画面の内側）`);
  }

  for (const ad of p.ads ?? []) {
    for (const e of checkClaims(ad.features, features)) errors.push(`ad ${ad.id}: ${e}`);
    for (const sid of ad.shots ?? []) need(shotIds.has(sid), `ad ${ad.id}: 未定義の shot ${sid}`);
    for (const t of ad.targets ?? []) need(TARGETS[t]?.kind === 'ad', `ad ${ad.id}: ${t} は広告の出力先でない`);
    for (const loc of p.locales) need(typeof ad.headline?.[loc] === 'string', `ad ${ad.id}: headline.${loc} が無い`);
    need(Array.isArray(ad.shots) && ad.shots.length > 0, `ad ${ad.id}: shots（優先順の候補）が空`);
    for (const [t, l] of Object.entries(ad.layout ?? {})) {
      need((ad.targets ?? []).includes(t), `ad ${ad.id}: layout の ${t} は targets に無い`);
      need(AD_LAYOUTS.includes(l), `ad ${ad.id}: layout.${t} は ${AD_LAYOUTS.join('|')}`);
    }
    for (const [t, v] of Object.entries(ad.tone ?? {})) need(TONES.includes(v), `ad ${ad.id}: tone.${t} は ${TONES.join('|')}`);
    // 要点（箇条書き）も文言なので、それぞれ公開済みの機能を根拠に持ち、その根拠は広告の根拠に含まれる
    for (const [i, pt] of (ad.points ?? []).entries()) {
      for (const e of checkClaims(pt.features, features)) errors.push(`ad ${ad.id}: points[${i}]: ${e}`);
      for (const f of pt.features ?? []) need((ad.features ?? []).includes(f), `ad ${ad.id}: points[${i}] の根拠 ${f} が広告の features に無い`);
      for (const loc of p.locales) need(typeof pt.text?.[loc] === 'string', `ad ${ad.id}: points[${i}].text.${loc} が無い`);
    }
  }

  for (const t of p.outputs?.store ?? []) need(TARGETS[t]?.kind === 'store', `outputs.store: ${t} はストアの出力先でない`);
  return errors;
}

/** profile.json を読み、検証して返す。不備があれば例外。相対パスは設定ファイルの場所から解決する。 */
export function loadProfile(file) {
  const abs = path.resolve(file);
  const p = JSON.parse(fs.readFileSync(abs, 'utf8'));
  const errors = validateProfile(p);
  if (errors.length) throw new Error(`設定の不備（${abs}）:\n- ${errors.join('\n- ')}`);
  return { ...p, _dir: path.dirname(abs), _file: abs };
}
