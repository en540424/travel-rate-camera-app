// 画面に出る日本語の直書きを数える（GX-03・2026-11-28）。
//   node scripts/i18n/ja-literals.mjs            … ファイルごとの件数と基準値との差を出す
//   node scripts/i18n/ja-literals.mjs --update   … 基準値（src/i18n/ja-literals-baseline.json）を今の件数で書き直す
// 数え方：TypeScript の字句解析で、文字列・テンプレート・JSX のテキストのうち日本語（かな・漢字）を含むもの。
// コメントは数えない。console.*／dbg の引数（開発者向けのログ）だけは数えない（Error の message は画面に出る経路があるので数える）。
// 辞書（src/i18n/dict/）とテストは対象外。日本語＝かな・漢字・CJK の句読点（「」・。〜）・全角の記号（（）！）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SRC = path.join(ROOT, 'src');
export const BASELINE_PATH = path.join(SRC, 'i18n', 'ja-literals-baseline.json');
// CJK の記号と句読点 U+3000–303F・かな U+3040–30FF・漢字 U+4E00–9FFF・全角の記号 U+FF00–FFEF
const JA_RANGES = [[0x3000, 0x303f], [0x3040, 0x30ff], [0x4e00, 0x9fff], [0xff00, 0xffef]];
const JA = new RegExp(`[${JA_RANGES.map(([a, b]) => String.fromCharCode(a) + '-' + String.fromCharCode(b)).join('')}]`);
const SKIP = [/^i18n\/dict\//, /\.test\.[cm]?[jt]sx?$/];

function listFiles(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) listFiles(p, out);
    else if (/\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

function isDeveloperMessage(node, sf) {
  let p = node.parent;
  for (let i = 0; i < 4 && p; i++, p = p.parent) {
    if (ts.isCallExpression(p) || ts.isNewExpression(p)) {
      return /^(console\.[a-z]+|dbg)$/.test(p.expression.getText(sf));
    }
  }
  return false;
}

export function countFile(file) {
  const src = fs.readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  let n = 0;
  (function visit(node) {
    let text = null;
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) text = node.text;
    else if (ts.isTemplateExpression(node)) text = node.head.text + node.templateSpans.map((s) => s.literal.text).join('');
    else if (ts.isJsxText(node)) text = node.text;
    if (text !== null && JA.test(text)) {
      if (!isDeveloperMessage(node, sf)) n++;
      if (ts.isTemplateExpression(node)) {
        // 埋め込み式の中の文言も数える（`${x ? '購入済み' : '候補'}`）
        for (const span of node.templateSpans) visit(span.expression);
        return;
      }
    }
    ts.forEachChild(node, visit);
  })(sf);
  return n;
}

export function scan() {
  const counts = {};
  for (const f of listFiles(SRC)) {
    const rel = path.relative(SRC, f).split(path.sep).join('/');
    if (SKIP.some((re) => re.test(rel))) continue;
    const n = countFile(f);
    if (n > 0) counts[rel] = n;
  }
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

export function readBaseline() {
  return fs.existsSync(BASELINE_PATH) ? JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8')) : {};
}

/** 基準値より増えたファイル（新しいファイルの直書きを含む） */
export function regressions(current, baseline) {
  return Object.entries(current)
    .filter(([f, n]) => n > (baseline[f] ?? 0))
    .map(([f, n]) => ({ file: f, count: n, baseline: baseline[f] ?? 0 }));
}

/** 基準値より減ったのに基準値を下げていないファイル（下げ忘れると、その分の新しい直書きが通ってしまう） */
export function staleBaselines(current, baseline) {
  return Object.entries(baseline)
    .filter(([f, n]) => (current[f] ?? 0) < n)
    .map(([f, n]) => ({ file: f, count: current[f] ?? 0, baseline: n }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const current = scan();
  if (process.argv.includes('--update')) {
    const up = regressions(current, readBaseline());
    if (up.length > 0 && !process.argv.includes('--allow-increase')) {
      for (const r of up) console.error(`増えた：${r.file} ${r.baseline} → ${r.count}`);
      console.error('基準値を上げるには --allow-increase が要る（新しい文言は翻訳キーで書く）');
      process.exit(1);
    }
    fs.writeFileSync(BASELINE_PATH, JSON.stringify(current, null, 2) + '\n');
    console.log(`基準値を更新：${Object.keys(current).length}ファイル・${Object.values(current).reduce((a, b) => a + b, 0)}か所`);
  } else {
    const base = readBaseline();
    const total = Object.values(current).reduce((a, b) => a + b, 0);
    const baseTotal = Object.values(base).reduce((a, b) => a + b, 0);
    console.log(`日本語の直書き：${total}か所（基準値 ${baseTotal}）`);
    for (const r of regressions(current, base)) console.log(`  増えた：${r.file} ${r.baseline} → ${r.count}`);
    for (const r of staleBaselines(current, base)) console.log(`  減った（--update で基準値を下げる）：${r.file} ${r.baseline} → ${r.count}`);
  }
}
