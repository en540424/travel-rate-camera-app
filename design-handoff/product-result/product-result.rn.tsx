/**
 * 結果パネル（商品写真から）・ entryType='product'
 * folder: product-result/ ・ ResultSheet の Hero 差し替え版
 * ocr-result.rn.tsx の ResultSheet / ResultFooter を流用。本ファイルは Hero 位置のブロック。
 * 数値は product-result-spec.md、共通は _common/rn-common-notes.md。
 */
import React, { useState } from 'react';
import { View, Text, Pressable, TextInput, StyleSheet } from 'react-native';
import { ManualAmountBlock } from '../ocr-failed/ocr-failed.rn'; // 共用（パスは実装に合わせ調整）

const color = {
  teal600: '#0E9488', teal700: '#0A766E', teal50: '#E7F5F2', teal50b: '#CDEAE5',
  ink: '#16211F', ink3: '#7E8986', ink4: '#939E9B', lineStrong: '#DCE3E0',
};
const num = { fontVariant: ['tabular-nums'] as const };

/** Hero位置：商品写真＋手入力＋換算＋OCR追加 */
export function ProductPhotoBlock({ jpy = 3792 }: { jpy?: number }) {
  const [amount, setAmount] = useState('24.00');
  return (
    <View>
      {/* 写真行 */}
      <View style={styles.photoRow}>
        <View style={styles.photoThumb} />
        <View style={{ flex: 1 }}>
          <Text style={styles.photoTitle}>商品写真を保存</Text>
          <Text style={styles.photoSub}>この写真を履歴に残します</Text>
        </View>
        <Pressable><Text style={styles.change}>変更</Text></Pressable>
      </View>

      {/* 金額手入力（ocr-failed と共用） */}
      <ManualAmountBlock value={amount} onChange={setAmount} />

      {/* 換算カード */}
      <View style={styles.convRow}>
        <Text style={styles.convLabel}>日本円で 約</Text>
        <Text style={[styles.convValue, num]}>¥{jpy.toLocaleString()}</Text>
      </View>

      {/* OCR追加（点線） */}
      <Pressable style={styles.addOcr}>
        <Text style={styles.addOcrText}>価格OCRで金額を読み取る</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  photoRow: { flexDirection: 'row', alignItems: 'center', gap: 11, marginBottom: 13 },
  photoThumb: { width: 60, height: 60, borderRadius: 13, backgroundColor: '#C4CCC6' },
  photoTitle: { fontSize: 13.5, fontWeight: '700', color: color.ink },
  photoSub: { fontSize: 11.5, fontWeight: '500', color: color.ink4, marginTop: 2 },
  change: { fontSize: 11.5, fontWeight: '600', color: color.teal600 },
  convRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: color.teal50, borderRadius: 12, paddingVertical: 9, paddingHorizontal: 13, marginBottom: 12 },
  convLabel: { fontSize: 12, fontWeight: '600', color: color.teal700 },
  convValue: { fontSize: 22, fontWeight: '700', color: color.teal700, letterSpacing: -0.5 },
  addOcr: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10, paddingHorizontal: 12, borderWidth: 1, borderStyle: 'dashed', borderColor: color.teal50b, borderRadius: 12 },
  addOcrText: { fontSize: 12.5, fontWeight: '600', color: color.teal700 },
});
