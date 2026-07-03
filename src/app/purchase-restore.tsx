import { Redirect } from 'expo-router';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { PrimaryButton } from '@/components/ui';
import { SHOW_PRO } from '@/config/feature-flags';
import { color, radius, shadow } from '@/theme/tokens';

export default function PurchaseRestoreScreen() {
  // 初回MVPはPro未実装。ルート直接アクセスでも購入復元画面へ進めないようガードする（P0-02）
  if (!SHOW_PRO) {
    return <Redirect href="/(tabs)/settings" />;
  }

  function handleRestore() {
    Alert.alert(
      '購入の復元は準備中です',
      'アプリ内課金（RevenueCat / StoreKit）はストア公開時に有効化されます。',
    );
  }

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.card}>
          <View style={styles.iconWrap}>
            <ThemedText style={styles.icon}>↺</ThemedText>
          </View>
          <ThemedText style={styles.title}>以前の購入を復元</ThemedText>
          <ThemedText style={styles.body}>
            機種変更や再インストールの後でも、同じ Apple ID で購入した Pro を復元できます。
          </ThemedText>
        </View>

        <PrimaryButton title="購入を復元する" onPress={handleRestore} />

        <View style={styles.note}>
          <ThemedText style={styles.noteTitle}>ⓘ 復元できない場合</ThemedText>
          <ThemedText style={styles.noteBody}>
            購入時と同じ Apple ID でサインインしているかご確認ください。解決しない場合はお問い合わせください。
          </ThemedText>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bgScreen },
  scroll: { padding: 18, paddingTop: 24, gap: 16, maxWidth: 480, width: '100%', alignSelf: 'center' },
  card: {
    backgroundColor: color.card, borderRadius: radius.cardLg, borderWidth: 1, borderColor: color.line,
    padding: 24, alignItems: 'center', gap: 10, ...shadow.card,
  },
  iconWrap: { width: 64, height: 64, borderRadius: 32, backgroundColor: color.primarySoft, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  icon: { fontSize: 30, fontWeight: '700', color: color.primary },
  title: { fontSize: 18, fontWeight: '700', color: color.text },
  body: { fontSize: 13.5, fontWeight: '500', color: color.muted, textAlign: 'center', lineHeight: 21 },
  note: { backgroundColor: color.proSoft, borderRadius: radius.card, borderWidth: 1, borderColor: color.candidateBorder, padding: 14, gap: 4 },
  noteTitle: { fontSize: 13, fontWeight: '700', color: color.pro },
  noteBody: { fontSize: 12.5, fontWeight: '500', color: color.body, lineHeight: 20 },
});
