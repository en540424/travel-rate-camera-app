import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { planIosCapture } from './drivers/ios-simulator.mjs';
import { buildJobSteps, cmdJobIngest, cmdJobRun, cmdJobStatus } from './job-commands.mjs';
import {
  captureRel, createJob, forbiddenIdentifiers, githubDispatchArgs, githubDownloadArgs, newStatus, parsePreflight,
  preflightProblems, RESULT_SCHEMA, transition, validateJob, verifyResult,
} from './jobs.mjs';
import { sha256 } from './pipeline.mjs';
import { encodeRgbPng, readPngInfo } from './png.mjs';
import { loadProfile } from './profile.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TABIRATE = path.join(HERE, '..', 'apps', 'tabirate', 'profile.json');
const profile = loadProfile(TABIRATE);
const GIT = { commit: 'abc1234', dirty: false };
const NOW = new Date('2026-11-21T01:02:03Z');

function png(w, h, shade) {
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
    const buf = png(6, 13, shade += 20);
    fs.mkdirSync(path.join(dir, path.dirname(rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), buf);
    captures.push({ device, locale, screen, file: rel, sha256: sha256(buf), width: 6, height: 13 });
  }
  const result = {
    schema: RESULT_SCHEMA, jobId: j.id, git: { commit: j.git.commit }, source: 'ios-simulator', status: 'succeeded',
    env: env ?? { runner: 'github-actions', macos: '26.7.2', xcode: 'Xcode 26.6', devices: j.devices.map((name) => ({ name, runtime: 'iOS-26-5' })) },
    startedAt: NOW.toISOString(), finishedAt: NOW.toISOString(), captures,
  };
  mutate?.(result, dir);
  fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify(result, null, 2));
  return { dir, result };
}

const verify = (j, dir) => {
  const raw = fs.readFileSync(path.join(dir, 'result.json'), 'utf8');
  return verifyResult(j, JSON.parse(raw), { readFile: (rel) => fs.readFileSync(path.join(dir, rel)), hash: sha256, pngInfo: readPngInfo, rawText: raw });
};

test('job：設定から作れて検証を通る。未commitの変更・無いデバイス・無い画面・Web版の撮影元は拒否', () => {
  const j = job();
  assert.equal(j.id, 'tabirate-20261121-010203-abc1234');
  assert.deepEqual(validateJob(j, profile), []);
  assert.ok(validateJob({ ...j, git: { commit: 'abc1234', dirty: true } }, profile).some((p) => p.includes('未commit')));
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
  const tampered = makeResult(j, { mutate: (r, dir) => fs.writeFileSync(path.join(dir, r.captures[0].file), png(6, 13, 250)) });
  assert.ok(verify(j, tampered.dir).problems.some((p) => p.includes('sha256')));
  assert.ok(verify(j, makeResult(j, { mutate: (r) => { r.git.commit = 'def5678'; } }).dir).problems.some((p) => p.includes('commit')));
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
  assert.deepEqual(forbiddenIdentifiers('{"xcode":"Xcode 26.6","macos":"26.7.2","runtime":"iOS-26-5"}'), []);
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
});

test('GitHub：依頼と取得のコマンドを作る（実行はしない）', () => {
  const j = job();
  const a = githubDispatchArgs(j);
  assert.deepEqual(a.slice(0, 5), ['workflow', 'run', 'store-assets-ios.yml', '--ref', 'main']);
  assert.equal(JSON.parse(a[6].slice('job_json='.length)).id, j.id);
  assert.deepEqual(githubDownloadArgs(j, 42, 'd'), ['run', 'download', '42', '-n', `store-assets-${j.id}`, '-D', 'd']);
});

test('workflow のテンプレート：既定のworkflowの場所に無く、手動の起動だけで、秘密情報を使わず、読み取りの権限だけ', () => {
  const t = fs.readFileSync(path.join(HERE, '..', 'remote', 'github-actions', 'store-assets-ios.yml'), 'utf8');
  assert.ok(!fs.existsSync(path.join(HERE, '..', '..', '..', '.github', 'workflows', 'store-assets-ios.yml')));
  assert.ok(/on:\s*\n\s*workflow_dispatch:/.test(t));
  assert.ok(!/^\s*(push|pull_request|schedule):/m.test(t));
  assert.ok(!t.includes('secrets.'));
  assert.ok(/permissions:\s*\n\s*contents: read/.test(t));
  assert.ok(!t.includes('${{ inputs.job_json }}"') && t.includes('JOB_JSON: ${{ inputs.job_json }}'));
});
