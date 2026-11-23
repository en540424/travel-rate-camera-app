// 合成・検証・一覧。撮影記録（captures.json）と設定から出力を作り、manifest.json と index.html を書く。
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { flattenPng, hasTransparencyChunk, readPngInfo } from './png.mjs';
import { canUseSource, SOURCES } from './provenance.mjs';
import { checkCount, checkImageAgainstTarget, getTarget } from './specs.mjs';
import { adHtml, escapeHtml, renderEmphasis, storeShotHtml } from './templates.mjs';

// 同じ画面に複数の撮影元がある場合、実機に近いものを優先する
const SOURCE_PRIORITY = ['device', 'ios-simulator', 'android-emulator', 'web-preview'];

export function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/**
 * 撮影記録のうち、ファイルが記録時のsha256と一致するものだけを使う（撮影後に差し替えられた画像を使わない）。
 */
export function verifyCaptures(captures, readFile = fs.readFileSync) {
  const ok = [];
  const rejected = [];
  for (const c of captures) {
    let actual = null;
    try { actual = sha256(readFile(c.file)); } catch { /* 無い */ }
    if (actual && actual === c.sha256) ok.push(c);
    else rejected.push({ screen: c.screen, locale: c.locale, source: c.source, reason: actual ? '撮影後に画像が変更された（sha256不一致）' : '画像ファイルが無い' });
  }
  return { ok, rejected };
}

/**
 * finalの完全性：作れなかったストア用の画像（撮影が無い・Web版のみ等）と、出力が1枚も無いストアの出力先を問題にする。
 * draftでは問題にしない（作業途中の確認用のため）。
 */
export function completenessProblems(mode, storeTargets, skipped, outputs) {
  if (mode !== 'final') return [];
  const problems = skipped.filter((s) => s.shot).map((s) => `final: ${s.target} ${s.locale} ${s.shot} を作れない（${s.reason}）`);
  for (const t of storeTargets) {
    if (!outputs.some((o) => o.kind === 'store' && o.target === t)) problems.push(`final: ${t} の出力が1枚も無い`);
  }
  return problems;
}

/** final では draft のジョブで撮った画像を使わない（全画面を揃える final-candidate のジョブで撮り直す）。 */
export function excludeDraftJobCaptures(mode, verified) {
  if (mode !== 'final') return verified;
  const ok = [];
  const rejected = [...verified.rejected];
  for (const c of verified.ok) {
    if (c.job?.purpose === 'draft') rejected.push({ screen: c.screen, locale: c.locale, source: c.source, reason: 'draft のジョブの撮影（final には final-candidate のジョブが要る）' });
    else ok.push(c);
  }
  return { ok, rejected };
}

/** 画面・言語ごとに、最も優先度の高い撮影記録を選ぶ。 */
export function pickCapture(captures, screen, locale) {
  const list = captures.filter((c) => c.screen === screen && c.locale === locale);
  list.sort((a, b) => SOURCE_PRIORITY.indexOf(a.source) - SOURCE_PRIORITY.indexOf(b.source));
  return list[0] ?? null;
}

/**
 * 出力の計画を作る（純粋関数）。どの画像をどの撮影から作るか、作れないものとその理由を決める。
 * 実際の描画はrenderPlanが行う。
 */
export function planOutputs(profile, captures, { mode = 'draft', locales } = {}) {
  const jobs = [];
  const skipped = [];
  const useLocales = locales ?? profile.locales;
  const watermarkText = profile.draftWatermark ?? 'DRAFT · Web preview · 提出不可';

  for (const locale of useLocales) {
    for (const targetId of profile.outputs?.store ?? []) {
      const target = getTarget(targetId);
      for (const shot of profile.shots ?? []) {
        const cap = pickCapture(captures, shot.screen, locale);
        if (!cap) { skipped.push({ target: targetId, locale, shot: shot.id, reason: `画面 ${shot.screen} の撮影が無い` }); continue; }
        const use = canUseSource(cap.source, 'store', mode);
        if (!use.ok) { skipped.push({ target: targetId, locale, shot: shot.id, reason: use.reason }); continue; }
        jobs.push({
          kind: 'store', target, locale, shot: shot.id, captures: [cap], mode,
          watermark: use.watermark ? watermarkText : null,
          title: shot.caption[locale].title, sub: shot.caption[locale].sub ?? '',
          file: path.join('store', locale, targetId, `${shot.id}.png`),
        });
      }
    }
    for (const ad of profile.ads ?? []) {
      for (const targetId of ad.targets ?? []) {
        const target = getTarget(targetId);
        const caps = [];
        let reason = null;
        let watermark = false;
        for (const sid of ad.shots ?? []) {
          const shot = profile.shots.find((s) => s.id === sid);
          const cap = pickCapture(captures, shot.screen, locale);
          if (!cap) { reason = `画面 ${shot.screen} の撮影が無い`; break; }
          const use = canUseSource(cap.source, 'ad', mode);
          if (!use.ok) { reason = use.reason; break; }
          watermark ||= use.watermark;
          caps.push(cap);
        }
        if (reason) { skipped.push({ target: targetId, locale, ad: ad.id, reason }); continue; }
        jobs.push({
          kind: 'ad', target, locale, ad: ad.id, captures: caps, mode,
          watermark: watermark ? watermarkText : null,
          headline: ad.headline[locale], sub: ad.sub?.[locale] ?? '', badge: ad.badge?.[locale] ?? '',
          file: path.join('ads', locale, targetId, `${ad.id}.png`),
        });
      }
    }
  }
  return { jobs, skipped };
}

function dataUrl(file) {
  return `data:image/png;base64,${fs.readFileSync(file).toString('base64')}`;
}

/**
 * 1枚分のHTML（純粋関数）。言語（profile.localeTags。例 ja-JP）を必ず渡す：
 * 日本語の文節での改行（word-break:auto-phrase）は <html lang> が無いと黙って効かない。
 */
export function jobHtml(profile, job, images, imageAspect) {
  const { width, height } = job.target;
  const lang = profile.localeTags?.[job.locale] ?? job.locale;
  return job.kind === 'store'
    ? storeShotHtml({
      width, height, brand: profile.brand, title: renderEmphasis(job.title), sub: job.sub,
      imageDataUrl: images[0], watermark: job.watermark, imageAspect, lang,
    })
    : adHtml({
      width, height, brand: profile.brand, headline: renderEmphasis(job.headline), sub: job.sub,
      images, watermark: job.watermark, appName: profile.app.name?.[job.locale] ?? profile.app.name?.ja, badge: job.badge, lang,
    });
}

/** 計画どおりにHTMLを描き、アルファを除いたPNGで保存する。 */
export async function renderPlan(profile, plan, runDir, playwright, log = console.log) {
  const browser = await playwright.chromium.launch();
  const outputs = [];
  try {
    const page = await browser.newPage({ deviceScaleFactor: 1 });
    for (const job of plan.jobs) {
      const { width, height } = job.target;
      await page.setViewportSize({ width, height });
      const images = job.captures.map((c) => dataUrl(c.file));
      const firstInfo = readPngInfo(fs.readFileSync(job.captures[0].file));
      const html = jobHtml(profile, job, images, firstInfo.height / firstInfo.width);
      await page.setContent(html, { waitUntil: 'load' });
      await page.evaluate(() => document.fonts?.ready);
      const raw = await page.screenshot({ type: 'png', fullPage: false });
      const png = flattenPng(raw, [255, 255, 255]);
      const abs = path.join(runDir, job.file);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, png);
      const info = readPngInfo(png);
      outputs.push({
        file: job.file, kind: job.kind, target: job.target.id, locale: job.locale, shot: job.shot ?? null, ad: job.ad ?? null,
        mode: job.mode, watermarked: Boolean(job.watermark),
        sources: job.captures.map((c) => ({ screen: c.screen, source: c.source, sha256: c.sha256 })),
        width: info.width, height: info.height, sha256: sha256(png),
      });
      log(`[compose] ${job.file}`);
    }
  } finally {
    await browser.close();
  }
  return outputs;
}

/**
 * 出力を検証する。寸法・アルファ・枚数・撮影元（finalで透かし付き・Web版が無いか）。
 * 返り値：{ ok, problems[] }。finalの提出物に1件でも問題があればok=false。
 */
export function validateOutputs(runDir, outputs) {
  const problems = [];
  const counts = new Map();
  for (const o of outputs) {
    const abs = path.join(runDir, o.file);
    if (!fs.existsSync(abs)) { problems.push(`${o.file}: ファイルが無い`); continue; }
    const buf = fs.readFileSync(abs);
    if (sha256(buf) !== o.sha256) problems.push(`${o.file}: manifestと内容が違う（生成後に変更された）`);
    const info = readPngInfo(buf);
    const target = getTarget(o.target);
    for (const p of checkImageAgainstTarget(target, { ...info, hasAlpha: info.hasAlphaChannel || hasTransparencyChunk(buf) })) {
      problems.push(`${o.file}: ${p}`);
    }
    if (o.mode === 'final') {
      if (o.watermarked) problems.push(`${o.file}: finalなのに透かし付き`);
      for (const s of o.sources) if (!SOURCES[s.source]?.nativeUi) problems.push(`${o.file}: finalにネイティブでない撮影（${s.source}）`);
    }
    if (o.kind === 'store') {
      const key = `${o.target}|${o.locale}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  for (const [key, n] of counts) {
    const [targetId] = key.split('|');
    for (const p of checkCount(getTarget(targetId), n)) problems.push(`${key}: ${p}`);
  }
  return { ok: problems.length === 0, problems };
}

/** 最終確認用の一覧（index.html）。撮影元・draft/final・問題を併記する。 */
export function galleryHtml(manifest) {
  const card = (o) => {
    const badges = [
      `<b class="k">${escapeHtml(o.kind)}</b>`,
      `<b class="${o.mode}">${escapeHtml(o.mode)}</b>`,
      ...o.sources.map((s) => `<b class="${SOURCES[s.source]?.nativeUi ? 'native' : 'web'}">${escapeHtml(s.source)}</b>`),
    ].join('');
    return `<figure><a href="${escapeHtml(o.file.replace(/\\/g, '/'))}"><img loading="lazy" src="${escapeHtml(o.file.replace(/\\/g, '/'))}"></a>
      <figcaption>${badges}<div>${escapeHtml(o.target)} · ${escapeHtml(o.locale)} · ${escapeHtml(o.shot ?? o.ad)}</div>
      <small>${o.width}×${o.height}</small></figcaption></figure>`;
  };
  const v = manifest.validation;
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>${escapeHtml(manifest.app.id)} 素材一覧</title><style>
  body{font-family:system-ui,"Yu Gothic UI",sans-serif;margin:24px;background:#f6f7f7;color:#16211f}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:16px}
  figure{background:#fff;border-radius:10px;padding:10px;margin:0;box-shadow:0 1px 3px rgba(0,0,0,.08)}
  img{width:100%;border:1px solid #ddd;border-radius:6px} figcaption{font-size:12px;margin-top:6px}
  b{display:inline-block;margin:0 4px 4px 0;padding:1px 6px;border-radius:8px;font-weight:600;background:#eee}
  b.final{background:#d7f0e9} b.draft{background:#fde7c4} b.web{background:#f9d0d0} b.native{background:#d7e6fb}
  .ng{color:#b00020} .ok{color:#0a766e} pre{white-space:pre-wrap;background:#fff;padding:8px;border-radius:8px}
  </style></head><body>
  <h1>${escapeHtml(manifest.app.id)} 素材一覧</h1>
  <p>生成：${escapeHtml(manifest.generatedAt)} ／ commit ${escapeHtml(manifest.git.commit)}${manifest.git.dirty ? '（未commitの変更あり）' : ''} ／ mode ${escapeHtml(manifest.mode)}</p>
  <p class="${v.ok ? 'ok' : 'ng'}">検証：${v.ok ? '問題なし' : `問題 ${v.problems.length}件`}</p>
  ${v.problems.length ? `<pre>${escapeHtml(v.problems.join('\n'))}</pre>` : ''}
  ${manifest.skipped.length ? `<h2>作らなかったもの（${manifest.skipped.length}）</h2><pre>${escapeHtml(manifest.skipped.map((s) => `${s.target} ${s.locale} ${s.shot ?? s.ad}: ${s.reason}`).join('\n'))}</pre>` : ''}
  <h2>ストア用</h2><div class="grid">${manifest.outputs.filter((o) => o.kind === 'store').map(card).join('')}</div>
  <h2>広告・SNS・LP用</h2><div class="grid">${manifest.outputs.filter((o) => o.kind === 'ad').map(card).join('')}</div>
  </body></html>`;
}
