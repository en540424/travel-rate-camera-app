/**
 * カメラ画面（`(tabs)/index.tsx`）の「保存する写真」の状態と、その遷移（純粋関数）。
 *
 * **react-native・nativeモジュール・値のimportを一切持たない自己完結モジュール。**
 * `node --test`から直接importして検証できる状態を保つ（`edit-amount-core.ts`等と同じ規律）。
 *
 * ■ 守る約束（2026-10-20 Human実機確認の不具合から）
 *   1. 「履歴に残す写真」に表示している写真（`pendingPhotoUri`）＝保存時にコピーする写真（`photoUriToSave`）。
 *   2. Humanが写真を「使う」と明示的に選んだ瞬間（「新しい読み取りを使う」・カメラの「写真を使用」・
 *      ライブラリから選ぶ・「値札写真を使う」・「新しい写真を使う」）に、その写真が保存対象になる。
 *
 * ■ 不具合（Build `004465f7`）
 *   旧実装は「新しい読み取りを使う」・商品写真の撮影（カメラの「写真を使用」）で新しい写真を
 *   保存対象へ即反映せず、「履歴に残す写真」欄の案内（新しい写真を使う／今の保存写真を使う）で
 *   もう一度選ぶまで候補として保持していた。読み取り結果（金額・メモ候補）と上部の「読み取った値札」は
 *   新しい写真に切り替わるのに、保存されるのは最初の写真のまま、という食い違いになっていた。
 *
 * ■ 例外（意図的）：保存写真を商品写真・ライブラリ写真に変えた後の再読み取り
 *   「新しい読み取りを使う」は値札の読み取り結果を選ぶ操作。Humanが別途選んだ商品写真を黙って
 *   値札写真へ置き換えないよう、この場合だけ新しい値札写真は「履歴に残す写真」欄の候補にする
 *   （欄の表示＝保存される写真なので、約束1は保たれる）。写真を外した後の再読み取りも同じ。
 */

export type SavePhotoSource = 'ocr' | 'product' | 'library';

export interface SavePhotoState {
  /** 保存対象写真。「履歴に残す写真」の表示と保存時のコピー元は必ずこれ */
  pendingPhotoUri: string | null;
  /** 保存対象写真の出どころ（値札写真のままか、商品写真等に変えたか） */
  pendingPhotoSource: SavePhotoSource | null;
  /** 「写真なしで保存」。保存対象写真は保持したまま、保存時だけ写真を付けない */
  excludePhotoFromSave: boolean;
  /** 保存対象とは別に「読み取った値札」へ出す値札写真。保存対象と同じ写真ならnull（表示はpendingPhotoUri） */
  ocrPhotoUri: string | null;
  /** 「履歴に残す写真」欄で選んでもらう新しい値札写真（上の「例外」の場合だけ） */
  newPhotoCandidate: { uri: string } | null;
}

export const EMPTY_SAVE_PHOTO_STATE: SavePhotoState = {
  pendingPhotoUri: null,
  pendingPhotoSource: null,
  excludePhotoFromSave: false,
  ocrPhotoUri: null,
  newPhotoCandidate: null,
};

/** 保存時にコピーする写真。「写真なしで保存」ならnull */
export function photoUriToSave(state: SavePhotoState): string | null {
  return state.excludePhotoFromSave ? null : state.pendingPhotoUri;
}

/**
 * 今の読み取り結果と、新しい読み取りを見比べて選べるか（＝読み取り結果があり、その値札写真か保存写真がある）。
 * trueなら新しい読み取りは「新しい読み取りを使う／前の読み取りを残す」の候補にする（handleOcrResult）。
 * 写真の無い読み取り結果（最初の撮影の失敗等）は見比べられないので、新しい読み取りでそのまま置き換える。
 */
export function hasComparableReading(state: SavePhotoState, hasOcrResult: boolean): boolean {
  return hasOcrResult && (state.pendingPhotoUri != null || state.ocrPhotoUri != null);
}

/**
 * 価格OCRで撮った写真を、そのまま保存対象にしてよいか（＝保存写真が無く、見比べる読み取りも無い）。
 * 見比べる読み取りがある（再読み取り）なら、写真を外した後でも保存対象にはせず「新しい読み取りを使う」を待つ。
 */
export function isFirstScanCapture(state: SavePhotoState, hasOcrResult: boolean): boolean {
  return state.pendingPhotoUri == null && !hasComparableReading(state, hasOcrResult);
}

/** 最初の読み取りの写真を保存対象にする */
export function captureFirstScanPhoto(state: SavePhotoState, uri: string): SavePhotoState {
  return { ...state, pendingPhotoUri: uri, pendingPhotoSource: 'ocr', excludePhotoFromSave: false };
}

/** 保存対象（商品写真等）とは別に、読み取った値札写真を「読み取った値札」へ出す（最初の読み取り） */
export function showReadingPhoto(state: SavePhotoState, uri: string): SavePhotoState {
  return { ...state, ocrPhotoUri: uri };
}

/**
 * 「新しい読み取りを使う」：新しい読み取りの値札写真を反映する。
 * 保存写真が値札写真なら、新しい値札写真をそのまま保存対象にする（「写真なしで保存」の選択は変えない）。
 * 商品写真・ライブラリ写真を選んでいる／写真を外しているなら、それは変えず「履歴に残す写真」欄の候補にする。
 */
export function adoptNewReadingPhoto(state: SavePhotoState, photoUri: string | null): SavePhotoState {
  if (photoUri == null) return state;
  if (state.pendingPhotoSource === 'ocr' && state.pendingPhotoUri != null) {
    return { ...state, pendingPhotoUri: photoUri, ocrPhotoUri: null, newPhotoCandidate: null };
  }
  return { ...state, ocrPhotoUri: photoUri, newPhotoCandidate: { uri: photoUri } };
}

/**
 * 商品写真を撮った（カメラの「写真を使用」）／ライブラリから選んだ：その写真を保存対象にする。
 * それまでの保存写真が値札写真なら、「読み取った値札」とシートの「値札写真を使う」で戻せるよう残す。
 */
export function adoptChosenPhoto(
  state: SavePhotoState,
  uri: string,
  source: 'product' | 'library',
): SavePhotoState {
  const previousReadingPhoto =
    state.pendingPhotoSource === 'ocr' && state.pendingPhotoUri != null
      ? (state.ocrPhotoUri ?? state.pendingPhotoUri)
      : state.ocrPhotoUri;
  return {
    pendingPhotoUri: uri,
    pendingPhotoSource: source,
    excludePhotoFromSave: false,
    ocrPhotoUri: previousReadingPhoto,
    newPhotoCandidate: null,
  };
}

/** シートの「値札写真を使う」：読み取った値札写真を保存対象に戻す */
export function selectReadingPhoto(state: SavePhotoState): SavePhotoState {
  if (state.ocrPhotoUri == null) return state;
  return {
    ...state,
    pendingPhotoUri: state.ocrPhotoUri,
    pendingPhotoSource: 'ocr',
    excludePhotoFromSave: false,
    ocrPhotoUri: null,
    newPhotoCandidate: null,
  };
}

/** 「履歴に残す写真」欄の「新しい写真を使う」：候補の値札写真を保存対象にする */
export function selectNewPhotoCandidate(state: SavePhotoState): SavePhotoState {
  if (state.newPhotoCandidate == null) return state;
  return {
    ...state,
    pendingPhotoUri: state.newPhotoCandidate.uri,
    pendingPhotoSource: 'ocr',
    excludePhotoFromSave: false,
    ocrPhotoUri: null,
    newPhotoCandidate: null,
  };
}

/** 「履歴に残す写真」欄の「今の保存写真を使う」：候補を消すだけで保存対象写真は変えない */
export function keepCurrentPhoto(state: SavePhotoState): SavePhotoState {
  return { ...state, newPhotoCandidate: null, excludePhotoFromSave: false };
}

/**
 * 「写真を外す」：保存する写真だけを外す。値札写真だった場合は「読み取った値札」には残す
 * （読み取り結果の確認・再読み取りの見比べに使い、シートの「値札写真を使う」で保存写真に戻せる）。
 */
export function removeSavePhoto(state: SavePhotoState): SavePhotoState {
  const readingPhoto =
    state.pendingPhotoSource === 'ocr' && state.pendingPhotoUri != null
      ? (state.ocrPhotoUri ?? state.pendingPhotoUri)
      : state.ocrPhotoUri;
  return {
    ...state,
    pendingPhotoUri: null,
    pendingPhotoSource: null,
    excludePhotoFromSave: false,
    ocrPhotoUri: readingPhoto,
    newPhotoCandidate: null,
  };
}

/** 「写真なしで保存」⇔「写真を残す」 */
export function toggleExcludePhoto(state: SavePhotoState): SavePhotoState {
  return { ...state, excludePhotoFromSave: !state.excludePhotoFromSave };
}
