import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { PrimaryButton, SecondaryButton, SettingRow, SettingSection } from '@/components/ui';
import { ActiveTripSwitchSheet } from '@/components/domain/ActiveTripSwitchSheet';
import type { CurrencyCode } from '@/constants/currencies';
import { CURRENCIES, CURRENCY_CODES } from '@/constants/currencies';
import { FALLBACK_BUDGET_JPY } from '@/constants/camera-screen';
import type { TripRow } from '@/db/queries/trips';
import { useHistory } from '@/hooks/use-history';
import { useRates } from '@/hooks/use-rates';
import { useTrips } from '@/hooks/use-trips';
import { useSettingsStore } from '@/stores/settings-store';
import { color, radius, shadow, spacing } from '@/theme/tokens';
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
  const { activeTrip, loadTrips, createTrip, editTrip, switchTrip } = useTrips();
  const { saveRate } = useRates();
  const { history, totalCount } = useHistory();

  const [trips, setTrips] = useState<TripRow[]>([]);
  const [showSwitch, setShowSwitch] = useState(false);

  // 旅行作成フォームの状態
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newBudget, setNewBudget] = useState('');
  const [newCurrency, setNewCurrency] = useState<CurrencyCode>(selectedCurrency);
  const [newRate, setNewRate] = useState('');

  // 旅行編集フォームの状態
  const [editingTripId, setEditingTripId] = useState<number | null>(null);
  const [originalEditCurrency, setOriginalEditCurrency] = useState<CurrencyCode>('USD');
  const [editName, setEditName] = useState('');
  const [editBudget, setEditBudget] = useState('');
  const [editCurrency, setEditCurrency] = useState<CurrencyCode>(selectedCurrency);
  const [editRate, setEditRate] = useState('');

  // React Compiler のメモ化でクロージャが古くなるのを防ぐ ref
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

  // ─── 以下、既存のロジックを維持（ハンドラは変更しない） ───

  function handleStartEdit(trip: TripRow) {
    setEditName(trip.name);
    setEditBudget(trip.budget_jpy > 0 ? String(trip.budget_jpy) : '');
    setEditCurrency(trip.base_currency);
    setOriginalEditCurrency(trip.base_currency);
    setEditRate(trip.manual_rate > 0 ? String(trip.manual_rate) : '');
    setEditingTripId(trip.id);
    setCreating(false);
    setShowSwitch(false);
  }

  async function handleSaveEdit() {
    const id = editingTripId;
    if (id === null) return;
    const name = editName.trim();
    if (!name) return;
    const budget = parseFloat(editBudget) || 0;
    const currency = editCurrency;
    const rate = currency === 'JPY' ? 0 : (parseFloat(editRate) || 0);
    if (currency !== 'JPY' && rate <= 0) return;

    async function doSave() {
      await editTrip(id!, { name, budget_jpy: budget, base_currency: currency, manual_rate: rate });
      if (currency !== 'JPY' && rate > 0) await saveRate(currency, rate);
      setEditingTripId(null);
      loadTrips().then(setTrips).catch(() => {});
    }

    if (currency !== originalEditCurrency) {
      Alert.alert(
        '通貨を変更しますか？',
        '既存の履歴の金額表示が変わる場合があります。',
        [
          { text: 'キャンセル', style: 'cancel' },
          { text: '変更する', onPress: doSave },
        ],
      );
    } else {
      await doSave();
    }
  }

  async function handleCreate() {
    const name = newName.trim();
    const budget = parseFloat(newBudget) || 0;
    const currency = newCurrency;
    const rate = parseFloat(newRate) || 0;
    if (!name) return;
    await createTrip(name, budget, currency, rate);
    setCreating(false);
    setNewName('');
    setNewBudget('');
    setNewRate('');
    const list = await loadTrips();
    setTrips(list);
  }

  async function handleSwitch(id: number) {
    await switchTrip(id);
    setShowSwitch(false);
  }

  /*
  function handleRemove(id: number, name: string) {
    Alert.alert(
      '旅行をアーカイブ',
      `「${name}」をアーカイブしますか？\n履歴データは削除されません。`,
      [
        { text: 'キャンセル', style: 'cancel' },
        {
          text: 'アーカイブ',
          style: 'destructive',
          onPress: async () => {
            if (editingTripId === id) setEditingTripId(null);
            await removeTrip(id);
            const list = await loadTrips();
            setTrips(list);
          },
        },
      ],
    );
  }

  // ─── レンダー（v4: settings-main-v4 準拠） ───

  */
  const canCreate = newName.trim() !== '' && (newCurrency === 'JPY' || parseFloat(newRate) > 0);
  const canSaveEdit = editName.trim() !== '' && (editCurrency === 'JPY' || parseFloat(editRate) > 0);
  const dateRange = activeTrip ? formatDateRange(activeTrip.started_at, activeTrip.ended_at) : null;

  function renderCurrencyChips(value: CurrencyCode, onSelect: (c: CurrencyCode) => void, codes: readonly CurrencyCode[]) {
    return (
      <View style={styles.chips}>
        {codes.map((code) => {
          const c = CURRENCIES[code];
          const selected = value === code;
          return (
            <TouchableOpacity
              key={code}
              style={[styles.chip, selected && styles.chipSelected]}
              onPress={() => onSelect(code)}
              activeOpacity={0.8}>
              <ThemedText style={[styles.chipText, selected && styles.chipTextSelected]}>
                {c.flag} {code}
              </ThemedText>
            </TouchableOpacity>
          );
        })}
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <ThemedText style={styles.title}>設定</ThemedText>

          {/* 現在の旅行カード（v4黒ヒーロー） */}
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
                  <ThemedText style={styles.heroBudgetValue} numberOfLines={1}>
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
                  onPress={() => handleStartEdit(activeTrip)}
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
              <ThemedText style={styles.heroName}>旅行がありません</ThemedText>
              <ThemedText style={styles.heroEmptyBody}>
                旅行を作成すると、レート・予算に合わせて記録できます。
              </ThemedText>
              <TouchableOpacity
                style={styles.heroBtn}
                onPress={() => router.push('/trip-create')}
                activeOpacity={0.8}>
                <ThemedText style={styles.heroBtnText}>＋ 旅行を作成</ThemedText>
              </TouchableOpacity>
            </View>
          )}

          {/* 作成 / 編集フォーム */}
          {(creating || editingTripId !== null) && (
            <View style={styles.formCard}>
              <ThemedText style={styles.formTitle}>
                {editingTripId !== null ? '旅行を編集' : '新しい旅行'}
              </ThemedText>
              <TextInput
                style={styles.input}
                value={editingTripId !== null ? editName : newName}
                onChangeText={editingTripId !== null ? setEditName : setNewName}
                placeholder="旅行名（例：ハワイ旅行）"
                placeholderTextColor={color.faint2}
              />
              <ThemedText style={styles.formLabel}>通貨</ThemedText>
              {renderCurrencyChips(
                editingTripId !== null ? editCurrency : newCurrency,
                editingTripId !== null ? setEditCurrency : setNewCurrency,
                CURRENCY_CODES,
              )}
              {(editingTripId !== null ? editCurrency : newCurrency) !== 'JPY' && (
                <TextInput
                  style={styles.input}
                  value={editingTripId !== null ? editRate : newRate}
                  onChangeText={editingTripId !== null ? setEditRate : setNewRate}
                  placeholder={`レート（例：1 ${editingTripId !== null ? editCurrency : newCurrency} = ¥148.5）`}
                  placeholderTextColor={color.faint2}
                  keyboardType="decimal-pad"
                />
              )}
              <View style={styles.budgetRow}>
                <ThemedText style={styles.budgetPrefix}>¥</ThemedText>
                <TextInput
                  style={[styles.input, styles.budgetInput]}
                  value={editingTripId !== null ? editBudget : newBudget}
                  onChangeText={editingTripId !== null ? setEditBudget : setNewBudget}
                  placeholder="予算（例：50000）"
                  placeholderTextColor={color.faint2}
                  keyboardType="number-pad"
                />
              </View>
              <View style={styles.formButtons}>
                <SecondaryButton
                  title="キャンセル"
                  onPress={() => { setCreating(false); setEditingTripId(null); }}
                  style={styles.formBtnFlex}
                />
                <PrimaryButton
                  title={editingTripId !== null ? '保存' : '作成'}
                  onPress={editingTripId !== null ? handleSaveEdit : handleCreate}
                  disabled={editingTripId !== null ? !canSaveEdit : !canCreate}
                  style={styles.formBtnFlex}
                />
              </View>
            </View>
          )}

          {/* 旅行とレート */}
          {editingTripId === null && !creating && (
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
          )}

          {/* データ */}
          {editingTripId === null && !creating && (
            <SettingSection title="データ">
              <SettingRow
                label="データ管理"
                value={`${totalCount}件保存`}
                onPress={() => router.push('/data-management')}
              />
            </SettingSection>
          )}

          {/* サポート */}
          {editingTripId === null && !creating && (
            <SettingSection title="サポート">
              <SettingRow label="ヘルプ・使い方" onPress={() => router.push('/help')} />
              <SettingRow label="アプリについて" onPress={() => router.push('/app-info')} />
            </SettingSection>
          )}

          {/* Pro導線（最下部・控えめ） */}
          {editingTripId === null && !creating && !isPro && (
            <SettingSection>
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
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: -0.8,
    fontVariant: ['tabular-nums'],
  },
  heroRateCol: { alignItems: 'flex-end', gap: 2 },
  heroRate: {
    fontSize: 13,
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

  // ── 作成/編集フォーム ──
  formCard: {
    backgroundColor: color.card,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: color.line,
    padding: spacing.lg,
    gap: 12,
    ...shadow.card,
  },
  formTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: color.text,
  },
  formLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: color.body,
  },
  input: {
    borderWidth: 1.5,
    borderColor: color.inputBorder,
    borderRadius: radius.chip,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: color.text,
    backgroundColor: color.card,
  },
  budgetRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  budgetPrefix: { fontSize: 18, fontWeight: '700', color: color.body },
  budgetInput: { flex: 1 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: color.inputBorder,
    backgroundColor: color.card,
  },
  chipSelected: {
    borderColor: color.primary,
    backgroundColor: color.primarySoft,
  },
  chipText: { fontSize: 13, fontWeight: '600', color: color.body },
  chipTextSelected: { color: color.primaryDark, fontWeight: '700' },
  formButtons: { flexDirection: 'row', gap: 12, marginTop: 2 },
  formBtnFlex: { flex: 1 },
});
