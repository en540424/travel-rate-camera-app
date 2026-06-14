import { router } from 'expo-router';
import { ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { GhostButton, PrimaryButton, SecondaryButton } from '@/components/ui';
import { PRO_OCR_QUOTA } from '@/config/limits';
import { color, radius, shadow } from '@/theme/tokens';

const UNLOCKED: { label: string; value: string }[] = [
  { label: '保存件数', value: '無制限' },
  { label: '旅行作成数', value: '無制限' },
  { label: '高性能OCR', value: `月${PRO_OCR_QUOTA.year}回` },
];

export default function PurchaseCompleteScreen() {
  function toMain() { router.dismissAll(); router.navigate('/'); }
  function toSettings() { router.dismissAll(); router.navigate('/settings'); }

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.checkWrap}>
          <View style={styles.check}><ThemedText style={styles.checkMark}>✓</ThemedText></View>
          <View style={styles.star}><ThemedText style={styles.starMark}>★</ThemedText></View>
        </View>

        <ThemedText style={styles.title}>Proが有効になりました</ThemedText>
        <ThemedText style={styles.body}>
          保存数・旅行数の制限が解除され、高性能OCRが使えるようになりました。
        </ThemedText>

        <View style={styles.list}>
          {UNLOCKED.map((u, i) => (
            <View key={u.label}>
              {i > 0 && <View style={styles.sep} />}
              <View style={styles.row}>
                <ThemedText style={styles.rowIcon}>🔓</ThemedText>
                <ThemedText style={styles.rowLabel}>{u.label}</ThemedText>
                <ThemedText style={styles.rowValue}>{u.value}</ThemedText>
              </View>
            </View>
          ))}
        </View>

        <View style={styles.actions}>
          <PrimaryButton title="メイン画面へ" onPress={toMain} />
          <View style={styles.actionRow}>
            <SecondaryButton title="高性能OCRを試す" onPress={toMain} style={styles.flex} />
            <SecondaryButton title="設定を見る" onPress={toSettings} style={styles.flex} />
          </View>
          <GhostButton title="閉じる" onPress={() => router.dismissAll()} />
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bgScreen },
  scroll: { padding: 24, paddingTop: 48, gap: 12, alignItems: 'center', maxWidth: 480, width: '100%', alignSelf: 'center' },
  checkWrap: { width: 80, height: 80, marginBottom: 8 },
  check: { width: 72, height: 72, borderRadius: 36, backgroundColor: color.primary, alignItems: 'center', justifyContent: 'center', ...shadow.cta },
  checkMark: { fontSize: 36, fontWeight: '800', color: '#FFFFFF' },
  star: { position: 'absolute', top: -2, right: -2, width: 28, height: 28, borderRadius: 14, backgroundColor: color.proGoldB, alignItems: 'center', justifyContent: 'center' },
  starMark: { fontSize: 14, color: '#FFFFFF' },
  title: { fontSize: 21, fontWeight: '700', color: color.text, textAlign: 'center', letterSpacing: -0.3 },
  body: { fontSize: 13.5, fontWeight: '500', color: color.muted, textAlign: 'center', lineHeight: 21, paddingHorizontal: 8 },
  list: { width: '100%', backgroundColor: color.card, borderRadius: radius.card, borderWidth: 1, borderColor: color.line, marginTop: 8, ...shadow.card },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 14, paddingHorizontal: 16 },
  rowIcon: { fontSize: 16 },
  rowLabel: { flex: 1, fontSize: 15, fontWeight: '600', color: color.text },
  rowValue: { fontSize: 14, fontWeight: '700', color: color.primaryDark },
  sep: { height: StyleSheet.hairlineWidth, backgroundColor: color.line2, marginLeft: 16 },
  actions: { width: '100%', gap: 10, marginTop: 16 },
  actionRow: { flexDirection: 'row', gap: 10 },
  flex: { flex: 1 },
});
