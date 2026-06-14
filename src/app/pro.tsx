import { router } from 'expo-router';
import { ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { GhostButton, PrimaryButton } from '@/components/ui';
import { FREE_LIMITS, PRICE_PLACEHOLDER, PRO_OCR_QUOTA } from '@/config/limits';
import { color, radius, shadow } from '@/theme/tokens';

interface Feature {
  title: string;
  sub: string;
  tag?: string;
}

const FEATURES: Feature[] = [
  { title: '保存件数の上限を解除', sub: `無料版は${FREE_LIMITS.saves}件まで。Proなら無制限に保存できます。` },
  { title: '旅行をいくつでも作成', sub: `無料版は${FREE_LIMITS.trips}件まで。Proなら複数の旅行を管理できます。` },
  { title: '高性能OCR', sub: `月${PRO_OCR_QUOTA.month}回までの高精度な読み取り。`, tag: '回数制' },
  { title: '詳細な分析', sub: '月別比較・カテゴリ別など、より深い振り返り。' },
  { title: 'CSV / PDF 出力', sub: '記録の書き出しに対応予定。', tag: '今後' },
];

export default function ProScreen() {
  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.scroll}>
        {/* 黒ヒーロー */}
        <View style={styles.hero}>
          <View style={styles.proTag}>
            <ThemedText style={styles.proTagText}>PRO</ThemedText>
          </View>
          <ThemedText style={styles.heroTitle}>旅の記録を、もっと自由に。</ThemedText>
          <ThemedText style={styles.heroBody}>
            無料版の使い心地はそのままに、上限や分析を解放します。
          </ThemedText>
        </View>

        {/* 機能リスト */}
        <View style={styles.featureCard}>
          {FEATURES.map((f, i) => (
            <View key={f.title}>
              {i > 0 && <View style={styles.sep} />}
              <View style={styles.featureRow}>
                <View style={styles.check}>
                  <ThemedText style={styles.checkMark}>✓</ThemedText>
                </View>
                <View style={styles.featureTextWrap}>
                  <View style={styles.featureTitleRow}>
                    <ThemedText style={styles.featureTitle}>{f.title}</ThemedText>
                    {f.tag != null && (
                      <View style={styles.featureTag}>
                        <ThemedText style={styles.featureTagText}>{f.tag}</ThemedText>
                      </View>
                    )}
                  </View>
                  <ThemedText style={styles.featureSub}>{f.sub}</ThemedText>
                </View>
              </View>
            </View>
          ))}
        </View>

        {/* 価格（仮） */}
        <View style={styles.priceNoteCard}>
          <ThemedText style={styles.priceNoteTitle}>料金プラン（仮）</ThemedText>
          <ThemedText style={styles.priceNoteBody}>
            月額 {PRICE_PLACEHOLDER.month} / 年額 {PRICE_PLACEHOLDER.year} / 買い切り {PRICE_PLACEHOLDER.oneTime}
            {'\n'}価格・購入は準備中です。正式な金額はストアでの公開時に確定します。
          </ThemedText>
        </View>

        <View style={styles.actions}>
          <PrimaryButton title="プランを見る" onPress={() => router.push('/purchase-confirm')} />
          <GhostButton title="無料版との違いを見る" onPress={() => router.push('/pro-features')} />
          <GhostButton title="購入を復元" onPress={() => router.push('/purchase-restore')} />
          <GhostButton title="あとで" onPress={() => router.back()} />
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bgScreen },
  scroll: {
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 60,
    gap: 16,
    maxWidth: 480,
    width: '100%',
    alignSelf: 'center',
  },
  hero: {
    backgroundColor: color.dark,
    borderRadius: radius.cardLg,
    padding: 20,
    gap: 10,
    ...shadow.raised,
  },
  proTag: {
    alignSelf: 'flex-start',
    backgroundColor: color.proGoldB,
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  proTagText: {
    fontSize: 11,
    fontWeight: '800',
    color: color.dark,
    letterSpacing: 1,
  },
  heroTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: -0.4,
    lineHeight: 30,
  },
  heroBody: {
    fontSize: 13,
    fontWeight: '500',
    color: color.darkSub,
    lineHeight: 20,
  },
  featureCard: {
    backgroundColor: color.card,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: color.line,
    overflow: 'hidden',
    ...shadow.card,
  },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    padding: 16,
  },
  check: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: color.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  checkMark: {
    fontSize: 13,
    fontWeight: '800',
    color: color.primary,
  },
  featureTextWrap: { flex: 1, gap: 2 },
  featureTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  featureTitle: { fontSize: 15, fontWeight: '700', color: color.text, flexShrink: 1 },
  featureTag: {
    backgroundColor: color.proSoft,
    borderRadius: radius.pill,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  featureTagText: { fontSize: 10.5, fontWeight: '700', color: color.pro },
  featureSub: { fontSize: 12.5, fontWeight: '500', color: color.muted, lineHeight: 18 },
  sep: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: color.line2,
    marginLeft: 52,
  },
  priceNoteCard: {
    backgroundColor: color.proSoft,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: color.candidateBorder,
    padding: 14,
    gap: 4,
  },
  priceNoteTitle: { fontSize: 14, fontWeight: '700', color: color.pro },
  priceNoteBody: { fontSize: 12.5, fontWeight: '500', color: color.body, lineHeight: 20 },
  actions: { gap: 10, marginTop: 4 },
});
