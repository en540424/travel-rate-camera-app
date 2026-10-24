/**
 * 写真を「写真そのものの縦横比の枠」で全体表示するための寸法計算（純粋関数）。
 *
 * **react-native・nativeモジュール・値のimportを一切持たない自己完結モジュール。**
 * `node --test`から直接importして検証できる状態を保つ（`edit-amount-core.ts`等と同じ規律）。
 *
 * ■ なぜ写真全体（切り抜かない）なのか
 *   保存される写真は撮影画像そのもの（`index.tsx doSaveCandidate`が`copyAsync`するだけで crop / resize しない）。
 *   切り抜いて表示すると、保存前と保存後で「別の範囲」に見える（2026-10-20 Human実機確認）。
 *
 * ■ なぜ枠を写真の縦横比に合わせるのか
 *   固定の横長枠に contain で収めると、縦撮り写真の左右に大きな余白が出て写真が細く小さく見えた
 *   （2026-10-20 Build `7fa16f73` のHuman実機確認）。枠そのものを写真の縦横比にすれば、
 *   切り抜きも余白もなく写真全体が枠いっぱいに表示される。
 *
 * ■ 大きさの上限
 *   幅は親の幅（または面ごとの上限）いっぱい、高さは面ごとの上限で止める。縦撮り写真は高さの上限で決まり、
 *   横撮り写真は幅いっぱいになる。上限は面ごとの表（`PHOTO_SURFACES`）に集約し、画面側に数値を持たない。
 */

/** 縦横比が取れない間・取れなかった写真の仮の比率（iPhoneの縦撮り＝3:4） */
export const FALLBACK_PHOTO_ASPECT = 3 / 4;
/**
 * 枠の縦横比の下限・上限。極端に細長い画像（長いスクリーンショット・パノラマ）で枠が線のようにならないよう、
 * 枠の形だけをこの範囲に収める。写真自体はcontainで全体表示されるので、この場合だけ余白が出る。
 */
export const MIN_PHOTO_FRAME_ASPECT = 0.4;
export const MAX_PHOTO_FRAME_ASPECT = 2.5;

export type PhotoSurface = 'ocrResult' | 'detail' | 'photoTranslation' | 'savePhoto' | 'editThumb' | 'compareThumb';

type SurfaceLimit =
  /** 幅は親の幅いっぱい（実測）。高さの上限は画面の縦幅に比例させ、上下限で挟む */
  | { kind: 'screen'; heightRatio: number; minHeight: number; maxHeight: number }
  /** 決まった大きさの範囲に収める（行の中のプレビュー・サムネイル） */
  | { kind: 'box'; maxWidth: number; maxHeight: number };

const PHOTO_SURFACES: Record<PhotoSurface, SurfaceLimit> = {
  // 撮影直後の「読み取った値札」。下の円換算ヒーロー・金額候補を押し下げすぎない高さで止める
  // （iPhone SE 667pt→240pt／iPhone 15 852pt→307pt／Pro Max 932pt→336pt）
  ocrResult: { kind: 'screen', heightRatio: 0.36, minHeight: 230, maxHeight: 340 },
  // 商品詳細の大判写真（写真が主役の画面。操作ボタンは固定フッター）
  // （SE→320pt／iPhone 15→409pt／Pro Max→440pt）
  detail: { kind: 'screen', heightRatio: 0.48, minHeight: 300, maxHeight: 440 },
  // 翻訳ページの写真翻訳（撮った文字を確かめる写真。下の翻訳結果へスクロールで進める高さで止める。
  // タップで全画面の拡大表示を開く）（SE→334pt／iPhone 15→443pt／Pro Max→460pt）
  photoTranslation: { kind: 'screen', heightRatio: 0.52, minHeight: 300, maxHeight: 460 },
  // 保存の設定「履歴に残す写真」（右に説明文が並ぶ行。SEでも説明文の列を約140pt残す）
  savePhoto: { kind: 'box', maxWidth: 136, maxHeight: 180 },
  // 履歴編集の保存写真サムネ
  editThumb: { kind: 'box', maxWidth: 72, maxHeight: 72 },
  // 再読み取り・写真差し替え時の比較サムネ
  compareThumb: { kind: 'box', maxWidth: 56, maxHeight: 56 },
};

export interface PhotoBox {
  width: number;
  height: number;
}

/** 画像の幅・高さから縦横比（幅÷高さ）。取れない値（未定義・0・負数・NaN・Infinity）はnull */
export function photoAspectFromSize(width: unknown, height: unknown): number | null {
  if (typeof width !== 'number' || typeof height !== 'number') return null;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  return width / height;
}

/**
 * 縦横比`aspect`の写真が、幅`maxWidth`・高さ`maxHeight`に収まる最大の枠。
 * `maxWidth`はInfinity可（親の幅をまだ測れていない間は高さだけで決める）。
 */
export function fitPhotoBox(aspect: number | null | undefined, maxWidth: number, maxHeight: number): PhotoBox {
  const valid = typeof aspect === 'number' && Number.isFinite(aspect) && aspect > 0;
  const frameAspect = Math.min(
    Math.max(valid ? aspect : FALLBACK_PHOTO_ASPECT, MIN_PHOTO_FRAME_ASPECT),
    MAX_PHOTO_FRAME_ASPECT,
  );
  const boundHeight = Number.isFinite(maxHeight) && maxHeight > 0 ? maxHeight : 0;
  const boundWidth = maxWidth > 0 ? maxWidth : 0; // Infinity はそのまま（幅の制限なし）
  if (boundHeight === 0 || boundWidth === 0) return { width: 0, height: 0 };

  let width = boundHeight * frameAspect;
  let height = boundHeight;
  if (width > boundWidth) {
    width = boundWidth;
    height = boundWidth / frameAspect;
  }
  return { width: Math.round(width), height: Math.round(height) };
}

/** 面ごとの枠の上限。`maxWidth`がnullの面は、親の幅（実測）を上限にする */
export function getPhotoSurfaceLimit(
  surface: PhotoSurface,
  windowHeight: number,
): { maxWidth: number | null; maxHeight: number } {
  const limit = PHOTO_SURFACES[surface];
  if (limit.kind === 'box') return { maxWidth: limit.maxWidth, maxHeight: limit.maxHeight };
  if (!Number.isFinite(windowHeight) || windowHeight <= 0) return { maxWidth: null, maxHeight: limit.minHeight };
  const height = Math.round(windowHeight * limit.heightRatio);
  return { maxWidth: null, maxHeight: Math.min(Math.max(height, limit.minHeight), limit.maxHeight) };
}

/**
 * 画面に出す写真枠の大きさ（全ての面がこの関数を通る）。
 * `availableWidth`は親の幅の実測値。まだ測れていない（null等）間は高さの上限だけで決める。
 */
export function getPhotoBoxSize(
  surface: PhotoSurface,
  aspect: number | null | undefined,
  windowHeight: number,
  availableWidth: number | null | undefined,
): PhotoBox {
  const { maxWidth, maxHeight } = getPhotoSurfaceLimit(surface, windowHeight);
  const measured =
    typeof availableWidth === 'number' && Number.isFinite(availableWidth) && availableWidth > 0
      ? availableWidth
      : Number.POSITIVE_INFINITY;
  return fitPhotoBox(aspect, Math.min(maxWidth ?? Number.POSITIVE_INFINITY, measured), maxHeight);
}
