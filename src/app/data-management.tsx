import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Alert, Platform, ScrollView, StyleSheet, View } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';

import { ThemedText } from '@/components/themed-text';
import { SettingRow, SettingSection } from '@/components/ui';
import { SHOW_PRO } from '@/config/feature-flags';
import { useHistory } from '@/hooks/use-history';
import { useTrips } from '@/hooks/use-trips';
import { color, radius, shadow } from '@/theme/tokens';

function StatCard({ label, value, tone }: { label: string; value: string; tone?: 'candidate' | 'purchased' }) {
  const valueColor = tone === 'candidate' ? color.candidateText : tone === 'purchased' ? color.purchasedText : color.text;
  return (
    <View style={styles.statCard}>
      <ThemedText style={[styles.statValue, { color: valueColor }]}>{value}</ThemedText>
      <ThemedText style={styles.statLabel}>{label}</ThemedText>
    </View>
  );
}

export default function DataManagementScreen() {
  const { history, totalCount, clearAll, reload } = useHistory();
  const { activeTrip, loadTrips } = useTrips();
  const [tripCount, setTripCount] = useState(0);

  useFocusEffect(
    useCallback(() => {
      reload();
      loadTrips().then((list) => setTripCount(list.length)).catch(() => {});
    }, [loadTrips, reload]),
  );

  const { candidateCount, purchasedCount } = useMemo(() => {
    let c = 0;
    let p = 0;
    for (const r of history) {
      if ((r.is_purchased ?? 0) === 1) p += 1;
      else c += 1;
    }
    return { candidateCount: c, purchasedCount: p };
  }, [history]);

  async function deleteHistoryPhotos() {
    if (Platform.OS === 'web') return;
    const uris = Array.from(
      new Set(
        history
          .map((row) => row.image_uri)
          .filter((uri): uri is string => !!uri),
      ),
    );
    await Promise.all(
      uris.map(async (uri) => {
        try {
          await FileSystem.deleteAsync(uri, { idempotent: true });
        } catch {}
      }),
    );
  }

  function handleClearAll() {
    const scoped = activeTrip != null;
    Alert.alert(
      scoped ? 'この旅行の履歴を削除しますか？' : 'すべての履歴を削除しますか？',
      'この操作は取り消せません。削除した記録は元に戻せません。',
      [
        { text: 'キャンセル', style: 'cancel' },
        {
          text: '削除',
          style: 'destructive',
          onPress: async () => {
            await deleteHistoryPhotos();
            await clearAll();
          },
        },
      ],
    );
  }

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.scroll}>
        {/* 数値統計 */}
        <View style={styles.statsGrid}>
          <StatCard label="保存件数" value={`${totalCount}`} />
          <StatCard label="旅行" value={`${tripCount}`} />
          <StatCard label="候補" value={`${candidateCount}`} tone="candidate" />
          <StatCard label="購入済み" value={`${purchasedCount}`} tone="purchased" />
        </View>

        {/* この端末に保存 */}
        <View style={styles.noteCard}>
          <ThemedText style={styles.noteTitle}>この端末に保存しています</ThemedText>
          <ThemedText style={styles.noteBody}>
            記録・写真はすべてこの端末内にのみ保存されます。クラウドには送信されません。
          </ThemedText>
        </View>

        {/* バックアップなしの告知（P0-07） */}
        <View style={styles.noteCard}>
          <ThemedText style={styles.noteTitle}>バックアップについて</ThemedText>
          <ThemedText style={styles.noteBody}>
            現在、データはこの端末内に保存されています。{'\n'}
            アプリを削除すると、保存した旅行・履歴・写真は失われる場合があります。{'\n'}
            機種変更やバックアップ機能は今後の検討項目です。
          </ThemedText>
        </View>

        {/* エクスポート（Pro予定）。初回MVPはPro露出ゼロのためSHOW_PROで非表示（P0追加小修正） */}
        {SHOW_PRO && (
          <SettingSection title="エクスポート">
            <SettingRow label="CSVで書き出し" badge="Pro予定" />
            <SettingRow label="PDFで書き出し" badge="Pro予定" />
          </SettingSection>
        )}

        {/* 危険な操作 */}
        <SettingSection title="危険な操作">
          <SettingRow
            label={activeTrip != null ? 'この旅行の履歴をすべて削除' : 'すべての履歴を削除'}
            danger
            onPress={handleClearAll}
          />
        </SettingSection>

        <ThemedText style={styles.footerHint} onPress={() => router.back()}>
          ‹ 設定に戻る
        </ThemedText>
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
    gap: 18,
    maxWidth: 480,
    width: '100%',
    alignSelf: 'center',
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  statCard: {
    flexGrow: 1,
    flexBasis: '47%',
    backgroundColor: color.card,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: color.line,
    paddingVertical: 16,
    paddingHorizontal: 16,
    gap: 4,
    ...shadow.card,
  },
  statValue: {
    fontSize: 26,
    lineHeight: 32,
    fontWeight: '700',
    letterSpacing: -0.5,
    fontVariant: ['tabular-nums'],
  },
  statLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: color.muted,
  },
  noteCard: {
    backgroundColor: color.primarySoft2,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: color.primaryBorder,
    padding: 14,
    gap: 4,
  },
  noteTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: color.primaryDark,
  },
  noteBody: {
    fontSize: 13,
    fontWeight: '500',
    color: color.body,
    lineHeight: 20,
  },
  footerHint: {
    fontSize: 14,
    fontWeight: '600',
    color: color.muted,
    paddingVertical: 8,
  },
});
