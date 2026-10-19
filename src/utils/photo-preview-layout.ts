/**
 * 撮影後・保存前の写真プレビュー（メインカメラの「読み取った値札」枠）の高さ（純粋関数）。
 *
 * **react-native・nativeモジュール・値のimportを一切持たない自己完結モジュール。**
 * `node --test`から直接importして検証できる状態を保つ（`edit-amount-core.ts`等と同じ規律）。
 *
 * ■ なぜ画像全体（contain）を見せるのか
 *   保存される写真は撮影画像そのもの（`index.tsx doSaveCandidate`が`copyAsync`するだけで crop / resize しない）。
 *   旧プレビューは高さ110ptの横長枠に全幅で敷き詰めて縦スクロールさせていたため、縦長写真の中央約1/4しか見えず、
 *   保存後の商品詳細（別の切り抜き）と「別の範囲」に見えていた（2026-10-20 Human実機確認）。
 *   枠内に画像全体を収め、保存される範囲＝見えている範囲にする。
 *
 * ■ 高さは画面の縦幅に比例させ、上下限で挟む
 *   大きすぎると円換算ヒーロー・価格候補・保存フッターが押し下がるため、小さいiPhone（SE 667pt）では下限、
 *   大きいiPhone（Pro Max 932pt）では上限で止める。
 */

export const OCR_PHOTO_PREVIEW_MIN_HEIGHT = 160;
export const OCR_PHOTO_PREVIEW_MAX_HEIGHT = 220;
const OCR_PHOTO_PREVIEW_HEIGHT_RATIO = 0.24;

export function getOcrPhotoPreviewHeight(windowHeight: number): number {
  if (!Number.isFinite(windowHeight) || windowHeight <= 0) return OCR_PHOTO_PREVIEW_MIN_HEIGHT;
  const height = Math.round(windowHeight * OCR_PHOTO_PREVIEW_HEIGHT_RATIO);
  return Math.min(Math.max(height, OCR_PHOTO_PREVIEW_MIN_HEIGHT), OCR_PHOTO_PREVIEW_MAX_HEIGHT);
}
