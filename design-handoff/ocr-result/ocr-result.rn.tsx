/**
 * OCR結果（成功）・ 結果パネル ResultSheet
 * folder: ocr-result/ ・ app/(tabs)/index.tsx 内のボトムシート
 *
 * 雛形：ScrollArea ＋ 固定Footer の2層。OCR失敗/商品写真も同じ ResultSheet を使う。
 * 共通事項は _common/rn-common-notes.md、数値は ocr-result-spec.md。
 */
import React, { useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const color = {
  teal600: '#0E9488', teal700: '#0A766E', teal50: '#E7F5F2',
  amber700: '#B5731A', amber50: '#FBF1DE',
  ink: '#16211F', ink2: '#5B6764', ink3: '#7E8986', ink4: '#939E9B',
  surface: '#FFFFFF', appBg: '#F5F7F6', line: '#E7EBE9', line2: '#EEF1F0',
};
const num = { fontVariant: ['tabular-nums'] as const };
const ctaGlow = Platform.select({
  ios: { shadowColor: color.teal600, shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.55, shadowRadius: 18 },
  android: { elevation: 6 },
});

type Bucket = 'candidate' | 'purchased';

export default function OcrResultSheet() {
  const insets = useSafeAreaInsets();
  const [bucket, setBucket] = useState<Bucket>('candidate');
  const jpy = 788;

  return (
    <View style={{ flex: 1, backgroundColor: '#11201E' }}>
      {/* camera peek */}
      <View style={styles.peek} />
      {/* sheet */}
      <View style={styles.sheet}>
        <View style={styles.handle} />

        <ScrollView contentContainerStyle={{ paddingHorizontal: 15, paddingBottom: 132 }} showsVerticalScrollIndicator={false}>
          {/* CapturedThumbRow */}
          <View style={styles.thumbRow}>
            <View style={styles.thumb} />
            <Text style={styles.thumbTitle}>読み取り完了</Text>
            <Pressable><Text style={styles.retake}>撮り直す</Text></Pressable>
            <Pressable style={styles.closeBtn}><Text style={{ color: color.ink3, fontWeight: '700' }}>✕</Text></Pressable>
          </View>

          {/* ConvertedHero */}
          <View style={styles.heroRow}>
            <View>
              <Text style={styles.heroOverline}>日本円で</Text>
              <Text style={[styles.heroJpy, num]}>¥{jpy.toLocaleString()}</Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={[styles.heroForeign, num]}>$4.99</Text>
              <Text style={styles.heroLabel}>会員価格</Text>
            </View>
          </View>

          {/* RemainingBudgetPill */}
          <View style={styles.budgetPill}>
            <Text style={styles.budgetPillLabel}>保存後の残り予算</Text>
            <Text style={[styles.budgetPillValue, num]}>¥55,344</Text>
          </View>

          {/* CandidateChips */}
          <View style={styles.chipRow}>
            {[
              { jpy: '¥788', f: '$4.99', sel: true },
              { jpy: '¥1,026', f: '$6.49', sel: false },
              { jpy: '¥237', f: '$1.50', sel: false },
            ].map((c, i) => (
              <View key={i} style={[styles.chip, c.sel ? styles.chipSel : styles.chipUnsel]}>
                <Text style={[styles.chipJpy, num]}>{c.jpy}</Text>
                <Text style={[styles.chipF, num]}>{c.f}</Text>
              </View>
            ))}
          </View>

          {/* SavePhotoRow（簡略） */}
          <View style={styles.photoCard}>
            <Text style={styles.photoTitle}>履歴に残す写真</Text>
            <View style={{ flexDirection: 'row', gap: 7, marginTop: 10 }}>
              <Pressable style={styles.shootBtn}><Text style={styles.shootText}>商品写真を撮る</Text></Pressable>
              <Pressable style={styles.otherBtn}><Text style={styles.otherText}>他から</Text></Pressable>
            </View>
          </View>
        </ScrollView>

        {/* ResultFooter（固定） */}
        <View style={[styles.footer, { paddingBottom: insets.bottom + 13 }]}>
          <View style={styles.toggle}>
            <Pressable style={[styles.toggleItem, bucket === 'candidate' && styles.toggleCandidate]} onPress={() => setBucket('candidate')}>
              <Text style={[styles.toggleText, bucket === 'candidate' && { color: color.amber700 }]}>候補に保存</Text>
            </Pressable>
            <Pressable style={[styles.toggleItem, bucket === 'purchased' && styles.togglePurchased]} onPress={() => setBucket('purchased')}>
              <Text style={[styles.toggleText, bucket === 'purchased' && { color: color.teal700 }]}>購入済みにする</Text>
            </Pressable>
          </View>
          <Pressable style={[styles.saveBtn, ctaGlow]}>
            <Text style={[styles.saveText, num]}>¥{jpy.toLocaleString()} を{bucket === 'candidate' ? '候補に保存' : '購入済みに'}</Text>
          </Pressable>
          <Pressable hitSlop={8} style={styles.skip}><Text style={styles.skipText}>保存せず次の商品へ →</Text></Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  peek: { height: 40, backgroundColor: '#6A736D' },
  sheet: { flex: 1, backgroundColor: color.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, marginTop: -18, paddingTop: 9 },
  handle: { width: 38, height: 5, borderRadius: 999, backgroundColor: '#E0E5E2', alignSelf: 'center', marginBottom: 9 },
  thumbRow: { flexDirection: 'row', alignItems: 'center', gap: 9, marginBottom: 10 },
  thumb: { width: 32, height: 32, borderRadius: 8, backgroundColor: '#C4CCC6' },
  thumbTitle: { flex: 1, fontSize: 12.5, fontWeight: '700', color: color.ink },
  retake: { fontSize: 11.5, fontWeight: '600', color: color.teal600 },
  closeBtn: { width: 24, height: 24, borderRadius: 999, backgroundColor: '#F1F4F2', alignItems: 'center', justifyContent: 'center' },
  heroRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 8 },
  heroOverline: { fontSize: 10.5, fontWeight: '600', letterSpacing: 0.5, textTransform: 'uppercase', color: color.teal600 },
  heroJpy: { fontSize: 48, lineHeight: 46, fontWeight: '700', color: color.ink, letterSpacing: -1.7 },
  heroForeign: { fontSize: 16, fontWeight: '700', color: color.ink },
  heroLabel: { fontSize: 10.5, fontWeight: '600', color: color.ink4, marginTop: 2 },
  budgetPill: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: color.teal50, borderRadius: 999, paddingVertical: 5, paddingHorizontal: 12, marginBottom: 12 },
  budgetPillLabel: { fontSize: 11, fontWeight: '600', color: color.teal700 },
  budgetPillValue: { fontSize: 13, fontWeight: '700', color: color.teal700 },
  chipRow: { flexDirection: 'row', gap: 6, marginBottom: 12 },
  chip: { flex: 1, borderRadius: 12, paddingVertical: 7, paddingHorizontal: 5, alignItems: 'center' },
  chipSel: { borderWidth: 2, borderColor: color.teal600, backgroundColor: color.teal50 },
  chipUnsel: { borderWidth: 1.5, borderColor: color.line },
  chipJpy: { fontSize: 14, fontWeight: '700', color: color.ink },
  chipF: { fontSize: 9.5, fontWeight: '600', color: color.ink4, marginTop: 3 },
  photoCard: { backgroundColor: color.appBg, borderRadius: 13, padding: 11 },
  photoTitle: { fontSize: 11.5, fontWeight: '700', color: color.ink },
  shootBtn: { flex: 1, height: 38, borderRadius: 11, backgroundColor: color.teal600, alignItems: 'center', justifyContent: 'center' },
  shootText: { fontSize: 12.5, fontWeight: '700', color: '#fff' },
  otherBtn: { height: 38, paddingHorizontal: 12, borderRadius: 11, backgroundColor: '#fff', borderWidth: 1, borderColor: '#E1E6E3', alignItems: 'center', justifyContent: 'center' },
  otherText: { fontSize: 11.5, fontWeight: '600', color: color.ink2 },
  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: color.surface, borderTopWidth: 1, borderTopColor: color.line2, paddingHorizontal: 15, paddingTop: 9 },
  toggle: { flexDirection: 'row', backgroundColor: '#EFF2F0', borderRadius: 11, padding: 3, marginBottom: 9 },
  toggleItem: { flex: 1, height: 32, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  toggleCandidate: { backgroundColor: color.amber50 },
  togglePurchased: { backgroundColor: color.teal50 },
  toggleText: { fontSize: 12.5, fontWeight: '600', color: color.ink3 },
  saveBtn: { height: 52, borderRadius: 15, backgroundColor: color.teal600, alignItems: 'center', justifyContent: 'center', marginBottom: 7 },
  saveText: { fontSize: 16, fontWeight: '600', color: '#fff' },
  skip: { height: 22, alignItems: 'center', justifyContent: 'center' },
  skipText: { fontSize: 13, fontWeight: '600', color: color.ink3 },
});
