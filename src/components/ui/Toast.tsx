import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { color, radius, shadow } from '@/theme/tokens';

export interface ToastProps {
  /** 表示する本文。nullの間は何も描画しない */
  message: string | null;
  /** 本文の下に小さく出す補足（省略可） */
  caption?: string;
  /** 自然に消えたあとに呼ばれる（呼び出し側でmessageをnullに戻す） */
  onHide?: () => void;
  /** 表示し続ける時間(ms)。フェード時間は含まない */
  duration?: number;
  /** 画面ごとに表示位置（top/bottomなど）を指定する */
  style?: StyleProp<ViewStyle>;
}

const FADE_MS = 180;
const DEFAULT_DURATION = 1500;

/** Alertを使わない軽量な保存通知。OKボタンなし・一定時間で自動的に消える。 */
export function Toast({ message, caption, onHide, duration = DEFAULT_DURATION, style }: ToastProps) {
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!message) return;
    opacity.setValue(0);
    Animated.timing(opacity, {
      toValue: 1,
      duration: FADE_MS,
      useNativeDriver: true,
    }).start();

    const hideTimer = setTimeout(() => {
      Animated.timing(opacity, {
        toValue: 0,
        duration: FADE_MS,
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) onHide?.();
      });
    }, duration);

    return () => clearTimeout(hideTimer);
  }, [message, duration, onHide, opacity]);

  if (!message) return null;

  return (
    <View style={[styles.wrap, style]} pointerEvents="none">
      <Animated.View style={[styles.toast, { opacity }]}>
        <ThemedText style={styles.message} numberOfLines={1}>
          {message}
        </ThemedText>
        {caption && (
          <ThemedText style={styles.caption} numberOfLines={1}>
            {caption}
          </ThemedText>
        )}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 50,
  },
  toast: {
    backgroundColor: color.dark,
    borderRadius: radius.chip,
    paddingHorizontal: 18,
    paddingVertical: 12,
    maxWidth: '88%',
    alignItems: 'center',
    ...shadow.card,
  },
  message: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
  caption: {
    color: 'rgba(255,255,255,0.72)',
    fontSize: 11.5,
    fontWeight: '500',
    marginTop: 2,
  },
});
