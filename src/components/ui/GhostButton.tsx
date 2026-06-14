import { Pressable, StyleSheet, Text, type StyleProp, type ViewStyle } from 'react-native';

import { button, color, typography } from '@/theme/tokens';

export type GhostButtonTone = 'default' | 'primary' | 'danger';

export interface GhostButtonProps {
  title: string;
  onPress: () => void;
  tone?: GhostButtonTone;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}

const TONE_COLOR: Record<GhostButtonTone, string> = {
  default: button.ghost.fg,
  primary: color.primaryDark,
  danger: color.danger,
};

/** 弱アクション（文字のみ）。「あとで」「プランを変更」等 */
export function GhostButton({ title, onPress, tone = 'default', disabled = false, style }: GhostButtonProps) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      style={({ pressed }) => [
        styles.base,
        { height: button.ghost.height },
        pressed && !disabled && styles.pressed,
        style,
      ]}>
      <Text style={[styles.label, { color: disabled ? color.faint2 : TONE_COLOR[tone] }]} numberOfLines={1}>
        {title}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  pressed: {
    opacity: 0.6,
  },
  label: {
    ...typography.bodyLg,
    fontWeight: '600',
  },
});
