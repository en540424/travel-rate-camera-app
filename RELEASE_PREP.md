# 旅レートカメラ production Build前 技術設定監査（2026-09-12）

Preview Build `fa58940a-03c5-4d70-8d4b-16bc588cc1a5`（commit `ba2153a`）時点での、
**repo／EAS側の技術設定**の監査結果。

## このファイルの位置づけ（重要）

**App Store提出文言の正本はここではない。**

| 内容 | 正本 |
|---|---|
| アプリ名・サブタイトル・説明文・キーワード・スクショ構成／文言・App Privacy申告事実・サポートページ・審査注意事項 | Vault `AI-Workflow-System/07_project-kits/tabirate-camera/旅レートカメラ_AppStore提出文書セット_2026-09-11.md` |
| 公開URL・連絡先 | Vault `旅レートカメラ_公開用連絡先・URL管理メモ.md`（アプリ側の実体は `src/config/external-links.ts`） |
| 実機／Sandbox確認手順 | 本repo `TEST_CHECKLIST.md` |
| 仕様 | `design/旅レートカメラ_実装引き継ぎ資料.md` |

本ファイルが扱うのは、上記のどれにも属さない **`app.json`／`eas.json`／EAS credentials／
環境変数といったrepo側の技術設定**に限る。重複正本を作らないため、文言類はここに書かない。

> ここに書かれた**推奨はまだ適用していない。** `app.json`・`eas.json`は
> buildNumber方針がHuman未確定のため、今回一切変更していない。

---

## 1. buildNumber（最大の論点・要Human判断）

| 項目 | 現状 |
|---|---|
| `expo.version` | `1.0.0` |
| `expo.ios.buildNumber` | **未設定**（`app.json`にキー自体が無い） |
| `eas.json` production の `autoIncrement` | **未設定**（既定は無効） |
| 今回のPreview Buildの buildNumber | `1`（EASが既定値として付与） |

### 何が起きるか

App Storeは、**同一`version`内で`buildNumber`（CFBundleVersion）が一意かつ増加**していることを要求する。
現状のまま production Build → submit を**2回以上**行うと、2回目以降が
「この build number は既に使われています」で**弾かれる**。

初回提出1回だけなら通るが、審査リジェクト後の再提出・TestFlightの入れ直しで必ず踏む。

### 推奨（Human確定が必要）

**案A（推奨）：`eas.json` の production profile に `"autoIncrement": true` を足す**

```jsonc
"production": {
  "distribution": "store",
  "autoIncrement": true,      // ← この1行だけ追加
  "ios": { "resourceClass": "default" }
}
```

- EASがリモート側でbuildNumberを保持し、production Buildのたびに自動で+1する
- `app.json`に数値を書かないので、**手で上げ忘れる事故が構造的に起きない**
- `version`（`1.0.0`）は変えない。マーケティング版数はHumanが上げたいときだけ上げる

**案B：`app.json`に`ios.buildNumber`を明示して手動管理**
提出のたびにHumanが手で上げる必要があり、上げ忘れが起きやすいので非推奨。

**方針未確定のため今回は未適用。** Humanが案A／案Bを決めた後に反映する。

---

## 2. production config 監査結果

| 項目 | 現状 | 判定 |
|---|---|---|
| bundle identifier | `com.estep.travelratecamera` | OK（preview Buildで実績あり） |
| Apple Team | `2R4LUXPDQ2`（Mitsunari Endo・Individual） | OK |
| Distribution Certificate | 有効・期限 2027-06-05 | OK |
| Provisioning Profile | active・期限 2027-06-05（**ad hoc**） | preview用。store配信用はEASが別途作る |
| 登録デバイス | 1台（`00008140-...001C`） | preview用。production(store)には不要 |
| `ITSAppUsesNonExemptEncryption` | `false` を明示済み | OK（輸出コンプライアンス質問に自動回答） |
| icon | `./assets/images/icon.png` 存在 | OK |
| splash | `expo-splash-screen`・`splash-icon.png` 存在 | OK |
| SDK / RN | Expo 56.0.0 / RN 0.85.3 | OK |
| `eas.json` の `submit.production` | **空 `{}`** | 要設定（§3） |
| EAS環境変数 `preview` | `EXPO_PUBLIC_REVENUECAT_IOS_KEY` 設定済み（sensitive） | OK（値は未表示） |
| EAS環境変数 `production` | 同上 設定済み（sensitive） | OK（値は未表示） |

### 権限（Info.plist usage description）

4種すべて日本語で設定済み。審査で理由不足を指摘されにくい記述になっている。

| 権限 | 文言 |
|---|---|
| カメラ | カメラで価格タグを撮影して円換算します |
| フォトライブラリ | カメラロールの画像を買い物候補に紐付けます |
| マイク | 音声入力で話した内容を翻訳するためにマイクを使用します |
| 音声認識 | 話した内容を文字に変換して翻訳するために音声認識を使用します |

---

## 3. `eas submit` 設定（未設定・要Human情報）

`eas.json`の`submit.production`が空のため、`eas submit`実行時にApple ID等を毎回対話で聞かれる。
設定には以下が必要（**いずれも本repoに書かない・Secret扱い**）:

- Apple ID（App Store Connect アカウント）
- **App Store Connect の App ID（`ascAppId`）** ← ASC上でアプリレコードを作成して初めて確定する
- Apple Team ID：`2R4LUXPDQ2`（判明済み）

**ASC上のアプリレコードが未作成なら、それがHuman作業の最初の1歩。**

---

## 4. RevenueCat（コード側の定義・実設定はHuman確認）

`src/config/revenuecat.ts`:

| 項目 | 値 |
|---|---|
| Entitlement ID | `pro` |
| Offering ID | `default` |
| 月額 Product ID | `com.estep.travelratecamera.pro.monthly` |
| 年額 Product ID | `com.estep.travelratecamera.pro.yearly` |
| iOS API Key | 環境変数 `EXPO_PUBLIC_REVENUECAT_IOS_KEY`（preview/production両方に設定済み） |

**アプリ内の価格表示はRevenueCatの`priceString`を使い、コードに固定値を持たない。**
したがって表示金額の正しさは RevenueCat Dashboard と App Store Connect の設定で決まる。

Human側で一致を確認する項目（Dashboard操作はHuman-only）:

- ASCに上記2つのProduct IDが**同じ綴りで**登録されている
- 価格が **月額 ¥500 / 年額 ¥4,000**
- RevenueCatのEntitlement `pro` に両Product IDが紐付いている
- Offering `default` に月額・年額のPackageが入っている

→ 実機での確認手順は `TEST_CHECKLIST.md` **#27〜#29, #30〜#36**。

---

## 5. 提出に必要な公開URL（**充足済み**）

LPはVercelで公開済み。2026-09-12 時点で全URL **HTTP 200** を確認:

| 用途 | URL | 状態 |
|---|---|---|
| プライバシーポリシー | `https://travel-rate-camera-lp.vercel.app/privacy` | 200 |
| 利用規約 | `https://travel-rate-camera-lp.vercel.app/terms` | 200 |
| サポート | `https://travel-rate-camera-lp.vercel.app/contact` | 200 |
| ライセンス | `https://travel-rate-camera-lp.vercel.app/licenses` | 200 |

アプリ側の参照は `src/config/external-links.ts`（単一ソース）。

> **注意**：LP repoの`master`へのpushはVercelの自動デプロイに直結する。
> 2026-09-12のLP全面再構築commit（`b24451b`）は、push時点で**本番へ反映済み**。

---

## 6. production Build 実行の前提条件（現状）

| # | 条件 | 状態 |
|---|---|---|
| 1 | 最新Preview Buildが成功している | **✅ 完了**（`fa58940a` / `ba2153a`） |
| 2 | Human実機確認でrelease blockerなし | ⬜ **未**（`TEST_CHECKLIST.md` 54項目） |
| 3 | Sandbox購入／復元がOK | ⬜ **未**（同 #27〜#36） |
| 4 | production config確認完了 | **✅ 本ファイルで完了**（残りは#5） |
| 5 | buildNumber方針確定 | ⬜ **未**（本ファイル§1・Human判断） |

**1〜5がすべて揃い、HumanがGOを出すまで production Build は実行しない。**
App Store submission も同様にHuman承認後。
