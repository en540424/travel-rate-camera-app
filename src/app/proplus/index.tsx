/** Pro+の入口。買い物マップ・旅行の予定・AI翻訳へ。 */
import { router } from 'expo-router';
import { ScrollView } from 'react-native';

import { AccessNotice, Notice, pp } from '@/components/proplus/proplus-ui';
import { SectionCard } from '@/components/ui/SectionCard';
import { SettingRow } from '@/components/ui/SettingRow';
import { PRO_PLUS_QA } from '@/config/feature-flags';
import { PRO_PLUS_SIMULATED, useProPlusAccess, useProPlusData } from '@/hooks/use-proplus';
import { usePlanTier } from '@/hooks/use-purchases';
import { tierLabel } from '@/lib/proplus/proplus-purchase-core';

export default function ProPlusHome() {
  const access = useProPlusAccess();
  const planTier = usePlanTier(); // 本物の契約（開発ビルドの「契約を装う」ではない）
  const { data, blockedReason } = useProPlusData();
  const places = data.places.filter((p) => p.deletedAt === null).length;
  const events = data.events.filter((e) => e.deletedAt === null).length;
  return (
    <ScrollView style={pp.screen} contentContainerStyle={pp.content}>
      {PRO_PLUS_SIMULATED && <Notice>開発用ビルドのため、Pro+を契約中として表示しています（本番では表示されません）。</Notice>}
      {PRO_PLUS_QA && <Notice>Pro+の検証用ビルドです（審査・一般公開には使いません）。契約はSandboxの購入状態で判定しています。</Notice>}
      <AccessNotice access={access} blocked={blockedReason} />
      <SectionCard padding={0}>
        <SettingRow label="買い物マップ" value={`${places}か所`} onPress={() => router.push('/proplus/map')} />
        <SettingRow label="旅行の予定" value={`${events}件`} onPress={() => router.push('/proplus/schedule')} />
        <SettingRow label="AI翻訳" onPress={() => router.push('/proplus/ai-translate')} />
      </SectionCard>
      {/* 3プランの比較・購入・アップグレード・復元・現在の契約。既存のProの利用者のアップグレードもここから */}
      <SectionCard padding={0}>
        <SettingRow label="Pro+のプラン" value={tierLabel(planTier)} onPress={() => router.push('/proplus/plans')} />
      </SectionCard>
    </ScrollView>
  );
}
