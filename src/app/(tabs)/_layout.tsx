import { Tabs } from 'expo-router';
import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { Alert, StyleSheet, type ColorValue } from 'react-native';

import { DT } from '@/constants/designTokens';
import { useUnsavedChangesStore } from '@/stores/unsaved-changes-store';

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
      }}
      // 商品編集画面で未保存の変更がある間だけ、下タブ移動の前に確認Alertを出す。
      // 編集画面の戻るボタン（headerBackTitle）はこの対象外（タブ切替のみガードする）。
      screenListeners={({ navigation, route }) => ({
        tabPress: (e) => {
          if (!useUnsavedChangesStore.getState().hasUnsavedChanges) return;
          e.preventDefault();
          Alert.alert(
            '変更内容を破棄しますか？',
            '保存していない変更があります。移動すると変更は破棄されます。',
            [
              { text: '編集を続ける', style: 'cancel' },
              {
                text: '破棄して移動',
                style: 'destructive',
                onPress: () => {
                  useUnsavedChangesStore.getState().setHasUnsavedChanges(false);
                  navigation.navigate(route.name);
                },
              },
            ],
          );
        },
      })}>
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
