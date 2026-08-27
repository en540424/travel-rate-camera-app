/**
 * 旅レートカメラ_実装引き継ぎ資料.md §4 designTokens の実装版。
 * 既存の src/constants/designTokens.ts (DT) は段階移行のため引き続き残す。
 * 価格・上限・回数などの「数値」は config/limits.ts で管理する。
 */

export const color = {
  // brand / primary (teal)
  primary: '#0E9488', // 主役・CTA・購入済み
  primaryDark: '#0A766E', // 濃いティール（テキスト/数字）
  primarySoft: '#E7F5F2', // 淡いティール背景（pill/バッジ）
  primarySoft2: '#F0FAF7', // さらに淡いカード背景（購入済みカード）
  primaryBorder: '#D7EDE7', // ティール系ボーダー
  primaryAccent: '#7FD8CC', // 暗背景上のティールアクセント

  // candidate (amber) ＝ 候補
  candidate: '#E0A53B', // ドット/バー
  candidateText: '#9A6516', // 候補テキスト
  candidateStrong: '#B5731A', // 候補強調/アイコン
  candidateSoft: '#FBF1DE', // 候補バッジ背景
  candidateSoft2: '#FDFAF3', // 候補カード背景
  candidateBorder: '#F0E6CF',

  // purchased ＝ 購入済み（ティールに準拠）
  purchased: '#0E9488',
  purchasedText: '#0A766E',
  purchasedSoft: '#F0FAF7',
  purchasedBorder: '#D7EDE7',

  // Pro (gold accent) — 識別・バッジのみ。CTAはprimaryを使う
  pro: '#B5731A', // Proテキスト/バッジ文字
  proSoft: '#FBF1DE', // Proバッジ背景
  proGoldA: '#EBC976', // ゴールドグラデ開始
  proGoldB: '#D9A441', // ゴールドグラデ終了（linear 135deg）

  // dark hero（現在の旅行カード/Proヒーロー/サマリー）
  dark: '#11201E',
  darkAlt: '#16211F', // 最濃テキスト/暗面
  darkMuted: '#8FA39E', // 暗面の補助テキスト
  darkSub: '#A9BAB5',
  productShutter: '#36443F', // 商品写真モードのシャッター（チャコール。価格OCRのteal CTAと区別／純黒は使わない）

  // text
  text: '#16211F', // 見出し/本文強
  body: '#5B6764', // 本文
  muted: '#7E8986', // 補助
  faint: '#939E9B', // 微弱
  faint2: '#A6AEAB', // ラベル/プレースホルダ

  // surfaces
  bg: '#EAEEEC', // アプリ背景（淡ウォームグレー）
  bgScreen: '#F4F6F5', // 画面背景（白に近い）
  card: '#FFFFFF',
  line: '#ECEFED', // カードボーダー
  line2: '#EEF1F0', // 区切り線
  line3: '#F2F4F3', // 行区切り
  inputBorder: '#DCE3E0',

  // destructive
  danger: '#C2543F',
  dangerAlt: '#D9614E',
  dangerSoft: '#FBF3F1',
  dangerBorder: '#F0D9D4',

  // misc accents
  saturdayBlue: '#3B8DBD',
  sundayRed: '#C2543F',

  // 分析画面の棒グラフ（通常棒）。primary(teal)・candidate(amber)と衝突しない
  // 明るめの青紫。selected(primaryDark)・empty(旧DT.colors.borderSoft相当)は
  // このtoken追加の対象外（既存のまま）。
  // 旧値#6B7FA0はHuman実機評価で「まだ黒っぽく暗い」との指摘を受け#7F8FC4へ変更。
  chartBar: '#7F8FC4',

  // 下タブの非選択アイコン/文字。旧#6B7280(=旧DT.colors.textSecondary)はHuman実機評価で
  // 「まだ背景と同化して見づらい」との指摘を受け、黒には寄せず中濃度のneutral grayへ変更。
  tabInactive: '#4F5865',
} as const;

export const typography = {
  // RNはfontFamily未指定でシステム（iOS=San Francisco / 日本語=Hiragino）。
  fontFamily: undefined as undefined, // 既定のシステムフォント
  numeric: { fontVariant: ['tabular-nums' as const] }, // 金額は必ず付与
  // size / weight の目安（px）
  display: { fontSize: 48, fontWeight: '700', letterSpacing: -1.6 }, // 円換算ヒーロー
  h1: { fontSize: 31, fontWeight: '700', letterSpacing: -0.6 },
  h2: { fontSize: 19, fontWeight: '700', letterSpacing: -0.2 },
  title: { fontSize: 17, fontWeight: '700' },
  bodyLg: { fontSize: 15, fontWeight: '500', lineHeight: 24 },
  body: { fontSize: 13, fontWeight: '500', lineHeight: 21 },
  label: { fontSize: 12, fontWeight: '600' },
  caption: { fontSize: 10.5, fontWeight: '600' },
  overline: { fontSize: 10, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase' as const },
} as const;

export const spacing = { xs: 4, sm: 8, md: 12, lg: 15, xl: 18, xxl: 24, section: 46 } as const;

export const radius = {
  pill: 999,
  chip: 12,
  card: 16, // 標準カード
  cardLg: 18, // ヒーロー/大カード
  sheet: 22, // ボトムシート上端
  button: 15, // 主要ボタン
  phone: 38, // 端末画面角（モック用）
} as const;

export const shadow = {
  // iOS shadow* / Android elevation。RNは別指定。
  card: {
    shadowColor: '#10211F',
    shadowOpacity: 0.04,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  raised: {
    shadowColor: '#10211F',
    shadowOpacity: 0.16,
    shadowRadius: 40,
    shadowOffset: { width: 0, height: 18 },
    elevation: 6,
  }, // カード浮き
  cta: {
    shadowColor: '#0E9488',
    shadowOpacity: 0.4,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  }, // ティールCTA
  sheet: {
    shadowColor: '#000000',
    shadowOpacity: 0.22,
    shadowRadius: 30,
    shadowOffset: { width: 0, height: -10 },
    elevation: 16,
  },
} as const;

// 状態カラー: ステータスから色一式を引く
export const statusColor = {
  candidate: {
    dot: color.candidate,
    text: color.candidateText,
    badgeBg: color.candidateSoft,
    cardBg: color.candidateSoft2,
    border: color.candidateBorder,
    label: '候補',
  },
  purchased: {
    dot: color.purchased,
    text: color.purchasedText,
    badgeBg: color.primarySoft,
    cardBg: color.purchasedSoft,
    border: color.purchasedBorder,
    label: '購入済み',
  },
} as const;

// ボタン定義（高さ・色）
export const button = {
  primary: { bg: color.primary, fg: '#fff', height: 52, radius: radius.button, shadow: shadow.cta },
  secondary: { bg: '#fff', fg: color.text, height: 50, radius: radius.button, borderWidth: 1.5, borderColor: color.inputBorder },
  ghost: { bg: 'transparent', fg: color.muted, height: 48 },
  danger: { bg: color.danger, fg: '#fff', height: 52, radius: radius.button },
  disabled: { bg: '#EEF1F0', fg: '#A6AEAB', height: 52, radius: radius.button }, // 無効
} as const;

export const card = {
  base: { bg: color.card, borderWidth: 1, borderColor: color.line, borderRadius: radius.card, ...shadow.card },
  hero: { bg: color.dark, borderRadius: radius.cardLg }, // 黒ヒーロー
  candidate: { bg: color.candidateSoft2, borderWidth: 1, borderColor: color.candidateBorder, borderRadius: radius.chip },
  purchased: { bg: color.purchasedSoft, borderWidth: 1, borderColor: color.purchasedBorder, borderRadius: radius.chip },
} as const;

export const chip = {
  base: { bg: color.primarySoft, fg: color.primaryDark, radius: radius.pill, paddingV: 5, paddingH: 12, fontSize: 12, fontWeight: '600' },
  candidate: { bg: color.candidateSoft, fg: color.candidateText },
  purchased: { bg: color.primarySoft, fg: color.purchasedText },
  proTag: { bg: color.proSoft, fg: color.pro, fontWeight: '700' },
  neutral: { bg: '#F1F4F2', fg: color.body },
} as const;

export const emptyState = {
  iconWrap: { size: 88, radius: 24, bg: color.primarySoft, fg: color.primary }, // 機能を表すアイコン
  iconWrapNeutral: { bg: '#F1F4F2', fg: color.muted }, // 旅行未選択など
  title: { ...typography.title, color: color.text },
  body: { ...typography.body, color: color.muted, textAlign: 'center' as const },
  gapToButton: spacing.xxl,
} as const;
