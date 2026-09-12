# 旅レートカメラ production Build前 技術設定監査（2026-09-12）

Preview Build `fa58940a-03c5-4d70-8d4b-16bc588cc1a5`（commit `ba2153a`）時点での、
**repo／EAS側の技術設定**の監査結果。

## このファイルの位置づけ（重要）

**App Store提出文言の正本はここではない。**

| 内容 | 正本 |
|---|---|
| アプリ名・サブタイトル・説明文・キーワード・スクショ構成／文言・App Privacy申告事実・ASC入力値・審査注意事項 | Vault `AI-Workflow-System/07_project-kits/tabirate-camera/旅レートカメラ_AppStore提出パッケージ_2026-09-12.md`（**2026-09-12新設**。旧`…提出文書セット_2026-09-11.md`はsuperseded） |
| 公開URL・連絡先 | Vault `旅レートカメラ_公開用連絡先・URL管理メモ.md`（アプリ側の実体は `src/config/external-links.ts`） |
| 実機／Sandbox確認手順 | 本repo `TEST_CHECKLIST.md` |
| 仕様 | `design/旅レートカメラ_実装引き継ぎ資料.md` |

本ファイルが扱うのは、上記のどれにも属さない **`app.json`／`eas.json`／EAS credentials／
環境変数といったrepo側の技術設定**に限る。重複正本を作らないため、文言類はここに書かない。

> **【2026-09-12更新】buildNumber方針はHuman確定済み・`eas.json`へ適用済み。**
> 詳細は§1参照。`app.json`は今回も変更していない（`version`・`ios.buildNumber`とも無変更）。

---

## 1. buildNumber（【2026-09-12更新】Human確定・適用済み）

**決定：案A（EAS `autoIncrement`）を採用。** `eas.json` production profileへ
`"autoIncrement": true`を追加済み（他profileには追加していない）。目的は、App Store提出のたびに
同一CFBundleVersionが再利用されて2回目以降のupload/submissionが詰まるのを防ぐこと。

| 項目 | 現状 |
|---|---|
| `expo.version` | `1.0.0`（無変更） |
| `expo.ios.buildNumber` | 無変更（`app.json`にキー自体が無い） |
| `eas.json` production の `autoIncrement` | **`true`（設定済み）** |
| `cli.appVersionSource` | 無変更（今回Human承認外のため未設定のまま） |
| 今回のPreview Buildの buildNumber | `1`（EASが既定値として付与。このBuildより前の状態） |

`eas config --profile production --platform ios` で解決結果を確認済み：
`{"credentialsSource":"remote","distribution":"store","autoIncrement":true,"resourceClass":"default"}`。
`preview`／`development`profileには`autoIncrement`は付いていないことも確認済み。

### 何が起きるか（背景・参考）

App Storeは、**同一`version`内で`buildNumber`（CFBundleVersion）が一意かつ増加**していることを要求する。
`autoIncrement`により、EASがリモート側でbuildNumberを保持し、production Buildのたびに自動で+1する。
`app.json`に数値を書かないため、手で上げ忘れる事故が構造的に起きない。`version`（`1.0.0`）は
この変更では変わらない（マーケティング版数はHumanが上げたいときだけ上げる）。

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
| icon | `./assets/images/icon.png`（**1024×1024 / colortype 6 = RGBA**） | 要IPA確認（§7-1） |
| splash（iOS） | **画像なし・背景色`#208AEF`のみ** | 仕様どおり動くが**ブランド不一致**（§7-2） |
| SDK / RN | Expo 56.0.0 / RN 0.85.3 | OK |
| `eas.json` の `submit.production` | **空 `{}`** | 要設定（§3） |
| EAS環境変数 `preview` | `EXPO_PUBLIC_REVENUECAT_IOS_KEY` 設定済み（sensitive） | OK（値は未表示） |
| EAS環境変数 `production` | 同上 設定済み（sensitive） | OK（値は未表示） |

### 権限（Info.plist usage description）

4種すべて日本語で設定済み。審査で理由不足を指摘されにくい記述になっている。
ただし**設定されている経路が2通りある**（2026-09-12実測で判明）。最終的な有無は
**ビルド後のIPAのInfo.plistでしか確認できない**点に注意。

| 権限 | 文言 | 設定経路 |
|---|---|---|
| カメラ | カメラで価格タグを撮影して円換算します | `expo-camera` plugin props → **prebuild時に注入** |
| フォトライブラリ | カメラロールの画像を買い物候補に紐付けます | `expo-image-picker` plugin props → **prebuild時に注入** |
| マイク | 音声入力で話した内容を翻訳するためにマイクを使用します | `expo-speech-recognition` plugin → **評価済みconfigに出現**（`eas config`で実測確認済み） |
| 音声認識 | 話した内容を文字に変換して翻訳するために音声認識を使用します | 同上 |

> マイク権限は「自動注入されていないか」を心配する対象ではなく、**翻訳ページの音声入力のために
> 意図して注入している**もの（用途文言つき）。旧チェック項目の懸念はこれで解消している。

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
| 5 | buildNumber方針確定・`eas.json`適用 | **✅ 完了**（本ファイル§1・2026-09-12） |

**1〜5がすべて揃い、HumanがGOを出すまで production Build は実行しない。**
App Store submission も同様にHuman承認後。

---

## 7. icon / splash / 権限の詳細監査（2026-09-12 追加）

### 7-1. icon のalpha（**release blockerではないが要IPA確認**）

- 実測：`assets/images/icon.png` は **1024×1024・PNG colortype 6（RGBA）＝alphaチャンネルあり**
- App Storeは**alpha付きのApp Iconを受け付けない**（アップロード時に弾かれる）
- ただしこのprojectは **CNG（`ios/`ディレクトリを持たない managed構成）** のため、
  prebuild時にExpoがicon生成処理でalphaを合成・除去する。**そのまま提出できる想定**
- **判定：blockerではない。** ただし「想定」であって実測ではないため、
  production Build後のIPAで最終確認する（下記7-4）

### 7-2. iOS splashに画像が設定されていない（**ブランド不一致・Human判断**）

実測で判明した事実：

- `app.json` の `expo-splash-screen` 設定は `backgroundColor: "#208AEF"` と **`android.image`** のみ
- iOS側の解決ロジック（`node_modules/expo-splash-screen/plugin/build/getIosSplashConfig.js`）は
  `{ ios = {}, ...rest }` をマージする。**top-levelに`image`が無く`ios`ブロックも無い**ため、
  `root.image` は `undefined` → **iOSのsplashは「画像なし・単色背景」になる**
- さらにその背景色 `#208AEF` は**青**だが、アプリのブランド色は
  `src/theme/tokens.ts` の `primary: '#0E9488'`（**ティール**）
- LPは2026-09-12に「旧LPは青で別ブランドだった」として**ティールへ統一済み**。
  splashの青は、その**旧ブランドの取り残し**と考えられる

**影響**：起動時に最初に見える画面が、ロゴなしの青一色になる。審査でのリジェクト要因ではないが、
第一印象とブランド一貫性の問題。

**判定：release blockerではないため、今回は変更していない**（`AGENTS.md`：確定済みUIの破壊的変更・
デザイン変更を勝手に行わない）。Humanが選ぶ:

| 案 | 変更内容 | 影響 |
|---|---|---|
| A（最小） | `backgroundColor` を `#208AEF` → `#0E9488` | 1行。ブランド色に統一されるがロゴは出ない |
| B | 上記に加え `image`（または `ios.image`）へ `splash-icon.png` を指定 | ロゴが出る。ただし現行`splash-icon.png`は**228×213**でExpoロゴ相当の素材のため、**専用素材の用意が要る** |
| C | 現状維持 | 起動画面は青一色のまま |

### 7-3. PrivacyInfo.xcprivacy（CNG構成での扱い）

- 本repoに `ios/` ディレクトリは**存在しない**（CNG＝prebuildで都度生成）。
  したがって**repo内にアプリ側の`PrivacyInfo.xcprivacy`が無いのは正常**で、欠落ではない
- 依存ライブラリが同梱しているマニフェストは**9件**（実測）：
  `expo-constants` / `expo-device` / `expo-file-system` / `expo-system-ui` /
  `react-native`（React・cxxreact・boost・glog・RCT-Folly）
- **`react-native-purchases`（RevenueCat）と `expo-text-extractor` は同梱していない**
- → Appleの要求対象SDKに該当するかは**Humanが公式資料で確認**する
  （Vault提出パッケージ §B-3-3 / §B-3-4 と同じ項目）

### 7-4. IPAでしか確認できない項目（production Build後にHumanが確認）

- [ ] App Iconにalphaが残っていない（7-1）
- [ ] Info.plistに4種の権限文言が入っている（カメラ／フォト／マイク／音声認識）
- [ ] `ITSAppUsesNonExemptEncryption: false` が入っている
- [ ] アプリ側`PrivacyInfo.xcprivacy`が生成されている（7-3）

---

## 8. 「いま production Build を実行したら詰まる要因」（2026-09-12 実測）

production Buildは**未実行**。実行前に詰まる要因だけを洗い出した結果：

| 項目 | 実測値 | Buildが通るか | submitが通るか |
|---|---|---|---|
| `eas.json` production profile | `distribution: store` / `autoIncrement: true` / `resourceClass: default` / `credentialsSource: remote` | ✅ 通る | ✅ |
| buildNumber | `autoIncrement: true`（§1） | ✅ | ✅ 2回目以降も詰まらない |
| `app.json` version | `1.0.0` | ✅ | ✅ |
| bundle identifier | `com.estep.travelratecamera` | ✅ | ✅ |
| Distribution Certificate | 有効（2027-06-05まで） | ✅ | ✅ |
| store用 Provisioning Profile | **未作成**（現存はad hoc＝preview用） | ✅ **EASが自動生成する** | ✅ |
| EAS環境変数 `production` | `EXPO_PUBLIC_REVENUECAT_IOS_KEY` 設定済み（sensitive・値は未表示） | ✅ | ✅ |
| 暗号申告 | `ITSAppUsesNonExemptEncryption: false` | ✅ | ✅ 質問されない想定 |
| **`submit.production`** | **空 `{}`** | ✅ Buildには無関係 | ⚠️ **`eas submit`が対話で Apple ID・`ascAppId` を聞く** |
| **ASCアプリレコード** | **未作成** | ✅ Buildには無関係 | ❌ **`ascAppId`が存在しないため submit できない** |

### 結論

- **production Build 自体は、いま実行しても技術的に詰まる要因は無い。**
  止めているのは技術要因ではなく、§6の前提条件2・3（Human実機／Sandbox確認）
- **submitは、ASCアプリレコードが作られるまで実行できない。** これが
  Human作業のクリティカルパス（§3）

`eas config --profile production --platform ios` の解決結果（read-only・2026-09-12実測）:

```json
{ "credentialsSource": "remote", "distribution": "store", "autoIncrement": true, "resourceClass": "default" }
```
