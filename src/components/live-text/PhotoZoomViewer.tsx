// 写真翻訳の写真を全画面で拡大して見るビューア。
//
// - iOSのScrollViewのズーム（ピンチで拡大・縮小、拡大中はドラッグで移動）を使い、新しいnative依存を足さない
//   （保存写真の`PhotoModal`・撮影結果の拡大表示と同じ仕組み）
// - ダブルタップで拡大／元の大きさ、拡大中は「元の大きさ」ボタンでも戻せる
// - 閉じる・元の大きさのボタンはSafe Areaの内側に置く
// - 写真は表示するだけ（一時ファイルの削除・翻訳結果は呼び出し側のまま。閉じても翻訳結果は消えない）
import { Image } from 'expo-image';
import { SymbolView } from 'expo-symbols';
import { useRef, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
  type GestureResponderEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';

/** ピンチで拡大できる最大倍率（メニューの小さな文字を読める程度） */
const MAX_ZOOM = 5;
/** ダブルタップで拡大する倍率 */
const DOUBLE_TAP_ZOOM = 2.5;
/** 2回のタップをダブルタップとみなす間隔(ms) */
const DOUBLE_TAP_MS = 280;

export type PhotoZoomViewerProps = {
  /** 表示する写真。nullなら閉じている */
  uri: string | null;
  onClose: () => void;
};

export function PhotoZoomViewer({ uri, onClose }: PhotoZoomViewerProps) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const scrollRef = useRef<ScrollView>(null);
  const lastTapRef = useRef(0);
  const [zoomed, setZoomed] = useState(false);

  if (uri == null) return null;

  function resetZoom() {
    scrollRef.current?.scrollResponderZoomTo({ x: 0, y: 0, width, height, animated: true });
  }

  function handleTap(event: GestureResponderEvent) {
    const now = Date.now();
    if (now - lastTapRef.current > DOUBLE_TAP_MS) {
      lastTapRef.current = now;
      return;
    }
    lastTapRef.current = 0;
    if (zoomed) {
      resetZoom();
      return;
    }
    // タップした所を中心に拡大する（等倍の時は写真の座標＝画面の座標）
    const zoomWidth = width / DOUBLE_TAP_ZOOM;
    const zoomHeight = height / DOUBLE_TAP_ZOOM;
    const { locationX, locationY } = event.nativeEvent;
    scrollRef.current?.scrollResponderZoomTo({
      x: Math.min(Math.max(locationX - zoomWidth / 2, 0), width - zoomWidth),
      y: Math.min(Math.max(locationY - zoomHeight / 2, 0), height - zoomHeight),
      width: zoomWidth,
      height: zoomHeight,
      animated: true,
    });
  }

  function handleScroll(event: NativeSyntheticEvent<NativeScrollEvent>) {
    const next = (event.nativeEvent.zoomScale ?? 1) > 1.01;
    if (next !== zoomed) setZoomed(next);
  }

  function handleClose() {
    setZoomed(false);
    onClose();
  }

  return (
    <Modal visible animationType="fade" transparent onRequestClose={handleClose} supportedOrientations={['portrait']}>
      <View style={styles.bg}>
        <ScrollView
          // 写真が替わったら倍率・位置を引き継がない
          key={uri}
          ref={scrollRef}
          style={StyleSheet.absoluteFill}
          contentContainerStyle={{ width, height }}
          minimumZoomScale={1}
          maximumZoomScale={MAX_ZOOM}
          centerContent
          bouncesZoom
          scrollEventThrottle={32}
          onScroll={handleScroll}
          showsHorizontalScrollIndicator={false}
          showsVerticalScrollIndicator={false}>
          <Pressable onPress={handleTap} accessible={false}>
            <Image source={{ uri }} style={{ width, height }} contentFit="contain" />
          </Pressable>
        </ScrollView>

        <View style={[styles.topBar, { top: insets.top + 8 }]} pointerEvents="box-none">
          {zoomed ? (
            <Pressable
              style={({ pressed }) => [styles.pillBtn, pressed && styles.pressed]}
              onPress={resetZoom}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="元の大きさに戻す">
              <SymbolView
                name={{ ios: 'arrow.down.right.and.arrow.up.left', android: 'zoom_out_map', web: 'zoom_out_map' }}
                tintColor="#fff"
                size={14}
              />
              <ThemedText style={styles.pillBtnText}>元の大きさ</ThemedText>
            </Pressable>
          ) : (
            <View />
          )}
          <Pressable
            style={({ pressed }) => [styles.closeBtn, pressed && styles.pressed]}
            onPress={handleClose}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="拡大表示を閉じる">
            <SymbolView name={{ ios: 'xmark', android: 'close', web: 'close' }} tintColor="#fff" size={16} />
          </Pressable>
        </View>

        {!zoomed && (
          <View style={[styles.hint, { bottom: insets.bottom + 16 }]} pointerEvents="none">
            <ThemedText style={styles.hintText}>ピンチ・ダブルタップで拡大できます</ThemedText>
          </View>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  bg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.94)' },
  topBar: {
    position: 'absolute',
    left: 16,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  closeBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 36,
    paddingHorizontal: 14,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  pillBtnText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  pressed: { opacity: 0.75 },
  hint: {
    position: 'absolute',
    alignSelf: 'center',
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  hintText: { color: 'rgba(255,255,255,0.9)', fontSize: 12, fontWeight: '600' },
});
