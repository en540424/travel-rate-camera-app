# React Native 移植メモ（共通・1本）

> 全画面に共通する React Native / Expo / TypeScript への移植方針。**各画面の差分は `*-spec.md` 末尾の「RN移植メモ（差分）」に書きます。** ここは共通の考え方とStyleSheet例だけ。
> プレーンHTMLは Figma / Cursor へ渡す「見た目の正」。`*.rn.tsx` はこのメモに沿った雛形です。

---

## 0. 大前提（Web表現に寄せない）

- **Next.js / Tailwind / shadcn/ui 前提ではない。** `div`→`View`、テキストは必ず `Text` で包む、押下は `Pressable`、画像は `Image`。
- HTMLの `class` / Tailwind ユーティリティは使わず、**`StyleSheet.create` ＋ `theme/tokens.ts`** に落とす。
- `gap` は RN 0.71+ の flex で利用可。古い環境なら要素マージンに展開。
- **テキストノードを `View` に直接置かない**（必ず `Text`）。HTMLの `<span>`/`<b>` は `Text`／ネスト `Text` に。
- 単位は数値（px相当のdp）。`%` は `width:'82%'` のように文字列で。

---

## 1. HTML → RN 要素対応

| HTML | RN | 注意 |
|---|---|---|
| `div`（レイアウト） | `View` | flex は RNでは既定 `column`。`flexDirection:'row'` を明示 |
| `span` / `p` / 文字 | `Text` | 文字は必ず `Text`。色/サイズは `Text` 側に |
| `<b>` 強調 | ネスト `<Text style={{fontWeight:'700'}}>` | |
| ボタン的 `div` | `Pressable` | `hitSlop` でタップ域確保。`onPress` |
| `img` / 画像枠 | `Image` / `View`（プレースホルダ） | プレースホルダは縞 `View` でOK |
| SVGアイコン | `react-native-svg`（`Svg/Path/Circle/Rect`） | stroke系は `stroke` / `strokeWidth` 属性 |
| 角丸 | `borderRadius` | 個別指定は `borderTopLeftRadius` 等 |
| `position:absolute; inset:0` | `StyleSheet.absoluteFillObject` | |
| `text-overflow:ellipsis` | `numberOfLines={1}` + `ellipsizeMode` | RNはCSS不要 |

---

## 2. box-shadow → shadow / elevation 変換

CSSの `box-shadow: 0 Yoffset Blur SpreadColor` を分解して当てる。**iOS は shadow*、Android は elevation を別に**。

```ts
// CSS:  box-shadow: 0 18px 40px -28px rgba(16,33,31,0.16)
const e2card = {
  // iOS
  shadowColor: '#16211F',
  shadowOffset: { width: 0, height: 10 },   // Yを少し詰める（-28pxのspreadぶん）
  shadowOpacity: 0.06,                        // rgbaのa。spreadが負なら弱める
  shadowRadius: 18,                           // blur/2 目安
  // Android
  elevation: 3,                               // blur帯に応じて 1〜16
};
```

変換の目安：

| CSS box-shadow の用途 | iOS shadowOpacity / Radius | elevation |
|---|---|---|
| 薄いカード境界（`0 1px 2px /0.04`） | 0.04 / 2 | 1 |
| カードの浮き（`0 18px 40px -28px /0.16`） | 0.06 / 18, offset{0,10} | 3 |
| CTAグロー（`0 8px 18px -8px teal/0.55`） | teal600 / 0.45 / 18, offset{0,8} | 6 |
| ボトムシート（上向き影） | 0.20 / 30, offset{0,**-10**} | 12 |

注意：
- **spread（4つ目の負値）は RN に無い。** offset.height を小さくして近似。
- 影色に**色付き（teal）**を使うのが本アプリの肝（CTAグロー）。Androidは elevation で色が出ないので、必要なら下に薄い teal の `View` を敷く。
- `overflow:'hidden'` を付けた `View` は iOS で影が消える。**影は親、クリップは子**で分ける。

---

## 3. 固定フッター（FixedFooter）の作り方

結果パネル・プラン・確認画面で多用。**保存系の操作は絶対にスクロールの奥に入れない。**

```tsx
function ScreenWithFooter() {
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: color.surface }}>
      <ScrollView
        contentContainerStyle={{ padding: 15, paddingBottom: 132 }}  // フッター高ぶん
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled">
        {/* 本文 */}
      </ScrollView>
      <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
        {/* 固定CTA */}
      </View>
    </View>
  );
}
const styles = StyleSheet.create({
  footer: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    backgroundColor: color.surface, paddingHorizontal: 15, paddingTop: 12,
    borderTopWidth: 1, borderTopColor: color.line2,
  },
});
```

- キーボードは**手入力/自由入力時のみ** `KeyboardAvoidingView` で持ち上げる。それ以外は固定のまま。
- ボトムシートは `@gorhom/bottom-sheet`（スナップ1段）推奨。背面 dim は `rgba(16,33,31,0.42)`。

---

## 4. 共通StyleSheet例（カード/チップ/ボタン/画像枠）

```ts
import { StyleSheet, Platform } from 'react-native';
import { color } from '../theme/tokens';

const shadowCard = Platform.select({
  ios: { shadowColor:'#16211F', shadowOffset:{width:0,height:10}, shadowOpacity:0.06, shadowRadius:18 },
  android: { elevation: 3 },
});

export const ui = StyleSheet.create({
  // カード
  card: { backgroundColor: color.surface, borderWidth: 1, borderColor: color.line, borderRadius: 18, padding: 16, ...shadowCard },
  // チップ（pill）
  chip: { flexDirection:'row', alignItems:'center', gap:5, backgroundColor: color.teal50, borderRadius: 999, paddingVertical: 6, paddingHorizontal: 12 },
  chipText: { fontSize: 12, fontWeight: '600', color: color.teal700 },
  // 主ボタン（CTA）
  primaryBtn: { height: 52, borderRadius: 15, backgroundColor: color.teal600, alignItems:'center', justifyContent:'center', flexDirection:'row', gap: 8 },
  primaryTxt: { fontSize: 16, fontWeight: '600', color: '#fff' },
  // 副ボタン
  secondaryBtn: { height: 50, borderRadius: 15, backgroundColor:'#fff', borderWidth: 1.5, borderColor: color.lineStrong, alignItems:'center', justifyContent:'center' },
  // 画像枠（プレースホルダ）
  photoFrame: { borderRadius: 12, backgroundColor: '#EEF1F0', overflow: 'hidden' },
  photoImg: { width:'100%', height:'100%' },
  // 金額（等幅）
  num: { fontVariant: ['tabular-nums'] },
});
```

CTAグロー（teal色の影）が要る所だけ別途：
```ts
const ctaGlow = Platform.select({
  ios: { shadowColor: color.teal600, shadowOffset:{width:0,height:8}, shadowOpacity:0.45, shadowRadius:18 },
  android: { elevation: 6 },
});
```

---

## 5. iPhone実機で崩れやすい余白の注意

- **SafeArea**：上＝ノッチ/Dynamic Island、下＝ホームインジケータ。`useSafeAreaInsets()` を使い、固定フッターは `insets.bottom + 12`、ヘッダーは `insets.top` を加味。ステータスバー高をハードコードしない。
- **下タブの二重化禁止**：expo-router の `(tabs)` を単一の正とする。画面内に独自の下タブUIを足さない。各画面に正しい `active` を割り当てる（カメラ/換算/履歴/カレンダー/分析/設定）。詳細・編集・作成・Pro・購入は遷移元タブ維持 or 下タブ非表示。
- **小型端末（SE等）**：カメラ枠やカードは `flex:1` でつぶれるので最小高さを決める。金額48pxは折り返さない（`numberOfLines={1}`＋`adjustsFontSizeToFit`）。
- **行高**：日本語は `lineHeight` を未指定だと詰まる。本文は `fontSize*1.5` 前後を明示。
- **キーボード**：金額入力時にフッターCTAが隠れない高さを確保（§3）。`keyboardType="decimal-pad"`。
- **タップ域 44pt 以上**：小さいチップ/アイコンボタンは `hitSlop` で拡張。
- **等幅数字**：金額・残予算・レートは必ず `fontVariant:['tabular-nums']`（桁ブレ防止）。

---

## 6. ナビゲーション構成（expo-router）

```
app/
  (tabs)/
    _layout.tsx        // 下タブ（カメラ/換算/履歴/カレンダー/分析/設定）= 単一の正
    index.tsx          // カメラ（メイン画面）
    history.tsx        // 履歴
    calendar.tsx       // カレンダー
    analysis.tsx       // 分析
    settings.tsx       // 設定トップ
  item/[id].tsx        // 商品詳細（タブ外・スタック）
  item/[id]/edit.tsx   // 商品編集
  trip/new.tsx         // 旅行作成
  trip/[id]/edit.tsx   // 旅行編集
  trip/index.tsx       // 旅行一覧
  rate.tsx             // レート設定
  currency.tsx         // 通貨選択（モーダル）
  pro/*                // Pro紹介/料金/購入確認/完了/復元
  settings/data.tsx    // データ管理
  settings/help.tsx    // ヘルプ
  settings/about.tsx   // アプリ情報
```

- シート（写真変更・上限到達・OCR・削除確認）は画面ではなく**モーダル/ボトムシート**として親に内包。
- 状態の単一ソース：アクティブ旅行・Pro entitlement・OCR残回数・保存件数は context/hook で一元配布。UIは読むだけ。
