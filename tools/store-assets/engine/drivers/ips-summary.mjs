// iOSシミュレーターの撮影で、アプリが起動の後に終了した時の診断：クラッシュの記録（.ips）から要点だけを出す。
//
//   node ips-summary.mjs --dir <DiagnosticReports> --since <印のファイル> --bundle-id <id> [--wait-seconds 20]
//
// - 印のファイル（起動の直前に touch する）より新しく、このアプリ（bundleID）の .ips だけを見る。
//   7d3bd37 の版は「一番新しい .ips」を見ていたため、シミュレーターの他のプロセスの記録を拾うおそれがあった
// - .ips は「1行目＝見出しのJSON」「2行目以降＝本体のJSON」。キーだけの grep では、例外の理由
//   （例：React Native の "Unhandled JS Exception: …"）が入れ子の値にあって出ないため、JSONとして読む
// - 出すのは要点（例外・終了の理由・asi・落ちたスレッドの上位の関数）だけ。全文は出さない（公開repoのログになるため）
// - 記録は終了から数秒遅れて書かれるため、wait-seconds まで待つ。無ければ「無い」と出す（＝クラッシュではなく
//   終了・強制終了の可能性。runningboardd のログの行と合わせて判断する）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MAX_TEXT = 400;
const MAX_FRAMES = 15;

function clip(s) {
  const t = String(s);
  return t.length > MAX_TEXT ? `${t.slice(0, MAX_TEXT)}…` : t;
}

/** .ips の文字列を見出しと本体に分ける。読めなければ null。 */
export function parseIps(text) {
  const nl = text.indexOf('\n');
  if (nl < 0) return null;
  try {
    const header = JSON.parse(text.slice(0, nl));
    const body = JSON.parse(text.slice(nl + 1));
    return { header, body };
  } catch {
    return null;
  }
}

/** このアプリの記録か（見出しの bundleID・本体の bundleInfo のどちらか）。 */
export function isForBundle(ips, bundleId) {
  if (!ips) return false;
  return ips.header?.bundleID === bundleId || ips.body?.bundleInfo?.CFBundleIdentifier === bundleId;
}

function frameLines(frames, images) {
  return (frames ?? []).slice(0, MAX_FRAMES).map((f, i) => {
    const img = images?.[f.imageIndex]?.name ?? '?';
    const sym = f.symbol ? `${f.symbol}+${f.symbolLocation ?? 0}` : `0x${Number(f.imageOffset ?? 0).toString(16)}`;
    return `    #${i} ${img} ${sym}`;
  });
}

/** 要点の行を作る（純粋関数）。 */
export function summarizeIps(ips) {
  const { header = {}, body = {} } = ips;
  const lines = [];
  lines.push(`  プロセス：${body.procName ?? header.app_name ?? '?'}（${header.bundleID ?? body.bundleInfo?.CFBundleIdentifier ?? '?'}）・種類 ${header.bug_type ?? '?'}・時刻 ${body.captureTime ?? header.timestamp ?? '?'}`);
  if (body.exception) lines.push(`  例外：${clip(JSON.stringify(body.exception))}`);
  if (body.termination) lines.push(`  終了の理由：${clip(JSON.stringify(body.termination))}`);
  if (body.asi) {
    for (const [k, v] of Object.entries(body.asi)) {
      for (const s of [].concat(v).slice(0, 5)) lines.push(`  asi（${k}）：${clip(s)}`);
    }
  }
  const images = body.usedImages;
  if (Array.isArray(body.lastExceptionBacktrace) && body.lastExceptionBacktrace.length) {
    lines.push('  最後の例外の呼び出し元（上位）：', ...frameLines(body.lastExceptionBacktrace, images));
  }
  const ft = Array.isArray(body.threads) ? body.threads[body.faultingThread ?? -1] : undefined;
  if (ft) {
    lines.push(`  落ちたスレッド（${body.faultingThread}${ft.name ? `・${ft.name}` : ''}${ft.queue ? `・${ft.queue}` : ''}）の上位：`, ...frameLines(ft.frames, images));
  }
  return lines;
}

/** 印より新しい、このアプリの .ips を新しい順に返す。 */
export function findReports(dir, sinceMs, bundleId) {
  let names;
  try { names = fs.readdirSync(dir); } catch { return { mine: [], others: [] }; }
  const mine = [];
  const others = [];
  for (const n of names) {
    if (!n.endsWith('.ips')) continue;
    const f = path.join(dir, n);
    let st;
    try { st = fs.statSync(f); } catch { continue; }
    if (!st.isFile() || st.mtimeMs < sinceMs) continue;
    let ips = null;
    try { ips = parseIps(fs.readFileSync(f, 'utf8')); } catch { /* 読めない記録は飛ばす */ }
    if (isForBundle(ips, bundleId)) mine.push({ file: n, mtimeMs: st.mtimeMs, ips });
    else others.push(ips?.body?.procName ?? ips?.header?.app_name ?? n.replace(/-\d{4}-.*$/, ''));
  }
  mine.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return { mine, others };
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export function main(argv, log = console.log) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) args[argv[i].replace(/^--/, '')] = argv[i + 1];
  if (!args.dir || !args['bundle-id']) throw new Error('--dir と --bundle-id が要る');
  let sinceMs = 0;
  if (args.since) {
    try { sinceMs = fs.statSync(args.since).mtimeMs - 1000; } catch { sinceMs = 0; }
  }
  const waitMs = Math.max(0, Number(args['wait-seconds'] ?? 20)) * 1000;
  const until = Date.now() + waitMs;
  let found = findReports(args.dir, sinceMs, args['bundle-id']);
  while (found.mine.length === 0 && Date.now() < until) {
    sleepSync(2000);
    found = findReports(args.dir, sinceMs, args['bundle-id']);
  }
  if (found.mine.length === 0) {
    log(`[ios] このアプリのクラッシュの記録は無い（${Math.round(waitMs / 1000)}秒待った）。クラッシュではなく、終了・強制終了の可能性（シミュレーターのログの runningboardd の行で確かめる）`);
  } else {
    const latest = found.mine[0];
    log(`[ios] このアプリのクラッシュの記録：${found.mine.length}件（新しい1件の要点）`);
    for (const l of summarizeIps(latest.ips)) log(l);
  }
  if (found.others.length) log(`[ios] 同じ時間の他のプロセスのクラッシュの記録：${[...new Set(found.others)].slice(0, 10).join('・')}`);
  return found;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (e) {
    console.log(`[ios] クラッシュの記録を読めない：${e.message}`);
  }
}
