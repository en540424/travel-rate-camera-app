import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { color, radius, spacing, typography } from '@/theme/tokens';

export interface ErrorMessageProps {
  message: string;
  style?: StyleProp<ViewStyle>;
}

/** 入力/作成エラー。アンバー枠の注意ブロック */
export function ErrorMessage({ message, style }: ErrorMessageProps) {
  return (
    <View style={[styles.container, style]}>
      <Text style={styles.text}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: color.candidateSoft,
    borderWidth: 1,
    borderColor: color.candidateBorder,
    borderRadius: radius.chip,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  text: {
    ...typography.body,
    color: color.candidateText,
  },
});
