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
- Mac miniは常駐用途なので、撮影は他の重い処理と重ねない。Windowsから Mac への接続の経路は未構築のため、Macでの実行は人が行う。どの端末からでも依頼する方法は下の「遠隔撮影」。

## 遠隔撮影（どの開発端末からでも依頼する）

Windows・会社PC・Macのどれからでも、**commitを固定した撮影ジョブ**を作り、macOSの実行先で撮影し、結果を検証して取り込む。
撮影そのものは上の iOS シミュレーター手順（`drivers/ios-simulator.mjs`）をそのまま使う（撮影エンジンを増やさない）。

```bash
# どの端末でも：ジョブを作る（未commitの変更があると作らない）→ 手順を確かめる（撮影しない）
npm run store-assets -- job-create   --profile tools/store-assets/apps/tabirate/profile.json --target github-actions-macos
npm run store-assets -- job-run      --job <out/tabirate/jobs/<id>> --dry-run
npm run store-assets -- job-dispatch --job <dir>              # 依頼の内容を表示（--execute で専用branchへ push＝GitHubで撮影が始まる）
npm run store-assets -- job-fetch    --job <dir>              # run を探して確かめる（--execute で成果物を取得。--run-id で指定も可）
npm run store-assets -- job-cleanup  --job <dir>              # このジョブの専用branchを消す（--execute）
npm run store-assets -- job-ingest   --job <dir> --from <dir>/result-run<id> [--device "iPhone 17 Pro Max"]
npm run store-assets -- job-status   --job <dir> [--to failed --note 理由]   # 状態と再実行（failed → dispatched で試行+1）
npm run store-assets -- job-list     --profile <p>            # 一覧と out/<app>/jobs/index.html
```

| 実行先（`--target`） | 状態 | 費用 | 開始 |
|---|---|---|---|
| `github-actions-macos` | `.github/workflows/store-assets-ios.yml`。**main を変えずに動く**：`job-dispatch --execute` がジョブのcommitの上に `.github/store-assets/job.json` だけを足したcommitを `ci/store-assets-ios/<ジョブID>` へ push し、その push でだけ起動する（形が違えば撮影の前に止める）。workflow が main に入った後は `--via dispatch`（workflow_dispatch）も使える | 公開repoの標準ランナー（macos-26）は無料。larger runner は使わない。private なら有料 | `job-dispatch --execute`（Windowsから可） |
| `mac-mini` | 経路は未構築（Windowsから Mac への接続なし）。手で job.json を持って行き、Mac で `job-run`（保守窓を人が確かめた時だけ `--confirm-maintenance-window`） | 0円 | 人（常駐の他の用途と同居。空きディスク30GB・空きメモリ20%を確認し、不明か足りなければ止まる。上限時間 `maxRuntimeMinutes` で止め、終わったらシミュレーターを shutdown） |
| `local-macos` | 手元のMacで `job-run` | 0円 | 人 |

- ジョブは40桁の commit を持つ（`actions/checkout` は短縮SHAを解決しない）。実行側は `git rev-parse HEAD` の完全一致と clean を確かめ、実際の HEAD を結果に記録する
- Mac mini の守り（保守窓の確認・資源の確認）はジョブの記載ではなく**その Mac の印**でも効く：環境変数 `ENEXUS_RUNTIME_NODE=mac-mini` か `~/.enexus/runtime-node-mac-mini` があれば、実行先が `local-macos` のジョブでも必要（印を置くのは Mac の設定の変更なので Human）
- 結果（`result.json`＋`captures/<デバイス>/<言語>/<画面>.png`）は jobId・commit・デバイス・画面・sha256・寸法（短辺320px以上）・撮影環境がジョブと一致したものだけ取り込む。撮影元は常に `ios-simulator`。取り込みは状態を先に確かめ、終わった・失敗したジョブには副作用の前に断る
- 実行側は結果を書く前に、出力先・ホームのパス・IP・ホスト名を伏せる（公開repoの成果物になり得るため）。取り込み側も同じ検査で拒否する
- 撮影環境（macOS・Xcode・シミュレーターのランタイム・ランナーの種類）を `captures.json` の各撮影に残す。**ホスト名・IP・ホームのパスは結果に入れない**（入っていたら取り込まない）
- `draft` のジョブは撮れなかった画面があっても取り込むが、**`compose --mode final` は draft のジョブの撮影を使わない**。`final-candidate` のジョブは全画面が揃わないと取り込まない。final の判断と提出は人が行う
- 取り込みは1回に1デバイス（`--device`。既定はジョブの最初のデバイス）で、別のデバイスの撮影がある run へは入れない（今の合成は画面×言語で1枚を選ぶため）。Web版の撮影との照合は同じアプリの全ての run と行う
- `job-fetch` は run id ごとの `result-run<id>/` へ取得する（再実行の結果を混ぜない）。取得の前に、run の workflow・起動の種類・branch・commit が依頼の記録（`status.json` の `ci`）と一致することを `gh run view` で確かめ、`run.json` に残す。限界：結果の中身（commit・撮影元）は実行側の申告で、署名付きの証明（attestation）までは使っていない
- 撮影の後は `job-cleanup --execute` で専用branchを消す（push が無ければ workflow は起動しない）。成果物の保存は3日で、テスト用のデータDBは成果物に入れない
- 取り込みは、GitHub の実行先では job-fetch が照合して残した run.json があり、結果の run id と一致し、run が成功した時だけ。**別の画面が同じ画像なら拒否する**（2026-11-21 の2回目の実行で、ディープリンクの確認の窓「Open in …?」が2画面に写り、sha256・寸法の検査は通っていた）。撮影の前にシミュレーター内で独自スキームを承認して窓を出さない（Apple の文書に無い設定・Expo CLI も同じ値を書く）
- 1画面だけのジョブでは「同じ画像」の検査が効かないので、取り込んだ画像を人が目で確かめる
- 同じ名前のシミュレーターが複数のランタイムにある時は、版の新しい1台（UDID）を選んで撮り、そのランタイムを記録する。撮る前にシミュレーター内のアプリへ権限を与え、確認の窓が写らないようにする
- Mac での実行には、シミュレーター向けにbuildしたアプリ（`.app`）が要る（`--app`。`npx expo run:ios --configuration Release` 等。EAS Build は使わない）

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
