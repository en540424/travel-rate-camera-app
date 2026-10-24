/**
 * 写真翻訳の拡大表示（`PhotoZoomViewer`）の判定（純粋関数）。
 *
 * **react-native・nativeモジュール・値のimportを一切持たない自己完結モジュール。**
 * `node --test`から直接importして検証できる状態を保つ（`live-text-core.ts`等と同じ規律）。
 *
 * タップ・Modalの表示そのものはnodeでは再現できない（iPhone実機で確認する）。ここでは
 * 「どの写真を開いているか」「2回のタップをダブルタップとみなすか」「どこを中心に拡大するか」だけを決める。
 */

/**
 * 拡大表示で開いている写真。開いた写真（`viewerUri`）が今の写真（`currentUri`）と同じ時だけ開いている。
 * 写真を撮り直した・選び直した・クリアした時は、前の写真の拡大表示を開いたままにしない。
 */
export function openPhotoViewerUri(viewerUri: string | null, currentUri: string | null): string | null {
  return currentUri != null && viewerUri === currentUri ? currentUri : null;
}

/** 1本指で触れて離した1回のタップ（画面座標・ms） */
export type PhotoTap = { x: number; y: number; time: number };

/** 1本指で触れて、ほとんど動かさずに離した時だけタップとみなす（ピンチ・ドラッグはタップにしない） */
export function isPhotoTap(
  start: { x: number; y: number; time: number; maxTouches: number },
  end: { x: number; y: number; time: number },
  options: { maxMove: number; maxDurationMs: number } = { maxMove: 10, maxDurationMs: 300 },
): boolean {
  if (start.maxTouches !== 1) return false;
  if (end.time - start.time > options.maxDurationMs) return false;
  return Math.hypot(end.x - start.x, end.y - start.y) <= options.maxMove;
}

/** 直前のタップと近い場所・短い間隔のタップならダブルタップ */
export function isDoubleTap(
  previous: PhotoTap | null,
  next: PhotoTap,
  options: { maxIntervalMs: number; maxDistance: number } = { maxIntervalMs: 300, maxDistance: 40 },
): boolean {
  if (previous == null) return false;
  if (next.time - previous.time > options.maxIntervalMs) return false;
  return Math.hypot(next.x - previous.x, next.y - previous.y) <= options.maxDistance;
}

/**
 * 等倍の表示でタップした所を中心に`scale`倍へ拡大する時の、表示する範囲（写真の座標＝画面の座標）。
 * 範囲が写真の外へはみ出さないように端で止める。
 */
export function zoomRectAround(
  x: number,
  y: number,
  viewWidth: number,
  viewHeight: number,
  scale: number,
): { x: number; y: number; width: number; height: number } {
  const width = viewWidth / scale;
  const height = viewHeight / scale;
  return {
    x: Math.min(Math.max(x - width / 2, 0), viewWidth - width),
    y: Math.min(Math.max(y - height / 2, 0), viewHeight - height),
    width,
    height,
  };
}
