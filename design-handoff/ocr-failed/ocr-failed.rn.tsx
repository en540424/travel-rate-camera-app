/**
 * OCR結果（失敗）→ 手入力
 * folder: ocr-failed/ ・ ResultSheet の Hero 差し替え版
 * ocr-result.rn.tsx の ResultSheet を流用し、本ファイルの中身ブロックに差し替える想定。
 * 数値は ocr-failed-spec.md、共通は _common/rn-common-notes.md。
 */
import React, { useState } from 'react';
import { View, Text, Pressable, TextInput, StyleSheet, Platform } from 'react-native';

const color = {
  teal600: '#0E9488', ink: '#16211F', ink3: '#7E8986', ink4: '#939E9B',
  amberText: '#B5731A', amberSoft: '#FBF1DE', amberCard: '#FBF6EC', amberBorder: '#F0E6CF',
  lineStrong: '#DCE3E0', placeholder: '#B7BFBC',
};
const ctaGlow = Platform.select({
  ios: { shadowColor: color.teal600, shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.55, shadowRadius: 18 },
  android: { elevation: 6 },
});

/** アンバー警告ブロック */
export function OcrFailedNotice() {
  return (
    <View style={styles.notice}>
      <View style={styles.noticeIcon}><Text style={{ color: color.amberText, fontWeight: '700', fontSize: 20 }}>!</Text></View>
      <Text style={styles.noticeTitle}>金額を読み取れませんでした</Text>
      <Text style={styles.noticeBody}>手入力するか、もう一度撮ってください</Text>
    </View>
  );
}

/** 金額手入力ブロック（product-result と共用） */
export function ManualAmountBlock({ value, onChange, currency = '$ USD' }: { value: string; onChange: (v: string) => void; currency?: string }) {
  const [focused, setFocused] = useState(false);
  return (
    <View>
      <Text style={styles.label}>金額を手入力</Text>
      <View style={[styles.input, { borderColor: focused ? color.teal600 : color.lineStrong, borderWidth: focused ? 1.5 : 1.5 }]}>
        <TextInput
          value={value}
          onChangeText={onChange}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          keyboardType="decimal-pad"
          placeholder="0.00"
          placeholderTextColor={color.placeholder}
          style={styles.inputText}
        />
        <Text style={styles.currency}>{currency}</Text>
      </View>
    </View>
  );
}

/** 2ボタンフッター */
export function RetryOrManualFooter({ onRetry, onSave }: { onRetry?: () => void; onSave?: () => void }) {
  return (
    <View style={styles.footer}>
      <Pressable style={styles.retryBtn} onPress={onRetry}><Text style={styles.retryText}>撮り直す</Text></Pressable>
      <Pressable style={[styles.saveBtn, ctaGlow]} onPress={onSave}><Text style={styles.saveText}>手入力で記録</Text></Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  notice: { backgroundColor: color.amberCard, borderWidth: 1, borderColor: color.amberBorder, borderRadius: 16, padding: 16, alignItems: 'center', marginBottom: 14 },
  noticeIcon: { width: 42, height: 42, borderRadius: 999, backgroundColor: color.amberSoft, alignItems: 'center', justifyContent: 'center', marginBottom: 10 },
  noticeTitle: { fontSize: 14.5, fontWeight: '700', color: color.ink },
  noticeBody: { fontSize: 12, fontWeight: '500', color: color.ink3, marginTop: 4 },
  label: { fontSize: 11, fontWeight: '600', color: color.ink3, marginBottom: 7 },
  input: { height: 58, borderRadius: 15, backgroundColor: '#fff', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, marginBottom: 11 },
  inputText: { fontSize: 28, fontWeight: '700', color: color.ink, letterSpacing: -0.5, fontVariant: ['tabular-nums'], flex: 1 },
  currency: { fontSize: 14, fontWeight: '600', color: color.ink4 },
  footer: { flexDirection: 'row', gap: 9, borderTopWidth: 1, borderTopColor: '#EEF1F0', paddingTop: 11, paddingHorizontal: 15, backgroundColor: '#fff' },
  retryBtn: { width: 110, height: 48, borderRadius: 14, backgroundColor: '#fff', borderWidth: 1.5, borderColor: color.lineStrong, alignItems: 'center', justifyContent: 'center' },
  retryText: { fontSize: 14, fontWeight: '600', color: color.ink },
  saveBtn: { flex: 1, height: 48, borderRadius: 14, backgroundColor: color.teal600, alignItems: 'center', justifyContent: 'center' },
  saveText: { fontSize: 15, fontWeight: '600', color: '#fff' },
});
