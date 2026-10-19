import { Image, type ImageLoadEventData } from 'expo-image';
import { useState } from 'react';
import { StyleSheet, TouchableOpacity, useWindowDimensions, View } from 'react-native';

import { ResilientPhoto } from '@/components/resilient-photo';
import { color } from '@/theme/tokens';
import { getPhotoBoxSize, photoAspectFromSize, type PhotoSurface } from '@/utils/photo-preview-layout';

interface FitPhotoProps {
  uri: string;
  /** どの画面の写真か。大きさの上限は`utils/photo-preview-layout.ts`の面ごとの表で決まる */
  surface: PhotoSurface;
  /** DB保存済みの写真（商品詳細・履歴編集）。ResilientPhoto経由でURIを再解決し、読めなければ案内を出す */
  saved?: boolean;
  borderRadius: number;
  /** タップで拡大（各画面の既存の拡大Modalを開く） */
  onPress?: () => void;
}

/**
 * 写真を「写真そのものの縦横比の枠」で全体表示する（切り抜かない・大きな余白を出さない）。
 *
 * 縦横比は画像の読み込み完了時（onLoad）に測る。測るまで・測れなかった写真は縦撮り3:4の枠で表示し、
 * 写真自体は常にcontainなので、どの場合も写真全体が見える。写真（uri）が替わったら測り直す。
 * 撮影結果画面・商品詳細（親の幅いっぱいの面）は親の幅を実測して上限にする。
 */
export function FitPhoto({ uri, surface, saved = false, borderRadius, onPress }: FitPhotoProps) {
  const { height: windowHeight } = useWindowDimensions();
  // 測った縦横比は、測った写真のuriと組で持つ（写真が替わったら前の写真の形を使わない）
  const [measured, setMeasured] = useState<{ uri: string; aspect: number } | null>(null);
  const [availableWidth, setAvailableWidth] = useState<number | null>(null);
  const aspect = measured?.uri === uri ? measured.aspect : null;
  const box = getPhotoBoxSize(surface, aspect, windowHeight, availableWidth);
  const fillsParentWidth = surface === 'ocrResult' || surface === 'detail';

  function handleLoad(event: ImageLoadEventData) {
    const next = photoAspectFromSize(event.source?.width, event.source?.height);
    if (next != null) setMeasured({ uri, aspect: next });
  }

  const frameStyle = [styles.frame, { width: box.width, height: box.height, borderRadius }];
  // key={uri}：写真が替わったら読み込み失敗の状態（ResilientPhoto内）も前の写真から引き継がない
  const photo = saved ? (
    <ResilientPhoto key={uri} uri={uri} style={StyleSheet.absoluteFill} contentFit="contain" onLoad={handleLoad} />
  ) : (
    <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="contain" onLoad={handleLoad} />
  );
  // 写真の端の線は写真の上に重ねる（枠にborderを付けると写真の領域が線の分だけ縮み、上下に暗い筋が出るため）
  const content = (
    <>
      {photo}
      <View pointerEvents="none" style={[styles.edge, { borderRadius }]} />
    </>
  );
  const frame = onPress ? (
    <TouchableOpacity style={frameStyle} onPress={onPress} activeOpacity={0.85}>
      {content}
    </TouchableOpacity>
  ) : (
    <View style={frameStyle}>{content}</View>
  );

  if (!fillsParentWidth) return frame;
  return (
    <View style={styles.fillParent} onLayout={(e) => setAvailableWidth(e.nativeEvent.layout.width)}>
      {frame}
    </View>
  );
}

const styles = StyleSheet.create({
  fillParent: {
    alignSelf: 'stretch',
    alignItems: 'center',
  },
  frame: {
    overflow: 'hidden',
    // 枠＝写真の形なので通常は見えない。極端に細長い画像・読み込み中だけ写真の外側として見える
    backgroundColor: color.dark,
  },
  // 白い値札など明るい写真でも、写真の端（＝保存される範囲の端）が白いカード・画面背景と見分けられる線
  edge: {
    ...StyleSheet.absoluteFill,
    borderWidth: 1,
    borderColor: color.faint,
  },
});
