#!/usr/bin/env node
// E-NEXUS共通 収益シミュレーション CLI。使い方は tools/revenue-sim/README.md。
//
//   node tools/revenue-sim/engine/cli.mjs check  --scenario <file.json>
//   node tools/revenue-sim/engine/cli.mjs run    --scenario <file.json> [--out <dir>] [--set path=value ...]
//
// 通信しない・有料APIを呼ばない。出力は --out（既定：シナリオと同じ場所）の <app>-revenue-<日付>.md／.json。
import fs from 'node:fs';
import path from 'node:path';

import { analyze } from './analyze.mjs';
import { toMarkdown } from './report.mjs';
import { loadScenario, validateScenario, withOverrides } from './scenario.mjs';

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const args = { _: command, set: {} };
  for (let i = 0; i < rest.length; i++) {
    const k = rest[i];
    if (!k.startsWith('--')) continue;
    const key = k.slice(2);
    const next = rest[i + 1];
    if (key === 'set') {
      const eq = next?.indexOf('=') ?? -1;
      if (eq < 1) throw new Error('--set は path=value の形');
      args.set[next.slice(0, eq)] = JSON.parse(next.slice(eq + 1));
      i++;
    } else if (next === undefined || next.startsWith('--')) args[key] = true;
    else { args[key] = next; i++; }
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args._ || args._ === 'help' || args.help) {
    console.log(fs.readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(1, 7).join('\n'));
    return;
  }
  if (!args.scenario) throw new Error('--scenario が必要です');
  if (args._ === 'check') {
    const problems = validateScenario(JSON.parse(fs.readFileSync(path.resolve(args.scenario), 'utf8')));
    for (const p of problems) console.log(`NG ${p}`);
    console.log(problems.length ? `問題 ${problems.length}件` : 'OK');
    process.exitCode = problems.length ? 1 : 0;
    return;
  }
  if (args._ !== 'run') throw new Error(`未知のコマンド: ${args._}`);
  const sc = loadScenario(args.scenario);
  if (Object.keys(args.set).length) sc.params = withOverrides(sc.params, args.set);
  const res = analyze(sc);
  res.overrides = args.set;
  const outDir = path.resolve(args.out ?? path.dirname(sc._file));
  fs.mkdirSync(outDir, { recursive: true });
  const base = path.join(outDir, `${sc.app.id}-revenue-${sc.asOf ?? new Date().toISOString().slice(0, 10)}`);
  fs.writeFileSync(`${base}.json`, JSON.stringify(res, null, 2));
  fs.writeFileSync(`${base}.md`, toMarkdown(res, sc));
  console.log(`[revenue-sim] ${base}.md`);
  console.log(`[revenue-sim] 注意 ${res.flags.length}件`);
}

try { main(); } catch (e) { console.error(e.message ?? e); process.exitCode = 1; }
