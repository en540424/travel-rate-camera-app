/**
 * Pro+ のプランと購入（3プランの比較・月額／年額・アップグレード・購入・復元・現在の契約）。
 *
 * - 入口は `proplus/_layout.tsx` の下：公開フラグが無効（本番の既定）なら、どのプランでもこの画面へ来られない
 * - 価格は StoreKit の表示値だけ（コードに持たない）。Pro+ の商品が取れない時は購入ボタンを無効にし、理由を分けて案内する
 * - 購入の成否は「Pro+ の Entitlement が付いたか」（`resolveTierPurchaseOutcome`）。付かなければ完了と見せない
 * - 「契約中か」は本物の CustomerInfo（`planTier`）で見る。development build の「契約を装う」（`DEV_PRO_PLUS_PREVIEW`）は使わない
 * - 既存の Pro の購入画面（`pro.tsx`・`purchase-confirm.tsx`）・復元画面は変えない
 * 状態と文言の判定は `lib/proplus/proplus-purchase-core.ts`（純粋関数・テストあり）。
 */
import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import type { PurchasesPackage } from 'react-native-purchases';

import { ThemedText } from '@/components/themed-text';
import { ErrorMessage, GhostButton, PrimaryButton } from '@/components/ui';
import { AI_GATEWAY_URL, AI_VOICE_CAPTURE_READY } from '@/config/ai-gateway';
import { EXTERNAL_LINKS } from '@/config/external-links';
import { PRO_PLUS_QA } from '@/config/feature-flags';
import { FREE_LIMITS } from '@/config/limits';
import { PRO_PLUS_SIMULATED } from '@/hooks/use-proplus';
import { usePlanTier, useProPlanDetails, useProPlusOffering, usePurchases } from '@/hooks/use-purchases';
import { classifyPlanChange, type PlanProduct } from '@/lib/plan-change-core';
import { getPlanTier } from '@/lib/plan-tier';
import {
  availabilityMessage,
  describeIntroOffer,
  describePurchaseResult,
  describeRestoreResult,
  effectivePeriod,
  periodLabel,
  planActionFor,
  planComparison,
  proPlusFeatures,
  resolveProPlusAvailability,
  tierLabel,
  type PeriodLike,
  type ResultMessage,
} from '@/lib/proplus/proplus-purchase-core';
import { color, radius, shadow } from '@/theme/tokens';

async function openUrl(label: string, url: string) {
  try {
    if (!(await Linking.canOpenURL(url))) throw new Error('cannot open');
    await Linking.openURL(url);
  } catch {
    Alert.alert('開けませんでした', `${label}を開けませんでした。時間をおいて再度お試しください。`);
  }
}

const COMPARISON = planComparison(FREE_LIMITS);
const FEATURES = proPlusFeatures({ aiGatewayConfigured: AI_GATEWAY_URL !== null, voiceReady: AI_VOICE_CAPTURE_READY });

export default function ProPlusPlansScreen() {
  const offering = useProPlusOffering();
  const { isPurchasing, isRestoring, purchase, restore } = usePurchases();
  const planTier = usePlanTier();
  const details = useProPlanDetails();
  const [selected, setSelected] = useState<PeriodLike>('annual');
  const [result, setResult] = useState<ResultMessage | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const availability = resolveProPlusAvailability({
    isConfigured: offering.isConfigured,
    isInitialized: offering.isInitialized,
    loadState: offering.state,
    hasMonthly: offering.monthly != null,
    hasAnnual: offering.annual != null,
  });
  const packages: Record<PeriodLike, PurchasesPackage | null> = { monthly: offering.monthly, annual: offering.annual };
  const period = effectivePeriod(selected, { monthly: packages.monthly != null, annual: packages.annual != null });
  const pkg = packages[period];
  const unit = period === 'annual' ? '/年' : '/月';
  const priceLabel = pkg ? `${pkg.product.priceString}${unit}` : null;

  const currentProduct: PlanProduct | null =
    details.productTier && details.productPeriod ? { tier: details.productTier, period: details.productPeriod } : null;
  const change = classifyPlanChange(planTier, currentProduct, { tier: 'pro_plus', period });
  const action = planActionFor({ change, availability, priceLabel, purchasing: isPurchasing });
  const intro = pkg && planTier === 'free' ? describeIntroOffer(pkg.product.introPrice) : null;
  const message = availabilityMessage(availability);
  const manageUrl = details.managementURL ?? EXTERNAL_LINKS.appleSubscriptionManagement;

  async function handleAction() {
    if (action.kind === 'manage') return openUrl('サブスクリプションの管理画面', manageUrl);
    if (action.kind !== 'purchase' || !pkg) return;
    const changeAtPurchase = change; // 購入後に planTier が変わるので、購入前の種類で文言を決める
    const outcome = await purchase(pkg);
    const shown = describePurchaseResult(outcome.status, changeAtPurchase);
    if (!shown) return;
    if (shown.tone === 'restore') {
      Alert.alert(shown.title, shown.body, [
        { text: '閉じる', style: 'cancel' },
        { text: '購入を復元', onPress: () => void handleRestore() },
      ]);
      return;
    }
    setResult(shown);
  }

  async function handleRestore() {
    const outcome = await restore();
    const shown = describeRestoreResult(outcome.status, outcome.status === 'success' ? getPlanTier(outcome.customerInfo) : null);
    if (shown.tone === 'complete') setResult(shown);
    else Alert.alert(shown.title, shown.body);
  }

  async function handleRefresh() {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await offering.refresh();
    } finally {
      setRefreshing(false);
    }
  }

  const expiration = details.expirationDate ? details.expirationDate.split('T')[0] : null;

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.scroll}>
        {PRO_PLUS_QA && <ThemedText style={styles.qa}>Pro+の検証用ビルドです（審査・一般公開には使いません）。契約はSandboxの購入状態で判定しています。</ThemedText>}
        {PRO_PLUS_SIMULATED && (
          <ThemedText style={styles.qa}>開発用ビルドです。Pro+の機能は契約なしで表示していますが、この画面の契約の表示と購入は本物の購入状態で判定します。</ThemedText>
        )}

        {result && (
          <View style={[styles.resultCard, result.tone === 'complete' && styles.resultCardComplete]}>
            <ThemedText style={styles.resultTitle}>{result.title}</ThemedText>
            <ThemedText style={styles.resultBody}>{result.body}</ThemedText>
            {result.tone === 'complete' && <PrimaryButton title="Pro+の機能を使う" onPress={() => router.replace('/proplus')} />}
          </View>
        )}

        <View style={styles.hero}>
          <View style={styles.tag}>
            <ThemedText style={styles.tagText}>PRO+</ThemedText>
          </View>
          <ThemedText style={styles.heroTitle}>旅の買い物と移動を、ひとつのアプリで。</ThemedText>
          <ThemedText style={styles.heroBody}>Proの機能はすべてそのままに、買い物マップ・旅行の予定・AI翻訳が加わります。</ThemedText>
        </View>

        {/* 現在の契約（本物の CustomerInfo） */}
        <View style={styles.currentCard}>
          <ThemedText style={styles.currentTitle}>現在のプラン：{tierLabel(planTier)}</ThemedText>
          {planTier !== 'free' && (
            <>
              {periodLabel(details.productPeriod) && <ThemedText style={styles.currentBody}>期間：{periodLabel(details.productPeriod)}</ThemedText>}
              {expiration && (
                <ThemedText style={styles.currentBody}>
                  {details.willRenew === true ? `次回更新日：${expiration}` : details.willRenew === false ? `有効期限：${expiration}（自動更新オフ）` : `有効期限：${expiration}`}
                </ThemedText>
              )}
              <Pressable onPress={() => openUrl('サブスクリプションの管理画面', manageUrl)} hitSlop={6}>
                <ThemedText style={styles.link}>サブスクリプションを管理</ThemedText>
              </Pressable>
            </>
          )}
        </View>

        {/* 3プランの比較 */}
        <ThemedText style={styles.sectionLabel}>プランの比較</ThemedText>
        <View style={styles.table}>
          <View style={[styles.tr, styles.trHead]}>
            <ThemedText style={[styles.td, styles.tdLabel, styles.th]}> </ThemedText>
            <ThemedText style={[styles.td, styles.th]}>無料版</ThemedText>
            <ThemedText style={[styles.td, styles.th]}>Pro</ThemedText>
            <ThemedText style={[styles.td, styles.th, styles.thPlus]}>Pro+</ThemedText>
          </View>
          {COMPARISON.map((row) => (
            <View key={row.label} style={styles.tr}>
              <ThemedText style={[styles.td, styles.tdLabel]}>{row.label}</ThemedText>
              <ThemedText style={styles.td}>{row.free}</ThemedText>
              <ThemedText style={styles.td}>{row.pro}</ThemedText>
              <ThemedText style={[styles.td, styles.tdPlus]}>{row.proPlus}</ThemedText>
            </View>
          ))}
        </View>

        {/* Pro+ で増える機能（今の Build で使えるか） */}
        <ThemedText style={styles.sectionLabel}>Pro+で使える機能</ThemedText>
        <View style={styles.featureCard}>
          {FEATURES.map((f, i) => (
            <View key={f.label}>
              {i > 0 && <View style={styles.sep} />}
              <View style={styles.featureRow}>
                <View style={styles.featureText}>
                  <ThemedText style={styles.featureTitle}>{f.label}</ThemedText>
                  <ThemedText style={styles.featureSub}>{f.sub}</ThemedText>
                </View>
                <ThemedText style={[styles.badge, f.status === 'preparing' && styles.badgePreparing]}>
                  {f.status === 'available' ? '利用可' : '準備中'}
                </ThemedText>
              </View>
            </View>
          ))}
        </View>
        <ThemedText style={styles.note}>
          「準備中」の機能は、提供を開始するまで使えません。AI翻訳の毎月の利用枠は、提供開始時にAI翻訳の画面で表示します。
        </ThemedText>

        {/* 月額・年額（StoreKit の価格） */}
        <View style={styles.toggle}>
          {(['annual', 'monthly'] as const).map((p) => (
            <Pressable
              key={p}
              onPress={() => setSelected(p)}
              disabled={!packages[p]}
              accessibilityRole="button"
              accessibilityState={{ selected: period === p, disabled: !packages[p] }}
              style={[styles.chip, period === p && styles.chipOn, !packages[p] && styles.chipOff]}>
              <ThemedText style={[styles.chipLabel, period === p && styles.chipLabelOn]}>{p === 'annual' ? '年額' : '月額'}</ThemedText>
              <ThemedText style={[styles.chipSub, period === p && styles.chipLabelOn]}>{packages[p]?.product.priceString ?? '—'}</ThemedText>
            </Pressable>
          ))}
        </View>
        {period === 'annual' && pkg?.product.pricePerMonthString ? (
          <ThemedText style={styles.note}>月あたり{pkg.product.pricePerMonthString}相当</ThemedText>
        ) : null}
        {intro && <ThemedText style={styles.intro}>{intro}</ThemedText>}

        {message && (
          <>
            <ErrorMessage message={message} />
            {availability === 'fetch_failed' && (
              <GhostButton title={refreshing ? '取得中…' : 'プラン情報を再取得'} onPress={handleRefresh} />
            )}
          </>
        )}

        {action.note && <ThemedText style={styles.changeNote}>{action.note}</ThemedText>}

        <View style={styles.actions}>
          <PrimaryButton title={action.label} onPress={handleAction} loading={isPurchasing} disabled={action.disabled} />
          {planTier === 'pro_plus' && (
            <GhostButton title="Proへ変更する（次回の更新日から）" onPress={() => openUrl('サブスクリプションの管理画面', manageUrl)} />
          )}
          <GhostButton title={isRestoring ? '確認中…' : '購入を復元'} onPress={() => void handleRestore()} />
        </View>

        <View style={styles.noteCard}>
          <ThemedText style={styles.noteText}>
            期間終了時に自動更新されます。解約はiOSの設定（サブスクリプション）からいつでも行えます。お支払いは Apple ID に請求されます。
          </ThemedText>
          <View style={styles.legalRow}>
            <Pressable onPress={() => openUrl('利用規約', EXTERNAL_LINKS.terms)} hitSlop={6}>
              <ThemedText style={styles.link}>利用規約</ThemedText>
            </Pressable>
            <ThemedText style={styles.legalSep}>・</ThemedText>
            <Pressable onPress={() => openUrl('プライバシーポリシー', EXTERNAL_LINKS.privacyPolicy)} hitSlop={6}>
              <ThemedText style={styles.link}>プライバシーポリシー</ThemedText>
            </Pressable>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bgScreen },
  scroll: { paddingHorizontal: 18, paddingTop: 18, paddingBottom: 60, gap: 14, maxWidth: 480, width: '100%', alignSelf: 'center' },
  qa: { fontSize: 12.5, color: color.primaryDark, backgroundColor: color.primarySoft, borderRadius: radius.card, padding: 12, lineHeight: 18 },
  resultCard: { backgroundColor: color.card, borderRadius: radius.card, borderWidth: 1, borderColor: color.line, padding: 16, gap: 8, ...shadow.card },
  resultCardComplete: { borderColor: color.primary },
  resultTitle: { fontSize: 17, fontWeight: '700', color: color.text },
  resultBody: { fontSize: 13, color: color.body, lineHeight: 20 },
  hero: { backgroundColor: color.dark, borderRadius: radius.cardLg, padding: 20, gap: 10, ...shadow.raised },
  tag: { alignSelf: 'flex-start', backgroundColor: color.proGoldB, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 3 },
  tagText: { fontSize: 11, fontWeight: '800', color: color.dark, letterSpacing: 1 },
  heroTitle: { fontSize: 21, fontWeight: '700', color: '#FFFFFF', letterSpacing: -0.4, lineHeight: 29 },
  heroBody: { fontSize: 13, fontWeight: '500', color: color.darkSub, lineHeight: 20 },
  currentCard: { backgroundColor: color.proSoft, borderRadius: radius.card, borderWidth: 1, borderColor: color.candidateBorder, padding: 14, gap: 4 },
  currentTitle: { fontSize: 14, fontWeight: '700', color: color.pro },
  currentBody: { fontSize: 12.5, fontWeight: '500', color: color.body, lineHeight: 20 },
  sectionLabel: { fontSize: 12, fontWeight: '700', color: color.muted, paddingHorizontal: 4, marginTop: 2 },
  table: { backgroundColor: color.card, borderRadius: radius.card, borderWidth: 1, borderColor: color.line, overflow: 'hidden', ...shadow.card },
  tr: { flexDirection: 'row', alignItems: 'center', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.line2, paddingVertical: 10, paddingHorizontal: 10 },
  trHead: { borderTopWidth: 0, backgroundColor: color.bg },
  td: { flex: 1, fontSize: 12, color: color.body, textAlign: 'center' },
  tdLabel: { flex: 1.6, textAlign: 'left', fontWeight: '600', color: color.text },
  tdPlus: { fontWeight: '700', color: color.primaryDark },
  th: { fontWeight: '700', color: color.muted },
  thPlus: { color: color.primaryDark },
  featureCard: { backgroundColor: color.card, borderRadius: radius.card, borderWidth: 1, borderColor: color.line, overflow: 'hidden', ...shadow.card },
  featureRow: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14 },
  featureText: { flex: 1, gap: 2 },
  featureTitle: { fontSize: 15, fontWeight: '700', color: color.text },
  featureSub: { fontSize: 12.5, color: color.muted, lineHeight: 18 },
  badge: { fontSize: 11, fontWeight: '700', color: color.primaryDark, backgroundColor: color.primarySoft, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 2, overflow: 'hidden' },
  badgePreparing: { color: color.muted, backgroundColor: color.bg },
  sep: { height: StyleSheet.hairlineWidth, backgroundColor: color.line2, marginLeft: 14 },
  note: { fontSize: 12, fontWeight: '500', color: color.muted, paddingHorizontal: 4, lineHeight: 18 },
  intro: { fontSize: 12.5, fontWeight: '600', color: color.primaryDark, paddingHorizontal: 4, lineHeight: 18 },
  toggle: { flexDirection: 'row', gap: 10 },
  chip: { flex: 1, borderRadius: radius.card, borderWidth: 1.5, borderColor: color.line, backgroundColor: color.card, paddingVertical: 12, alignItems: 'center', gap: 2 },
  chipOn: { borderColor: color.primary, backgroundColor: color.primarySoft },
  chipOff: { opacity: 0.45 },
  chipLabel: { fontSize: 14, fontWeight: '700', color: color.text },
  chipLabelOn: { color: color.primaryDark },
  chipSub: { fontSize: 12, fontWeight: '600', color: color.muted, fontVariant: ['tabular-nums'] },
  changeNote: { fontSize: 12.5, color: color.body, lineHeight: 19, paddingHorizontal: 4 },
  actions: { gap: 10, marginTop: 4 },
  noteCard: { backgroundColor: color.bg, borderRadius: radius.card, padding: 14 },
  noteText: { fontSize: 12.5, fontWeight: '500', color: color.body, lineHeight: 19 },
  legalRow: { flexDirection: 'row', alignItems: 'center', marginTop: 8 },
  link: { fontSize: 12.5, fontWeight: '700', color: color.primaryDark, textDecorationLine: 'underline' },
  legalSep: { fontSize: 12.5, color: color.muted, marginHorizontal: 4 },
});
