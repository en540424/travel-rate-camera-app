import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { color, radius, shadow, spacing } from '@/theme/tokens';

export interface SectionCardProps {
  children: ReactNode;
  padding?: number;
  style?: StyleProp<ViewStyle>;
}

/** 白角丸カードの器。card.base相当（影はshadow.card） */
export function SectionCard({ children, padding = spacing.lg, style }: SectionCardProps) {
  return <View style={[styles.base, { padding }, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  base: {
    backgroundColor: color.card,
    borderWidth: 1,
    borderColor: color.line,
    borderRadius: radius.card,
    ...shadow.card,
  },
});
