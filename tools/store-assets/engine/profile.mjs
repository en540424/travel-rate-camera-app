// アプリ設定（profile.json）の読み込みと検証。アプリ固有の値はすべて設定側に置き、エンジンには書かない。
// 設定の形はREADME「アプリ設定」を参照。
import fs from 'node:fs';
import path from 'node:path';

import { checkClaims } from './provenance.mjs';
import { TARGETS } from './specs.mjs';

const FEATURE_STATUSES = ['released', 'flagged', 'planned'];

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
  }

  for (const ad of p.ads ?? []) {
    for (const e of checkClaims(ad.features, features)) errors.push(`ad ${ad.id}: ${e}`);
    for (const sid of ad.shots ?? []) need(shotIds.has(sid), `ad ${ad.id}: 未定義の shot ${sid}`);
    for (const t of ad.targets ?? []) need(TARGETS[t]?.kind === 'ad', `ad ${ad.id}: ${t} は広告の出力先でない`);
    for (const loc of p.locales) need(typeof ad.headline?.[loc] === 'string', `ad ${ad.id}: headline.${loc} が無い`);
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
