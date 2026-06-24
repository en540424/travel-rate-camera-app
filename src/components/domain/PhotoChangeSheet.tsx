import { SymbolView } from 'expo-symbols';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ActionSheet } from '@/components/ui';
import { color, radius } from '@/theme/tokens';

export interface PhotoChangeSheetProps {
  visible: boolean;
  onClose: () => void;
  hasPhoto: boolean;
  onTakePhoto: () => void;
  onPickLibrary: () => void;
  onDelete: () => void;
}

/**
 * 写真変更シート（design 濃いタブ「写真変更シート」）。
 * 商品写真を撮る（主導線）／ライブラリ／削除／キャンセル。
 * 各行は左アイコン＋左寄せ文言の横並び（キャンセルだけ中央寄せ）。
 * ※「OCR写真を使う」はOCR結果フロー専用のため、編集文脈では非表示。
 */
export function PhotoChangeSheet({ visible, onClose, hasPhoto, onTakePhoto, onPickLibrary, onDelete }: PhotoChangeSheetProps) {
  return (
    <ActionSheet visible={visible} onClose={onClose}>
      <ThemedText style={styles.title}>保存写真を変更</ThemedText>
      <ThemedText style={styles.subtitle}>履歴で見返す写真を差し替えます</ThemedText>

      <View style={styles.list}>
        <Pressable
          onPress={() => { onClose(); onTakePhoto(); }}
          style={({ pressed }) => [styles.row, styles.rowPrimary, pressed && styles.pressed]}>
          <SymbolView
            name={{ ios: 'camera', android: 'photo_camera', web: 'photo_camera' }}
            tintColor={color.primaryDark}
            size={20}
          />
          <ThemedText style={[styles.rowText, styles.rowTextPrimary]}>商品写真を撮る</ThemedText>
        </Pressable>
        <Pressable
          onPress={() => { onClose(); onPickLibrary(); }}
          style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
          <SymbolView
            name={{ ios: 'photo', android: 'image', web: 'image' }}
            tintColor={color.text}
            size={20}
          />
          <ThemedText style={styles.rowText}>写真ライブラリから選ぶ</ThemedText>
        </Pressable>
        {hasPhoto && (
          <Pressable
            onPress={() => { onClose(); onDelete(); }}
            style={({ pressed }) => [styles.row, styles.rowDanger, pressed && styles.pressed]}>
            <SymbolView
              name={{ ios: 'trash', android: 'delete', web: 'delete' }}
              tintColor={color.danger}
              size={20}
            />
            <ThemedText style={[styles.rowText, styles.rowTextDanger]}>写真を削除</ThemedText>
          </Pressable>
        )}
        <Pressable
          onPress={onClose}
          style={({ pressed }) => [styles.row, styles.rowCancel, styles.rowCenter, pressed && styles.pressed]}>
          <ThemedText style={styles.rowText}>キャンセル</ThemedText>
        </Pressable>
      </View>
    </ActionSheet>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 17, fontWeight: '700', color: color.text, textAlign: 'center' },
  subtitle: { fontSize: 13, fontWeight: '500', color: color.muted, textAlign: 'center', marginTop: 4, marginBottom: 16 },
  list: { gap: 10 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: radius.card,
    borderWidth: 1.5,
    borderColor: color.line,
    backgroundColor: color.card,
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  rowCenter: { justifyContent: 'center' },
  rowPrimary: { backgroundColor: color.primarySoft, borderColor: color.primaryBorder },
  rowDanger: { backgroundColor: color.dangerSoft, borderColor: color.dangerBorder },
  rowCancel: { borderColor: color.inputBorder, marginTop: 2 },
  rowText: { fontSize: 15, fontWeight: '700', color: color.text },
  rowTextPrimary: { color: color.primaryDark },
  rowTextDanger: { color: color.danger },
  pressed: { opacity: 0.7 },
});
