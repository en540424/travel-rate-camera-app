import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { chip, radius, spacing } from '@/theme/tokens';

export interface ProFeatureBadgeProps {
  label?: string;
  style?: StyleProp<ViewStyle>;
}

/** Pro機能であることを示す表示用バッジ（RevenueCat未接続・購入導線は持たない） */
export function ProFeatureBadge({ label = 'Pro', style }: ProFeatureBadgeProps) {
  return (
    <View style={[styles.container, style]}>
      <Text style={styles.text}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: chip.proTag.bg,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    alignSelf: 'flex-start',
  },
  text: {
    fontSize: 10.5,
    fontWeight: chip.proTag.fontWeight,
    color: chip.proTag.fg,
  },
});
