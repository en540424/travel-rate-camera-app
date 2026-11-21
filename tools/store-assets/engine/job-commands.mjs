// 遠隔撮影のジョブのコマンド（cli.mjs から呼ぶ）。純粋な規則は jobs.mjs、iOSの撮影手順は drivers/ios-simulator.mjs を再利用する。
//
//   job-create   --profile <p> --target github-actions-macos|mac-mini|local-macos [--device <名前>] [--locale ja] [--screens a,b] [--purpose draft|final-candidate]
//   job-validate --job <dir|job.json> [--profile <p>]
//   job-run      --job <dir|job.json> [--profile <p>] [--out <dir>] [--app <x.app>] [--dry-run] [--confirm-maintenance-window]   （macOS。--dry-run はどこでも）
//   job-dispatch --job <dir> [--execute]              （GitHub：gh workflow run の内容を表示。--execute で実行。Mac：持って行く手順を表示）
//   job-fetch    --job <dir> --run-id <id> [--execute]（GitHub：成果物の取得）
//   job-ingest   --job <dir> --from <結果のdir> [--device <名前>] [--run <runDir>]
//   job-status   --job <dir> [--to <状態> --note <理由>]
//   job-list     --profile <p>                         （一覧の表示と jobs/index.html）
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { planIosCapture, runIosPlan } from './drivers/ios-simulator.mjs';
import {
  captureRel, createJob, forbiddenIdentifiers, githubDispatchArgs, githubDownloadArgs, isMacMiniHost, newStatus, parsePreflight,
  preflightProblems, redactIdentifiers, RESULT_SCHEMA, sizeNotes, slug, TARGETS, transition, validateJob, verifyResult,
} from './jobs.mjs';
import { sha256 } from './pipeline.mjs';
import { readPngInfo } from './png.mjs';
import { loadProfile } from './profile.mjs';
import { defaultRunDir, gitInfo, projectRootOf, readCaptures, writeCaptures } from './runs.mjs';
import { escapeHtml } from './templates.mjs';

const list = (v) => (typeof v === 'string' && v.length ? v.split(',').map((x) => x.trim()).filter(Boolean) : []);

export function jobsRoot(profile) {
  return path.join(path.resolve(profile._dir, profile.outDir ?? '../../out'), profile.app.id, 'jobs');
}

function jobPaths(arg) {
  const abs = path.resolve(arg);
  const file = fs.existsSync(abs) && fs.statSync(abs).isDirectory() ? path.join(abs, 'job.json') : abs;
  return { dir: path.dirname(file), file, statusFile: path.join(path.dirname(file), 'status.json') };
}

function readJob(arg) {
  const p = jobPaths(arg);
  const job = JSON.parse(fs.readFileSync(p.file, 'utf8'));
  const status = fs.existsSync(p.statusFile) ? JSON.parse(fs.readFileSync(p.statusFile, 'utf8')) : null;
  return { ...p, job, status };
}

function saveStatus(p, status) {
  fs.writeFileSync(p.statusFile, JSON.stringify(status, null, 2));
}

function profileFor(args, job, root) {
  if (args.profile) return loadProfile(args.profile);
  if (!job.profile) throw new Error('--profile が必要です（ジョブに設定の場所が無い）');
  return loadProfile(path.resolve(root ?? process.cwd(), job.profile));
}

export function cmdJobCreate(profile, args) {
  const root = projectRootOf(profile);
  const git = gitInfo(root);
  const job = createJob(profile, git, {
    target: args.target, devices: list(args.device), locales: list(args.locale), screens: list(args.screens),
    purpose: args.purpose ?? 'draft', profileRel: path.relative(root, profile._file).replace(/\\/g, '/'),
  });
  const problems = validateJob(job, profile);
  if (problems.length) throw new Error(`ジョブを作れません：\n- ${problems.join('\n- ')}`);
  const dir = path.join(jobsRoot(profile), job.id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'job.json'), JSON.stringify(job, null, 2));
  saveStatus({ statusFile: path.join(dir, 'status.json') }, newStatus(job));
  console.log(`[job-create] ${dir}`);
  console.log(`[job-create] 実行先：${TARGETS[job.target].label}・デバイス ${job.devices.join(', ')}・言語 ${job.locales.join(', ')}・画面 ${job.screens.length}`);
  console.log('[job-create] 次：job-run --dry-run で手順を確かめ、job-dispatch で依頼する');
  return dir;
}

export function cmdJobValidate(args) {
  const { job } = readJob(args.job);
  const profile = profileFor(args, job);
  const problems = validateJob(job, profile);
  for (const p of problems) console.log(`NG ${p}`);
  console.log(problems.length ? `問題 ${problems.length}件` : 'OK');
  return problems.length === 0;
}

/** 実行の手順を組む（どのOSでも作れる）。 */
export function buildJobSteps(job, profile, { outDir, fixtureDb, appPath }) {
  const ios = profile.capture.ios ?? {};
  const screens = profile.capture.screens.filter((s) => job.screens.includes(s.id));
  const groups = [];
  for (const device of job.devices) {
    job.locales.forEach((locale, i) => {
      groups.push({
        device, locale,
        steps: planIosCapture({
          device, bundleId: job.app.bundleId, locale: profile.localeTags?.[locale] ?? locale,
          outDir: path.posix.join(outDir.replace(/\\/g, '/'), path.posix.dirname(captureRel(device, locale, 'x'))),
          screens, statusBar: ios.statusBar, appearance: ios.appearance,
          fixtureDb, dbRelPath: ios.dbRelPath, appPath: i === 0 ? appPath : undefined,
        }),
      });
    });
  }
  return groups;
}

function sh(cmd, args) {
  try { return execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'ignore'] }).toString(); } catch { return ''; }
}

/** 撮影環境（ホスト名・IPを含めない）。 */
function collectEnv(job) {
  const xcode = sh('xcodebuild', ['-version']).split('\n')[0]?.trim() || null;
  const macos = sh('sw_vers', ['-productVersion']).trim() || null;
  let devices = [];
  try {
    const j = JSON.parse(sh('xcrun', ['simctl', 'list', 'devices', 'available', '-j']) || '{}');
    for (const [runtime, devs] of Object.entries(j.devices ?? {})) {
      for (const d of devs) if (job.devices.includes(d.name)) devices.push({ name: d.name, runtime: runtime.replace('com.apple.CoreSimulator.SimRuntime.', '') });
    }
  } catch { devices = []; }
  const runner = process.env.GITHUB_ACTIONS === 'true' ? 'github-actions' : job.target;
  return { runner, runnerImage: process.env.ImageOS ?? null, runnerImageVersion: process.env.ImageVersion ?? null, githubRunId: process.env.GITHUB_RUN_ID ?? null, macos, xcode, devices };
}

export async function cmdJobRun(args) {
  const { job } = readJob(args.job);
  const profile = profileFor(args, job);
  const problems = validateJob(job, profile);
  if (problems.length) throw new Error(`ジョブが不正です：\n- ${problems.join('\n- ')}`);
  const root = projectRootOf(profile);
  const out = path.resolve(args.out ?? path.join(jobPaths(args.job).dir, 'result'));
  const git = gitInfo(root);
  const gitProblem = git.full !== job.git.commit || git.dirty
    ? `作業ツリー（${git.full ?? git.commit}${git.dirty ? '・未commitあり' : ''}）がジョブのcommit（${job.git.commit}）と違う` : null;
  const fixtureName = path.basename(profile.capture.ios?.dbRelPath ?? 'app.db');
  const fixtureDb = profile.capture.ios?.fixtureBuild ? path.join(out, 'fixture', fixtureName).replace(/\\/g, '/') : null;
  const groups = buildJobSteps(job, profile, { outDir: out, fixtureDb, appPath: args.app ? path.resolve(args.app) : undefined });

  if (args['dry-run']) {
    const steps = groups.flatMap((g) => g.steps);
    const report = { jobId: job.id, dryRun: true, target: job.target, gitProblem, groups: groups.map((g) => ({ device: g.device, locale: g.locale, steps: g.steps.length })), steps };
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, 'dry-run.json'), JSON.stringify(report, null, 2));
    for (const s of steps) console.log(`  ${s.cmd}`);
    if (gitProblem) console.warn(`[job-run] 注意：${gitProblem}（本番の実行では止まる）`);
    if (TARGETS[job.target].humanStart) console.warn(`[job-run] ${TARGETS[job.target].label} は人が開始する実行先${job.target === 'mac-mini' ? '（--confirm-maintenance-window が要る）' : ''}`);
    console.log(`[job-run] dry-run：${groups.length}組・手順 ${steps.length}（撮影はしていない）→ ${path.join(out, 'dry-run.json')}`);
    return report;
  }

  if (process.platform !== 'darwin') throw new Error('job-run の実行はmacOSでだけできます（Windowsでは --dry-run で手順を確かめる）');
  if (gitProblem) throw new Error(gitProblem);
  const onMacMini = job.target === 'mac-mini' || isMacMiniHost({ markerExists: () => fs.existsSync(path.join(os.homedir(), '.enexus', 'runtime-node-mac-mini')) });
  if (onMacMini && !args['confirm-maintenance-window']) {
    throw new Error('この Mac は常駐の他の用途と同居する実行機です。保守窓であることを人が確かめてから --confirm-maintenance-window を付けて実行してください（ジョブの実行先に関係なく、この Mac では必要）');
  }
  const pre = parsePreflight({ dfK: sh('df', ['-k', '/']), loadavg: sh('sysctl', ['-n', 'vm.loadavg']), memPressure: sh('memory_pressure', ['-Q']) });
  const result = { schema: RESULT_SCHEMA, jobId: job.id, purpose: job.purpose, git: { commit: git.full, dirty: git.dirty }, source: 'ios-simulator', startedAt: new Date().toISOString(), env: collectEnv(job), preflight: pre, captures: [] };
  // 書く前に、出力先・ホームのパス・ホスト名などを伏せる（公開repoの成果物になり得るため）
  const writeResult = () => {
    if (result.error) result.error = redactIdentifiers(result.error, [[out, '<out>'], [out.replace(/\\/g, '/'), '<out>'], [os.homedir(), '~']]);
    const text = JSON.stringify(result, null, 2);
    const leaked = forbiddenIdentifiers(text);
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, 'result.json'), leaked.length ? redactIdentifiers(text) : text);
  };
  const preP = preflightProblems(job, pre, { onMacMini });
  if (preP.length) { result.status = 'failed'; result.error = `資源の確認：${preP.join('・')}`; result.finishedAt = new Date().toISOString(); writeResult(); throw new Error(result.error); }
  try {
    if (fixtureDb) {
      fs.mkdirSync(path.dirname(fixtureDb), { recursive: true });
      execFileSync(process.execPath, [path.resolve(profile._dir, profile.capture.ios.fixtureBuild), fixtureDb], { stdio: ['ignore', 'inherit', 'inherit'] });
    }
    const deadline = Date.now() + (job.constraints?.maxRuntimeMinutes ?? 60) * 60_000;
    for (const g of groups) await runIosPlan(g.steps, console.log, { deadline });
    for (const device of job.devices) for (const locale of job.locales) for (const screen of job.screens) {
      const rel = captureRel(device, locale, screen);
      const f = path.join(out, rel);
      if (!fs.existsSync(f)) continue;
      const buf = fs.readFileSync(f);
      const info = readPngInfo(buf);
      result.captures.push({ device, locale, screen, file: rel, sha256: sha256(buf), width: info.width, height: info.height });
    }
    result.status = 'succeeded';
  } catch (e) {
    result.status = 'failed';
    result.error = String(e.message ?? e).split('\n')[0].slice(0, 300);
  } finally {
    for (const device of job.devices) sh('xcrun', ['simctl', 'shutdown', device]); // 起動したシミュレーターを止める（資源を返す）
  }
  result.finishedAt = new Date().toISOString();
  writeResult();
  console.log(`[job-run] ${result.status}：撮影 ${result.captures.length}枚 → ${path.join(out, 'result.json')}`);
  if (result.status !== 'succeeded') process.exitCode = 1;
  return result;
}

export function cmdJobDispatch(args) {
  const p = readJob(args.job);
  const { job } = p;
  if (job.target === 'github-actions-macos') {
    const a = githubDispatchArgs(job);
    console.log('[job-dispatch] GitHub Actions への依頼（workflow が既定branchに入っている時だけ使える。入れるのはHuman判断）：');
    console.log(`  gh ${a.slice(0, -2).join(' ')} -f job_json='<job.json の中身>'`);
    if (!args.execute) { console.log('[job-dispatch] 実行していない（--execute で実行）'); return; }
    if (!p.status) throw new Error('status.json がありません（job-create で作ったジョブだけ依頼できる）');
    const next = transition(p.status, 'dispatched', { note: 'gh workflow run' }); // 通らなければ依頼しない
    execFileSync('gh', a, { stdio: 'inherit' });
    saveStatus(p, next);
    console.log('[job-dispatch] 依頼した。`gh run list --workflow store-assets-ios.yml` で run id を確かめ、job-fetch で取得する');
    return;
  }
  console.log(`[job-dispatch] ${TARGETS[job.target].label}：人が開始する実行先。Macで次を行う（このPCからは開始しない）：`);
  console.log(`  1. repo を commit ${job.git.commit} にする（git fetch && git checkout ${job.git.commit}）。シミュレーター向けのアプリを用意する（npx expo run:ios --configuration Release 等。EAS Build は使わない）`);
  console.log(`  2. job.json をMacへ持って行く（手で写す。私的な置き場の自動の経路は未構築）`);
  console.log('  3. node tools/store-assets/engine/cli.mjs job-run --job <job.json> --app <アプリ.app>');
  if (job.target === 'mac-mini') console.log('     Mac mini では、保守窓であることを人が確かめた時だけ --confirm-maintenance-window を足す');
  console.log('  4. 結果のフォルダ（result.json と captures/）をこのPCへ持ち帰り、job-ingest --from で取り込む');
  if (args.execute) {
    if (!p.status) throw new Error('status.json がありません');
    saveStatus(p, transition(p.status, 'dispatched', { note: '人へ引き渡した' }));
    console.log('[job-dispatch] 状態を dispatched にした');
  }
}

export function cmdJobFetch(args) {
  const p = readJob(args.job);
  if (p.job.target !== 'github-actions-macos') throw new Error('job-fetch は GitHub Actions の実行先だけ');
  if (!args['run-id']) throw new Error('--run-id が必要です');
  const dest = path.join(p.dir, `result-run${String(args['run-id']).replace(/[^0-9]/g, '')}`); // 再実行の結果を混ぜない
  if (fs.existsSync(dest)) throw new Error(`${dest} は既にあります（同じ run の取り直しなら消してから）`);
  const a = githubDownloadArgs(p.job, args['run-id'], dest);
  console.log(`  gh ${a.join(' ')}`);
  if (!args.execute) { console.log('[job-fetch] 実行していない（--execute で実行）'); return; }
  execFileSync('gh', a, { stdio: 'inherit' });
  console.log(`[job-fetch] 取得：${dest}。次：job-ingest --job ${p.dir} --from ${dest}`);
}

export function cmdJobIngest(args) {
  const p = readJob(args.job);
  const { job } = p;
  const profile = profileFor(args, job);
  const jobProblems = validateJob(job, profile);
  if (jobProblems.length) throw new Error(`ジョブが不正です：\n- ${jobProblems.join('\n- ')}`);
  const st0 = p.status ?? newStatus(job);
  if (!['created', 'dispatched', 'running', 'succeeded'].includes(st0.state)) {
    throw new Error(`状態 ${st0.state} のジョブには取り込めない（失敗の後なら job-status --to dispatched で再実行にしてから）`);
  }
  const from = path.resolve(args.from ?? path.join(p.dir, 'result'));
  const rawText = fs.readFileSync(path.join(from, 'result.json'), 'utf8');
  const result = JSON.parse(rawText);
  const v = verifyResult(job, result, { readFile: (rel) => fs.readFileSync(path.join(from, rel)), hash: sha256, pngInfo: readPngInfo, rawText });
  const record = { at: new Date().toISOString(), from, ok: v.ok, problems: v.problems, missing: v.missing };
  fs.writeFileSync(path.join(p.dir, 'ingest.json'), JSON.stringify(record, null, 2));
  let status = st0;
  if (!v.ok) {
    for (const x of v.problems) console.log(`NG ${x}`);
    if (result?.status === 'failed' && st0.state !== 'succeeded') {
      if (status.state === 'created') status = transition(status, 'dispatched', { note: '依頼の記録なしで結果が届いた（人がMacで実行）' });
      status = transition(status, 'failed', { note: String(result.error ?? '実行の失敗').slice(0, 200) });
      saveStatus(p, status);
    }
    throw new Error(`取り込めません（問題 ${v.problems.length}件・${path.join(p.dir, 'ingest.json')}）`);
  }
  const device = args.device ?? job.devices[0];
  if (!job.devices.includes(device)) throw new Error(`--device ${device} はジョブに無い`);
  const runDir = path.resolve(args.run ?? defaultRunDir(profile));
  const existing = readCaptures(runDir);
  // 今の合成は画面×言語で1枚を選ぶので、別のデバイスの撮影がある run へは入れない（上書きを防ぐ）
  const other = existing.find((c) => c.source === 'ios-simulator' && c.device && c.device !== device);
  if (other) throw new Error(`この run には別のデバイス（${other.device}）の撮影がある。デバイスごとに別の run へ取り込む`);
  // Web版の撮影と同じ画像をシミュレーターとして取り込まない（同じアプリの全ての run の Web版の撮影と照らす）
  const webHashes = webPreviewHashes(path.dirname(runDir), existing);
  const mine = result.captures.filter((x) => x.device === device);
  const dup = mine.find((c) => webHashes.has(c.sha256));
  if (dup) throw new Error(`${dup.file} はWeb版プレビューの撮影と同じ画像です`);
  fs.mkdirSync(runDir, { recursive: true });
  const added = [];
  for (const c of mine) {
    const dest = path.join(runDir, 'captures', 'ios-simulator', slug(device), c.locale, `${c.screen}.png`);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(path.join(from, c.file), dest);
    const rt = result.env.devices.find((d) => d.name === device)?.runtime ?? null;
    added.push({ screen: c.screen, locale: c.locale, source: 'ios-simulator', file: dest, device, job: { id: job.id, purpose: job.purpose, commit: result.git.commit, runner: result.env.runner, macos: result.env.macos, xcode: result.env.xcode, runtime: rt, capturedAt: result.finishedAt } });
  }
  writeCaptures(runDir, added);
  const notes = sizeNotes(result.captures.filter((x) => x.device === device), profile.outputs?.store ?? []);
  if (status.state === 'created') status = transition(status, 'dispatched', { note: '依頼の記録なしで結果が届いた（人がMacで実行）' });
  if (status.state === 'dispatched' || status.state === 'running') status = transition(status, 'succeeded', { note: '結果を検証した' });
  if (status.state === 'succeeded') status = transition(status, 'ingested', { note: `${added.length}枚を ${runDir} へ（${device}）` });
  saveStatus(p, status);
  console.log(`[job-ingest] ${added.length}枚（${device}・ios-simulator）→ ${runDir}`);
  if (v.missing.length) console.warn(`[job-ingest] 撮れていない画面 ${v.missing.length}件（draft なので続行）`);
  for (const n of notes) if (!n.fitsTargets.length) console.log(`[job-ingest] 参考：${n.screen} ${n.width}x${n.height} はストアの寸法と違う（合成で整える）`);
  console.log(`[job-ingest] 次：compose --run ${runDir} --mode draft（finalはHumanの確認の後）`);
  return { runDir, added: added.length };
}

/** 同じアプリの run（親フォルダの下）と取り込み先の、Web版の撮影の sha256。 */
function webPreviewHashes(appOutDir, existing) {
  const set = new Set(existing.filter((c) => c.source === 'web-preview').map((c) => c.sha256));
  if (fs.existsSync(appOutDir)) {
    for (const name of fs.readdirSync(appOutDir)) {
      const f = path.join(appOutDir, name, 'captures.json');
      if (!fs.existsSync(f)) continue;
      try { for (const c of JSON.parse(fs.readFileSync(f, 'utf8'))) if (c.source === 'web-preview') set.add(c.sha256); } catch { /* 壊れた記録は無視 */ }
    }
  }
  return set;
}

export function cmdJobStatus(args) {
  const p = readJob(args.job);
  if (!p.status) throw new Error('status.json がありません');
  if (args.to) {
    const s = transition(p.status, args.to, { note: typeof args.note === 'string' ? args.note : '' });
    saveStatus(p, s);
    console.log(`[job-status] ${p.status.state} → ${s.state}（試行 ${s.attempt}）`);
    return s;
  }
  console.log(`${p.job.id}：${p.status.state}（試行 ${p.status.attempt}）`);
  for (const e of p.status.events) console.log(`  ${e.at} ${e.from ?? '-'} → ${e.to}${e.note ? `：${e.note}` : ''}`);
  return p.status;
}

export function cmdJobList(profile) {
  const root = jobsRoot(profile);
  const rows = [];
  if (fs.existsSync(root)) {
    for (const id of fs.readdirSync(root).sort()) {
      const f = path.join(root, id, 'job.json');
      if (!fs.existsSync(f)) continue;
      const job = JSON.parse(fs.readFileSync(f, 'utf8'));
      const sf = path.join(root, id, 'status.json');
      const st = fs.existsSync(sf) ? JSON.parse(fs.readFileSync(sf, 'utf8')) : { state: '不明', attempt: 0, events: [] };
      const ing = path.join(root, id, 'ingest.json');
      const ingest = fs.existsSync(ing) ? JSON.parse(fs.readFileSync(ing, 'utf8')) : null;
      rows.push({ id, target: job.target, purpose: job.purpose, commit: job.git.commit, devices: job.devices.join(', '), state: st.state, attempt: st.attempt, updated: st.events.at(-1)?.at ?? '', ingest: ingest ? (ingest.ok ? 'OK' : `NG ${ingest.problems.length}`) : '−' });
    }
  }
  for (const r of rows) console.log(`${r.state.padEnd(10)} ${r.id}  ${r.target}  ${r.devices}  試行${r.attempt}  取込${r.ingest}`);
  fs.mkdirSync(root, { recursive: true });
  const tr = rows.map((r) => `<tr><td>${escapeHtml(r.id)}</td><td>${escapeHtml(r.target)}</td><td>${escapeHtml(r.purpose)}</td><td>${escapeHtml(r.commit)}</td><td>${escapeHtml(r.devices)}</td><td><b>${escapeHtml(r.state)}</b></td><td>${r.attempt}</td><td>${escapeHtml(r.ingest)}</td><td>${escapeHtml(r.updated)}</td></tr>`).join('\n');
  fs.writeFileSync(path.join(root, 'index.html'), `<!doctype html><meta charset="utf-8"><title>${escapeHtml(profile.app.id)} 撮影ジョブ</title>
<style>body{font-family:system-ui,sans-serif;margin:24px}table{border-collapse:collapse}td,th{border:1px solid #ccc;padding:4px 8px;font-size:13px}</style>
<h1>${escapeHtml(profile.app.id)} 撮影ジョブ（${rows.length}件）</h1>
<p>撮影元は常に iOSシミュレーター。取り込んだ画像の確認と final の判断は人が行う（ストアへの提出はしない）。</p>
<table><tr><th>ジョブ</th><th>実行先</th><th>目的</th><th>commit</th><th>デバイス</th><th>状態</th><th>試行</th><th>取込</th><th>更新</th></tr>
${tr}</table>`);
  console.log(`[job-list] ${rows.length}件 → ${path.join(root, 'index.html')}`);
  return rows;
}
