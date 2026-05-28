import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { useColorScheme } from 'react-native';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { DbProvider } from '@/components/db-provider';

export default function RootLayout() {
  const colorScheme = useColorScheme();
  return (
    // DbProvider:
    //   iOS/Android → db-provider.native.tsx (SQLiteProvider)
    //   Web        → db-provider.tsx         (透過ラッパー)
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
        </Stack>
      </ThemeProvider>
    </DbProvider>
  );
}
