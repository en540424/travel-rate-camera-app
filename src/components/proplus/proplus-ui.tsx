/** Pro+の画面で共通に使う小さな部品（注意書き・チップ・行）。既存の `theme/tokens.ts` の値だけを使う。 */
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import type { ProPlusAccess } from '@/lib/proplus/proplus-access-core';
import { color, radius, spacing } from '@/theme/tokens';

export function AccessNotice({ access, blocked }: { access: ProPlusAccess; blocked?: string | null }) {
  if (blocked) {
    return (
      <Notice tone="danger">
        Pro+のデータを読み込めませんでした（{blocked}）。データを守るため、保存を止めています。アプリを更新してから開き直してください。
      </Notice>
    );
  }
  if (access === 'read_only') return <Notice>Pro+の契約が無いため閲覧のみです。保存した場所・予定は消えません。</Notice>;
  if (access === 'upsell') return <Notice>Pro+の機能です。Pro+のプランは「Pro+のプラン」から確認できます。</Notice>;
  return null;
}

export function Notice({ children, tone = 'info' }: { children: ReactNode; tone?: 'info' | 'danger' }) {
  return (
    <View style={[styles.notice, tone === 'danger' && styles.noticeDanger]}>
      <ThemedText style={[styles.noticeText, tone === 'danger' && { color: color.danger }]}>{children}</ThemedText>
    </View>
  );
}

export function Chip({ label, selected, onPress }: { label: string; selected?: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.chip, selected && styles.chipOn]} accessibilityRole="button" accessibilityState={{ selected }}>
      <ThemedText style={[styles.chipText, selected && styles.chipTextOn]}>{label}</ThemedText>
    </Pressable>
  );
}

export function Row({ title, sub, right, onPress }: { title: string; sub?: string; right?: ReactNode; onPress?: () => void }) {
  return (
    <Pressable onPress={onPress} disabled={!onPress} style={({ pressed }) => [styles.row, pressed && { opacity: 0.6 }]}>
      <View style={{ flex: 1 }}>
        <ThemedText style={styles.rowTitle} numberOfLines={1}>{title}</ThemedText>
        {sub ? <ThemedText style={styles.rowSub} numberOfLines={2}>{sub}</ThemedText> : null}
      </View>
      {right}
    </Pressable>
  );
}

export const pp = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bgScreen },
  content: { padding: spacing.lg, gap: spacing.md, paddingBottom: 48 },
  h2: { fontSize: 15, fontWeight: '700', color: color.text, marginTop: spacing.sm },
  muted: { fontSize: 12, color: color.muted },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  rowButtons: { flexDirection: 'row', gap: spacing.sm },
  error: { color: color.danger, fontSize: 13 },
  warn: { color: color.candidateText, fontSize: 13 },
});

const styles = StyleSheet.create({
  notice: { backgroundColor: color.primarySoft, borderRadius: radius.card, padding: spacing.md },
  noticeDanger: { backgroundColor: color.dangerSoft },
  noticeText: { fontSize: 13, color: color.primaryDark, lineHeight: 19 },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: radius.chip, borderWidth: 1, borderColor: color.inputBorder, backgroundColor: color.card },
  chipOn: { backgroundColor: color.primary, borderColor: color.primary },
  chipText: { fontSize: 13, color: color.body },
  chipTextOn: { color: '#fff', fontWeight: '700' },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: color.line3 },
  rowTitle: { fontSize: 15, color: color.text, fontWeight: '600' },
  rowSub: { fontSize: 12, color: color.muted, marginTop: 2 },
});
