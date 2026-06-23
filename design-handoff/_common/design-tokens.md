# 旅レートカメラ ・ designTokens（共通）

> 全画面共通のデザイントークン。色は既存画面の実値。スタックは React Native / Expo / TypeScript。
> 各画面の `*-spec.md` はこのトークン名を参照します。`src/theme/tokens.ts` に配置する想定。

## 1. Color（用途で固定）

candidate=amber、purchased/残予算/CTA=teal の **2系統だけ**。青は使わない。

| トークン | 値 | 用途 |
|---|---|---|
| `teal600` | `#0E9488` | 主役・CTA・購入済み・残予算 |
| `teal700` | `#0A766E` | 濃いティール（テキスト/数字） |
| `teal50` | `#E7F5F2` | 淡いティール背景（pill/バッジ） |
| `tealScan` | `#34D8C6` | スキャンライン |
| `amber500` | `#E0992E` | 候補ドット/バー |
| `amber700` | `#B5731A` | 候補テキスト / Proバッジ文字 |
| `amber50` | `#FBF1DE` | 候補バッジ背景 / Proバッジ背景 |
| `ink` | `#16211F` | 見出し・本文強・黒ヒーロー地 |
| `ink2` | `#5B6764` | 本文 |
| `ink3` | `#939E9B` | 補助テキスト |
| `ink4` | `#B7BFBC` | プレースホルダ |
| `heroDark` | `#11201E` | 黒ヒーロー/結果パネル上の暗面 |
| `line` | `#ECEFED` | カードボーダー |
| `line2` | `#EEF1F0` | 区切り線 / フッター上線 |
| `lineStrong` | `#DCE3E0` | 入力枠ボーダー |
| `appBg` | `#F5F7F6` | 画面背景（白に近い） |
| `appBg2` | `#EAEEEC` | ドキュメント面背景（淡ウォームグレー） |
| `surface` | `#FFFFFF` | カード・シート |
| `alert` | `#D9614E` | 破壊的操作・エラー |
| `alertBg` | `#FBEDEA` | エラー背景 |
| `proGoldA` / `proGoldB` | `#EBC976` / `#D9A441` | ゴールドグラデ（linear 135deg・識別のみ） |

### 状態カラー（必ずペアで使う）
- **候補** = `amber`系：dot `#E0992E` / text `#B5731A` / badgeBg `#FBF1DE` / cardBg `#FDFAF3` / border `#F0E6CF` / label「候補」
- **購入済み** = `teal`系：dot `#0E9488` / text `#0A766E` / badgeBg `#E7F5F2` / cardBg `#F0FAF7` / border `#D7EDE7` / label「購入済み」

## 2. Typography

iOS標準フォント（San Francisco / 日本語=Hiragino）。`fontFamily` は未指定でOK。**金額は必ず等幅数字**（`fontVariant:['tabular-nums']` / CSSは `font-feature-settings:'tnum'`）。

| 役割 | size | weight | letterSpacing | 用途 |
|---|---|---|---|---|
| `numberHero` | 48 | 700 | -1.7 | 円換算ヒーロー |
| `numberL` | 28 | 700 | -0.6 | 候補金額/手入力 |
| `display` | 22 | 700 | -0.4 | 大数字（保存完了など） |
| `title` | 19–20 | 700 | -0.2 | 画面名/旅行名 |
| `heading` | 16–17 | 700 | 0 | カード見出し |
| `body` | 13–15 | 500 | 0 | 本文 |
| `label` | 11–12 | 600 | 0 | ラベル |
| `caption` | 9.5–11 | 600 | 0 | 補助 |
| `overline` | 10–10.5 | 700 | 0.05em / uppercase | 見出し上ラベル |

## 3. Spacing（4ptグリッド）

| 名 | px | 用途 |
|---|---|---|
| `xs` | 4 | 最小 |
| `sm` | 8 | 要素間（小） |
| `md` | 12 | 要素間 |
| `lg` | 16 | カード内 |
| `screen` | 15–20 | 画面左右padding（カメラ系=15 / 一覧系=16–20） |
| `xl` | 24 | カード内（広） |

- 画面左右：カメラ系 **15** / 設定・履歴系 **16〜20**
- カード内：**14〜20** ・ カード間：**12〜14** ・ 要素間：**8〜12**

## 4. Radius

| 名 | px |
|---|---|
| `sheet` | 22–24（ボトムシート上端） |
| `card` | 16–22 |
| `cardLg` | 18（ヒーロー大カード） |
| `control` | 14–16（入力欄・カメラ枠） |
| `button` | 15 |
| `chip` | 999（pill） |
| `phone` | 38（端末画面角・モック用） |

## 5. Shadow（iOS shadow* / Android elevation）

RNは iOS と Android で別指定。CSSの `box-shadow` → RN変換の目安は `rn-common-notes.md` を参照。

| 名 | iOS | elevation | 用途 |
|---|---|---|---|
| `e2card` | color`#16211F` opacity`0.06` radius`18` offset`{0,10}` | 3 | カードの浮き |
| `e1card` | color`#10211F` opacity`0.04` radius`2` offset`{0,1}` | 1 | 薄いカード境界 |
| `cta` | color`#0E9488` opacity`0.45` radius`18` offset`{0,8}` | 6 | ティールCTAのグロー |
| `e3sheet` | color`#16211F` opacity`0.20` radius`30` offset`{0,-10}` | 12 | ボトムシート |

## 6. Button（高さ・色）

| 種別 | bg | fg | height | radius | 補足 |
|---|---|---|---|---|---|
| primary | `teal600` | `#fff` | 52 | 15 | `shadow.cta` |
| primarySm | `teal600` | `#fff` | 48 | 14–15 | 結果フッター等 |
| secondary | `#fff` | `ink` | 48–50 | 14–15 | border 1.5 `lineStrong` |
| productShutter | `#36443F`（チャコール） | `#fff` | 52 | 16 | 商品写真モード（弱い影） |
| ghost | transparent | `ink2` | 48 | — | 文字のみ |
| danger | `alert` | `#fff` | 52 | 15 | 破壊的 |
| disabled | `#EEF1F0` | `#A6AEAB` | 52 | 15–16 | 無効 |

## 7. 数値（価格・上限・回数）は config で別管理

価格・プランはトークンではなく **差し替え前提の config** に分離。

```ts
// src/config/limits.ts
export const FREE_LIMITS  = { trips: 1, saves: 30, hiOcrTrial: 3 };
export const PRO_OCR_QUOTA = { month: 50, year: 100, oneTime: 10 };
export const PRICE_PLACEHOLDER = { month: '¥480', year: '¥3,800', oneTime: '¥5,800' };
// 価格は RevenueCat の localizedPriceString を正にする。上記はUI仮表示のみ。
```
