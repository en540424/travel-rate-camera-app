/**
 * Pro+の入口・権利の判定と、Pro+のデータ（場所・予定）の読み込み。
 * 判定は `lib/proplus/proplus-access-core.ts`。公開フラグが無効なら、どのプランでも 'hidden'。
 */
import { useEffect } from 'react';

import { DEV_PRO_PLUS_PREVIEW, PRO_PLUS_QA, SHOW_PRO_PLUS } from '@/config/feature-flags';
import { useHasTier } from '@/hooks/use-purchases';
import { getProPlusAccess, resolveProPlusFlags, type ProPlusAccess } from '@/lib/proplus/proplus-access-core';
import { hasAnyProPlusData } from '@/lib/proplus/proplus-store-core';
import { useProPlusStore } from '@/stores/proplus-store';

const FLAGS = resolveProPlusFlags({ showProPlus: SHOW_PRO_PLUS, devPreview: DEV_PRO_PLUS_PREVIEW, qa: PRO_PLUS_QA });

/** 開発ビルドで契約を装っているか（画面の注意書き用） */
export const PRO_PLUS_SIMULATED = FLAGS.simulateEntitlement;

export function useProPlusAccess(): ProPlusAccess {
  const hasProPlus = useHasTier('pro_plus');
  const data = useProPlusStore((s) => s.data);
  return getProPlusAccess({
    flagEnabled: FLAGS.flagEnabled,
    hasProPlus: hasProPlus || FLAGS.simulateEntitlement,
    hasExistingData: hasAnyProPlusData(data),
  });
}

/** Pro+の画面で、データを1回だけ読み込む。 */
export function useProPlusData() {
  const status = useProPlusStore((s) => s.status);
  const load = useProPlusStore((s) => s.load);
  useEffect(() => {
    if (status === 'idle') void load();
  }, [status, load]);
  return useProPlusStore();
}
