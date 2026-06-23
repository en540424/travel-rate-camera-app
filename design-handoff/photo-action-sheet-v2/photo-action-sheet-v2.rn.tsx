/**
 * v2 写真アクションシート・ ボトムシート（背面dim）
 * folder: photo-action-sheet-v2/  ・ 親: app/(tabs)/index.tsx（保存写真の取得/変更）
 *
 * 既存 domain/PhotoChangeSheet のビジュアル更新版。ActionSheet（ui）を土台に使う。
 * メイン画面の文脈では「OCR撮影した写真を使う」を含む（OCR写真スワップ＝既存 handleUseOcrPhoto）。
 * ※編集文脈の既存 PhotoChangeSheet は「OCR写真を使う」を意図的に持たない。import経路を勝手に変えない。
 */
import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
// import { ActionSheet } from '@/components/ui';

const color = {
  primaryDark: '#0A766E', primarySoft: '#E7F5F2', primaryBorder: '#D7EDE7',
  danger: '#C2543F', dangerSoft: '#FBF3F1', dangerBorder: '#F0D9D4',
  text: '#16211F', body: '#5B6764', muted: '#7E8986',
  card: '#FFFFFF', line: '#ECEFED', inputBorder: '#DCE3E0',
};

export interface PhotoActionSheetV2Props {
  visible: boolean;
  onClose: () => void;
  hasPhoto: boolean;
  /** OCR撮影済み写真があるとき true（メイン画面文脈のみ） */
  hasOcrPhoto?: boolean;
  onTakePhoto: () => void;
  onPickLibrary: () => void;
  onUseOcrPhoto?: () => void;
  onDelete: () => void;
}

export function PhotoActionSheetV2({
  visible, onClose, hasPhoto, hasOcrPhoto, onTakePhoto, onPickLibrary, onUseOcrPhoto, onDelete,
}: PhotoActionSheetV2Props) {
  // 実装は <ActionSheet visible={visible} onClose={onClose}> でラップする
  return (
    <View style={styles.sheet}>
      <View style={styles.grabber} />
      <Text style={styles.title}>保存する写真</Text>
      <Text style={styles.subtitle}>履歴で見返す写真を設定します</Text>

      <Pressable style={[styles.row, styles.rowPrimary]} onPress={() => { onClose(); onTakePhoto(); }}>
        <Text style={[styles.rowText, styles.rowTextPrimary]}>商品写真を撮る</Text>
      </Pressable>

      <Pressable style={styles.row} onPress={() => { onClose(); onPickLibrary(); }}>
        <Text style={styles.rowText}>写真ライブラリから選ぶ</Text>
      </Pressable>

      {hasOcrPhoto && onUseOcrPhoto && (
        <Pressable style={styles.row} onPress={() => { onClose(); onUseOcrPhoto(); }}>
          <Text style={styles.rowText}>OCR撮影した写真を使う</Text>
        </Pressable>
      )}

      {hasPhoto && (
        <Pressable style={[styles.row, styles.rowDanger]} onPress={() => { onClose(); onDelete(); }}>
          <Text style={[styles.rowText, styles.rowTextDanger]}>写真を削除</Text>
        </Pressable>
      )}

      <Pressable style={[styles.row, styles.rowCancel]} onPress={onClose}>
        <Text style={[styles.rowText, styles.rowTextCancel]}>キャンセル</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: { backgroundColor: color.card, borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingTop: 16, paddingHorizontal: 18, paddingBottom: 28, gap: 10 },
  grabber: { alignSelf: 'center', width: 38, height: 5, borderRadius: 999, backgroundColor: '#E2E7E4', marginBottom: 4 },
  title: { textAlign: 'center', fontSize: 17, fontWeight: '700', color: color.text },
  subtitle: { textAlign: 'center', fontSize: 13, fontWeight: '500', color: color.muted, marginBottom: 6 },
  row: { borderRadius: 16, borderWidth: 1.5, borderColor: color.line, backgroundColor: color.card, paddingVertical: 15, alignItems: 'center' },
  rowPrimary: { backgroundColor: color.primarySoft, borderColor: color.primaryBorder },
  rowDanger: { backgroundColor: color.dangerSoft, borderColor: color.dangerBorder },
  rowCancel: { borderColor: color.inputBorder, marginTop: 2 },
  rowText: { fontSize: 15, fontWeight: '700', color: color.text },
  rowTextPrimary: { color: color.primaryDark },
  rowTextDanger: { color: color.danger },
  rowTextCancel: { color: color.body },
});
