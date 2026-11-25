/**
 * Pro+の画面群。公開フラグが無効（本番の初期値）なら、ディープリンクで来ても最初の画面へ戻す。
 */
import { Redirect, Stack } from 'expo-router';

import { useProPlusAccess } from '@/hooks/use-proplus';

export default function ProPlusLayout() {
  const access = useProPlusAccess();
  if (access === 'hidden') return <Redirect href="/" />;
  return (
    <Stack screenOptions={{ headerShown: true, headerBackTitle: '戻る' }}>
      <Stack.Screen name="index" options={{ title: 'Pro+' }} />
      <Stack.Screen name="map" options={{ title: '買い物マップ' }} />
      <Stack.Screen name="place-edit" options={{ title: '場所' }} />
      <Stack.Screen name="schedule" options={{ title: '旅行の予定' }} />
      <Stack.Screen name="event-edit" options={{ title: '予定' }} />
      <Stack.Screen name="ai-translate" options={{ title: 'AI翻訳' }} />
      <Stack.Screen name="plans" options={{ title: 'Pro+のプラン' }} />
    </Stack>
  );
}
