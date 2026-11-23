// 画面の操作（入力・タップ）と、操作の結果の確認。アプリに依存しない共通部分で、すべて純粋関数。
//
// simctl には tap・文字入力の命令が無い。金額の入力などは、実際の画面操作で行う（アプリの値を外から書き換えない・
// 撮影専用の経路をアプリに足さない）ため、accessibility で操作する道具 Maestro（https://docs.maestro.dev。
// 版を固定して入れる）を使う。ここでは profile の `capture.screens[].interact` から Maestro のフロー（YAML）を作るだけで、実行は
// ios-simulator.mjs の手順（ios_interact）が行う。
//
// 操作の後は、期待する表示（expectVisible）がある・出てはいけない表示（expectNotVisible）が無いことを Maestro で確かめる。
// 確かめられなければその画面は撮らない（「金額 0 のまま」等を撮らない）。失敗は致命にせず、理由を残して他の画面の撮影を続ける。

/** profile で使える操作の命令（Maestro の命令名）。これ以外は設定の読み込みで止める。 */
export const INTERACT_COMMANDS = ['tapOn', 'inputText', 'eraseText', 'hideKeyboard', 'waitForAnimationToEnd', 'scroll', 'swipe'];

/** Maestro の文字の照合は正規表現。文言をそのままの文字として照合するために、正規表現の記号を逃がす。 */
export function regexLiteral(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// 照合に使う文字（tapOn の文字・text）は逃がす。id・座標・数値はそのまま。
function stepValue(cmd, v) {
  if (cmd === 'tapOn') {
    if (typeof v === 'string') return regexLiteral(v);
    if (v && typeof v === 'object' && typeof v.text === 'string') return { ...v, text: regexLiteral(v.text) };
  }
  return v;
}

/**
 * Maestro のフロー（YAML）を作る。値は JSON で書く（JSON は YAML として読める。引用・改行の取り違えが起きない）。
 * 起動（launchApp）はしない：シェルの手順がディープリンクで開いた、動いているアプリをそのまま操作する（プロセスが替わると撮影の確認が止める）。
 */
export function maestroFlow({ bundleId, interact }) {
  if (!/^[A-Za-z0-9.-]+$/.test(String(bundleId))) throw new Error(`bundleId の形が正しくない：${bundleId}`);
  const lines = [`appId: ${bundleId}`, '---'];
  for (const st of interact.steps) {
    const [cmd] = Object.keys(st);
    if (!INTERACT_COMMANDS.includes(cmd)) throw new Error(`使えない操作：${cmd}`);
    const v = st[cmd];
    lines.push(v === true || v === null ? `- ${cmd}` : `- ${cmd}: ${JSON.stringify(stepValue(cmd, v))}`);
  }
  for (const t of interact.expectVisible ?? []) lines.push(`- assertVisible: ${JSON.stringify(regexLiteral(t))}`);
  for (const t of interact.expectNotVisible ?? []) lines.push(`- assertNotVisible: ${JSON.stringify(regexLiteral(t))}`);
  return `${lines.join('\n')}\n`;
}

/** 操作の道具を動かし始めるだけのフロー（初回は道具の準備に時間がかかるので、撮る画面を開く前に済ませる）。 */
export function maestroWarmupFlow(bundleId) {
  return maestroFlow({ bundleId, interact: { steps: [{ waitForAnimationToEnd: { timeout: 1000 } }] } });
}
