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
 * opts: { device, bundleId, scheme, screens:[{id, deepLink, settleMs}], locale, outDir, statusBar, fixtureDb, dbRelPath, appearance }
 */
export function planIosCapture(opts) {
  const dev = shellQuote(opts.device);
  const steps = [];
  const add = (cmd, note) => steps.push({ cmd, note });
  add(`xcrun simctl boot ${dev} 2>/dev/null || true`, 'シミュレーターを起動（起動済みなら何もしない）');
  add(`xcrun simctl bootstatus ${dev} -b`, '起動完了を待つ');
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
  if (opts.fixtureDb) {
    const rel = opts.dbRelPath ?? 'Documents/SQLite/app.db';
    add(
      `DATA_DIR="$(xcrun simctl get_app_container ${dev} ${shellQuote(opts.bundleId)} data)" && ` +
        `if [ -f "$DATA_DIR/${rel}" ]; then cp "$DATA_DIR/${rel}" "$DATA_DIR/${rel}.bak-$(date +%Y%m%d%H%M%S)"; fi && ` +
        `mkdir -p "$(dirname "$DATA_DIR/${rel}")" && cp ${shellQuote(opts.fixtureDb)} "$DATA_DIR/${rel}" && ` +
        `rm -f "$DATA_DIR/${rel}-wal" "$DATA_DIR/${rel}-shm"`,
      'テストデータのDBを入れる（シミュレーター内のみ。既存DBは退避）',
    );
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

/** macOSで手順を実行する。macOS以外では例外。 */
export async function runIosPlan(steps, log = console.log) {
  if (process.platform !== 'darwin') {
    throw new Error('iOSシミュレーターの撮影はmacOSでのみ実行できます。`plan-ios` で手順を書き出してMacで実行してください');
  }
  const { execSync } = await import('node:child_process');
  for (const s of steps) {
    log(`[ios] ${s.note}`);
    execSync(s.cmd, { stdio: 'inherit', shell: '/bin/bash' });
  }
}
