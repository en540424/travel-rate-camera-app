import { Redirect, router } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import type { PurchasesPackage } from 'react-native-purchases';

import { ThemedText } from '@/components/themed-text';
import { ErrorMessage, GhostButton, PrimaryButton } from '@/components/ui';
import { SHOW_PRO } from '@/config/feature-flags';
import { usePurchases } from '@/hooks/use-purchases';
import { color, radius, shadow } from '@/theme/tokens';

type PlanKey = 'monthly' | 'annual';

interface IncludedFeature {
  label: string;
  value: string;
}

const INCLUDED: IncludedFeature[] = [
  { label: '保存件数', value: '無制限' },
  { label: '旅行作成数', value: '無制限' },
];

export default function PurchaseConfirmScreen() {
  // Hooksは早期returnより前に呼ぶ（SHOW_PRO=falseでも呼び出し順を変えない）
  const { isInitialized, isLoading, monthlyPackage, annualPackage, isPurchasing, purchase } = usePurchases();
  const [selectedPlan, setSelectedPlan] = useState<PlanKey>('annual');

  // 初回MVPはPro未実装。ルート直接アクセスでも購入画面へ進めないようガードする（P0-02）
  if (!SHOW_PRO) {
    return <Redirect href="/(tabs)/settings" />;
  }

  const packagesByPlan: Record<PlanKey, PurchasesPackage | null> = {
    monthly: monthlyPackage,
    annual: annualPackage,
  };
  // 選択中プランのPackageが無ければ、取得できている方へ自動的に寄せる
  const effectivePlan: PlanKey =
    packagesByPlan[selectedPlan] != null
      ? selectedPlan
      : packagesByPlan.annual != null
        ? 'annual'
        : packagesByPlan.monthly != null
          ? 'monthly'
          : selectedPlan;
  const selectedPackage = packagesByPlan[effectivePlan];

  const priceLoading = !isInitialized || isLoading;
  const noPackagesAvailable = isInitialized && !isLoading && !monthlyPackage && !annualPackage;

  async function handlePurchase() {
    if (!selectedPackage) return;
    const outcome = await purchase(selectedPackage);
    if (outcome.status === 'success') {
      router.replace('/purchase-complete');
      return;
    }
    if (outcome.status === 'cancelled') return; // ユーザーキャンセルはエラー表示しない
    Alert.alert(
      '購入を完了できませんでした',
      'App Storeとの通信に問題が発生しました。しばらく待ってから、もう一度お試しください。購入済みの場合は「購入を復元」をお試しください。',
      [
        { text: '閉じる', style: 'cancel' },
        { text: '購入を復元', onPress: () => router.push('/purchase-restore') },
      ],
    );
  }

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.scroll}>
        {/* プラン選択 */}
        <View style={styles.planToggle}>
          <PlanChip
            label="年額"
            sub={annualPackage ? annualPackage.product.priceString : '—'}
            selected={effectivePlan === 'annual'}
            disabled={!annualPackage}
            onPress={() => setSelectedPlan('annual')}
          />
          <PlanChip
            label="月額"
            sub={monthlyPackage ? monthlyPackage.product.priceString : '—'}
            selected={effectivePlan === 'monthly'}
            disabled={!monthlyPackage}
            onPress={() => setSelectedPlan('monthly')}
          />
        </View>

        {/* 選択プラン（黒ヒーロー） */}
        <View style={styles.planCard}>
          <View style={styles.planTopRow}>
            <View style={styles.planTag}>
              <ThemedText style={styles.planTagText}>
                {effectivePlan === 'annual' ? 'PRO・年額' : 'PRO・月額'}
              </ThemedText>
            </View>
            {effectivePlan === 'annual' && (
              <View style={styles.recommendTag}>
                <ThemedText style={styles.recommendText}>おすすめ</ThemedText>
              </View>
            )}
          </View>
          <ThemedText style={styles.planName}>
            {effectivePlan === 'annual' ? '年額Pro' : '月額Pro'}
          </ThemedText>
          <View style={styles.planPriceRow}>
            {effectivePlan === 'annual' && annualPackage?.product.pricePerMonthString ? (
              <ThemedText style={styles.planSub}>
                月あたり{annualPackage.product.pricePerMonthString}相当
              </ThemedText>
            ) : (
              <View />
            )}
            <ThemedText style={styles.planPrice}>
              {priceLoading
                ? '読み込み中…'
                : (selectedPackage?.product.priceString ?? '取得できません')}
              <ThemedText style={styles.planPriceUnit}>
                {effectivePlan === 'annual' ? '/年' : '/月'}
              </ThemedText>
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
        <ThemedText style={styles.scopeNote}>
          高性能OCRなどのクラウド機能は、今回のProには含まれません。
        </ThemedText>

        {/* 自動更新の明記 */}
        <View style={styles.noteCard}>
          <ThemedText style={styles.noteText}>
            期間終了時に自動更新されます。いつでもキャンセル可。お支払いは Apple ID に請求されます。
          </ThemedText>
        </View>

        {noPackagesAvailable && (
          <ErrorMessage message="価格情報を取得できませんでした。しばらくしてからもう一度お試しください。" />
        )}

        <View style={styles.actions}>
          <PrimaryButton
            title={
              priceLoading
                ? '読み込み中…'
                : selectedPackage
                  ? `${selectedPackage.product.priceString}${effectivePlan === 'annual' ? '/年' : '/月'} で購入する`
                  : '購入できません'
            }
            onPress={handlePurchase}
            loading={isPurchasing}
            disabled={priceLoading || !selectedPackage}
          />
          <GhostButton title="あとで" onPress={() => router.back()} />
        </View>
      </ScrollView>
    </View>
  );
}

function PlanChip({
  label,
  sub,
  selected,
  disabled,
  onPress,
}: {
  label: string;
  sub: string;
  selected: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[styles.planChip, selected && styles.planChipSelected, disabled && styles.planChipDisabled]}>
      <ThemedText style={[styles.planChipLabel, selected && styles.planChipLabelSelected]}>{label}</ThemedText>
      <ThemedText style={[styles.planChipSub, selected && styles.planChipSubSelected]}>{sub}</ThemedText>
    </Pressable>
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
  planToggle: { flexDirection: 'row', gap: 10 },
  planChip: {
    flex: 1,
    borderRadius: radius.card,
    borderWidth: 1.5,
    borderColor: color.line,
    backgroundColor: color.card,
    paddingVertical: 12,
    alignItems: 'center',
    gap: 2,
  },
  planChipSelected: { borderColor: color.primary, backgroundColor: color.primarySoft },
  planChipDisabled: { opacity: 0.45 },
  planChipLabel: { fontSize: 14, fontWeight: '700', color: color.text },
  planChipLabelSelected: { color: color.primaryDark },
  planChipSub: { fontSize: 12, fontWeight: '600', color: color.muted, fontVariant: ['tabular-nums'] },
  planChipSubSelected: { color: color.primaryDark },
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
  scopeNote: { fontSize: 12, fontWeight: '500', color: color.muted, paddingHorizontal: 4 },
  noteCard: {
    backgroundColor: color.bg,
    borderRadius: radius.card,
    padding: 14,
  },
  noteText: { fontSize: 12.5, fontWeight: '500', color: color.body, lineHeight: 19 },
  actions: { gap: 10, marginTop: 4 },
});
