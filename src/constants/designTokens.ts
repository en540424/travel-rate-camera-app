import { Platform } from 'react-native';

export const DT = {
  colors: {
    // ── ベース ──
    background:    '#F8FAFA',
    surface:       '#FFFFFF',
    surfaceSoft:   '#F2FBFA',

    // ── プライマリ（ミント/ティール）──
    primary:       '#14A3A0',
    primaryDark:   '#0E7F7C',
    primarySoft:   '#DDF7F5',

    // ── アクセント（ウォーム）──
    accent:        '#FFB84D',

    // ── 危険・エラー ──
    danger:        '#E35D5B',
    dangerSoft:    '#FDECEC',

    // ── テキスト ──
    textPrimary:   '#1F2933',
    textSecondary: '#6B7280',
    textMuted:     '#9CA3AF',

    // ── ボーダー ──
    border:        '#E5E7EB',
    borderSoft:    '#EEF2F2',

    // ── ステータス ──
    purchased:     '#14A3A0',
    purchasedBg:   '#DDF7F5',
    candidate:     '#F59E0B',
    candidateBg:   '#FEF3C7',
  },

  radius: {
    sm:   8,
    md:   12,
    lg:   18,
    xl:   24,
    pill: 999,
  },

  spacing: {
    xs:  4,
    sm:  8,
    md:  12,
    lg:  16,
    xl:  24,
    xxl: 32,
  },

  fontSize: {
    xs:  12,
    sm:  14,
    md:  16,
    lg:  20,
    xl:  28,
    xxl: 36,
  },

  fontWeight: {
    regular:  '400',
    medium:   '500',
    semibold: '600',
    bold:     '700',
  },

  shadow: {
    card: Platform.select({
      ios: {
        shadowColor:   '#000',
        shadowOpacity: 0.06,
        shadowRadius:  12,
        shadowOffset:  { width: 0, height: 4 },
      },
      android: { elevation: 2 },
      default: {},
    })!,
    modal: Platform.select({
      ios: {
        shadowColor:   '#000',
        shadowOpacity: 0.10,
        shadowRadius:  20,
        shadowOffset:  { width: 0, height: -4 },
      },
      android: { elevation: 8 },
      default: {},
    })!,
  },
} as const;
