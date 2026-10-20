import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { CategoryAggregateRow } from '@/config/categories';
import { color, radius, shadow, spacing } from '@/theme/tokens';
import { buildShareLabels } from '@/utils/analytics-core';
import { formatJpy } from '@/utils/format';

import { ProFeatureBadge } from './ProFeatureBadge';

export interface CategorySpendCardProps {
  /** 例：「今月のカテゴリー別」 */
  title: string;
  /** `aggregateByCategory`の結果（金額の降順。同額は定義順・未分類は最後） */
  rows: readonly CategoryAggregateRow[];
  /** 同じ期間の購入済み合計（上のまとめと同じ値）。内訳の見出しに出す */
  purchasedTotal: number;
  isPro: boolean;
  /** 無料版の「Proプランを見る」 */
  onPressPro: () => void;
}

/**
 * 分析画面のカテゴリー別（横棒グラフ）。**集計はPro**、カテゴリーの保存自体は無料版でも使える。
 *
 * - Pro：カテゴリー名・件数・金額・構成比を1カテゴリー2行で出す（1行目＝名前と金額、2行目＝横棒と%）。
 *   名前と金額を同じ行で押し合わせず、棒は全幅を使えるので、小さいiPhoneや文字拡大でも崩れにくい
 * - 横棒の長さは**全体に対する割合**（右の%と同じ意味。薄いトラックの上に描く）。
 *   0円より大きい行は最低4pxで見えるようにする
 * - 未分類（カテゴリーを選ばずに保存した記録）はグレーの棒にし、行があるときだけ説明を1行出す
 * - 無料版：実際の集計値は一切出さず（ぼかしも使わない）、説明＋Pro導線だけの小さなカードにする
 */
export function CategorySpendCard({ title, rows, purchasedTotal, isPro, onPressPro }: CategorySpendCardProps) {
  return (
    <View style={styles.card}>
      <View style={styles.titleRow}>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        {!isPro && <ProFeatureBadge />}
      </View>

      {isPro ? <ProContent rows={rows} purchasedTotal={purchasedTotal} /> : <LockedContent onPressPro={onPressPro} />}
    </View>
  );
}

function ProContent({ rows, purchasedTotal }: { rows: readonly CategoryAggregateRow[]; purchasedTotal: number }) {
  if (rows.length === 0) {
    return <Text style={styles.emptyText}>この期間の購入済み記録はまだありません</Text>;
  }

  const shareLabels = buildShareLabels(rows.map((r) => r.total));
  const hasUncategorized = rows.some((r) => r.id === null);

  return (
    <>
      <Text style={styles.subtitle}>購入済み {formatJpy(purchasedTotal)} の内訳</Text>
      <View style={styles.list}>
        {rows.map((r, i) => {
          const ratio = r.total > 0 && r.share > 0 ? Math.min(1, r.share) : 0;
          return (
            <View
              key={r.id ?? 'uncategorized'}
              style={styles.row}
              accessible
              accessibilityLabel={`${r.label} ${formatJpy(r.total)} 全体の${shareLabels[i]} ${r.count}件`}>
              <View style={styles.rowTop}>
                <Text style={styles.rowLabel} numberOfLines={1}>
                  {r.label}
                </Text>
                <Text style={styles.rowCount} numberOfLines={1}>
                  {r.count}件
                </Text>
                <View style={styles.rowSpacer} />
                <Text style={styles.rowAmount} numberOfLines={1}>
                  {formatJpy(r.total)}
                </Text>
              </View>
              <View style={styles.rowBottom}>
                <View style={styles.barTrack}>
                  {ratio > 0 && (
                    <View
                      style={[
                        styles.bar,
                        { width: `${ratio * 100}%` },
                        r.id === null ? styles.barUncategorized : styles.barCategory,
                      ]}
                    />
                  )}
                </View>
                <Text style={styles.rowShare} numberOfLines={1}>
                  {shareLabels[i]}
                </Text>
              </View>
            </View>
          );
        })}
      </View>
      {hasUncategorized && (
        <Text style={styles.footnote}>
          未分類＝カテゴリーを選ばずに保存した記録です。履歴の編集からカテゴリーを付けられます。
        </Text>
      )}
    </>
  );
}

function LockedContent({ onPressPro }: { onPressPro: () => void }) {
  return (
    <>
      <Text style={styles.lockedNote}>
        何にいくら使ったかを、カテゴリー別の金額と割合で比べられます。カテゴリーの保存は無料版でも使えます。
      </Text>
      {/* ProFeatureBadge自体は購入導線を持たない部品なので、ボタンで/proへ送る */}
      <Pressable
        onPress={onPressPro}
        style={({ pressed }) => [styles.lockedCta, pressed && styles.lockedCtaPressed]}
        accessibilityRole="button"
        accessibilityLabel="Proプランを見る">
        <Text style={styles.lockedCtaText}>Proプランを見る</Text>
      </Pressable>
    </>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: color.card,
    borderRadius: radius.cardLg,
    borderWidth: 1,
    borderColor: color.line,
    padding: 16,
    ...shadow.card,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  title: {
    flexShrink: 1,
    fontSize: 15,
    fontWeight: '700',
    color: color.text,
  },
  subtitle: {
    marginTop: 3,
    fontSize: 12,
    fontWeight: '500',
    color: color.muted,
    fontVariant: ['tabular-nums'],
  },
  emptyText: {
    fontSize: 12,
    color: color.muted,
    textAlign: 'center',
    paddingVertical: 20,
  },

  // ── Pro：カテゴリー行 ──
  list: { marginTop: 14, gap: 14 },
  row: { gap: 6 },
  rowTop: { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
  rowLabel: {
    flexShrink: 1,
    fontSize: 14,
    fontWeight: '700',
    color: color.text,
  },
  rowCount: {
    flexShrink: 0,
    fontSize: 11,
    fontWeight: '600',
    color: color.muted,
    fontVariant: ['tabular-nums'],
  },
  rowSpacer: { flex: 1, minWidth: 8 },
  rowAmount: {
    flexShrink: 0,
    fontSize: 15,
    fontWeight: '700',
    color: color.text,
    letterSpacing: -0.2,
    fontVariant: ['tabular-nums'],
  },
  rowBottom: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  barTrack: { flex: 1, height: 10, borderRadius: 5, backgroundColor: color.line3, overflow: 'hidden' },
  bar: { height: 10, minWidth: 4, borderRadius: 5 },
  barCategory: { backgroundColor: color.primary },
  barUncategorized: { backgroundColor: color.faint2 },
  rowShare: {
    flexShrink: 0,
    minWidth: 40,
    textAlign: 'right',
    fontSize: 12,
    fontWeight: '700',
    color: color.muted,
    fontVariant: ['tabular-nums'],
  },
  footnote: {
    marginTop: 14,
    fontSize: 11,
    lineHeight: 16,
    color: color.muted,
  },

  // ── 無料版：説明＋Pro導線 ──
  lockedNote: {
    marginTop: 10,
    fontSize: 12,
    lineHeight: 19,
    color: color.body,
  },
  lockedCta: {
    marginTop: 12,
    minHeight: 44,
    paddingVertical: 11,
    borderRadius: radius.button,
    borderWidth: 1.5,
    borderColor: color.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lockedCtaPressed: { opacity: 0.85 },
  lockedCtaText: {
    fontSize: 14,
    fontWeight: '700',
    color: color.primaryDark,
  },
});
