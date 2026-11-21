// 撮影ドライバ：Web版プレビュー（Windowsでも動く）。
// 実アプリのコードをWeb向けにbundleし、Playwright（Chromium）で指定画面へ遷移して撮る。
// 撮影元は 'web-preview' と記録する。iOSの見た目ではないので、ストア提出・公開用の素材には使えない（provenance.mjs）。
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ttf': 'font/ttf', '.otf': 'font/otf',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.wasm': 'application/wasm', '.ico': 'image/x-icon',
};

/** 静的ファイル（`expo export --platform web` の出力）をlocalhostの空きポートで配る。外部へは公開しない。 */
export function serveStatic(root) {
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent((req.url ?? '/').split('?')[0]);
    let file = path.join(root, urlPath);
    if (!file.startsWith(path.resolve(root))) { res.writeHead(403).end(); return; }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!fs.existsSync(file) && fs.existsSync(`${file}.html`)) file = `${file}.html`;
    if (!fs.existsSync(file)) file = path.join(root, 'index.html');
    res.setHeader('content-type', MIME[path.extname(file)] ?? 'application/octet-stream');
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ port: server.address().port, close: () => server.close() }));
  });
}

/** Web版をbundleする。projectRootはアプリのrepo。 */
export function exportWeb(projectRoot, outDir, log = console.log) {
  log(`[web-preview] expo export --platform web → ${outDir}`);
  const r = spawnSync('npx', ['expo', 'export', '--platform', 'web', '--output-dir', outDir], {
    cwd: projectRoot, stdio: 'inherit', shell: process.platform === 'win32',
  });
  if (r.status !== 0) throw new Error(`expo export が失敗しました（exit ${r.status}）`);
}

/**
 * 画面を撮る。返り値は撮影記録の配列（ファイルの書き込みは呼び出し側が渡したoutDir配下だけ）。
 * opts: { exportDir, viewport:{width,height,scale}, clock, timezone, locales, screens, outDir, chromium }
 */
export async function captureWeb(opts) {
  const { chromium } = opts.playwright;
  const server = await serveStatic(opts.exportDir);
  const browser = await chromium.launch();
  const records = [];
  try {
    for (const locale of opts.locales) {
      const context = await browser.newContext({
        viewport: { width: opts.viewport.width, height: opts.viewport.height },
        deviceScaleFactor: opts.viewport.scale ?? 3,
        locale: opts.localeTags?.[locale] ?? locale,
        timezoneId: opts.timezone,
        colorScheme: 'light',
        isMobile: true,
        hasTouch: true,
      });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(String(e).slice(0, 300)));
      // 「今日」が日によって変わらないよう時刻を固定する（再実行で同じ画像になるように）
      if (opts.clock) await page.clock.setFixedTime(new Date(opts.clock));
      for (const screen of opts.screens) {
        if (!screen.route) continue;
        await page.goto(`http://127.0.0.1:${server.port}${screen.route}`, { waitUntil: 'networkidle' });
        if (screen.waitForText) await page.getByText(screen.waitForText, { exact: false }).first().waitFor({ timeout: 15000 });
        await page.waitForTimeout(screen.settleMs ?? 800);
        const dir = path.join(opts.outDir, locale);
        fs.mkdirSync(dir, { recursive: true });
        const file = path.join(dir, `${screen.id}.png`);
        await page.screenshot({ path: file });
        records.push({ screen: screen.id, locale, source: 'web-preview', file, route: screen.route, pageErrors: [...errors] });
        errors.length = 0;
      }
      await context.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
  return records;
}
