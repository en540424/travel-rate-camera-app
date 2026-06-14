import type { ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { color, radius, shadow, spacing } from '@/theme/tokens';

export interface ActionSheetProps {
  visible: boolean;
  onClose: () => void;
  children: ReactNode;
  /** 背面を暗くするか（既定: true） */
  dimmed?: boolean;
  /** 背面タップで閉じるか（既定: true） */
  closeOnBackdropPress?: boolean;
  style?: StyleProp<ViewStyle>;
}

/** ボトムシート（操作/確認/上限/OCR）。上端radius22・shadow.sheet・背面dim */
export function ActionSheet({
  visible,
  onClose,
  children,
  dimmed = true,
  closeOnBackdropPress = true,
  style,
}: ActionSheetProps) {
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.root}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="閉じる"
          style={[StyleSheet.absoluteFill, dimmed && styles.backdropDimmed]}
          onPress={closeOnBackdropPress ? onClose : undefined}
        />
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing.lg) }, style]}>
          {children}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdropDimmed: {
    backgroundColor: 'rgba(17, 32, 30, 0.4)',
  },
  sheet: {
    backgroundColor: color.card,
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
    paddingTop: spacing.lg,
    paddingHorizontal: spacing.xl,
    ...shadow.sheet,
  },
});
