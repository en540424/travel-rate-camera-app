import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { parseSkipped, planIosCapture, planToRunScript, planToShellScript } from './drivers/ios-simulator.mjs';
import { compareHtml, completenessProblems, galleryHtml, jobHtml, pickCapture, planOutputs, storeSetProblems, storeSetsFor, validateOutputs, sha256, verifyCaptures } from './pipeline.mjs';
import { decodePng, encodeRgbPng, flattenPng, readPngInfo } from './png.mjs';
import { loadProfile, validateProfile } from './profile.mjs';
import { canUseSource, checkClaims } from './provenance.mjs';
import { checkCount, checkImageAgainstTarget, getTarget, TARGETS } from './specs.mjs';
import { adHtml, AD_LAYOUTS, defaultAdLayout, escapeHtml, fitPhoneW, renderEmphasis, storeShotHtml, TONES } from './templates.mjs';
import { interactHash, maestroFlow, regexLiteral } from './drivers/interact.mjs';

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
  assert.ok(final.jobs.some((j) => j.shot === '03-records'));
  assert.ok(final.skipped.some((s) => s.shot === '05-calendar' && s.reason.includes('Web版')));
  assert.ok(final.skipped.some((s) => s.shot === '01-camera' && s.reason.includes('撮影が無い')));
  const draft = planOutputs(p, caps, { mode: 'draft' });
  const cal = draft.jobs.find((j) => j.shot === '05-calendar');
  assert.ok(cal.watermark, 'draftのWeb版は透かし付き');
  assert.equal(draft.jobs.find((j) => j.shot === '03-records').watermark, null, 'iOS撮影は透かし無し');
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

test('templates: 用途ごとの配置（LP・横長・正方形・縦長）を形から選び、色調は3種。広告の配置は profile で上書きできる', () => {
  assert.equal(defaultAdLayout(1920, 1080), 'split');
  assert.equal(defaultAdLayout(1200, 628), 'banner');
  assert.equal(defaultAdLayout(1080, 1080), 'square');
  assert.equal(defaultAdLayout(1080, 1920), 'story');
  const brand = { primary: '#0E9488', primaryDark: '#0A766E' };
  for (const layout of AD_LAYOUTS) for (const tone of TONES) {
    const html = adHtml({ width: 1080, height: 1080, brand, headline: 'a', sub: 'b', images: ['data:,', 'data:,'], appName: 'アプリ', lang: 'ja-JP', layout, tone, points: ['p1'] });
    assert.equal((html.match(/>アプリ</g) ?? []).length, 1, `${layout}/${tone}：アプリ名は1回だけ（SNSで重複していた）`);
  }
  assert.throws(() => adHtml({ width: 10, height: 10, brand, headline: 'a', images: [], layout: 'nope' }), /未知の広告の配置/);
});

test('templates: callout は実画面の一部を等倍を超えて拡大しない', () => {
  const brand = { primary: '#0E9488' };
  // 撮影 1320px 幅のうち 0.5（660px）を切り出す。端末の幅×1.08 は約 1197px だが、等倍の 660px に止める
  const html = storeShotHtml({ width: 1320, height: 2868, brand, title: 'a', imageDataUrl: 'data:,', imageWidth: 1320, imageAspect: 2.1727, callout: { rect: [0.25, 0.5, 0.5, 0.1] } });
  const m = html.match(/class="callout" style="left:[\d.]+px;top:[-\d.]+px;width:([\d.]+)px/);
  assert.ok(m, 'callout がある');
  assert.ok(Number(m[1]) <= 660 + 1e-6, `幅 ${m[1]}`);
  assert.ok(html.includes('background-size:1320px auto'), '縮尺 1（等倍）');
});

test('templates: 補足文も［］の強調と改行を使え、エスケープされる', () => {
  const html = storeShotHtml({ width: 100, height: 200, brand: { primary: '#000' }, title: 't', sub: '前<b>\n［後］', imageDataUrl: 'data:,' });
  assert.ok(html.includes('<p class="sub">前&lt;b&gt;<br><em>後</em></p>'));
});

test('pipeline: 広告の画面は優先順の候補から、撮影のあるものを使う（無い候補は飛ばし、1台も無ければ作らない）', () => {
  const p = loadProfile(TABIRATE);
  const caps = [{ screen: 'history', locale: 'ja', source: 'ios-simulator', file: 'h.png' }, { screen: 'calendar', locale: 'ja', source: 'ios-simulator', file: 'c.png' }];
  const plan = planOutputs(p, caps, { mode: 'draft' });
  const hero = plan.jobs.find((j) => j.ad === 'lp-hero');
  assert.deepEqual(hero.captures.map((c) => c.screen), ['history', 'calendar'], '換算の撮影が無いので記録とカレンダー');
  assert.equal(hero.layout, 'split');
  assert.equal(plan.jobs.find((j) => j.ad === 'banner').captures.length, 1, '横長は1台');
  assert.ok(plan.skipped.some((s) => s.ad === 'plan-pro' && s.reason.includes('pro-features')), 'Pro の撮影が無ければ作らない');
  const withConv = planOutputs(p, [...caps, { screen: 'converter', locale: 'ja', source: 'ios-simulator', file: 'v.png', interacted: true, interactHash: interactHash(p.capture.screens.find((x) => x.id === 'converter').interact) }], { mode: 'draft' });
  assert.deepEqual(withConv.jobs.find((j) => j.ad === 'lp-hero').captures.map((c) => c.screen), ['converter', 'history'], 'カメラの撮影が無いので換算から');
});

test('pipeline: 操作が要る画面（換算）は、操作と表示の確認が通った撮影だけを使う（金額 0 のままの撮影を使わない）', () => {
  const p = loadProfile(TABIRATE);
  const before = [{ screen: 'converter', locale: 'ja', source: 'ios-simulator', file: 'v.png' }, { screen: 'history', locale: 'ja', source: 'ios-simulator', file: 'h.png' }];
  const plan = planOutputs(p, before, { mode: 'draft' });
  assert.ok(!plan.jobs.some((j) => j.captures.some((c) => c.screen === 'converter')), '操作の前の撮影は店頭用にも広告にも使わない');
  assert.ok(plan.skipped.some((s) => s.shot === '02-converter' && s.reason.includes('操作の後の撮影が無い')));
  assert.deepEqual(plan.jobs.find((j) => j.ad === 'lp-hero').captures.map((c) => c.screen), ['history']);
  const after = planOutputs(p, [{ ...before[0], interacted: true, interactHash: interactHash(p.capture.screens.find((x) => x.id === 'converter').interact) }, before[1]], { mode: 'draft' });
  assert.ok(after.jobs.some((j) => j.shot === '02-converter'));
  assert.equal(pickCapture(before, 'history', 'ja', { id: 'history' }).file, 'h.png', '操作の無い画面は今までどおり');
});

test('profile: 要点・配置・色調・callout・画面の操作を検査する', () => {
  const p = JSON.parse(fs.readFileSync(TABIRATE, 'utf8'));
  const bad = structuredClone(p);
  bad.ads[0].points[0].features = ['proplus-ai-translation'];
  assert.ok(validateProfile(bad).some((e) => e.includes('points[0]') && e.includes('公開されていない機能')));
  const bad2 = structuredClone(p);
  bad2.ads[0].points[0].features = ['budget'];
  assert.ok(validateProfile(bad2).some((e) => e.includes('広告の features に無い')));
  const bad3 = structuredClone(p);
  bad3.shots[1].callout = { rect: [0.5, 0.5, 0.6, 0.1] };
  assert.ok(validateProfile(bad3).some((e) => e.includes('callout.rect')));
  const bad4 = structuredClone(p);
  bad4.shots[0].tone = 'neon';
  bad4.ads[0].layout = { 'lp-hero': 'zigzag' };
  const e4 = validateProfile(bad4);
  assert.ok(e4.some((e) => e.includes('tone')) && e4.some((e) => e.includes('layout.lp-hero')));
  const bad5 = structuredClone(p);
  const conv = bad5.capture.screens.find((s) => s.id === 'converter');
  conv.interact.steps.push({ launchApp: {} });
  delete conv.interact.expectVisible;
  const e5 = validateProfile(bad5);
  assert.ok(e5.some((e) => e.includes('steps[4]')), '許可していない命令（launchApp 等）は使えない');
  assert.ok(e5.some((e) => e.includes('expectVisible')), '結果を確かめずに撮らない');
});

test('interact: Maestro のフローは許可した命令だけで、文言は正規表現の記号を逃がして照合する', () => {
  const flow = maestroFlow({ bundleId: 'com.a.b', interact: { steps: [{ tapOn: { id: 'x' } }, { inputText: '89' }, { tapOn: '1.5 (a)' }, { hideKeyboard: true }], expectVisible: ['¥14,685'], expectNotVisible: ['$1.00'] } });
  const lines = flow.trimEnd().split('\n');
  assert.deepEqual(lines.slice(0, 4), ['appId: com.a.b', '---', '- tapOn: {"id":"x"}', '- inputText: "89"']);
  assert.equal(JSON.parse(lines[4].replace('- tapOn: ', '')), '1\\.5 \\(a\\)');
  assert.equal(lines[5], '- hideKeyboard');
  assert.equal(lines[6], '- assertVisible: "¥14,685"');
  assert.equal(JSON.parse(lines[7].replace('- assertNotVisible: ', '')), '\\$1\\.00');
  assert.equal(regexLiteral('a.b'), 'a\\.b');
  assert.throws(() => maestroFlow({ bundleId: 'com.a.b', interact: { steps: [{ launchApp: {} }] } }), /使えない操作/);
  assert.throws(() => maestroFlow({ bundleId: 'x;rm', interact: { steps: [] } }), /bundleId/);
});

test('ios: 操作が要る画面は最後に撮り、失敗はその画面だけ飛ばして理由を残す（致命にしない）', () => {
  const steps = planIosCapture({
    device: 'D', bundleId: 'com.a.b', outDir: './o',
    screens: [
      { id: 'converter', deepLink: 'a:///converter', interact: { driver: 'maestro', steps: [{ inputText: '89' }], expectVisible: ['¥1'] } },
      { id: 'history', deepLink: 'a:///history' },
    ],
  });
  const cmds = steps.map((s) => s.cmd);
  const hist = cmds.findIndex((c) => c.includes("screenshot --type=png './o/history.png'"));
  const conv = cmds.findIndex((c) => c.includes("screenshot --type=png './o/converter.png'"));
  assert.ok(hist > 0 && conv > hist, '操作が要る画面は後');
  const block = cmds[conv];
  assert.ok(!block.includes('ios_fail'), '操作の画面の失敗は致命にしない');
  for (const k of ['ios_maestro_ready', 'ios_interact', 'ios_verify_shot_soft', 'ios_skip']) assert.ok(block.includes(k), k);
  assert.ok(cmds.some((c) => c.includes("<<'STORE_ASSETS_FLOW_EOF'") && c.includes('- assertVisible: "¥1"')), 'フローを引用付きのヒアドキュメントで書く');
  assert.equal(cmds.filter((c) => c.includes('flow-warmup.yaml" <<')).length, 1, '準備のフローは1回');
  assert.ok(planToRunScript(steps).includes('IOS_SKIP_FILE'));
  assert.deepEqual(parseSkipped('converter\t操作・表示の確認が通らない\n\nbad line\n'), [{ screen: 'converter', reason: '操作・表示の確認が通らない' }]);
});

test('independent-review: 操作の設定の指紋が違う撮影は使わない（金額・確かめる表示を変えたら撮り直す）', () => {
  const p = loadProfile(TABIRATE);
  const spec = p.capture.screens.find((s) => s.id === 'converter').interact;
  const ok = { screen: 'converter', locale: 'ja', source: 'ios-simulator', file: 'v.png', interacted: true, interactHash: interactHash(spec), device: 'iPhone 17 Pro Max' };
  assert.ok(planOutputs(p, [ok], { mode: 'draft' }).jobs.some((j) => j.shot === '02-converter'));
  const old = { ...ok, interactHash: interactHash({ ...spec, steps: [{ inputText: '12' }] }) };
  const plan = planOutputs(p, [old], { mode: 'draft' });
  assert.ok(!plan.jobs.some((j) => j.shot === '02-converter'));
  assert.ok(plan.skipped.some((s) => s.shot === '02-converter' && s.reason.includes('操作の設定')));
  assert.equal(interactHash({ ...spec, $note: '別の注記' }), interactHash(spec), '注記（$）は指紋に入れない');
});

test('independent-review: カメラの画面は実機の撮影だけを使う（シミュレーターの撮影は final でも draft でも使わない）', () => {
  const p = loadProfile(TABIRATE);
  const plan = planOutputs(p, [{ screen: 'camera', locale: 'ja', source: 'ios-simulator', file: 'c.png' }], { mode: 'final' });
  assert.ok(!plan.jobs.some((j) => j.shot === '01-camera'));
  assert.ok(plan.skipped.some((s) => s.shot === '01-camera' && s.reason.includes('device の撮影が要る')));
  const dev = planOutputs(p, [{ screen: 'camera', locale: 'ja', source: 'device', file: 'c.png' }], { mode: 'final' });
  assert.ok(dev.jobs.some((j) => j.shot === '01-camera'));
  assert.deepEqual(dev.jobs.find((j) => j.ad === 'lp-hero').captures.map((c) => c.screen), ['camera'], 'カメラを根拠にした広告はカメラの撮影を先に使う');
});

test('independent-review: callout は rect を測った端末の撮影にだけ重ね、別の端末では省いて注記を残す', () => {
  const p = loadProfile(TABIRATE);
  const caps = (device) => [{ screen: 'history', locale: 'ja', source: 'ios-simulator', file: 'h.png', device }];
  const same = planOutputs(p, caps('iPhone 17 Pro Max'), { mode: 'draft' }).jobs.find((j) => j.shot === '03-records');
  assert.ok(same.callout && !same.notes.some((n) => n.includes('callout')));
  const other = planOutputs(p, caps('iPhone 17'), { mode: 'draft' }).jobs.find((j) => j.shot === '03-records');
  assert.equal(other.callout, null);
  assert.match(other.notes[0], /callout を省いた/);
});

test('independent-review: 広告で使えなかった候補を注記に残す（代わりの画面で作ったことを人が確かめられる）', () => {
  const p = loadProfile(TABIRATE);
  const hero = planOutputs(p, [{ screen: 'history', locale: 'ja', source: 'ios-simulator', file: 'h.png' }], { mode: 'draft' }).jobs.find((j) => j.ad === 'lp-hero');
  assert.ok(hero.notes.some((n) => n.includes('01-camera')) && hero.notes.some((n) => n.includes('02-converter')), hero.notes.join('／'));
});

test('independent-review: 端末の画面も撮影の等倍を超えて拡大しない（小さい撮影・大きい出力先）', () => {
  const brand = { primary: '#0E9488' };
  const html = storeShotHtml({ width: 2064, height: 2752, brand, title: 'a', imageDataUrl: 'data:,', imageWidth: 750, imageAspect: 1.78 });
  const w = Number(html.match(/class="phone" style="width:([\d.]+)px/)[1]);
  const bezel = (2064 / 100) * 1.5;
  assert.ok(w - bezel * 2 <= 750 + 1e-6, `画面の幅 ${w - bezel * 2}`);
  assert.equal(fitPhoneW(500, 1320, 10), 500, '縮小はそのまま');
  for (const layout of AD_LAYOUTS) {
    const ad = adHtml({ width: 1920, height: 1920, brand, headline: 'a', images: ['data:,', 'data:,'], imageWidth: 300, imageAspect: 2, layout });
    // 1920×1920 の unit は 19.2、枠の太さは unit×1.5＝28.8px
    for (const m of ad.matchAll(/class="phone" style="width:([\d.]+)px/g)) assert.ok(Number(m[1]) - 28.8 * 2 <= 300 + 1e-6, `${layout}: ${m[1]}`);
  }
});

test('independent-review: 設定の値の形を検査する（文字のままの確認・JS 評価の ${・不正な tapOn・色・数値）', () => {
  const p = JSON.parse(fs.readFileSync(TABIRATE, 'utf8'));
  const conv = (b) => b.capture.screens.find((s) => s.id === 'converter').interact;
  const t = (mut, re) => { const b = structuredClone(p); mut(b); const e = validateProfile(b); assert.ok(e.some((x) => re.test(x)), `${re}: ${e.join(' / ')}`); };
  t((b) => { conv(b).expectNotVisible = '金額を入力'; }, /expectNotVisible は文字の配列/);
  t((b) => { conv(b).steps[1] = { inputText: '${1+1}' }; }, /inputText は/);
  t((b) => { conv(b).steps[0] = { tapOn: null }; }, /tapOn は/);
  t((b) => { conv(b).steps[0] = { tapOn: { id: 'x', optional: true } }; }, /tapOn は/);
  t((b) => { b.brand.primary = 'red;}body{display:none'; }, /brand\.primary は色/);
  t((b) => { b.shots.find((s) => s.id === '03-records').callout.shiftY = 'x'; }, /shiftY/);
  t((b) => { b.ads[0].maxPhones = 9; }, /maxPhones/);
  t((b) => { b.ads[0].tone = { nope: 'light' }; }, /tone の nope/);
  t((b) => { b.shots[0].sources = ['camera-roll']; }, /sources は/);
  t((b) => { delete b.shots.find((s) => s.id === '03-records').callout.device; }, /callout\.device/);
  assert.throws(() => maestroFlow({ bundleId: 'a.b', interact: { steps: [{ inputText: '1' }], expectVisible: 'x' } }), /文字の配列/);
});

test('independent-review: フローは撮る画面を開き直してから操作し、id も文字として照合する', () => {
  const flow = maestroFlow({ bundleId: 'a.b', deepLink: 'x:///converter', interact: { steps: [{ tapOn: { id: 'a.b' } }], expectVisible: ['1'] } });
  const lines = flow.trim().split('\n');
  assert.equal(lines[2], '- openLink: "x:///converter"');
  assert.equal(JSON.parse(lines[4].replace('- tapOn: ', '')).id, 'a\\.b');
});

test('independent-review: 新旧比較の一覧は出力先ごとに前と今回を並べ、前の run を相対パスで参照する', () => {
  const html = compareHtml(
    { app: { id: 'x' }, git: { commit: 'aaa' }, outputs: [{ target: 'sns-square', file: 'ads\\ja\\sns-square\\a.png', ad: 'a' }] },
    { app: { id: 'x' }, git: { commit: 'bbb' }, mode: 'draft', skipped: [], outputs: [{ target: 'sns-square', file: 'ads/ja/sns-square/b.png', ad: 'b', layout: 'square', tone: 'light' }] },
    '../old<run>',
  );
  assert.ok(html.includes('src="../old&lt;run&gt;/ads/ja/sns-square/a.png"'), '前の run は相対パス（エスケープ）');
  assert.ok(html.includes('src="ads/ja/sns-square/b.png"'));
  assert.ok(html.includes('前 1枚 → 今回 1枚'));
});

test('verify: 撮った後の確認で表示が無かった撮影は使わず、確かめていない撮影は注記付きで使う', () => {
  const p = loadProfile(TABIRATE);
  const base = { screen: 'history', locale: 'ja', source: 'ios-simulator', file: 'h.png', device: 'iPhone 17 Pro Max' };
  const bad = planOutputs(p, [{ ...base, verified: false }], { mode: 'draft' });
  assert.ok(!bad.jobs.some((j) => j.shot === '03-records'));
  assert.ok(bad.skipped.some((s) => s.shot === '03-records' && s.reason.includes('期待する表示が無かった')));
  const unknown = planOutputs(p, [base], { mode: 'draft' }).jobs.find((j) => j.shot === '03-records');
  assert.ok(unknown.notes.some((n) => n.includes('機械で未確認')));
  const ok = planOutputs(p, [{ ...base, verified: true }], { mode: 'draft' }).jobs.find((j) => j.shot === '03-records');
  assert.ok(!ok.notes.some((n) => n.includes('未確認')));
});

test('verify: 画面の確認の設定は配列で、操作の画面には書かない。注記（disclaimer）は全ての出力に入る', () => {
  const p = JSON.parse(fs.readFileSync(TABIRATE, 'utf8'));
  const b = structuredClone(p);
  b.capture.screens.find((s) => s.id === 'calendar').expectVisible = '¥20,361';
  b.capture.screens.find((s) => s.id === 'converter').expectVisible = ['x'];
  const e = validateProfile(b);
  assert.ok(e.some((x) => x.includes('screen calendar: expectVisible は文字の配列')));
  assert.ok(e.some((x) => x.includes('操作の画面の確認は interact')));
  const lp = loadProfile(TABIRATE);
  const plan = planOutputs(lp, [{ screen: 'history', locale: 'ja', source: 'ios-simulator', file: 'h.png' }, { screen: 'calendar', locale: 'ja', source: 'ios-simulator', file: 'c.png' }], { mode: 'draft' });
  for (const job of plan.jobs) assert.ok(jobHtml(lp, job, ['data:,', 'data:,'], 2.17).includes(`class="sa-note"`), `${job.file} に注記`);
  assert.ok(jobHtml(lp, plan.jobs[0], ['data:,'], 2.17).includes(lp.disclaimer.ja));
});

test('gallery: 前の run がある時は index.html から compare.html へつなぐ', () => {
  const m = { app: { id: 'x' }, generatedAt: 't', git: { commit: 'c' }, mode: 'draft', validation: { ok: true, problems: [] }, skipped: [], outputs: [], parentRun: '20261123-old' };
  assert.ok(galleryHtml(m).includes('<a href="compare.html">'));
  assert.ok(!galleryHtml({ ...m, parentRun: undefined }).includes('compare.html'));
});

test('storeSets: 掲載の並びは定義済みの shot を理由つきで1〜10件。出力の部分集合を順に指し、作れなかった shot を残す', () => {
  const p = JSON.parse(fs.readFileSync(TABIRATE, 'utf8'));
  assert.deepEqual(validateProfile(p), []);
  const bad = (mutate) => { const x = structuredClone(p); mutate(x); return validateProfile(x); };
  assert.ok(bad((x) => { x.storeSets[0].shots[0].shot = 'nowhere'; }).some((e) => e.includes('未定義の shot')));
  assert.ok(bad((x) => { x.storeSets[0].shots.push(structuredClone(x.storeSets[0].shots[0])); }).some((e) => e.includes('重複')));
  assert.ok(bad((x) => { delete x.storeSets[0].shots[0].reason; }).some((e) => e.includes('reason.ja')));
  assert.ok(bad((x) => { x.storeSets[0].shots = []; }).some((e) => e.includes('1〜10件')));

  const profile = { locales: ['ja'], outputs: { store: ['appstore-iphone-6.9'] }, storeSets: [{ id: 'r', title: { ja: '推奨' }, shots: [{ shot: 'b', reason: { ja: '理由B' } }, { shot: 'a', reason: { ja: '理由A' } }, { shot: 'z', reason: { ja: '理由Z' } }] }] };
  const out = (shot) => ({ file: `store/ja/appstore-iphone-6.9/${shot}.png`, kind: 'store', target: 'appstore-iphone-6.9', locale: 'ja', shot, mode: 'draft', sources: [{ screen: shot, source: 'device', sha256: 's' }], width: 1320, height: 2868, sha256: `h-${shot}`, notes: [] });
  const outputs = [out('a'), out('b')];
  const [set] = storeSetsFor(profile, outputs);
  const [list] = set.lists;
  assert.deepEqual(list.items.map((i) => [i.order, i.shot, i.file && path.basename(i.file)]), [[1, 'b', 'b.png'], [2, 'a', 'a.png'], [3, 'z', null]]);
  assert.deepEqual(list.missing, ['z']);
  assert.equal(list.items[0].sha256, 'h-b');
  assert.deepEqual(storeSetProblems('draft', [set]), []);
  assert.equal(storeSetProblems('final', [set]).length, 1);

  const m = { app: { id: 'x' }, generatedAt: 't', git: { commit: 'c' }, mode: 'draft', validation: { ok: true, problems: [] }, skipped: [], outputs, storeSets: [set] };
  const html = galleryHtml(m);
  assert.ok(html.indexOf('理由B') < html.indexOf('理由A'), '並びの順に表示する');
  assert.ok(html.includes('作れなかった：z'));
});
