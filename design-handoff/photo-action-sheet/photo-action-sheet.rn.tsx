/**
 * 保存写真の変更シート（ActionSheet）
 * folder: photo-action-sheet/ ・ 結果パネル上のボトムシート
 * ActionSheet / ActionRow は他シート（削除確認・上限・OCR）でも流用する共通部品。
 * 数値は photo-action-sheet-spec.md、共通は _common/rn-common-notes.md。
 */
import React from 'react';
import { View, Text, Pressable, Modal, StyleSheet } from 'react-native';

const color = {
  teal600: '#0E9488', ink: '#16211F', ink2: '#5B6764', ink3: '#7E8986', ink4: '#939E9B',
  surface: '#FFFFFF', line: '#F0F3F1', danger: '#D9614E', dangerBg: '#FBEDEA',
  primaryRowBg: '#F4FBF9', rowIconBg: '#F5F7F6',
};

export function ActionSheet({ visible, onClose, title, subtitle, children, onCancel }: {
  visible: boolean; onClose: () => void; title: string; subtitle?: string; children: React.ReactNode; onCancel?: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.dim} onPress={onClose} />
      <View style={styles.wrap}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.title}>{title}</Text>
            {!!subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
          </View>
          {children}
        </View>
        <Pressable style={styles.cancel} onPress={onCancel ?? onClose}>
          <Text style={styles.cancelText}>キャンセル</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

export function ActionRow({ label, sub, primary, checked, tone, onPress }: {
  label: string; sub?: string; primary?: boolean; checked?: boolean; tone?: 'danger'; onPress?: () => void;
}) {
  const isDanger = tone === 'danger';
  return (
    <Pressable onPress={onPress} style={[styles.row, primary && styles.rowPrimary]}>
      <View style={[styles.icon, primary ? styles.iconPrimary : isDanger ? styles.iconDanger : styles.iconDefault]} />
      <View style={{ flex: 1 }}>
        <Text style={[styles.label, primary && { fontWeight: '700' }, isDanger && { color: color.danger }]}>{label}</Text>
        {!!sub && <Text style={styles.sub}>{sub}</Text>}
      </View>
      {checked && <Text style={{ color: color.teal600, fontWeight: '700' }}>✓</Text>}
    </Pressable>
  );
}

/** 使用例 */
export default function PhotoActionSheetExample() {
  return (
    <ActionSheet visible onClose={() => {}} title="保存する写真" subtitle="値札と商品写真は別でもOK">
      <ActionRow primary label="商品写真を撮る" sub="履歴で見返しやすい写真に" />
      <View style={styles.divider} />
      <ActionRow label="写真ライブラリから選ぶ" />
      <View style={styles.divider} />
      <ActionRow label="OCR写真を使う" checked />
      <View style={styles.divider} />
      <ActionRow label="写真を削除" tone="danger" />
    </ActionSheet>
  );
}

const styles = StyleSheet.create({
  dim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(16,33,31,0.42)' },
  wrap: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: 12 },
  sheet: { backgroundColor: color.surface, borderRadius: 20, overflow: 'hidden' },
  header: { paddingHorizontal: 18, paddingTop: 15, paddingBottom: 12, alignItems: 'center', borderBottomWidth: 1, borderBottomColor: color.line },
  title: { fontSize: 14, fontWeight: '700', color: color.ink },
  subtitle: { fontSize: 11.5, fontWeight: '500', color: color.ink4, marginTop: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, paddingHorizontal: 18 },
  rowPrimary: { backgroundColor: color.primaryRowBg, paddingVertical: 15 },
  icon: { width: 30, height: 30, borderRadius: 8 },
  iconPrimary: { width: 34, height: 34, borderRadius: 9, backgroundColor: color.teal600 },
  iconDefault: { backgroundColor: color.rowIconBg },
  iconDanger: { backgroundColor: color.dangerBg },
  label: { fontSize: 14.5, fontWeight: '600', color: color.ink },
  sub: { fontSize: 11, fontWeight: '500', color: color.ink3, marginTop: 2 },
  divider: { height: 1, backgroundColor: color.line, marginHorizontal: 18 },
  cancel: { backgroundColor: color.surface, borderRadius: 16, height: 50, alignItems: 'center', justifyContent: 'center', marginTop: 9 },
  cancelText: { fontSize: 15, fontWeight: '600', color: color.ink },
});
