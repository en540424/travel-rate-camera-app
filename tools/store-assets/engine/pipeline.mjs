// 合成・検証・一覧。撮影記録（captures.json）と設定から出力を作り、manifest.json と index.html を書く。
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { flattenPng, hasTransparencyChunk, readPngInfo } from './png.mjs';
import { canUseSource, SOURCES } from './provenance.mjs';
import { checkCount, checkImageAgainstTarget, getTarget } from './specs.mjs';
import { adHtml, defaultAdLayout, escapeHtml, renderEmphasis, storeShotHtml } from './templates.mjs';
import { interactHash } from './drivers/interact.mjs';

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

/**
 * 掲載の並び（profile.storeSets）を、出力先・言語ごとの出力ファイルの順の一覧にする（純粋関数）。
 * 画像は複製しない（出力の部分集合を指すだけ）。作れなかった shot は missing に残す。
 */
export function storeSetsFor(profile, outputs, locales = profile.locales) {
  return (profile.storeSets ?? []).map((set) => ({
    id: set.id,
    title: set.title ?? null,
    lists: locales.flatMap((locale) => (profile.outputs?.store ?? []).map((target) => {
      const items = set.shots.map((e, i) => {
        const o = outputs.find((x) => x.kind === 'store' && x.target === target && x.locale === locale && x.shot === e.shot);
        return { order: i + 1, shot: e.shot, file: o?.file ?? null, sha256: o?.sha256 ?? null, reason: e.reason?.[locale] ?? '', sources: o?.sources ?? [] };
      });
      return { target, locale, items, missing: items.filter((x) => !x.file).map((x) => x.shot) };
    })),
  }));
}

/** final では、掲載の並びに作れなかった画像があることを問題にする（draft では一覧に出すだけ）。 */
export function storeSetProblems(mode, storeSets = []) {
  if (mode !== 'final') return [];
  return storeSets.flatMap((s) => s.lists.flatMap((l) => l.missing.map((shot) => `final: 掲載の並び ${s.id} の ${l.target} ${l.locale} に ${shot} が無い`)));
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

/**
 * 画面・言語ごとに、最も優先度の高い撮影記録を選ぶ。
 * screenDef（profile の capture.screens の1件）が操作（interact）を持つ画面は、操作と表示の確認が通った撮影（interacted）だけを使う
 * （2026-11-23 の5回目では換算の画面を金額 0 のまま撮っていた。操作の前の撮影を素材に使わない）。
 */
export function pickCapture(captures, screen, locale, screenDef = null, sources = null) {
  // 操作の設定（金額・確かめる表示）が撮影の後に変わったら、その撮影は使わない（指紋の一致。独立検収 N7）
  const hash = screenDef?.interact ? interactHash(screenDef.interact) : null;
  const list = captures.filter((c) => c.screen === screen && c.locale === locale
    && (!hash || (c.interacted === true && c.interactHash === hash))
    && c.verified !== false // 撮った後の確認で期待する表示が無かった撮影は使わない（確かめられなかった撮影は使い、一覧に「未確認」と出す）
    && (!sources || sources.includes(c.source)));
  list.sort((a, b) => SOURCE_PRIORITY.indexOf(a.source) - SOURCE_PRIORITY.indexOf(b.source));
  return list[0] ?? null;
}

/**
 * 出力の計画を作る（純粋関数）。どの画像をどの撮影から作るか、作れないものとその理由を決める。
 * 実際の描画はrenderPlanが行う。
 */
export const MAX_CROP_TOP = 0.12;

export function planOutputs(profile, captures, { mode = 'draft', locales, cropTop = 0 } = {}) {
  if (!(typeof cropTop === 'number' && cropTop >= 0 && cropTop <= MAX_CROP_TOP)) throw new Error(`cropTop は 0〜${MAX_CROP_TOP}（ステータスバーを隠す割合）`);
  const jobs = [];
  const skipped = [];
  const useLocales = locales ?? profile.locales;
  const watermarkText = profile.draftWatermark ?? 'DRAFT · Web preview · 提出不可';
  const screenDef = (id) => profile.capture?.screens?.find((s) => s.id === id) ?? null;
  const noCaptureReason = (shot) => {
    const id = shot.screen;
    const any = captures.filter((c) => c.screen === id);
    if (shot.sources && any.length && any.every((c) => !shot.sources.includes(c.source))) return `画面 ${id} は ${shot.sources.join('・')} の撮影が要る（${[...new Set(any.map((c) => c.source))].join('・')} の撮影は使わない）`;
    if (any.length && any.every((c) => c.verified === false)) {
      // 外した理由が記録にあればそれを出す（目視・取り込みの検査で外した撮影を「機械の確認で表示が無かった」と読み違えないように）
      const note = any.find((c) => typeof c.reviewNote === 'string' && c.reviewNote)?.reviewNote;
      return note ? `画面 ${id} は使わない：${note}` : `画面 ${id} は撮った後の確認で期待する表示が無かった（使わない）`;
    }
    if (screenDef(id)?.interact && any.length) return `画面 ${id} は今の操作の設定での操作の後の撮影が無い（操作の前・設定が変わる前の撮影は使わない）`;
    return `画面 ${id} の撮影が無い`;
  };
  // 撮った後の内容の確認が無い撮影（道具が無い・前の版の撮影）は使うが、人が目で確かめるよう注記する
  const unverifiedNotes = (caps) => caps.filter((c) => c.verified !== true).map((c) => `画面 ${c.screen} の内容は機械で未確認（目視で確かめる）`);
  const pick = (shot, locale) => pickCapture(captures, shot.screen, locale, screenDef(shot.screen), shot.sources ?? null);
  // callout は rect を測った端末の撮影にだけ重ねる（別の端末では位置がずれる。独立検収 S9）
  const calloutFor = (shot, cap) => (shot.callout && (!shot.callout.device || shot.callout.device === cap.device) ? shot.callout : null);

  for (const locale of useLocales) {
    for (const targetId of profile.outputs?.store ?? []) {
      const target = getTarget(targetId);
      for (const shot of profile.shots ?? []) {
        const cap = pick(shot, locale);
        if (!cap) { skipped.push({ target: targetId, locale, shot: shot.id, reason: noCaptureReason(shot) }); continue; }
        const use = canUseSource(cap.source, 'store', mode);
        if (!use.ok) { skipped.push({ target: targetId, locale, shot: shot.id, reason: use.reason }); continue; }
        const callout = calloutFor(shot, cap);
        jobs.push({
          kind: 'store', target, locale, shot: shot.id, captures: [cap], mode, cropTop,
          watermark: use.watermark ? watermarkText : null,
          title: shot.caption[locale].title, sub: shot.caption[locale].sub ?? '',
          label: shot.caption[locale].label ?? '', tone: shot.tone ?? 'light', layout: shot.layout ?? 'showcase', callout,
          notes: [...(shot.callout && !callout ? [`callout を省いた（${shot.callout.device} で測った位置。撮影は ${cap.device ?? '不明な端末'}）`] : []), ...unverifiedNotes([cap])],
          file: path.join('store', locale, targetId, `${shot.id}.png`),
        });
      }
    }
    for (const ad of profile.ads ?? []) {
      for (const targetId of ad.targets ?? []) {
        const target = getTarget(targetId);
        const layout = ad.layout?.[targetId] ?? defaultAdLayout(target.width, target.height);
        if (layout === 'flow') {
          // 手順の流れ：手順ごとに決めた画面の撮影を使う。1つでも無ければ作らない（手順が欠けた流れは見せない）
          const caps = [];
          const missing = [];
          let watermark = false;
          const stepsOut = [];
          for (const st of ad.steps ?? []) {
            const shot = profile.shots.find((s) => s.id === st.shot);
            const cap = pick(shot, locale);
            if (!cap) { missing.push(`${st.shot}：${noCaptureReason(shot)}`); continue; }
            const use = canUseSource(cap.source, 'ad', mode);
            if (!use.ok) { missing.push(`${st.shot}：${use.reason}`); continue; }
            watermark ||= use.watermark;
            let i = caps.indexOf(cap);
            if (i < 0) { caps.push(cap); i = caps.length - 1; }
            stepsOut.push({ image: i, shot: st.shot, rect: st.rect ?? null, text: st.text?.[locale] ?? '' });
          }
          if (missing.length || !caps.length) { skipped.push({ target: targetId, locale, ad: ad.id, reason: `手順の撮影が無い：${missing.join('・')}` }); continue; }
          jobs.push({
            kind: 'ad', target, locale, ad: ad.id, captures: caps, mode, layout, cropTop, steps: stepsOut,
            tone: ad.tone?.[targetId] ?? ad.tone?.default ?? 'light',
            watermark: watermark ? watermarkText : null,
            headline: ad.headline[locale], sub: ad.sub?.[locale] ?? '', badge: ad.badge?.[locale] ?? '', points: [],
            notes: unverifiedNotes(caps),
            file: path.join('ads', locale, targetId, `${ad.id}.png`),
          });
          continue;
        }
        const max = ad.maxPhones ?? (['split', 'story'].includes(layout) ? 2 : 1);
        // ad.shots は優先順の候補。撮影がある・使える撮影元のものを先頭から max 台まで使う（1台も無ければ作らない）。
        // 使えなかった候補は manifest と一覧に残す（代わりの画面で作ったことを人が確かめられるように。独立検収 S8）
        const caps = [];
        const unused = [];
        let watermark = false;
        for (const sid of ad.shots ?? []) {
          if (caps.length >= max) break;
          const shot = profile.shots.find((s) => s.id === sid);
          const cap = pick(shot, locale);
          if (!cap) { unused.push(`${sid}：${noCaptureReason(shot)}`); continue; }
          const use = canUseSource(cap.source, 'ad', mode);
          if (!use.ok) { unused.push(`${sid}：${use.reason}`); continue; }
          watermark ||= use.watermark;
          caps.push(cap);
        }
        if (!caps.length) { skipped.push({ target: targetId, locale, ad: ad.id, reason: unused.join('・') || '候補の画面が無い' }); continue; }
        jobs.push({
          kind: 'ad', target, locale, ad: ad.id, captures: caps, mode, layout, cropTop,
          tone: ad.tone?.[targetId] ?? ad.tone?.default ?? 'light',
          watermark: watermark ? watermarkText : null,
          headline: ad.headline[locale], sub: ad.sub?.[locale] ?? '', badge: ad.badge?.[locale] ?? '',
          points: (ad.points ?? []).map((pt) => pt.text?.[locale]).filter(Boolean),
          notes: [...unused.map((u) => `使えなかった候補 ${u}`), ...unverifiedNotes(caps)],
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
export function jobHtml(profile, job, images, imageAspect, { imageWidth = null, iconDataUrl = null, imageSizes = [] } = {}) {
  const { width, height } = job.target;
  const lang = profile.localeTags?.[job.locale] ?? job.locale;
  return job.kind === 'store'
    ? storeShotHtml({
      width, height, brand: profile.brand, title: renderEmphasis(job.title), sub: job.sub,
      imageDataUrl: images[0], watermark: job.watermark, imageAspect, imageWidth, lang,
      tone: job.tone, label: job.label, callout: job.callout, layout: job.layout, note: profile.disclaimer?.[job.locale] ?? '', cropTop: job.cropTop ?? 0,
    })
    : adHtml({
      width, height, brand: profile.brand, headline: renderEmphasis(job.headline), sub: job.sub,
      images, watermark: job.watermark, appName: profile.app.name?.[job.locale] ?? profile.app.name?.ja, badge: job.badge, lang,
      imageAspect, imageWidth, iconDataUrl, points: job.points, tone: job.tone, layout: job.layout, note: profile.disclaimer?.[job.locale] ?? '',
      cropTop: job.cropTop ?? 0, steps: job.steps ?? [], imageSizes,
    });
}

/** 描画に実際に使われたフォント（Chromium の CDP。見出しの要素）。取れなければ null。実行するマシンにより変わるので manifest に残す。 */
async function platformFonts(page, selector = 'h1') {
  let cdp = null;
  try {
    cdp = await page.context().newCDPSession(page);
    await cdp.send('DOM.enable');
    await cdp.send('CSS.enable');
    const { root } = await cdp.send('DOM.getDocument');
    const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector });
    if (!nodeId) return null;
    const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId });
    return fonts.map((f) => f.familyName);
  } catch {
    return null;
  } finally {
    await cdp?.detach().catch(() => {});
  }
}

/** profile.brand.icon（設定ファイルからの相対パスのPNG）を data URL にする。無ければ null。 */
export function brandIconDataUrl(profile) {
  const rel = profile.brand?.icon;
  if (!rel) return null;
  const abs = path.resolve(profile._dir ?? '.', rel);
  return fs.existsSync(abs) ? dataUrl(abs) : null;
}

/** 計画どおりにHTMLを描き、アルファを除いたPNGで保存する。 */
export async function renderPlan(profile, plan, runDir, playwright, log = console.log) {
  const browser = await playwright.chromium.launch();
  const outputs = [];
  const icon = brandIconDataUrl(profile);
  try {
    const page = await browser.newPage({ deviceScaleFactor: 1 });
    for (const job of plan.jobs) {
      const { width, height } = job.target;
      await page.setViewportSize({ width, height });
      const images = job.captures.map((c) => dataUrl(c.file));
      const sizes = job.captures.map((c) => readPngInfo(fs.readFileSync(c.file)));
      const firstInfo = sizes[0];
      const html = jobHtml(profile, job, images, firstInfo.height / firstInfo.width, { imageWidth: firstInfo.width, iconDataUrl: icon, imageSizes: sizes });
      await page.setContent(html, { waitUntil: 'load' });
      await page.evaluate(() => document.fonts?.ready);
      const fonts = await platformFonts(page);
      const raw = await page.screenshot({ type: 'png', fullPage: false });
      const png = flattenPng(raw, [255, 255, 255]);
      const abs = path.join(runDir, job.file);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, png);
      const info = readPngInfo(png);
      outputs.push({
        file: job.file, kind: job.kind, target: job.target.id, locale: job.locale, shot: job.shot ?? null, ad: job.ad ?? null,
        mode: job.mode, watermarked: Boolean(job.watermark), layout: job.layout, tone: job.tone, fonts, notes: job.notes ?? [],
        ...(job.cropTop ? { cropTop: job.cropTop } : {}),
        ...(job.steps ? { steps: job.steps.map((st) => ({ shot: st.shot, screen: job.captures[st.image].screen, rect: st.rect, text: st.text })) } : {}),
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
      <small>${o.width}×${o.height}</small>${(o.notes ?? []).map((n) => `<div class="note">${escapeHtml(n)}</div>`).join('')}</figcaption></figure>`;
  };
  const v = manifest.validation;
  const byFile = new Map(manifest.outputs.map((o) => [o.file, o]));
  const setSections = (manifest.storeSets ?? []).flatMap((s) => s.lists.map((l) => {
    const title = s.title?.[l.locale] ?? s.id;
    const items = l.items.map((it) => {
      const o = it.file ? byFile.get(it.file) : null;
      return `<li>${o ? card(o) : `<p class="ng">${escapeHtml(it.shot)}：作れなかった</p>`}<p class="reason"><b>${it.order}</b>${escapeHtml(it.reason)}</p></li>`;
    }).join('');
    return `<h2>${escapeHtml(title)}：${escapeHtml(l.target)} · ${escapeHtml(l.locale)}（${l.items.length - l.missing.length}/${l.items.length}枚）</h2>
      ${l.missing.length ? `<p class="ng">作れなかった：${escapeHtml(l.missing.join('・'))}</p>` : ''}<ol class="grid set">${items}</ol>`;
  })).join('');
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>${escapeHtml(manifest.app.id)} 素材一覧</title><style>
  body{font-family:system-ui,"Yu Gothic UI",sans-serif;margin:24px;background:#f6f7f7;color:#16211f}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:16px}
  figure{background:#fff;border-radius:10px;padding:10px;margin:0;box-shadow:0 1px 3px rgba(0,0,0,.08)}
  img{width:100%;border:1px solid #ddd;border-radius:6px} figcaption{font-size:12px;margin-top:6px}
  b{display:inline-block;margin:0 4px 4px 0;padding:1px 6px;border-radius:8px;font-weight:600;background:#eee}
  b.final{background:#d7f0e9} b.draft{background:#fde7c4} b.web{background:#f9d0d0} b.native{background:#d7e6fb}
  .note{color:#8a5a00;font-size:11px;margin-top:4px} .ng{color:#b00020} .ok{color:#0a766e} pre{white-space:pre-wrap;background:#fff;padding:8px;border-radius:8px}
  ol.set{list-style:none;padding:0} .reason{font-size:12px;margin:6px 0 0} .reason b{background:#0a766e;color:#fff}
  </style></head><body>
  <h1>${escapeHtml(manifest.app.id)} 素材一覧</h1>
  <p>生成：${escapeHtml(manifest.generatedAt)} ／ commit ${escapeHtml(manifest.git.commit)}${manifest.git.dirty ? '（未commitの変更あり）' : ''} ／ mode ${escapeHtml(manifest.mode)}</p>
  ${manifest.parentRun ? `<p>前の run（${escapeHtml(manifest.parentRun)}）との比較：<a href="compare.html">compare.html</a>（撮影は同じ画像。違いは合成だけ）</p>` : ''}
  <p class="${v.ok ? 'ok' : 'ng'}">検証：${v.ok ? '問題なし' : `問題 ${v.problems.length}件`}</p>
  ${v.problems.length ? `<pre>${escapeHtml(v.problems.join('\n'))}</pre>` : ''}
  ${manifest.skipped.length ? `<h2>作らなかったもの（${manifest.skipped.length}）</h2><pre>${escapeHtml(manifest.skipped.map((s) => `${s.target} ${s.locale} ${s.shot ?? s.ad}: ${s.reason}`).join('\n'))}</pre>` : ''}
  ${setSections}
  <h2>ストア用（全候補）</h2><div class="grid">${manifest.outputs.filter((o) => o.kind === 'store').map(card).join('')}</div>
  <h2>広告・SNS・LP用</h2><div class="grid">${manifest.outputs.filter((o) => o.kind === 'ad').map(card).join('')}</div>
  </body></html>`;
}

/**
 * 新旧の比較の一覧（compare.html）。前の run（parent）の出力と今回の出力を、出力先ごとに並べる（純粋関数）。
 * parentRel：今回の run から前の run への相対パス（例 ../20261123-023104-389990f）。前の run のファイルは参照するだけで変えない。
 */
export function compareHtml(parent, current, parentRel) {
  const targets = [...new Set([...parent.outputs, ...current.outputs].map((o) => o.target))];
  const img = (base, o) => {
    const src = `${base}${o.file.replace(/\\/g, '/')}`;
    return `<figure><a href="${escapeHtml(src)}"><img loading="lazy" src="${escapeHtml(src)}"></a><figcaption>${escapeHtml(o.shot ?? o.ad)}${o.layout ? ` · ${escapeHtml(o.layout)}` : ''}${o.tone ? ` · ${escapeHtml(o.tone)}` : ''}</figcaption></figure>`;
  };
  const rows = targets.map((t) => {
    const before = parent.outputs.filter((o) => o.target === t);
    const after = current.outputs.filter((o) => o.target === t);
    return `<section><h2>${escapeHtml(t)}（前 ${before.length}枚 → 今回 ${after.length}枚）</h2>
      <div class="cmp"><div><h3>前</h3><div class="row">${before.map((o) => img(`${parentRel}/`, o)).join('') || '<p>なし</p>'}</div></div>
      <div><h3>今回</h3><div class="row">${after.map((o) => img('', o)).join('') || '<p>なし</p>'}</div></div></div></section>`;
  }).join('');
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>${escapeHtml(current.app.id)} 新旧比較</title><style>
  body{font-family:system-ui,"Yu Gothic UI",sans-serif;margin:24px;background:#f6f7f7;color:#16211f}
  .cmp{display:grid;grid-template-columns:1fr 1fr;gap:16px}.cmp>div{background:#fff;border-radius:10px;padding:10px}
  .row{display:flex;flex-wrap:wrap;gap:10px;align-items:flex-start} figure{margin:0;width:200px} section{margin-bottom:28px}
  img{width:100%;border:1px solid #ddd;border-radius:6px} figcaption{font-size:12px} h3{margin:0 0 8px;font-size:14px}
  </style></head><body><h1>${escapeHtml(current.app.id)} 新旧比較</h1>
  <p>前：${escapeHtml(parentRel)}（commit ${escapeHtml(parent.git?.commit ?? '?')}）／今回：commit ${escapeHtml(current.git?.commit ?? '?')}${current.git?.dirty ? '（未commitの変更あり）' : ''}・mode ${escapeHtml(current.mode)}</p>
  <p>撮影は同じ画像（sha256 で照合して複製）。違いは合成のテンプレート・文言・構成だけ。</p>
  ${current.skipped?.length ? `<h2>今回作らなかったもの（${current.skipped.length}）</h2><pre>${escapeHtml(current.skipped.map((x) => `${x.target} ${x.shot ?? x.ad}: ${x.reason}`).join('\n'))}</pre>` : ''}
  ${rows}</body></html>`;
}
