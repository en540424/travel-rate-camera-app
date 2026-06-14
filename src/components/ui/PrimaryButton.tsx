import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { button, typography } from '@/theme/tokens';

export interface PrimaryButtonProps {
  title: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  icon?: ReactNode;
  style?: StyleProp<ViewStyle>;
}

/** 主アクション（ティール塗り＋影）。高さ52・radius15・shadow.cta。disabled時はbutton.disabled */
export function PrimaryButton({ title, onPress, loading = false, disabled = false, icon, style }: PrimaryButtonProps) {
  const isDisabled = disabled || loading;
  const tokens = isDisabled ? button.disabled : button.primary;

  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      style={({ pressed }) => [
        styles.base,
        {
          backgroundColor: tokens.bg,
          height: tokens.height,
          borderRadius: tokens.radius,
        },
        !isDisabled && button.primary.shadow,
        pressed && !isDisabled && styles.pressed,
        style,
      ]}>
      {loading ? (
        <ActivityIndicator color={tokens.fg} />
      ) : (
        <View style={styles.content}>
          {icon}
          <Text style={[styles.label, { color: tokens.fg }]} numberOfLines={1}>
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
    opacity: 0.85,
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
