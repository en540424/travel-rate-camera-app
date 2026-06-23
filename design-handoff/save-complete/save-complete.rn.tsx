/**
 * 保存完了 ・ phase='saved'
 * folder: save-complete/ ・ app/(tabs)/index.tsx（保存後の確認表示）
 * 数値は save-complete-spec.md、共通は _common/rn-common-notes.md。
 */
import React from 'react';
import { View, Text, Pressable, StyleSheet, Platform } from 'react-native';

const color = {
  teal600: '#0E9488', teal700: '#0A766E', teal50: '#E7F5F2',
  amber700: '#B5731A', amber50: '#FBF1DE',
  ink: '#16211F', ink2: '#5B6764', ink3: '#7E8986', ink4: '#939E9B',
  appBg: '#F5F7F6', surface: '#FFFFFF', line: '#ECEFED', lineStrong: '#DCE3E0',
};
const num = { fontVariant: ['tabular-nums'] as const };
const glow = Platform.select({
  ios: { shadowColor: color.teal600, shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.55, shadowRadius: 18 },
  android: { elevation: 6 },
});

type Bucket = 'candidate' | 'purchased';

export default function SavedConfirm({ bucket = 'candidate' as Bucket }) {
  const isCand = bucket === 'candidate';
  return (
    <View style={styles.screen}>
      <View style={styles.center}>
        <View style={styles.badgeOuter}>
          <View style={styles.badgeInner}><Text style={styles.check}>✓</Text></View>
        </View>
        <Text style={styles.title}>{isCand ? '候補に保存しました' : '購入済みにしました'}</Text>
        <Text style={styles.sub}>ハワイ旅行 ・ 買い物候補</Text>

        <View style={styles.itemCard}>
          <View style={styles.itemThumb} />
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={[styles.itemJpy, num]}>約¥788</Text>
              <View style={[styles.badge, isCand ? { backgroundColor: color.amber50 } : { backgroundColor: color.teal50 }]}>
                <Text style={[styles.badgeText, { color: isCand ? color.amber700 : color.teal700 }]}>{isCand ? '候補' : '購入済み'}</Text>
              </View>
            </View>
            <Text style={styles.itemSub} numberOfLines={1}>BBQ BEEF ・ $4.99</Text>
          </View>
        </View>

        <View style={styles.budgetCard}>
          <Text style={styles.budgetLabel}>残り予算</Text>
          <Text style={[styles.budgetValue, num]}>¥55,344</Text>
        </View>
      </View>

      <View style={styles.actions}>
        <Pressable style={styles.secondary}><Text style={styles.secondaryText}>履歴を見る</Text></Pressable>
        <Pressable style={[styles.primary, glow]}><Text style={styles.primaryText}>続けて撮影</Text></Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.appBg, paddingHorizontal: 15, paddingTop: 8, paddingBottom: 14 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  badgeOuter: { width: 72, height: 72, borderRadius: 999, backgroundColor: color.teal50, alignItems: 'center', justifyContent: 'center', marginBottom: 18 },
  badgeInner: { width: 50, height: 50, borderRadius: 999, backgroundColor: color.teal600, alignItems: 'center', justifyContent: 'center' },
  check: { color: '#fff', fontSize: 24, fontWeight: '800' },
  title: { fontSize: 19, fontWeight: '700', color: color.ink },
  sub: { fontSize: 13, fontWeight: '500', color: color.ink4, marginTop: 5 },
  itemCard: { width: '100%', marginTop: 20, backgroundColor: color.surface, borderWidth: 1, borderColor: color.line, borderRadius: 18, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 13 },
  itemThumb: { width: 52, height: 52, borderRadius: 13, backgroundColor: '#C4CCC6' },
  itemJpy: { fontSize: 22, fontWeight: '700', color: color.ink, letterSpacing: -0.5 },
  badge: { paddingVertical: 4, paddingHorizontal: 9, borderRadius: 999 },
  badgeText: { fontSize: 10, fontWeight: '700' },
  itemSub: { fontSize: 12.5, fontWeight: '600', color: color.ink2, marginTop: 4 },
  budgetCard: { width: '100%', marginTop: 11, backgroundColor: color.appBg, borderRadius: 14, paddingVertical: 12, paddingHorizontal: 15, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  budgetLabel: { fontSize: 12, fontWeight: '600', color: color.ink3 },
  budgetValue: { fontSize: 17, fontWeight: '700', color: color.teal700, letterSpacing: -0.2 },
  actions: { flexDirection: 'row', gap: 10 },
  secondary: { flex: 1, height: 50, borderRadius: 15, backgroundColor: '#fff', borderWidth: 1.5, borderColor: color.lineStrong, alignItems: 'center', justifyContent: 'center' },
  secondaryText: { fontSize: 14.5, fontWeight: '600', color: color.ink },
  primary: { flex: 1.2, height: 50, borderRadius: 15, backgroundColor: color.teal600, alignItems: 'center', justifyContent: 'center' },
  primaryText: { fontSize: 14.5, fontWeight: '600', color: '#fff' },
});
