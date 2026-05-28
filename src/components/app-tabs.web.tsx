// Web用タブナビゲーション（4タブ）
import {
  TabList,
  TabSlot,
  TabTrigger,
  Tabs,
  type TabTriggerSlotProps,
} from 'expo-router/ui';
import { Pressable, StyleSheet, useColorScheme, View } from 'react-native';

import { ThemedText } from './themed-text';

import { Colors, Spacing } from '@/constants/theme';

const TAB_HEIGHT = 58;

const TAB_ITEMS = [
  { name: 'index',     href: '/'                 as const, label: '📷 カメラ' },
  { name: 'converter', href: '/converter'         as const, label: '換算' },
  { name: 'history',   href: '/history'           as const, label: '履歴' },
  { name: 'settings',  href: '/settings'          as const, label: '設定' },
] as const;

export default function AppTabs() {
  const scheme = useColorScheme();
  const colors = Colors[scheme === 'unspecified' || !scheme ? 'light' : scheme];

  return (
    <Tabs>
      <TabSlot />
      <TabList asChild>
        <View
          style={[
            styles.tabBar,
            {
              backgroundColor: colors.background,
              borderTopColor: colors.backgroundElement,
            },
          ]}>
          {TAB_ITEMS.map(({ name, href, label }) => (
            <TabTrigger key={name} name={name} href={href} asChild>
              <TabButton>{label}</TabButton>
            </TabTrigger>
          ))}
        </View>
      </TabList>
    </Tabs>
  );
}

function TabButton({ children, isFocused, ...props }: TabTriggerSlotProps) {
  return (
    <Pressable
      {...props}
      style={({ pressed }) => [styles.tabButton, pressed && styles.pressed]}>
      <ThemedText
        themeColor={isFocused ? 'text' : 'textSecondary'}
        style={[styles.tabLabel, isFocused && styles.tabLabelFocused]}>
        {children}
      </ThemedText>
      {isFocused && <View style={styles.indicator} />}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    flexDirection: 'row',
    height: TAB_HEIGHT,
    alignItems: 'center',
    justifyContent: 'space-around',
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  tabButton: {
    flex: 1,
    height: TAB_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  tabLabel: { fontSize: 14, letterSpacing: 0.2 },
  tabLabelFocused: { fontWeight: '700' },
  indicator: {
    position: 'absolute',
    bottom: 4,
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#208AEF',
  },
  pressed: { opacity: 0.6 },
});
