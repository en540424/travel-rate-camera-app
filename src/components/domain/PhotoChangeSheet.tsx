import { SymbolView } from 'expo-symbols';
import { useRef } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';

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
 *
 * ■ 行アクションを「閉じ切ってから」実行する理由
 * このシートはRNの`Modal`（iOSではUIKitのモーダル）で、`onClose()`は**非同期の**
 * dismissアニメーションを開始するだけ。その最中に`ImagePicker`という別のnativeモーダルを
 * presentすると、iOSは進行中の遷移と競合した要求をエラーも出さず黙って捨てることがある
 * （「ライブラリから選ぶ」を押しても何も起きない事象の原因）。
 * そこで行押下ではアクションを保留し、`onDismiss`（＝閉じ切った合図）で実行する。
 * 固定のsetTimeoutでは端末やアニメーション速度に依存するため使わない。
 */
export function PhotoChangeSheet({ visible, onClose, hasPhoto, onTakePhoto, onPickLibrary, onDelete }: PhotoChangeSheetProps) {
  const pendingActionRef = useRef<(() => void) | null>(null);

  function closeThen(action: () => void) {
    if (Platform.OS === 'ios') {
      pendingActionRef.current = action;
      onClose();
      return;
    }
    // `onDismiss`はiOS専用。iOS以外はこの競合自体が起きないため、そのまま実行する。
    onClose();
    action();
  }

  function handleDismiss() {
    // キャンセル・背面タップで閉じた場合はnullのまま（何も実行されない）
    const action = pendingActionRef.current;
    pendingActionRef.current = null;
    action?.();
  }

  return (
    <ActionSheet visible={visible} onClose={onClose} onDismiss={handleDismiss}>
      <ThemedText style={styles.title}>保存写真を変更</ThemedText>
      <ThemedText style={styles.subtitle}>履歴で見返す写真を差し替えます</ThemedText>

      <View style={styles.list}>
        <Pressable
          onPress={() => closeThen(onTakePhoto)}
          style={({ pressed }) => [styles.row, styles.rowPrimary, pressed && styles.pressed]}>
          <SymbolView
            name={{ ios: 'camera', android: 'photo_camera', web: 'photo_camera' }}
            tintColor={color.primaryDark}
            size={20}
          />
          <ThemedText style={[styles.rowText, styles.rowTextPrimary]}>商品写真を撮る</ThemedText>
        </Pressable>
        <Pressable
          onPress={() => closeThen(onPickLibrary)}
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
            onPress={() => closeThen(onDelete)}
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
