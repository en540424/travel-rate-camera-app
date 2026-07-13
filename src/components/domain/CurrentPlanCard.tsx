import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { FREE_LIMITS } from '@/config/limits';
import { usePurchases, useProPlanDetails } from '@/hooks/use-purchases';
import { color, radius, shadow } from '@/theme/tokens';

/**
 * 設定トップ最下部の「現在のプラン」表示。
 * 無料/Proとも同じ黒カード（既存の黒ヒーローカード資産＝pro.tsxのヒーロー・settings.tsxの
 * 「現在の旅行」カードと同じ color.dark / proGoldB / heroBtn 相当のトークンの組み合わせ）を使い、
 * 状態だけを切り替える。カード自体の外観（黒・角丸・影）は無料/Proで変えない。
 * Pro判定はCustomerInfoのpro Entitlement（isPro）を正とし、ローカルの推測は行わない。
 * 状態確認中は「無料」と誤表示せず、取得失敗時も無料と断定しない。
 */
export function CurrentPlanCard() {
  const { isPro, isInitialized, isLoading, error, refreshCustomerInfo } = usePurchases();
  const { planPeriod } = useProPlanDetails();

  const checking = !isInitialized || isLoading;
  const failed = !checking && error != null && !isPro;
  // 確認中・取得失敗時はPro画面へ誘導しない（状態未確定のまま遷移させない）。再試行は専用ボタンで扱う。
  const canNavigate = !checking && !failed;

  let statusTitle: string;
  let statusBody: string;
  let actionText: string | null = null;
  if (checking) {
    statusTitle = 'プランを確認中…';
    statusBody = '';
  } else if (failed) {
    statusTitle = 'プランを確認できませんでした';
    statusBody = '時間をおいて再度お試しください';
  } else if (isPro) {
    statusTitle = 'Proをご利用中';
    statusBody =
      planPeriod === 'monthly'
        ? '保存件数・旅行作成数 無制限（月額）'
        : planPeriod === 'annual'
          ? '保存件数・旅行作成数 無制限（年額）'
          : '保存件数・旅行作成数 無制限';
    actionText = '契約内容を確認';
  } else {
    statusTitle = '無料プランをご利用中';
    statusBody = `保存${FREE_LIMITS.saves}件・旅行${FREE_LIMITS.trips}件まで無料。Proで無制限に。`;
    actionText = 'Proを見る';
  }

  const accessibilityLabel =
    actionText != null
      ? `旅レートカメラ Pro。${statusTitle}。${statusBody}。${actionText}`
      : `旅レートカメラ Pro。${statusTitle}${statusBody ? `。${statusBody}` : ''}`;

  return (
    <View style={styles.group}>
      <ThemedText style={styles.groupLabel}>現在のプラン</ThemedText>
      <Pressable
        onPress={canNavigate ? () => router.push('/pro') : undefined}
        disabled={!canNavigate}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        style={({ pressed }) => [styles.card, pressed && canNavigate && styles.cardPressed]}>
        <View style={styles.titleRow}>
          <ThemedText style={styles.appName}>旅レートカメラ</ThemedText>
          {isPro && (
            <View style={styles.proTag}>
              <ThemedText style={styles.proTagText}>PRO</ThemedText>
            </View>
          )}
        </View>

        <ThemedText style={[styles.statusTitle, isPro && !checking && !failed && styles.statusTitlePro]}>
          {statusTitle}
        </ThemedText>
        {statusBody !== '' && <ThemedText style={styles.statusBody}>{statusBody}</ThemedText>}

        {failed ? (
          <Pressable
            onPress={() => refreshCustomerInfo()}
            style={styles.actionBtn}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="再試行">
            <ThemedText style={styles.actionBtnText}>再試行</ThemedText>
          </Pressable>
        ) : (
          actionText != null && (
            // カード全体が単一のPressableのため、このボタンは非インタラクティブな見た目のみ（タップはカード全体で受ける）
            <View style={styles.actionBtn}>
              <ThemedText style={styles.actionBtnText}>{actionText}</ThemedText>
              <ThemedText style={styles.actionBtnChevron}>›</ThemedText>
            </View>
          )
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  group: { gap: 8 },
  groupLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: color.muted,
    letterSpacing: 0.3,
    paddingHorizontal: 4,
  },
  card: {
    // 無料/Pro/確認中/取得失敗のいずれも同じ黒カード（既存の黒ヒーローカードと同じトークン）。状態は中身だけで表す。
    backgroundColor: color.dark,
    borderRadius: radius.cardLg,
    padding: 16,
    gap: 6,
    ...shadow.raised,
  },
  cardPressed: {
    opacity: 0.9,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  appName: {
    fontSize: 17,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: -0.2,
  },
  // PROバッジ：ゴールド系。既存のPro導線カード（pro.tsxのproTag）と同じ組み合わせを再利用
  proTag: {
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
  statusTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  // Pro時のみ、ティールを小さな補助アクセントとして使用
  statusTitlePro: {
    color: color.primaryAccent,
  },
  statusBody: {
    fontSize: 12.5,
    fontWeight: '500',
    color: color.darkSub,
    lineHeight: 18,
  },
  // CTA：既存の黒カード内ボタン（settings.tsxの「現在の旅行」heroBtn）と同じ半透明白ピルを再利用
  actionBtn: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    backgroundColor: 'rgba(255,255,255,0.14)',
    borderRadius: radius.button,
    paddingHorizontal: 14,
    paddingVertical: 9,
    marginTop: 8,
  },
  actionBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  actionBtnChevron: {
    fontSize: 15,
    fontWeight: '700',
    color: color.darkSub,
  },
});
