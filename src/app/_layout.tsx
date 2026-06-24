import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { useColorScheme } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { DbProvider } from '@/components/db-provider';

export default function RootLayout() {
  const colorScheme = useColorScheme();
  return (
    // GestureHandlerRootView: 価格OCRカメラのピンチズーム（react-native-gesture-handler）に必要。
    // 他画面では素通しのViewと同等で挙動に影響しない。
    <GestureHandlerRootView style={{ flex: 1 }}>
    {/* DbProvider:
        iOS/Android → db-provider.native.tsx (SQLiteProvider)
        Web        → db-provider.tsx         (透過ラッパー) */}
    <DbProvider>
      <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
        <AnimatedSplashOverlay />
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen
            name="rate-setup"
            options={{
              presentation: 'modal',
              headerShown: true,
              title: 'レート設定',
            }}
          />
          <Stack.Screen name="data-management" options={{ headerShown: true, title: 'データ管理' }} />
          <Stack.Screen name="help" options={{ headerShown: true, title: 'ヘルプ・使い方' }} />
          <Stack.Screen name="app-info" options={{ headerShown: true, title: 'アプリについて' }} />
          <Stack.Screen name="pro" options={{ headerShown: true, title: '旅レートカメラ Pro' }} />
          <Stack.Screen name="purchase-confirm" options={{ headerShown: true, title: '購入の確認' }} />
          <Stack.Screen
            name="item-detail"
            options={{ headerShown: true, title: '商品の詳細', headerBackTitle: '履歴' }}
          />
          <Stack.Screen
            name="item-edit"
            options={{ headerShown: true, title: '編集', headerBackTitle: '商品の詳細' }}
          />
          <Stack.Screen name="trip-create" options={{ headerShown: true, title: '新しい旅行' }} />
          <Stack.Screen name="pro-features" options={{ headerShown: true, title: '無料版とProの違い' }} />
          <Stack.Screen name="trip-list" options={{ headerShown: true, title: '旅行' }} />
          <Stack.Screen name="trip-edit" options={{ headerShown: true, title: '旅行を編集' }} />
          <Stack.Screen name="currency-select" options={{ headerShown: true, title: '通貨を選ぶ' }} />
          <Stack.Screen name="trip-created" options={{ headerShown: false }} />
          <Stack.Screen name="purchase-complete" options={{ headerShown: false }} />
          <Stack.Screen name="purchase-restore" options={{ headerShown: true, title: '購入を復元' }} />
        </Stack>
      </ThemeProvider>
    </DbProvider>
    </GestureHandlerRootView>
  );
}
