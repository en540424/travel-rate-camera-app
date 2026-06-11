import { Tabs } from 'expo-router';
import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { StyleSheet, type ColorValue } from 'react-native';

import { DT } from '@/constants/designTokens';

type IconName = NonNullable<SymbolViewProps['name']>;

function TabIcon({ name, color }: { name: IconName; color: ColorValue }) {
  return <SymbolView name={name} tintColor={color} size={24} />;
}

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: DT.colors.primary,
        tabBarInactiveTintColor: DT.colors.textMuted,
        tabBarStyle: {
          backgroundColor: DT.colors.surface,
          borderTopColor: DT.colors.border,
          borderTopWidth: StyleSheet.hairlineWidth,
        },
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'カメラ',
          tabBarIcon: ({ color }) => (
            <TabIcon color={color} name={{ ios: 'camera', android: 'photo_camera', web: 'photo_camera' }} />
          ),
        }}
      />
      <Tabs.Screen
        name="converter"
        options={{
          title: '換算',
          tabBarIcon: ({ color }) => (
            <TabIcon
              color={color}
              name={{ ios: 'arrow.left.arrow.right', android: 'currency_exchange', web: 'currency_exchange' }}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="history"
        options={{
          title: '履歴',
          tabBarIcon: ({ color }) => (
            <TabIcon color={color} name={{ ios: 'clock', android: 'history', web: 'history' }} />
          ),
        }}
      />
      <Tabs.Screen
        name="calendar"
        options={{
          title: 'カレンダー',
          tabBarIcon: ({ color }) => (
            <TabIcon color={color} name={{ ios: 'calendar', android: 'calendar_month', web: 'calendar_month' }} />
          ),
        }}
      />
      <Tabs.Screen
        name="analytics"
        options={{
          title: '分析',
          tabBarIcon: ({ color }) => (
            <TabIcon color={color} name={{ ios: 'chart.bar', android: 'bar_chart', web: 'bar_chart' }} />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: '設定',
          tabBarIcon: ({ color }) => (
            <TabIcon color={color} name={{ ios: 'gearshape', android: 'settings', web: 'settings' }} />
          ),
        }}
      />
    </Tabs>
  );
}
