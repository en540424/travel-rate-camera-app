/**
 * アプリ外部リンクの単一ソース。
 * 旅レートカメラLP（travel-rate-camera-lp）の公開URL。
 * URLはVault側 `旅レートカメラ_公開用連絡先・URL管理メモ.md`「9. 公開URL」を正とする。
 * 独自ドメインへ切り替える場合はここだけを更新する。
 */
export const EXTERNAL_LINKS = {
  privacyPolicy: 'https://travel-rate-camera-lp.vercel.app/privacy',
  terms: 'https://travel-rate-camera-lp.vercel.app/terms',
  contact: 'https://travel-rate-camera-lp.vercel.app/contact',
  licenses: 'https://travel-rate-camera-lp.vercel.app/licenses',
  /** iOSの正規サブスクリプション管理画面。CustomerInfo.managementURLが取得できない場合のフォールバック。 */
  appleSubscriptionManagement: 'https://apps.apple.com/account/subscriptions',
} as const;
