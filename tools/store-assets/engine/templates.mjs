// 合成テンプレート（HTML/CSS）。Playwrightで出力先の正確な寸法に描いてPNGにする。
// アプリ固有の値（色・文言・アプリ名）は引数で受け、ここには書かない。

const FONT_STACK = `"Hiragino Sans","Hiragino Kaku Gothic ProN","Noto Sans JP","Yu Gothic UI","Yu Gothic","Meiryo",system-ui,sans-serif`;

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

function watermarkHtml(text) {
  if (!text) return '';
  return `<div class="wm"><span>${escapeHtml(text)}</span></div>`;
}

function baseCss(brand, w, h) {
  const unit = Math.min(w, h) / 100;
  return `
  *{box-sizing:border-box;margin:0;padding:0}
  html,body{width:${w}px;height:${h}px;overflow:hidden}
  body{font-family:${FONT_STACK};color:${brand.text ?? '#16211F'};
    background:linear-gradient(160deg, ${brand.background ?? '#F0FAF7'} 0%, ${brand.backgroundAlt ?? '#FFFFFF'} 100%);
    -webkit-font-smoothing:antialiased}
  .phone{position:relative;background:#0B0F0E;border-radius:${unit * 7}px;padding:${unit * 1.6}px;
    box-shadow:0 ${unit * 2}px ${unit * 6}px rgba(17,32,30,.28)}
  .phone img{display:block;width:100%;height:100%;object-fit:cover;object-position:top;border-radius:${unit * 5.6}px}
  .wm{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none;z-index:9}
  .wm span{transform:rotate(-24deg);font-size:${unit * 6}px;font-weight:800;color:rgba(200,30,30,.55);
    border:${unit * .6}px solid rgba(200,30,30,.55);padding:${unit}px ${unit * 3}px;border-radius:${unit * 2}px;
    background:rgba(255,255,255,.55);white-space:nowrap}
  .brand{display:inline-flex;align-items:center;gap:${unit * 1.4}px;font-weight:700;color:${brand.primaryDark ?? brand.primary}}
  .brand i{display:inline-block;width:${unit * 3}px;height:${unit * 3}px;border-radius:${unit}px;background:${brand.primary}}
  `;
}

/** ストア提出用：上に見出し、下に端末枠の中の実画面。 */
export function storeShotHtml({ width, height, brand, title, sub, imageDataUrl, watermark, imageAspect = 2.17, lang }) {
  const unit = Math.min(width, height) / 100;
  // 端末は画面下へはみ出して切れる配置（上部の見出しを大きく取るため）
  const phoneW = width * 0.8;
  const phoneH = phoneW * imageAspect + unit * 3.2;
  const phoneTop = height * 0.27;
  return `<!doctype html><html${langAttr(lang)}><head><meta charset="utf-8"><style>${baseCss(brand, width, height)}
  .wrap{position:relative;width:100%;height:100%;display:flex;flex-direction:column;align-items:center;padding-top:${height * 0.055}px}
  h1{font-size:${unit * 8.4}px;line-height:1.25;font-weight:800;text-align:center;padding:0 ${unit * 6}px;letter-spacing:.01em;${TEXT_WRAP}}
  h1 em{font-style:normal;color:${brand.primary}}
  p.sub{margin-top:${unit * 2.4}px;font-size:${unit * 4.4}px;color:${brand.body ?? '#5B6764'};text-align:center;padding:0 ${unit * 8}px;line-height:1.45;${TEXT_WRAP}}
  .phone{position:absolute;left:${(width - phoneW) / 2}px;top:${phoneTop}px;width:${phoneW}px;height:${phoneH}px}
  </style></head><body><div class="wrap">
    <h1>${title}</h1>${sub ? `<p class="sub">${escapeHtml(sub)}</p>` : ''}
    <div class="phone"><img src="${imageDataUrl}"></div>
  </div>${watermarkHtml(watermark)}</body></html>`;
}

/** 広告・SNS・LP用：見出し・補足・端末1〜2台。横長は左に文字、右に端末。 */
export function adHtml({ width, height, brand, headline, sub, images, watermark, appName, badge, lang }) {
  const unit = Math.min(width, height) / 100;
  const landscape = width / height > 1.2;
  const phones = images.slice(0, landscape ? 2 : 2);
  const phoneH = landscape ? height * 0.86 : height * (phones.length > 1 ? 0.56 : 0.6);
  const phoneW = phoneH / 2.17;
  const phoneHtml = phones.map((src, i) => {
    const offset = phones.length > 1 ? (i === 0 ? -0.34 : 0.34) : 0;
    const rot = phones.length > 1 ? (i === 0 ? -4 : 4) : 0;
    const style = `width:${phoneW}px;height:${phoneH}px;transform:translateX(${offset * phoneW * 1.5}px) rotate(${rot}deg);${i === 0 ? 'z-index:1' : 'z-index:2'}`;
    return `<div class="phone" style="${style};position:absolute"><img src="${src}"></div>`;
  }).join('');
  const textBlock = `<div class="text">
      <div class="brand"><i></i>${escapeHtml(appName ?? '')}</div>
      ${badge ? `<div class="badge">${escapeHtml(badge)}</div>` : ''}
      <h1>${headline}</h1>${sub ? `<p class="sub">${escapeHtml(sub)}</p>` : ''}
    </div>`;
  return `<!doctype html><html${langAttr(lang)}><head><meta charset="utf-8"><style>${baseCss(brand, width, height)}
  .wrap{position:relative;width:100%;height:100%;display:flex;${landscape ? 'flex-direction:row;align-items:center' : 'flex-direction:column;align-items:center'}}
  .text{${landscape ? `width:50%;padding-left:${width * 0.06}px` : `width:100%;text-align:center;padding:${height * 0.06}px ${unit * 7}px 0`}}
  .brand{font-size:${unit * (landscape ? 4.6 : 3.8)}px}
  h1{margin-top:${unit * 2.4}px;font-size:${unit * (landscape ? 8.6 : 7.4)}px;line-height:1.22;font-weight:800;${TEXT_WRAP}}
  h1 em{font-style:normal;color:${brand.primary}}
  p.sub{margin-top:${unit * 2}px;font-size:${unit * (landscape ? 4 : 3.8)}px;color:${brand.body ?? '#5B6764'};line-height:1.5;${TEXT_WRAP}}
  .badge{display:inline-block;margin-top:${unit * 1.6}px;padding:${unit * .6}px ${unit * 2}px;border-radius:${unit * 3}px;
    background:${brand.primarySoft ?? '#E7F5F2'};color:${brand.primaryDark ?? brand.primary};font-size:${unit * 3}px;font-weight:700}
  .stage{position:relative;${landscape ? 'width:50%;height:100%' : 'width:100%;flex:1'};display:flex;align-items:${landscape ? 'center' : 'flex-end'};justify-content:center;
    ${landscape ? '' : `margin-bottom:${-phoneH * 0.18}px`}}
  </style></head><body><div class="wrap">${textBlock}<div class="stage">${phoneHtml}</div></div>${watermarkHtml(watermark)}</body></html>`;
}

/**
 * 見出しの強調。文言の中の［…］を強調色にする（設定ファイルで装飾を書けるようにするための最小の記法）。
 * それ以外はエスケープする。
 */
export function renderEmphasis(text) {
  return escapeHtml(text).replace(/［(.+?)］/g, '<em>$1</em>').replace(/\n/g, '<br>');
}
