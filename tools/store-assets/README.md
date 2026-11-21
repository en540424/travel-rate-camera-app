# E-NEXUS共通 ストア・広告素材生成（store-assets）

実アプリの画面を撮影し、App Store／Google Play提出用のスクリーンショットと、LP・SNS・広告用の画像を作る仕組み。
旅レートカメラを最初の対象にしているが、**エンジンはアプリに依存しない**。他のアプリは `apps/<アプリ>/profile.json` を足すだけで使える。

- 外部への送信・アップロード・ストアへの登録は一切しない（提出・LPの更新は人が行う）
- 有料のサービス・APIを使わない。依存はアプリのdevDependenciesにある `playwright` だけ（画像処理は自前・`node:zlib`）
- 生成物は `out/`（git管理外）。毎回 `out/<app>/<日時>-<commit>/` に新しく作り、前の結果を上書きしない

## 構成

| 場所 | 役割 | 共通／個別 |
|---|---|---|
| `engine/cli.mjs` | 実行の入口（撮影・取り込み・合成・検証・一覧） | 共通 |
| `engine/drivers/web-preview.mjs` | Web版をbundleしてPlaywrightで撮る（Windowsで動く） | 共通 |
| `engine/drivers/ios-simulator.mjs` | `xcrun simctl` でシミュレーターを操作して撮る手順（Macで実行） | 共通 |
| `engine/specs.mjs` | 出力先の寸法・形式（Apple・Google・SNS・広告・LP） | 共通 |
| `engine/provenance.mjs` | 撮影元と掲載内容の規則（下記） | 共通 |
| `engine/templates.mjs` | 合成のHTMLテンプレート | 共通 |
| `engine/png.mjs` | PNGの読み書き・アルファ除去・寸法検証 | 共通 |
| `engine/fixtures/expo-sqlite-node.mjs` | expo-sqliteのAPIをnode:sqliteで再現（テストデータDBの生成用） | 共通（Expo＋SQLiteのアプリ） |
| `apps/tabirate/profile.json` | 画面・遷移・文言・ブランド・言語・出力先・機能の公開状態 | 個別 |
| `apps/tabirate/build-fixture-db.mjs` | 撮影用テストデータDB（アプリ本体のmigration・保存関数で作る） | 個別 |

## 守る規則（エンジンが機械的に拒否する）

1. **架空のUIを実アプリの画面として扱わない。** 撮影元を `device`／`ios-simulator`／`android-emulator`／`web-preview` で記録する。
   Web版はiOSの見た目（フォント・SF Symbols・ネイティブ部品）と違うので、**`--mode final` のストア・公開素材には使えない**。
   `draft`（既定）では「DRAFT · Web版プレビュー · 提出不可」の透かしを入れてレイアウト確認にだけ使う。
2. **存在しない・未公開の機能を載せない。** 文言はそれぞれ根拠の機能（`features`）を持ち、機能の `status` が `released` のものだけ使える。
   `flagged`（実装済み・公開フラグで非表示）・`planned`（未実装）を根拠にした文言は設定の読み込みで止まる。
3. 出力は寸法・アルファ（透過不可）・枚数（Apple 1〜10・Google 2〜8）・manifestとの一致を検証する。finalに透かしやWeb版が混ざると失敗する。
   finalでは、作れなかったストア用の画像（撮影が無い・Web版しか無い）と出力0枚の出力先も問題にし、`compose`・`validate` は exit 1 で終わる。
4. 撮影後に差し替えられた画像（`captures.json` のsha256と不一致）は合成に使わない。Web版の撮影と同じ内容の画像を `import` で実機・シミュレーターとして取り込むことは拒否する。
   **限界**：`import --source` は申告であり、加工・縮小したWeb版の画像までは機械的に見分けられない。提出前の目視（index.htmlの撮影元バッジ）は人が行う。

## 使い方

```bash
# 1. Web版で撮って draft を作る（Windowsで完結。Web版のbundleに数分かかる）
npm run store-assets -- all --profile tools/store-assets/apps/tabirate/profile.json --build

# 2. iOSシミュレーター撮影の手順を作る（runディレクトリにシェルスクリプトとテストデータDBができる）
npm run store-assets -- plan-ios --profile tools/store-assets/apps/tabirate/profile.json --run <runディレクトリ>

# 3. Macで撮影した画像（または実機のスクリーンショット）を取り込む。ファイル名は「画面ID.png」
npm run store-assets -- import --profile <p> --run <run> --from <run>/captures/ios-simulator/iPhone-17-Pro-Max/ja --source ios-simulator --locale ja

# 4. 提出用を作る（ネイティブの撮影だけを使い、足りない画面は「作らなかったもの」に理由を残す）
npm run store-assets -- compose --profile <p> --run <run> --mode final
npm run store-assets -- validate --run <run>
```

結果は `<run>/index.html`（最終確認用の一覧・撮影元とdraft/finalのバッジ・検証結果）と `<run>/manifest.json`（commit・撮影元・sha256）。

### iOSシミュレーターでの撮影（Mac・人が実行）

- 前提：Xcode、対象のシミュレーター（`xcrun simctl list devices` の名前を `capture.ios.devices` に書く）、**シミュレーター向けにbuildしたアプリが入っていること**。
  buildはMac上の `npx expo run:ios --configuration Release`（EAS Buildの枠を使わない）か、EASのsimulatorプロファイル（Human GOが必要）。
- 手順のスクリプトは、アプリを止めて**シミュレーター内の**アプリDBを退避（`.bak-<時刻>`）してからテストデータへ置き換え、ディープリンクで各画面を開いて撮る。実機・利用者の端末には触れない。
- Mac miniは常駐用途なので、撮影は他の重い処理と重ねない。現時点で安全な遠隔実行の経路は無い（2026-10-21時点で Remote Login Off・Tailscale未導入）ため、Macでの実行は人が行う。

## 他のアプリで使う

`apps/<id>/profile.json` を作る。必須：`app.id`・`locales`・`brand.primary`・`features`・`capture.screens`（`route` か `deepLink`）・`shots`（`screen`・`features`・言語ごとの `caption.<locale>.title`）。
任意：`ads`（`shots`・`features`・`targets`・`headline`）、`outputs.store`、`capture.web`・`capture.ios`、`capture.ios.fixtureBuild`（テストデータDBを作るスクリプト）。
文言の `［…］` は強調色になる。多言語は `locales` と各文言を足し、`localeTags` でブラウザ・シミュレーターの言語を指定する。

## 提出前の確認（人）

- 寸法の値は2026-11-21に公式ページで確認した（`engine/specs.mjs` の冒頭）。提出前に公式ページを再確認する
- finalの画像を一覧で目視し、文言が現在の機能・価格と一致するかを確認する（価格は文言に入れていない。価格はストアの表示が正）
- 共通基盤（E-NEXUS側の正式な置き場所）への移管はHuman判断。エンジンはこのフォルダだけで完結するので、そのまま移せる

## 検証

```bash
npm run test:store-assets   # PNG・寸法・撮影元・文言の根拠・設定・iOS手順・テストデータDB
```
