import type { ReactNode } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { emptyState, spacing } from '@/theme/tokens';

import { PrimaryButton } from './PrimaryButton';
import { SecondaryButton } from './SecondaryButton';

export interface EmptyStateAction {
  title: string;
  onPress: () => void;
}

export interface EmptyStateProps {
  /** 機能を表すアイコン。tone='neutral'時は旅行未選択などの中立アイコン枠になる */
  icon?: ReactNode;
  title: string;
  body: string;
  primary?: EmptyStateAction;
  secondary?: EmptyStateAction;
  /** 'neutral' = 旅行未選択など（emptyState.iconWrapNeutral） */
  tone?: 'default' | 'neutral';
  style?: StyleProp<ViewStyle>;
}

/** 空/未選択の共通レイアウト。アイコン枠はemptyState、意味で色分け */
export function EmptyState({ icon, title, body, primary, secondary, tone = 'default', style }: EmptyStateProps) {
  const iconBg = tone === 'neutral' ? emptyState.iconWrapNeutral.bg : emptyState.iconWrap.bg;

  return (
    <View style={[styles.container, style]}>
      {icon != null && (
        <View
          style={[
            styles.iconWrap,
            {
              width: emptyState.iconWrap.size,
              height: emptyState.iconWrap.size,
              borderRadius: emptyState.iconWrap.radius,
              backgroundColor: iconBg,
            },
          ]}>
          {icon}
        </View>
      )}
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.body}>{body}</Text>
      {(primary != null || secondary != null) && (
        <View style={styles.actions}>
          {primary != null && <PrimaryButton title={primary.title} onPress={primary.onPress} />}
          {secondary != null && <SecondaryButton title={secondary.title} onPress={secondary.onPress} />}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    paddingHorizontal: spacing.xxl,
  },
  iconWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  title: {
    ...emptyState.title,
    marginBottom: spacing.xs,
    textAlign: 'center',
  },
  body: {
    ...emptyState.body,
  },
  actions: {
    width: '100%',
    gap: spacing.sm,
    marginTop: emptyState.gapToButton,
  },
});
