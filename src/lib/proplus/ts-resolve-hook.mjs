// テスト専用：拡張子なしの相対import（'./places-core'）を同じフォルダの .ts へ解決するNodeの解決フック。
// アプリ（Metro・tsc）は拡張子なしで解決するため、コアどうしが値をimportするモジュールを `node --test` で読む時だけ使う。
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

export async function resolve(specifier, context, next) {
  if ((specifier.startsWith('./') || specifier.startsWith('../')) && !/\.[cm]?[jt]sx?$/.test(specifier) && context.parentURL) {
    const url = new URL(`${specifier}.ts`, context.parentURL);
    if (fs.existsSync(fileURLToPath(url))) return { url: url.href, shortCircuit: true };
  }
  return next(specifier, context);
}
