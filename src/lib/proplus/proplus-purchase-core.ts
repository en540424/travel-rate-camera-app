/**
 * Pro+ の購入画面の状態と文言の判定（純粋関数・import 0件・`node --test`で検証）。
 *
 * 画面（`app/proplus/plans.tsx`）はここの結果だけで表示を決める。権利の判定（gate）はしない：権利は常に
 * CustomerInfo の有効な Entitlement から決める（`plan-tier-core.ts`）。購入の成否は `resolveTierPurchaseOutcome`
 * （`revenuecat-purchase-core.ts`）が「目標のプラン（Pro+）の Entitlement が付いたか」で決め、ここはその結果の見せ方だけを決める。
 *
 * ■ 守ること
 *   - 価格はコードに持たない。StoreKit の `priceString` だけを表示する（Pro+ の価格は Human の決定前・H-P1）
 *   - 商品が取れない（未登録・取得失敗・購入できない環境）時は購入ボタンを無効にし、理由を分けて案内する。存在しない商品を
 *     買えるように見せない
 *   - 無料体験の文言は StoreKit の introPrice があった時だけ出す（体験の有無は H-7 で未決定）
 *   - 今の Build で使えない機能（AI 翻訳が中継の未接続で動かない等）を「利用可」と書かない
 *   - 月額⇔年額（Crossgrade）の購入は、購入後も Pro+ のままなので `success` になる。これを「Pro+ が有効になりました」と
 *     見せない（切り替わりは次回の更新日から）
 */

export type PaidTierLike = 'pro' | 'pro_plus';
export type TierLike = 'free' | PaidTierLike;
export type PeriodLike = 'monthly' | 'annual';

// ── 商品の取得状態 ──

export type OfferingLoadState = 'idle' | 'loading' | 'loaded' | 'failed';

export type ProPlusAvailability =
  /** 購入できない環境（iOS以外・RevenueCat の鍵が Build に無い） */
  | 'store_unavailable'
  /** 読み込み中 */
  | 'loading'
  /** 通信の失敗など。再取得できる */
  | 'fetch_failed'
  /** Offering・商品が無い（ASC・RevenueCat で未登録）。準備中として案内する */
  | 'not_registered'
  /** 少なくとも月額・年額の一方を買える */
  | 'ready';

export function resolveProPlusAvailability(input: {
  isConfigured: boolean;
  isInitialized: boolean;
  loadState: OfferingLoadState;
  hasMonthly: boolean;
  hasAnnual: boolean;
}): ProPlusAvailability {
  if (!input.isInitialized) return 'loading';
  if (!input.isConfigured) return 'store_unavailable';
  if (input.loadState === 'idle' || input.loadState === 'loading') return 'loading';
  if (input.loadState === 'failed') return 'fetch_failed';
  return input.hasMonthly || input.hasAnnual ? 'ready' : 'not_registered';
}

export function availabilityMessage(a: ProPlusAvailability): string | null {
  switch (a) {
    case 'store_unavailable':
      return 'この端末・このBuildでは購入できません。';
    case 'loading':
      return null;
    case 'fetch_failed':
      return 'Pro+のプラン情報を取得できませんでした。通信状況を確認して、もう一度お試しください。';
    case 'not_registered':
      return 'Pro+は現在準備中です。提供開始まで、もうしばらくお待ちください。';
    default:
      return null;
  }
}

// ── プランの選択と購入ボタン ──

/** 選んだ期間の商品が無ければ、ある方へ寄せる（年額を先に見る＝既存の Pro の購入画面と同じ並び） */
export function effectivePeriod(selected: PeriodLike, has: { monthly: boolean; annual: boolean }): PeriodLike {
  if (has[selected]) return selected;
  if (has.annual) return 'annual';
  if (has.monthly) return 'monthly';
  return selected;
}

/** `plan-change-core.ts` の `classifyPlanChange` の結果（ここでは値だけを受け取る） */
export type PlanChangeLike = {
  kind: 'new' | 'upgrade' | 'downgrade' | 'crossgrade' | 'same' | 'unknown';
  timing: 'immediate' | 'next_renewal' | 'none';
};

export type PlanAction = {
  /** purchase＝購入の処理へ／manage＝App Storeのサブスクリプション管理へ／none＝押せない */
  kind: 'purchase' | 'manage' | 'none';
  label: string;
  /** 押す前に見せる切り替わりの説明 */
  note: string | null;
  disabled: boolean;
};

/**
 * 選んだ Pro+ の商品に対する購入ボタン。
 * @param priceLabel 例「¥980/月」（StoreKit の表示値＋期間）。商品が無ければ null
 */
export function planActionFor(input: { change: PlanChangeLike; availability: ProPlusAvailability; priceLabel: string | null; purchasing: boolean }): PlanAction {
  const { change, availability, priceLabel } = input;
  if (change.kind === 'same') return { kind: 'none', label: 'このプランを契約中です', note: null, disabled: true };
  if (change.kind === 'unknown' || change.kind === 'downgrade') {
    return {
      kind: 'manage',
      label: 'サブスクリプションを管理',
      note: change.kind === 'downgrade'
        ? '下位のプランへの変更は、次回の更新日から切り替わります。App Storeのサブスクリプション管理から変更してください。'
        : '現在の契約の内容を確認できないため、App Storeのサブスクリプション管理から確認・変更してください。',
      disabled: false,
    };
  }
  if (availability === 'loading') return { kind: 'none', label: '読み込み中…', note: null, disabled: true };
  if (availability !== 'ready' || priceLabel === null) return { kind: 'none', label: availability === 'not_registered' ? '準備中' : '購入できません', note: null, disabled: true };

  const note =
    change.kind === 'upgrade'
      ? '購入するとすぐにPro+へ切り替わります。Proの残りの期間の料金は、Appleの規定により日割りで返金されます。'
      : change.kind === 'crossgrade'
        ? '期間の変更は、次回の更新日から切り替わります。それまでは今のプランのまま使えます。'
        : null;
  const label = change.kind === 'upgrade' ? `${priceLabel} でPro+にアップグレード` : change.kind === 'crossgrade' ? `${priceLabel} に変更する` : `${priceLabel} で購入する`;
  return { kind: 'purchase', label, note, disabled: input.purchasing };
}

// ── 購入・復元の結果 ──

export type PurchaseStatusLike = 'success' | 'cancelled' | 'entitlement_missing' | 'error';

export type ResultMessage = {
  title: string;
  body: string;
  /** complete＝購入の完了として見せる／restore＝復元へ案内する／info＝知らせるだけ */
  tone: 'complete' | 'restore' | 'info';
};

/** 購入の結果の文言。キャンセルは何も出さない（null） */
export function describePurchaseResult(status: PurchaseStatusLike, change: PlanChangeLike): ResultMessage | null {
  switch (status) {
    case 'cancelled':
      return null;
    case 'success':
      if (change.kind === 'crossgrade') {
        return { title: 'プランの変更を受け付けました', body: '次回の更新日から新しい期間に切り替わります。それまでは今のプランのまま使えます。', tone: 'info' };
      }
      return {
        title: 'Pro+が有効になりました',
        body: '買い物マップ・旅行の予定などのPro+の機能と、保存件数の無制限などのProの機能をすべて使えます。',
        tone: 'complete',
      };
    case 'entitlement_missing':
      return {
        title: 'Pro+の有効化を確認できませんでした',
        body: '購入手続きは受け付けられた可能性があります。もう一度購入せず、しばらく待ってから「購入を復元」をお試しください。',
        tone: 'restore',
      };
    default:
      return {
        title: '購入を完了できませんでした',
        body: 'App Storeとの通信に問題が発生しました。しばらく待ってからもう一度お試しください。購入済みの場合は「購入を復元」をお試しください。',
        tone: 'restore',
      };
  }
}

/** 復元の結果の文言。`tierAfter` は復元後の CustomerInfo から求めたプラン（取得できなければ null） */
export function describeRestoreResult(status: 'success' | 'error', tierAfter: TierLike | null): ResultMessage {
  if (status !== 'success' || tierAfter === null) {
    return { title: '購入情報を確認できませんでした', body: '通信状況を確認して、時間をおいて再度お試しください。', tone: 'info' };
  }
  if (tierAfter === 'pro_plus') return { title: 'Pro+を復元しました', body: 'Pro+の機能とProの機能を使えます。', tone: 'complete' };
  if (tierAfter === 'pro') {
    return { title: 'Proの購入を復元しました', body: 'Pro+の購入は見つかりませんでした。Proの機能は使えます。', tone: 'info' };
  }
  return { title: '復元できる購入が見つかりませんでした', body: '購入時と同じ Apple ID でサインインしているかご確認ください。', tone: 'info' };
}

// ── 表示 ──

export function tierLabel(tier: TierLike): string {
  return tier === 'pro_plus' ? 'Pro+' : tier === 'pro' ? 'Pro' : '無料版';
}

export function periodLabel(period: PeriodLike | null): string | null {
  return period === 'monthly' ? '月額' : period === 'annual' ? '年額' : null;
}

/**
 * StoreKit の introPrice（無料体験・お試し価格）。無ければ null。体験の有無は ASC の設定で決まり、コードでは決めない。
 * 体験は1グループ1人1回で、以前に使った人は対象外になる。ここでは対象かどうかを確かめないので、「必ず無料」とは書かず、
 * 対象かどうかは App Store の購入確認画面に出ると書く（2026-11-25 独立検収 S8）
 */
export type IntroPriceLike = { price: number; priceString: string; periodUnit: string; periodNumberOfUnits: number; cycles: number } | null | undefined;

const UNIT: Record<string, string> = { DAY: '日', WEEK: '週間', MONTH: 'か月', YEAR: '年' };

export function describeIntroOffer(intro: IntroPriceLike): string | null {
  if (!intro || !Number.isFinite(intro.periodNumberOfUnits) || intro.periodNumberOfUnits <= 0) return null;
  const unit = UNIT[intro.periodUnit];
  if (!unit) return null;
  const span = `${intro.periodNumberOfUnits * Math.max(1, intro.cycles || 1)}${unit}`;
  const note = '対象かどうかは、App Storeの購入確認画面に表示されます。';
  if (intro.price === 0) return `初めての方は最初の${span}が無料です（以前に体験した方は対象外）。終了後は自動で有料の期間に切り替わります。${note}`;
  return `初めての方は最初の${span}が${intro.priceString}です（以前に利用した方は対象外）。終了後は通常の価格で自動更新されます。${note}`;
}

export type ComparisonRow = { label: string; free: string; pro: string; proPlus: string };

/** 3プランの比較。数値は `FREE_LIMITS`（`config/limits.ts`）を呼び出し側から渡す */
export function planComparison(limits: { saves: number; trips: number }): ComparisonRow[] {
  return [
    { label: '保存件数', free: `1旅行${limits.saves}件`, pro: '無制限', proPlus: '無制限' },
    { label: '記録中の旅行', free: `${limits.trips}件`, pro: '複数', proPlus: '複数' },
    { label: 'カテゴリー分析・CSV', free: '—', pro: '○', proPlus: '○' },
    { label: '買い物マップ', free: '—', pro: '—', proPlus: '○' },
    { label: '旅行の予定', free: '—', pro: '—', proPlus: '○' },
    { label: 'AI翻訳', free: '—', pro: '—', proPlus: '○' },
  ];
}

export type FeatureStatus = 'available' | 'preparing';
export type ProPlusFeature = { label: string; sub: string; status: FeatureStatus };

/**
 * Pro+ で増える機能と、今の Build で使えるか。AI 翻訳は中継（`config/ai-gateway.ts`）が設定されるまで「準備中」。
 * リアルタイム音声は端末の音声の取り込み・再生が未実装なので、中継があっても「準備中」
 */
export function proPlusFeatures(input: { aiGatewayConfigured: boolean; voiceReady: boolean }): ProPlusFeature[] {
  return [
    { label: '買い物マップ', sub: '気になったお店や買った場所を地図に残し、近い順に見られます。', status: 'available' },
    { label: '旅行の予定', sub: '旅行中の予定を日ごとに管理し、端末のカレンダーへ追加できます。', status: 'available' },
    { label: 'AIテキスト翻訳', sub: '長めの文章や会話文を、AIで自然な訳にします（毎月の利用枠あり）。', status: input.aiGatewayConfigured ? 'available' : 'preparing' },
    { label: 'AIリアルタイム音声翻訳', sub: '話した言葉をその場で訳して読み上げます（毎月の利用枠あり）。', status: input.aiGatewayConfigured && input.voiceReady ? 'available' : 'preparing' },
  ];
}
