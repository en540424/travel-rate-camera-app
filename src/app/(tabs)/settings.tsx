import { router } from 'expo-router';
import { useRef, useState } from 'react';
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
import { ThemedView } from '@/components/themed-view';
import type { CurrencyCode } from '@/constants/currencies';
import { CURRENCIES, CURRENCY_CODES } from '@/constants/currencies';
import { Spacing } from '@/constants/theme';
import { useRates } from '@/hooks/use-rates';
import { useTrips } from '@/hooks/use-trips';
import { useSettingsStore } from '@/stores/settings-store';
import { useTheme } from '@/hooks/use-theme';

export default function SettingsScreen() {
  const { selectedCurrency, setSelectedCurrency, isPro } = useSettingsStore();
  const { activeTrip, loadTrips, createTrip, editTrip, removeTrip, switchTrip } = useTrips();
  const { saveRate } = useRates();
  const theme = useTheme();

  const [trips, setTrips] = useState<Awaited<ReturnType<typeof loadTrips>>>([]);
  const [showTripList, setShowTripList] = useState(false);

  // 旅行作成フォームの状態
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newBudget, setNewBudget] = useState('');
  const [newCurrency, setNewCurrency] = useState<CurrencyCode>(selectedCurrency);
  const [newRate, setNewRate] = useState('');

  // 旅行編集フォームの状態
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [editBudget, setEditBudget] = useState('');
  const [editCurrency, setEditCurrency] = useState<CurrencyCode>(selectedCurrency);
  const [editRate, setEditRate] = useState('');

  // React Compiler のメモ化でクロージャが古くなるのを防ぐ ref
  const newNameRef = useRef(newName);
  const newBudgetRef = useRef(newBudget);
  const newCurrencyRef = useRef(newCurrency);
  const newRateRef = useRef(newRate);
  newNameRef.current = newName;
  newBudgetRef.current = newBudget;
  newCurrencyRef.current = newCurrency;
  newRateRef.current = newRate;

  const editNameRef = useRef(editName);
  const editBudgetRef = useRef(editBudget);
  const editCurrencyRef = useRef(editCurrency);
  const editRateRef = useRef(editRate);
  editNameRef.current = editName;
  editBudgetRef.current = editBudget;
  editCurrencyRef.current = editCurrency;
  editRateRef.current = editRate;

  function handleStartEdit() {
    if (!activeTrip) return;
    setEditName(activeTrip.name);
    setEditBudget(activeTrip.budget_jpy > 0 ? String(activeTrip.budget_jpy) : '');
    setEditCurrency(activeTrip.base_currency);
    setEditRate(activeTrip.manual_rate > 0 ? String(activeTrip.manual_rate) : '');
    setEditing(true);
    setCreating(false);
    setShowTripList(false);
  }

  async function handleSaveEdit() {
    if (!activeTrip) return;
    const name = editNameRef.current.trim();
    if (!name) return;
    const budget = parseFloat(editBudgetRef.current) || 0;
    const currency = editCurrencyRef.current;
    const rate = parseFloat(editRateRef.current) || 0;
    await editTrip(activeTrip.id, { name, budget_jpy: budget, base_currency: currency, manual_rate: rate });
    // レート設定画面と同期（rate-setup.tsx と同じ動作）
    if (rate > 0) await saveRate(currency, rate);
    setEditing(false);
  }

  async function handleShowTrips() {
    const list = await loadTrips();
    setTrips(list);
    setShowTripList(true);
  }

  async function handleCreate() {
    const name = newNameRef.current.trim();
    const budget = parseFloat(newBudgetRef.current) || 0;
    const currency = newCurrencyRef.current;
    const rate = parseFloat(newRateRef.current) || 0;
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
    setShowTripList(false);
  }

  function handleRemove(id: number, name: string) {
    Alert.alert(
      '旅行を削除',
      `「${name}」をアーカイブしますか？`,
      [
        { text: 'キャンセル', style: 'cancel' },
        {
          text: '削除',
          style: 'destructive',
          onPress: async () => {
            await removeTrip(id);
            const list = await loadTrips();
            setTrips(list);
          },
        },
      ],
    );
  }

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <ScrollView contentContainerStyle={styles.scroll}>
          <ThemedText type="subtitle" style={styles.title}>設定</ThemedText>

          {/* 旅行フォルダ */}
          <ThemedView type="backgroundElement" style={styles.section}>
            <ThemedText type="smallBold" style={styles.sectionTitle}>旅行フォルダ</ThemedText>

            {activeTrip ? (
              <View style={styles.activeTripBox}>
                <View style={styles.activeTripInfo}>
                  <ThemedText type="smallBold">{activeTrip.name}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    予算 ¥{activeTrip.budget_jpy.toLocaleString()} ・ {activeTrip.base_currency}
                    {activeTrip.manual_rate > 0 ? ` ・ ¥${activeTrip.manual_rate}` : ''}
                  </ThemedText>
                </View>
                <View style={styles.activeTripActions}>
                  <TouchableOpacity
                    style={[styles.smallBtn, { borderColor: theme.backgroundSelected }]}
                    onPress={handleStartEdit}>
                    <ThemedText type="small">編集</ThemedText>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.smallBtn, { borderColor: theme.backgroundSelected }]}
                    onPress={showTripList ? () => setShowTripList(false) : handleShowTrips}>
                    <ThemedText type="small">{showTripList ? '閉じる' : '切り替え'}</ThemedText>
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              <ThemedText type="small" themeColor="textSecondary">
                旅行が未作成です
              </ThemedText>
            )}

            {/* 旅行リスト */}
            {showTripList && trips.length > 0 && (
              <View style={styles.tripList}>
                {trips.map((t) => (
                  <View key={t.id} style={styles.tripListRow}>
                    <TouchableOpacity
                      style={styles.tripListName}
                      onPress={() => handleSwitch(t.id)}>
                      <ThemedText
                        type="small"
                        style={activeTrip?.id === t.id ? styles.activeTripLabel : undefined}>
                        {activeTrip?.id === t.id ? '✓ ' : ''}{t.name}
                      </ThemedText>
                      <ThemedText type="small" themeColor="textSecondary">
                        ¥{t.budget_jpy.toLocaleString()} ・ {t.base_currency}
                      </ThemedText>
                    </TouchableOpacity>
                    <TouchableOpacity
                      hitSlop={8}
                      onPress={() => handleRemove(t.id, t.name)}>
                      <ThemedText type="small" style={styles.removeBtn}>削除</ThemedText>
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            )}

            {/* 旅行編集フォーム */}
            {editing && (
              <View style={styles.createForm}>
                <ThemedText type="smallBold" style={styles.editFormTitle}>旅行を編集</ThemedText>
                <TextInput
                  style={[styles.input, { color: theme.text, borderColor: theme.backgroundSelected }]}
                  value={editName}
                  onChangeText={setEditName}
                  placeholder="旅行名"
                  placeholderTextColor={theme.textSecondary}
                />
                <ThemedText type="small" themeColor="textSecondary">通貨</ThemedText>
                <View style={styles.chips}>
                  {CURRENCY_CODES.map((code) => {
                    const c = CURRENCIES[code as CurrencyCode];
                    const selected = editCurrency === code;
                    return (
                      <TouchableOpacity
                        key={code}
                        style={[styles.chip, selected && styles.chipSelected]}
                        onPress={() => setEditCurrency(code as CurrencyCode)}>
                        <ThemedText type="small" style={selected ? styles.chipTextSelected : undefined}>
                          {c.flag} {code}
                        </ThemedText>
                      </TouchableOpacity>
                    );
                  })}
                </View>
                <TextInput
                  style={[styles.input, { color: theme.text, borderColor: theme.backgroundSelected }]}
                  value={editRate}
                  onChangeText={setEditRate}
                  placeholder={`レート（例：1 ${editCurrency} = ¥148.5）`}
                  placeholderTextColor={theme.textSecondary}
                  keyboardType="decimal-pad"
                />
                <View style={styles.budgetRow}>
                  <ThemedText type="small" themeColor="textSecondary" style={styles.budgetPrefix}>¥</ThemedText>
                  <TextInput
                    style={[styles.input, styles.budgetInput, { color: theme.text, borderColor: theme.backgroundSelected }]}
                    value={editBudget}
                    onChangeText={setEditBudget}
                    placeholder="予算（例：50000）"
                    placeholderTextColor={theme.textSecondary}
                    keyboardType="number-pad"
                  />
                </View>
                <View style={styles.formButtons}>
                  <TouchableOpacity
                    style={[styles.formBtn, styles.formBtnCancel, { borderColor: theme.backgroundSelected }]}
                    onPress={() => setEditing(false)}>
                    <ThemedText type="small">キャンセル</ThemedText>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.formBtn, styles.formBtnCreate, !editName.trim() && styles.formBtnDisabled]}
                    onPress={handleSaveEdit}
                    disabled={!editName.trim()}>
                    <ThemedText type="small" style={styles.formBtnCreateText}>保存</ThemedText>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {/* 旅行作成フォーム */}
            {!editing && creating ? (
              <View style={styles.createForm}>
                <TextInput
                  style={[styles.input, { color: theme.text, borderColor: theme.backgroundSelected }]}
                  value={newName}
                  onChangeText={setNewName}
                  placeholder="旅行名（例：ハワイ旅行）"
                  placeholderTextColor={theme.textSecondary}
                />
                <ThemedText type="small" themeColor="textSecondary">通貨</ThemedText>
                <View style={styles.chips}>
                  {CURRENCY_CODES.map((code) => {
                    const c = CURRENCIES[code as CurrencyCode];
                    const selected = newCurrency === code;
                    return (
                      <TouchableOpacity
                        key={code}
                        style={[styles.chip, selected && styles.chipSelected]}
                        onPress={() => setNewCurrency(code as CurrencyCode)}>
                        <ThemedText type="small" style={selected ? styles.chipTextSelected : undefined}>
                          {c.flag} {code}
                        </ThemedText>
                      </TouchableOpacity>
                    );
                  })}
                </View>
                <TextInput
                  style={[styles.input, { color: theme.text, borderColor: theme.backgroundSelected }]}
                  value={newRate}
                  onChangeText={setNewRate}
                  placeholder={`レート（例：1 ${newCurrency} = ¥148.5）`}
                  placeholderTextColor={theme.textSecondary}
                  keyboardType="decimal-pad"
                />
                <View style={styles.budgetRow}>
                  <ThemedText type="small" themeColor="textSecondary" style={styles.budgetPrefix}>¥</ThemedText>
                  <TextInput
                    style={[styles.input, styles.budgetInput, { color: theme.text, borderColor: theme.backgroundSelected }]}
                    value={newBudget}
                    onChangeText={setNewBudget}
                    placeholder="予算（例：50000）"
                    placeholderTextColor={theme.textSecondary}
                    keyboardType="number-pad"
                  />
                </View>
                <View style={styles.formButtons}>
                  <TouchableOpacity
                    style={[styles.formBtn, styles.formBtnCancel, { borderColor: theme.backgroundSelected }]}
                    onPress={() => setCreating(false)}>
                    <ThemedText type="small">キャンセル</ThemedText>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.formBtn, styles.formBtnCreate, !newName.trim() && styles.formBtnDisabled]}
                    onPress={handleCreate}
                    disabled={!newName.trim()}>
                    <ThemedText type="small" style={styles.formBtnCreateText}>作成</ThemedText>
                  </TouchableOpacity>
                </View>
              </View>
            ) : !editing && (
              <TouchableOpacity
                style={styles.addTripBtn}
                onPress={() => { setCreating(true); setShowTripList(false); }}>
                <ThemedText type="small" style={styles.addTripBtnText}>+ 新しい旅行を作成</ThemedText>
              </TouchableOpacity>
            )}
          </ThemedView>

          {/* Pro バナー */}
          {!isPro && (
            <ThemedView type="backgroundElement" style={styles.section}>
              <ThemedText type="smallBold" style={styles.sectionTitle}>旅レートカメラ Pro</ThemedText>
              <ThemedText type="small" themeColor="textSecondary" style={styles.proDesc}>
                • 為替レート自動取得{'\n'}
                • 履歴保存無制限{'\n'}
                • 複数旅行管理{'\n'}
                • ライブ円換算ウィジェット
              </ThemedText>
              <TouchableOpacity style={styles.proButton} disabled>
                <ThemedText type="smallBold" style={styles.proButtonText}>
                  Pro版にアップグレード（準備中）
                </ThemedText>
              </TouchableOpacity>
            </ThemedView>
          )}

          {/* デフォルト通貨 */}
          <ThemedView type="backgroundElement" style={styles.section}>
            <ThemedText type="smallBold" style={styles.sectionTitle}>デフォルト通貨</ThemedText>
            <View style={styles.chips}>
              {CURRENCY_CODES.map((code) => {
                const c = CURRENCIES[code as CurrencyCode];
                const selected = selectedCurrency === code;
                return (
                  <TouchableOpacity
                    key={code}
                    style={[styles.chip, selected && styles.chipSelected]}
                    onPress={() => setSelectedCurrency(code as CurrencyCode)}>
                    <ThemedText type="default">{c.flag}</ThemedText>
                    <ThemedText
                      type="small"
                      style={selected ? styles.chipTextSelected : undefined}>
                      {code}
                    </ThemedText>
                  </TouchableOpacity>
                );
              })}
            </View>
          </ThemedView>

          {/* レート設定リンク */}
          <TouchableOpacity
            style={styles.linkRow}
            onPress={() => router.push('/rate-setup')}>
            <ThemedText type="default">為替レートを設定</ThemedText>
            <ThemedText type="default" themeColor="textSecondary"> →</ThemedText>
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1 },
  scroll: { paddingHorizontal: Spacing.three, paddingBottom: Spacing.six, gap: Spacing.three },
  title: { paddingTop: Spacing.three },
  section: {
    borderRadius: Spacing.two,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  sectionTitle: { marginBottom: Spacing.one },

  activeTripBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  activeTripInfo: { gap: 2, flex: 1 },
  activeTripActions: { flexDirection: 'row', gap: Spacing.one },
  smallBtn: {
    borderWidth: 1,
    borderRadius: Spacing.one,
    paddingHorizontal: Spacing.two,
    paddingVertical: 4,
  },
  editFormTitle: { marginBottom: 2 },

  tripList: { gap: Spacing.one },
  tripListRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#cccccc44',
  },
  tripListName: { flex: 1, gap: 2 },
  activeTripLabel: { color: '#208AEF', fontWeight: '700' },
  removeBtn: { color: '#FF3B30' },

  addTripBtn: {
    paddingVertical: Spacing.one,
  },
  addTripBtnText: { color: '#208AEF', fontWeight: '600' },

  createForm: { gap: Spacing.two },
  input: {
    borderWidth: 1,
    borderRadius: Spacing.one,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
    fontSize: 15,
  },
  budgetRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  budgetPrefix: { fontSize: 15, paddingBottom: 1 },
  budgetInput: { flex: 1 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.one },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#cccccc55',
  },
  chipSelected: { borderColor: '#208AEF', backgroundColor: '#208AEF22' },
  chipTextSelected: { color: '#208AEF', fontWeight: '700' },
  formButtons: { flexDirection: 'row', gap: Spacing.two },
  formBtn: {
    flex: 1,
    borderRadius: Spacing.one,
    paddingVertical: Spacing.two,
    alignItems: 'center',
  },
  formBtnCancel: { borderWidth: 1 },
  formBtnCreate: { backgroundColor: '#208AEF' },
  formBtnDisabled: { opacity: 0.4 },
  formBtnCreateText: { color: '#fff', fontWeight: '700' },

  proDesc: { lineHeight: 22 },
  proButton: {
    backgroundColor: '#208AEF',
    borderRadius: Spacing.two,
    padding: Spacing.two,
    alignItems: 'center',
    opacity: 0.5,
  },
  proButtonText: { color: '#ffffff' },
  currencyGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.three,
    borderBottomWidth: 1,
    borderBottomColor: '#cccccc44',
  },
});
