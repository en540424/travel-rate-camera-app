// 撮影ドライバ：iOSシミュレーター（Macのみ。Xcodeの `xcrun simctl` を使う）。
// 実アプリ（シミュレーター向けにbuildしたもの）を起動し、ディープリンクで画面を開いて撮る。撮影元は 'ios-simulator'。
//
// 手順の組み立て（planIosCapture）は純粋関数で、Windowsでも検証できる。実行（runIosPlan）はmacOSでだけ動く。
// Windowsでは手順をシェルスクリプトとして書き出し、Macで人が実行する（README「iOSシミュレーターでの撮影」）。
//
// テストデータ：fixtureDb を指定すると、アプリを止めた状態でシミュレーター内のアプリのDBを置き換える。
// 置き換える前に既存のDBを同じ場所へ `.bak-<時刻>` として退避する。実機・利用者の端末には触れない。

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { maestroFlow, maestroWarmupFlow } from './interact.mjs';

function shellQuote(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

// 撮影を止めた理由ごとの終了コード。
// 2026-11-21 の3回目の実行では、アプリが前面に無いまま撮影まで進み、ホーム画面を2枚撮った。
// 起動の後にアプリが動いていることを確かめられなければ、撮影せずにこのコードで止める。
// 理由の文は ios_fail が IOS_REASON_FILE へ書いたものだけを使う（simctl 自身の終了コードと番号が重なっても、理由を取り違えない）
export const IOS_EXIT = {
  appArtifact: 20, // ビルドしたアプリの確認（JSの本体の同梱・Bundle ID）
  launchCommand: 21, // 起動の命令の失敗・プロセス番号を読めない
  notAliveAfterLaunch: 22, // 起動の後にアプリが動いていない
  notAliveAtCapture: 23, // 撮影の前後にアプリが動いていない
  sameAsHome: 24, // 撮影がホーム画面と同じ画像
  probeNotStopped: 25, // 試しの起動のアプリを止められない
  baselineUnstable: 26, // ホーム画面の基準が静止しない（1画面のジョブだけ止める）
  simctlCommand: 27, // 画面を開く・撮る命令の失敗
};

/** クラッシュの記録の要点を出す道具。生成するスクリプトには書かず、実行時に環境変数 IOS_IPS_TOOL で渡す（書き出した機械のパスを残さない）。 */
export const IPS_TOOL = fileURLToPath(new URL('./ips-summary.mjs', import.meta.url)).replace(/\\/g, '/');

/**
 * 1本のシェルの中で使う確認・診断の関数（手順の最初に定義する）。
 * - 生死の確認はホスト側のプロセス番号（kill -0）。シミュレーターのアプリはホストのプロセスとして動く。
 *   旧版の `launchctl list | grep -q` は pipefail の下で grep の早期終了が書き手を SIGPIPE にし、動いていても失敗に見えることがあった
 * - 診断のコマンドはすべて失敗を無視する（set -e で診断の途中に止まり、決めた終了コードで終われなくなるのを防ぐ）
 * - 変数は必ず ${名前} で書く。macOS の /bin/bash 3.2 は UTF-8 の locale で全角文字の先頭バイトを英字として変数名に含めることがあり、
 *   `$IOS_PID）` が「IOS_PID\xEF: unbound variable」で止まる（Fable 5.2 の独立検収の指摘。テストで機械的に検査する）
 */
function helperScript({ dev, bundleId, exe, aliveSeconds, screenCount, shotDir }) {
  const sys = `(process == "runningboardd" OR process == "SpringBoard" OR process == "CoreSimulatorBridge" OR process == "launchd_sim") AND eventMessage CONTAINS "${bundleId}"`;
  const app = [exe ? `process == "${exe}"` : null, 'subsystem == "com.facebook.react.log"'].filter(Boolean).join(' OR ');
  const pidRe = `^${bundleId.replace(/\./g, '\\.')}: *\\([0-9][0-9]*\\)$`;
  return [
    `IOS_DEV=${dev}; IOS_BID=${shellQuote(bundleId)}; IOS_ALIVE_SECONDS=${aliveSeconds}; IOS_SCREEN_COUNT=${screenCount}; IOS_SHOT_DIR=${shellQuote(shotDir)}`,
    `IOS_PRED_SYS=${shellQuote(sys)}; IOS_PRED_APP=${shellQuote(app)}; IOS_PID_RE=${shellQuote(pidRe)}`,
    "IOS_PID=''; IOS_WHY=''; IOS_PROBE='未実施'; IOS_DIAG_N=0",
    'IOS_TMP="$(mktemp -d)"; IOS_MARK="${IOS_TMP}/launch-mark"; IOS_BASE="${IOS_TMP}/home.png"; touch "${IOS_MARK}"',
    'ios_alive() { if [ -z "${1:-}" ]; then return 1; fi; kill -0 "${1}" 2>/dev/null; }',
    'ios_load() { echo "[ios] 負荷（loadavg）：$(sysctl -n vm.loadavg 2>/dev/null || echo \'?\')"; }',
    // 理由を書いて止める（診断なし）。ビルドしたアプリの確認など、起動の前の失敗に使う
    'ios_stop() { local rc="${1}"; shift; echo "[ios] 失敗：${*}"; if [ -n "${IOS_REASON_FILE:-}" ]; then printf \'%s\' "${*}" > "${IOS_REASON_FILE}" || true; fi; exit "${rc}"; }',
    // 起動して、IOS_ALIVE_SECONDS 秒のあいだ1秒ごとに生死を確かめる（固定の sleep だけでは、落ちていても次へ進んでいた）
    'ios_launch() {',
    '  local out i=0',
    '  touch "${IOS_MARK}"; ios_load',
    '  out="$(xcrun simctl launch "${IOS_DEV}" "${IOS_BID}" 2>&1)" || { echo "${out}"; IOS_WHY="起動の命令が失敗した"; echo "[ios] ${IOS_WHY}"; return 21; }',
    '  echo "${out}"',
    '  IOS_PID="$(printf \'%s\\n\' "${out}" | sed -n "s/${IOS_PID_RE}/\\1/p" | tail -n 1)"',
    '  if [ -z "${IOS_PID}" ]; then IOS_WHY="起動の結果からプロセス番号を読めない"; echo "[ios] ${IOS_WHY}"; return 21; fi',
    '  while [ "${i}" -lt "${IOS_ALIVE_SECONDS}" ]; do',
    '    sleep 1; i=$((i + 1))',
    '    if ! ios_alive "${IOS_PID}"; then IOS_WHY="アプリ（pid ${IOS_PID}）が起動から約${i}秒で終了した（撮影しない）"; echo "[ios] ${IOS_WHY}"; return 22; fi',
    '  done',
    '  echo "[ios] アプリ（pid ${IOS_PID}）が起動から${IOS_ALIVE_SECONDS}秒動き続けている"',
    '}',
    'ios_diag() {',
    "  echo '[ios] ---- 診断（ここから）----'",
    '  ios_load',
    '  IOS_DIAG_N=$((IOS_DIAG_N + 1))',
    '  mkdir -p "${IOS_SHOT_DIR}" 2>/dev/null || true',
    '  if xcrun simctl io "${IOS_DEV}" screenshot --type=png "${IOS_SHOT_DIR}/_diag-${IOS_DIAG_N}.rejected.png" >/dev/null 2>&1; then echo "[ios] この時点の画面：_diag-${IOS_DIAG_N}.rejected.png（成果物。採用しない）"; fi',
    "  echo '[ios] シミュレーター内の launchd の記録（このアプリ。pid・直近の終了の状態）：'",
    '  xcrun simctl spawn "${IOS_DEV}" launchctl list 2>&1 | grep -F "${IOS_BID}" || echo "[ios] （該当なし）"',
    "  echo '[ios] シミュレーターのログ（起動・終了の管理側。直近10分・末尾80行）：'",
    '  xcrun simctl spawn "${IOS_DEV}" log show --last 10m --style compact --predicate "${IOS_PRED_SYS}" 2>&1 | LC_ALL=C cut -c1-400 | tail -n 80 || true',
    "  echo '[ios] シミュレーターのログ（アプリ自身・JS。直近10分・末尾60行）：'",
    '  xcrun simctl spawn "${IOS_DEV}" log show --last 10m --style compact --predicate "${IOS_PRED_APP}" 2>&1 | LC_ALL=C cut -c1-400 | tail -n 60 || true',
    "  echo '[ios] クラッシュの記録（このアプリの分・要点）：'",
    '  if [ -z "${IOS_IPS_TOOL:-}" ]; then echo "[ios] IOS_IPS_TOOL が無いのでクラッシュの記録を読まない"; elif ! command -v node >/dev/null 2>&1; then echo "[ios] node が無いのでクラッシュの記録を読まない"; else node "${IOS_IPS_TOOL}" --dir "${HOME}/Library/Logs/DiagnosticReports" --since "${IOS_MARK}" --bundle-id "${IOS_BID}" --wait-seconds "${IOS_IPS_WAIT:-20}" || true; fi',
    "  echo '[ios] ---- 診断（ここまで）----'",
    '}',
    // 理由を書き、診断を出して止める（理由は診断より先に書く：診断の途中で時間切れになっても理由は残る）
    'ios_fail() { local rc="${1}"; shift; echo "[ios] 失敗：${*}（試しの起動＝${IOS_PROBE}）"; if [ -n "${IOS_REASON_FILE:-}" ]; then printf \'%s（試しの起動＝%s）\' "${*}" "${IOS_PROBE}" > "${IOS_REASON_FILE}" || true; fi; ios_diag; exit "${rc}"; }',
    // テストデータを入れる前に一度起動する。失敗しても止めない（「アプリ・実行環境の問題」か「テストデータ・migrationの問題」かを同じ実行で分ける）。
    // 止める時は、プロセスが消えるまで待つ（動いているアプリの下でDBを差し替えない。本番の起動が既存のプロセスを前に出すだけにならない）
    'ios_probe() {',
    '  local rc=0 p i=0',
    '  ios_launch || rc=$?',
    '  if [ "${rc}" -eq 0 ]; then IOS_PROBE="動いた"; else IOS_PROBE="失敗（コード ${rc}・${IOS_WHY}）"; echo "[ios] 試しの起動（テストデータを入れる前）が失敗した。診断を出して続ける"; ios_diag; fi',
    '  echo "[ios] 試しの起動（テストデータを入れる前）：${IOS_PROBE}"',
    '  p="${IOS_PID}"',
    '  xcrun simctl terminate "${IOS_DEV}" "${IOS_BID}" || echo "[ios] アプリを止める命令が失敗した（プロセスが消えるのを待つ）"',
    '  while ios_alive "${p}"; do',
    '    if [ "${i}" -ge "${IOS_STOP_WAIT:-30}" ]; then echo "[ios] アプリ（pid ${p}）が${IOS_STOP_WAIT:-30}秒で止まらないので強制終了する"; kill -9 "${p}" 2>/dev/null || true; i=0; while ios_alive "${p}"; do if [ "${i}" -ge 10 ]; then break; fi; sleep 1; i=$((i + 1)); done; break; fi',
    '    sleep 1; i=$((i + 1))',
    '  done',
    '  if ios_alive "${p}"; then ios_fail 25 "試しの起動のアプリ（pid ${p}）を止められない（動いているアプリの下でテストデータを差し替えない）"; fi',
    "  IOS_PID=''; IOS_WHY=''",
    '}',
    // アプリを止めた後のホーム画面を基準として撮る（撮影の出力先の外。取り込みの対象にしない）。
    // 閉じる動きの途中を基準にしないよう、続けて撮った2枚が一致するまで撮り直す（最大10回）
    'ios_baseline() {',
    '  local a="${IOS_TMP}/base-a.png" i=0',
    '  rm -f "${IOS_BASE}"; sleep 2',
    '  xcrun simctl io "${IOS_DEV}" screenshot --type=png "${a}" >/dev/null 2>&1 || true',
    '  while [ "${i}" -lt 10 ]; do',
    '    sleep 1; i=$((i + 1))',
    '    xcrun simctl io "${IOS_DEV}" screenshot --type=png "${IOS_BASE}" >/dev/null 2>&1 || true',
    '    if [ -s "${IOS_BASE}" ]; then if cmp -s "${a}" "${IOS_BASE}"; then echo "[ios] ホーム画面の基準を撮った（${i}回目で静止を確認）"; return 0; fi; fi',
    '    mv -f "${IOS_BASE}" "${a}" 2>/dev/null || true',
    '  done',
    '  rm -f "${IOS_BASE}"',
    '  if [ "${IOS_SCREEN_COUNT}" -lt 2 ]; then ios_fail 26 "ホーム画面の基準が静止しない（1画面のジョブは、別の画面との比較で守れないため止める）"; fi',
    '  echo "[ios] 警告：ホーム画面の基準が静止しない（基準との比較は省く。別の画面が同じ画像の検査は残る）"',
    '}',
    'ios_require_alive() { if ! ios_alive "${IOS_PID}"; then ios_fail 23 "画面 ${1} の撮影の前にアプリ（pid ${IOS_PID:-?}）が動いていない"; fi; }',
    // ---- 操作が要る画面（interact）。ここの失敗は致命にしない：その画面だけ撮らず、理由を IOS_SKIP_FILE に残して続ける
    //      （1画面の操作の失敗で、撮れていた他の画面まで取り込めなくなるのを防ぐ。操作が要る画面は手順の最後に置く）
    'ios_skip() { local id="${1}"; shift; echo "[ios] 画面 ${id} は撮らない：${*}"; if [ -n "${IOS_SKIP_FILE:-}" ]; then printf \'%s\\t%s\\n\' "${id}" "${*}" >> "${IOS_SKIP_FILE}" || true; fi; }',
    // maestro を時間の上限つきで動かす（固まっても撮影全体を止めない）。終了コード 124＝時間切れ
    'ios_maestro() {',
    '  local flow="${1}" limit="${2}" log="${3}" mp i=0 rc=0',
    '  maestro --device "${IOS_DEV}" test "${flow}" > "${log}" 2>&1 &',
    '  mp=$!',
    '  while kill -0 "${mp}" 2>/dev/null; do',
    '    if [ "${i}" -ge "${limit}" ]; then kill "${mp}" 2>/dev/null || true; sleep 2; kill -9 "${mp}" 2>/dev/null || true; wait "${mp}" 2>/dev/null || true; return 124; fi',
    '    sleep 1; i=$((i + 1))',
    '  done',
    '  wait "${mp}" || rc=$?',
    '  return "${rc}"',
    '}',
    // 道具の準備（初回だけ。撮る画面を開く前に済ませる）
    'ios_maestro_ready() {',
    '  local rc=0',
    '  if [ -n "${IOS_MAESTRO_READY:-}" ]; then return 0; fi',
    '  if ! command -v maestro >/dev/null 2>&1; then IOS_WHY="操作の道具（maestro）が入っていない"; return 1; fi',
    '  echo "[ios] 操作の道具：$(maestro --version 2>/dev/null | tail -n 1)"',
    '  ios_maestro "${IOS_TMP}/flow-warmup.yaml" "${IOS_MAESTRO_WARMUP_SECONDS:-420}" "${IOS_TMP}/maestro-warmup.log" || rc=$?',
    '  if [ "${rc}" -ne 0 ]; then tail -n 40 "${IOS_TMP}/maestro-warmup.log" | LC_ALL=C cut -c1-300 || true; IOS_WHY="操作の道具の準備が失敗した（終了コード ${rc}）"; return 1; fi',
    '  IOS_MAESTRO_READY=1',
    '}',
    // 操作して、期待する表示があることを確かめる（確かめは maestro のフローの assertVisible／assertNotVisible）
    'ios_interact() {',
    '  local id="${1}" flow="${2}" limit="${3}" rc=0 log="${IOS_TMP}/maestro-${1}.log"',
    '  ios_maestro "${flow}" "${limit}" "${log}" || rc=$?',
    // アプリが落ちていたら診断を出す（致命にはしないが、道具の失敗と取り違えないよう、クラッシュの記録・ログを残す）
    '  if ! ios_alive "${IOS_PID}"; then IOS_WHY="操作の途中・後にアプリ（pid ${IOS_PID:-?}）が動いていない（クラッシュの可能性。診断を出した）"; ios_diag; return 1; fi',
    '  if [ "${rc}" -ne 0 ]; then tail -n 40 "${log}" | LC_ALL=C cut -c1-300 || true; IOS_WHY="操作・表示の確認が通らない（maestro の終了コード ${rc}）"; return 1; fi',
    '}',
    // 撮った後の確認（致命にしない版）。だめなら画像を消して 1 を返す（残った画像を撮影として数えない）
    'ios_verify_shot_soft() {',
    '  local f="${1}"',
    '  if ! ios_alive "${IOS_PID}"; then mv -f "${f}" "${f%.png}.rejected.png" 2>/dev/null || rm -f "${f}"; IOS_WHY="撮影の後にアプリが動いていない（診断を出した）"; ios_diag; return 1; fi',
    '  if [ -s "${IOS_BASE}" ]; then if cmp -s "${IOS_BASE}" "${f}"; then mv -f "${f}" "${f%.png}.rejected.png" 2>/dev/null || rm -f "${f}"; IOS_WHY="ホーム画面と同じ画像"; return 1; fi; fi',
    '}',
    // 操作と表示の確認が通り、撮れた画面の印（job-run はこの印のある画面だけを「操作の後の撮影」として記録する）
    'ios_mark_interacted() { if [ -n "${IOS_DONE_FILE:-}" ]; then printf \'%s\\n\' "${1}" >> "${IOS_DONE_FILE}"; fi; }',
    // 撮った後：アプリが同じプロセスで動いているか・ホーム画面と同じ画像でないか。だめなら .rejected.png へ移して止める（結果の撮影には数えない）。
    // ホーム画面と同じ時は15秒後にもう1枚撮る（後から前面に出た＝待機・描画の遅れ、のままホーム画面＝背面・終了、を絵で分ける）
    'ios_verify_shot() {',
    '  local f="${1}" late',
    '  if ! ios_alive "${IOS_PID}"; then mv -f "${f}" "${f%.png}.rejected.png" 2>/dev/null || true; ios_fail 23 "撮影の後にアプリ（pid ${IOS_PID:-?}）が動いていない：${f}"; fi',
    '  if [ -s "${IOS_BASE}" ]; then if cmp -s "${IOS_BASE}" "${f}"; then',
    '    mv -f "${f}" "${f%.png}.rejected.png" 2>/dev/null || true',
    '    late="${f%.png}.rejected-late.png"; sleep "${IOS_LATE_SECONDS:-15}"',
    '    xcrun simctl io "${IOS_DEV}" screenshot --type=png "${late}" >/dev/null 2>&1 || true',
    '    if [ ! -s "${late}" ]; then late="遅れての撮影ができない"; elif cmp -s "${IOS_BASE}" "${late}"; then late="遅れての撮影もホーム画面（アプリは前面に出ていない）"; else late="遅れての撮影はホーム画面と違う（前面に出るのが遅れた可能性）"; fi',
    '    echo "[ios] ${late}"',
    '    ios_fail 24 "ホーム画面と同じ画像：${f}・${late}"',
    '  fi; fi',
    '}',
  ].join('\n');
}

/**
 * 撮影手順（コマンド列）を作る。
 * opts: { device, bundleId, scheme, screens:[{id, deepLink, settleMs}], locale, outDir, statusBar, fixtureDb, dbRelPath, appearance, appPath, aliveSeconds }
 */
export function planIosCapture(opts) {
  if (!/^[A-Za-z0-9.-]+$/.test(String(opts.bundleId))) throw new Error(`bundleId の形が正しくない：${opts.bundleId}`);
  const dev = shellQuote(opts.device);
  const bid = shellQuote(opts.bundleId);
  const app = opts.appPath ? shellQuote(opts.appPath) : null;
  const exeName = opts.appPath ? path.posix.basename(String(opts.appPath).replace(/\\/g, '/').replace(/\/+$/, ''), '.app') : null;
  const exe = exeName && /^[A-Za-z0-9._-]+$/.test(exeName) ? exeName : null;
  const steps = [];
  const add = (cmd, note) => steps.push({ cmd, note });
  // ホーム画面の基準が静止しない時に続けてよいか（別の画面との比較で守れるか）は、必ず撮る画面の数で決める。
  // 操作が要る画面は飛ばされ得るので数えない（独立検収 S2：[履歴, 換算] で換算が飛ぶと、履歴1枚が守られないまま残る）
  const screenCount = opts.screens.filter((s) => s.deepLink && !s.interact).length;
  add(helperScript({ dev, bundleId: opts.bundleId, exe, aliveSeconds: opts.aliveSeconds ?? 10, screenCount, shotDir: opts.outDir }), '確認・診断の関数を用意する');
  add(`xcrun simctl boot ${dev} 2>/dev/null || true`, 'シミュレーターを起動（起動済みなら何もしない）');
  add(`xcrun simctl bootstatus ${dev} -b`, '起動完了を待つ');
  if (app) {
    // Release の build は JS をアプリへ同梱する。無い・空なら起動してもすぐ終わるので、撮影の前に止める
    add(
      `if [ ! -s ${app}/main.jsbundle ]; then ls -la ${app} | head -n 60 || true; ios_stop 20 'ビルドしたアプリに JS の本体（main.jsbundle）が無い・空'; fi`,
      'ビルドしたアプリに JS の本体が同梱されていることを確かめる',
    );
    add(`echo "[ios] main.jsbundle：$(wc -c < ${app}/main.jsbundle | tr -d ' ') バイト"`, 'JS の本体の大きさを表示');
    add(
      `IOS_APP_BID="$(plutil -extract CFBundleIdentifier raw -o - ${app}/Info.plist 2>/dev/null || true)"; if [ "\${IOS_APP_BID}" != ${bid} ]; then ios_stop 20 "ビルドしたアプリの Bundle ID（\${IOS_APP_BID}）がジョブ（${opts.bundleId}）と違う"; fi`,
      'ビルドしたアプリの Bundle ID がジョブと一致することを確かめる',
    );
    add(`xcrun simctl install ${dev} ${app}`, 'シミュレーター向けにbuildしたアプリを入れる（.app）');
  }
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
  add(`xcrun simctl terminate ${dev} ${bid} 2>/dev/null || true`, 'アプリを止める');
  add(
    `xcrun simctl privacy ${dev} grant all ${bid} 2>/dev/null || true`,
    '権限の確認の窓が撮影に写らないように、シミュレーター内のこのアプリへ許可を与える（非対応の版では何もしない）',
  );
  if (opts.scheme) {
    // simctl openurl は独自スキームで「"アプリ"で開きますか？」の確認を出し、撮影にそれが写る（2026-11-21 の GitHub Actions の実行で発生）。
    // シミュレーター内の LaunchServices の承認（人が一度「開く」を押した時と同じ値）を先に書く。Apple の文書には無い設定（Expo CLI も同じ値を書く）
    add(
      `xcrun simctl spawn ${dev} defaults write com.apple.launchservices.schemeapproval ${shellQuote(`com.apple.CoreSimulator.CoreSimulatorBridge-->${opts.scheme}`)} -string ${bid}`,
      `ディープリンク（${opts.scheme}://）の確認の窓を出さないよう、シミュレーター内で承認しておく`,
    );
  }
  add('ios_probe', '試しの起動（テストデータを入れる前。失敗しても止めずに診断を出す）');
  add('ios_baseline', 'アプリを止めた後のホーム画面を基準として撮る（撮影の出力先の外）');
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
  add(
    'ios_launch || ios_fail $? "${IOS_WHY}"',
    `アプリを起動し、${opts.aliveSeconds ?? 10}秒のあいだ動き続けることを確かめる（落ちたら撮影せずに診断を出して止める）`,
  );
  add(`mkdir -p ${shellQuote(opts.outDir)}`, '保存先');
  // 操作が要る画面は最後に撮る（操作の道具の準備・失敗が、他の画面の撮影に影響しないように）
  const linked = opts.screens.filter((s) => s.deepLink);
  const ordered = [...linked.filter((s) => !s.interact), ...linked.filter((s) => s.interact)];
  let warmed = false;
  for (const s of ordered) {
    if (!/^[A-Za-z0-9._-]+$/.test(String(s.id))) throw new Error(`画面 id の形が正しくない：${s.id}`); // 理由の文（二重引用の中）に入れるため
    const file = shellQuote(`${opts.outDir}/${s.id}.png`);
    const settle = Math.max(1, Math.round((s.settleMs ?? 1500) / 1000));
    if (s.interact) {
      if (!warmed) add(heredoc('${IOS_TMP}/flow-warmup.yaml', maestroWarmupFlow(opts.bundleId)), '操作の道具を動かし始めるフロー');
      warmed = true;
      add(heredoc(`\${IOS_TMP}/flow-${s.id}.yaml`, maestroFlow({ bundleId: opts.bundleId, interact: s.interact, deepLink: s.deepLink })), `画面 ${s.id} の操作と、結果の表示の確認のフロー`);
      const id = shellQuote(s.id);
      add([
        // 前の試行の画像が残っていると、今回の操作が失敗しても撮れたものとして数えてしまう（独立検収 S1）
        `rm -f ${file}`,
        `if ! ios_maestro_ready; then ios_skip ${id} "\${IOS_WHY}"`,
        `elif ! xcrun simctl openurl ${dev} ${shellQuote(s.deepLink)}; then ios_skip ${id} '画面を開く命令が失敗した'`,
        `elif ! { sleep ${settle}; ios_alive "\${IOS_PID}"; }; then ios_diag; ios_skip ${id} '画面を開いた後にアプリが動いていない（診断を出した）'`,
        `elif ! ios_interact ${id} "\${IOS_TMP}/flow-${s.id}.yaml" ${s.interact.timeoutSeconds ?? 300}; then rm -f ${file}; ios_skip ${id} "\${IOS_WHY}"`,
        `elif ! xcrun simctl io ${dev} screenshot --type=png ${file}; then rm -f ${file}; ios_skip ${id} '撮る命令が失敗した'`,
        `elif ! ios_verify_shot_soft ${file}; then ios_skip ${id} "\${IOS_WHY}"`,
        `else ios_mark_interacted ${id}; echo '[ios] 画面 ${s.id}：操作と表示の確認が通り、撮った'; fi`,
      ].join('\n'), `画面 ${s.id} を開き、操作して、表示を確かめてから撮る（失敗はこの画面だけ撮らずに続ける）`);
      continue;
    }
    add(`xcrun simctl openurl ${dev} ${shellQuote(s.deepLink)} || ios_fail 27 "画面 ${s.id} を開く命令が失敗した（simctl の終了コード \${?}）"`, `画面 ${s.id} を開く`);
    add(`sleep ${settle}`, '描画を待つ');
    add(`ios_require_alive ${shellQuote(s.id)}`, `撮る前にアプリが同じプロセスで動いていることを確かめる`);
    add(`xcrun simctl io ${dev} screenshot --type=png ${file} || ios_fail 27 "画面 ${s.id} を撮る命令が失敗した（simctl の終了コード \${?}）"`, `画面 ${s.id} を撮る`);
    add(`ios_verify_shot ${file}`, `撮った後：アプリが動いている・ホーム画面と同じ画像でないことを確かめる`);
  }
  add(`xcrun simctl status_bar ${dev} clear`, 'ステータスバーを戻す');
  return steps;
}

const HEREDOC_END = 'STORE_ASSETS_FLOW_EOF';

/** ファイルを書く（引用付きの区切りなので、中身の $ や ` は展開しない）。 */
function heredoc(target, content) {
  if (content.split('\n').includes(HEREDOC_END)) throw new Error('フローの中身に区切りの行がある');
  return `cat > "${target}" <<'${HEREDOC_END}'\n${content.replace(/\n$/, '')}\n${HEREDOC_END}`;
}

/** 手順をシェルスクリプトにする（Macで人が実行する用）。 */
export function planToShellScript(steps, header = '') {
  const lines = [
    '#!/bin/bash', '# 自動生成：tools/store-assets（iOSシミュレーター撮影）', header,
    '# 失敗の時にクラッシュの記録の要点を出すには、実行の前に IOS_IPS_TOOL=<repo>/tools/store-assets/engine/drivers/ips-summary.mjs を設定する',
    'set -euo pipefail', '',
  ];
  for (const s of steps) lines.push(`# ${s.note}`, s.cmd, '');
  return lines.join('\n');
}

/**
 * 手順を1本のシェルで実行するスクリプトにする（手順の間で変数を引き継ぐ。例：DATA_DIR）。各手順の前に説明を表示する。
 * 手順を別々のシェルで実行すると、前の手順で決めた変数が次の手順で空になる
 */
export function planToRunScript(steps) {
  const lines = ['set -euo pipefail'];
  for (const s of steps) lines.push(`echo ${shellQuote(`[ios] ${s.note}`)}`, s.cmd);
  return lines.join('\n');
}

/** macOSで手順を実行する。macOS以外では例外。deadline（ms の時刻）を過ぎたら止める（シェルごと打ち切る）。 */
export async function runIosPlan(steps, log = console.log, { deadline = Infinity } = {}) {
  if (process.platform !== 'darwin') {
    throw new Error('iOSシミュレーターの撮影はmacOSでのみ実行できます。`plan-ios` で手順を書き出してMacで実行してください');
  }
  const { execFileSync } = await import('node:child_process');
  const fs = await import('node:fs');
  const os = await import('node:os');
  const left = deadline - Date.now();
  if (left <= 0) throw new Error('実行の時間の上限を超えた（maxRuntimeMinutes）');
  log(`[ios] 手順 ${steps.length}件を1本のシェルで実行する`);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-ios-reason-'));
  const reasonFile = path.join(tmp, 'reason.txt');
  const skipFile = path.join(tmp, 'skipped.tsv');
  const doneFile = path.join(tmp, 'interacted.txt');
  try {
    execFileSync('/bin/bash', ['-c', planToRunScript(steps)], {
      stdio: 'inherit',
      timeout: Number.isFinite(left) ? left : undefined,
      env: { ...process.env, IOS_IPS_TOOL: IPS_TOOL, IOS_REASON_FILE: reasonFile, IOS_SKIP_FILE: skipFile, IOS_DONE_FILE: doneFile },
    });
    const read = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } };
    return { skipped: parseSkipped(read(skipFile)), interacted: parseInteracted(read(doneFile)) };
  } catch (e) {
    let reason = null;
    try { reason = fs.readFileSync(reasonFile, 'utf8'); } catch { /* 理由を書く前に止まった */ }
    throw new Error(iosFailureReason(e, reason));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/** 操作と表示の確認が通って撮れた画面の印（1行に画面ID）を読む。画面IDの形でない行は捨てる。 */
export function parseInteracted(text) {
  return [...new Set(String(text ?? '').split('\n').map((l) => l.trim()).filter((l) => /^[A-Za-z0-9._-]+$/.test(l)))];
}

/** 撮らなかった画面の記録（1行に「画面ID<TAB>理由」）を読む。 */
export function parseSkipped(text) {
  return String(text ?? '').split('\n').filter((l) => l.includes('\t')).map((l) => {
    const [screen, ...rest] = l.split('\t');
    return { screen: screen.trim(), reason: rest.join(' ').trim().slice(0, 300) };
  });
}

/**
 * シェルの失敗を理由の文にする（result.json の error は1行目しか残らないため、
 * 「Command failed: /bin/bash -c set -euo pipefail」では何が起きたか分からなかった）。
 */
export function iosFailureReason(e, reason = null) {
  const timedOut = e?.code === 'ETIMEDOUT' || (e?.signal && e?.status == null);
  const head = reason ? String(reason).split('\n')[0].trim() : '';
  if (head) return `${head}（終了コード ${e?.status ?? '?'}${timedOut ? '・時間の上限' : ''}）`;
  if (timedOut) return `実行の時間の上限を超えた、または止められた（${e.signal ?? e.code}）`;
  // 理由が書かれていない＝確認のゲートではなく、途中の命令（simctl 等）がそのまま失敗した。番号から理由を推測しない
  return `iOSの撮影の手順が失敗した（終了コード ${e?.status ?? '?'}。直前の [ios] の行の手順で止まった）`;
}
