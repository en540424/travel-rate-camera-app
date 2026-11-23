// iOS撮影の手順の「起動の確認・撮影の安全ゲート」を、偽の xcrun / plutil で実際にシェルを走らせて確かめる。
// 2026-11-21 の3回目の実行：アプリが前面に無いまま撮影へ進み、ホーム画面を2枚撮った（取り込み側の同じ画像の検査で止まった）。
// ここでは「起動の後に落ちたら撮影しない」「撮影の前後に落ちたら採用しない」「ホーム画面と同じ画像は採用しない」
// 「診断が最後まで出て、決めた終了コードと理由で止まる」を、bash の有る環境（Git Bash・macOS）で確かめる。
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { IOS_EXIT, iosFailureReason, IPS_TOOL, parseInteracted, parseSkipped, parseVerification, planIosCapture, planToRunScript, planToShellScript } from './ios-simulator.mjs';
import { findReports, isForBundle, main as ipsMain, parseIps, summarizeIps } from './ips-summary.mjs';

const BID = 'com.example.app';
const HAS_BASH = !spawnSync('bash', ['-c', 'true']).error;

// 偽の xcrun（テスト用）。STUB_MODE：
//   alive（動き続ける）・dead（起動直後に終わる）・home（撮影が全部ホーム画面）・crash-on-open（URLを開くと落ちる）
//   sticky（terminate で止まらない）・flicker（ホーム画面が静止しない）・openurl-fail（URLを開く命令が終了コード22で失敗）
const XCRUN = String.raw`#!/bin/bash
case "$2" in
  launch)
    if [ "$STUB_MODE" = dead ]; then ( : ) & p=$!; wait "$p" 2>/dev/null; echo "$4: $p"; exit 0; fi
    sleep 30 >/dev/null 2>&1 &
    p=$!; echo "$p" >> "$STUB_DIR/pids"; echo "$4: $p"; exit 0;;
  terminate|openurl)
    echo "$2" >> "$STUB_DIR/calls"
    if [ "$2" = openurl ] && [ "$STUB_MODE" = openurl-fail ]; then exit 22; fi
    if [ "$2" = terminate ] && [ "$STUB_MODE" = sticky ]; then exit 0; fi
    if [ "$2" = terminate ] || [ "$STUB_MODE" = crash-on-open ]; then for p in $(cat "$STUB_DIR/pids" 2>/dev/null); do kill "$p" 2>/dev/null; done; fi
    exit 0;;
  io)
    f="${'$'}{!#}"
    echo "screenshot $f" >> "$STUB_DIR/calls"
    case "$f" in
      *home.png|*base-a.png)
        if [ "$STUB_MODE" = flicker ]; then printf "HOME-%s" "$RANDOM$RANDOM" > "$f"; else printf HOME > "$f"; fi;;
      *)
        n="$(basename "$f")"; n="${'$'}{n#verify-}"
        if [ "$STUB_MODE" = home ]; then printf HOME > "$f"; elif [ "$STUB_MODE" = verify-changed ]; then case "$f" in */verify-*) printf "LATER-%s" "$n" > "$f";; *) printf "SCREEN-%s" "$n" > "$f";; esac; else printf "SCREEN-%s" "$n" > "$f"; fi;;
    esac
    exit 0;;
  spawn) echo "stub-log $*"; exit 0;;
  get_app_container) echo "$STUB_DIR/data"; exit 0;;
  *) exit 0;;
esac
`;
const PLUTIL = `#!/bin/bash
echo "$STUB_PLIST_BID"
`;

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-ios-'));
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'xcrun'), XCRUN, { mode: 0o755 });
  fs.writeFileSync(path.join(bin, 'plutil'), PLUTIL, { mode: 0o755 });
  return { dir, bin, out: path.join(dir, 'out').replace(/\\/g, '/') };
}

const toPosix = (p) => p.replace(/\\/g, '/').replace(/^([A-Za-z]):/, (_, d) => `/${d.toLowerCase()}`);

function run(ctx, steps, mode, extraEnv = {}) {
  const reasonFile = path.join(ctx.dir, 'reason.txt');
  fs.rmSync(reasonFile, { force: true });
  // Windows では長い `bash -c` の引数がコマンドラインの変換で崩れることがあるため、ファイルで渡す（macOS の本番は -c のまま）
  const scriptFile = path.join(ctx.dir, 'run.sh');
  fs.writeFileSync(scriptFile, `export PATH="${toPosix(ctx.bin)}:$PATH"\n${planToRunScript(steps)}\n`);
  const r = spawnSync('bash', [toPosix(scriptFile)], {
    encoding: 'utf8',
    env: {
      ...process.env, STUB_MODE: mode, STUB_DIR: toPosix(ctx.dir), STUB_PLIST_BID: BID, HOME: ctx.dir,
      IOS_IPS_WAIT: '0', IOS_LATE_SECONDS: '0', IOS_STOP_WAIT: '2', IOS_IPS_TOOL: IPS_TOOL, IOS_REASON_FILE: toPosix(reasonFile),
      ...extraEnv,
    },
    timeout: 90_000,
  });
  spawnSync('bash', ['-c', `for p in $(cat "${toPosix(ctx.dir)}/pids" 2>/dev/null); do kill "$p" 2>/dev/null; done; true`]);
  const reason = fs.existsSync(reasonFile) ? fs.readFileSync(reasonFile, 'utf8') : null;
  return { status: r.status, text: `${r.stdout}\n${r.stderr}`, reason };
}

const screens = [{ id: 'history', deepLink: 'exampleapp:///history', settleMs: 1000 }, { id: 'calendar', deepLink: 'exampleapp:///calendar', settleMs: 1000 }];
const plan = (ctx, extra = {}) => planIosCapture({ device: 'D', bundleId: BID, scheme: 'exampleapp', outDir: ctx.out, screens, aliveSeconds: 1, ...extra });

test('撮影の安全ゲート：アプリが動き続ければ、試しの起動・本番の起動を通って全画面を撮る', { skip: !HAS_BASH }, () => {
  const ctx = setup();
  const r = run(ctx, plan(ctx), 'alive');
  assert.equal(r.status, 0, r.text);
  assert.ok(r.text.includes('試しの起動（テストデータを入れる前）：動いた'), r.text);
  assert.ok(r.text.includes('ホーム画面の基準を撮った（1回目で静止を確認）'), r.text);
  for (const s of screens) assert.equal(fs.readFileSync(path.join(ctx.out, `${s.id}.png`), 'utf8'), `SCREEN-${s.id}.png`);
  assert.ok(!r.text.includes('診断（ここから）'));
  assert.equal(r.reason, null);
});

test('撮影の安全ゲート：起動の直後に終わるアプリは撮影せず、診断を最後まで出して終了コード22で止まる（3回目の実行の回帰）', { skip: !HAS_BASH }, () => {
  const ctx = setup();
  const r = run(ctx, plan(ctx), 'dead');
  assert.equal(r.status, IOS_EXIT.notAliveAfterLaunch, r.text);
  assert.ok(r.text.includes('試しの起動（テストデータを入れる前）：失敗（コード 22・'), '試しの起動の失敗では止めない');
  assert.ok(r.text.includes('試しの起動＝失敗（コード 22・'), '本番の失敗の行に試しの起動の結果を併記');
  assert.match(r.reason, /^アプリ（pid \d+）が起動から約1秒で終了した（撮影しない）（試しの起動＝失敗（コード 22・/, '理由のファイル（result.json の error になる）');
  const begin = r.text.lastIndexOf('診断（ここから）');
  assert.ok(begin >= 0 && r.text.indexOf('診断（ここまで）', begin) > begin, '診断が途中で止まらない');
  assert.ok(r.text.includes('launchd の記録'));
  assert.ok(r.text.includes('このアプリのクラッシュの記録は無い'), 'クラッシュの記録の確認まで走る');
  assert.ok(fs.existsSync(path.join(ctx.out, '_diag-1.rejected.png')), '診断の時点の画面を採用しない名前で残す');
  assert.ok(!fs.existsSync(path.join(ctx.out, 'history.png')) && !fs.existsSync(path.join(ctx.out, 'calendar.png')), '撮影していない');
  const calls = fs.readFileSync(path.join(ctx.dir, 'calls'), 'utf8');
  assert.ok(!calls.includes('openurl'), '画面を開いていない');
});

test('撮影の安全ゲート：画面を開いた後にアプリが落ちたら、その画面を撮らずに終了コード23で止まる', { skip: !HAS_BASH }, () => {
  const ctx = setup();
  const r = run(ctx, plan(ctx), 'crash-on-open');
  assert.equal(r.status, IOS_EXIT.notAliveAtCapture, r.text);
  assert.match(r.reason, /画面 history の撮影の前にアプリ/);
  assert.ok(!fs.existsSync(path.join(ctx.out, 'history.png')));
});

test('撮影の安全ゲート：ホーム画面と同じ画像は採用せず（.rejected.png へ移す）、遅れてもう1枚撮って終了コード24で止まる', { skip: !HAS_BASH }, () => {
  const ctx = setup();
  const r = run(ctx, plan(ctx), 'home');
  assert.equal(r.status, IOS_EXIT.sameAsHome, r.text);
  assert.ok(!fs.existsSync(path.join(ctx.out, 'history.png')), '採用する名前では残さない');
  assert.ok(fs.existsSync(path.join(ctx.out, 'history.rejected.png')), '診断用に別名で残す');
  assert.ok(fs.existsSync(path.join(ctx.out, 'history.rejected-late.png')), '遅れてもう1枚撮る（背面・終了か、前面に出るのが遅れたかを絵で分ける）');
  assert.ok(r.text.includes('遅れての撮影もホーム画面'), r.text);
  assert.match(r.reason, /ホーム画面と同じ画像：.*・遅れての撮影もホーム画面/, 'result.json の error だけで背面・終了と遅れを読める');
});

test('撮影の安全ゲート：ビルドしたアプリに JS の本体が無い・Bundle ID が違えば、入れる前に終了コード20で止まる', { skip: !HAS_BASH }, () => {
  const ctx = setup();
  const app = path.join(ctx.dir, 'app.app');
  fs.mkdirSync(app);
  const appPath = app.replace(/\\/g, '/');
  let r = run(ctx, plan(ctx, { appPath }), 'alive');
  assert.equal(r.status, IOS_EXIT.appArtifact, r.text);
  assert.match(r.reason, /main\.jsbundle）が無い/);
  assert.ok(!r.text.includes('診断（ここから）'), '起動の前の失敗では診断を出さない');
  fs.writeFileSync(path.join(app, 'main.jsbundle'), 'x'.repeat(10));
  r = run(ctx, plan(ctx, { appPath }), 'alive', { STUB_PLIST_BID: 'com.other.app' });
  assert.equal(r.status, IOS_EXIT.appArtifact, r.text);
  assert.match(r.reason, /Bundle ID（com\.other\.app）がジョブ（com\.example\.app）と違う/);
  r = run(ctx, plan(ctx, { appPath }), 'alive');
  assert.equal(r.status, 0, r.text);
  assert.ok(r.text.includes('main.jsbundle：10 バイト'));
});

test('撮影の安全ゲート：試しの起動のアプリが止まらなければ、強制終了してからテストデータを差し替える', { skip: !HAS_BASH }, () => {
  const ctx = setup();
  const r = run(ctx, plan(ctx), 'sticky');
  assert.ok(r.text.includes('止まらないので強制終了する'), r.text);
  assert.equal(r.status, 0, r.text);
});

test('撮影の安全ゲート：ホーム画面の基準が静止しなければ、1画面のジョブは止め（26）、2画面以上は警告して続ける', { skip: !HAS_BASH }, () => {
  const ctx = setup();
  let r = run(ctx, plan(ctx, { screens: [screens[0]] }), 'flicker');
  assert.equal(r.status, IOS_EXIT.baselineUnstable, r.text);
  assert.match(r.reason, /静止しない/);
  r = run(ctx, plan(ctx), 'flicker');
  assert.equal(r.status, 0, r.text);
  assert.ok(r.text.includes('警告：ホーム画面の基準が静止しない'));
});

test('撮影の安全ゲート：URLを開く命令が失敗したら、理由を書いて診断を出し終了コード27で止まる（simctl の番号を理由に取り違えない）', { skip: !HAS_BASH }, () => {
  const ctx = setup();
  const r = run(ctx, plan(ctx), 'openurl-fail');
  assert.equal(r.status, IOS_EXIT.simctlCommand, r.text);
  assert.match(r.reason, /画面 history を開く命令が失敗した（simctl の終了コード 22）/);
  assert.ok(!fs.existsSync(path.join(ctx.out, 'history.png')));
});

test('撮影の手順：旧版の launchctl の確認（pipefail の下で動いていても失敗に見える）を使わず、ホストのプロセス番号で確かめる', () => {
  const steps = planIosCapture({ device: 'D', bundleId: BID, outDir: '/o', screens, appPath: '/x/app.app' });
  const all = steps.map((s) => s.cmd).join('\n');
  assert.ok(!all.includes('grep -q'));
  assert.ok(all.includes('kill -0'));
  assert.ok(all.includes('process == "app"'), 'アプリのプロセスのログも診断に入れる');
  assert.ok(all.includes("IOS_PID_RE='^com\\.example\\.app: *"), 'プロセス番号は Bundle ID の行からだけ読む');
  const idx = (p) => steps.findIndex((s) => s.cmd.startsWith(p));
  assert.ok(idx('ios_probe') < idx('ios_launch'), '試しの起動は本番の起動の前');
  assert.ok(idx('ios_baseline') < idx('ios_launch'));
  for (const s of screens) {
    const shot = steps.findIndex((x) => x.cmd.includes(`screenshot --type=png '/o/${s.id}.png'`));
    assert.equal(steps[shot - 1].cmd, `ios_require_alive '${s.id}'`);
    assert.equal(steps[shot + 1].cmd, `ios_verify_shot '/o/${s.id}.png'`);
  }
  assert.throws(() => planIosCapture({ device: 'D', bundleId: 'a"; rm -rf /', outDir: '/o', screens: [] }), /bundleId/);
  assert.throws(() => planIosCapture({ device: 'D', bundleId: BID, outDir: '/o', screens: [{ id: 'a"$(x)', deepLink: 'x:///' }] }), /画面 id/);
});

test('撮影の手順：試しの起動はテストデータの差し替えより前（動いているアプリの下で差し替えない）', () => {
  const steps = planIosCapture({ device: 'D', bundleId: BID, outDir: '/o', screens, fixtureDb: '/f.db', dbRelPath: 'Documents/SQLite/a.db' });
  const idx = (f) => steps.findIndex(f);
  const probe = idx((s) => s.cmd === 'ios_probe');
  const seed = idx((s) => s.cmd.includes('get_app_container'));
  const launch = idx((s) => s.cmd.startsWith('ios_launch'));
  assert.ok(probe >= 0 && probe < seed && seed < launch);
});

test('撮影の手順：変数の直後に全角文字を置かない（macOS の bash 3.2 は UTF-8 で全角の先頭バイトを変数名に含め、unbound variable で止まる）', () => {
  // 操作の画面・撮った後の確認の画面も含める（独立検収 R6：この検査が新しい手順を通っていなかった）
  const all = [...screens.map((s) => ({ ...s, expectVisible: ['x'] })), ...iScreens.slice(0, 1)];
  const steps = planIosCapture({ device: 'D', bundleId: BID, scheme: 'exampleapp', outDir: '/o', screens: all, appPath: '/x/app.app', fixtureDb: '/f.db', dbRelPath: 'Documents/SQLite/a.db', locale: 'ja-JP' });
  assert.ok(steps.some((s) => s.cmd.startsWith('ios_verify_screen')) && steps.some((s) => s.cmd.includes('ios_interact')));
  for (const script of [planToRunScript(steps), planToShellScript(steps)]) {
    const bad = script.match(/\$[A-Za-z_][A-Za-z0-9_]*(?=[^\x00-\x7F])/g);
    assert.equal(bad, null, `全角の直前の変数：${bad}`);
  }
  assert.ok(!planToRunScript(steps).includes('ips-summary.mjs'), '生成したスクリプトに機械のパスを書かない（実行時に IOS_IPS_TOOL で渡す）');
});

test('撮影の失敗の理由：シェルが書いた理由だけを使い、番号から推測しない（result.json の error に残る1行目）', () => {
  assert.equal(iosFailureReason({ status: 22 }, 'アプリが終了した\n2行目'), 'アプリが終了した（終了コード 22）');
  // 理由が書かれていなければ、番号から推測しない（simctl 自身が22・24等で終わることがある）
  assert.match(iosFailureReason({ status: 22 }), /手順が失敗した（終了コード 22。直前の/);
  assert.match(iosFailureReason({ code: 'ETIMEDOUT', signal: 'SIGTERM', status: null }), /時間の上限/);
  assert.match(iosFailureReason({ code: 'ETIMEDOUT', signal: 'SIGTERM', status: null }, '診断の途中'), /診断の途中（終了コード \?・時間の上限）/);
});

function ips(header, body) {
  return `${JSON.stringify(header)}\n${JSON.stringify(body, null, 2)}`;
}

test('クラッシュの記録：このアプリの・印より新しい .ips だけを読み、JSの例外の理由（asi）と呼び出し元を出す', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-ips-'));
  const mark = path.join(dir, 'mark');
  const old = path.join(dir, 'app-2026-11-21-000000.ips');
  fs.writeFileSync(old, ips({ bundleID: BID, bug_type: '309' }, { procName: 'app', asi: { CoreFoundation: ['古い記録'] } }));
  const past = new Date(Date.now() - 60_000);
  fs.utimesSync(old, past, past);
  fs.writeFileSync(mark, '');
  fs.writeFileSync(path.join(dir, 'SpringBoard-2026-11-21-000001.ips'), ips({ bundleID: 'com.apple.springboard', bug_type: '309' }, { procName: 'SpringBoard' }));
  fs.writeFileSync(path.join(dir, 'app-2026-11-21-000002.ips'), ips(
    { bundleID: BID, bug_type: '309', app_name: 'app' },
    {
      procName: 'app', captureTime: '2026-11-21 07:44:40',
      exception: { type: 'EXC_CRASH', signal: 'SIGABRT' },
      termination: { namespace: 'SIGNAL', code: 6, indicator: 'Abort trap: 6' },
      asi: { CoreFoundation: ["*** Terminating app due to uncaught exception 'RCTFatalException: Unhandled JS Exception: Error: x'"] },
      usedImages: [{ name: 'CoreFoundation' }, { name: 'app' }],
      lastExceptionBacktrace: [{ imageIndex: 0, symbol: '__exceptionPreprocess', symbolLocation: 10 }, { imageIndex: 1, symbol: 'RCTFatal', symbolLocation: 4 }],
      faultingThread: 0,
      threads: [{ name: 'main', frames: [{ imageIndex: 1, imageOffset: 255 }] }],
    },
  ));
  fs.writeFileSync(path.join(dir, 'broken.ips'), 'not json');
  const logs = [];
  const found = ipsMain(['--dir', dir, '--since', mark, '--bundle-id', BID, '--wait-seconds', '0'], (l) => logs.push(l));
  assert.equal(found.mine.length, 1, '古い記録・他のプロセス・壊れた記録は数えない');
  const text = logs.join('\n');
  assert.ok(text.includes('Unhandled JS Exception: Error: x'), text);
  assert.ok(text.includes('Abort trap: 6'));
  assert.ok(text.includes('#1 app RCTFatal+4'));
  assert.ok(text.includes('#0 app 0xff'));
  assert.ok(text.includes('SpringBoard'));
  assert.ok(!text.includes('古い記録'));

  const none = [];
  ipsMain(['--dir', path.join(dir, 'missing'), '--bundle-id', BID, '--wait-seconds', '0'], (l) => none.push(l));
  assert.ok(none[0].includes('クラッシュの記録は無い'));
  assert.equal(parseIps('{}'), null);
  assert.equal(isForBundle(parseIps(ips({}, { bundleInfo: { CFBundleIdentifier: BID } })), BID), true);
  assert.ok(summarizeIps({ header: {}, body: { asi: { x: ['y'.repeat(1000)] } } }).some((l) => l.endsWith('…')), '長い文は切る');
  // 2026-11-23 の4回目：dyld の理由が長く、まとめて切ると「どのバイナリが参照したか」が落ちた
  const dyld = summarizeIps({ header: {}, body: { termination: {
    namespace: 'DYLD', code: 4, indicator: 'Symbol missing',
    reasons: [`Symbol not found: _$s15ExpoModulesCore6Record${'x'.repeat(300)}`, `Referenced from: <UUID> /Users/USER/${'d/'.repeat(120)}app.app/Frameworks/ExpoLocation.framework/ExpoLocation`, 'Expected in: <UUID> /Users/USER/app.app/Frameworks/ExpoModulesCore.framework/ExpoModulesCore'],
  } } });
  assert.ok(dyld.some((l) => l.includes('Symbol missing')), dyld.join('\n'));
  assert.ok(dyld.some((l) => l.startsWith('    ・Referenced from')), '理由は1件ずつ出す');
  assert.ok(dyld.some((l) => l.includes('Expected in') && l.includes('ExpoModulesCore')), '後ろの理由も落とさない');
  assert.deepEqual(findReports(path.join(dir, 'missing'), 0, BID), { mine: [], others: [] });
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---- 操作が要る画面（interact）を偽の maestro で実際に走らせる（独立検収のテストの不足：文字列の検査だけだった）。
// MAESTRO_STUB：ok（通る）・fail（確認が通らない＝終了コード1）・kill（操作の途中でアプリを落とす）
const MAESTRO = String.raw`#!/bin/bash
echo "maestro $*" >> "$STUB_DIR/calls"
if [ "$1" = --version ]; then echo 2.12.1; exit 0; fi
case "$*" in *flow-warmup*) exit 0;; esac
if [ "$MAESTRO_STUB" = kill ]; then for p in $(cat "$STUB_DIR/pids" 2>/dev/null); do kill "$p" 2>/dev/null; done; exit 1; fi
if [ "$MAESTRO_STUB" = fail ]; then exit 1; fi
exit 0
`;
const iScreens = [
  { id: 'converter', deepLink: 'exampleapp:///converter', settleMs: 1000, interact: { driver: 'maestro', steps: [{ inputText: '89' }], expectVisible: ['¥14,685'] } },
  { id: 'history', deepLink: 'exampleapp:///history', settleMs: 1000 },
];
function runInteract(mode, { stale = false } = {}) {
  const ctx = setup();
  fs.writeFileSync(path.join(ctx.bin, 'maestro'), MAESTRO, { mode: 0o755 });
  fs.mkdirSync(ctx.out, { recursive: true });
  if (stale) fs.writeFileSync(path.join(ctx.out, 'converter.png'), 'STALE-from-earlier-attempt');
  const skip = path.join(ctx.dir, 'skipped.tsv');
  const done = path.join(ctx.dir, 'interacted.txt');
  const steps = planIosCapture({ device: 'D', bundleId: BID, scheme: 'exampleapp', outDir: ctx.out, screens: iScreens, aliveSeconds: 1 });
  const r = run(ctx, steps, 'alive', { MAESTRO_STUB: mode, IOS_SKIP_FILE: toPosix(skip), IOS_DONE_FILE: toPosix(done) });
  const read = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '');
  return { ...r, ctx, skipped: parseSkipped(read(skip)), done: parseInteracted(read(done)) };
}

test('操作が要る画面：操作と表示の確認が通れば撮り、印を残す。操作の無い画面を先に撮る', { skip: !HAS_BASH }, () => {
  const r = runInteract('ok');
  assert.equal(r.status, 0, r.text);
  assert.deepEqual(r.done, ['converter']);
  assert.deepEqual(r.skipped, []);
  assert.equal(fs.readFileSync(path.join(r.ctx.out, 'converter.png'), 'utf8'), 'SCREEN-converter.png');
  const calls = fs.readFileSync(path.join(r.ctx.dir, 'calls'), 'utf8');
  assert.ok(calls.indexOf('screenshot ' + r.ctx.out + '/history.png') < calls.indexOf('screenshot ' + r.ctx.out + '/converter.png'), '操作の無い画面が先');
  assert.ok(/maestro --device D test .*flow-converter\.yaml/.test(calls), '端末を指定して流す');
});

test('操作が要る画面：確認が通らなければその画面だけ撮らず、理由を残して他の画面は撮り終える（前の試行の画像も残さない）', { skip: !HAS_BASH }, () => {
  const r = runInteract('fail', { stale: true });
  assert.equal(r.status, 0, r.text);
  assert.deepEqual(r.done, [], '印は書かない');
  assert.equal(r.skipped.length, 1);
  assert.equal(r.skipped[0].screen, 'converter');
  assert.match(r.skipped[0].reason, /操作・表示の確認が通らない/);
  assert.ok(!fs.existsSync(path.join(r.ctx.out, 'converter.png')), '前の試行の画像を撮影として残さない（独立検収 S1）');
  assert.ok(fs.existsSync(path.join(r.ctx.out, 'history.png')), '他の画面は撮れている');
});

test('操作が要る画面：操作の途中でアプリが落ちたら、撮らずに診断を出し、落ちたことを理由に残す（致命にはしない）', { skip: !HAS_BASH }, () => {
  const r = runInteract('kill');
  assert.equal(r.status, 0, r.text);
  assert.deepEqual(r.done, []);
  assert.match(r.skipped[0]?.reason ?? '', /アプリ.*動いていない/);
  assert.ok(r.text.includes('診断（ここから）'), '道具の失敗と取り違えないよう診断を出す（独立検収 S3）');
  assert.ok(!fs.existsSync(path.join(r.ctx.out, 'converter.png')));
});

const HAS_MAESTRO = HAS_BASH && spawnSync('bash', ['-c', 'command -v maestro']).status === 0;
test('操作が要る画面：maestro が無ければ準備で飛ばす', { skip: !HAS_BASH || HAS_MAESTRO }, () => {
  const ctx = setup();
  const skip = path.join(ctx.dir, 'skipped.tsv');
  const steps = planIosCapture({ device: 'D', bundleId: BID, outDir: ctx.out, screens: iScreens, aliveSeconds: 1 });
  const r = run(ctx, steps, 'alive', { IOS_SKIP_FILE: toPosix(skip) });
  assert.equal(r.status, 0, r.text);
  assert.match(fs.readFileSync(skip, 'utf8'), /converter	操作の道具（maestro）が入っていない/);
  assert.ok(fs.existsSync(path.join(ctx.out, 'history.png')));
});

test('ホーム画面の基準が静止しない時の判断は、操作の要る画面を数えない（独立検収 S2）', () => {
  const steps = planIosCapture({ device: 'D', bundleId: BID, outDir: './o', screens: iScreens });
  assert.ok(steps[0].cmd.includes('IOS_SCREEN_COUNT=1'), '履歴だけ＝1画面として扱い、静止しなければ止める');
});

// ---- 撮った後の内容の確認（ディープリンクの画面。致命にしない）
const MAESTRO_V = String.raw`#!/bin/bash
echo "maestro $*" >> "$STUB_DIR/calls"
case "$*" in *flow-warmup*) exit 0;; esac
case "$*" in *verify-calendar*) if [ "$MAESTRO_STUB" = calendar-empty ]; then echo "Assertion is false: \".*¥20,361.*\" is visible"; exit 1; fi;; esac
case "$*" in *verify-*) if [ "$MAESTRO_STUB" = driver-error ]; then echo "Failed to connect to iOS driver"; exit 1; fi;; esac
exit 0
`;
const MAESTRO_WARMUP_FAIL = String.raw`#!/bin/bash
echo "maestro $*" >> "$STUB_DIR/calls"
exit 1
`;
test('撮った後の内容の確認：撮り終えた後に開き直して確かめ、表示が無い画面は fail として記録する（撮影は失わない）', { skip: !HAS_BASH }, () => {
  const ctx = setup();
  fs.writeFileSync(path.join(ctx.bin, 'maestro'), MAESTRO_V, { mode: 0o755 });
  const vf = path.join(ctx.dir, 'verify.tsv');
  const vScreens = [
    { id: 'history', deepLink: 'exampleapp:///history', settleMs: 1000, expectVisible: ['マカロン'] },
    { id: 'calendar', deepLink: 'exampleapp:///calendar', settleMs: 1000, expectVisible: ['¥20,361'] },
  ];
  const steps = planIosCapture({ device: 'D', bundleId: BID, outDir: ctx.out, screens: vScreens, aliveSeconds: 1 });
  const r = run(ctx, steps, 'alive', { MAESTRO_STUB: 'calendar-empty', IOS_VERIFY_FILE: toPosix(vf) });
  assert.equal(r.status, 0, r.text);
  const v = parseVerification(fs.readFileSync(vf, 'utf8'));
  assert.deepEqual(v.map((x) => [x.screen, x.status]), [['history', 'ok'], ['calendar', 'fail']]);
  assert.ok(fs.existsSync(path.join(ctx.out, 'calendar.png')), '撮影は残す（合成が verified:false を外す）');
  const calls = fs.readFileSync(path.join(ctx.dir, 'calls'), 'utf8');
  assert.ok(calls.lastIndexOf(`screenshot ${ctx.out}/calendar.png`) < calls.indexOf('verify-history'), '確認は全ての撮影の後');
  assert.ok(steps.some((s) => s.cmd.includes('- assertVisible: ".*¥20,361.*"')), '含むで照合');
});

test('撮った後の内容の確認：道具が無ければ unavailable（撮影はそのまま使える）', { skip: !HAS_BASH || HAS_MAESTRO }, () => {
  const ctx = setup();
  const vf = path.join(ctx.dir, 'verify.tsv');
  const steps = planIosCapture({ device: 'D', bundleId: BID, outDir: ctx.out, screens: [{ id: 'history', deepLink: 'exampleapp:///history', settleMs: 1000, expectVisible: ['x'] }, { id: 'calendar', deepLink: 'exampleapp:///calendar', settleMs: 1000 }], aliveSeconds: 1 });
  const r = run(ctx, steps, 'alive', { IOS_VERIFY_FILE: toPosix(vf) });
  assert.equal(r.status, 0, r.text);
  assert.deepEqual(parseVerification(fs.readFileSync(vf, 'utf8')).map((x) => x.status), ['unavailable']);
});

function runVerify(maestroScript, stubMode, mode = 'alive', screensList = null) {
  const ctx = setup();
  fs.writeFileSync(path.join(ctx.bin, 'maestro'), maestroScript, { mode: 0o755 });
  const vf = path.join(ctx.dir, 'verify.tsv');
  const sk = path.join(ctx.dir, 'skipped.tsv');
  const list = screensList ?? [
    { id: 'history', deepLink: 'exampleapp:///history', settleMs: 1000, expectVisible: ['マカロン'] },
    { id: 'calendar', deepLink: 'exampleapp:///calendar', settleMs: 1000, expectVisible: ['¥20,361'] },
  ];
  const steps = planIosCapture({ device: 'D', bundleId: BID, outDir: ctx.out, screens: list, aliveSeconds: 1 });
  const r = run(ctx, steps, mode, { MAESTRO_STUB: stubMode, IOS_VERIFY_FILE: toPosix(vf), IOS_SKIP_FILE: toPosix(sk) });
  const read = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '');
  return { ...r, ctx, verification: parseVerification(read(vf)), skipped: parseSkipped(read(sk)), calls: read(path.join(ctx.dir, 'calls')) };
}

test('内容の確認（独立検収 R2）：道具の接続の失敗は unavailable（撮影を外さない）。表示の確認が通らない時だけ fail', { skip: !HAS_BASH }, () => {
  const r = runVerify(MAESTRO_V, 'driver-error');
  assert.equal(r.status, 0, r.text);
  assert.deepEqual(r.verification.map((x) => x.status), ['unavailable', 'unavailable']);
});

test('内容の確認（独立検収 R3）：確認の時の画面が撮影と違えば ok にしない（読み込み途中を撮った等）', { skip: !HAS_BASH }, () => {
  const r = runVerify(MAESTRO_V, 'ok', 'verify-changed');
  assert.equal(r.status, 0, r.text);
  assert.deepEqual(r.verification.map((x) => x.status), ['unavailable', 'unavailable']);
  assert.match(r.verification[0].reason, /撮影と違う/);
});

test('道具の準備（独立検収 R1）：一度失敗したら同じ実行の中で試し直さない（画面ごとに待つと上限に達し、撮れた画面まで失う）', { skip: !HAS_BASH }, () => {
  const r = runVerify(MAESTRO_WARMUP_FAIL, 'x', 'alive', [...iScreens, { id: 'calendar', deepLink: 'exampleapp:///calendar', settleMs: 1000, expectVisible: ['a'] }, { id: 'trips', deepLink: 'exampleapp:///trips', settleMs: 1000, expectVisible: ['b'] }]);
  assert.equal(r.status, 0, r.text);
  assert.equal((r.calls.match(/flow-warmup/g) ?? []).length, 1, r.calls);
  assert.deepEqual(r.verification.map((x) => x.status), ['unavailable', 'unavailable']);
  assert.equal(r.skipped[0]?.screen, 'converter');
});
