import { useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ActionSheet } from '@/components/ui';
import { CURRENCIES } from '@/constants/currencies';
import type { TripRow } from '@/db/queries/trips';
import { useAllHistory } from '@/hooks/use-all-history';
import { color, radius } from '@/theme/tokens';
import { formatJpy } from '@/utils/format';

export interface ActiveTripSwitchSheetProps {
  visible: boolean;
  onClose: () => void;
  trips: TripRow[];
  activeTripId: number | null;
  onSelect: (id: number) => void;
}

/**
 * アクティブ旅行切り替えシート（design: アクティブ切替）。
 * 既存の switchTrip を呼ぶだけ（旅行切り替えロジックは変更しない）。
 * 各行にレートと残予算（アーカイブ済みは使用額）を併記。
 */
export function ActiveTripSwitchSheet({ visible, onClose, trips, activeTripId, onSelect }: ActiveTripSwitchSheetProps) {
  const { history } = useAllHistory();

  const usedByTrip = useMemo(() => {
    const m = new Map<number, number>();
    for (const r of history) {
      if (r.trip_id == null) continue;
      m.set(r.trip_id, (m.get(r.trip_id) ?? 0) + Math.round(r.jpy_amount));
    }
    return m;
  }, [history]);

  return (
    <ActionSheet visible={visible} onClose={onClose}>
      <ThemedText style={styles.title}>使う旅行を切り替え</ThemedText>
      <ThemedText style={styles.subtitle}>カメラと履歴が、選んだ旅行に切り替わります</ThemedText>

      <View style={styles.list}>
        {trips.map((t) => {
          const selected = t.id === activeTripId;
          const archived = t.archived_at != null;
          const used = usedByTrip.get(t.id) ?? 0;
          const remaining = Math.max(0, t.budget_jpy - used);
          const ratePart =
            t.base_currency === 'JPY'
              ? '🇯🇵 国内'
              : `${CURRENCIES[t.base_currency].flag} ¥${t.manual_rate}`;
          const moneyPart = archived
            ? `使用 ${formatJpy(used)}`
            : t.budget_jpy > 0
              ? `残り ${formatJpy(remaining)}`
              : '予算未設定';

          return (
            <Pressable
              key={t.id}
              onPress={() => onSelect(t.id)}
              style={({ pressed }) => [
                styles.row,
                selected && styles.rowSelected,
                archived && styles.rowArchived,
                pressed && styles.rowPressed,
              ]}>
              <View style={styles.rowText}>
                <View style={styles.rowNameLine}>
                  <ThemedText style={styles.rowName} numberOfLines={1}>
                    {t.name}
                  </ThemedText>
                  {archived && (
                    <View style={styles.archivedTag}>
                      <ThemedText style={styles.archivedTagText}>終了</ThemedText>
                    </View>
                  )}
                </View>
                <ThemedText style={styles.rowSub} numberOfLines={1}>
                  {ratePart}・{moneyPart}
                </ThemedText>
              </View>
              {selected && <ThemedText style={styles.check}>✓</ThemedText>}
            </Pressable>
          );
        })}
      </View>

      <Pressable
        onPress={onClose}
        style={({ pressed }) => [styles.closeBtn, pressed && styles.rowPressed]}>
        <ThemedText style={styles.closeText}>閉じる</ThemedText>
      </Pressable>
    </ActionSheet>
  );
}

const styles = StyleSheet.create({
  title: {
    fontSize: 17,
    fontWeight: '700',
    color: color.text,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 13,
    fontWeight: '500',
    color: color.muted,
    textAlign: 'center',
    marginTop: 4,
    marginBottom: 16,
  },
  list: {
    gap: 10,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: radius.card,
    borderWidth: 1.5,
    borderColor: color.line,
    backgroundColor: color.card,
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  rowSelected: {
    borderColor: color.primary,
    backgroundColor: color.primarySoft2,
  },
  rowArchived: {
    opacity: 0.55,
  },
  rowPressed: {
    opacity: 0.7,
  },
  rowText: {
    flex: 1,
    gap: 3,
  },
  rowNameLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  rowName: {
    fontSize: 15,
    fontWeight: '700',
    color: color.text,
    flexShrink: 1,
  },
  archivedTag: {
    backgroundColor: color.line2,
    borderRadius: radius.pill,
    paddingHorizontal: 7,
    paddingVertical: 1,
  },
  archivedTagText: {
    fontSize: 10.5,
    fontWeight: '700',
    color: color.muted,
  },
  rowSub: {
    fontSize: 12.5,
    fontWeight: '500',
    color: color.muted,
    fontVariant: ['tabular-nums'],
  },
  check: {
    fontSize: 18,
    fontWeight: '800',
    color: color.primary,
  },
  closeBtn: {
    marginTop: 14,
    borderRadius: radius.card,
    borderWidth: 1.5,
    borderColor: color.inputBorder,
    paddingVertical: 14,
    alignItems: 'center',
  },
  closeText: {
    fontSize: 15,
    fontWeight: '700',
    color: color.body,
  },
});
