import { Alert, ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { SettingRow, SettingSection } from '@/components/ui';
import { color, radius, shadow } from '@/theme/tokens';

// app.json の version を正とする（手動同期）
const APP_VERSION = '1.0.0';

export default function AppInfoScreen() {
  function showPlaceholder(title: string) {
    Alert.alert(title, '準備中です。公開までに用意します。');
  }

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.identity}>
          <View style={styles.appIcon}>
            <ThemedText style={styles.appIconText}>旅</ThemedText>
          </View>
          <ThemedText style={styles.appName}>旅レートカメラ</ThemedText>
          <ThemedText style={styles.tagline}>撮って、円で見て、賢く旅する。</ThemedText>
          <View style={styles.versionPill}>
            <ThemedText style={styles.versionText}>バージョン {APP_VERSION}</ThemedText>
          </View>
        </View>

        <SettingSection title="規約・プライバシー">
          <SettingRow label="プライバシーポリシー" onPress={() => showPlaceholder('プライバシーポリシー')} />
          <SettingRow label="利用規約" onPress={() => showPlaceholder('利用規約')} />
          <SettingRow label="ライセンス" onPress={() => showPlaceholder('ライセンス')} />
        </SettingSection>

        <SettingSection title="サポート">
          <SettingRow label="お問い合わせ" onPress={() => showPlaceholder('お問い合わせ')} />
        </SettingSection>

        <ThemedText style={styles.copyright}>© 2026 旅レートカメラ</ThemedText>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bgScreen },
  scroll: {
    paddingHorizontal: 18,
    paddingTop: 24,
    paddingBottom: 60,
    gap: 18,
    maxWidth: 480,
    width: '100%',
    alignSelf: 'center',
  },
  identity: {
    alignItems: 'center',
    gap: 8,
    paddingVertical: 12,
  },
  appIcon: {
    width: 72,
    height: 72,
    borderRadius: 18,
    backgroundColor: color.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
    ...shadow.card,
  },
  appIconText: {
    fontSize: 34,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  appName: {
    fontSize: 22,
    fontWeight: '700',
    color: color.text,
    letterSpacing: -0.3,
  },
  tagline: {
    fontSize: 13,
    fontWeight: '500',
    color: color.muted,
  },
  versionPill: {
    backgroundColor: color.primarySoft,
    borderRadius: radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 5,
    marginTop: 4,
  },
  versionText: {
    fontSize: 12,
    fontWeight: '700',
    color: color.primaryDark,
    fontVariant: ['tabular-nums'],
  },
  copyright: {
    fontSize: 12,
    fontWeight: '500',
    color: color.faint2,
    textAlign: 'center',
    paddingTop: 8,
  },
});
