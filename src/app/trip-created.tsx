import { router } from 'expo-router';
import { ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { GhostButton, PrimaryButton } from '@/components/ui';
import { useTrips } from '@/hooks/use-trips';
import { color, radius, shadow } from '@/theme/tokens';
import { formatJpy } from '@/utils/format';

function dateRange(start: string | null, end: string | null): string {
  const fmt = (s: string) => {
    const [, m, d] = s.split('-');
    return m && d ? `${parseInt(m, 10)}/${parseInt(d, 10)}` : s;
  };
  if (start && end) return `${fmt(start)} – ${fmt(end)}`;
  if (start) return `${fmt(start)} –`;
  return '未設定';
}

export default function TripCreatedScreen() {
  const { activeTrip } = useTrips();

  function openCamera() {
    router.dismissAll();
    router.navigate('/');
  }
  function openList() {
    router.dismissAll();
    router.navigate('/trip-list');
  }

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.checkWrap}>
          <View style={styles.check}><ThemedText style={styles.checkMark}>✓</ThemedText></View>
        </View>

        <ThemedText style={styles.title}>
          {activeTrip ? `${activeTrip.name} を作成しました` : '旅行を作成しました'}
        </ThemedText>
        <ThemedText style={styles.body}>
          この旅行がアクティブになりました。カメラで読み取った価格は円換算で記録されます。
        </ThemedText>

        {activeTrip && (
          <View style={styles.summary}>
            <View style={styles.sumRow}>
              <ThemedText style={styles.sumLabel}>レート</ThemedText>
              <ThemedText style={styles.sumValue}>
                {activeTrip.base_currency === 'JPY'
                  ? '円のみ'
                  : activeTrip.manual_rate > 0
                    ? `1 ${activeTrip.base_currency} = ¥${activeTrip.manual_rate}`
                    : '未設定'}
              </ThemedText>
            </View>
            <View style={styles.sumSep} />
            <View style={styles.sumRow}>
              <ThemedText style={styles.sumLabel}>予算</ThemedText>
              <ThemedText style={styles.sumValue}>
                {activeTrip.budget_jpy > 0 ? formatJpy(activeTrip.budget_jpy) : '未設定'}
              </ThemedText>
            </View>
            <View style={styles.sumSep} />
            <View style={styles.sumRow}>
              <ThemedText style={styles.sumLabel}>期間</ThemedText>
              <ThemedText style={styles.sumValue}>{dateRange(activeTrip.started_at, activeTrip.ended_at)}</ThemedText>
            </View>
          </View>
        )}

        <View style={styles.actions}>
          <PrimaryButton title="📷 カメラを開く" onPress={openCamera} />
          <GhostButton title="旅行一覧へ" onPress={openList} />
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bgScreen },
  scroll: { padding: 24, paddingTop: 48, gap: 12, alignItems: 'center', maxWidth: 480, width: '100%', alignSelf: 'center' },
  checkWrap: { marginBottom: 8 },
  check: { width: 72, height: 72, borderRadius: 36, backgroundColor: color.primarySoft, alignItems: 'center', justifyContent: 'center' },
  checkMark: { fontSize: 36, fontWeight: '800', color: color.primary },
  title: { fontSize: 20, fontWeight: '700', color: color.text, textAlign: 'center', letterSpacing: -0.3 },
  body: { fontSize: 13.5, fontWeight: '500', color: color.muted, textAlign: 'center', lineHeight: 21, paddingHorizontal: 8 },
  summary: {
    width: '100%', backgroundColor: color.card, borderRadius: radius.card, borderWidth: 1, borderColor: color.line,
    marginTop: 8, ...shadow.card,
  },
  sumRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 14, paddingHorizontal: 16 },
  sumLabel: { fontSize: 13, fontWeight: '600', color: color.muted },
  sumValue: { fontSize: 14, fontWeight: '700', color: color.text, fontVariant: ['tabular-nums'] },
  sumSep: { height: StyleSheet.hairlineWidth, backgroundColor: color.line2, marginLeft: 16 },
  actions: { width: '100%', gap: 10, marginTop: 16 },
});
