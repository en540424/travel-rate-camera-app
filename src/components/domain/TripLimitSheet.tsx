import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ActionSheet, GhostButton, PrimaryButton, SecondaryButton } from '@/components/ui';
import { FREE_LIMITS } from '@/config/limits';
import { color } from '@/theme/tokens';

export interface TripLimitSheetProps {
  visible: boolean;
  onClose: () => void;
  onUpgrade: () => void;
  /** 今の記録中の旅行の名前（終了の確認に出す） */
  currentTripName?: string | null;
  /**
   * 今の旅行を終了して進める操作（新しい旅行を始める／この旅行に切り替える）。確認のあとで呼ぶ。
   * 未指定なら「今の旅行を終了」の選択肢を出さない（終了済み旅行の再開など）。
   */
  onEndCurrent?: () => void;
  /** 「今の旅行を終了」の選択肢の文言（例：今の旅行を終了して、新しい旅行を始める） */
  endCurrentLabel?: string;
  /** 終了の確認で押すボタンの文言（例：終了して新しい旅行を始める） */
  confirmEndLabel?: string;
}

/**
 * 無料版の「記録中の旅行は1件まで」シート。SaveLimitSheetと同じトーンで、責めずに選択肢を出す。
 * トリガーは旅行作成（trip-create.tsx）・旅行の切替（trip-list.tsx／settings.tsx）・終了済み旅行の再開（trip-edit.tsx）。
 *
 * 選択肢：今の旅行を終了して進める／Proで複数の旅行を管理／キャンセル。
 * 終了を選んだら、このシートの中で「終了するとFreeでは記録を追加できない・記録はいつでも見られる」を確認してから進める
 * （確認を別のAlertにしないのは、閉じかけのModalの上に出すと無言で失敗することがあるため）。ここはUI部品のみ。
 */
export function TripLimitSheet({
  visible,
  onClose,
  onUpgrade,
  currentTripName,
  onEndCurrent,
  endCurrentLabel = '今の旅行を終了して、新しい旅行を始める',
  confirmEndLabel = '終了して進む',
}: TripLimitSheetProps) {
  const [confirming, setConfirming] = useState(false);

  // どの経路で閉じても、次に開いた時は最初の選択肢から
  function close() {
    setConfirming(false);
    onClose();
  }
  function upgrade() {
    setConfirming(false);
    onUpgrade();
  }
  function endCurrent() {
    setConfirming(false);
    onEndCurrent?.();
  }

  const tripLabel = currentTripName ? `「${currentTripName}」` : '今の旅行';

  if (confirming && onEndCurrent) {
    return (
      <ActionSheet visible={visible} onClose={close}>
        <View style={styles.iconWrap}><ThemedText style={styles.icon}>🗄</ThemedText></View>
        <ThemedText style={styles.title}>{tripLabel}を終了しますか？</ThemedText>
        <ThemedText style={styles.body}>
          旅行を終了すると、Freeプランではこの旅行に新しい記録を追加できなくなります。過去の記録・写真はいつでも閲覧できます。
        </ThemedText>
        <View style={styles.actions}>
          <PrimaryButton title={confirmEndLabel} onPress={endCurrent} />
          <GhostButton title="戻る" onPress={() => setConfirming(false)} />
        </View>
      </ActionSheet>
    );
  }

  return (
    <ActionSheet visible={visible} onClose={close}>
      <View style={styles.iconWrap}><ThemedText style={styles.icon}>🧳</ThemedText></View>
      {/* 「累積1件」ではなく「記録中（非アーカイブ）の旅行が1件」。終了した旅行は件数に関係なく残り、閲覧できる */}
      <ThemedText style={styles.title}>Freeプランでは記録中の旅行は1件までです</ThemedText>
      <ThemedText style={styles.body}>
        {onEndCurrent
          ? `${tripLabel}を終了すると、別の旅行で記録できます。終了した旅行の記録・写真はそのまま残り、いつでも見られます。`
          : '終了した旅行の記録はいつでも見られます。Proなら終了した旅行を再開でき、複数の旅行を同時に管理できます。'}
      </ThemedText>

      <View style={styles.quota}>
        <ThemedText style={styles.quotaLabel}>Freeで記録中にできる旅行</ThemedText>
        <ThemedText style={styles.quotaValue}>{FREE_LIMITS.trips}件まで</ThemedText>
      </View>

      <View style={styles.actions}>
        {onEndCurrent ? (
          <>
            <PrimaryButton title={endCurrentLabel} onPress={() => setConfirming(true)} />
            <SecondaryButton title="★ Proで複数の旅行を管理" onPress={upgrade} />
          </>
        ) : (
          <PrimaryButton title="★ Proで複数の旅行を管理" onPress={upgrade} />
        )}
        <GhostButton title="キャンセル" onPress={close} />
      </View>
    </ActionSheet>
  );
}

const styles = StyleSheet.create({
  iconWrap: { alignSelf: 'center', width: 52, height: 52, borderRadius: 26, backgroundColor: color.candidateSoft, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  icon: { fontSize: 24 },
  title: { fontSize: 17, fontWeight: '700', color: color.text, textAlign: 'center' },
  body: { fontSize: 13, fontWeight: '500', color: color.muted, textAlign: 'center', lineHeight: 20, marginTop: 6 },
  quota: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 16 },
  quotaLabel: { fontSize: 12.5, fontWeight: '600', color: color.body },
  quotaValue: { fontSize: 13, fontWeight: '700', color: color.candidateStrong, fontVariant: ['tabular-nums'] },
  actions: { gap: 8, marginTop: 18 },
});
