import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { color, radius } from '@/theme/tokens';

export interface SettingRowProps {
  label: string;
  /** 右側の補助値（例: "3つの旅行" / "USD"） */
  value?: string;
  /** Proバッジなどの小ラベル */
  badge?: string;
  /** 左アイコン（任意・線画SVG等。未指定なら省略） */
  icon?: ReactNode;
  onPress?: () => void;
  /** 破壊的アクション（全削除など）は赤字に */
  danger?: boolean;
}

/** 設定・データ管理の1行（左ラベル / 右に値・バッジ・シェブロン）。SettingSection 内で使用。 */
export function SettingRow({ label, value, badge, icon, onPress, danger }: SettingRowProps) {
  return (
    <Pressable
      onPress={onPress}
      disabled={onPress == null}
      style={({ pressed }) => [styles.row, pressed && onPress != null && styles.pressed]}>
      {icon != null && <View style={styles.icon}>{icon}</View>}
      <ThemedText style={[styles.label, danger && styles.labelDanger]} numberOfLines={1}>
        {label}
      </ThemedText>
      <View style={styles.right}>
        {badge != null && (
          <View style={styles.badge}>
            <ThemedText style={styles.badgeText}>{badge}</ThemedText>
          </View>
        )}
        {value != null && value !== '' && (
          <ThemedText style={styles.value} numberOfLines={1}>
            {value}
          </ThemedText>
        )}
        {onPress != null && !danger && <ThemedText style={styles.chevron}>›</ThemedText>}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 15,
    paddingHorizontal: 16,
    minHeight: 54,
  },
  pressed: {
    backgroundColor: color.line3,
  },
  icon: {
    width: 34,
    height: 34,
    borderRadius: radius.chip,
    backgroundColor: color.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    color: color.text,
  },
  labelDanger: {
    color: color.danger,
  },
  right: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexShrink: 0,
  },
  value: {
    fontSize: 13,
    fontWeight: '500',
    color: color.muted,
    fontVariant: ['tabular-nums'],
  },
  chevron: {
    fontSize: 20,
    fontWeight: '400',
    color: color.faint2,
    marginTop: -2,
  },
  badge: {
    backgroundColor: color.proSoft,
    borderRadius: radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: color.pro,
  },
});
