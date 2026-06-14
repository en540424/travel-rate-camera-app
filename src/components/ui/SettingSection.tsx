import { Children, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { color, radius, shadow } from '@/theme/tokens';

export interface SettingSectionProps {
  /** セクション見出し（overline）。省略可 */
  title?: string;
  children: ReactNode;
}

/** 設定セクションの器：overline見出し＋白カード。子（SettingRow）間にhairline区切り。 */
export function SettingSection({ title, children }: SettingSectionProps) {
  const items = Children.toArray(children);
  return (
    <View style={styles.wrap}>
      {title != null && <ThemedText style={styles.title}>{title}</ThemedText>}
      <View style={styles.card}>
        {items.map((child, i) => (
          <View key={i}>
            {i > 0 && <View style={styles.separator} />}
            {child}
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: 8,
  },
  title: {
    fontSize: 12,
    fontWeight: '700',
    color: color.muted,
    letterSpacing: 0.3,
    paddingHorizontal: 4,
  },
  card: {
    backgroundColor: color.card,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: color.line,
    overflow: 'hidden',
    ...shadow.card,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: color.line2,
    marginLeft: 16,
  },
});
