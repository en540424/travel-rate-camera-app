import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ActionSheet, GhostButton, PrimaryButton } from '@/components/ui';
import { FREE_LIMITS } from '@/config/limits';
import { color } from '@/theme/tokens';

export interface TripLimitSheetProps {
  visible: boolean;
  onClose: () => void;
  onUpgrade: () => void;
}

/**
 * 旅行作成上限シート。SaveLimitSheetと同じ構成・トーンで、責めず「もっと使いたいならPro」。
 * トリガーは旅行作成フロー側（trip-create.tsx）。ここはUI部品のみ。
 */
export function TripLimitSheet({ visible, onClose, onUpgrade }: TripLimitSheetProps) {
  return (
    <ActionSheet visible={visible} onClose={onClose}>
      <View style={styles.iconWrap}><ThemedText style={styles.icon}>🧳</ThemedText></View>
      <ThemedText style={styles.title}>無料版は旅行1件までです</ThemedText>
      <ThemedText style={styles.body}>
        Proにすると、複数の旅行を同時に管理できます。今の旅行の記録はそのまま残ります。
      </ThemedText>

      <View style={styles.quota}>
        <ThemedText style={styles.quotaLabel}>無料版の旅行数</ThemedText>
        <ThemedText style={styles.quotaValue}>{FREE_LIMITS.trips}件まで</ThemedText>
      </View>

      <View style={styles.actions}>
        <PrimaryButton title="★ Proにアップグレード" onPress={onUpgrade} />
        <GhostButton title="あとで" onPress={onClose} />
      </View>
    </ActionSheet>
  );
}

const styles = StyleSheet.create({
  iconWrap: { alignSelf: 'center', width: 52, height: 52, borderRadius: 26, backgroundColor: color.candidateSoft, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  icon: { fontSize: 24 },
  title: { fontSize: 17, fontWeight: '700', color: color.text, textAlign: 'center' },
  body: { fontSize: 13, fontWeight: '500', color: color.muted, textAlign: 'center', lineHeight: 20, marginTop: 6 },
  quota: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 16 },
  quotaLabel: { fontSize: 12.5, fontWeight: '600', color: color.body },
  quotaValue: { fontSize: 13, fontWeight: '700', color: color.candidateStrong, fontVariant: ['tabular-nums'] },
  actions: { gap: 8, marginTop: 18 },
});
