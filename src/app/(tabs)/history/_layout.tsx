import { Stack } from 'expo-router';

// 履歴タブ専用のスタック。一覧→詳細→編集をプッシュにし、下タブ（Tabsレイアウト）は
// このスタックの外側にあるため、詳細・編集の表示中も常に表示され続ける。
export default function HistoryStackLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen
        name="item-detail"
        options={{ headerShown: true, title: '商品の詳細', headerBackTitle: '履歴' }}
      />
      <Stack.Screen
        name="item-edit"
        options={{ headerShown: true, title: '編集', headerBackTitle: '商品の詳細' }}
      />
    </Stack>
  );
}
