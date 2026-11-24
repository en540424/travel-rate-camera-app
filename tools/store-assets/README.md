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
| `engine/drivers/interact.mjs` | 入力・タップが要る画面の操作（Maestro のフローを作る。許可した命令だけ） | 共通 |
| `engine/specs.mjs` | 出力先の寸法・形式（Apple・Google・SNS・広告・LP） | 共通 |
| `engine/provenance.mjs` | 撮影元と掲載内容の規則（下記） | 共通 |
| `engine/templates.mjs` | 合成のHTMLテンプレート（用途ごとの配置・色調。下の「デザインの設定」） | 共通 |
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

5. **入力・操作が要る画面は、操作の後の撮影だけを使う。** `capture.screens[].interact` を持つ画面（例：換算の金額の入力）は、
   操作と表示の確認（`expectVisible`／`expectNotVisible`）が通った撮影（`interacted: true`）だけを合成に使う。操作の前の撮影（金額 0 等）は使わない。
   撮影には操作の設定の指紋（`interactHash`。`$` の注記を除く）を残し、設定（金額・確かめる表示）を変えた後は古い撮影を使わない。
   値を画像処理で後から描き足すことはしない（撮影時のアプリの実際の表示だけ）。
   **限界**：`plan-ios`（人が Mac で流す手順）と `import` では操作の後の撮影を作れない（`import` は印を付けない）。操作の要る画面はジョブ（`job-run`）で撮る。
6. **撮った画面の内容を確かめる。** `capture.screens[].expectVisible`／`expectNotVisible`（含むで照合）を書いた画面は、全ての撮影の後に開き直して
   Maestro で確かめ、撮影ごとに `verified: true|false` を残す。合成は `false`（期待する表示が無かった：空のカレンダー・違う画面）だけを外す。
   `true` は「確認が通り、かつ確認の時の画面が撮影と同じ」時だけ（撮影が読み込み途中で後から表示された時は同じにならず「未確認」）。
   `false` は表示の確認そのものが通らなかった時だけ（道具の接続の失敗等は「未確認」で、撮影は外さない）。
   確かめられなかった撮影（道具が無い・前の版の撮影）は使い、一覧に「機械で未確認」と注記する。確認は撮影の後なので、失敗しても撮れた画面は失わない。
   iOS では押せるカードが中の文字を1つの読み上げにまとめるため、画面の確認は「含む」で照合する（操作の画面の確認は全体一致）。
7. **画面ごとに使える撮影元を絞れる。** `shots[].sources`（例：カメラの画面は `["device"]`＝実機だけ。シミュレーターには実カメラが無い）。

## デザインの設定（profile.json。エンジンはアプリの色・文言を持たない）

| 設定 | 値 | 効果 |
|---|---|---|
| `disclaimer.<言語>` | 40文字以内 | 全ての出力の右下に小さく入る注記（例：画面の金額・レートは表示例＝見本の固定レートを実際のレートと取り違えないように） |
| `brand.icon` | 設定ファイルからの相対パスのPNG | 広告のアプリ名の横にアイコン（無ければ色の四角） |
| `brand.deep`・`deepAlt`・`onDeepAccent`・`warm`・`accentSoft`・`accentText` | 色 | 色調 `deep`（濃い背景に白文字）・`warm`（暖色の淡い背景）の色 |
| `shots[].tone` | `light`／`deep`／`warm` | ストア用の背景の色調（続けて並べた時のメリハリ） |
| `shots[].caption.<言語>.label` | 文字 | 見出しの上の小さなラベル |
| `shots[].callout` | `{ rect:[x,y,w,h]（撮影に対する0〜1の比）, device:'測った端末' }` | 実画面の一部を端末の上に重ねて大きく見せる。**撮影の等倍を超えて拡大しない**。`device` と違う端末の撮影には重ねない（位置がずれるため。一覧に注記）。表示の行数が変わる画面（例：6週の月のカレンダー）は採用前に目視 |
| `storeSets[]` | `{ id, title:{<言語>}, shots:[{ shot, reason:{<言語>} }] }`（1〜10件） | ストア用の出力のうち、提出の候補として並べる順と理由。画像は複製せず出力の部分集合を指す。`index.html` の先頭に順番・理由つきで並び、`manifest.storeSets` に出力先・言語ごとのファイルと sha256 が残る。作れなかった shot は一覧に出し、`final` では問題にする |
| `ads[].layout.<出力先>` | `split`（LP）／`banner`（横長）／`square`（SNS）／`story`（縦長） | 用途ごとの配置。省略時は出力先の形から決める |
| `ads[].tone.<出力先 or default>` | `light`／`deep`／`warm` | 広告の色調 |
| `ads[].shots` | 優先順の候補 | 撮影のある候補を先頭から使う（`split`・`story` は2台、他は1台・`maxPhones` で1〜2）。1台も無ければ作らない。使えなかった候補は manifest の `notes` と一覧に残る（文言と画面の対応は人が確かめる） |
| `ads[].points` | `[{ text: {<言語>}, features: [...] }]` | 要点の箇条書き。**それぞれ公開済みの機能を根拠に持ち、その根拠は広告の `features` に含める**（設定の読み込みで検査） |
| `capture.screens[].interact` | `{ driver:'maestro', steps, expectVisible, expectNotVisible, timeoutSeconds }` | 撮る前の操作。`steps` は `tapOn`・`inputText`・`eraseText`・`hideKeyboard`・`waitForAnimationToEnd`・`scroll`・`swipe` だけ（`launchApp` 等は不可） |

| `ads[].layout.<出力先>: flow`＋`ads[].steps` | `[{ shot, rect?:[x,y,w,h], text:{<言語>}, features:[...] }]`（2〜4件） | 手順の流れ（例：値札を撮影 → 商品価格を読み取り → 日本円で確認）。手順ごとに実際の撮影の一部（rect・省略で全体）を**全ての手順で同じ縮尺・等倍以下**で並べる。画素は変えず、撮影に無い表示を描き足さない（番号・手順の文言・矢印だけが画面の外の説明）。手順の撮影が1つでも無ければ作らない。手順の文言も公開済みの機能が根拠で、広告の `features` に含める。LP・広告用で、App Store 用には使わない |
| `$extends` | 同じフォルダの設定ファイルの名前 | 継承元を読み、ここに書いた最上位の項目だけを置き換える（深い併合はしない・1段だけ）。例：`apps/tabirate/profile-hawaii.json` は `capture` だけを持ち、見出し・並び・広告は `profile.json` が正（二重に持たない）。ジョブは作った時の設定の場所（`job.profile`）を CI でも使うので、撮影・取り込み・合成を同じ設定で行う |

### ステータスバーを揃える比較（`compose --crop-top 0.06`）

全ての撮影の上端を同じ割合だけ**表示の枠で隠す**（0〜0.12。撮影の画素・sha256 は変えない）。実機（時刻・電池が撮影ごとに違う）とシミュレーター（9:41・満充電）の混在を目立たなくする比較用。
callout は隠した分だけ位置を上げて同じ場所を指す。割合は manifest の `presentation.cropTop` と各出力の `cropTop` に残る。
現状版と同じ run・出力先に入れると1サイズ10枚の上限を超えるので、**別の run で作って比べる**。採用は Human。
0.06 は iPhone 17 Pro Max（1320×2868）・実機（1206×2622）の両方でステータスバーと Dynamic Island を隠し、アプリの見出し（例「ハワイ旅行」）を欠かない値（第9回の目視）。

見出し・補足は `［…］` で強調、`\n` で改行（補足も同じ）。文節での改行（`word-break:auto-phrase`）は `localeTags` の言語の指定が要る。
描画に使われたフォントは出力ごとに manifest の `fonts` に残る（実行するマシンで変わる。Windows では Noto Sans JP、Mac ではヒラギノ）。

### 前の run の撮影から作り直す（新旧比較）

```bash
npm run store-assets -- derive --profile <p> --from <前の run> [--run <新しい run>]
```

前の run の撮影を sha256 で照合して新しい run へ複製し（撮影元・ジョブ・GitHub の run の記録を引き継ぎ、`copiedFrom` を付ける）、合成する。
前の run は読むだけで変えない。新しい run の `compare.html` に出力先ごとの新旧が並ぶ。テンプレート・文言を直した時に撮り直さずに確かめる用途。

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

### 実機の撮影を取り込む（カメラ・ライブ翻訳など、シミュレーターで撮れない画面）

カメラの OCR・スマートカメラ・ライブ翻訳・翻訳の結果はカメラか端末内の翻訳を使うので、**実機で人が撮る**（シミュレーター・CI で作らない・似せた画面を作らない）。
`capture.screens` に deepLink の無い画面（例 `smart-camera`・`live-translation`）として置き、`shots[].sources: ["device"]` で実機の撮影だけを受ける（ジョブには入らない）。

```bash
# 原本は変えない：コピーを画面IDの名前（camera.png・smart-camera.png・translation.png 等）にした別のフォルダから取り込む
npm run store-assets -- import --profile <p> --run <run> --from <コピーのフォルダ> --source device --locale ja
npm run store-assets -- compose --profile <p> --run <run> --mode draft
```

同じ画面に実機とシミュレーターの撮影があれば実機を使う（例：`translation` に実機の写真翻訳の結果を入れると、シミュレーターの入力画面より優先）。
実機の撮影は時刻・電池・旅行のデータが撮った時のまま（加工しない）。シミュレーターの撮影（9:41・満充電）と揃わない点は採用前に人が判断する。

**旅行のデータを実機と揃える（第9回・2026-11-24）**：実機の掲載素材はハワイ旅行（USD・1 USD = ¥163.00）。シミュレーターをハワイで撮るには
`apps/tabirate/profile-hawaii.json`（テストデータ `build-fixture-db-hawaii.mjs`＝`FIXTURE_HAWAII`）でジョブを作る。パリ・EUR（`profile.json`・`FIXTURE`）は既定のまま残し、混ぜない。
ハワイの見本は被写体の価格表と実機の画面に写っている品目・金額・名前だけで作り（根拠は `build-fixture-db.mjs` の注記）、円の金額はアプリの換算（`convert`）で保存する。
画面の確認の期待値（残り予算・月合計・換算の結果）は `fixture.test.mjs` がアプリの関数（`sumBudgetTotals`・`formatJpy`）と照らして固定する。

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
- build の前に、Expo の事前コンパイル版（`node_modules/<pkg>/prebuilds/…/xcframeworks`）どうしの記号の参照がそろっていることを確かめる（`npm run check:native-abi`。workflow でも `npm ci` の直後に実行）。2026-11-23 の4回目で、アプリがホーム画面のままだった原因は **起動の瞬間の dyld「Symbol missing」** と分かった：`expo-location` 56.0.26 の事前コンパイル版が `expo-modules-core` 56.0.26 の記号を参照し、入っていたのは 56.0.13。build は通り、シミュレーターで起動の瞬間に落ちる（実機の版も同じ参照を持つため、実機でも落ちると強く推定。実機では未確認。2・3回目は同じ lockfile・同じ事前コンパイル版の組み合わせからの強い推定。クラッシュの記録が残っているのは4回目）。`expo-location` は SDK の対の版 56.0.14 に固定した（ネイティブのパッケージの版を上げる時は、この検査を必ず通す）
  - 検査の範囲は**事前コンパイル版どうし**の参照だけ（参照先は Mach-O に記録された参照先ライブラリで決める。Swift 以外の記号も対象）。ソースから build する Pod（ExpoModulesJSI 等）・React Native 本体・システムへの参照は「範囲外」として件数だけ出し、確かめない。読めない・参照先に同じスライスが無い・参照先のライブラリを決められない参照がある（flat namespace 等）・同じ名前の事前コンパイル版が複数ある時は終了コード 2 で止める（黙って通さない）
  - 2026-11-23 の5回目（`389990f`・run 45096625839）で、macOS の runner でも検査が OK を出し、アプリは試しの起動・本番の起動とも10秒以上動き続け、**初めて実際のアプリの画面を3枚（履歴・カレンダー・換算）撮れた**（CI の iOS シミュレーターでの確認。実機は未確認）。テストデータの記録の日付は撮影する日の月に入るよう、作る時に決める（シミュレーターは実行するマシンの時計で動き、カレンダーは今日の月を開くため。日付を固定すると月が変わった後に空のカレンダーを撮ってしまう）。残るリスク：テストデータを作ってから本番の起動まで約15分あり、その間に runner の日付が月をまたぐと（runner は UTC＝日本時間で毎月1日の 9:00 が境目）カレンダーが空のまま撮れる。月の1〜4日に撮ると今日より後の日付の記録が写る。どちらも採用前の目視で確かめる。範囲外の参照先（ExpoModulesJSI・React Native・hermes）は TestFlight で動いている main と同じ版
  - EAS Build での利用（**未導入・Human 判断**）：EAS の npm フック `eas-build-post-install`（iOS では `npm install`・prebuild・`pod install` の後に動く。`EAS_BUILD_PLATFORM` で iOS だけに絞れる）から `node tools/native-check/expo-prebuilt-abi.mjs` を呼べば、不整合のある版を実機向けに build する前に止められる。本番の build の流れを変えるので、入れるかどうかと、終了コード 2（確かめられない）を止めるか警告に留めるかは Human が決める。入れるまでは、EAS build の前に手で `npm run check:native-abi` を流す
- **前の画面を写した撮影は、同一画像の検査をすり抜ける**（第6回のカレンダー：遷移が間に合わず旅行一覧を写した。ホーム画面でも別の画面と同じ画像でもないので、生死・同一画像の検査は通る）。検出したのは撮影後の内容の確認（開き直した時の画面が撮影と違う＝`unavailable`）だけで、未確認の撮影は合成に使われてしまっていた
  - **`job-ingest` が見た目の近さを比べる**（2026-11-23 追加）：同じ端末・言語の別の画面どうしで、違う画素の割合（上端6%＝ステータスバーを除き、RGB の差が16を超える画素）が **0.5% 以下**なら「前の画面を写した可能性」とし、片方だけが撮影後の確認を通っていれば（`verified:true`）もう片方を、決められなければ両方を `verified:false`＋`reviewNote`＋`nearDuplicateOf` にして合成から外す（致命にしない・画像は取り込む・`ingest.json` の `nearDuplicates` に残す）。実測：第6回のカレンダー〜旅行一覧は 0.000%、別の画面どうしは 17% 以上、第5回の3枚は該当なし。8bit 以外の PNG・寸法の違う組は比べない
  - 合成の「作らなかったもの」には、撮影記録の `reviewNote`（外した理由）が出る（機械の確認の定型文と読み違えないように）
  - 第6回の取り込み先 run の除外は、この検査の前に人が目視で付けたもの（同じ形の記録）
  - 限界：見出しだけが違う別の画面は 0.5% を超えるので見つからない（その場合は撮影後の内容の確認が頼り）。1画面のジョブは比べる相手が無い（撮り直しは2画面以上で）
- 撮影の前後にアプリが動いていることを確かめる（2026-11-21 の3回目の実行で、アプリが前面に無いままホーム画面を2枚撮った。原因は上の版の不整合）
  - 起動の後10秒、ホスト側のプロセス番号で生死を確かめる。テストデータを入れる前にも一度試しに起動し、「アプリ・実行環境の問題」か「テストデータの問題」かを同じ実行で分ける
  - アプリを止めた後のホーム画面を基準として撮り、同じ画像の撮影は `*.rejected.png` へ移して止める
  - 止まる時は終了コードと理由（`result.json` の error）を残し、診断（負荷・launchd の記録・シミュレーターのログ・このアプリのクラッシュの記録の要点・その時点の画面 `_diag-N.rejected.png`）を出す。終了コード：20 ビルドしたアプリ（main.jsbundle・Bundle ID）／21 起動の命令／22 起動の後に動いていない／23 撮影の前後に動いていない／24 ホーム画面と同じ／25 試しの起動を止められない／26 基準が静止しない（1画面のジョブ）／27 画面を開く・撮る命令の失敗
  - 機械で防げないもの：アプリは前面にあるが中身が違う画面（スプラッシュ・存在しない画面・アプリの上の窓）。取り込んだ画像は人が目で確かめる
- 入力・操作が要る画面（`interact`）は、workflow が版と sha256 を固定して入れる Maestro CLI（2.12.1。GitHub の release の zip。インストール用のスクリプトは流さない・統計の送信と更新の確認は止める）で操作する（2026-11-23 追加。**第6回（run 45169001221・`f14724e`）で CI の iOS シミュレーターでの実動作を確認**：Maestro 2.12.1 が入り（Java 21・sha256 一致）、換算は 89 を入力して「¥14,685」を確かめて撮れ、7画面中6画面の撮影後の内容の確認が ok）
  - 撮影の順は「操作の無い画面 → 操作の要る画面」。操作の要る画面の失敗（道具が無い・準備の失敗・操作や表示の確認が通らない・時間切れ・撮った後の確認）は**致命にせず**、その画面だけ撮らずに `result.json` の `skipped` に理由を残して続ける（1画面の操作の失敗で、撮れていた画面まで取り込めなくなるのを防ぐ。アプリの生死・ホーム画面との一致の検査は今までどおり致命）
  - 操作はディープリンクで開いた、動いているアプリにだけ行う（`launchApp` は使えない）。操作の後もアプリが同じプロセスで動いていることを確かめる
  - 操作と表示の確認が通って撮れた時だけ、シェルが印（`IOS_DONE_FILE`）を書く。`job-run` は印のある画面だけを `interacted: true`（＋設定の指紋）として記録し、印の無い・飛ばした画面の画像（前の試行の残り等）は数えない。撮る前に前の画像を消す
  - 操作の途中・後にアプリが落ちた時は、致命にはしないが診断（クラッシュの記録・ログ・その時点の画面）を出す（道具の失敗と取り違えない）
  - 画面を開くのはシェルの `simctl openurl`（シミュレーター内で承認済みの経路）。フローの `openLink` は使わない（Maestro の経路で確認の窓が出るかは未確認）。道具の起動でアプリが前面から外れるかは CI で未確認（外れれば確認が通らず、その画面は飛ばす／未確認になる）。道具の起動の待ちは `MAESTRO_DRIVER_STARTUP_TIMEOUT`＝5分（workflow）
  - 道具の準備が一度失敗したら、同じ実行の中では試し直さない（画面ごとに最大7分を繰り返して実行の上限に達し、撮れた画面まで失うのを防ぐ）
  - 設定の値は命令ごとに形を検査する（`inputText` に `${`（Maestro が JS として評価）を入れない・確かめる表示は配列 等）
  - ホーム画面の基準が静止しない時に続けてよいかは、操作の要る画面を除いた画面の数で決める（操作の画面は飛ばされ得るため）
- 撮影は `capture.screens` の並びの順にディープリンクを開く（操作の要る画面は最後）。**アプリで modal の画面の後に通常の画面を置かない**：動いているアプリへのディープリンクは、タブを持つ画面なら上の画面を閉じて戻るが、通常の画面は今の画面の上に足され、modal の後なら modal の上のシートとして表示される（利用者が見る全画面の表示と違う。入っている expo-router 56.2.7 の native-stack の実装で確認・**実機・シミュレーターでは未確認**）。旅レートカメラは `rate-setup` が modal なので、操作の無い画面の最後（タブの画面の直後）に置き、`apps/tabirate/fixture.test.mjs` がアプリの `_layout.tsx` と照らして検査する（2026-11-23・第6回の前の事前検収で並びを直した）
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
