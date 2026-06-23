/**
 * v2 OCR結果（成功）・ index.tsx 内で1画面完結
 * folder: ocr-result-v2/  ・ route: app/(tabs)/index.tsx（ocrResult != null && prices.length > 0）
 *
 * 円換算を主役にした保存確認。既存の domain/ui 部品を最大限流用する。
 * - PriceResultCard（円換算ヒーロー）・SaveLimitBanner・PrimaryButton を使う。
 * - 保存は既存 handleSaveCandidate（currency=base_currency / rate=manual_rate 固定）を呼ぶだけ。
 */
import React from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
// import { PriceResultCard, SaveLimitBanner } from '@/components/domain';
// import { PrimaryButton, SectionCard } from '@/components/ui';

const color = {
  primary: '#0E9488', primaryDark: '#0A766E', primarySoft: '#E7F5F2',
  candidateText: '#9A6516', candidateSoft: '#FBF1DE', candidateBorder: '#F0E6CF',
  text: '#16211F', body: '#5B6764', muted: '#7E8986',
  bgScreen: '#F4F6F5', card: '#FFFFFF', line: '#ECEFED', line2: '#EEF1F0',
};

export function OcrResultBody() {
  return (
    <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
      {/* OCR結果カード（価格候補・メモ候補・全文）— 既存 index.tsx の ocrCard 相当 */}
      <View style={styles.card}>
        <View style={styles.cardHead}>
          <Text style={styles.overline}>読み取り結果</Text>
          <Pressable hitSlop={8}><Text style={styles.close}>✕</Text></Pressable>
        </View>
        <Text style={styles.sectionLabel}>価格候補</Text>
        <View style={styles.chipRow}>
          <Pressable style={[styles.priceChip, styles.priceChipSelected]}><Text style={styles.priceChipText}>✓ $24.90</Text></Pressable>
          <Pressable style={styles.priceChip}><Text style={styles.priceChipText}>$3.50</Text></Pressable>
          <Pressable style={styles.priceChip}><Text style={styles.priceChipText}>$12.00</Text></Pressable>
        </View>
      </View>

      {/* 入力カード（保存確認） */}
      <View style={styles.card}>
        {/* 入力モード切替（USD→JPY / JPY→USD） */}
        <View style={styles.modeRow}>
          <View style={[styles.modeBtn, styles.modeBtnActive]}><Text style={styles.modeTextActive}>USD → JPY</Text></View>
          <View style={styles.modeBtn}><Text style={styles.modeText}>JPY → USD</Text></View>
        </View>

        {/* 金額入力（外貨） */}
        <View style={styles.amountRow}>
          <Text style={styles.symbol}>$</Text>
          <Text style={styles.amountField}>24.90</Text>
        </View>

        {/* 円換算ヒーロー → 既存 <PriceResultCard jpyAmount foreignAmount currency rate /> に置換 */}
        <View>
          <Text style={styles.heroLabel}>日本円で</Text>
          <Text style={styles.heroValue}>¥3,934</Text>
          <Text style={styles.heroSub}>$24.90　・　1 USD = ¥158.00</Text>
        </View>

        <View style={styles.divider} />

        {/* メモ */}
        <View style={styles.memoRow}>
          <Text style={styles.memoLabel}>メモ</Text>
          <Text style={styles.memoInput}>MACADAMIA CHOCOLATE</Text>
        </View>

        {/* 保存写真行 */}
        <View style={styles.photoRow}>
          <View style={styles.photoThumb} />
          <Text style={styles.photoLabel}>保存する写真</Text>
          <Pressable hitSlop={8}><Text style={styles.photoAction}>変更</Text></Pressable>
          <Pressable hitSlop={8}><Text style={styles.photoActionMuted}>削除</Text></Pressable>
        </View>

        {/* 保存先（候補 / 購入済み） */}
        <View style={styles.targetRow}>
          <Text style={styles.targetLabel}>保存先</Text>
          <View style={[styles.targetPill, styles.targetPillCandidate]}><Text style={styles.targetPillTextCandidate}>候補</Text></View>
          <View style={styles.targetPill}><Text style={styles.targetPillText}>購入済み</Text></View>
        </View>

        {/* 保存CTA → 既存 <PrimaryButton title="¥3,934 を候補に保存" onPress={handleSaveCandidate} /> */}
        <Pressable style={styles.cta}><Text style={styles.ctaText}>¥3,934 を候補に保存</Text></Pressable>
        <Pressable hitSlop={6} style={styles.nextRow}><Text style={styles.nextText}>保存しないで次を撮る →</Text></Pressable>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: 15, paddingBottom: 24, gap: 12 },
  card: { backgroundColor: color.card, borderWidth: 1, borderColor: color.line, borderRadius: 16, padding: 15, gap: 12, shadowColor: '#10211F', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 2, elevation: 1 },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  overline: { fontSize: 11, fontWeight: '700', color: color.muted, letterSpacing: 0.6 },
  close: { fontSize: 16, color: color.muted },
  sectionLabel: { fontSize: 11, fontWeight: '700', color: color.muted, letterSpacing: 0.5 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  priceChip: { backgroundColor: color.primary, borderRadius: 999, paddingVertical: 10, paddingHorizontal: 18 },
  priceChipSelected: { backgroundColor: color.primaryDark },
  priceChipText: { color: '#fff', fontSize: 18, fontWeight: '700', letterSpacing: -0.3, fontVariant: ['tabular-nums'] },

  modeRow: { flexDirection: 'row', borderWidth: 1, borderColor: color.line, borderRadius: 8, overflow: 'hidden' },
  modeBtn: { flex: 1, paddingVertical: 6, alignItems: 'center' },
  modeBtnActive: { backgroundColor: color.primary },
  modeText: { fontSize: 13, fontWeight: '600', color: color.body },
  modeTextActive: { fontSize: 13, fontWeight: '600', color: '#fff' },

  amountRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  symbol: { fontSize: 28, fontWeight: '700', color: color.text },
  amountField: { flex: 1, fontSize: 36, fontWeight: '800', color: color.text, letterSpacing: -0.5, fontVariant: ['tabular-nums'] },

  heroLabel: { fontSize: 10, fontWeight: '700', color: color.muted, letterSpacing: 0.6, textTransform: 'uppercase' },
  heroValue: { fontSize: 48, fontWeight: '700', color: color.text, letterSpacing: -1.6, fontVariant: ['tabular-nums'] },
  heroSub: { fontSize: 13, fontWeight: '500', color: color.muted, marginTop: 3, fontVariant: ['tabular-nums'] },

  divider: { height: 1, backgroundColor: color.line2 },
  memoRow: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: color.bgScreen, borderRadius: 8, paddingHorizontal: 12 },
  memoLabel: { fontSize: 12, fontWeight: '700', color: color.muted, letterSpacing: 0.4, minWidth: 28 },
  memoInput: { flex: 1, fontSize: 14, fontWeight: '500', color: color.text, paddingVertical: 10 },

  photoRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  photoThumb: { width: 40, height: 30, borderRadius: 8, backgroundColor: '#CBD3CE' },
  photoLabel: { flex: 1, fontSize: 11, fontWeight: '500', color: color.muted },
  photoAction: { fontSize: 12, fontWeight: '600', color: color.primary },
  photoActionMuted: { fontSize: 12, fontWeight: '600', color: color.muted },

  targetRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  targetLabel: { fontSize: 11, fontWeight: '500', color: color.muted, letterSpacing: 0.4 },
  targetPill: { paddingVertical: 5, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1, borderColor: color.line, backgroundColor: color.card },
  targetPillCandidate: { borderColor: color.candidateBorder, backgroundColor: color.candidateSoft },
  targetPillText: { fontSize: 13, fontWeight: '600', color: color.body },
  targetPillTextCandidate: { fontSize: 13, fontWeight: '600', color: color.candidateText },

  cta: { height: 52, borderRadius: 15, backgroundColor: color.primary, alignItems: 'center', justifyContent: 'center', shadowColor: color.primary, shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.4, shadowRadius: 18, elevation: 8 },
  ctaText: { fontSize: 17, fontWeight: '700', color: '#fff' },
  nextRow: { alignItems: 'center' },
  nextText: { fontSize: 13, fontWeight: '600', color: color.body },
});
