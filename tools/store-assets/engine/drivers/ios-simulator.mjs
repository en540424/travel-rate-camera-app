// 撮影ドライバ：iOSシミュレーター（Macのみ。Xcodeの `xcrun simctl` を使う）。
// 実アプリ（シミュレーター向けにbuildしたもの）を起動し、ディープリンクで画面を開いて撮る。撮影元は 'ios-simulator'。
//
// 手順の組み立て（planIosCapture）は純粋関数で、Windowsでも検証できる。実行（runIosPlan）はmacOSでだけ動く。
// Windowsでは手順をシェルスクリプトとして書き出し、Macで人が実行する（README「iOSシミュレーターでの撮影」）。
//
// テストデータ：fixtureDb を指定すると、アプリを止めた状態でシミュレーター内のアプリのDBを置き換える。
// 置き換える前に既存のDBを同じ場所へ `.bak-<時刻>` として退避する。実機・利用者の端末には触れない。

function shellQuote(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

/**
 * 撮影手順（コマンド列）を作る。
 * opts: { device, bundleId, scheme, screens:[{id, deepLink, settleMs}], locale, outDir, statusBar, fixtureDb, dbRelPath, appearance, appPath }
 */
export function planIosCapture(opts) {
  const dev = shellQuote(opts.device);
  const steps = [];
  const add = (cmd, note) => steps.push({ cmd, note });
  add(`xcrun simctl boot ${dev} 2>/dev/null || true`, 'シミュレーターを起動（起動済みなら何もしない）');
  add(`xcrun simctl bootstatus ${dev} -b`, '起動完了を待つ');
  if (opts.appPath) add(`xcrun simctl install ${dev} ${shellQuote(opts.appPath)}`, 'シミュレーター向けにbuildしたアプリを入れる（.app）');
  add(`xcrun simctl ui ${dev} appearance ${opts.appearance ?? 'light'}`, '外観を固定');
  const sb = opts.statusBar ?? {};
  add(
    `xcrun simctl status_bar ${dev} override --time ${shellQuote(sb.time ?? '9:41')} --batteryState charged --batteryLevel 100 --cellularMode active --cellularBars 4 --wifiBars 3`,
    'ステータスバーを固定（時刻9:41・電池満充電）',
  );
  if (opts.locale) {
    add(
      `xcrun simctl spawn ${dev} defaults write -g AppleLanguages -array ${shellQuote(opts.locale)}`,
      '端末の言語（反映には再起動が要る場合がある）',
    );
  }
  add(`xcrun simctl terminate ${dev} ${shellQuote(opts.bundleId)} 2>/dev/null || true`, 'アプリを止める');
  add(
    `xcrun simctl privacy ${dev} grant all ${shellQuote(opts.bundleId)} 2>/dev/null || true`,
    '権限の確認の窓が撮影に写らないように、シミュレーター内のこのアプリへ許可を与える（非対応の版では何もしない）',
  );
  if (opts.fixtureDb) {
    // 1行ずつ分ける（`&&` でつなぐと set -e が途中の失敗で止まらず、古いデータのまま撮ってしまうため）
    const rel = opts.dbRelPath ?? 'Documents/SQLite/app.db';
    const db = `"$DATA_DIR/${rel}"`;
    add(`DATA_DIR="$(xcrun simctl get_app_container ${dev} ${shellQuote(opts.bundleId)} data)"`, 'シミュレーター内のアプリのデータの場所（アプリが入っていなければここで止まる）');
    add('test -n "$DATA_DIR"', '場所が取れたことを確かめる');
    add(`if [ -f ${db} ]; then cp ${db} "$DATA_DIR/${rel}.bak-$(date +%Y%m%d%H%M%S)"; fi`, '既存のDBを退避（シミュレーター内のみ）');
    add(`mkdir -p "$(dirname ${db})"`, 'DBの置き場所');
    add(`cp ${shellQuote(opts.fixtureDb)} ${db}`, 'テストデータのDBを入れる');
    add(`rm -f "$DATA_DIR/${rel}-wal" "$DATA_DIR/${rel}-shm"`, '古いWALを消す（新しいDBと混ざらないように）');
  }
  add(`xcrun simctl launch ${dev} ${shellQuote(opts.bundleId)}`, 'アプリを起動');
  add('sleep 4', '起動を待つ');
  add(`mkdir -p ${shellQuote(opts.outDir)}`, '保存先');
  for (const s of opts.screens) {
    if (!s.deepLink) continue;
    add(`xcrun simctl openurl ${dev} ${shellQuote(s.deepLink)}`, `画面 ${s.id} を開く`);
    add(`sleep ${Math.max(1, Math.round((s.settleMs ?? 1500) / 1000))}`, '描画を待つ');
    add(`xcrun simctl io ${dev} screenshot --type=png ${shellQuote(`${opts.outDir}/${s.id}.png`)}`, `画面 ${s.id} を撮る`);
  }
  add(`xcrun simctl status_bar ${dev} clear`, 'ステータスバーを戻す');
  return steps;
}

/** 手順をシェルスクリプトにする（Macで人が実行する用）。 */
export function planToShellScript(steps, header = '') {
  const lines = ['#!/bin/bash', '# 自動生成：tools/store-assets（iOSシミュレーター撮影）', header, 'set -euo pipefail', ''];
  for (const s of steps) lines.push(`# ${s.note}`, s.cmd, '');
  return lines.join('\n');
}

/** macOSで手順を実行する。macOS以外では例外。deadline（ms の時刻）を過ぎたら次の手順へ進まない。 */
export async function runIosPlan(steps, log = console.log, { deadline = Infinity } = {}) {
  if (process.platform !== 'darwin') {
    throw new Error('iOSシミュレーターの撮影はmacOSでのみ実行できます。`plan-ios` で手順を書き出してMacで実行してください');
  }
  const { execSync } = await import('node:child_process');
  for (const s of steps) {
    const left = deadline - Date.now();
    if (left <= 0) throw new Error('実行の時間の上限を超えた（maxRuntimeMinutes）');
    log(`[ios] ${s.note}`);
    execSync(s.cmd, { stdio: 'inherit', shell: '/bin/bash', timeout: Number.isFinite(left) ? left : undefined });
  }
}
