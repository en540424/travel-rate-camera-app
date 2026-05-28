import { Tabs } from 'expo-router';
import { useColorScheme } from 'react-native';

import { Colors } from '@/constants/theme';

export default function TabsLayout() {
  const scheme = useColorScheme();
  const colors = Colors[scheme === 'unspecified' || !scheme ? 'light' : scheme];

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: '#208AEF',
        tabBarInactiveTintColor: colors.textSecondary,
        tabBarStyle: {
          backgroundColor: colors.background,
          borderTopColor: colors.backgroundElement,
        },
      }}>
      <Tabs.Screen name="index"     options={{ title: 'カメラ' }} />
      <Tabs.Screen name="converter" options={{ title: '換算' }} />
      <Tabs.Screen name="history"   options={{ title: '履歴' }} />
      <Tabs.Screen name="settings"  options={{ title: '設定' }} />
    </Tabs>
  );
}
