import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { CATEGORIES, type CategoryId } from '@/config/categories';
import { color, radius } from '@/theme/tokens';

export interface CategorySelectorProps {
  /** 選択中カテゴリー。`null`は未分類 */
  value: CategoryId | null;
  /** 同じチップを再tapすると`null`（未分類）が渡る */
  onChange: (next: CategoryId | null) => void;
  style?: StyleProp<ViewStyle>;
}

/**
 * カテゴリー選択チップ列。**保存フロー（カメラ画面）と編集画面の共通部品**。
 *
 * カテゴリー定義は`config/categories.ts`が唯一の正で、ここには持たない。
 * 選択は任意で、未選択（`null` ＝ 未分類）のまま保存できる。
 * 同じチップをもう一度押すと未分類へ戻せる（「選んだら解除できない」を避ける）。
 */
export function CategorySelector({ value, onChange, style }: CategorySelectorProps) {
  return (
    <View style={[styles.chips, style]}>
      {CATEGORIES.map((category) => {
        const selected = value === category.id;
        return (
          <Pressable
            key={category.id}
            onPress={() => onChange(selected ? null : category.id)}
            style={({ pressed }) => [
              styles.chip,
              selected && styles.chipSelected,
              pressed && styles.pressed,
            ]}
            accessibilityRole="button"
            accessibilityState={{ selected }}>
            <ThemedText style={[styles.chipText, selected && styles.chipTextSelected]}>
              {category.label}
            </ThemedText>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: color.inputBorder,
    backgroundColor: color.card,
  },
  chipSelected: { backgroundColor: color.primaryBorder, borderColor: color.primary },
  chipText: { fontSize: 13.5, fontWeight: '700', color: color.muted },
  chipTextSelected: { color: color.primaryDark, fontWeight: '800' },
  pressed: { opacity: 0.85 },
});
