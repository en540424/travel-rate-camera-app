# 旅レートカメラ App Store提出準備メモ（2026-09-12 現在）

Preview Build `fa58940a-03c5-4d70-8d4b-16bc588cc1a5`（commit `ba2153a`）時点の、
production Build・App Store提出に向けた**現状確認と推奨**。

**このファイルは提出手順の正本ではなく、現状監査の記録である。**
仕様の正本は `design/旅レートカメラ_実装引き継ぎ資料.md`、実機確認は `TEST_CHECKLIST.md`。

> ここに書かれた**推奨はまだ適用していない**。`app.json`・`eas.json`は
> buildNumber方針がHuman未確定のため、今回は一切変更していない。

---

## 1. version / buildNumber（要Human判断）

| 項目 | 現状 | 備考 |
|---|---|---|
| `expo.version` | `1.0.0` | `app.json`。初回提出として妥当 |
| `expo.ios.buildNumber` | **未設定** | `app.json`にキー自体が無い |
| `eas.json` production の `autoIncrement` | **未設定** | 既定は無効 |
| 今回のPreview Buildの buildNumber | `1` | EASが既定値として付与 |

### 問題

App Storeは、**同一`version`内で`buildNumber`（CFBundleVersion）が一意かつ増加**していることを要求する。
現状のまま production Build → submit を2回以上行うと、2回目以降が
「この build number は既に使われています」で**弾かれる**。

### 推奨（Human確定が必要）

**案A（推奨）：`eas.json`のproduction profileに `"autoIncrement": true` を足す**

```jsonc
"production": {
  "distribution": "store",
  "autoIncrement": true,      // ← これだけ追加
  "ios": { "resourceClass": "default" }
}
```

- EASがリモート側でbuildNumberを保持し、production Buildのたびに自動で+1する
- `app.json`に数値を書かないため、**手で上げ忘れる事故が起きない**
- `version`（1.0.0）は変えない。マーケティング版数はHumanが上げたいときだけ上げる

**案B：`app.json`に`ios.buildNumber`を明示して手動管理**

- 提出のたびにHumanが手で上げる必要がある。上げ忘れが起きやすいので非推奨

**未確定のため今回は変更していない。** Humanが案A／案Bを決めた後に適用する。

---

## 2. production config 監査結果

| 項目 | 現状 | 判定 |
|---|---|---|
| bundle identifier | `com.estep.travelratecamera` | OK（preview Buildで実績あり） |
| Apple Team | `2R4LUXPDQ2`（Mitsunari Endo・Individual） | OK |
| Distribution Certificate | 有効・期限 2027-06-05 | OK |
| Provisioning Profile | active・期限 2027-06-05 | OK（ただしad hoc。**store配信用は別途EASが作る**） |
| 登録デバイス | 1台（`00008140-...001C`） | preview用。production(store)には不要 |
| `ITSAppUsesNonExemptEncryption` | `false` を明示済み | OK（輸出コンプライアンス質問を自動回答） |
| icon | `./assets/images/icon.png` 存在 | OK |
| splash | `expo-splash-screen`・`splash-icon.png` 存在 | OK |
| SDK | Expo 56.0.0 / RN 0.85.3 | OK |
| `eas.json` の `submit.production` | **空 `{}`** | 要設定（下記3） |
| EAS環境変数 production | `EXPO_PUBLIC_REVENUECAT_IOS_KEY` 設定済み（sensitive） | OK（値は未表示） |

### 権限（Info.plist usage description）

すべて日本語で設定済み。App Store審査で理由不足を指摘されにくい記述になっている。

| 権限 | 文言 |
|---|---|
| カメラ | カメラで価格タグを撮影して円換算します |
| フォトライブラリ | カメラロールの画像を買い物候補に紐付けます |
| マイク | 音声入力で話した内容を翻訳するためにマイクを使用します |
| 音声認識 | 話した内容を文字に変換して翻訳するために音声認識を使用します |

---

## 3. `eas submit` 設定（未設定・要Human情報）

`eas.json`の`submit.production`が空のため、`eas submit`実行時に
Apple ID・App Store Connect App ID等を毎回対話で聞かれる。

設定するには以下のHuman側情報が必要（**いずれも本repoに書かない・Secret扱い**）:

- Apple ID（App Store Connect アカウント）
- App Store Connect の **App ID（ascAppId）** ← ASC上でアプリレコードを作成して初めて確定する
- Apple Team ID：`2R4LUXPDQ2`（判明済み）

**App Store Connect上のアプリレコードが未作成なら、まずそれがHuman作業の最初の1歩。**

---

## 4. RevenueCat / 価格の整合（コード側は確認済み）

コード側（`src/config/revenuecat.ts`）の定義:

| 項目 | 値 |
|---|---|
| Entitlement ID | `pro` |
| Offering ID | `default` |
| 月額 Product ID | `com.estep.travelratecamera.pro.monthly` |
| 年額 Product ID | `com.estep.travelratecamera.pro.yearly` |
| iOS API Key | 環境変数 `EXPO_PUBLIC_REVENUECAT_IOS_KEY`（preview/production両方に設定済み） |

**アプリ内の価格表示はRevenueCatの`priceString`を使う**（コードに固定値を持たない）。
したがって、表示される金額の正しさは**RevenueCat Dashboard と App Store Connect の設定**で決まる。

### Human側で一致を確認する必要があるもの（Human-only）

- App Store Connect のサブスクリプション商品として、上記2つのProduct IDが**同じ綴りで**登録されていること
- 価格が **月額 ¥500 / 年額 ¥4,000** であること
- RevenueCat Dashboard の Entitlement `pro` に両Product IDが紐付いていること
- Offering `default` に月額・年額のPackageが入っていること

→ 実機での確認手順は `TEST_CHECKLIST.md` の **#27〜#29, #30〜#36**。

---

## 5. App Store 提出メタデータ（下書き・Human最終確定）

### 基本情報

| 項目 | 案 |
|---|---|
| App名 | 旅レートカメラ |
| サブタイトル（30字以内） | 値札にかざすだけで日本円がわかる |
| プライマリカテゴリ | 旅行（Travel） |
| セカンダリカテゴリ | ファイナンス（Finance） |
| 年齢レーティング | 4+（暴力・成人向け表現なし・ユーザー生成コンテンツの公開機能なし） |

### キーワード（100字以内・カンマ区切り案）

```
海外旅行,円換算,通貨換算,為替,レート,カメラ,OCR,値札,買い物,旅行,翻訳,予算,家計,お土産
```

### 説明文（案）

```
海外旅行の買い物で、「これ、日本円でいくら？」と迷わないためのアプリです。

値札にカメラをかざすだけで、その場で日本円の目安がわかります。
レジの前で電卓を開いて、レートを打ち直す必要はありません。

■ できること
・カメラで値札を読み取って円換算（OCR）
・米ドル／韓国ウォン／台湾ドル／タイバーツ／ユーロ／英ポンドに対応
・レートは自分で設定できるので、両替所やカードの実際のレートで計算できます
・翻訳、音声入力、読み上げ。店員さんとのやり取りもその場で
・気になった商品を保存して、候補と購入済みを管理
・予算を決めておけば、購入済みの合計を引いた残り予算がいつでも見えます
・カテゴリーを選んで保存できるので、何にいくら使ったか振り返れます

■ 無料でできること
カメラでの円換算、通貨換算、翻訳、音声入力、読み上げ、カテゴリー選択は
回数の制限なく無料でお使いいただけます。
無料版では、同時に管理できる旅行が1件、1つの旅行につき10件まで保存できます。

■ Proでできること
・保存無制限
・複数の旅行を同時に管理
・カテゴリーで絞り込み
・カテゴリー別の分析
・CSVエクスポート

■ レートについて
レートの自動取得には対応していません。ご自身で入力していただく方式です。
端末内で計算するため、通信が不安定な場所でもそのままお使いいただけます。

■ データの取り扱い
保存した記録は、お使いの端末内にのみ保存されます。
当方が運営するサーバーへ送信することはありません。
```

> 上の説明文は**実装済み機能のみ**で構成してある。
> 自動為替取得・クラウドOCR・PDF出力などの将来候補は**書いていない**（審査で機能不足を指摘される原因になるため）。

### 審査メモ（App Review Notes・案）

```
本アプリの有料プラン「Pro」は、RevenueCat経由の自動更新サブスクリプションです。
Pro機能（保存無制限・複数旅行・カテゴリー絞り込み／分析・CSV書き出し）の確認には、
Sandboxアカウントでのログインが必要です。

OCR機能の確認方法：
アプリ起動後、画面上部で換算モード（例：USD→JPY）を選び、
数字が印刷された値札・レシート等にカメラを向けて「読み取る」を押してください。
実際の値札がない場合は、「手入力で記録」から金額を直接入力して
保存・予算計算の動作をご確認いただけます。

レートは自動取得ではなく、ユーザーが入力する方式です。
初回起動時に換算レートの入力をお願いしています。
```

---

## 6. App Privacy（プライバシー質問）回答用の事実

実装事実（`src/`確認済み・LPのプライバシーポリシーとも一致）:

- 旅行・記録・写真などの保存データは**端末内のみ**。当方サーバーへ送信しない
- 氏名・メールアドレス・位置情報を取得しない
- アクセス解析・広告トラッキング・クラッシュレポート収集を行っていない
- 外部と通信するのは **App Store / RevenueCat（課金）** と **Apple の音声認識・翻訳** のみ

→ App Privacyの回答方針：**「データを収集していない」**を基本とし、
課金に伴う購入情報がRevenueCat経由で扱われる点をHumanが最終確認する。

---

## 7. 提出に必要な公開URL（**未充足・Humanブロッカー**）

App Store提出には、**公開されたURL**が必要:

| 項目 | ページ | 状態 |
|---|---|---|
| プライバシーポリシーURL | `travel-rate-camera-lp` の `/privacy` | ページは**実装済み**。**公開URLが未確定** |
| サポートURL | 同 `/contact` | ページは**実装済み**。**公開URLが未確定** |
| 利用規約 | 同 `/terms` | ページは**実装済み**（EULA代替。App Store標準EULAでも可） |

LPはローカルbuildまで通っているが、**まだどこにもdeployされていない**。

公開先の方針はVault側 `旅レートカメラ_LP公開方針決定メモ_2026-07-07` で
**既に決定済み**（新たに方式を検討し直す必要はない）。
**deploy作業自体はHuman-only**（LP側`AGENTS.md`の「触ってはいけない領域」）。

---

## 8. スクリーンショット（Human-only）

App Store Connectで必須のサイズ:

- **6.9インチ（iPhone 16 Pro Max等）**：1320×2868 または 2868×1320 — 必須
- **6.5インチ（iPhone 11 Pro Max等）**：1242×2688 — 6.9インチがあれば流用可の場合あり
- iPadは、iPad対応を謳わないなら不要

今回のPreview Build（`fa58940a`）を実機に入れて撮影するのが最短。
撮影推奨画面：メイン（価格OCR）／OCR結果／買い物リスト＋残り予算／カテゴリー分析／翻訳。

> LPの端末モックは実機スクショではなくCSS構成のため、**App Store用には使えない**。

---

## 9. production Build 実行の前提条件（現状）

| # | 条件 | 状態 |
|---|---|---|
| 1 | 最新Preview Buildが成功している | **✅ 完了**（`fa58940a` / `ba2153a`） |
| 2 | Human実機確認でrelease blockerなし | ⬜ **未**（`TEST_CHECKLIST.md` 54項目） |
| 3 | Sandbox購入／復元がOK | ⬜ **未**（同 #27〜#36） |
| 4 | production config確認完了 | **✅ 本ファイルで完了**（ただし下記5が残る） |
| 5 | buildNumber方針確定 | ⬜ **未**（本ファイル§1・Human判断） |

**1〜5がすべて揃い、HumanがGOを出すまで production Build は実行しない。**
App Store submission も同様にHuman承認後。
