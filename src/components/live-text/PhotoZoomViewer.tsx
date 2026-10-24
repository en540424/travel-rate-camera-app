// 写真翻訳の写真を全画面で拡大して見るビューア。
//
// - iOSのScrollViewのズーム（ピンチで拡大・縮小、拡大中はドラッグで移動）を使い、新しいnative依存を足さない
//   （保存写真の`PhotoModal`・撮影結果の拡大表示と同じ仕組み）
// - ダブルタップで拡大／元の大きさ、拡大中は「元の大きさ」ボタンでも戻せる
// - 閉じる・元の大きさのボタンはSafe Areaの内側に置く
// - 写真は表示するだけ（一時ファイルの削除・翻訳結果は呼び出し側のまま。閉じても翻訳結果は消えない）
//
// ■ 置き場所（2026-10-24 TestFlight 1.0.0 (4) の不具合対応）
//   以前は写真翻訳パネルの中（＝翻訳画面のScrollViewの中）で、開く時だけModalをマウントしていた。
//   実機で「タップしても開かない」不具合が出たため、実機で動いている拡大表示（メインカメラの
//   撮影結果・商品詳細・カレンダー）と同じ形にそろえた：**画面のいちばん外側（ScrollViewの外）に置き、
//   写真がある間はマウントしたまま`visible`で開閉する**。呼び出し側は`translation.tsx`。
//
// ■ ダブルタップ
//   写真を`Pressable`で包むと、ズームするScrollViewのピンチ・ドラッグとタッチを取り合うおそれがあるため、
//   ScrollViewのタッチの開始・終了だけを見て判定する（写真を包まない）。ダブルタップが効かない端末でも、
//   開く・閉じる・ピンチ・ドラッグ・「元の大きさ」は動く。
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
import { isDoubleTap, isPhotoTap, zoomRectAround, type PhotoTap } from '@/lib/photo-zoom-core';

/** ピンチで拡大できる最大倍率（メニューの小さな文字を読める程度） */
const MAX_ZOOM = 5;
/** ダブルタップで拡大する倍率 */
const DOUBLE_TAP_ZOOM = 2.5;

export type PhotoZoomViewerProps = {
  /** 表示する写真 */
  uri: string;
  /** 開いているか（開閉はModalの`visible`で行い、ビューア自体は写真がある間マウントしたまま） */
  visible: boolean;
  onClose: () => void;
};

type TouchStart = { x: number; y: number; time: number; maxTouches: number };

export function PhotoZoomViewer({ uri, visible, onClose }: PhotoZoomViewerProps) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const scrollRef = useRef<ScrollView>(null);
  const touchStartRef = useRef<TouchStart | null>(null);
  const lastTapRef = useRef<PhotoTap | null>(null);
  const [zoomed, setZoomed] = useState(false);

  function resetZoom() {
    scrollRef.current?.scrollResponderZoomTo({ x: 0, y: 0, width, height, animated: true });
  }

  function handleTouchStart(event: GestureResponderEvent) {
    const { pageX, pageY, touches } = event.nativeEvent;
    const current = touchStartRef.current;
    // 2本目の指が触れた（ピンチ）時は、1本目の開始位置を残したまま指の本数だけ増やす
    if (current != null && touches.length > 1) {
      current.maxTouches = Math.max(current.maxTouches, touches.length);
      return;
    }
    touchStartRef.current = { x: pageX, y: pageY, time: Date.now(), maxTouches: Math.max(1, touches.length) };
  }

  function handleTouchEnd(event: GestureResponderEvent) {
    const { pageX, pageY, touches } = event.nativeEvent;
    const start = touchStartRef.current;
    // まだ指が残っている（ピンチの途中で1本離した）間は判定しない
    if (start == null || touches.length > 0) return;
    touchStartRef.current = null;
    const tap = { x: pageX, y: pageY, time: Date.now() };
    if (!isPhotoTap(start, tap)) {
      lastTapRef.current = null;
      return;
    }
    if (!isDoubleTap(lastTapRef.current, tap)) {
      lastTapRef.current = tap;
      return;
    }
    lastTapRef.current = null;
    if (zoomed) {
      resetZoom();
      return;
    }
    // 等倍の時は写真の座標＝画面の座標（全画面・等倍で表示しているため）
    scrollRef.current?.scrollResponderZoomTo({
      ...zoomRectAround(tap.x, tap.y, width, height, DOUBLE_TAP_ZOOM),
      animated: true,
    });
  }

  function handleTouchCancel() {
    touchStartRef.current = null;
  }

  function handleScroll(event: NativeSyntheticEvent<NativeScrollEvent>) {
    const next = (event.nativeEvent.zoomScale ?? 1) > 1.01;
    if (next !== zoomed) setZoomed(next);
  }

  function handleClose() {
    setZoomed(false);
    touchStartRef.current = null;
    lastTapRef.current = null;
    onClose();
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleClose}>
      <View style={styles.bg}>
        <ScrollView
          // 開くたび・写真が替わるたびに倍率と位置を等倍へ戻す（メインカメラの拡大表示と同じ方法）
          key={visible ? `open:${uri}` : 'closed'}
          ref={scrollRef}
          style={{ width, height }}
          contentContainerStyle={[styles.scrollContent, { width, height }]}
          minimumZoomScale={1}
          maximumZoomScale={MAX_ZOOM}
          centerContent
          bouncesZoom
          scrollEventThrottle={32}
          onScroll={handleScroll}
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
          onTouchCancel={handleTouchCancel}
          showsHorizontalScrollIndicator={false}
          showsVerticalScrollIndicator={false}>
          <Image source={{ uri }} style={{ width, height }} contentFit="contain" />
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
  scrollContent: { justifyContent: 'center', alignItems: 'center' },
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
