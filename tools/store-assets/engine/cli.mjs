#!/usr/bin/env node
// E-NEXUS共通 ストア・広告素材生成 CLI。使い方は tools/store-assets/README.md。
//
//   node tools/store-assets/engine/cli.mjs all       --profile <profile.json> [--build] [--mode draft|final]
//   node tools/store-assets/engine/cli.mjs capture-web --profile <p> --run <dir> [--export <dir>] [--build]
//   node tools/store-assets/engine/cli.mjs plan-ios  --profile <p> --run <dir> [--device <name>] [--locale ja]
//   node tools/store-assets/engine/cli.mjs import    --profile <p> --run <dir> --from <dir> --source device|ios-simulator [--locale ja]
//   node tools/store-assets/engine/cli.mjs compose   --profile <p> --run <dir> [--mode draft|final]
//   node tools/store-assets/engine/cli.mjs validate  --run <dir>
//   node tools/store-assets/engine/cli.mjs job-create|job-validate|job-run|job-dispatch|job-fetch|job-ingest|job-status|job-list …（遠隔撮影。job-commands.mjs）
//
// 外部への送信・アップロードはしない（ストア・LPへの反映は人が行う）。例外は job-dispatch／job-fetch に --execute を付けた時の
// GitHub Actions への依頼と成果物の取得だけ（gh を使う。付けなければ内容を表示するだけ）。
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { captureWeb, exportWeb } from './drivers/web-preview.mjs';
import { planIosCapture, planToShellScript } from './drivers/ios-simulator.mjs';
import { completenessProblems, excludeDraftJobCaptures, galleryHtml, planOutputs, renderPlan, sha256, validateOutputs, verifyCaptures } from './pipeline.mjs';
import { defaultRunDir, gitInfo, projectRootOf, readCaptures, writeCaptures } from './runs.mjs';
import { cmdJobCreate, cmdJobDispatch, cmdJobFetch, cmdJobIngest, cmdJobList, cmdJobRun, cmdJobStatus, cmdJobValidate } from './job-commands.mjs';
import { loadProfile } from './profile.mjs';
import { SOURCES } from './provenance.mjs';

const ENGINE_DIR = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const args = { _: command };
  for (let i = 0; i < rest.length; i++) {
    const k = rest[i];
    if (!k.startsWith('--')) continue;
    const key = k.slice(2);
    const next = rest[i + 1];
    if (next === undefined || next.startsWith('--')) args[key] = true;
    else { args[key] = next; i++; }
  }
  return args;
}

function loadPlaywright(projectRoot) {
  for (const base of [path.join(projectRoot, 'package.json'), path.join(ENGINE_DIR, 'cli.mjs')]) {
    try { return createRequire(base)('playwright'); } catch { /* 次の候補 */ }
  }
  throw new Error('playwright が見つかりません（アプリのdevDependenciesに入れるか、エンジンと同じ場所へ入れてください）');
}

async function cmdCaptureWeb(profile, args, runDir) {
  const root = projectRootOf(profile);
  const web = profile.capture.web ?? {};
  let exportDir = args.export ? path.resolve(args.export) : path.join(runDir, '_web-export');
  if (args.build || !fs.existsSync(path.join(exportDir, 'index.html'))) exportWeb(root, exportDir);
  const records = await captureWeb({
    playwright: loadPlaywright(root),
    exportDir,
    viewport: web.viewport ?? { width: 440, height: 956, scale: 3 },
    clock: profile.capture.clock,
    timezone: profile.capture.timezone ?? 'Asia/Tokyo',
    locales: args.locale ? [args.locale] : profile.locales,
    localeTags: profile.localeTags,
    screens: profile.capture.screens.filter((s) => s.route && (s.web?.enabled ?? true)),
    outDir: path.join(runDir, 'captures', 'web-preview'),
  });
  for (const r of records) if (r.pageErrors.length) console.warn(`[web-preview] ${r.screen}: ページのエラー ${r.pageErrors.join(' / ')}`);
  writeCaptures(runDir, records);
  console.log(`[capture-web] ${records.length}枚 → ${path.join(runDir, 'captures', 'web-preview')}`);
}

function cmdPlanIos(profile, args, runDir) {
  const ios = profile.capture.ios ?? {};
  const devices = args.device ? [args.device] : (ios.devices ?? []);
  if (!devices.length) throw new Error('capture.ios.devices が空です');
  // テストデータDBはrunディレクトリへ置き、手順からは相対パスで参照する（runディレクトリごとMacへ持って行けるように）
  let fixtureRel = null;
  if (ios.fixtureBuild) {
    const dbName = path.basename(ios.dbRelPath ?? 'app.db');
    const dest = path.join(runDir, 'fixture', dbName);
    if (!fs.existsSync(dest)) {
      execFileSync(process.execPath, [path.resolve(profile._dir, ios.fixtureBuild), dest], { stdio: ['ignore', 'inherit', 'inherit'] });
    }
    fixtureRel = `./fixture/${dbName}`;
  }
  for (const device of devices) {
    for (const locale of args.locale ? [args.locale] : profile.locales) {
      const outDir = `./captures/ios-simulator/${device.replace(/[^a-z0-9]+/gi, '-')}/${locale}`;
      const steps = planIosCapture({
        device, bundleId: profile.app.bundleId, locale: profile.localeTags?.[locale] ?? locale, outDir,
        screens: profile.capture.screens.filter((s) => s.deepLink),
        statusBar: ios.statusBar, appearance: ios.appearance,
        fixtureDb: fixtureRel, dbRelPath: ios.dbRelPath,
      });
      const file = path.join(runDir, `ios-capture_${device.replace(/[^a-z0-9]+/gi, '-')}_${locale}.sh`);
      const header = `# 実行：Macで run ディレクトリへ移動して bash ${path.basename(file)}\n# 撮影後：cli.mjs import --from ${outDir} --source ios-simulator --locale ${locale}`;
      fs.writeFileSync(file, planToShellScript(steps, header));
      console.log(`[plan-ios] ${file}`);
    }
  }
}

function cmdImport(profile, args, runDir) {
  const source = args.source;
  if (!SOURCES[source] || source === 'web-preview') throw new Error('--source は device / ios-simulator / android-emulator');
  const from = path.resolve(args.from);
  const locale = args.locale ?? profile.locales[0];
  const screenIds = new Set(profile.capture.screens.map((s) => s.id));
  const dest = path.join(runDir, 'captures', source, locale);
  fs.mkdirSync(dest, { recursive: true });
  // Web版プレビューの画像を実機・シミュレーターとして取り込み直すことを防ぐ（同じ内容のものを拒否）
  const webHashes = new Set(readCaptures(runDir).filter((c) => c.source === 'web-preview').map((c) => c.sha256));
  const added = [];
  for (const name of fs.readdirSync(from)) {
    const id = path.basename(name, path.extname(name));
    if (path.extname(name).toLowerCase() !== '.png' || !screenIds.has(id)) continue;
    if (webHashes.has(sha256(fs.readFileSync(path.join(from, name))))) {
      throw new Error(`${name} はWeb版プレビューの撮影と同じ画像です。${source}として取り込めません`);
    }
    const file = path.join(dest, name);
    fs.copyFileSync(path.join(from, name), file);
    added.push({ screen: id, locale, source, file, importedFrom: path.join(from, name) });
  }
  if (!added.length) throw new Error(`取り込める画像がありません（ファイル名を画面ID.pngにする：${[...screenIds].join(', ')}）`);
  writeCaptures(runDir, added);
  console.log(`[import] ${added.length}枚（${source}・${locale}）`);
}

async function cmdCompose(profile, args, runDir) {
  const mode = args.mode === 'final' ? 'final' : 'draft';
  const verified = excludeDraftJobCaptures(mode, verifyCaptures(readCaptures(runDir).map((c) => ({ ...c, file: path.join(runDir, c.file) }))));
  for (const r of verified.rejected) console.warn(`[compose] 使わない撮影：${r.screen} ${r.locale} ${r.source}（${r.reason}）`);
  const plan = planOutputs(profile, verified.ok, { mode, locales: args.locale ? [args.locale] : undefined });
  const root = projectRootOf(profile);
  const outputs = await renderPlan(profile, plan, runDir, loadPlaywright(root));
  const manifest = {
    app: { id: profile.app.id, profile: path.relative(root, profile._file) },
    generatedAt: new Date().toISOString(), mode, git: gitInfo(root), storeTargets: profile.outputs?.store ?? [],
    captures: readCaptures(runDir), outputs, skipped: plan.skipped,
  };
  manifest.rejectedCaptures = verified.rejected;
  manifest.validation = validateOutputs(runDir, outputs);
  const incomplete = completenessProblems(mode, manifest.storeTargets, plan.skipped, outputs);
  if (incomplete.length) manifest.validation = { ok: false, problems: [...manifest.validation.problems, ...incomplete] };
  fs.writeFileSync(path.join(runDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  fs.writeFileSync(path.join(runDir, 'index.html'), galleryHtml(manifest));
  console.log(`[compose] 出力 ${outputs.length}枚・作らなかったもの ${plan.skipped.length}件・検証 ${manifest.validation.ok ? 'OK' : `問題${manifest.validation.problems.length}件`}`);
  console.log(`[compose] 一覧：${path.join(runDir, 'index.html')}`);
  if (mode === 'final' && !manifest.validation.ok) process.exitCode = 1;
  return manifest;
}

function cmdValidate(runDir) {
  const manifest = JSON.parse(fs.readFileSync(path.join(runDir, 'manifest.json'), 'utf8'));
  const base = validateOutputs(runDir, manifest.outputs);
  const incomplete = completenessProblems(manifest.mode, manifest.storeTargets ?? [], manifest.skipped ?? [], manifest.outputs);
  const v = { ok: base.ok && incomplete.length === 0, problems: [...base.problems, ...incomplete] };
  for (const p of v.problems) console.log(`NG ${p}`);
  console.log(v.ok ? 'OK' : `問題 ${v.problems.length}件`);
  return v.ok;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args._ || args._ === 'help' || args.help) {
    console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 12).join('\n'));
    return;
  }
  if (args._ === 'validate') { process.exitCode = cmdValidate(path.resolve(args.run)) ? 0 : 1; return; }
  // 遠隔撮影のジョブ（使い方は job-commands.mjs の冒頭）
  const needJob = { 'job-validate': cmdJobValidate, 'job-run': cmdJobRun, 'job-dispatch': cmdJobDispatch, 'job-fetch': cmdJobFetch, 'job-ingest': cmdJobIngest, 'job-status': cmdJobStatus };
  if (needJob[args._]) {
    if (!args.job) throw new Error('--job が必要です');
    const r = await needJob[args._](args);
    if (args._ === 'job-validate' && r === false) process.exitCode = 1;
    return;
  }
  if (args._ === 'job-create' || args._ === 'job-list') {
    if (!args.profile) throw new Error('--profile が必要です');
    const profile = loadProfile(args.profile);
    if (args._ === 'job-create') { if (!args.target) throw new Error('--target が必要です'); cmdJobCreate(profile, args); } else cmdJobList(profile);
    return;
  }
  if (!args.profile) throw new Error('--profile が必要です');
  const profile = loadProfile(args.profile);
  const runDir = path.resolve(args.run ?? defaultRunDir(profile));
  fs.mkdirSync(runDir, { recursive: true });
  switch (args._) {
    case 'capture-web': await cmdCaptureWeb(profile, args, runDir); break;
    case 'plan-ios': cmdPlanIos(profile, args, runDir); break;
    case 'import': cmdImport(profile, args, runDir); break;
    case 'compose': await cmdCompose(profile, args, runDir); break;
    case 'all': {
      await cmdCaptureWeb(profile, args, runDir);
      cmdPlanIos(profile, args, runDir);
      const m = await cmdCompose(profile, args, runDir);
      if (args.mode === 'final' && !m.validation.ok) process.exitCode = 1;
      break;
    }
    default: throw new Error(`未知のコマンド: ${args._}`);
  }
}

main().catch((e) => { console.error(e.message ?? e); process.exitCode = 1; });
