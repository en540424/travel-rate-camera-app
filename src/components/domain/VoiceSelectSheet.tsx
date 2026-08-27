import { SymbolView } from 'expo-symbols';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ActionSheet } from '@/components/ui';
import {
  getPreviewSampleText,
  listVoiceOptionsForLanguage,
  resolveTtsRate,
  resolveVoiceSelection,
  type VoiceLike,
} from '@/config/speech-locales';
import { speakText, stopSpeaking } from '@/lib/speech-synthesis-service';
import { color, radius } from '@/theme/tokens';

export interface VoiceSelectSheetProps {
  visible: boolean;
  onClose: () => void;
  /** 現在のTTS target言語コード（`resolveTtsRate`等と同じ入力） */
  languageCode: string | null;
  /** 表示用の言語名（例:「韓国語」）。呼び出し側の`getLanguageDisplayName`で解決済みの値を渡す */
  languageDisplayName: string;
  voices: readonly VoiceLike[];
  /** 現在保存されているmanual voice identifier。`null`は自動 */
  selectedIdentifier: string | null;
  /** 行tap時に呼ばれる。`null`＝自動へ戻す */
  onSelect: (identifier: string | null) => void;
}

/**
 * 読み上げvoiceの言語別選択シート（`ActionSheet`＋行リスト。新しいmodal paradigmは作らない）。
 *
 * 行tapは即時反映（選択と同時に`onSelect`を呼ぶ）。「完了」は確定操作ではなく単なる close。
 * iOSの設定アプリ的なradio listの挙動に合わせ、選択後に別途保存操作を要求しない。
 *
 * ■ 試聴と本読み上げの独立性
 * `isPreviewing`はこのコンポーネント内だけのstateで、画面側の`isSpeaking`とは無関係。
 * 試聴・本読み上げはどちらも同じ`speakText`/`stopSpeaking`を経由するため、
 * `speakText`が毎回冒頭で行う`stopSpeaking()`により二重再生は自然に防がれる。
 * シートを閉じる時は試聴中の音声を必ず止める（閉じた後も裏で鳴り続けさせない）。
 */
export function VoiceSelectSheet({
  visible,
  onClose,
  languageCode,
  languageDisplayName,
  voices,
  selectedIdentifier,
  onSelect,
}: VoiceSelectSheetProps) {
  const [isPreviewing, setIsPreviewing] = useState(false);

  /**
   * シートを閉じたら試聴中の音声を止める。
   *
   * `isPreviewing`を直接resetする処理はここに書かない。`stopSpeaking()`は
   * 現在再生中のutteranceに対して`onStopped`を発火させ、それは`handlePreviewPress`が
   * 登録した`onFinish: () => setIsPreviewing(false)`を経由して自然に`isPreviewing`を
   * falseへ戻す（`expo-speech`はutterance idごとにcallbackを管理するため、
   * 試聴中でなければこの`stopSpeaking()`は単なる無害なno-opになる）。
   */
  useEffect(() => {
    if (visible) return;
    void stopSpeaking();
  }, [visible]);

  const options = useMemo(
    () => listVoiceOptionsForLanguage(languageCode, voices),
    [languageCode, voices],
  );

  // 保存identifierが端末から消失している場合（iOS設定でvoice削除等）も「自動」を選択中として
  // 表示する。実際の読み上げも`resolveManualVoice`が同じ理由でautoへfallbackするため、
  // 表示と実際の挙動を一致させる（selectedIdentifierがnullでない値のまま残ると、
  // どの行にもチェックが付かない食い違いが起きる）。
  const isAutoSelected =
    selectedIdentifier === null || !options.some((voice) => voice.identifier === selectedIdentifier);

  const previewSelection = useMemo(
    () => resolveVoiceSelection(languageCode, selectedIdentifier, voices),
    [languageCode, selectedIdentifier, voices],
  );

  async function handlePreviewPress() {
    if (isPreviewing) {
      await stopSpeaking();
      setIsPreviewing(false);
      return;
    }
    if (previewSelection == null) return;

    await speakText(
      {
        text: getPreviewSampleText(languageCode),
        language: previewSelection.language,
        voiceIdentifier: previewSelection.voiceIdentifier,
        rate: resolveTtsRate(languageCode),
      },
      {
        onStart: () => setIsPreviewing(true),
        onFinish: () => setIsPreviewing(false),
        onError: () => setIsPreviewing(false),
      },
    );
  }

  return (
    <ActionSheet visible={visible} onClose={onClose}>
      <ThemedText style={styles.title}>読み上げ設定</ThemedText>
      <ThemedText style={styles.subtitle}>現在の言語：{languageDisplayName}</ThemedText>

      <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
        <Pressable
          onPress={() => onSelect(null)}
          style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
          <View style={styles.rowText}>
            <ThemedText style={styles.rowName}>自動</ThemedText>
          </View>
          {isAutoSelected && <ThemedText style={styles.check}>✓</ThemedText>}
        </Pressable>

        {options.length === 0 ? (
          <ThemedText style={styles.emptyNote}>この言語で選択できる音声がありません</ThemedText>
        ) : (
          options.map((voice) => {
            const isSel = selectedIdentifier === voice.identifier;
            return (
              <View key={voice.identifier}>
                <View style={styles.sep} />
                <Pressable
                  onPress={() => onSelect(voice.identifier)}
                  style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
                  <View style={styles.rowText}>
                    <ThemedText style={styles.rowName}>{voice.name}</ThemedText>
                    {voice.quality === 'Enhanced' && (
                      <ThemedText style={styles.rowQuality}>Enhanced</ThemedText>
                    )}
                  </View>
                  {isSel && <ThemedText style={styles.check}>✓</ThemedText>}
                </Pressable>
              </View>
            );
          })
        )}
      </ScrollView>

      <View style={styles.actions}>
        <Pressable
          onPress={() => void handlePreviewPress()}
          disabled={!isPreviewing && previewSelection == null}
          style={({ pressed }) => [styles.previewBtn, pressed && styles.pressed]}>
          <SymbolView
            name={{
              ios: isPreviewing ? 'stop.fill' : 'play.fill',
              android: isPreviewing ? 'stop' : 'play_arrow',
              web: isPreviewing ? 'stop' : 'play_arrow',
            }}
            tintColor={color.primaryDark}
            size={14}
          />
          <ThemedText style={styles.previewBtnText}>{isPreviewing ? '停止' : '試聴'}</ThemedText>
        </Pressable>
        <Pressable
          onPress={onClose}
          style={({ pressed }) => [styles.doneBtn, pressed && styles.pressed]}>
          <ThemedText style={styles.doneBtnText}>完了</ThemedText>
        </Pressable>
      </View>
    </ActionSheet>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 17, fontWeight: '700', color: color.text, textAlign: 'center' },
  subtitle: { fontSize: 13, fontWeight: '500', color: color.muted, textAlign: 'center', marginTop: 4, marginBottom: 14 },
  list: { maxHeight: 340 },
  listContent: {
    backgroundColor: color.card,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: color.line,
    overflow: 'hidden',
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13, paddingHorizontal: 14 },
  pressed: { backgroundColor: color.line3 },
  rowText: { flex: 1, gap: 1 },
  rowName: { fontSize: 15, fontWeight: '700', color: color.text },
  rowQuality: { fontSize: 11.5, fontWeight: '600', color: color.primaryDark },
  check: { fontSize: 18, fontWeight: '800', color: color.primary, marginLeft: 4 },
  sep: { height: StyleSheet.hairlineWidth, backgroundColor: color.line2, marginLeft: 14 },
  emptyNote: { fontSize: 13, fontWeight: '500', color: color.muted, textAlign: 'center', paddingVertical: 16 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 16 },
  previewBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    flex: 1,
    paddingVertical: 12,
    borderRadius: radius.button,
    borderWidth: 1.5,
    borderColor: color.inputBorder,
  },
  previewBtnText: { fontSize: 14, fontWeight: '700', color: color.primaryDark },
  doneBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: radius.button,
    backgroundColor: color.primary,
  },
  doneBtnText: { fontSize: 14, fontWeight: '700', color: '#fff' },
});
