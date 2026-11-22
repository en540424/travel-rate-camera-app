import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { planIosCapture, planToRunScript } from './drivers/ios-simulator.mjs';
import { buildJobSteps, cmdJobIngest, cmdJobRun, cmdJobStatus, makeCiCommit, pickSimulators } from './job-commands.mjs';
import {
  captureRel, CI_BRANCH_PREFIX, CI_JOB_FILE, ciBranchFor, createJob, forbiddenIdentifiers, githubDispatchArgs, githubDownloadArgs, isMacMiniHost, newStatus, parsePreflight,
  githubRunProblems, preflightProblems, redactIdentifiers, resolveCiJob, RESULT_SCHEMA, sameImageProblems, transition, validateJob, verifyResult, verifyRunMeta,
} from './jobs.mjs';
import { excludeDraftJobCaptures, sha256 } from './pipeline.mjs';
import { encodeRgbPng, readPngInfo } from './png.mjs';
import { loadProfile } from './profile.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TABIRATE = path.join(HERE, '..', 'apps', 'tabirate', 'profile.json');
const profile = loadProfile(TABIRATE);
const FULL = 'abc1234'.padEnd(40, '0');
const GIT = { commit: 'abc1234', full: FULL, dirty: false };
const NOW = new Date('2026-11-21T01:02:03Z');
const RUN42 = { databaseId: 42, workflowName: 'store-assets-ios', event: 'workflow_dispatch', headBranch: 'main', headSha: 'f'.repeat(40), status: 'completed', conclusion: 'success', url: 'https://example.invalid/run/42' };

function png(w = 320, h = 640, shade = 0) {
  const pixels = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) pixels.set([shade, 100, 200, 255], i * 4);
  return encodeRgbPng({ width: w, height: h, pixels });
}

function job(over = {}) {
  return createJob(profile, GIT, { target: 'github-actions-macos', devices: ['iPhone 17 Pro Max'], screens: ['history', 'calendar'], now: NOW, profileRel: 'tools/store-assets/apps/tabirate/profile.json', ...over });
}

/** 結果のフォルダを合成する（Macでの撮影の代わり。取り込みの規則の検査だけに使う） */
function makeResult(j, { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-result-')), env, mutate } = {}) {
  const captures = [];
  let shade = 10;
  for (const device of j.devices) for (const locale of j.locales) for (const screen of j.screens) {
    const rel = captureRel(device, locale, screen);
    const buf = png(320, 640, shade += 20);
    fs.mkdirSync(path.join(dir, path.dirname(rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), buf);
    captures.push({ device, locale, screen, file: rel, sha256: sha256(buf), width: 320, height: 640 });
  }
  const result = {
    schema: RESULT_SCHEMA, jobId: j.id, purpose: j.purpose, git: { commit: j.git.commit, dirty: false }, source: 'ios-simulator', status: 'succeeded',
    env: env ?? { runner: 'github-actions', githubRunId: '42', macos: '26.7.2', xcode: 'Xcode 26.6', devices: j.devices.map((name) => ({ name, runtime: 'iOS-26-5' })) },
    startedAt: NOW.toISOString(), finishedAt: NOW.toISOString(), captures,
  };
  mutate?.(result, dir);
  fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify(result, null, 2));
  // job-fetch が照合して残す run の記録（workflow_dispatch の経路）
  fs.writeFileSync(path.join(dir, 'run.json'), JSON.stringify(RUN42));
  return { dir, result };
}

const verify = (j, dir) => {
  const raw = fs.readFileSync(path.join(dir, 'result.json'), 'utf8');
  return verifyResult(j, JSON.parse(raw), { readFile: (rel) => fs.readFileSync(path.join(dir, rel)), hash: sha256, pngInfo: readPngInfo, rawText: raw });
};

test('job：設定から作れて検証を通る。未commitの変更・無いデバイス・無い画面・Web版の撮影元は拒否', () => {
  const j = job();
  assert.equal(j.id, 'tabirate-20261121-010203-abc1234');
  assert.equal(j.git.commit, FULL); // actions/checkout が解決できる40桁
  assert.deepEqual(validateJob(j, profile), []);
  assert.ok(validateJob({ ...j, git: { commit: 'abc1234', dirty: false } }, profile).some((p) => p.includes('40桁')));
  assert.ok(validateJob({ ...j, git: { commit: FULL, dirty: true } }, profile).some((p) => p.includes('未commit')));
  assert.ok(validateJob(job({ devices: ['iPhone 99'] }), profile).some((p) => p.includes('iPhone 99')));
  assert.ok(validateJob(job({ screens: ['nope'] }), profile).some((p) => p.includes('nope')));
  assert.ok(validateJob({ ...j, source: 'web-preview' }, profile).some((p) => p.includes('ios-simulator')));
  assert.ok(validateJob({ ...j, target: 'cloud-x' }, profile).some((p) => p.includes('target')));
  // Mac mini は保守窓・空きディスクの条件を持つ
  const m = job({ target: 'mac-mini' });
  assert.equal(m.constraints.maintenanceWindowRequired, true);
  assert.equal(m.constraints.humanStart, true);
  assert.equal(j.constraints.humanStart, false);
});

test('状態：許された遷移だけ進む。失敗からの再依頼で試行が増える。終わった状態からは進めない', () => {
  let s = newStatus(job());
  assert.throws(() => transition(s, 'ingested'));
  s = transition(s, 'dispatched');
  s = transition(s, 'failed', { note: 'build失敗' });
  s = transition(s, 'dispatched');
  assert.equal(s.attempt, 2);
  s = transition(transition(s, 'succeeded'), 'ingested');
  assert.throws(() => transition(s, 'dispatched'));
  assert.equal(s.events.length, 6);
});

test('結果の検証：正しい結果は通る', () => {
  const j = job();
  const { dir } = makeResult(j);
  const v = verify(j, dir);
  assert.deepEqual(v.problems, []);
  assert.equal(v.ok, true);
});

test('結果の検証：撮影後の差し替え・別のcommit・別のジョブ・失敗した実行・撮影元の偽り・寸法の偽りを拒否', () => {
  const j = job();
  const tampered = makeResult(j, { mutate: (r, dir) => fs.writeFileSync(path.join(dir, r.captures[0].file), png(320, 640, 250)) });
  assert.ok(verify(j, tampered.dir).problems.some((p) => p.includes('sha256')));
  assert.ok(verify(j, makeResult(j, { mutate: (r) => { r.git.commit = 'def5678'.padEnd(40, '0'); } }).dir).problems.some((p) => p.includes('commit')));
  assert.ok(verify(j, makeResult(j, { mutate: (r) => { r.git.dirty = true; } }).dir).problems.some((p) => p.includes('clean')));
  assert.ok(verify(j, makeResult(j, { mutate: (r) => { r.captures = []; } }).dir).problems.some((p) => p.includes('1枚も無い')));
  assert.ok(verify(j, makeResult(j, { mutate: (r) => { r.captures.push(null, { device: ['x'] }); } }).dir).problems.some((p) => p.includes('形が不正')));
  assert.ok(verify(j, makeResult(j, { mutate: (r) => { r.env.devices = [{ name: 'iPhone 17', runtime: 'x' }]; } }).dir).problems.some((p) => p.includes('env.devices にジョブのデバイス')));
  const small = makeResult(j, { mutate: (r, dir) => { const b = png(6, 13); fs.writeFileSync(path.join(dir, r.captures[0].file), b); Object.assign(r.captures[0], { sha256: sha256(b), width: 6, height: 13 }); } });
  assert.ok(verify(j, small.dir).problems.some((p) => p.includes('小さすぎる')));
  assert.ok(verify(j, makeResult(j, { mutate: (r) => { r.jobId = 'other'; } }).dir).problems.some((p) => p.includes('jobId')));
  assert.ok(verify(j, makeResult(j, { mutate: (r) => { r.status = 'failed'; r.error = 'x'; } }).dir).problems.some((p) => p.includes('成功していない')));
  assert.ok(verify(j, makeResult(j, { mutate: (r) => { r.source = 'web-preview'; } }).dir).problems.some((p) => p.includes('ios-simulator')));
  assert.ok(verify(j, makeResult(j, { mutate: (r) => { r.captures[0].width = 1320; } }).dir).problems.some((p) => p.includes('寸法')));
  assert.ok(verify(j, makeResult(j, { mutate: (r) => { r.captures.push({ ...r.captures[0], screen: 'help', file: captureRel(r.captures[0].device, 'ja', 'help') }); } }).dir).problems.some((p) => p.includes('ジョブに無い')));
});

test('結果の検証：撮影環境の記録が無い・ホスト名やIPやホームのパスが入っていると拒否', () => {
  const j = job();
  assert.ok(verify(j, makeResult(j, { env: { runner: 'x' } }).dir).problems.some((p) => p.includes('env.')));
  const leak = makeResult(j, { mutate: (r) => { r.env.host = 'mac-mini.local'; r.env.ip = '192.168.1.20'; r.env.path = '/Users/someone/app'; } });
  const p = verify(j, leak.dir).problems.join(' ');
  for (const k of ['IPアドレス', 'ホスト名', 'ホームのパス']) assert.ok(p.includes(k), k);
  assert.deepEqual(forbiddenIdentifiers('{"xcode":"Xcode 26.6","macos":"26.7.2","runtime":"iOS-26-5","at":"2026-11-21T05:31:19.460Z","ImageVersion":"20261117.0516.1"}'), []);
  for (const [text, label] of [
    [JSON.stringify({ e: 'C:\\Users\\someone\\x' }), 'Windowsのホームのパス'],
    ['addr 2001:db8::1 here', 'IPv6アドレス'],
    ['/Volumes/External/x', 'ボリューム'],
    ['mac.tail1234.ts.net', 'tailnet'],
  ]) assert.ok(forbiddenIdentifiers(text).some((l) => l.includes(label)), label);
  const red = redactIdentifiers("Command failed: cp '/Users/someone/out/x.png' to 10.0.0.2", [['/Users/someone/out', '<out>']]);
  assert.ok(red.includes('<out>') && !red.includes('someone') && !red.includes('10.0.0.2'));
  assert.deepEqual(forbiddenIdentifiers(red), []);
});

test('結果の検証：draft は撮れなかった画面を問題にしないが、final-candidate は問題にする', () => {
  const d = job();
  const missingD = makeResult(d, { mutate: (r) => { r.captures.pop(); } });
  const vd = verify(d, missingD.dir);
  assert.equal(vd.ok, true);
  assert.equal(vd.missing.length, 1);
  const f = job({ purpose: 'final-candidate' });
  const vf = verify(f, makeResult(f, { mutate: (r) => { r.captures.pop(); } }).dir);
  assert.equal(vf.ok, false);
  assert.ok(vf.problems.some((x) => x.includes('撮れていない')));
});

test('手順：既存のiOS撮影手順を再利用し、アプリの導入はデバイスごとに1回。出力先は結果の規則どおり', () => {
  const j = job({ devices: ['iPhone 17 Pro Max', 'iPhone 17'] });
  const groups = buildJobSteps(j, profile, { outDir: '/tmp/r', fixtureDb: '/tmp/r/fixture/travelrate.db', appPath: '/tmp/App.app' });
  assert.equal(groups.length, 2);
  for (const g of groups) {
    const cmds = g.steps.map((s) => s.cmd).join('\n');
    assert.equal((cmds.match(/simctl install/g) ?? []).length, 1);
    assert.ok(cmds.includes(`/tmp/r/${path.posix.dirname(captureRel(g.device, 'ja', 'x'))}/history.png`));
    assert.ok(!cmds.includes('help.png'));
  }
  assert.ok(!planIosCapture({ device: 'X', bundleId: 'b', screens: [], outDir: 'o' }).some((s) => s.cmd.includes('install')));
});

test('dry-run：Windowsでも手順を作って書き出し、撮影はしない。Mac mini の実行は保守窓の確認なしでは止まる', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-job-'));
  const j = job({ target: 'mac-mini' });
  fs.writeFileSync(path.join(tmp, 'job.json'), JSON.stringify(j));
  const r = await cmdJobRun({ job: tmp, profile: TABIRATE, 'dry-run': true, out: path.join(tmp, 'out') });
  assert.equal(r.dryRun, true);
  assert.ok(fs.existsSync(path.join(tmp, 'out', 'dry-run.json')));
  assert.ok(!fs.existsSync(path.join(tmp, 'out', 'result.json')));
  assert.ok(r.steps.some((s) => s.cmd.includes('simctl io')));
  if (process.platform !== 'darwin') await assert.rejects(cmdJobRun({ job: tmp, profile: TABIRATE, out: path.join(tmp, 'out') }), /macOS/);
});

test('取り込み：検証を通った結果を ios-simulator の撮影として run へ入れ、撮影環境を記録し、状態を ingested にする', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-ingest-'));
  const j = job();
  fs.writeFileSync(path.join(tmp, 'job.json'), JSON.stringify(j));
  fs.writeFileSync(path.join(tmp, 'status.json'), JSON.stringify(transition(newStatus(j), 'dispatched')));
  const { dir } = makeResult(j);
  const run = path.join(tmp, 'run');
  const r = cmdJobIngest({ job: tmp, profile: TABIRATE, from: dir, run });
  assert.equal(r.added, 2);
  const caps = JSON.parse(fs.readFileSync(path.join(run, 'captures.json'), 'utf8'));
  assert.ok(caps.every((c) => c.source === 'ios-simulator' && c.job.id === j.id && c.job.xcode === 'Xcode 26.6' && c.device === 'iPhone 17 Pro Max'));
  assert.equal(JSON.parse(fs.readFileSync(path.join(tmp, 'status.json'), 'utf8')).state, 'ingested');
  assert.equal(cmdJobStatus({ job: tmp }).state, 'ingested');
});

test('取り込み：検証に落ちた結果は入れず、失敗した実行なら状態を failed にして理由を残す', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-ingest-ng-'));
  const j = job();
  fs.writeFileSync(path.join(tmp, 'job.json'), JSON.stringify(j));
  fs.writeFileSync(path.join(tmp, 'status.json'), JSON.stringify(transition(newStatus(j), 'dispatched')));
  const { dir } = makeResult(j, { mutate: (r) => { r.status = 'failed'; r.error = 'xcodebuild 失敗'; } });
  const run = path.join(tmp, 'run');
  assert.throws(() => cmdJobIngest({ job: tmp, profile: TABIRATE, from: dir, run }), /取り込めません/);
  assert.ok(!fs.existsSync(path.join(run, 'captures.json')));
  const st = JSON.parse(fs.readFileSync(path.join(tmp, 'status.json'), 'utf8'));
  assert.equal(st.state, 'failed');
  assert.equal(JSON.parse(fs.readFileSync(path.join(tmp, 'ingest.json'), 'utf8')).ok, false);
});

test('取り込み：Web版の撮影と同じ画像はシミュレーターとして入れない', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-ingest-web-'));
  const j = job();
  fs.writeFileSync(path.join(tmp, 'job.json'), JSON.stringify(j));
  const { dir, result } = makeResult(j);
  const run = path.join(tmp, 'run');
  fs.mkdirSync(run, { recursive: true });
  fs.writeFileSync(path.join(run, 'captures.json'), JSON.stringify([{ screen: 'history', locale: 'ja', source: 'web-preview', file: 'x.png', sha256: result.captures[0].sha256 }]));
  assert.throws(() => cmdJobIngest({ job: tmp, profile: TABIRATE, from: dir, run }), /Web版/);
});

test('資源の確認：空きディスク・空きメモリを値だけ読み、条件に足りなければ止める', () => {
  const pre = parsePreflight({
    dfK: 'Filesystem 1024-blocks Used Available Capacity iused ifree %iused Mounted on\n/dev/disk3s1s1 971350180 10000000 20971520 3% 1 2 0% /',
    loadavg: '{ 1.52 1.40 1.30 }', memPressure: 'System-wide memory free percentage: 15%',
  });
  assert.deepEqual(pre, { freeDiskGB: 20, load1: 1.52, memoryFreePercent: 15 });
  const p = preflightProblems(job({ target: 'mac-mini' }), pre);
  assert.equal(p.length, 2);
  assert.deepEqual(preflightProblems(job(), pre), []);
  // Mac mini の守りはジョブの記載に依存しない：constraints を消しても、ホストが Mac mini なら効く。不明な値では止まる
  const stripped = { ...job({ target: 'local-macos' }), constraints: {} };
  assert.equal(preflightProblems(stripped, { freeDiskGB: 100 }, { onMacMini: true }).length, 1);
  assert.equal(preflightProblems(stripped, {}, { onMacMini: true }).length, 2);
  assert.equal(isMacMiniHost({ env: { ENEXUS_RUNTIME_NODE: 'mac-mini' } }), true);
  assert.equal(isMacMiniHost({ env: {}, markerExists: () => true }), true);
  assert.equal(isMacMiniHost({ env: {} }), false);
});

test('取り込み：終わった状態・失敗の後のジョブには副作用の前に断る。失敗の結果は created からでも failed を記録する', () => {
  const j = job();
  for (const state of ['failed', 'cancelled', 'ingested']) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `sa-state-${state}-`));
    fs.writeFileSync(path.join(tmp, 'job.json'), JSON.stringify(j));
    fs.writeFileSync(path.join(tmp, 'status.json'), JSON.stringify({ ...newStatus(j), state }));
    const run = path.join(tmp, 'run');
    assert.throws(() => cmdJobIngest({ job: tmp, profile: TABIRATE, from: makeResult(j).dir, run }), /取り込めない/);
    assert.ok(!fs.existsSync(path.join(run, 'captures.json')));
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-created-fail-'));
  fs.writeFileSync(path.join(tmp, 'job.json'), JSON.stringify(j));
  fs.writeFileSync(path.join(tmp, 'status.json'), JSON.stringify(newStatus(j)));
  assert.throws(() => cmdJobIngest({ job: tmp, profile: TABIRATE, from: makeResult(j, { mutate: (r) => { r.status = 'failed'; } }).dir, run: path.join(tmp, 'run') }));
  assert.equal(JSON.parse(fs.readFileSync(path.join(tmp, 'status.json'), 'utf8')).state, 'failed');
});

test('取り込み：別のデバイスの撮影がある run へは入れない（1台目の記録を消さない）', () => {
  const j = job({ devices: ['iPhone 17 Pro Max', 'iPhone 17'] });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-2dev-'));
  fs.writeFileSync(path.join(tmp, 'job.json'), JSON.stringify(j));
  const { dir } = makeResult(j);
  const run = path.join(tmp, 'run');
  cmdJobIngest({ job: tmp, profile: TABIRATE, from: dir, run, device: 'iPhone 17 Pro Max' });
  fs.writeFileSync(path.join(tmp, 'status.json'), JSON.stringify(transition(newStatus(j), 'dispatched')));
  assert.throws(() => cmdJobIngest({ job: tmp, profile: TABIRATE, from: dir, run, device: 'iPhone 17' }), /別のデバイス/);
  const caps = JSON.parse(fs.readFileSync(path.join(run, 'captures.json'), 'utf8'));
  assert.ok(caps.every((c) => c.device === 'iPhone 17 Pro Max'));
});

test('取り込み：新しい run へ入れる時も、同じアプリの他の run のWeb版の撮影と照らす', () => {
  const j = job();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-webscan-'));
  fs.writeFileSync(path.join(tmp, 'job.json'), JSON.stringify(j));
  const { dir, result } = makeResult(j);
  const appOut = path.join(tmp, 'app');
  fs.mkdirSync(path.join(appOut, 'older-run'), { recursive: true });
  fs.writeFileSync(path.join(appOut, 'older-run', 'captures.json'), JSON.stringify([{ screen: 'history', locale: 'ja', source: 'web-preview', file: 'x.png', sha256: result.captures[1].sha256 }]));
  assert.throws(() => cmdJobIngest({ job: tmp, profile: TABIRATE, from: dir, run: path.join(appOut, 'new-run') }), /Web版/);
  assert.ok(!fs.existsSync(path.join(appOut, 'new-run')));
});

test('final：draft のジョブの撮影は使わず、理由を残す。draft の合成では使う', () => {
  const caps = [{ screen: 'history', locale: 'ja', source: 'ios-simulator', job: { purpose: 'draft' } }, { screen: 'calendar', locale: 'ja', source: 'ios-simulator', job: { purpose: 'final-candidate' } }, { screen: 'help', locale: 'ja', source: 'device' }];
  const f = excludeDraftJobCaptures('final', { ok: caps, rejected: [] });
  assert.deepEqual(f.ok.map((c) => c.screen), ['calendar', 'help']);
  assert.ok(f.rejected[0].reason.includes('draft'));
  assert.equal(excludeDraftJobCaptures('draft', { ok: caps, rejected: [] }).ok.length, 3);
});

test('GitHub：依頼と取得のコマンドを作る（実行はしない）', () => {
  const j = job();
  const a = githubDispatchArgs(j);
  assert.deepEqual(a.slice(0, 5), ['workflow', 'run', 'store-assets-ios.yml', '--ref', 'main']);
  assert.equal(JSON.parse(a[6].slice('job_json='.length)).id, j.id);
  assert.deepEqual(githubDownloadArgs(j, 42, 'd'), ['run', 'download', '42', '-n', `store-assets-${j.id}`, '-D', 'd']);
});

test('workflow：専用branchの push と手動だけで起動し、秘密情報を使わず、読み取りの権限だけ・外部Actionは40桁で固定', () => {
  const t = fs.readFileSync(path.join(HERE, '..', '..', '..', '.github', 'workflows', 'store-assets-ios.yml'), 'utf8');
  const on = t.slice(t.indexOf('\non:'), t.indexOf('\npermissions:'));
  assert.deepEqual([...on.matchAll(/^ {2}([a-z_]+):/gm)].map((m) => m[1]), ['push', 'workflow_dispatch']);
  assert.ok(/push:\s*\n\s*branches:\s*\n\s*- 'ci\/store-assets-ios\/\*\*'\n\s*workflow_dispatch:/.test(on), 'push は専用branchだけ');
  assert.ok(!/pull_request|schedule|workflow_run|repository_dispatch/.test(t.replace(/^#.*$/gm, '')));
  assert.ok(!t.includes('secrets.'));
  assert.ok(/^permissions:\s*\n\s*contents: read\s*\n\s*\n/m.test(t), 'contents: read だけ');
  assert.ok(t.includes('persist-credentials: false'));
  assert.ok(/runs-on: macos-26\n/.test(t), '標準ランナー（larger runner ではない）');
  assert.ok(/timeout-minutes: \d+/.test(t) && /concurrency:/.test(t));
  for (const m of t.matchAll(/uses: ([^\s]+)/g)) assert.ok(/@[0-9a-f]{40}$/.test(m[1]), `${m[1]} は40桁で固定`);
  // 入力はシェルへ直接埋め込まない（環境変数で受ける）
  assert.ok(!/run:.*\$\{\{\s*(inputs|github\.event)/.test(t));
  assert.ok(t.includes('JOB_JSON: ${{ inputs.job_json }}'));
  assert.ok(/retention-days: [1-7]\n/.test(t));
  assert.ok(!t.includes('result/fixture') && t.includes('result/result.json'), '成果物は結果とPNGだけ');
  assert.ok(!fs.existsSync(path.join(HERE, '..', 'remote', 'github-actions', 'store-assets-ios.yml')), 'テンプレートと二重に持たない');
});

test('CI：push で届いたジョブは「ジョブのcommit＋job.json だけ」の時だけ受け付ける', () => {
  const j = job({ target: 'github-actions-macos' });
  const text = JSON.stringify(j);
  const ok = { event: 'push', ref: `refs/heads/${ciBranchFor(j)}`, fileJson: text, parents: [FULL], changed: [CI_JOB_FILE] };
  assert.deepEqual(resolveCiJob(ok).problems, []);
  assert.equal(resolveCiJob(ok).job.id, j.id);
  const bad = (over, word) => {
    const r = resolveCiJob({ ...ok, ...over });
    assert.equal(r.job, null);
    assert.ok(r.problems.some((x) => x.includes(word)), `${word}：${r.problems.join('／')}`);
  };
  bad({ ref: 'refs/heads/main' }, 'branch');
  bad({ ref: `refs/heads/${CI_BRANCH_PREFIX}other` }, 'branch');
  bad({ parents: ['f'.repeat(40)] }, '親がジョブのcommitではない');
  bad({ parents: [FULL, 'f'.repeat(40)] }, '親が1つではない');
  bad({ changed: [CI_JOB_FILE, 'src/app/index.tsx'] }, '以外も変えている');
  bad({ changed: ['package.json'] }, '以外も変えている');
  bad({ fileJson: '{' }, 'JSONではない');
  bad({ fileJson: JSON.stringify({ ...j, target: 'mac-mini' }) }, 'github-actions-macos');
  bad({ fileJson: JSON.stringify({ ...j, git: { commit: 'abc', dirty: false } }) }, '40桁');
  bad({ event: 'pull_request' }, '扱わない');
  bad({ event: 'pull_request_target' }, '扱わない');
  assert.equal(resolveCiJob({ event: 'workflow_dispatch', inputJson: text }).job.id, j.id);
});

test('CI：取得する run がそのジョブの branch・commit・workflow のものか確かめる', () => {
  const j = job({ target: 'github-actions-macos' });
  const status = { ...newStatus(j), ci: { branch: ciBranchFor(j), commit: 'c'.repeat(40) } };
  const meta = { workflowName: 'store-assets-ios', event: 'push', headBranch: ciBranchFor(j), headSha: 'c'.repeat(40), status: 'completed' };
  assert.deepEqual(verifyRunMeta(j, status, meta), []);
  assert.ok(verifyRunMeta(j, status, { ...meta, headSha: 'd'.repeat(40) }).length);
  assert.ok(verifyRunMeta(j, status, { ...meta, headBranch: 'main' }).length);
  assert.ok(verifyRunMeta(j, status, { ...meta, workflowName: 'other' }).length);
  assert.ok(verifyRunMeta(j, status, { ...meta, status: 'in_progress' }).length);
  assert.ok(verifyRunMeta(j, newStatus(j), meta).length, '依頼の記録が無い push の run は受けない');
});

test('シミュレーター：同じ名前が複数のランタイムにある時は新しい版を選び、iOS以外と使えないものを除く', () => {
  const u = (n) => `${String(n).repeat(8)}-0000-0000-0000-000000000000`.slice(0, 36);
  const list = { devices: {
    'com.apple.CoreSimulator.SimRuntime.iOS-26-2': [{ name: 'iPhone 17 Pro Max', udid: u(1) }],
    'com.apple.CoreSimulator.SimRuntime.iOS-26-5': [{ name: 'iPhone 17 Pro Max', udid: u(2) }, { name: 'iPhone 17', udid: u(3), isAvailable: false }],
    'com.apple.CoreSimulator.SimRuntime.iOS-26-4': [{ name: 'iPhone 17 Pro Max', udid: u(4) }, { name: 'iPhone 17', udid: u(5) }],
    'com.apple.CoreSimulator.SimRuntime.watchOS-26-5': [{ name: 'iPhone 17', udid: u(6) }],
  } };
  assert.deepEqual(pickSimulators(list, ['iPhone 17 Pro Max', 'iPhone 17']), {
    'iPhone 17 Pro Max': { udid: u(2), runtime: 'iOS-26-5' },
    'iPhone 17': { udid: u(5), runtime: 'iOS-26-4' },
  });
  // 手順は名前ではなく選んだ1台で撮る（保存先の名前はデバイス名のまま）
  const g = buildJobSteps(job(), profile, { outDir: '/o', picked: { 'iPhone 17 Pro Max': { udid: u(2), runtime: 'iOS-26-5' } } });
  assert.ok(g[0].steps.some((s) => s.cmd.includes(`screenshot --type=png`) && s.cmd.includes(u(2)) && s.cmd.includes('iPhone-17-Pro-Max')));
  assert.ok(g[0].steps.some((s) => s.cmd.startsWith(`xcrun simctl privacy '${u(2)}' grant all`)), '権限の窓を出さない');
});

test('CI：依頼のcommitは作業ツリー・HEAD・indexに触れず、ジョブのcommit＋job.json だけになる', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-ci-'));
  const g = (...a) => execFileSync('git', a, { cwd: repo }).toString().trim();
  try {
    g('init', '-q'); g('config', 'user.email', 'test@example.invalid'); g('config', 'user.name', 't');
    fs.writeFileSync(path.join(repo, 'a.txt'), 'a');
    g('add', 'a.txt'); g('commit', '-q', '-m', 'base');
    const base = g('rev-parse', 'HEAD');
    fs.writeFileSync(path.join(repo, 'a.txt'), 'dirty');
    const j = { ...job({ target: 'github-actions-macos' }), git: { commit: base, dirty: false } };
    const c = makeCiCommit(repo, j);
    assert.equal(g('rev-parse', 'HEAD'), base, 'HEAD は動かない');
    assert.equal(fs.readFileSync(path.join(repo, 'a.txt'), 'utf8'), 'dirty', '作業ツリーは変わらない');
    assert.equal(g('diff', '--cached', '--name-only'), '', 'index は変わらない');
    assert.equal(g('rev-list', '--parents', '-n', '1', c).split(' ')[1], base);
    assert.equal(g('diff', '--name-only', base, c), CI_JOB_FILE);
    assert.equal(JSON.parse(g('show', `${c}:${CI_JOB_FILE}`)).id, j.id);
    assert.deepEqual(resolveCiJob({ event: 'push', ref: `refs/heads/${ciBranchFor(j)}`, fileJson: g('show', `${c}:${CI_JOB_FILE}`), parents: [base], changed: [CI_JOB_FILE] }).problems, []);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('iOSの手順は1本のシェルで実行する（前の手順で決めた変数を次の手順で使える。初回の実行で DATA_DIR が空になった不具合の回帰）', () => {
  const steps = planIosCapture({ device: 'X', bundleId: 'b', outDir: '/o', screens: [], fixtureDb: '/f.db', dbRelPath: 'Documents/SQLite/a.db' });
  const script = planToRunScript(steps);
  assert.ok(script.startsWith('set -euo pipefail\n'));
  assert.ok(script.indexOf('DATA_DIR="$(xcrun simctl get_app_container') < script.indexOf('test -n "$DATA_DIR"'));
  const bash = spawnSync('bash', ['-c', planToRunScript([{ cmd: 'X=1', note: 'a' }, { cmd: 'test "$X" = 1', note: 'b' }])], { encoding: 'utf8' });
  if (bash.error) return; // bash の無い環境では形の検査だけ
  assert.equal(bash.status, 0, bash.stderr);
  assert.ok(bash.stdout.includes('[ios] a') && bash.stdout.includes('[ios] b'));
  assert.notEqual(spawnSync('bash', ['-c', planToRunScript([{ cmd: 'false', note: 'a' }, { cmd: 'true', note: 'b' }])]).status, 0, '途中の失敗で止まる');
});


test('取り込み：別の画面が同じ画像（確認の窓・ホーム画面が写った）は検証で拒否する（2026-11-21 の実行の回帰）', () => {
  const j = job();
  const { dir } = makeResult(j, { mutate: (r, d) => {
    const same = fs.readFileSync(path.join(d, r.captures[0].file));
    fs.writeFileSync(path.join(d, r.captures[1].file), same);
    r.captures[1].sha256 = r.captures[0].sha256;
  } });
  const v = verify(j, dir);
  assert.equal(v.ok, false);
  assert.ok(v.problems.some((p) => p.includes('同じ画像')), v.problems.join('／'));
  assert.deepEqual(sameImageProblems([{ device: 'd', locale: 'ja', screen: 'a', sha256: 'x' }, { device: 'd', locale: 'ja', screen: 'b', sha256: 'y' }]), []);
});

test('取り込み：GitHub の実行先は、job-fetch が照合した run.json と結果の run id が一致する時だけ', () => {
  const j = job();
  const st = transition(newStatus(j), 'dispatched');
  const { result } = makeResult(j);
  assert.deepEqual(githubRunProblems(j, st, RUN42, result), []);
  assert.ok(githubRunProblems(j, st, null, result)[0].includes('run.json'));
  assert.ok(githubRunProblems(j, st, { ...RUN42, databaseId: 7 }, result).some((p) => p.includes('run id')));
  assert.ok(githubRunProblems(j, st, { ...RUN42, conclusion: 'failure' }, result).some((p) => p.includes('成功していない')));
  assert.ok(githubRunProblems(j, st, RUN42, { ...result, env: { ...result.env, runner: 'local-macos' } }).some((p) => p.includes('github-actions')));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-norun-'));
  fs.writeFileSync(path.join(tmp, 'job.json'), JSON.stringify(j));
  fs.writeFileSync(path.join(tmp, 'status.json'), JSON.stringify(st));
  const { dir } = makeResult(j);
  fs.rmSync(path.join(dir, 'run.json'));
  assert.throws(() => cmdJobIngest({ job: tmp, profile: TABIRATE, from: dir, run: path.join(tmp, 'run') }), /取り込めません/);
  assert.ok(JSON.parse(fs.readFileSync(path.join(tmp, 'ingest.json'), 'utf8')).problems.some((p) => p.includes('run.json')));
});

test('撮影の手順：ディープリンクの確認の窓を出さない承認を、起動とURLを開く前に書く', () => {
  const steps = planIosCapture({ device: 'D', bundleId: 'com.example.app', scheme: 'exampleapp', outDir: '/o', screens: [{ id: 's', deepLink: 'exampleapp:///s' }] });
  const i = steps.findIndex((s) => s.cmd.includes('com.apple.launchservices.schemeapproval') && s.cmd.includes("'com.apple.CoreSimulator.CoreSimulatorBridge-->exampleapp'") && s.cmd.includes("-string 'com.example.app'"));
  assert.ok(i >= 0);
  assert.ok(i < steps.findIndex((s) => s.cmd.startsWith('ios_probe')), '試しの起動より前');
  assert.ok(i < steps.findIndex((s) => s.cmd.startsWith('ios_launch')));
  assert.ok(i < steps.findIndex((s) => s.cmd.startsWith('xcrun simctl openurl')));
});
