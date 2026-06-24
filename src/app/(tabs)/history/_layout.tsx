import { Stack } from 'expo-router';

// 履歴タブ専用のスタック。一覧→詳細をプッシュにし、下タブ（Tabsレイアウト）は
// このスタックの外側にあるため、詳細表示中も常に表示され続ける。
export default function HistoryStackLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen
        name="item-detail"
        options={{ headerShown: true, title: '商品の詳細', headerBackTitle: '履歴' }}
      />
    </Stack>
  );
}
