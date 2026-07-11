import { Image, type ImageContentFit, type ImageStyle } from 'expo-image';
import { useState } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { color } from '@/theme/tokens';
import { resolveImageUri } from '@/utils/resolve-image-uri';

interface ResilientPhotoProps {
  /** DB保存済みの画像URI。null/undefinedの「写真なし」分岐は呼び出し側の既存ロジックに委ねる */
  uri: string;
  // 呼び出し元は幅/高さ/角丸などレイアウト用のスタイルのみ渡す想定（View/Image両方に安全に適用できる範囲）
  style?: StyleProp<ViewStyle & ImageStyle>;
  contentFit?: ImageContentFit;
}

/**
 * 履歴一覧・カレンダー・商品詳細・写真モーダルで共通利用する画像表示。
 * resolveImageUriで現在のアプリコンテナ基準へ再解決してから表示し、
 * それでも読み込めない場合は黒画面/空白ではなく「画像を表示できません」を出す。
 * DB・履歴レコードには一切触れない（表示のみのフォールバック）。
 */
export function ResilientPhoto({ uri, style, contentFit = 'cover' }: ResilientPhotoProps) {
  const resolved = resolveImageUri(uri);
  const [failed, setFailed] = useState(false);

  if (!resolved || failed) {
    return (
      <View style={[styles.fallback, style]}>
        <ThemedText style={styles.fallbackText} numberOfLines={2}>
          画像を表示できません
        </ThemedText>
      </View>
    );
  }

  return (
    <Image
      source={{ uri: resolved }}
      style={style}
      contentFit={contentFit}
      onError={() => setFailed(true)}
    />
  );
}

const styles = StyleSheet.create({
  fallback: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.line2,
  },
  fallbackText: {
    fontSize: 11,
    fontWeight: '600',
    color: color.faint2,
    textAlign: 'center',
    paddingHorizontal: 4,
  },
});
