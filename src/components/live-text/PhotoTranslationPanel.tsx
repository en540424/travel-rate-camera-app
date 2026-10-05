// 翻訳ページの「写真翻訳」パネル。写真を撮る／選ぶ → 読み取った文章を段落ごとに翻訳して表示する。
// 読み上げ・コピーは翻訳ページの既存の仕組み（TTS・クリップボード）を呼び出し側から受け取って使う。
import { Image } from 'expo-image';
import { SymbolView } from 'expo-symbols';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ErrorMessage, GhostButton, PrimaryButton, SecondaryButton } from '@/components/ui';
import type { PhotoTranslationState } from '@/hooks/use-photo-translation';
import type { MemoTranslationErrorCode } from '@/lib/translation-types';
import { color, radius, shadow, spacing } from '@/theme/tokens';

const TRANSLATION_ERROR_MESSAGES: Partial<Record<MemoTranslationErrorCode, string>> = {
  unsupported_os: '翻訳はiOS 18以降で利用できます。読み取った原文のみ表示しています。',
  unsupported_language: 'この言語の組み合わせには対応していません。翻訳元・翻訳先を変えてお試しください。',
  host_unavailable: '翻訳を開始できませんでした。もう一度お試しください。',
  translation_failed: '一部を翻訳できませんでした。通信状況を確認してもう一度お試しください。',
};

export type PhotoTranslationPanelProps = {
  state: PhotoTranslationState;
  onTakePhoto: () => void;
  onPickPhoto: () => void;
  onRetry: () => void;
  onClear: () => void;
  onCopy: (text: string) => void;
  onUseAsInput: (text: string) => void;
  /** 読み上げ（翻訳ページ既存のTTS）。voice非対応ならundefined */
  onSpeak?: (text: string) => void;
  isSpeaking: boolean;
  speakFailed: boolean;
};

export function PhotoTranslationPanel({
  state,
  onTakePhoto,
  onPickPhoto,
  onRetry,
  onClear,
  onCopy,
  onUseAsInput,
  onSpeak,
  isSpeaking,
  speakFailed,
}: PhotoTranslationPanelProps) {
  if (state.phase === 'idle') {
    return (
      <View style={styles.introCard}>
        <ThemedText style={styles.introTitle}>写真の文章をまとめて翻訳</ThemedText>
        <ThemedText style={styles.introBody}>
          メニュー・商品説明・注意書き・看板など、長い文章も段落ごとに読み取って翻訳します。写真は保存されません。
        </ThemedText>
        <PrimaryButton
          title="写真を撮る"
          onPress={onTakePhoto}
          icon={<SymbolView name={{ ios: 'camera.fill', android: 'photo_camera', web: 'photo_camera' }} tintColor="#fff" size={17} />}
        />
        <SecondaryButton
          title="写真を選ぶ"
          onPress={onPickPhoto}
          icon={<SymbolView name={{ ios: 'photo.on.rectangle', android: 'image', web: 'image' }} tintColor={color.text} size={17} />}
        />
      </View>
    );
  }

  const uri = state.uri;
  const blocks = state.phase === 'translating' || state.phase === 'done' ? state.blocks : [];
  const translatedText = blocks
    .map((block) => block.translated ?? block.original)
    .join('\n');
  const originalText = blocks.map((block) => block.original).join('\n');
  const hasTranslation = blocks.some((block) => block.translated != null);

  return (
    <View style={styles.wrap}>
      {uri != null && (
        <View style={styles.photoCard}>
          <Image source={{ uri }} style={styles.photo} contentFit="contain" />
        </View>
      )}

      <View style={styles.photoActions}>
        <Pressable style={({ pressed }) => [styles.smallBtn, pressed && styles.pressed]} onPress={onTakePhoto}>
          <SymbolView name={{ ios: 'camera', android: 'photo_camera', web: 'photo_camera' }} tintColor={color.primaryDark} size={15} />
          <ThemedText style={styles.smallBtnText}>撮り直す</ThemedText>
        </Pressable>
        <Pressable style={({ pressed }) => [styles.smallBtn, pressed && styles.pressed]} onPress={onPickPhoto}>
          <SymbolView name={{ ios: 'photo.on.rectangle', android: 'image', web: 'image' }} tintColor={color.primaryDark} size={15} />
          <ThemedText style={styles.smallBtnText}>写真を選ぶ</ThemedText>
        </Pressable>
        <GhostButton title="クリア" onPress={onClear} />
      </View>

      {state.phase === 'recognizing' && (
        <View style={styles.progress}>
          <ActivityIndicator color={color.primaryDark} />
          <ThemedText style={styles.progressText}>文字を読み取っています…</ThemedText>
        </View>
      )}

      {state.phase === 'no_text' && (
        <ErrorMessage message="文字が見つかりませんでした。明るい場所で、文字が大きくはっきり写るように撮影してください。" />
      )}

      {state.phase === 'error' && (
        <ErrorMessage
          message={
            state.reason === 'ocr_unavailable'
              ? 'この端末では写真の文字を読み取れません。'
              : '文字を読み取れませんでした。もう一度お試しください。'
          }
        />
      )}

      {(state.phase === 'translating' || state.phase === 'done') && (
        <View style={styles.resultCard}>
          <View style={styles.resultHeader}>
            <ThemedText style={styles.resultLabel}>写真の翻訳</ThemedText>
            <ThemedText style={styles.resultCount}>{blocks.length}件</ThemedText>
          </View>

          {state.phase === 'translating' && (
            <View style={styles.progressInline}>
              <ActivityIndicator size="small" color={color.primaryDark} />
              <ThemedText style={styles.progressText}>
                翻訳しています…（初回は言語データの準備に時間がかかる場合があります）
              </ThemedText>
            </View>
          )}

          {blocks.map((block, index) => (
            <View key={`${index}:${block.original}`} style={[styles.block, index > 0 && styles.blockDivider]}>
              {block.translated != null ? (
                <ThemedText style={styles.blockTranslated} selectable>
                  {block.translated}
                </ThemedText>
              ) : block.sourceLanguage == null ? null : (
                <ThemedText style={styles.blockPending}>{state.phase === 'done' ? '翻訳できませんでした' : '…'}</ThemedText>
              )}
              <ThemedText style={block.translated != null ? styles.blockOriginal : styles.blockOriginalOnly} selectable>
                {block.original}
              </ThemedText>
            </View>
          ))}

          {state.phase === 'done' && state.errorCode != null && (
            <View style={styles.errorWrap}>
              <ErrorMessage message={TRANSLATION_ERROR_MESSAGES[state.errorCode] ?? '翻訳できませんでした。'} />
              {(state.errorCode === 'host_unavailable' || state.errorCode === 'translation_failed') && (
                <GhostButton title="もう一度翻訳する" tone="primary" onPress={onRetry} />
              )}
            </View>
          )}

          {state.phase === 'done' && (
            <View style={styles.resultActions}>
              {onSpeak != null && hasTranslation && (
                <Pressable
                  style={({ pressed }) => [styles.actionBtn, isSpeaking && styles.actionBtnActive, pressed && styles.pressed]}
                  onPress={() => onSpeak(translatedText)}
                  accessibilityRole="button"
                  accessibilityLabel={isSpeaking ? '読み上げを停止' : '訳文を読み上げる'}>
                  <SymbolView
                    name={{ ios: isSpeaking ? 'stop.fill' : 'speaker.wave.2.fill', android: 'volume_up', web: 'volume_up' }}
                    tintColor={isSpeaking ? '#fff' : color.primaryDark}
                    size={15}
                  />
                  <ThemedText style={[styles.actionBtnText, isSpeaking && styles.actionBtnTextActive]}>
                    {isSpeaking ? '停止' : '読み上げ'}
                  </ThemedText>
                </Pressable>
              )}
              <Pressable
                style={({ pressed }) => [styles.actionBtn, pressed && styles.pressed]}
                onPress={() => onCopy(translatedText)}
                accessibilityRole="button">
                <SymbolView name={{ ios: 'doc.on.doc', android: 'content_copy', web: 'content_copy' }} tintColor={color.primaryDark} size={15} />
                <ThemedText style={styles.actionBtnText}>コピー</ThemedText>
              </Pressable>
              <Pressable
                style={({ pressed }) => [styles.actionBtn, pressed && styles.pressed]}
                onPress={() => onUseAsInput(originalText)}
                accessibilityRole="button"
                accessibilityLabel="読み取った原文をテキスト入力へ移して編集する">
                <SymbolView name={{ ios: 'square.and.pencil', android: 'edit', web: 'edit' }} tintColor={color.primaryDark} size={15} />
                <ThemedText style={styles.actionBtnText}>原文を編集</ThemedText>
              </Pressable>
            </View>
          )}
          {speakFailed && <ThemedText style={styles.note}>読み上げできませんでした</ThemedText>}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 12 },
  introCard: {
    borderRadius: radius.cardLg,
    backgroundColor: color.card,
    borderWidth: 1,
    borderColor: color.line,
    padding: 16,
    gap: 12,
    ...shadow.card,
  },
  introTitle: { fontSize: 16, fontWeight: '700', color: color.text },
  introBody: { fontSize: 13, lineHeight: 20, fontWeight: '500', color: color.muted },

  photoCard: {
    borderRadius: radius.card,
    overflow: 'hidden',
    backgroundColor: color.dark,
  },
  photo: { width: '100%', height: 220 },
  photoActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  smallBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: color.primaryBorder,
    backgroundColor: color.primarySoft,
  },
  smallBtnText: { fontSize: 13, fontWeight: '700', color: color.primaryDark },

  progress: { alignItems: 'center', gap: 8, paddingVertical: 18 },
  progressInline: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  progressText: { fontSize: 12.5, fontWeight: '500', color: color.muted, flexShrink: 1 },

  resultCard: {
    borderRadius: radius.cardLg,
    backgroundColor: color.primarySoft,
    borderWidth: 1,
    borderColor: color.primaryBorder,
    padding: 16,
    gap: 6,
    ...shadow.card,
  },
  resultHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 },
  resultLabel: { fontSize: 13, fontWeight: '700', color: color.primaryDark },
  resultCount: { fontSize: 11.5, fontWeight: '600', color: color.primaryDark, opacity: 0.7 },
  block: { paddingVertical: 8, gap: 3 },
  blockDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.primaryBorder },
  blockTranslated: { fontSize: 16, lineHeight: 24, fontWeight: '600', color: color.text },
  blockPending: { fontSize: 13, fontWeight: '500', color: color.muted },
  blockOriginal: { fontSize: 12.5, lineHeight: 18, fontWeight: '500', color: color.muted },
  blockOriginalOnly: { fontSize: 15, lineHeight: 22, fontWeight: '500', color: color.text },
  errorWrap: { gap: 4 },
  resultActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap', marginTop: 4 },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: radius.button,
    backgroundColor: color.card,
    borderWidth: 1,
    borderColor: color.primaryBorder,
  },
  actionBtnActive: { backgroundColor: color.primary, borderColor: color.primary },
  actionBtnText: { fontSize: 13.5, fontWeight: '700', color: color.primaryDark },
  actionBtnTextActive: { color: '#fff' },
  note: { fontSize: 12, fontWeight: '500', color: color.muted },
  pressed: { opacity: 0.85 },
});
