import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { SettingRow, SettingSection } from '@/components/ui';
import { ActiveTripSwitchSheet } from '@/components/domain/ActiveTripSwitchSheet';
import { FALLBACK_BUDGET_JPY } from '@/constants/camera-screen';
import { SHOW_PRO } from '@/config/feature-flags';
import type { TripRow } from '@/db/queries/trips';
import { useHistory } from '@/hooks/use-history';
import { useTrips } from '@/hooks/use-trips';
import { useSettingsStore } from '@/stores/settings-store';
import { color, radius, shadow } from '@/theme/tokens';
import { formatJpy } from '@/utils/format';
import { getTripStatsForDisplay } from '@/utils/trip-stats';

function formatDateRange(start: string | null, end: string | null): string | null {
  const fmt = (s: string) => {
    const [, m, d] = s.split('-');
    if (!m || !d) return s;
    return `${parseInt(m, 10)}/${parseInt(d, 10)}`;
  };
  if (start && end) return `${fmt(start)} – ${fmt(end)}`;
  if (start) return `${fmt(start)} –`;
  return null;
}

export default function SettingsScreen() {
  const { selectedCurrency, isPro } = useSettingsStore();
  const { activeTrip, loadTrips, switchTrip } = useTrips();
  const { history, totalCount } = useHistory();

  const [trips, setTrips] = useState<TripRow[]>([]);
  const [showSwitch, setShowSwitch] = useState(false);

  // 一覧件数を表示するため、フォーカス時に旅行リストを読み込む
  useFocusEffect(
    useCallback(() => {
      loadTrips().then(setTrips).catch(() => {});
    }, [loadTrips]),
  );

  const tripBudgetJpy = activeTrip?.budget_jpy ?? FALLBACK_BUDGET_JPY;
  const stats = useMemo(
    () => getTripStatsForDisplay(history, tripBudgetJpy, activeTrip?.id),
    [history, tripBudgetJpy, activeTrip?.id],
  );

  async function handleSwitch(id: number) {
    await switchTrip(id);
    setShowSwitch(false);
  }

  const dateRange = activeTrip ? formatDateRange(activeTrip.started_at, activeTrip.ended_at) : null;

  return (
    <View style={styles.screen}>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <ThemedText style={styles.title}>設定</ThemedText>

          {/* 現在の旅行 */}
          <View style={styles.group}>
            <ThemedText style={styles.groupLabel}>現在の旅行</ThemedText>
            {activeTrip ? (
              <View style={styles.hero}>
                <View style={styles.heroTopRow}>
                  <View style={styles.heroNameWrap}>
                    <ThemedText style={styles.heroName} numberOfLines={1}>
                      {activeTrip.name}
                    </ThemedText>
                    <View style={styles.heroBadge}>
                      <ThemedText style={styles.heroBadgeText}>使用中</ThemedText>
                    </View>
                  </View>
                  <ThemedText style={styles.heroCurrency}>
                    {activeTrip.base_currency === 'JPY' ? '🇯🇵 国内' : `${activeTrip.base_currency} → JPY`}
                  </ThemedText>
                </View>

                <View style={styles.heroBudgetRow}>
                  <View style={styles.heroBudgetCol}>
                    <ThemedText style={styles.heroBudgetLabel}>残り予算</ThemedText>
                    <ThemedText
                      style={styles.heroBudgetValue}
                      numberOfLines={1}
                      adjustsFontSizeToFit
                      minimumFontScale={0.6}>
                      {tripBudgetJpy > 0 ? formatJpy(stats.remainingBudget) : '予算未設定'}
                    </ThemedText>
                  </View>
                  <View style={styles.heroRateCol}>
                    <ThemedText style={styles.heroRate}>
                      {activeTrip.base_currency === 'JPY'
                        ? '円のみ'
                        : activeTrip.manual_rate > 0
                          ? `1 ${activeTrip.base_currency} = ¥${activeTrip.manual_rate}`
                          : 'レート未設定'}
                    </ThemedText>
                    {dateRange != null && <ThemedText style={styles.heroDate}>{dateRange}</ThemedText>}
                  </View>
                </View>

                <View style={styles.heroActions}>
                  <TouchableOpacity
                    style={styles.heroBtn}
                    onPress={() => router.push({ pathname: '/trip-edit', params: { id: String(activeTrip.id) } })}
                    activeOpacity={0.8}>
                    <ThemedText style={styles.heroBtnText}>旅行を編集</ThemedText>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.heroBtn}
                    onPress={() => setShowSwitch(true)}
                    activeOpacity={0.8}>
                    <ThemedText style={styles.heroBtnText}>旅行を切り替える</ThemedText>
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              <View style={styles.hero}>
                <ThemedText style={styles.heroName}>旅行が未選択です</ThemedText>
                <ThemedText style={styles.heroEmptyBody}>
                  まず旅行を作成すると、レート・予算に合わせて記録できます。
                </ThemedText>
                <TouchableOpacity
                  style={styles.heroBtn}
                  onPress={() => router.push('/trip-create')}
                  activeOpacity={0.8}>
                  <ThemedText style={styles.heroBtnText}>＋ 旅行を作成</ThemedText>
                </TouchableOpacity>
              </View>
            )}
            {activeTrip != null && (
              <ThemedText style={styles.groupCaption}>
                この旅行で保存・換算されます。通貨や旅行を変えたいときは「旅行を編集」「旅行を切り替える」から。
              </ThemedText>
            )}
          </View>

          {/* 旅行とレート */}
          <View style={styles.group}>
            <SettingSection title="旅行とレート">
              <SettingRow
                label="旅行管理"
                value={`${trips.length}つの旅行`}
                onPress={() => router.push('/trip-list')}
              />
              <SettingRow
                label="レート設定"
                value={activeTrip && activeTrip.base_currency !== 'JPY' && activeTrip.manual_rate > 0 ? `¥${activeTrip.manual_rate}` : undefined}
                onPress={() => router.push('/rate-setup')}
              />
              <SettingRow
                label="通貨選択"
                value={selectedCurrency}
                onPress={() => router.push('/currency-select')}
              />
            </SettingSection>
            <ThemedText style={styles.groupCaption}>
              レート設定は今の旅行のレートを調整します。通貨選択は新規旅行作成時などの初期通貨で、今の旅行の通貨は変わりません（変えるには「旅行を編集」から）。
            </ThemedText>
          </View>

          {/* データ */}
          <SettingSection title="データ">
            <SettingRow
              label="データ管理"
              value={`${totalCount}件保存`}
              onPress={() => router.push('/data-management')}
            />
          </SettingSection>

          {/* サポート */}
          <SettingSection title="サポート">
            <SettingRow label="ヘルプ・使い方" onPress={() => router.push('/help')} />
          </SettingSection>

          {/* アプリ情報 */}
          <SettingSection title="アプリ情報">
            <SettingRow label="アプリについて" onPress={() => router.push('/app-info')} />
          </SettingSection>

          {/* Pro導線（控えめ）。初回MVPはPro未実装のためSHOW_PROで完全非表示（P0-01） */}
          {SHOW_PRO && !isPro && (
            <SettingSection title="Pro">
              <SettingRow
                label="旅レートカメラ Pro"
                badge="Pro"
                onPress={() => router.push('/pro')}
              />
            </SettingSection>
          )}
        </ScrollView>
      </SafeAreaView>

      <ActiveTripSwitchSheet
        visible={showSwitch}
        onClose={() => setShowSwitch(false)}
        trips={trips}
        activeTripId={activeTrip?.id ?? null}
        onSelect={(id) => { setShowSwitch(false); handleSwitch(id); }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bgScreen },
  safe: { flex: 1 },
  scroll: {
    paddingHorizontal: 18,
    paddingTop: 8,
    paddingBottom: 96,
    gap: 18,
    maxWidth: 480,
    width: '100%',
    alignSelf: 'center',
  },
  title: {
    fontSize: 26,
    fontWeight: '700',
    color: color.text,
    letterSpacing: -0.5,
    lineHeight: 33,
  },

  // ── セクションのまとまり（見出し／カード／補足文を1ブロックとして扱う） ──
  group: { gap: 8 },
  groupLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: color.muted,
    letterSpacing: 0.3,
    paddingHorizontal: 4,
  },
  groupCaption: {
    fontSize: 12,
    fontWeight: '500',
    color: color.muted,
    lineHeight: 17,
    paddingHorizontal: 4,
  },

  // ── 黒ヒーロー（現在の旅行） ──
  hero: {
    backgroundColor: color.dark,
    borderRadius: radius.cardLg,
    padding: 18,
    gap: 16,
    ...shadow.raised,
  },
  heroTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  heroNameWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexShrink: 1,
  },
  heroName: {
    fontSize: 19,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: -0.2,
    flexShrink: 1,
  },
  heroBadge: {
    backgroundColor: color.primaryAccent,
    borderRadius: radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  heroBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: color.dark,
  },
  heroCurrency: {
    fontSize: 13,
    fontWeight: '700',
    color: color.primaryAccent,
    flexShrink: 0,
  },
  heroEmptyBody: {
    fontSize: 13,
    fontWeight: '500',
    color: color.darkSub,
    lineHeight: 20,
  },
  heroBudgetRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 12,
  },
  heroBudgetCol: { flexShrink: 1 },
  heroBudgetLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: color.primaryAccent,
    marginBottom: 2,
  },
  heroBudgetValue: {
    fontSize: 30,
    lineHeight: 36,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: -0.4,
    fontVariant: ['tabular-nums'],
  },
  heroRateCol: { alignItems: 'flex-end', gap: 2 },
  heroRate: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
    color: color.darkSub,
    fontVariant: ['tabular-nums'],
  },
  heroDate: {
    fontSize: 12,
    fontWeight: '500',
    color: color.darkMuted,
    fontVariant: ['tabular-nums'],
  },
  heroActions: {
    flexDirection: 'row',
    gap: 10,
  },
  heroBtn: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderRadius: radius.button,
    paddingVertical: 12,
    alignItems: 'center',
  },
  heroBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});
