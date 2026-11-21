// Node のモジュール解決フック：アプリの `@/` 別名と拡張子なしのTypeScript importを src/ へ解決する。
// テストデータDBの生成（build-fixture-db.mjs）でアプリ本体のコードを読み込むためだけに使う。
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SRC = new URL('../../../../src/', import.meta.url);
const EXTS = ['.ts', '.tsx', '.mjs', '.js', '/index.ts'];

function tryFile(base) {
  for (const ext of ['', ...EXTS]) {
    const p = fileURLToPath(base) + ext;
    if (fs.existsSync(p) && fs.statSync(p).isFile()) return pathToFileURL(p).href;
  }
  return null;
}

export async function resolve(specifier, context, next) {
  if (specifier.startsWith('@/')) {
    const hit = tryFile(new URL(specifier.slice(2), SRC));
    if (hit) return { url: hit, shortCircuit: true };
  }
  if ((specifier.startsWith('./') || specifier.startsWith('../')) && context.parentURL?.startsWith(SRC.href)) {
    const hit = tryFile(new URL(specifier, context.parentURL));
    if (hit) return { url: hit, shortCircuit: true };
  }
  return next(specifier, context);
}
