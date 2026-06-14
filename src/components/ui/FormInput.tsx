import { useState } from 'react';
import {
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import { color, radius, spacing, typography } from '@/theme/tokens';

export interface FormInputProps extends Omit<TextInputProps, 'style' | 'value' | 'onChangeText'> {
  label?: string;
  value: string;
  onChangeText: (text: string) => void;
  /** 入力欄右側の単位表示（例: "円" "$"） */
  suffix?: string;
  /** フィールド単位のエラー文言。指定時は枠をdangerにし、下に文言を表示 */
  error?: string;
  containerStyle?: StyleProp<ViewStyle>;
  inputStyle?: StyleProp<TextStyle>;
}

/** 入力欄（金額/名称）。フォーカス枠＝primary。金額はnumeric（tabular-nums）を付与 */
export function FormInput({
  label,
  value,
  onChangeText,
  suffix,
  error,
  containerStyle,
  inputStyle,
  keyboardType,
  onFocus,
  onBlur,
  ...rest
}: FormInputProps) {
  const [focused, setFocused] = useState(false);

  const isNumeric = keyboardType === 'numeric' || keyboardType === 'decimal-pad' || keyboardType === 'number-pad';
  const borderColor = error != null ? color.danger : focused ? color.primary : color.inputBorder;

  return (
    <View style={[styles.container, containerStyle]}>
      {label != null && <Text style={styles.label}>{label}</Text>}
      <View style={[styles.field, { borderColor }]}>
        <TextInput
          value={value}
          onChangeText={onChangeText}
          keyboardType={keyboardType}
          placeholderTextColor={color.faint2}
          style={[styles.input, isNumeric && styles.inputNumeric, inputStyle]}
          onFocus={(e) => {
            setFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            onBlur?.(e);
          }}
          {...rest}
        />
        {suffix != null && <Text style={styles.suffix}>{suffix}</Text>}
      </View>
      {error != null && <Text style={styles.errorText}>{error}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.xs,
  },
  label: {
    ...typography.label,
    color: color.muted,
  },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 50,
    borderWidth: 1.5,
    borderColor: color.inputBorder,
    borderRadius: radius.button,
    backgroundColor: color.card,
    paddingHorizontal: spacing.md,
  },
  input: {
    flex: 1,
    ...typography.bodyLg,
    color: color.text,
    paddingVertical: spacing.sm,
  },
  inputNumeric: {
    fontVariant: ['tabular-nums'],
  },
  suffix: {
    ...typography.body,
    color: color.muted,
    marginLeft: spacing.xs,
  },
  errorText: {
    ...typography.caption,
    color: color.danger,
  },
});
