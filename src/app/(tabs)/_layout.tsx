import { Tabs } from 'expo-router';
import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { Alert, Platform, StyleSheet, type ColorValue } from 'react-native';

import { DT } from '@/constants/designTokens';
import { color } from '@/theme/tokens';
import { useUnsavedChangesStore } from '@/stores/unsaved-changes-store';
import { triggerTabScrollReset } from '@/utils/tab-scroll-reset';

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
        // 視認性改善（2段階目）: textMuted(#9CA3AF)→textSecondary(#6B7280)でも
        // Human実機評価で「まだ背景と同化する」との指摘があったため、黒(textPrimary)には
        // 寄せずcolor.tabInactive(#4F5865、中濃度neutral gray)へ変更。
        // font weight変更・selected背景追加はしない（見やすさだけの最小変更）。
        tabBarInactiveTintColor: color.tabInactive,
        tabBarStyle: {
          backgroundColor: DT.colors.surface,
          borderTopColor: DT.colors.border,
          borderTopWidth: StyleSheet.hairlineWidth,
        },
      }}
      // 商品編集画面で未保存の変更がある間だけ、下タブ移動の前に確認Alertを出す。
      // 編集画面の戻るボタン（headerBackTitle）はこの対象外（タブ切替のみガードする）。
      // 未保存の変更が無い通常のタブ切替時は、切替先タブのスクロールを先頭へ戻す
      // （tabPressはタブバー押下時のみ発火し、タブ内の詳細/編集画面から戻る操作では
      // 発火しないため、そちらのスクロール位置維持には影響しない）。
      screenListeners={({ navigation, route }) => ({
        tabPress: (e) => {
          if (!useUnsavedChangesStore.getState().hasUnsavedChanges) {
            triggerTabScrollReset(route.name);
            return;
          }
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
                  // 下タブ移動では編集画面がアンマウントされないため、編集画面が登録した
                  // revert処理を呼んで下書きを読み込み時点へ戻す（未保存の写真fileの削除を含む）。
                  // これを省くと「破棄」したのに編集中の値が画面に残り続ける。
                  useUnsavedChangesStore.getState().discardHandler?.();
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
      {/*
        専用翻訳ページ。カメラの右隣に置く（旅行中の使用頻度が高い「値段を読む」と「翻訳」を隣接させる）。
        `href: null`でiOS以外はタブを表示しない（Apple TranslationはiOS専用で、
        Android/Webにはnative実体が無いため）。routeは登録されたまま残るのでlinkは壊れない。
        **iOSでは`href`キー自体を渡さないこと。** 現行のexpo-routerは`href !== undefined`で
        分岐したうえで`href == null`を判定しており、`href: undefined`を渡すと将来の実装差で
        iOSのタブまで消えうる。条件付きスプレッドでキーごと落とす。
      */}
      <Tabs.Screen
        name="translation"
        options={{
          title: '翻訳',
          tabBarIcon: ({ color }) => (
            // `character.bubble`はSF Symbols 2.2 = iOS 14.5+。
            // deployment targetが16.4（podspecでTranslationをweak link）のため、
            // iOS 17.4+で追加された`translate`は使わない（16.4〜17.3でアイコンが空になる）。
            <TabIcon color={color} name={{ ios: 'character.bubble', android: 'translate', web: 'translate' }} />
          ),
          ...(Platform.OS !== 'ios' ? { href: null } : {}),
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
