import { Pressable, StyleSheet, Text, View } from 'react-native';

import { color, radius, shadow } from '@/theme/tokens';
import { formatJpy } from '@/utils/format';

export interface AnalysisSummaryCardProps {
  /** 例：「2026年9月」「2026年」「2026年10月20日（火）」 */
  periodLabel: string;
  /** 前後の期間へ移動できるか（今日表示は移動しない） */
  canNavigate: boolean;
  /** 例：「前の月」 */
  prevLabel: string;
  nextLabel: string;
  onPrev: () => void;
  onNext: () => void;
  purchasedTotal: number;
  purchasedCount: number;
  candidateTotal: number;
  totalCount: number;
}

/**
 * 分析画面のまとめ（黒ヒーロー。`design/旅レートカメラ_実装引き継ぎ資料.md`の`AnalysisSummaryCard`）。
 * 「この期間にいくら使ったか（購入済み）」をグラフより先に読ませる。無料版・Proで同じ。
 *
 * 無料版の「期間ごとの合計・件数」（LP・FAQで約束している範囲）の4項目、
 * 購入済み合計・購入済み件数・候補合計・保存件数は全て残す。
 * 大きい数字は**購入済みだけ**の合計（候補は含めない）なので、ラベルでそう明示する。
 */
export function AnalysisSummaryCard({
  periodLabel,
  canNavigate,
  prevLabel,
  nextLabel,
  onPrev,
  onNext,
  purchasedTotal,
  purchasedCount,
  candidateTotal,
  totalCount,
}: AnalysisSummaryCardProps) {
  return (
    <View style={styles.hero}>
      <View style={styles.navRow}>
        {canNavigate ? (
          <Pressable
            onPress={onPrev}
            hitSlop={6}
            style={({ pressed }) => [styles.navBtn, pressed && styles.navBtnPressed]}
            accessibilityRole="button"
            accessibilityLabel={prevLabel}>
            <Text style={styles.navArrow}>‹</Text>
          </Pressable>
        ) : (
          <View style={styles.navBtnPlaceholder} />
        )}
        <Text
          style={styles.periodLabel}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.8}
          maxFontSizeMultiplier={TEXT_MAX_SCALE}>
          {periodLabel}
        </Text>
        {canNavigate ? (
          <Pressable
            onPress={onNext}
            hitSlop={6}
            style={({ pressed }) => [styles.navBtn, pressed && styles.navBtnPressed]}
            accessibilityRole="button"
            accessibilityLabel={nextLabel}>
            <Text style={styles.navArrow}>›</Text>
          </Pressable>
        ) : (
          <View style={styles.navBtnPlaceholder} />
        )}
      </View>

      {/* 読み上げは1か所にまとめる（見出し・金額・件数を別々に止まらせない） */}
      <View
        style={styles.totalBlock}
        accessible
        accessibilityLabel={`購入済みの合計 ${formatJpy(purchasedTotal)}、購入済み ${purchasedCount}件`}>
        <Text style={styles.totalCaption} maxFontSizeMultiplier={TEXT_MAX_SCALE}>
          購入済みの合計
        </Text>
        <Text
          style={styles.totalValue}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.55}
          maxFontSizeMultiplier={AMOUNT_MAX_SCALE}>
          {formatJpy(purchasedTotal)}
        </Text>
        <Text style={styles.totalSub} maxFontSizeMultiplier={TEXT_MAX_SCALE}>
          購入済み {purchasedCount}件
        </Text>
      </View>

      <View style={styles.statsRow}>
        <View style={styles.stat}>
          <View style={styles.statLabelRow}>
            <View style={styles.candidateDot} />
            <Text style={styles.statLabel} numberOfLines={1} maxFontSizeMultiplier={TEXT_MAX_SCALE}>
              候補合計
            </Text>
          </View>
          <Text
            style={[styles.statValue, styles.statValueCandidate]}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.7}
            maxFontSizeMultiplier={TEXT_MAX_SCALE}>
            {formatJpy(candidateTotal)}
          </Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.stat}>
          <Text style={styles.statLabel} numberOfLines={1} maxFontSizeMultiplier={TEXT_MAX_SCALE}>
            保存件数
          </Text>
          <Text style={styles.statValue} numberOfLines={1} maxFontSizeMultiplier={TEXT_MAX_SCALE}>
            {totalCount}件
          </Text>
        </View>
      </View>
    </View>
  );
}

const NAV_BTN = 36;
/** 文字拡大の上限。大きい文字でも黒いカードの中で崩れない範囲に抑える（金額は縮小表示も併用） */
const TEXT_MAX_SCALE = 1.5;
const AMOUNT_MAX_SCALE = 1.3;

const styles = StyleSheet.create({
  hero: {
    backgroundColor: color.dark,
    borderRadius: radius.cardLg,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 14,
    ...shadow.card,
  },
  navRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  navBtn: {
    width: NAV_BTN,
    height: NAV_BTN,
    borderRadius: NAV_BTN / 2,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  navBtnPressed: { backgroundColor: 'rgba(255,255,255,0.16)' },
  navBtnPlaceholder: { width: NAV_BTN, height: NAV_BTN },
  navArrow: {
    fontSize: 24,
    lineHeight: 28,
    fontWeight: '400',
    color: color.primaryAccent,
    marginTop: -2,
  },
  periodLabel: {
    flexShrink: 1,
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },

  totalBlock: { alignItems: 'center', marginTop: 10, gap: 2 },
  totalCaption: {
    fontSize: 12,
    fontWeight: '700',
    color: color.primaryAccent,
  },
  totalValue: {
    fontSize: 38,
    lineHeight: 46,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: -0.6,
    fontVariant: ['tabular-nums'],
  },
  totalSub: {
    fontSize: 12,
    fontWeight: '600',
    color: color.darkSub,
    fontVariant: ['tabular-nums'],
  },

  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.14)',
  },
  stat: { flex: 1, alignItems: 'center', gap: 3 },
  statDivider: {
    width: StyleSheet.hairlineWidth,
    alignSelf: 'stretch',
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  statLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  candidateDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: color.candidate },
  statLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: color.darkMuted,
  },
  statValue: {
    fontSize: 17,
    lineHeight: 22,
    fontWeight: '700',
    color: '#FFFFFF',
    fontVariant: ['tabular-nums'],
  },
  statValueCandidate: { color: color.candidate },
});
