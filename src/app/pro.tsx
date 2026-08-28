import { Redirect, router } from 'expo-router';
import { Alert, Linking, ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { GhostButton, PrimaryButton } from '@/components/ui';
import { EXTERNAL_LINKS } from '@/config/external-links';
import { SHOW_PRO } from '@/config/feature-flags';
import { FREE_LIMITS } from '@/config/limits';
import { usePurchases, useProPlanDetails } from '@/hooks/use-purchases';
import { color, radius, shadow } from '@/theme/tokens';

/** iOSの正規サブスクリプション管理画面を開く。CustomerInfo.managementURLが無ければApple既定URLへフォールバック。 */
async function openSubscriptionManagement(managementURL: string | null) {
  const target = managementURL ?? EXTERNAL_LINKS.appleSubscriptionManagement;
  try {
    const canOpen = await Linking.canOpenURL(target);
    if (!canOpen) {
      Alert.alert('開けませんでした', 'サブスクリプション管理画面を開けませんでした。時間をおいて再度お試しください。');
      return;
    }
    await Linking.openURL(target);
  } catch {
    Alert.alert('開けませんでした', 'サブスクリプション管理画面を開けませんでした。時間をおいて再度お試しください。');
  }
}

interface Feature {
  title: string;
  sub: string;
}

const FEATURES: Feature[] = [
  { title: '保存件数の上限を解除', sub: `無料版は${FREE_LIMITS.saves}件まで。Proなら無制限に保存できます。` },
  { title: '旅行をいくつでも作成', sub: `無料版は${FREE_LIMITS.trips}件まで。Proなら複数の旅行を管理できます。` },
  {
    title: 'カテゴリー別の絞り込みと分析',
    sub: 'カテゴリーの保存は無料版でも使えます。Proなら履歴の絞り込みと、金額・件数・構成比の分析ができます。',
  },
  {
    title: 'CSVで書き出す',
    sub: '保存した記録をCSVで書き出し、Excelやスプレッドシートで自由に集計できます。',
  },
];

export default function ProScreen() {
  // Hooksは早期returnより前に呼ぶ（SHOW_PRO=falseでも呼び出し順を変えない）
  const { isPro, isInitialized, isLoading, monthlyPackage, annualPackage } = usePurchases();
  const { planPeriod, expirationDate, willRenew, managementURL } = useProPlanDetails();

  // 初回MVPはPro未実装。ルート直接アクセス（ディープリンク等）でも購入画面へ進めないようガードする（P0-02）
  if (!SHOW_PRO) {
    return <Redirect href="/(tabs)/settings" />;
  }

  const priceLoading = !isInitialized || isLoading;
  const priceText = priceLoading
    ? '価格を読み込み中…'
    : monthlyPackage || annualPackage
      ? [
          monthlyPackage ? `月額 ${monthlyPackage.product.priceString}` : null,
          annualPackage ? `年額 ${annualPackage.product.priceString}` : null,
        ]
          .filter(Boolean)
          .join(' / ')
      : '価格情報を取得できませんでした。時間をおいて再度お試しください。';

  // Pro有効時：購入を促す画面ではなく、契約状態の確認・管理画面として表示する
  if (isPro) {
    const planLabel = planPeriod === 'monthly' ? '月額' : planPeriod === 'annual' ? '年額' : null;
    const expirationLabel = expirationDate ? expirationDate.split('T')[0] : null;

    return (
      <View style={styles.screen}>
        <ScrollView contentContainerStyle={styles.scroll}>
          <View style={styles.hero}>
            <View style={styles.proTag}>
              <ThemedText style={styles.proTagText}>PRO</ThemedText>
            </View>
            <ThemedText style={styles.heroTitle}>Proは有効です</ThemedText>
            <ThemedText style={styles.heroBody}>
              保存件数・旅行作成数の制限が解除されています。
            </ThemedText>
          </View>

          {(planLabel != null || expirationLabel != null) && (
            <View style={styles.priceNoteCard}>
              <ThemedText style={styles.priceNoteTitle}>現在の契約</ThemedText>
              {planLabel != null && (
                <ThemedText style={styles.priceNoteBody}>プラン：{planLabel}</ThemedText>
              )}
              {expirationLabel != null && (
                <ThemedText style={styles.priceNoteBody}>
                  {willRenew === true
                    ? `次回更新日：${expirationLabel}`
                    : willRenew === false
                      ? `有効期限：${expirationLabel}（自動更新オフ）`
                      : `有効期限：${expirationLabel}`}
                </ThemedText>
              )}
            </View>
          )}

          <View style={styles.actions}>
            <PrimaryButton
              title="サブスクリプションを管理"
              onPress={() => openSubscriptionManagement(managementURL)}
            />
            <GhostButton title="購入を復元" onPress={() => router.push('/purchase-restore')} />
            <GhostButton title="戻る" onPress={() => router.back()} />
          </View>
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.scroll}>
        {/* 黒ヒーロー */}
        <View style={styles.hero}>
          <View style={styles.proTag}>
            <ThemedText style={styles.proTagText}>PRO</ThemedText>
          </View>
          <ThemedText style={styles.heroTitle}>旅の記録を、もっと自由に。</ThemedText>
          <ThemedText style={styles.heroBody}>
            無料版の使い心地はそのままに、保存・旅行数の上限を解放します。
          </ThemedText>
        </View>

        {/* 機能リスト */}
        <View style={styles.featureCard}>
          {FEATURES.map((f, i) => (
            <View key={f.title}>
              {i > 0 && <View style={styles.sep} />}
              <View style={styles.featureRow}>
                <View style={styles.check}>
                  <ThemedText style={styles.checkMark}>✓</ThemedText>
                </View>
                <View style={styles.featureTextWrap}>
                  <ThemedText style={styles.featureTitle}>{f.title}</ThemedText>
                  <ThemedText style={styles.featureSub}>{f.sub}</ThemedText>
                </View>
              </View>
            </View>
          ))}
        </View>

        <ThemedText style={styles.scopeNote}>
          高性能OCRなどのクラウド機能は、今回のProには含まれません。
        </ThemedText>

        {/* 価格 */}
        <View style={styles.priceNoteCard}>
          <ThemedText style={styles.priceNoteTitle}>料金プラン</ThemedText>
          <ThemedText style={styles.priceNoteBody}>{priceText}</ThemedText>
        </View>

        <View style={styles.actions}>
          <PrimaryButton title="プランを見る" onPress={() => router.push('/purchase-confirm')} />
          <GhostButton title="無料版との違いを見る" onPress={() => router.push('/pro-features')} />
          <GhostButton title="購入を復元" onPress={() => router.push('/purchase-restore')} />
          <GhostButton title="あとで" onPress={() => router.back()} />
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
  hero: {
    backgroundColor: color.dark,
    borderRadius: radius.cardLg,
    padding: 20,
    gap: 10,
    ...shadow.raised,
  },
  proTag: {
    alignSelf: 'flex-start',
    backgroundColor: color.proGoldB,
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  proTagText: {
    fontSize: 11,
    fontWeight: '800',
    color: color.dark,
    letterSpacing: 1,
  },
  heroTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: -0.4,
    lineHeight: 30,
  },
  heroBody: {
    fontSize: 13,
    fontWeight: '500',
    color: color.darkSub,
    lineHeight: 20,
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
    alignItems: 'flex-start',
    gap: 12,
    padding: 16,
  },
  check: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: color.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  checkMark: {
    fontSize: 13,
    fontWeight: '800',
    color: color.primary,
  },
  featureTextWrap: { flex: 1, gap: 2 },
  featureTitle: { fontSize: 15, fontWeight: '700', color: color.text },
  featureSub: { fontSize: 12.5, fontWeight: '500', color: color.muted, lineHeight: 18 },
  sep: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: color.line2,
    marginLeft: 52,
  },
  scopeNote: { fontSize: 12, fontWeight: '500', color: color.muted, paddingHorizontal: 4 },
  priceNoteCard: {
    backgroundColor: color.proSoft,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: color.candidateBorder,
    padding: 14,
    gap: 4,
  },
  priceNoteTitle: { fontSize: 14, fontWeight: '700', color: color.pro },
  priceNoteBody: { fontSize: 12.5, fontWeight: '500', color: color.body, lineHeight: 20 },
  actions: { gap: 10, marginTop: 4 },
});
