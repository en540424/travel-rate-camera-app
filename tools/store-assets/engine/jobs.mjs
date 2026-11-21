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
    id: `${profile.app.id}-${stamp(now)}-${git.commit}`,
    app: { id: profile.app.id, bundleId: profile.app.bundleId },
    profile: opts.profileRel ?? null,
    git: { commit: git.commit, dirty: git.dirty },
    target: opts.target,
    source: 'ios-simulator',
    purpose: opts.purpose ?? 'draft',
    devices, locales, screens,
    constraints: {
      maxRuntimeMinutes: opts.maxRuntimeMinutes ?? 60,
      secrets: 'none',
      humanStart: TARGETS[opts.target]?.humanStart ?? true,
      ...(opts.target === 'mac-mini' ? { maintenanceWindowRequired: true, minFreeDiskGB: 30 } : {}),
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
  if (!/^[0-9a-f]{7,40}$/.test(job?.git?.commit ?? '')) p.push('git.commit がcommitのハッシュではない');
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
const FORBIDDEN = [
  [/\b\d{1,3}(\.\d{1,3}){3}\b/, 'IPアドレス'],
  [/\b[0-9a-f]{0,4}(:[0-9a-f]{0,4}){5,7}\b/i, 'IPv6／MACアドレス'],
  [/[A-Za-z0-9-]+\.(local|lan|internal)\b/i, '.local等のホスト名'],
  [/\/Users\/[^/\s"]+/, 'macOSのホームのパス'],
  [/[A-Za-z]:\\Users\\[^\\\s"]+/, 'Windowsのホームのパス'],
  [/\/home\/[^/\s"]+/, 'Linuxのホームのパス'],
  [/[\w.+-]+@[\w-]+\.[\w.]+/, 'メールアドレス'],
];

export function forbiddenIdentifiers(text) {
  return FORBIDDEN.filter(([re]) => re.test(text)).map(([, label]) => label);
}

/** 結果のファイルの置き場所（resultDir からの相対）。 */
export function captureRel(device, locale, screen) {
  return `captures/${slug(device)}/${locale}/${screen}.png`;
}

/**
 * 結果の検証。readFile(rel) は Buffer を返す（無ければ例外）。hash(buf)・pngInfo(buf) は呼び出し側から渡す。
 * 返す値：{ ok, problems, missing }。missing（撮れなかった画面）は draft では問題にせず、final-candidate では問題にする。
 */
export function verifyResult(job, result, { readFile, hash, pngInfo, rawText = '' }) {
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

  const want = new Set();
  for (const d of job.devices) for (const l of job.locales) for (const s of job.screens) want.add(`${d}|${l}|${s}`);
  const seen = new Set();
  for (const c of result?.captures ?? []) {
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

export function preflightProblems(job, pre) {
  const p = [];
  const min = job.constraints?.minFreeDiskGB;
  if (min != null && !(pre.freeDiskGB >= min)) p.push(`空きディスクが ${pre.freeDiskGB ?? '不明'}GB（必要 ${min}GB）`);
  if (job.target === 'mac-mini' && pre.memoryFreePercent != null && pre.memoryFreePercent < 20) p.push(`空きメモリが ${pre.memoryFreePercent}%（20%未満。常駐のVM・Hermesと重ねない）`);
  return p;
}
