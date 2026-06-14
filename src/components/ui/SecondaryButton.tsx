import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { button, color, typography } from '@/theme/tokens';

export interface SecondaryButtonProps {
  title: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  icon?: ReactNode;
  style?: StyleProp<ViewStyle>;
}

/** 副アクション（白＋枠）。枠1.5・inputBorder */
export function SecondaryButton({ title, onPress, loading = false, disabled = false, icon, style }: SecondaryButtonProps) {
  const isDisabled = disabled || loading;

  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      style={({ pressed }) => [
        styles.base,
        {
          backgroundColor: button.secondary.bg,
          height: button.secondary.height,
          borderRadius: button.secondary.radius,
          borderWidth: button.secondary.borderWidth,
          borderColor: button.secondary.borderColor,
        },
        isDisabled && styles.disabled,
        pressed && !isDisabled && styles.pressed,
        style,
      ]}>
      {loading ? (
        <ActivityIndicator color={color.text} />
      ) : (
        <View style={styles.content}>
          {icon}
          <Text
            style={[styles.label, { color: isDisabled ? color.faint2 : button.secondary.fg }]}
            numberOfLines={1}>
            {title}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  pressed: {
    opacity: 0.7,
  },
  disabled: {
    opacity: 0.5,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  label: {
    ...typography.title,
  },
});
