// 撮影元（provenance）と掲載内容の規則。アプリに依存しない共通部分で、すべて純粋関数。
//
// 守るもの：
// 1. 架空のUI画像を実アプリのスクリーンショットとして扱わない
//    → ストア提出用（kind: 'store'）は、実機（device）またはiOSシミュレーター／Androidエミュレーター
//      （ios-simulator / android-emulator）で実アプリから撮った画像だけを入力にできる。
//      Web版で描いた画面（web-preview）はiOSの見た目（フォント・SF Symbols・ネイティブ部品）と違うため不可。
// 2. 存在しない機能・未公開の機能・誤解を招く説明を載せない
//    → 文言が参照する機能は、アプリ設定の features で status: 'released' のものに限る。
//      'flagged'（実装済みだが公開フラグで隠している）・'planned'（未実装）は、どの出力にも載せない。

export const SOURCES = {
  device: { real: true, nativeUi: true, label: '実機' },
  'ios-simulator': { real: true, nativeUi: true, label: 'iOSシミュレーター' },
  'android-emulator': { real: true, nativeUi: true, label: 'Androidエミュレーター' },
  'web-preview': { real: true, nativeUi: false, label: 'Web版プレビュー（iOSの見た目ではない）' },
};

/**
 * この撮影元の画像を、この種類の出力へ使えるか。
 * mode: 'final'（提出・公開用）| 'draft'（レイアウト確認用。透かし付きで出す）
 */
export function canUseSource(source, kind, mode = 'final') {
  const s = SOURCES[source];
  if (!s) return { ok: false, reason: `未知の撮影元: ${source}` };
  if (mode === 'draft') return { ok: true, watermark: !s.nativeUi };
  if (!s.nativeUi) {
    return { ok: false, reason: `${s.label}は${kind === 'store' ? 'ストア提出' : '公開用の素材'}に使えない（draftでのみ可）` };
  }
  return { ok: true, watermark: false };
}

/**
 * 文言が参照する機能が、すべて公開済み（released）か。
 * captionFeatures: 文言が根拠にする機能IDの配列。features: アプリ設定の機能表。
 */
export function checkClaims(captionFeatures, features) {
  const problems = [];
  if (!Array.isArray(captionFeatures) || captionFeatures.length === 0) {
    problems.push('文言の根拠になる機能（features）が指定されていない');
    return problems;
  }
  for (const id of captionFeatures) {
    const f = features[id];
    if (!f) problems.push(`未登録の機能: ${id}`);
    else if (f.status !== 'released') problems.push(`公開されていない機能（${f.status}）: ${id}`);
  }
  return problems;
}
