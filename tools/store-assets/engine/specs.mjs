// 出力先ごとの寸法・形式の定義。アプリに依存しない共通部分。
//
// ストアの値は公式ページを2026-11-21に取得して確認した（更新日の表示なし）：
//   Apple  https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications
//   Google https://support.google.com/googleplay/android-developer/answer/9866151
// 仕様は変わり得るので、提出前に公式ページを再確認する（README「提出前の確認」）。
//
// kind:
//   'store'  … ストアへ提出するスクリーンショット。実機・シミュレーター由来の撮影だけを入力にできる（provenance.mjs）
//   'ad'     … 広告・SNS・LP用の画像。ストアの審査対象ではないが、実在しない機能を載せない規則は同じ
export const TARGETS = {
  // Apple iPhone。Dynamic Island（medium）が必須で、最大解像度から縮小される
  'appstore-iphone-6.9': {
    kind: 'store', store: 'apple', width: 1320, height: 2868,
    label: 'iPhone 6.9"（Dynamic Island large）', required: false,
    note: '提出すると小さい画面サイズへ自動縮小される最大サイズ',
  },
  'appstore-iphone-6.5': {
    kind: 'store', store: 'apple', width: 1284, height: 2778,
    label: 'iPhone 6.5"（Face ID large）', required: false,
    note: 'Dynamic Island large を出さない場合に必須',
  },
  'appstore-iphone-6.1': {
    kind: 'store', store: 'apple', width: 1179, height: 2556,
    label: 'iPhone 6.1"（Dynamic Island medium）', required: true,
    note: '公式に「At least one screenshot」が必須',
  },
  'appstore-ipad-13': {
    kind: 'store', store: 'apple', width: 2064, height: 2752,
    label: 'iPad 13"', required: false, note: 'iPad対応アプリのみ必須',
  },
  // Google Play（9:16・各辺320〜3840px・長辺は短辺の2.3倍まで・アルファ不可）
  'play-phone': {
    kind: 'store', store: 'google', width: 1080, height: 1920,
    label: 'Google Play phone 9:16', required: true, note: '2〜8枚',
  },
  'play-feature-graphic': {
    kind: 'store', store: 'google', width: 1024, height: 500,
    label: 'Google Play feature graphic', required: true, note: '掲載に必須',
  },
  // 広告・SNS・LP
  'sns-square': { kind: 'ad', width: 1080, height: 1080, label: 'SNS 正方形 1:1' },
  'ad-vertical': { kind: 'ad', width: 1080, height: 1920, label: '縦長広告 9:16（ストーリーズ等）' },
  'ad-horizontal': { kind: 'ad', width: 1200, height: 628, label: '横長広告 1.91:1' },
  'lp-hero': { kind: 'ad', width: 1920, height: 1080, label: 'LPファーストビュー 16:9' },
};

export const STORE_RULES = {
  apple: { formats: ['png', 'jpeg'], maxCount: 10, minCount: 1, alpha: false },
  google: { formats: ['png', 'jpeg'], maxCount: 8, minCount: 2, alpha: false, minSide: 320, maxSide: 3840, maxRatio: 2.3 },
};

export function getTarget(id) {
  const t = TARGETS[id];
  if (!t) throw new Error(`未知の出力先: ${id}（${Object.keys(TARGETS).join(', ')}）`);
  return { id, ...t };
}

/** 1枚の画像が出力先の寸法・形式を満たすか。問題の一覧を返す（空なら合格）。 */
export function checkImageAgainstTarget(target, info) {
  const problems = [];
  if (info.width !== target.width || info.height !== target.height) {
    problems.push(`寸法 ${info.width}x${info.height} が ${target.width}x${target.height} と違う`);
  }
  const rules = target.store ? STORE_RULES[target.store] : null;
  if (rules && rules.alpha === false && info.hasAlpha) problems.push('アルファチャネル（透過）を含む');
  if (rules?.minSide && Math.min(info.width, info.height) < rules.minSide) problems.push(`短辺が${rules.minSide}px未満`);
  if (rules?.maxSide && Math.max(info.width, info.height) > rules.maxSide) problems.push(`長辺が${rules.maxSide}pxを超える`);
  if (rules?.maxRatio && target.id !== 'play-feature-graphic') {
    const ratio = Math.max(info.width, info.height) / Math.min(info.width, info.height);
    if (ratio > rules.maxRatio) problems.push(`縦横比 ${ratio.toFixed(2)} が ${rules.maxRatio} を超える`);
  }
  return problems;
}

/** 出力先ごとの枚数が規則の範囲内か。 */
export function checkCount(target, count) {
  const rules = target.store ? STORE_RULES[target.store] : null;
  if (!rules || target.id === 'play-feature-graphic') return [];
  const problems = [];
  if (count < rules.minCount) problems.push(`${target.id}: ${count}枚（最低${rules.minCount}枚）`);
  if (count > rules.maxCount) problems.push(`${target.id}: ${count}枚（最大${rules.maxCount}枚）`);
  return problems;
}
