import { Redirect, router } from 'expo-router';
import { ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { GhostButton, PrimaryButton } from '@/components/ui';
import { SHOW_PRO } from '@/config/feature-flags';
import { FREE_LIMITS } from '@/config/limits';
import { color, radius, shadow } from '@/theme/tokens';

interface CompareRow {
  label: string;
  free: string;
  pro: string;
}

const ROWS: CompareRow[] = [
  { label: '保存件数', free: `${FREE_LIMITS.saves}件`, pro: '無制限' },
  { label: '旅行作成', free: `${FREE_LIMITS.trips}件`, pro: '無制限' },
  // カテゴリーは「保存はFreeでもできる／絞り込みと分析はPro」という切り分けを表に出す
  { label: 'カテゴリー保存', free: '○', pro: '○' },
  { label: 'カテゴリー絞り込み', free: '—', pro: '○' },
  { label: 'カテゴリー分析', free: '—', pro: '○' },
  { label: 'CSV書き出し', free: '—', pro: '○' },
];

export default function ProFeaturesScreen() {
  // 初回MVPはPro未実装。ルート直接アクセスでも購入画面へ進めないようガードする（P0-02）
  if (!SHOW_PRO) {
    return <Redirect href="/(tabs)/settings" />;
  }
  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <ThemedText style={styles.lead}>無料版とProの違い</ThemedText>

        {/* 比較表 */}
        <View style={styles.table}>
          <View style={styles.headRow}>
            <ThemedText style={[styles.headCell, styles.headFeature]}>機能</ThemedText>
            <ThemedText style={[styles.headCell, styles.colFree]}>無料</ThemedText>
            <ThemedText style={[styles.headCell, styles.colPro, styles.headPro]}>Pro</ThemedText>
          </View>
          {ROWS.map((r, i) => (
            <View key={r.label} style={[styles.row, i % 2 === 1 && styles.rowAlt]}>
              <ThemedText style={styles.featureCell}>{r.label}</ThemedText>
              <ThemedText style={[styles.valueCell, styles.colFree]}>{r.free}</ThemedText>
              <ThemedText style={[styles.valueCell, styles.colPro, styles.valuePro]}>{r.pro}</ThemedText>
            </View>
          ))}
        </View>

        <ThemedText style={styles.scopeNote}>
          高性能OCR・詳細分析・CSV/PDF出力などのクラウド機能は、今回のProには含まれません。
        </ThemedText>

        <View style={styles.actions}>
          <PrimaryButton title="プランを見る" onPress={() => router.push('/purchase-confirm')} />
          <GhostButton title="Proの紹介を見る" onPress={() => router.push('/pro')} />
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
  lead: { fontSize: 13, fontWeight: '700', color: color.muted, letterSpacing: 0.3, paddingHorizontal: 4 },
  table: {
    backgroundColor: color.card,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: color.line,
    overflow: 'hidden',
    ...shadow.card,
  },
  headRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: color.bg,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  headCell: { fontSize: 12.5, fontWeight: '700', color: color.muted, textAlign: 'center' },
  headFeature: { flex: 1.4, textAlign: 'left' },
  headPro: { color: color.primaryDark },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 13,
    paddingHorizontal: 14,
  },
  rowAlt: { backgroundColor: color.bgScreen },
  featureCell: { flex: 1.4, fontSize: 14, fontWeight: '600', color: color.text },
  valueCell: { fontSize: 13.5, fontWeight: '600', color: color.body, textAlign: 'center' },
  colFree: { flex: 1 },
  colPro: { flex: 1 },
  valuePro: { color: color.primaryDark, fontWeight: '700' },
  scopeNote: { fontSize: 12, fontWeight: '500', color: color.muted, paddingHorizontal: 4, lineHeight: 18 },
  actions: { gap: 10, marginTop: 2 },
});
