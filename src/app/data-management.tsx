import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Alert, Platform, ScrollView, StyleSheet, View } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';

import { ThemedText } from '@/components/themed-text';
import { SettingRow, SettingSection } from '@/components/ui';
import { getCategoryLabel } from '@/config/categories';
import { SHOW_PRO } from '@/config/feature-flags';
import { useHistory } from '@/hooks/use-history';
import { useIsPro } from '@/hooks/use-purchases';
import { useTrips } from '@/hooks/use-trips';
import { buildCsvFilename, buildHistoryCsv, withUtf8Bom } from '@/lib/csv-export-core';
import { shareCsv } from '@/lib/csv-export-service';
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

/** 端末のローカル日付を "YYYY-MM-DD" で返す（ファイル名用。UTCへ寄せない） */
function todayDateKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function DataManagementScreen() {
  const { history, totalCount, clearAll, reload } = useHistory();
  const { activeTrip, loadTrips } = useTrips();
  const isPro = useIsPro();
  const [tripCount, setTripCount] = useState(0);
  const [isExporting, setIsExporting] = useState(false);

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

  /**
   * CSV書き出し（Pro専用）。
   *
   * ■ 書き出す範囲
   * `useHistory()`が読み込んでいる**現在の旅行の保存記録**をそのまま出す。
   * 分析画面の「購入済みかつ期間内」という絞り込みは**流用しない**
   * （CSVは履歴データの書き出しが目的なので、候補も含めて全件出し、
   * 購入/候補は「状態」列として持たせ、受け取った側が自由に絞れる形にする）。
   *
   * ■ 読み込み上限との関係
   * `useHistory()`は表示用に最大500件しか読み込まない。保存件数がそれを超えている場合、
   * **黙って足りないCSVを渡さない**（完全な書き出しに見えて実際は欠けている状態が一番危ない）。
   * 件数が食い違う時は何件書き出すのかを明示し、ユーザーの了解を取ってから続行する。
   *
   * ■ Free時
   * ボタンは隠さず、押したらPro画面へ送る（何が得られるか分かる導線を優先）。
   */
  function handleExportCsv() {
    if (!isPro) {
      router.push('/pro');
      return;
    }
    if (activeTrip == null || history.length === 0) {
      Alert.alert(
        '書き出せる記録がありません',
        'この旅行にはまだ保存された記録がありません。記録を保存してからお試しください。',
        [{ text: 'OK' }],
      );
      return;
    }

    if (history.length < totalCount) {
      Alert.alert(
        'すべての記録は書き出せません',
        `この旅行には${totalCount}件の記録がありますが、書き出せるのは新しい方から${history.length}件です。`,
        [
          { text: 'キャンセル', style: 'cancel' },
          { text: `${history.length}件を書き出す`, onPress: () => void runCsvExport() },
        ],
      );
      return;
    }

    void runCsvExport();
  }

  /** 実際の書き出し・共有。件数の確認は`handleExportCsv`側で済ませてから呼ぶ */
  async function runCsvExport() {
    if (activeTrip == null) return;

    setIsExporting(true);
    try {
      const csv = withUtf8Bom(
        buildHistoryCsv(
          history.map((row) => ({
            createdAt: row.created_at,
            entryDate: row.entry_date,
            category: row.category,
            memo: row.memo,
            isPurchased: (row.is_purchased ?? 0) === 1,
            currency: row.currency,
            foreignAmount: row.foreign_amount,
            jpyAmount: row.jpy_amount,
            rateUsed: row.rate_used,
          })),
          // カテゴリーラベルは config/categories.ts を唯一の正とする（別mapを作らない）
          { tripName: activeTrip.name, categoryLabelOf: getCategoryLabel },
        ),
      );
      const result = await shareCsv(buildCsvFilename(activeTrip.name, todayDateKey()), csv);
      if (result.status === 'unavailable') {
        Alert.alert('この端末では書き出せません', 'ファイルの共有に対応していません。', [{ text: 'OK' }]);
      } else if (result.status === 'error') {
        Alert.alert(
          '書き出せませんでした',
          'CSVの作成中にエラーが発生しました。もう一度お試しください。',
          [{ text: 'OK' }],
        );
      }
    } finally {
      setIsExporting(false);
    }
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

        {/* 書き出し（Pro）。「バックアップについて」の直後に置き、
            端末内だけに残るデータを手元へ持ち出す手段としてつなげる。
            CSV導線はアプリ内でここ1か所だけにする（複数画面へ重複配置しない）。 */}
        {SHOW_PRO && Platform.OS !== 'web' && (
          <SettingSection title="書き出し">
            <SettingRow
              label={isExporting ? '書き出し中…' : 'CSVで書き出す'}
              value={activeTrip != null ? `${history.length}件` : undefined}
              badge={isPro ? undefined : 'Pro'}
              onPress={isExporting ? undefined : handleExportCsv}
            />
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
