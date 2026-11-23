// 合成テンプレート（HTML/CSS）。Playwrightで出力先の正確な寸法に描いてPNGにする。
// アプリ固有の値（色・文言・アプリ名・アイコン）は引数で受け、ここには書かない。
//
// 構成（2026-11-23 改訂。初の実画面の下書き10枚の目視で「背景が平板」「端末の中が小さい」「LPと横長広告が同じ」
// 「SNSでアプリ名が重複」「縦長の上下に大きな余白」と分かったため、用途ごとの配置に分けた）：
//   ストア用  layout 'showcase'（見出し＋端末を大きく。任意で画面の一部を等倍以下で拡大して重ねる callout）
//   広告用    layout 'split'（LP：左に文字と要点、右に端末2台）／'banner'（横長広告：短い見出し＋端末1台を大きく）
//            'square'（SNS：見出し＋端末1台）／'story'（縦長：見出し→端末→下帯のアプリ名の順に視線を流す）
//   色調      tone 'light'（淡い背景）／'deep'（濃いブランド色の背景に白文字）／'warm'（暖色の淡い背景）
// 画像の拡大：実画面は等倍を超えて拡大しない（callout も含む。撮影の解像度より細かい情報は作らない）。

const FONT_STACK = `"Hiragino Sans","Hiragino Kaku Gothic ProN","Noto Sans JP","Yu Gothic UI","Yu Gothic","Meiryo",system-ui,sans-serif`;

export const STORE_LAYOUTS = ['showcase'];
export const AD_LAYOUTS = ['split', 'banner', 'square', 'story'];
export const TONES = ['light', 'deep', 'warm'];

/** 出力先の形から既定の広告の配置を決める（profile で layout を指定すればそちらが優先）。 */
export function defaultAdLayout(width, height) {
  const r = width / height;
  if (r >= 1.6 && width >= 1600) return 'split';
  if (r > 1.2) return 'banner';
  if (r < 0.8) return 'story';
  return 'square';
}

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

/** <html> の言語の属性（例 ja-JP）。日本語の文節での改行（word-break:auto-phrase）は言語の指定が要る。 */
function langAttr(lang) {
  return lang ? ` lang="${escapeHtml(lang)}"` : '';
}

// 見出し・補足の改行：語の途中や助詞1文字だけの行で折らず（文節で改行）、行の長さをそろえる。
// 2026-11-23 の初の実画面の下書きで「…購入済み／を／…」「あとから見／返せる」のように折れていた
const TEXT_WRAP = 'word-break:auto-phrase;line-break:strict;text-wrap:balance';

/**
 * 色調ごとの色。ブランドの値（profile.brand）から作る。未指定の色は主色か中立の灰色・白・黒にする
 * （エンジンにアプリの色を持たない。独立検収 N1）。
 */
export function tonePalette(brand, tone = 'light') {
  const primary = brand.primary;
  const dark = brand.primaryDark ?? primary;
  if (tone === 'deep') {
    return {
      bg: `linear-gradient(165deg, ${brand.deep ?? dark} 0%, ${brand.deepAlt ?? brand.deep ?? dark} 100%)`,
      text: '#FFFFFF', em: brand.onDeepAccent ?? '#FFFFFF', sub: 'rgba(255,255,255,.86)',
      deco: 'rgba(255,255,255,.07)', checkText: brand.deepAlt ?? brand.deep ?? dark,
      chipBg: 'rgba(255,255,255,.16)', chipText: '#FFFFFF', brandText: '#FFFFFF',
      shadow: 'rgba(0,0,0,.38)',
    };
  }
  const warm = tone === 'warm' && brand.warm;
  const soft = brand.primarySoft ?? 'rgba(0,0,0,.05)';
  return {
    bg: `linear-gradient(170deg, ${warm ? brand.warm : (brand.background ?? '#F5F6F6')} 0%, ${brand.backgroundAlt ?? '#FFFFFF'} ${warm ? 78 : 82}%)`,
    text: brand.text ?? '#111111', em: primary, sub: brand.body ?? 'rgba(0,0,0,.62)',
    deco: warm ? (brand.accentSoft ?? 'rgba(0,0,0,.05)') : soft, checkText: '#FFFFFF',
    chipBg: warm ? (brand.accentSoft ?? soft) : soft,
    chipText: warm ? (brand.accentText ?? dark) : dark, brandText: dark,
    shadow: 'rgba(0,0,0,.24)',
  };
}

/**
 * 端末の幅を、画面が撮影の等倍を超えない幅に止める（独立検収 S5：呼び手の比率だけでは、小さい撮影・大きい出力先で拡大していた）。
 * imageWidth が無い時（寸法が分からない時）はそのまま。
 */
export function fitPhoneW(phoneW, imageWidth, unit, frameScale = 1) {
  if (!imageWidth) return phoneW;
  return Math.min(phoneW, imageWidth + unit * 1.5 * frameScale * 2);
}

function watermarkHtml(text) {
  if (!text) return '';
  return `<div class="wm"><span>${escapeHtml(text)}</span></div>`;
}

/** 背景の飾り：淡い円2つ（隅に置き、文字の読みやすさを妨げない。色調に合わせる）。 */
function decoHtml(w, h, pal, variant = 'a') {
  const u = Math.min(w, h) / 100;
  const [c1x, c1y, c2x, c2y] = variant === 'b' ? [w * 0.96, h * 0.05, w * 0.02, h * 0.82] : [w * 0.03, h * 0.04, w * 0.98, h * 0.62];
  return `<div class="deco" aria-hidden="true">
    <i style="left:${c1x - u * 30}px;top:${c1y - u * 30}px;width:${u * 60}px;height:${u * 60}px"></i>
    <i style="left:${c2x - u * 42}px;top:${c2y - u * 42}px;width:${u * 84}px;height:${u * 84}px"></i>
  </div>`;
}

function baseCss(w, h, pal) {
  const unit = Math.min(w, h) / 100;
  return `
  *{box-sizing:border-box;margin:0;padding:0}
  html,body{width:${w}px;height:${h}px;overflow:hidden}
  body{position:relative;font-family:${FONT_STACK};color:${pal.text};background:${pal.bg};-webkit-font-smoothing:antialiased}
  .deco{position:absolute;inset:0;pointer-events:none;z-index:0}
  .deco i{position:absolute;border-radius:50%;background:${pal.deco}}
  .deco svg{position:absolute;inset:0}
  .wrap{position:relative;z-index:1;width:100%;height:100%}
  h1{font-weight:800;letter-spacing:.01em;${TEXT_WRAP}}
  h1 em{font-style:normal;color:${pal.em}}
  p.sub{color:${pal.sub};font-weight:500;${TEXT_WRAP}}
  .chip{display:inline-block;border-radius:999px;background:${pal.chipBg};color:${pal.chipText};font-weight:700;letter-spacing:.04em}
  .brand{display:inline-flex;align-items:center;font-weight:700;color:${pal.brandText}}
  .brand img,.brand i{display:inline-block;flex:none;background:${pal.em}}
  .phone{position:relative;background:#0B0F0E;box-shadow:0 ${unit * 2}px ${unit * 6}px ${pal.shadow}}
  .phone>img{display:block;width:100%;height:auto}
  .callout{position:absolute;background-repeat:no-repeat;box-shadow:0 ${unit * 1.6}px ${unit * 5}px ${pal.shadow};border:${unit * 0.4}px solid #FFFFFF}
  .points{list-style:none}
  .points li{display:flex;align-items:flex-start;font-weight:600;color:${pal.text}}
  .points li b{flex:none;display:inline-flex;align-items:center;justify-content:center;border-radius:50%;background:${pal.em};color:${pal.checkText};font-weight:800}
  .wm{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none;z-index:9}
  .wm span{transform:rotate(-24deg);font-size:${unit * 6}px;font-weight:800;color:rgba(200,30,30,.55);
    border:${unit * .6}px solid rgba(200,30,30,.55);padding:${unit}px ${unit * 3}px;border-radius:${unit * 2}px;
    background:rgba(255,255,255,.55);white-space:nowrap}
  `;
}

/** アプリ名の表示（アイコンがあれば使い、無ければ色の四角）。 */
function brandHtml(appName, iconDataUrl, size) {
  if (!appName) return '';
  const mark = iconDataUrl
    ? `<img src="${iconDataUrl}" style="width:${size * 1.5}px;height:${size * 1.5}px;border-radius:${size * 0.36}px">`
    : `<i style="width:${size * 0.8}px;height:${size * 0.8}px;border-radius:${size * 0.24}px"></i>`;
  return `<div class="brand" style="font-size:${size}px;gap:${size * 0.45}px">${mark}<span>${escapeHtml(appName)}</span></div>`;
}

/**
 * 端末の枠と実画面。幅 phoneW（px）。画面の縮尺 = 画面の幅 / 撮影の幅（1を超えない値を呼び手が選ぶ）。
 * callout：{ rect:[x,y,w,h]（撮影に対する0〜1の比）, width（px。等倍を超えない幅に切り詰める） }
 */
function phoneHtml({ src, phoneW: wanted, imageWidth, imageAspect, unit, style = '', callout = null, frameScale = 1 }) {
  const phoneW = fitPhoneW(wanted, imageWidth, unit, frameScale); // 等倍を超えて拡大しない
  const bezel = unit * 1.5 * frameScale;
  const screenW = phoneW - bezel * 2;
  const screenH = screenW * imageAspect;
  const phoneH = screenH + bezel * 2;
  const outerR = unit * 6.4 * frameScale;
  let co = '';
  if (callout && imageWidth) {
    const [cx, cy, cw, ch] = callout.rect;
    const capW = imageWidth;
    const capH = imageWidth * imageAspect;
    const cropW = cw * capW;
    const cropH = ch * capH;
    const want = callout.width ?? phoneW * 1.08;
    const scale = Math.min(1, want / cropW); // 等倍を超えて拡大しない
    const w = cropW * scale;
    const h = cropH * scale;
    const inPhoneScale = screenW / capW;
    const centerY = bezel + (cy + ch / 2) * capH * inPhoneScale;
    const left = (phoneW - w) / 2;
    const top = centerY - h / 2 + (callout.shiftY ?? 0) * phoneW;
    co = `<div class="callout" style="left:${left}px;top:${top}px;width:${w}px;height:${h}px;border-radius:${unit * 2.4}px;
      background-image:url(${src});background-size:${capW * scale}px auto;background-position:${-cx * capW * scale}px ${-cy * capH * scale}px"></div>`;
  }
  return `<div class="phone" style="width:${phoneW}px;height:${phoneH}px;padding:${bezel}px;border-radius:${outerR}px;${style}">
    <img src="${src}" style="border-radius:${outerR - bezel}px">${co}</div>`;
}

/**
 * ストア提出用：上に見出し、下に端末（画面の下へはみ出して切れる配置で、端末を大きく見せる）。
 * opts: { width, height, brand, title, sub, imageDataUrl, imageWidth, imageAspect, lang, tone, label, callout, watermark }
 * title は renderEmphasis 済みのHTML。sub は文字列（ここでエスケープし、［］の強調と改行を反映する）。
 */
export function storeShotHtml({ width, height, brand, title, sub, imageDataUrl, imageWidth = null, imageAspect = 2.17, lang, tone = 'light', label = '', callout = null, watermark, layout = 'showcase' }) {
  if (!STORE_LAYOUTS.includes(layout)) throw new Error(`未知のストアの配置: ${layout}`);
  const unit = Math.min(width, height) / 100;
  const pal = tonePalette(brand, tone);
  const phoneW = fitPhoneW(width * 0.84, imageWidth, unit);
  const subHtml = sub ? `<p class="sub">${renderEmphasis(sub)}</p>` : '';
  return `<!doctype html><html${langAttr(lang)}><head><meta charset="utf-8"><style>${baseCss(width, height, pal)}
  .wrap{display:flex;flex-direction:column;align-items:center;padding-top:${height * 0.048}px}
  .chip{font-size:${unit * 3.6}px;padding:${unit * 0.9}px ${unit * 3}px;margin-bottom:${unit * 2.6}px}
  h1{font-size:${unit * 8.8}px;line-height:1.24;text-align:center;padding:0 ${unit * 5}px}
  p.sub{margin-top:${unit * 2.2}px;font-size:${unit * 4.3}px;text-align:center;padding:0 ${unit * 7}px;line-height:1.45}
  .stage{position:relative;flex:1;width:100%;margin-top:${unit * 5.5}px}
  .stage .phone{position:absolute;left:${(width - phoneW) / 2}px;top:0}
  </style></head><body>${decoHtml(width, height, pal, 'a')}<div class="wrap">
    ${label ? `<span class="chip">${escapeHtml(label)}</span>` : ''}
    <h1>${title}</h1>${subHtml}
    <div class="stage">${phoneHtml({ src: imageDataUrl, phoneW, imageWidth, imageAspect, unit, callout })}</div>
  </div>${watermarkHtml(watermark)}</body></html>`;
}

function pointsHtml(points, size) {
  if (!points?.length) return '';
  return `<ul class="points" style="margin-top:${size * 1.6}px">${points.map((p) => `<li style="font-size:${size}px;gap:${size * 0.6}px;margin-top:${size * 0.7}px;line-height:1.4">
    <b style="width:${size * 1.35}px;height:${size * 1.35}px;font-size:${size * 0.8}px;margin-top:${size * 0.02}px">✓</b><span>${escapeHtml(p)}</span></li>`).join('')}</ul>`;
}

/**
 * 広告・SNS・LP用。layout（'split'|'banner'|'square'|'story'）ごとに配置を変える。
 * opts: { width, height, brand, headline, sub, images[], imageWidth, imageAspect, appName, iconDataUrl, badge, points[], lang, tone, layout, watermark }
 */
export function adHtml({ width, height, brand, headline, sub, images, imageWidth = null, imageAspect = 2.17, watermark, appName, iconDataUrl = null, badge, points = [], lang, tone = 'light', layout }) {
  const use = layout ?? defaultAdLayout(width, height);
  if (!AD_LAYOUTS.includes(use)) throw new Error(`未知の広告の配置: ${use}`);
  const unit = Math.min(width, height) / 100;
  const pal = tonePalette(brand, tone);
  const subText = sub ? renderEmphasis(sub) : '';
  const badgeHtml = badge ? `<span class="chip badge">${escapeHtml(badge)}</span>` : '';
  const phone = (i, phoneW, style, frameScale = 1) => phoneHtml({ src: images[i], phoneW, imageWidth, imageAspect, unit, style, frameScale });
  let css = '';
  let body = '';

  if (use === 'split') {
    // LP：左に「何のアプリか・なぜ便利か」（見出し・補足・要点3つ）、右に端末2台（重ねて傾ける）
    const phoneW = height * 0.94 / imageAspect;
    css = `
    .wrap{display:flex;align-items:center}
    .text{width:50%;padding-left:${width * 0.065}px;padding-right:${unit * 2}px}
    .chip.badge{font-size:${unit * 2.6}px;padding:${unit * .5}px ${unit * 2}px;margin-left:${unit * 1.6}px;vertical-align:middle}
    h1{margin-top:${unit * 4}px;font-size:${unit * 8.2}px;line-height:1.2}
    p.sub{margin-top:${unit * 2.6}px;font-size:${unit * 3.9}px;line-height:1.55}
    .stage{position:relative;width:50%;height:100%}
    .stage .disc{position:absolute;left:${width * 0.07}px;top:${height * 0.1}px;width:${height * 0.86}px;height:${height * 0.86}px;border-radius:50%;
      background:${tone === 'deep' ? 'rgba(255,255,255,.08)' : `linear-gradient(160deg, ${brand.primary} 0%, ${brand.primaryDark ?? brand.primary} 100%)`};opacity:${tone === 'deep' ? 1 : 0.9}}
    .stage .phone{position:absolute}`;
    const p0 = images.length > 1 ? phone(1, phoneW * 0.92, `left:${width * 0.235}px;top:${height * 0.11}px;transform:rotate(5deg);z-index:1`) : '';
    const p1 = phone(0, phoneW, `left:${images.length > 1 ? width * 0.04 : width * 0.12}px;top:${height * 0.045}px;transform:rotate(-3deg);z-index:2`);
    body = `<div class="text">${brandHtml(appName, iconDataUrl, unit * 4.2)}${badgeHtml}<h1>${headline}</h1>${subText ? `<p class="sub">${subText}</p>` : ''}${pointsHtml(points, unit * 3.3)}</div>
      <div class="stage"><div class="disc"></div>${p0}${p1}</div>`;
  } else if (use === 'banner') {
    // 横長広告：短い見出しを大きく、端末1台を大きく（画面の上半分を見せて下は切る）
    const phoneW = width * 0.3;
    css = `
    .text{position:absolute;left:${width * 0.06}px;top:0;bottom:0;width:${width * 0.56}px;display:flex;flex-direction:column;justify-content:center}
    .chip.badge{align-self:flex-start;font-size:${unit * 3.4}px;padding:${unit * .6}px ${unit * 2.4}px;margin-bottom:${unit * 2}px}
    h1{font-size:${unit * 11.6}px;line-height:1.18}
    p.sub{margin-top:${unit * 3}px;font-size:${unit * 4.8}px;line-height:1.45}
    .foot{margin-top:${unit * 6}px}
    .stage .phone{position:absolute;right:${width * 0.07}px;top:${height * 0.1}px;transform:rotate(4deg)}`;
    body = `<div class="text">${badgeHtml}<h1>${headline}</h1>${subText ? `<p class="sub">${subText}</p>` : ''}<div class="foot">${brandHtml(appName, iconDataUrl, unit * 5)}</div></div>
      <div class="stage">${phone(0, phoneW, '')}</div>`;
  } else if (use === 'square') {
    // SNS正方形：アプリ名は1回だけ。見出しを大きく、端末1台を中央に大きく（下は切る）
    const phoneW = fitPhoneW(width * 0.6, imageWidth, unit);
    css = `
    .wrap{display:flex;flex-direction:column;align-items:center;padding-top:${height * 0.055}px;text-align:center}
    .chip.badge{font-size:${unit * 3}px;padding:${unit * .5}px ${unit * 2.2}px;margin-top:${unit * 2}px}
    h1{margin-top:${unit * 2.6}px;font-size:${unit * 7.8}px;line-height:1.22;padding:0 ${unit * 5}px}
    p.sub{margin-top:${unit * 1.8}px;font-size:${unit * 3.6}px;line-height:1.45;padding:0 ${unit * 8}px}
    .stage{position:relative;flex:1;width:100%;margin-top:${unit * 4}px}
    .stage .phone{position:absolute;left:${(width - phoneW) / 2}px;top:0}`;
    body = `${brandHtml(appName, iconDataUrl, unit * 3.8)}${badgeHtml}<h1>${headline}</h1>${subText ? `<p class="sub">${subText}</p>` : ''}
      <div class="stage">${phone(0, phoneW, '')}</div>`;
  } else {
    // 縦長（ストーリーズ等）：見出し→端末（大きく）→下帯のアプリ名、の順に上から下へ視線を流す。余白を作らない
    const band = height * 0.095;
    const phoneW = fitPhoneW(width * (images.length > 1 ? 0.6 : 0.7), imageWidth, unit);
    css = `
    .wrap{display:flex;flex-direction:column;align-items:center;padding-top:${height * 0.05}px;text-align:center}
    .chip.badge{font-size:${unit * 3.4}px;padding:${unit * .6}px ${unit * 2.6}px;margin-bottom:${unit * 2.4}px}
    h1{font-size:${unit * 9.2}px;line-height:1.2;padding:0 ${unit * 5}px}
    p.sub{margin-top:${unit * 2.4}px;font-size:${unit * 4.4}px;line-height:1.45;padding:0 ${unit * 8}px}
    .pts{display:flex;flex-wrap:wrap;justify-content:center;gap:${unit * 1.4}px;margin-top:${unit * 3.4}px;padding:0 ${unit * 5}px}
    .pts span{font-size:${unit * 3.3}px;padding:${unit * .9}px ${unit * 2.4}px}
    .stage{position:relative;flex:1;width:100%;margin-top:${unit * 5}px}
    .stage .phone{position:absolute}
    .band{position:absolute;left:0;right:0;bottom:0;height:${band}px;z-index:5;display:flex;align-items:center;justify-content:center;
      background:${tone === 'deep' ? '#FFFFFF' : `linear-gradient(90deg, ${brand.primaryDark ?? brand.primary}, ${brand.primary})`}}
    .band .brand{color:${tone === 'deep' ? (brand.primaryDark ?? brand.primary) : '#FFFFFF'}}`;
    const phones = images.length > 1
      ? phone(1, phoneW * 0.9, `left:${width * 0.38}px;top:${unit * 9}px;transform:rotate(4deg);z-index:1`)
        + phone(0, phoneW, `left:${width * 0.06}px;top:0;transform:rotate(-3deg);z-index:2`)
      : phone(0, phoneW, `left:${(width - phoneW) / 2}px;top:0`);
    const pts = points?.length ? `<div class="pts">${points.map((p) => `<span class="chip">${escapeHtml(p)}</span>`).join('')}</div>` : '';
    body = `${badgeHtml}<h1>${headline}</h1>${subText ? `<p class="sub">${subText}</p>` : ''}${pts}
      <div class="stage">${phones}</div>`;
    return `<!doctype html><html${langAttr(lang)}><head><meta charset="utf-8"><style>${baseCss(width, height, pal)}${css}</style></head><body>
      ${decoHtml(width, height, pal, 'b')}<div class="wrap">${body}</div>
      <div class="band">${brandHtml(appName, iconDataUrl, unit * 5)}</div>${watermarkHtml(watermark)}</body></html>`;
  }
  return `<!doctype html><html${langAttr(lang)}><head><meta charset="utf-8"><style>${baseCss(width, height, pal)}${css}</style></head><body>
    ${decoHtml(width, height, pal, use === 'square' ? 'b' : 'a')}<div class="wrap">${body}</div>${watermarkHtml(watermark)}</body></html>`;
}

/**
 * 見出しの強調。文言の中の［…］を強調色にする（設定ファイルで装飾を書けるようにするための最小の記法）。
 * 改行（\n）は <br>。それ以外はエスケープする。
 */
export function renderEmphasis(text) {
  return escapeHtml(text).replace(/［(.+?)］/g, '<em>$1</em>').replace(/\n/g, '<br>');
}
