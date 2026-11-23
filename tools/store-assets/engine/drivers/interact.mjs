// 画面の操作（入力・タップ）と、操作の結果の確認。アプリに依存しない共通部分で、すべて純粋関数。
//
// simctl には tap・文字入力の命令が無い。金額の入力などは、実際の画面操作で行う（アプリの値を外から書き換えない・
// 撮影専用の経路をアプリに足さない）ため、accessibility で操作する道具 Maestro（https://docs.maestro.dev。
// 版を固定して入れる）を使う。ここでは profile の `capture.screens[].interact` から Maestro のフロー（YAML）を作るだけで、実行は
// ios-simulator.mjs の手順（ios_interact）が行う。
//
// 操作の後は、期待する表示（expectVisible）がある・出てはいけない表示（expectNotVisible）が無いことを Maestro で確かめる。
// 確かめられなければその画面は撮らない（「金額 0 のまま」等を撮らない）。失敗は致命にせず、理由を残して他の画面の撮影を続ける。

import crypto from 'node:crypto';

/** profile で使える操作の命令（Maestro の命令名）。これ以外は設定の読み込みで止める。 */
export const INTERACT_COMMANDS = ['tapOn', 'inputText', 'eraseText', 'hideKeyboard', 'waitForAnimationToEnd', 'scroll', 'swipe'];

const isInt = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;
// Maestro は文字の中の ${…} を JavaScript として評価する。設定の値には入れさせない
const plainText = (v, max = 200) => typeof v === 'string' && v.length > 0 && v.length <= max && !v.includes('${');

/** 操作1つの値の検査（命令ごとに許す形を決める）。問題の文を返す（null なら合格）。 */
export function checkStepValue(cmd, v) {
  switch (cmd) {
    case 'tapOn':
      if (plainText(v)) return null;
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        const keys = Object.keys(v);
        const ok = keys.length > 0 && keys.every((k) => ['id', 'text', 'index'].includes(k))
          && (v.id === undefined || plainText(v.id)) && (v.text === undefined || plainText(v.text))
          && (v.index === undefined || isInt(v.index, 0, 50)) && (v.id !== undefined || v.text !== undefined);
        return ok ? null : 'tapOn は文字か { id | text [, index] }';
      }
      return 'tapOn は文字か { id | text [, index] }';
    case 'inputText': return plainText(v) ? null : 'inputText は200文字以内の文字（${ を含まない）';
    case 'eraseText': return v === true || isInt(v, 1, 100) ? null : 'eraseText は true か 1〜100';
    case 'hideKeyboard':
    case 'scroll': return v === true ? null : `${cmd} は true`;
    case 'waitForAnimationToEnd': return v === true || (v && typeof v === 'object' && Object.keys(v).join() === 'timeout' && isInt(v.timeout, 100, 30000)) ? null : 'waitForAnimationToEnd は true か { timeout: 100〜30000 }';
    case 'swipe': return v && typeof v === 'object' && Object.keys(v).join() === 'direction' && ['UP', 'DOWN', 'LEFT', 'RIGHT'].includes(v.direction) ? null : 'swipe は { direction: UP|DOWN|LEFT|RIGHT }';
    default: return `使えない操作：${cmd}`;
  }
}

/** 確かめる表示（expectVisible／expectNotVisible）の文字。 */
export function checkExpectText(v) {
  return plainText(v) ? null : '確かめる表示は200文字以内の文字（${ を含まない）';
}

/** Maestro の文字の照合は正規表現。文言をそのままの文字として照合するために、正規表現の記号を逃がす。 */
export function regexLiteral(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// 照合に使う文字（tapOn の文字・text・id。Maestro ではどれも正規表現）は逃がす。座標・数値はそのまま。
function stepValue(cmd, v) {
  if (cmd === 'tapOn') {
    if (typeof v === 'string') return regexLiteral(v);
    if (v && typeof v === 'object') {
      const out = { ...v };
      for (const k of ['text', 'id']) if (typeof out[k] === 'string') out[k] = regexLiteral(out[k]);
      return out;
    }
  }
  return v;
}

/** 操作の設定の指紋（`$` で始まる注記は除く）。撮影に残し、設定（金額・確かめる表示）が変わった後に古い撮影を使わない。 */
export function interactHash(interact) {
  const strip = (x) => (Array.isArray(x) ? x.map(strip) : x && typeof x === 'object'
    ? Object.fromEntries(Object.keys(x).filter((k) => !k.startsWith('$')).sort().map((k) => [k, strip(x[k])])) : x);
  return crypto.createHash('sha256').update(JSON.stringify(strip(interact))).digest('hex').slice(0, 16);
}

/**
 * Maestro のフロー（YAML）を作る。値は JSON で書く（JSON は YAML として読める。引用・改行の取り違えが起きない）。
 * 起動（launchApp）はしない：動いているアプリをそのまま操作する（プロセスが替わると撮影の確認が止める）。
 * deepLink があれば最初に開き直す（道具の起動でアプリが前面から外れても、撮る画面へ戻す。独立検収 S7）。
 */
export function maestroFlow({ bundleId, interact, deepLink = null }) {
  if (!/^[A-Za-z0-9.-]+$/.test(String(bundleId))) throw new Error(`bundleId の形が正しくない：${bundleId}`);
  const lines = [`appId: ${bundleId}`, '---'];
  if (deepLink) lines.push(`- openLink: ${JSON.stringify(String(deepLink))}`, '- waitForAnimationToEnd: {"timeout":3000}');
  for (const st of interact.steps) {
    const [cmd] = Object.keys(st);
    if (!INTERACT_COMMANDS.includes(cmd)) throw new Error(`使えない操作：${cmd}`);
    const v = st[cmd];
    const bad = checkStepValue(cmd, v);
    if (bad) throw new Error(bad);
    lines.push(v === true || v === null ? `- ${cmd}` : `- ${cmd}: ${JSON.stringify(stepValue(cmd, v))}`);
  }
  for (const k of ['expectVisible', 'expectNotVisible']) {
    // 文字のまま渡すと1文字ずつの確認になり、必ず通ってしまう（独立検収 S4）
    if (interact[k] !== undefined && !Array.isArray(interact[k])) throw new Error(`${k} は文字の配列`);
  }
  for (const t of [...(interact.expectVisible ?? []), ...(interact.expectNotVisible ?? [])]) {
    const bad = checkExpectText(t);
    if (bad) throw new Error(bad);
  }
  for (const t of interact.expectVisible ?? []) lines.push(`- assertVisible: ${JSON.stringify(regexLiteral(t))}`);
  for (const t of interact.expectNotVisible ?? []) lines.push(`- assertNotVisible: ${JSON.stringify(regexLiteral(t))}`);
  return `${lines.join('\n')}\n`;
}

/** 操作の道具を動かし始めるだけのフロー（初回は道具の準備に時間がかかるので、撮る画面を開く前に済ませる）。 */
export function maestroWarmupFlow(bundleId) {
  return maestroFlow({ bundleId, interact: { steps: [{ waitForAnimationToEnd: { timeout: 1000 } }] } });
}
