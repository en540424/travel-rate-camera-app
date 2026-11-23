import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { planIosCapture, planToShellScript } from './drivers/ios-simulator.mjs';
import { completenessProblems, jobHtml, pickCapture, planOutputs, validateOutputs, sha256, verifyCaptures } from './pipeline.mjs';
import { decodePng, encodeRgbPng, flattenPng, readPngInfo } from './png.mjs';
import { loadProfile, validateProfile } from './profile.mjs';
import { canUseSource, checkClaims } from './provenance.mjs';
import { checkCount, checkImageAgainstTarget, getTarget, TARGETS } from './specs.mjs';
import { adHtml, escapeHtml, renderEmphasis, storeShotHtml } from './templates.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TABIRATE = path.join(HERE, '..', 'apps', 'tabirate', 'profile.json');

function rgba(width, height, fn) {
  const pixels = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) pixels.set(fn(x, y), (y * width + x) * 4);
  return { width, height, pixels };
}

test('png: RGBのPNGを書いて読むと同じ画素に戻り、アルファチャネルを持たない', () => {
  const img = rgba(7, 5, (x, y) => [x * 30, y * 40, (x + y) * 10, 255]);
  const buf = encodeRgbPng(img);
  const info = readPngInfo(buf);
  assert.equal(info.width, 7);
  assert.equal(info.height, 5);
  assert.equal(info.colorType, 'rgb');
  assert.equal(info.hasAlphaChannel, false);
  assert.deepEqual(decodePng(buf).pixels, img.pixels);
});

test('png: 半透明の画素は背景色へ合成され、flattenはRGBのPNGを返す', () => {
  const img = rgba(2, 1, () => [0, 0, 0, 0]);
  const out = decodePng(encodeRgbPng(img, [10, 20, 30]));
  assert.deepEqual([...out.pixels.subarray(0, 4)], [10, 20, 30, 255]);
  const rgbBuf = encodeRgbPng(rgba(3, 3, () => [1, 2, 3, 255]));
  assert.equal(flattenPng(rgbBuf), rgbBuf, '既にRGBならそのまま');
});

test('png: PNGでないものは拒否する', () => {
  assert.throws(() => readPngInfo(Buffer.from('not a png')), /PNGではありません/);
});

test('specs: 寸法・アルファ・Google Playの縦横比を検出する', () => {
  const t = getTarget('appstore-iphone-6.1');
  assert.deepEqual(checkImageAgainstTarget(t, { width: 1179, height: 2556, hasAlpha: false }), []);
  assert.equal(checkImageAgainstTarget(t, { width: 1179, height: 2556, hasAlpha: true }).length, 1);
  assert.equal(checkImageAgainstTarget(t, { width: 1170, height: 2532, hasAlpha: false }).length, 1);
  const play = { ...getTarget('play-phone'), width: 1000, height: 2400 };
  assert.ok(checkImageAgainstTarget(play, { width: 1000, height: 2400, hasAlpha: false }).some((p) => p.includes('縦横比')));
  assert.throws(() => getTarget('nope'), /未知の出力先/);
});

test('specs: 枚数の範囲（Apple 1〜10・Google 2〜8）', () => {
  assert.deepEqual(checkCount(getTarget('appstore-iphone-6.9'), 10), []);
  assert.equal(checkCount(getTarget('appstore-iphone-6.9'), 11).length, 1);
  assert.equal(checkCount(getTarget('play-phone'), 1).length, 1);
  assert.deepEqual(checkCount(getTarget('sns-square'), 50), []);
});

test('specs: ストア用の出力先はすべて公式の寸法表にある値', () => {
  const apple = new Set(['1320x2868', '1290x2796', '1260x2736', '1284x2778', '1242x2688', '1179x2556', '1206x2622', '2064x2752', '2048x2732']);
  for (const [id, t] of Object.entries(TARGETS)) {
    if (t.store === 'apple') assert.ok(apple.has(`${t.width}x${t.height}`), id);
  }
});

test('provenance: Web版プレビューはfinalのストア・広告に使えず、draftでは透かし付きで使える', () => {
  assert.equal(canUseSource('web-preview', 'store', 'final').ok, false);
  assert.equal(canUseSource('web-preview', 'ad', 'final').ok, false);
  assert.deepEqual(canUseSource('web-preview', 'store', 'draft'), { ok: true, watermark: true });
  assert.deepEqual(canUseSource('ios-simulator', 'store', 'final'), { ok: true, watermark: false });
  assert.deepEqual(canUseSource('device', 'store', 'draft'), { ok: true, watermark: false });
  assert.equal(canUseSource('photoshop', 'store', 'draft').ok, false);
});

test('provenance: 文言は公開済みの機能だけを根拠にできる', () => {
  const features = { a: { status: 'released' }, b: { status: 'flagged' }, c: { status: 'planned' } };
  assert.deepEqual(checkClaims(['a'], features), []);
  assert.equal(checkClaims(['a', 'b'], features).length, 1);
  assert.equal(checkClaims(['c'], features).length, 1);
  assert.equal(checkClaims(['zzz'], features).length, 1);
  assert.equal(checkClaims([], features).length, 1, '根拠の無い文言は不可');
});

test('profile: 旅レートカメラの設定は検証を通り、Pro+（未公開）を文言に使っていない', () => {
  const p = loadProfile(TABIRATE);
  const planned = Object.entries(p.features).filter(([, f]) => f.status !== 'released').map(([id]) => id);
  assert.ok(planned.includes('proplus-map'));
  for (const s of [...p.shots, ...p.ads]) for (const f of s.features) assert.ok(!planned.includes(f), `${s.id} が ${f} を使用`);
});

test('profile: 未公開機能を根拠にした文言・未定義の画面・出力先の取り違えを拒否する', () => {
  const p = JSON.parse(fs.readFileSync(TABIRATE, 'utf8'));
  const bad = structuredClone(p);
  bad.shots[0].features = ['proplus-map'];
  assert.ok(validateProfile(bad).some((e) => e.includes('公開されていない機能')));
  const bad2 = structuredClone(p);
  bad2.shots[0].screen = 'nowhere';
  assert.ok(validateProfile(bad2).some((e) => e.includes('未定義の screen')));
  const bad3 = structuredClone(p);
  bad3.outputs.store = ['sns-square'];
  assert.ok(validateProfile(bad3).some((e) => e.includes('ストアの出力先でない')));
  const bad4 = structuredClone(p);
  bad4.ads[0].headline = {};
  assert.ok(validateProfile(bad4).some((e) => e.includes('headline.ja')));
});

test('pipeline: 実機に近い撮影元を優先し、finalではWeb版プレビューから作らず理由を残す', () => {
  const p = loadProfile(TABIRATE);
  const caps = [
    { screen: 'history', locale: 'ja', source: 'web-preview', file: 'w.png' },
    { screen: 'history', locale: 'ja', source: 'ios-simulator', file: 'i.png' },
    { screen: 'calendar', locale: 'ja', source: 'web-preview', file: 'c.png' },
  ];
  assert.equal(pickCapture(caps, 'history', 'ja').source, 'ios-simulator');
  const final = planOutputs(p, caps, { mode: 'final' });
  assert.ok(final.jobs.every((j) => j.captures.every((c) => c.source !== 'web-preview')));
  assert.ok(final.jobs.some((j) => j.shot === '02-history'));
  assert.ok(final.skipped.some((s) => s.shot === '03-calendar' && s.reason.includes('Web版')));
  assert.ok(final.skipped.some((s) => s.shot === '01-camera' && s.reason.includes('撮影が無い')));
  const draft = planOutputs(p, caps, { mode: 'draft' });
  const cal = draft.jobs.find((j) => j.shot === '03-calendar');
  assert.ok(cal.watermark, 'draftのWeb版は透かし付き');
  assert.equal(draft.jobs.find((j) => j.shot === '02-history').watermark, null, 'iOS撮影は透かし無し');
});

test('pipeline: 合成のHTMLには profile の言語（localeTags）が入る（無いと文節での改行が黙って効かない）', () => {
  const p = loadProfile(TABIRATE);
  const caps = [{ screen: 'history', locale: 'ja', source: 'ios-simulator', file: 'i.png' }, { screen: 'calendar', locale: 'ja', source: 'ios-simulator', file: 'c.png' }];
  const plan = planOutputs(p, caps, { mode: 'draft' });
  const store = plan.jobs.find((j) => j.kind === 'store');
  const ad = plan.jobs.find((j) => j.kind === 'ad');
  assert.ok(store && ad, '店頭用と広告用の両方を確かめる');
  for (const job of [store, ad]) {
    const html = jobHtml(p, job, ['data:,', 'data:,'], 2.17);
    assert.ok(html.includes(`<html lang="${p.localeTags.ja}">`), `${job.kind}：${html.slice(0, 60)}`);
    assert.ok(html.includes('word-break:auto-phrase'));
  }
});

test('pipeline: 検証は改変・寸法違い・finalの透かしを検出する', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'store-assets-'));
  const png = encodeRgbPng(rgba(1179, 2556, () => [255, 255, 255, 255]));
  fs.mkdirSync(path.join(dir, 'store'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'store', 'a.png'), png);
  const base = { file: 'store/a.png', kind: 'store', target: 'appstore-iphone-6.1', locale: 'ja', mode: 'final', watermarked: false, sources: [{ source: 'ios-simulator' }], sha256: sha256(png) };
  assert.equal(validateOutputs(dir, [base]).ok, true);
  assert.equal(validateOutputs(dir, [{ ...base, watermarked: true }]).ok, false);
  assert.equal(validateOutputs(dir, [{ ...base, sources: [{ source: 'web-preview' }] }]).ok, false);
  assert.equal(validateOutputs(dir, [{ ...base, sha256: 'x' }]).ok, false);
  assert.equal(validateOutputs(dir, [{ ...base, target: 'appstore-iphone-6.9' }]).ok, false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('ios: 撮影手順は画面ごとに開いて撮り、テストデータは既存DBを退避してから入れる', () => {
  const steps = planIosCapture({
    device: "iPhone 17 Pro's", bundleId: 'com.example.app', locale: 'ja-JP', outDir: './captures/x',
    screens: [{ id: 'history', deepLink: 'app:///history' }, { id: 'nolink' }],
    fixtureDb: '/tmp/fixture.db', dbRelPath: 'Documents/SQLite/app.db',
  });
  const cmds = steps.map((s) => s.cmd).join('\n');
  assert.ok(cmds.includes(`'iPhone 17 Pro'\\''s'`), 'デバイス名のクォート');
  assert.ok(cmds.includes("openurl 'iPhone 17 Pro'\\''s' 'app:///history'"));
  assert.ok(cmds.includes("screenshot --type=png './captures/x/history.png'"));
  assert.ok(!cmds.includes('nolink'));
  const seedIdx = steps.findIndex((s) => s.cmd.includes('get_app_container'));
  const launchIdx = steps.findIndex((s) => s.cmd.startsWith('ios_launch'));
  const terminateIdx = steps.findIndex((s) => s.cmd.startsWith('xcrun simctl terminate'));
  assert.ok(terminateIdx < seedIdx && seedIdx < launchIdx, 'アプリを止めてからDBを入れ、その後に起動');
  assert.ok(steps.some((s) => s.cmd.includes('.bak-')), '既存DBの退避');
  assert.ok(steps.every((s) => !s.cmd.includes(' && ')), '失敗を set -e で止められるよう1行ずつ');
  assert.ok(planToShellScript(steps).startsWith('#!/bin/bash'));
});

test('templates: 文言はエスケープされ、［］だけが強調になる', () => {
  assert.equal(escapeHtml('<b>&"'), '&lt;b&gt;&amp;&quot;');
  assert.equal(renderEmphasis('円が［わかる］<x>\n次'), '円が<em>わかる</em>&lt;x&gt;<br>次');
});

test('templates: 見出し・補足は言語を指定し、文節で改行して行の長さをそろえる（語の途中・助詞1文字の行で折らない）', () => {
  const brand = { primary: '#0E9488' };
  const store = storeShotHtml({ width: 1320, height: 2868, brand, title: 'a', sub: 'b', imageDataUrl: 'data:,', lang: 'ja-JP' });
  const ad = adHtml({ width: 1080, height: 1080, brand, headline: 'a', sub: 'b', images: ['data:,'], appName: 'x', lang: 'ja-JP' });
  for (const html of [store, ad]) {
    assert.ok(html.includes('<html lang="ja-JP">'), 'auto-phrase は言語の指定が要る');
    assert.equal((html.match(/word-break:auto-phrase;line-break:strict;text-wrap:balance/g) ?? []).length, 2, '見出しと補足の両方');
  }
  assert.ok(storeShotHtml({ width: 10, height: 10, brand, title: 'a', imageDataUrl: 'data:' }).startsWith('<!doctype html><html><head>'), '言語が無ければ属性を付けない');
  assert.ok(adHtml({ width: 10, height: 10, brand, headline: 'a', images: [], lang: '"><x>' }).includes('lang="&quot;&gt;&lt;x&gt;"'), '属性はエスケープする');
});

test('pipeline: finalは作れなかったストア用の画像と、出力0枚の出力先を問題にする（draftでは問わない）', () => {
  const skipped = [{ target: 'appstore-iphone-6.1', locale: 'ja', shot: '01-camera', reason: '撮影が無い' }];
  assert.deepEqual(completenessProblems('draft', ['appstore-iphone-6.1'], skipped, []), []);
  const p = completenessProblems('final', ['appstore-iphone-6.1', 'appstore-iphone-6.9'], skipped, [{ kind: 'store', target: 'appstore-iphone-6.1' }]);
  assert.equal(p.length, 2);
  assert.ok(p.some((x) => x.includes('01-camera')));
  assert.ok(p.some((x) => x.includes('appstore-iphone-6.9 の出力が1枚も無い')));
});

test('pipeline: 撮影後に差し替えられた画像・無い画像は使わない', () => {
  const files = { a: Buffer.from('A'), b: Buffer.from('B') };
  const read = (f) => { if (!files[f]) throw new Error('none'); return files[f]; };
  const r = verifyCaptures([
    { screen: 's1', locale: 'ja', source: 'device', file: 'a', sha256: sha256(Buffer.from('A')) },
    { screen: 's2', locale: 'ja', source: 'device', file: 'b', sha256: sha256(Buffer.from('original')) },
    { screen: 's3', locale: 'ja', source: 'device', file: 'zzz', sha256: 'x' },
  ], read);
  assert.deepEqual(r.ok.map((c) => c.screen), ['s1']);
  assert.deepEqual(r.rejected.map((c) => c.screen), ['s2', 's3']);
});
