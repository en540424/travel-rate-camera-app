// 遠隔撮影のジョブ：定義・状態・結果の検証（純関数）。どの開発端末（Windows／Mac）からでも作って検証でき、
// 実際の撮影はmacOSの実行先（GitHub ActionsのmacOSランナー・Mac mini・手元のMac）が既存のiOS撮影手順（drivers/ios-simulator.mjs）で行う。
//
// 守るもの：
// - ジョブは「commitを固定した」撮影の依頼。作業ツリーに未commitの変更がある状態では作らない（再現できないため）
// - 結果は jobId・commit・デバイス・画面・sha256・寸法がジョブと一致したものだけ取り込む。撮影元は常に ios-simulator
// - 結果にホスト名・IPアドレス・利用者のホームのパスを入れない（devlog relay と同じ規則）
// - 実行先 mac-mini は Trading Lab の LIVE VM と同居しているため、人が保守窓であることを確かめて開始する（自動では始めない）
import { checkImageAgainstTarget, getTarget } from './specs.mjs';

export const JOB_SCHEMA = 'store-assets/job-v1';
export const RESULT_SCHEMA = 'store-assets/result-v1';

export const TARGETS = {
  'github-actions-macos': { label: 'GitHub ActionsのmacOSホストランナー', humanStart: false, runnerLabel: 'macos-26' },
  'mac-mini': { label: 'Mac mini（Trading Lab LIVE VMと同居）', humanStart: true },
  'local-macos': { label: '手元のMac', humanStart: true },
};

/** 状態遷移。failed からは再実行（dispatched）か中止（cancelled）。ingested・cancelled は終わり。 */
export const TRANSITIONS = {
  created: ['dispatched', 'cancelled'],
  dispatched: ['running', 'succeeded', 'failed', 'cancelled'],
  running: ['succeeded', 'failed'],
  succeeded: ['ingested', 'failed'],
  failed: ['dispatched', 'cancelled'],
  ingested: [],
  cancelled: [],
};

/** Mac mini の守り（ジョブの記載ではなくコードの値を使う。ジョブから消しても弱まらない） */
export const MAC_MINI_GUARD = Object.freeze({ maintenanceWindowRequired: true, minFreeDiskGB: 30, minMemoryFreePercent: 20 });

export const slug = (s) => String(s).replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '');

function stamp(d) {
  return d.toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
}

/**
 * ジョブを作る。profile は loadProfile の結果、git は {commit, dirty}。
 * opts: { target, devices, locales, screens, purpose: 'draft'|'final-candidate', now, maxRuntimeMinutes }
 */
export function createJob(profile, git, opts) {
  const now = opts.now ?? new Date();
  const ios = profile.capture?.ios ?? {};
  const devices = opts.devices?.length ? opts.devices : (ios.devices ?? []);
  const locales = opts.locales?.length ? opts.locales : profile.locales;
  const screens = opts.screens?.length ? opts.screens : profile.capture.screens.filter((s) => s.deepLink).map((s) => s.id);
  const job = {
    schema: JOB_SCHEMA,
    id: `${profile.app.id}-${stamp(now)}-${String(git.full ?? git.commit).slice(0, 7)}`,
    app: { id: profile.app.id, bundleId: profile.app.bundleId },
    profile: opts.profileRel ?? null,
    git: { commit: git.full ?? git.commit, dirty: git.dirty }, // 40桁（actions/checkout は短縮SHAを解決しない）
    target: opts.target,
    source: 'ios-simulator',
    purpose: opts.purpose ?? 'draft',
    devices, locales, screens,
    constraints: {
      maxRuntimeMinutes: opts.maxRuntimeMinutes ?? 60,
      secrets: 'none',
      humanStart: TARGETS[opts.target]?.humanStart ?? true,
      ...(opts.target === 'mac-mini' ? MAC_MINI_GUARD : {}),
    },
    createdAt: now.toISOString(),
  };
  return job;
}

/** ジョブの検査。profile と照らし、問題の一覧を返す。 */
export function validateJob(job, profile) {
  const p = [];
  if (job?.schema !== JOB_SCHEMA) p.push(`schema は ${JOB_SCHEMA}`);
  if (!TARGETS[job?.target]) p.push(`target は ${Object.keys(TARGETS).join('/')} のどれか`);
  if (!/^[0-9a-f]{40}$/.test(job?.git?.commit ?? '')) p.push('git.commit が40桁のcommitのハッシュではない');
  if (!/^[A-Za-z0-9._-]+$/.test(job?.id ?? '')) p.push('id に使えない文字がある');
  if (job?.git?.dirty !== false) p.push('未commitの変更がある状態のジョブは撮影を再現できない（commitしてから作る）');
  if (job?.source !== 'ios-simulator') p.push('source は ios-simulator だけ（Web版や実機の画像をこの経路で扱わない）');
  if (!['draft', 'final-candidate'].includes(job?.purpose)) p.push('purpose は draft / final-candidate');
  if (profile) {
    if (job.app?.id !== profile.app.id || job.app?.bundleId !== profile.app.bundleId) p.push('アプリの設定とジョブのアプリが違う');
    const known = new Set(profile.capture.screens.filter((s) => s.deepLink).map((s) => s.id));
    for (const s of job.screens ?? []) if (!known.has(s)) p.push(`画面 ${s} は設定に無いかディープリンクが無い`);
    for (const l of job.locales ?? []) if (!profile.locales.includes(l)) p.push(`言語 ${l} は設定に無い`);
    const devs = new Set(profile.capture?.ios?.devices ?? []);
    for (const d of job.devices ?? []) if (!devs.has(d)) p.push(`デバイス ${d} は capture.ios.devices に無い`);
  }
  for (const k of ['devices', 'locales', 'screens']) if (!Array.isArray(job?.[k]) || job[k].length === 0) p.push(`${k} が空`);
  return p;
}

/** 状態を進める。許されない遷移は例外。status は {jobId, state, attempt, events[]}。 */
export function transition(status, to, { note = '', at = new Date().toISOString() } = {}) {
  const allowed = TRANSITIONS[status.state] ?? [];
  if (!allowed.includes(to)) throw new Error(`状態 ${status.state} から ${to} へは進めない（可能：${allowed.join(', ') || 'なし'}）`);
  const attempt = to === 'dispatched' && status.state === 'failed' ? status.attempt + 1 : status.attempt;
  return { ...status, state: to, attempt, events: [...status.events, { at, from: status.state, to, attempt, note }] };
}

export function newStatus(job, at = new Date().toISOString()) {
  return { jobId: job.id, state: 'created', attempt: 1, events: [{ at, from: null, to: 'created', attempt: 1, note: '' }] };
}

// 結果に入れてはいけない識別子（ホスト名・IP・ホームのパス・メール）
// 注：4区切りの版番号（例 1.2.3.4）はIPアドレスと区別できず、拒否される（今の Xcode・macOS・ランタイムの表記は3区切り以下）
const FORBIDDEN = [
  [/\b\d{1,3}(\.\d{1,3}){3}\b/g, 'IPアドレス'],
  [/\b[0-9a-f]{1,4}(:[0-9a-f]{0,4}){5,7}\b/gi, 'IPv6／MACアドレス'],
  [/\b[0-9a-f]{1,4}(:[0-9a-f]{1,4})*::([0-9a-f]{1,4}(:[0-9a-f]{1,4})*)?\b/gi, 'IPv6アドレス'],
  [/[A-Za-z0-9-]+\.(local|lan|internal|ts\.net)\b/gi, '.local・tailnet等のホスト名'],
  [/\/Users\/[^/\s"']+/g, 'macOSのホームのパス'],
  [/\/Volumes\/[^/\s"']+/g, 'macOSのボリュームのパス'],
  [/[A-Za-z]:\\{1,2}Users\\{1,2}[^\\\s"']+/g, 'Windowsのホームのパス'],
  [/\/home\/[^/\s"']+/g, 'Linuxのホームのパス'],
  [/[\w.+-]+@[\w-]+\.[\w.]+/g, 'メールアドレス'],
];

export function forbiddenIdentifiers(text) {
  return FORBIDDEN.filter(([re]) => new RegExp(re.source, re.flags.replace('g', '')).test(text)).map(([, label]) => label);
}

/** 実行側で結果へ書く前に伏せる（エラーの文言にパスやホスト名が混ざるため）。 */
export function redactIdentifiers(text, replacements = []) {
  let t = String(text);
  for (const [from, to] of replacements) if (from) t = t.split(from).join(to);
  for (const [re] of FORBIDDEN) t = t.replace(re, '<伏せた>');
  return t;
}

/** 結果のファイルの置き場所（resultDir からの相対）。 */
export function captureRel(device, locale, screen) {
  return `captures/${slug(device)}/${locale}/${screen}.png`;
}

/**
 * 結果の検証。readFile(rel) は Buffer を返す（無ければ例外）。hash(buf)・pngInfo(buf) は呼び出し側から渡す。
 * 返す値：{ ok, problems, missing }。missing（撮れなかった画面）は draft では問題にせず、final-candidate では問題にする。
 */
export function verifyResult(job, result, { readFile, hash, pngInfo, rawText = '', minSide = 320 }) {
  const problems = [];
  if (result?.schema !== RESULT_SCHEMA) problems.push(`schema は ${RESULT_SCHEMA}`);
  if (result?.jobId !== job.id) problems.push(`jobId がジョブと違う（${result?.jobId}）`);
  if (result?.git?.commit !== job.git.commit) problems.push(`commit がジョブと違う（${result?.git?.commit} ≠ ${job.git.commit}）`);
  if (result?.status !== 'succeeded') problems.push(`実行が成功していない（${result?.status}${result?.error ? `：${result.error}` : ''}）`);
  if (result?.source !== 'ios-simulator') problems.push('撮影元が ios-simulator ではない');
  const env = result?.env ?? {};
  for (const k of ['runner', 'macos', 'xcode']) if (!env[k]) problems.push(`env.${k}（撮影環境の記録）が無い`);
  if (!Array.isArray(env.devices) || env.devices.length === 0) problems.push('env.devices（シミュレーターの名前とランタイム）が無い');
  const leaked = forbiddenIdentifiers(rawText || JSON.stringify(result ?? {}));
  if (leaked.length) problems.push(`結果に入れてはいけない識別子がある：${leaked.join('・')}`);

  if (result?.git?.dirty !== false) problems.push('実行した作業ツリーが clean だった記録が無い');
  if (!Array.isArray(result?.captures) || result.captures.length === 0) problems.push('撮影が1枚も無い');
  const envNames = new Set((env.devices ?? []).map((d) => d?.name));
  for (const d of job.devices ?? []) if (!envNames.has(d)) problems.push(`env.devices にジョブのデバイス ${d} が無い`);
  const want = new Set();
  for (const d of job.devices) for (const l of job.locales) for (const s of job.screens) want.add(`${d}|${l}|${s}`);
  const seen = new Set();
  for (const c of Array.isArray(result?.captures) ? result.captures : []) {
    if (!c || typeof c !== 'object' || ![c.device, c.locale, c.screen, c.file, c.sha256].every((x) => typeof x === 'string') || !Number.isInteger(c.width) || !Number.isInteger(c.height)) {
      problems.push('撮影の記録の形が不正'); continue;
    }
    const key = `${c.device}|${c.locale}|${c.screen}`;
    if (!want.has(key)) { problems.push(`ジョブに無い撮影：${key}`); continue; }
    if (seen.has(key)) { problems.push(`同じ撮影が2回ある：${key}`); continue; }
    seen.add(key);
    if (c.file !== captureRel(c.device, c.locale, c.screen)) { problems.push(`置き場所が規則と違う：${c.file}`); continue; }
    let buf;
    try { buf = readFile(c.file); } catch { problems.push(`画像が無い：${c.file}`); continue; }
    if (hash(buf) !== c.sha256) { problems.push(`撮影後に画像が変わった（sha256不一致）：${c.file}`); continue; }
    let info;
    try { info = pngInfo(buf); } catch { problems.push(`PNGではない：${c.file}`); continue; }
    if (info.width !== c.width || info.height !== c.height) problems.push(`寸法の記録が画像と違う：${c.file}`);
    else if (Math.min(info.width, info.height) < minSide) problems.push(`画像が小さすぎる（${info.width}x${info.height}）：${c.file}`);
  }
  const missing = [...want].filter((k) => !seen.has(k));
  if (job.purpose === 'final-candidate') for (const m of missing) problems.push(`撮れていない：${m}`);
  return { ok: problems.length === 0, problems, missing };
}

/** ストアの寸法に合うか（参考の検査。合わなくても取り込みは止めない：合成で縮小・余白を付けるため）。 */
export function sizeNotes(captures, targetIds) {
  const notes = [];
  for (const c of captures) {
    const fits = targetIds.filter((t) => checkImageAgainstTarget(getTarget(t), { width: c.width, height: c.height, hasAlpha: false }).length === 0);
    notes.push({ device: c.device, screen: c.screen, width: c.width, height: c.height, fitsTargets: fits });
  }
  return notes;
}

/** GitHub Actionsへの依頼のコマンド（workflowが既定branchに入っている時だけ使える）。 */
export function githubDispatchArgs(job, { workflow = 'store-assets-ios.yml', ref = 'main' } = {}) {
  return ['workflow', 'run', workflow, '--ref', ref, '-f', `job_json=${JSON.stringify(job)}`];
}

export function githubDownloadArgs(job, runId, destDir) {
  return ['run', 'download', String(runId), '-n', `store-assets-${job.id}`, '-D', destDir];
}

/** 撮影の前の資源の確認（macOS）。値だけを返し、ホスト名などは返さない。 */
export function parsePreflight({ dfK, loadavg, memPressure }) {
  const out = {};
  const df = String(dfK ?? '').trim().split('\n').pop()?.split(/\s+/);
  if (df && df.length >= 4 && /^\d+$/.test(df[3])) out.freeDiskGB = Math.round((Number(df[3]) / 1024 / 1024) * 10) / 10;
  const la = String(loadavg ?? '').match(/[\d.]+/g);
  if (la?.length) out.load1 = Number(la[0]);
  const mp = String(memPressure ?? '').match(/free percentage:\s*(\d+)%/i);
  if (mp) out.memoryFreePercent = Number(mp[1]);
  return out;
}

export function preflightProblems(job, pre, { onMacMini = job.target === 'mac-mini' } = {}) {
  const p = [];
  const guard = onMacMini ? MAC_MINI_GUARD : (job.constraints ?? {});
  const min = guard.minFreeDiskGB;
  if (min != null && !(pre.freeDiskGB >= min)) p.push(`空きディスクが ${pre.freeDiskGB ?? '不明'}GB（必要 ${min}GB）`);
  if (onMacMini && !(pre.memoryFreePercent >= MAC_MINI_GUARD.minMemoryFreePercent)) p.push(`空きメモリが ${pre.memoryFreePercent ?? '不明'}%（${MAC_MINI_GUARD.minMemoryFreePercent}%未満か不明。常駐のVM・Hermesと重ねない）`);
  return p;
}

/** この Mac が Mac mini（常駐の実行基盤）か。ジョブの target ではなく、その Mac に置いた印で決める。 */
export function isMacMiniHost({ env = process.env, markerExists = () => false } = {}) {
  return env.ENEXUS_RUNTIME_NODE === 'mac-mini' || markerExists();
}
