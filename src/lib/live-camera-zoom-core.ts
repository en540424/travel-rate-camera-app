/**
 * 翻訳ページのカメラ翻訳（`LiveTranslationCamera`）のズームの判定（純粋関数）。
 *
 * **react-native・nativeモジュール・値のimportを一切持たない自己完結モジュール。**
 * `node --test`から直接importして検証できる状態を保つ（`photo-zoom-core.ts`等と同じ規律）。
 *
 * ■ 倍率の値（2026-10-24）
 *   expo-cameraの`zoom`（0〜1）を使い、実際のカメラの倍率を変える（映像を引き伸ばさない）。
 *   iOSでは実際の倍率＝「端末のカメラの最大倍率 ^ zoom」（expo-camera 56 `CameraSessionManager.updateZoom`）で、
 *   最大倍率はJSから読めない。そのため「ちょうど2.0倍」は保証できず、端末によって多少前後する。
 *   値は、Humanが実機で使っているメインカメラ（価格OCR）の「2×」・ピンチの上限・ピンチの感度と同じにそろえる。
 *   **メインカメラのファイル（`CameraPreview.native.tsx`）はimportも変更もせず、値だけを写す**（価格OCRを変えないため）。
 *   zoomは1以下なので、端末のカメラの能力を超える倍率は要求しない。
 *
 * ■ 位置合わせ
 *   zoomはカメラ（capture device）そのものの倍率なので、画面の映像・文字認識へ渡す映像・撮影する写真が
 *   同じように拡大される。認識した文字の位置（映像に対する割合）を画面へ写す既存の計算（`mapBoxToView`）は
 *   そのまま使える（iPhone実機で確認する）。
 */

export const LIVE_CAMERA_ZOOM = {
  /** 元の倍率（1×） */
  min: 0,
  /** ダブルタップで拡大する倍率（メインカメラの「2×」と同じ値） */
  doubleTap: 0.25,
  /** ピンチで拡大できる上限（メインカメラのピンチの上限と同じ値） */
  max: 0.5,
  /** ピンチの指の開き具合（scale）の変化量→zoomの変化量の係数（メインカメラと同じ） */
  pinchSensitivity: 0.5,
} as const;

/** これより大きければ「拡大中」（ピンチで少しだけ動いた値も拡大中として扱う） */
const ZOOMED_EPSILON = 0.001;

/** zoomを使える範囲（元の倍率〜ピンチの上限）へ収める。数でない値は元の倍率へ戻す */
export function clampLiveCameraZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return LIVE_CAMERA_ZOOM.min;
  return Math.min(Math.max(zoom, LIVE_CAMERA_ZOOM.min), LIVE_CAMERA_ZOOM.max);
}

/**
 * ピンチで指が動いた時の次のzoom。今のzoomから、前回の指の開き具合→今回（`scale`、ピンチ開始時＝1）の差だけ増減する
 * （react-native-gesture-handlerのPinchの`onChange`：`scaleChange`＝今回÷前回。最初の1回は前回＝1）。
 * 範囲の端で止まった後に指を戻すと、すぐ逆へ動く。端で止まらなければ「開始時のzoom＋(scale−1)×感度」と同じ値になる
 */
export function pinchStepLiveCameraZoom(zoom: number, scale: number, scaleChange: number): number {
  if (!Number.isFinite(scale) || !Number.isFinite(scaleChange) || scaleChange <= 0) return clampLiveCameraZoom(zoom);
  const previousScale = scale / scaleChange;
  return clampLiveCameraZoom(zoom + (scale - previousScale) * LIVE_CAMERA_ZOOM.pinchSensitivity);
}

/** 元の倍率より拡大しているか */
export function isLiveCameraZoomed(zoom: number): boolean {
  return clampLiveCameraZoom(zoom) > LIVE_CAMERA_ZOOM.min + ZOOMED_EPSILON;
}

/**
 * ダブルタップ後のzoom。元の倍率なら拡大（2×）、拡大中なら（ピンチで途中の倍率にしていても）元の倍率へ戻す。
 */
export function toggleLiveCameraZoom(zoom: number): number {
  return isLiveCameraZoomed(zoom) ? LIVE_CAMERA_ZOOM.min : LIVE_CAMERA_ZOOM.doubleTap;
}
