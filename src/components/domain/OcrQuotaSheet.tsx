import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ActionSheet, GhostButton, PrimaryButton } from '@/components/ui';
import { PRO_OCR_QUOTA } from '@/config/limits';
import { color, radius } from '@/theme/tokens';

export interface OcrQuotaSheetProps {
  visible: boolean;
  onClose: () => void;
  /** 主導線：手入力で続ける */
  onManual: () => void;
  /** 副導線：プランを確認 */
  onUpgrade: () => void;
  used?: number;
  total?: number;
  /** リセット日（例: "7月1日"） */
  resetLabel?: string;
}

/**
 * 高性能OCR 使い切りシート（design 濃いタブ「高性能OCR 使い切り」）。
 * 「使えない」で終わらせず、手入力で続けるを主導線に。回数リセット日を明記。
 * ※トリガーはOCRフロー側。ここはUI部品のみ（接続は保護領域につき別途）。
 */
export function OcrQuotaSheet({ visible, onClose, onManual, onUpgrade, used, total = PRO_OCR_QUOTA.month, resetLabel }: OcrQuotaSheetProps) {
  const remaining = used != null ? Math.max(0, total - used) : 0;
  return (
    <ActionSheet visible={visible} onClose={onClose}>
      <View style={styles.iconWrap}><ThemedText style={styles.icon}>🕐</ThemedText></View>
      <ThemedText style={styles.title}>今月の高性能OCR回数を使い切りました</ThemedText>
      <ThemedText style={styles.body}>
        {resetLabel ? `${resetLabel}に回数がリセットされます。` : '翌月に回数がリセットされます。'}
        基本OCRと手入力は引き続き使えます。
      </ThemedText>

      <View style={styles.quotaPill}>
        <ThemedText style={styles.quotaLabel}>今月の高性能OCR</ThemedText>
        <ThemedText style={styles.quotaValue}>{remaining} / {total}回</ThemedText>
      </View>

      <View style={styles.actions}>
        <PrimaryButton title="手入力で続ける" onPress={onManual} />
        <GhostButton title="プランを確認" onPress={onUpgrade} />
      </View>
    </ActionSheet>
  );
}

const styles = StyleSheet.create({
  iconWrap: { alignSelf: 'center', width: 52, height: 52, borderRadius: 26, backgroundColor: color.bg, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  icon: { fontSize: 22 },
  title: { fontSize: 16.5, fontWeight: '700', color: color.text, textAlign: 'center' },
  body: { fontSize: 13, fontWeight: '500', color: color.muted, textAlign: 'center', lineHeight: 20, marginTop: 6 },
  quotaPill: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: color.bg, borderRadius: radius.chip, paddingHorizontal: 14, paddingVertical: 10, marginTop: 16,
  },
  quotaLabel: { fontSize: 12.5, fontWeight: '600', color: color.body },
  quotaValue: { fontSize: 13, fontWeight: '700', color: color.text, fontVariant: ['tabular-nums'] },
  actions: { gap: 8, marginTop: 18 },
});
