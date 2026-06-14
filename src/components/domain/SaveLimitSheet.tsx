import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ActionSheet, GhostButton, PrimaryButton } from '@/components/ui';
import { FREE_LIMITS } from '@/config/limits';
import { color } from '@/theme/tokens';

export interface SaveLimitSheetProps {
  visible: boolean;
  onClose: () => void;
  onUpgrade: () => void;
  /** 現在の保存件数（既定は上限） */
  saved?: number;
  limit?: number;
}

/**
 * 保存上限シート（design 濃いタブ「保存上限」）。責めず「もっと使いたいならPro」。
 * ※トリガーは保存フロー側。ここはUI部品のみ（接続は保護領域につき別途）。
 */
export function SaveLimitSheet({ visible, onClose, onUpgrade, saved, limit = FREE_LIMITS.saves }: SaveLimitSheetProps) {
  const count = saved ?? limit;
  const ratio = Math.min(1, count / limit);
  return (
    <ActionSheet visible={visible} onClose={onClose}>
      <View style={styles.iconWrap}><ThemedText style={styles.icon}>🗂</ThemedText></View>
      <ThemedText style={styles.title}>無料版の保存上限に達しました</ThemedText>
      <ThemedText style={styles.body}>
        Proにすると、旅行中の買い物を制限なく保存できます。保存済みの記録はそのまま残ります。
      </ThemedText>

      <View style={styles.quota}>
        <ThemedText style={styles.quotaLabel}>無料版の保存件数</ThemedText>
        <ThemedText style={styles.quotaValue}>{count} / {limit}件</ThemedText>
      </View>
      <View style={styles.barTrack}>
        <View style={[styles.barFill, { width: `${ratio * 100}%` }]} />
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
  barTrack: { height: 8, borderRadius: 4, backgroundColor: color.line2, marginTop: 6, overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: 4, backgroundColor: color.candidate },
  actions: { gap: 8, marginTop: 18 },
});
