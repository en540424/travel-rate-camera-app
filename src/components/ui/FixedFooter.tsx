import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { color, spacing } from '@/theme/tokens';

export interface FixedFooterProps {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}

/** 画面下固定のCTA帯。上線line2＋白背景。ScrollViewと分離して使う */
export function FixedFooter({ children, style }: FixedFooterProps) {
  const insets = useSafeAreaInsets();

  return (
    <View
      style={[
        styles.base,
        { paddingBottom: Math.max(insets.bottom, spacing.lg) },
        style,
      ]}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    backgroundColor: color.card,
    borderTopWidth: 1,
    borderTopColor: color.line2,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
    gap: spacing.sm,
  },
});
