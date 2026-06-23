/**
 * v2 OCR結果（失敗）・ index.tsx 内の状態
 * folder: ocr-failed-v2/  ・ route: app/(tabs)/index.tsx（ocrResult != null && prices.length === 0）
 *
 * 「使えない」で終わらせない。手入力を主導線にし、やり直し／商品写真保存／全文メモ化を添える。
 * 全文（raw）は OCR が返したテキスト。メモに転用できる（既存 handleCopyRawToMemo）。
 */
import React from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
// import { PrimaryButton, SecondaryButton, SectionCard } from '@/components/ui';

const color = {
  primary: '#0E9488',
  candidateSoft: '#FBF1DE',
  text: '#16211F', body: '#5B6764', muted: '#7E8986',
  card: '#FFFFFF', line: '#ECEFED', line2: '#EEF1F0', inputBorder: '#DCE3E0',
};

export function OcrFailedBody() {
  return (
    <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
      <View style={styles.card}>
        <View style={styles.cardHead}>
          <Text style={styles.overline}>読み取り結果</Text>
          <Pressable hitSlop={8}><Text style={styles.close}>✕</Text></Pressable>
        </View>

        {/* 失敗の見せ方（責めない・次の一手） */}
        <View style={styles.empty}>
          <View style={styles.iconWrap}><Text style={styles.icon}>🔍</Text></View>
          <Text style={styles.title}>金額を読み取れませんでした</Text>
          <Text style={styles.desc}>明るい場所でもう一度試すか、金額を手で入力できます。読み取った文字はメモに使えます。</Text>
        </View>

        {/* 主導線：手入力（PrimaryButton） */}
        <Pressable style={styles.cta}><Text style={styles.ctaText}>✎ 手入力で金額を入れる</Text></Pressable>

        {/* 副導線：やり直し / 商品写真保存（SecondaryButton 2つ） */}
        <View style={styles.subRow}>
          <Pressable style={styles.subBtn}><Text style={styles.subText}>もう一度読み取る</Text></Pressable>
          <Pressable style={styles.subBtn}><Text style={styles.subText}>商品写真を保存</Text></Pressable>
        </View>

        {/* 全文（メモに使える） */}
        <View style={styles.rawBlock}>
          <Text style={styles.rawToggle}>▼ 読み取った文字（全文）</Text>
          <Text style={styles.rawText} selectable>MACADAMIA CHOCOLATE / HONOLULU / MADE IN HAWAII</Text>
          <Pressable style={styles.copyBtn} hitSlop={6}><Text style={styles.copyText}>全文をメモにコピー</Text></Pressable>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: 15, paddingBottom: 24, gap: 12 },
  card: { backgroundColor: color.card, borderWidth: 1, borderColor: color.line, borderRadius: 16, padding: 16, gap: 14, shadowColor: '#10211F', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 2, elevation: 1 },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  overline: { fontSize: 11, fontWeight: '700', color: color.muted, letterSpacing: 0.6 },
  close: { fontSize: 16, color: color.muted },

  empty: { alignItems: 'center', gap: 8, paddingTop: 6, paddingBottom: 2 },
  iconWrap: { width: 56, height: 56, borderRadius: 18, backgroundColor: color.candidateSoft, alignItems: 'center', justifyContent: 'center' },
  icon: { fontSize: 24 },
  title: { fontSize: 16, fontWeight: '700', color: color.text, textAlign: 'center' },
  desc: { fontSize: 12.5, lineHeight: 19, fontWeight: '500', color: color.muted, textAlign: 'center', maxWidth: 230 },

  cta: { height: 52, borderRadius: 15, backgroundColor: color.primary, alignItems: 'center', justifyContent: 'center', shadowColor: color.primary, shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.4, shadowRadius: 18, elevation: 8 },
  ctaText: { fontSize: 16, fontWeight: '700', color: '#fff' },

  subRow: { flexDirection: 'row', gap: 10 },
  subBtn: { flex: 1, height: 48, borderRadius: 15, backgroundColor: '#fff', borderWidth: 1.5, borderColor: color.inputBorder, alignItems: 'center', justifyContent: 'center' },
  subText: { fontSize: 14, fontWeight: '700', color: color.text },

  rawBlock: { gap: 6, borderTopWidth: 1, borderTopColor: color.line2, paddingTop: 12 },
  rawToggle: { fontSize: 12, fontWeight: '600', color: color.muted },
  rawText: { fontSize: 12, lineHeight: 18, fontWeight: '500', color: color.body },
  copyBtn: { alignSelf: 'flex-start', borderWidth: 1, borderColor: color.primary, borderRadius: 8, paddingVertical: 6, paddingHorizontal: 12 },
  copyText: { fontSize: 12, fontWeight: '600', color: color.primary },
});
