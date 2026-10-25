import { Stack } from 'expo-router';

// カレンダータブ専用のスタック（履歴タブの`history/_layout.tsx`と同じ形）。
// 以前はカレンダーの記録から履歴タブの`/history/item-detail`へpushしていたため、
// 下タブが履歴へ切り替わり、戻ると履歴一覧へ着いていた（2026-10-25 TestFlight 1.0.0 (4)でHuman確認）。
// 詳細・編集をこのスタックにも登録し、戻るとカレンダー（表示月・選択日・スクロール位置はそのまま）へ帰る。
// 詳細・編集の中身は履歴タブと同一のコンポーネント（`item-detail.tsx`／`item-edit.tsx`の再export）。
export const unstable_settings = {
  // 直接`/calendar/item-detail`を開いた場合でも、下にカレンダー本体を置いて戻り先を失わない
  anchor: 'index',
};

export default function CalendarStackLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen
        name="item-detail"
        options={{ headerShown: true, title: '商品の詳細', headerBackTitle: 'カレンダー' }}
      />
      <Stack.Screen
        name="item-edit"
        options={{ headerShown: true, title: '編集', headerBackTitle: '商品の詳細' }}
      />
    </Stack>
  );
}
