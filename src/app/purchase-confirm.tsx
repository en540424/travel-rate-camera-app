import { Redirect, router } from 'expo-router';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { GhostButton, PrimaryButton } from '@/components/ui';
import { SHOW_PRO } from '@/config/feature-flags';
import { PRICE_PLACEHOLDER, PRO_OCR_QUOTA } from '@/config/limits';
import { color, radius, shadow } from '@/theme/tokens';

interface IncludedFeature {
  label: string;
  value: string;
}

const INCLUDED: IncludedFeature[] = [
  { label: '保存件数', value: '無制限' },
  { label: '旅行作成数', value: '無制限' },
  { label: '高性能OCR', value: `月${PRO_OCR_QUOTA.year}回相当` },
  { label: '詳細分析', value: '利用可' },
  { label: 'CSV / PDF出力', value: '対応予定' },
];

export default function PurchaseConfirmScreen() {
  // 初回MVPはPro未実装。ルート直接アクセスでも購入画面へ進めないようガードする（P0-02）
  if (!SHOW_PRO) {
    return <Redirect href="/(tabs)/settings" />;
  }
  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.scroll}>
        {/* 選択プラン（黒ヒーロー） */}
        <View style={styles.planCard}>
          <View style={styles.planTopRow}>
            <View style={styles.planTag}>
              <ThemedText style={styles.planTagText}>PRO・年額</ThemedText>
            </View>
            <View style={styles.recommendTag}>
              <ThemedText style={styles.recommendText}>おすすめ</ThemedText>
            </View>
          </View>
          <ThemedText style={styles.planName}>年額Pro</ThemedText>
          <View style={styles.planPriceRow}>
            <ThemedText style={styles.planSub}>月あたり約¥317・2か月分お得</ThemedText>
            <ThemedText style={styles.planPrice}>
              {PRICE_PLACEHOLDER.year}
              <ThemedText style={styles.planPriceUnit}>/年</ThemedText>
            </ThemedText>
          </View>
        </View>

        {/* 含まれる機能 */}
        <ThemedText style={styles.sectionLabel}>含まれる機能</ThemedText>
        <View style={styles.featureCard}>
          {INCLUDED.map((f, i) => (
            <View key={f.label}>
              {i > 0 && <View style={styles.sep} />}
              <View style={styles.featureRow}>
                <ThemedText style={styles.check}>✓</ThemedText>
                <ThemedText style={styles.featureLabel}>{f.label}</ThemedText>
                <ThemedText style={styles.featureValue}>{f.value}</ThemedText>
              </View>
            </View>
          ))}
        </View>

        {/* 自動更新の明記 */}
        <View style={styles.noteCard}>
          <ThemedText style={styles.noteText}>
            期間終了時に自動更新されます。いつでもキャンセル可。お支払いは Apple ID に請求されます。
          </ThemedText>
        </View>

        <View style={styles.actions}>
          <PrimaryButton
            title={`${PRICE_PLACEHOLDER.year}/年 で購入する`}
            onPress={() =>
              Alert.alert(
                '購入は準備中です',
                'アプリ内課金（RevenueCat / StoreKit）はストア公開時に有効化されます。',
              )
            }
          />
          <ThemedText style={styles.disclaimer}>
            ※ 価格は仮表示です。正式な金額はストアでの公開時に確定します。
          </ThemedText>
          <GhostButton title="プランを変更" onPress={() => router.back()} />
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
    gap: 14,
    maxWidth: 480,
    width: '100%',
    alignSelf: 'center',
  },
  planCard: {
    backgroundColor: color.dark,
    borderRadius: radius.cardLg,
    padding: 18,
    gap: 10,
    ...shadow.raised,
  },
  planTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  planTag: {
    backgroundColor: color.proGoldB,
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  planTagText: { fontSize: 11, fontWeight: '800', color: color.dark, letterSpacing: 0.5 },
  recommendTag: {
    backgroundColor: color.primaryAccent,
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  recommendText: { fontSize: 11, fontWeight: '700', color: color.dark },
  planName: { fontSize: 20, fontWeight: '700', color: '#FFFFFF', letterSpacing: -0.3 },
  planPriceRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 10,
  },
  planSub: { fontSize: 12, fontWeight: '500', color: color.darkSub, flexShrink: 1 },
  planPrice: {
    fontSize: 26,
    lineHeight: 32,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: -0.3,
    fontVariant: ['tabular-nums'],
  },
  planPriceUnit: { fontSize: 14, fontWeight: '600', color: color.darkSub },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: color.muted,
    paddingHorizontal: 4,
    marginTop: 2,
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
    alignItems: 'center',
    gap: 10,
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  check: { fontSize: 15, fontWeight: '800', color: color.primary },
  featureLabel: { flex: 1, fontSize: 15, fontWeight: '600', color: color.text },
  featureValue: { fontSize: 13, fontWeight: '700', color: color.primaryDark },
  sep: { height: StyleSheet.hairlineWidth, backgroundColor: color.line2, marginLeft: 16 },
  noteCard: {
    backgroundColor: color.bg,
    borderRadius: radius.card,
    padding: 14,
  },
  noteText: { fontSize: 12.5, fontWeight: '500', color: color.body, lineHeight: 19 },
  actions: { gap: 10, marginTop: 4 },
  disclaimer: { fontSize: 11.5, fontWeight: '500', color: color.muted, textAlign: 'center' },
});
