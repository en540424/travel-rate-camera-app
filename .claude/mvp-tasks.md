# 旅レートカメラ MVP残タスク管理 2026-07-01

## 現在地（2026-09-11現行化・最新）

> 本節が現在地の正。以下の「現在の開発フェーズ」以降は2026-07-01〜08時点の履歴で、完了済み項目を未完へ戻さない。

**フェーズ：App Store初回リリース直前。コード側のrelease-critical修正は完了し、次回Preview Build＋実機/Sandbox確認待ち。**

- **Fable 5.1第三者監査（high）完了**、**Codex独立監査完了**（対象HEAD `dbd99ce`。両者B条件付き合格・S0なし・S1 3件で一致。記録：Vault `AI-Workflow-System/07_project-kits/tabirate-camera/Codex独立監査1_旅レートカメラApp Store初回リリース前最終監査結果_2026-09-11.md`）
- **S1／S2統合修正完了**（app `dbd99ce`→`8b145c5`、12 commits。Privacy/Legal整合・Pro比較画面の矛盾・復元gate・Offering再取得・購入後entitlement確認・保存/旅行作成の連打lock・写真整合・全件集計・STT/TTS race・v3 migration transaction化）
- tests：`npx tsc --noEmit` pass／`npm test` **331 pass / 0 fail**／lint 20 problems（16 errors / 4 warnings、既存baseline）
- app HEAD `8b145c5`（`feat/design-sync-v2-main`、push済み）→ 本ファイル更新を含む文言整合commitが続く。LP `01e0588`（`master`、push済み。Vercel自動デプロイ想定）
- **Privacy／Terms現行化済み**（LP `01e0588`。Pro・自動更新・解約・RevenueCat・音声認識を明記）
- **Product Hub反映済み**（`app_tabirate-camera`。送信箱→Hub画面の更新ボタンで反映）
- **仕様確定（2026-09-11 Human判断）**：
  - **保存上限10件は「1つの旅行につき10件」**（旅行ごと。端末全体ではない。現行実装`getHistoryCountForTrip`と一致。ロジック・`FREE_LIMITS.saves`は不変。A案採用）
  - **無料版の旅行数は「同時に管理できる旅行1件」**（非アーカイブ数で判定。アーカイブ後の新規作成・復元は同じ境界。累積1件ではない）（**→2026-10-20に「記録中の旅行1件・終了した旅行はFreeで再開不可・閲覧のみ」へ更新**。続報5参照）
  - Pro：保存無制限・複数旅行を同時管理・カテゴリー絞り込み/分析・CSV
  - **価格：月額¥500／年額¥4,000**（自動更新・買い切りなし。アプリ内は`priceString`表示。**App Store Connect／RevenueCatの実設定がこの値になっているかはHuman確認**。以前の記録にある¥400/¥3,000・¥480/¥3,800は旧価格）
  - UI文言を上記へ整合済み（`SaveLimitBanner`／`SaveLimitSheet`／`CurrentPlanCard`／`pro.tsx`／`pro-features.tsx`／`help.tsx` FAQ追加）
- **【2026-09-12更新】Preview Build完了**：Build ID `fa58940a-03c5-4d70-8d4b-16bc588cc1a5`／対象commit `ba2153a`／status FINISHED／app 1.0.0・buildNumber 1・SDK 56.0.0。install：https://expo.dev/accounts/en540424/projects/travel-rate-camera-app/builds/fa58940a-03c5-4d70-8d4b-16bc588cc1a5
- **次のアクション（Human）**：上記Buildを実機へinstallし、`TEST_CHECKLIST.md`（54項目）で実機/Sandbox確認。**このBuild以外で確認しない**（旧Build `4f6ef24b` には17commit分の監査統合修正が未搭載。OTA未使用）
- **【2026-09-18更新】既知不具合修正1件（`df4afeb`・未push）**：履歴編集（`item-edit.tsx`）で金額欄が空・0・非数値のまま保存すると、金額だけ黙ってスキップしメモ等は保存して画面が閉じていた不整合を修正（保存前に`utils/edit-amount-core.ts`で判定し、不正ならDBへ書かずAlertで留まる）。`npm test` **336 pass**（+5）／tsc pass／lint baseline維持。**Build `fa58940a`には未搭載**のため、次回Preview Buildの実機確認項目（不正金額→Alertで留まる／正しい金額で全項目反映／メモのみ変更で従来どおり保存）へ追加する。次回コード側候補：写真削除5か所が`resolveImageUri`を通していない（コンテナUUID変更後の孤児file）。記録：Vault `02_Development-Logs/2026-09/2026-09-18_旅レートカメラ_既知不具合修正_履歴編集の不正金額サイレント破棄_開発ログ.md`
- **【2026-09-18更新】既知不具合修正2件目（写真file削除の`resolveImageUri`未経由・未push）**：写真fileの削除5経路（`item-edit.tsx`写真差替後の旧file削除・記録削除／`item-detail.tsx`記録削除／`calendar.tsx`記録削除／`data-management.tsx`全削除）がDBの生URIを`deleteAsync`へ渡しており、iOSコンテナUUID変更後は到達できず孤児fileが残っていた。`utils/resolve-image-uri-core.ts`（純ロジック）を抽出し、`utils/resolve-image-uri.ts`に`deleteStoredPhotoFile()`（解決→`deleteAsync` idempotent）を追加して5経路を統一。`cleanupCreatedFiles`（同セッション作成の下書きfile）は現在コンテナ生成のため対象外のまま。DB削除→file削除の順序・`catch {}`・web guardは不変。`npm test` **344 pass**（+8）／tsc pass／lint 20（16/4）維持／`expo export --platform ios` pass。**Build `fa58940a`には未搭載**（実機確認項目#56）。commit `a68b674`。記録：同上Vault 09-18ログへ追記（§11）
- **【2026-09-18更新】既知不具合修正3件目（小数JPYのサイレント書き換え・未push）**：JPY旅行の金額入力（`index.tsx`/`index.web.tsx`/`converter.tsx`）が`decimal-pad`＋`parseFloat`で小数JPY（`jpy_amount=1200.5`）を保存し得る一方、履歴編集は`parseInt`で評価していたため、既存の小数JPY記録でメモだけ保存しても金額が1200へ黙って書き換わっていた。JPYの丸め規則はrepo全体で`Math.round`（`formatJpy`・`budget-core`・SQL `ROUND`）と確定し、`edit-amount-core.ts`のJPY分岐を`parseFloat→Math.round`＋現在値も丸めて比較へ統一（既存小数行は金額を触らなければ書き換えない・migrationなし）。新規保存側は`utils/currency.ts`の`normalizeJpyInput`でJPYモードのみ整数円へ正規化し、金額欄をJPYモードで`number-pad`に。外貨記録の`jpy_amount`（`toJpy`）は丸めない。`npm test` **354 pass**（+6）／tsc pass／lint 20（16/4）維持／`expo export --platform ios` pass。**Build `fa58940a`には未搭載**（実機確認：JPY欄がnumber-pad／小数JPY既存記録のメモのみ保存で金額不変／外貨38.5の小数保持）。記録：同上Vault 09-18ログへ追記（§13）。commit `68e8e13`・`0caa595`
- **【2026-09-18更新】既知不具合修正4件目（CSV exportの既存小数JPY行・未push）**：§13-11で軽微候補としていた「既存小数JPY記録（`jpy_amount=1200.5`）がCSVでは生値、画面では¥1,201」を判定。CSV（`lib/csv-export-core.ts buildHistoryCsv`）は既にcategoryラベル化・購入済み/候補文言・日本語見出し・BOM等の人間向け変換を行う**ユーザー向けexport**であり、JPY建て記録の整数円仕様（`Math.round`）と矛盾するため**修正**。`currency==='JPY'`の行だけ元金額・換算金額(円)を`Math.round`（JPY記録は`foreign_amount`にも同じ円が入るため両列）。外貨記録は元金額・換算円・レートとも生値のまま不変（内部換算値の契約維持）。header/列順/CRLF/BOM/quote/null handling不変・migrationなし・`csv-export-service.ts`不変。`npm test` **362 pass**（+8）／tsc pass／lint 20（16/4）維持／`expo export --platform ios` pass。Human実機確認は必須ではない（自動testで契約固定）。記録：同上Vault 09-18ログへ追記（§14）
- **【2026-09-18更新】既知不具合修正5件目（analytics／calendarの2000件窓・未push）**：09-11ログで「別工程」としていた候補Cを判定→**バグ**（ケースB＋C）。`useAllHistory()`が全旅行の履歴を`LIMIT 2000`（`created_at`順）で取得し、分析の合計・グラフ・旅行別・カテゴリー別とカレンダーの日付マップ・月合計をその配列からJS集計していたため、2001件目以降が黙って欠けていた（実SQLite再現：2500件で古い500件分が消える）。修正は「画面が見る期間だけ取得」：`utils/history-date-core.ts`（純粋関数・日付キー/期間range/SQL広め条件）を新設し、`getHistoryInDateKeyRange`（LIMITなし・`created_at`は前後1日広め＋画面側`rowToDateKey`厳密絞り込みで日付割り当て不変）を`useAllHistory({ dateRange })`から呼ぶ。分析＝今日/月/年、カレンダー＝表示月。`dateRange`なしの呼び出し（旅行一覧・切替シート・旅行編集）は行を読まなくなる。DBスキーマ・migration・保存・500件表示窓・CSV・budgetTotals不変。`npm test` **376 pass**（+14）／tsc pass／lint 20（16/4）維持／`expo export --platform ios` pass。Human実機：大量データ不要、次回Preview Buildで分析・カレンダーの期間切替を通常確認。**Build `fa58940a`には未搭載**。記録：同上Vault 09-18ログへ追記（§15）
- **【2026-09-19更新】既知不具合候補判定6件目（外貨記録のCSV換算金額(円)が生値・未push）**：§14-11/§15-12で「Human判断」としていた「外貨record（例 `38.5 USD × 155.3 = 5979.05`）の換算金額(円)がCSVで小数のまま → Excel SUMとアプリ合計が不一致になりうる」を判定→**仕様どおり（バグではない・コード変更なし）**。根拠：外貨`jpy_amount`は`toJpy`（丸めない）の内部換算値で整数円仕様が無い／アプリ内集計は2系統（残り予算＝行ごと`Math.round`・`SUM(ROUND())`、分析・カレンダー＝生値SUM→`formatJpy`）で一意の正本が無く、CSVをどちらに寄せても他方とずれる／CSVの責務は「保存履歴の書き出し」で合計一致の約束は文言・docsに無い。`csv-export-core.test.mjs`に契約test +3（外貨は丸め境界でも生値・列SUM＝生値合計で行ごと丸め合計と1円ずれるのは既知・JPY混在でも丸めはJPY行だけ）。`npm test` **379 pass**（+3）／tsc pass／lint 20（16/4）維持／`expo export`はruntime変更なしのため未実施。Human実機確認不要。記録：同上Vault 09-18ログへ追記（§16）
- **【2026-10-05更新】スマートカメラ・写真翻訳・翻訳タブのリアルタイムカメラ翻訳を実装（Human実機確認待ち・未push）**：Human決定の3役割を追加従量課金なし（端末内Apple Vision＋Apple Translationのみ・有料API/クラウドなし）で実装。①**メインカメラ**：向けるだけで商品名・短文の翻訳と価格の現地通貨額・**約¥（既存`convert`＋旅行レート）**をカメラ枠下部に最大3件表示（左上でON/OFF・端末保存・既定ON。JPY旅行は非表示）。**シャッター→価格OCR→金額確認→保存は不変**（`recognizeText`/`handleScan`/`extract-prices.ts`は差分0）②**翻訳タブ**：入力方法「テキスト・音声／写真／カメラ」。写真＝撮る/選ぶ→静止画OCR（既存vision-ocr）→段落分割→翻訳（読み上げ・コピー・原文を編集）、カメラ＝元の文字位置へ訳を重ね＋一覧、シャッターで写真翻訳へ。方式：新local module `modules/live-text`がexpo-cameraのsessionへ映像フレーム出力を1つ追加し約1秒ごとにVision認識（定期takePictureは日本のiPhoneでシャッター音が消えないため不採用・撮影経路には触れない）。翻訳は同時1要求の単一キュー＋LRU、未導入言語は自動送信せず「タップでダウンロード」。native翻訳coordinatorへdrain中の再設定ガード追加。メインカメラは他タブ表示中にsessionを止める（`active`）。権限文言（カメラ・写真）を翻訳用途込みへ更新。tsc pass／`npm test` **432 pass**（新規53）／lint 20（16/4）baseline維持。実機確認項目`TEST_CHECKLIST.md` **#57〜#65**。詳細はVault `02_Development-Logs/2026-10/2026-10-05_旅レートカメラ_スマートカメラ・写真翻訳・リアルタイム翻訳実装_開発ログ.md`。commit `a3f351a`（native）・`2f3218c`（機能）＋本docs commit（すべて未push）。**Preview Build `50bc4f55-bf0c-414d-8b7c-d61f4ce9207f`**（**FINISHED**・対象commit `2f3218c`・ARCHIVE SUCCEEDED・LiveText/翻訳coordinatorのSwift警告0・IPA内の権限文言と`LiveTextModule`組込みを確認）。install：https://expo.dev/accounts/en540424/projects/travel-rate-camera-app/builds/50bc4f55-bf0c-414d-8b7c-d61f4ce9207f 。**`fa4b3f8f`は実装途中のコンパイル確認用なのでinstallしない**。`50bc4f55`は`be61a603`の内容（正式icon・09-18〜19修正13 commit）を全て含むため、#52・#55・#56もこのBuildで確認してよい。価格OCRの不調が出たら#59のON/OFF比較で原因（今回の機能か既存ahead分か）を切り分ける。次（Human）：#59→#57・#58→#62・#63→#65の順に実機確認 → push判断（force不可）
- **【2026-10-20更新】保存前写真プレビュー改善実装済み・Human実機確認待ち（未push）**：`50bc4f55`の実機確認で「保存前の写真が小さく、どの範囲が保存されるか分からない／保存後と見える範囲が違う」と判明。原因は**表示だけ**（保存は撮影画像を`copyAsync`するだけで crop/resize なし＝保存されるのは常に写真全体。一方、表示は「読み取った値札」＝110ptの帯で中央約1/4、「履歴に残す写真」＝72×72正方形、商品詳細＝220ptの帯coverと3通りに切り抜いていた）。**保存データ・撮影・価格OCR・保存処理は不変**のまま、表示を写真全体（contain）に統一：「読み取った値札」は画面比例160〜220ptで全体表示＋写真タップで拡大、「履歴に残す写真」は120×160で全体＋「左の写真全体がそのまま保存されます。タップで拡大」、商品詳細の大判写真（220pt枠）はcontain。独立UIレビュー指摘で、写真がある時の余白を`color.dark`にして写真の端（＝保存範囲の端）を見分けられるようにし、同じ流れの比較サムネ・履歴編集の保存写真サムネも正方形切り抜き→全体表示に揃えた。拡大は既存Modalを再利用。新規`utils/photo-preview-layout.ts`（＋test 4件）。tsc pass／`npm test` **436 pass**／lint 20（16/4）baseline維持。commit `d57e4f2`・`1ec8f02`（未push）。実機確認`TEST_CHECKLIST.md` **#66**。**Preview Build `7fa16f73-3d49-4b01-a6d6-b5fd080bf19d`**（**FINISHED**・対象commit `1ec8f02`）。install：https://expo.dev/accounts/en540424/projects/travel-rate-camera-app/builds/7fa16f73-3d49-4b01-a6d6-b5fd080bf19d 。**`d05bd6b7-66f6-45cb-9148-a2c3a6f2937f`（`d57e4f2`・FINISHED）は追加修正前なのでinstallしない**。詳細はVault `02_Development-Logs/2026-10/2026-10-20_旅レートカメラ_保存前写真プレビュー改善_開発ログ.md`。→ **同日の続報で比率を再調整（次項）。`7fa16f73`は比較用でinstallしない**
- **【2026-10-20続報】写真プレビュー比率再調整済み・Human実機確認待ち（未push）**：`7fa16f73`の実機確認で「写真全体は見えるが、固定の横長枠にcontainで収めたため縦撮り写真の左右に大きな暗い余白が出て、写真が細く小さく見える（撮影結果画面・商品詳細）」と判明（写真ファイル自体は問題なし）。**枠そのものを実画像の縦横比にする**方式へ変更：共通部品`components/fit-photo.tsx`（`FitPhoto`）が`expo-image`の`onLoad`（向き反映済みの幅・高さ）で縦横比を測り、幅は親の幅いっぱい・高さは面ごとの上限で止める。写真は引き続き`contain`（切り抜かない）。上限は`utils/photo-preview-layout.ts`の面ごとの表に集約（撮影結果＝画面高×0.36〔230〜340pt〕、商品詳細＝×0.48〔300〜440pt〕、履歴に残す写真136×180、履歴編集72、比較56）。縦撮り3:4はiPhone 15で撮影結果230×307（幅の67%、旧44%）・商品詳細307×409（86%）、SEで180×240・240×320。寸法はDBに無く（DB不変）、測れない間は3:4の枠。写真の端は1pxの線（`color.faint`）。拡大Modal・保存/OCR/撮影は不変。tsc pass／`npm test` **446 pass**（本件14）／lint 20（16/4）baseline・新規0。commit `249977f`・`d3e09fe`（レビュー対応：写真の端の線を写真の上に重ねる・写真差し替え時に読み込み失敗表示を引き継がない）（未push）。実機確認`TEST_CHECKLIST.md` **#66（書き換え済み）**。**Preview Build `004465f7-4588-490b-91c5-669be5e2b23f`**（**FINISHED**・2026-10-20 03:47〜03:53 JST・app 1.0.0 / buildNumber 1・SDK 56.0.0・対象commit `d3e09fe`）。install：https://expo.dev/accounts/en540424/projects/travel-rate-camera-app/builds/004465f7-4588-490b-91c5-669be5e2b23f 。→ **#66（写真の表示）はHuman実機確認OK（`004465f7`）。同Buildで撮り直し写真の保存不具合が見つかり修正（次項）。`004465f7`は以後installしない**
- **【2026-10-20続報2】撮り直し写真保存不具合 修正済み・Human実機確認待ち（未push）**：`004465f7`の実機確認で「撮り直して2枚目を『使う』と選んだのに、金額・メモは2回目なのに写真だけ1枚目が保存される」と判明。原因：「新しい読み取りを使う」と商品写真の撮影（iOSカメラの「再撮影」→「写真を使用」）が、新しい写真を保存対象（`pendingPhotoUri`）へ即反映せず「履歴に残す写真」欄でもう一度選ぶまで候補にしていた（上部「読み取った値札」は新しい写真に切り替わるため、画面では新しい写真なのに保存は古い写真）。修正：写真の5つのstateを1つ（`savePhoto`）にまとめ、遷移を`utils/save-photo-state.ts`の純関数に集約（関数形式で更新）。「使う」と選んだ写真をその場で保存対象にし、保存のコピー元を`photoUriToSave`（＝「履歴に残す写真」の表示）に一本化。例外（意図的）：商品写真・ライブラリ写真を選んでいる／写真を外した後の再読み取りは、黙って置き換えず欄の候補（表示＝保存）。写真を外した後の再読み取りで「前の読み取りを残す」でも新しい写真が保存対象になっていた逆方向の不一致も修正。撮影・読み取り途中で保存が済んだ場合の遅れて届く結果を次の記録へ入れないガード追加。DB・OCR・価格抽出・撮影・FitPhoto/表示レイアウトは不変。tsc pass／`npm test` **462 pass**（本件16）／lint 20（16/4）baseline・新規0。commit `1681ce5`・`e91651c`（レビュー対応：写真を外した後・最初の撮影失敗後の再読み取りが止まる後退を修正）（未push）。実機確認`TEST_CHECKLIST.md` **#67**。**Preview Build `1a0e9573-9c1b-496f-bdca-5c1951fc587b`**（**FINISHED**・2026-10-20 04:41〜04:47 JST・app 1.0.0 / buildNumber 1・SDK 56.0.0・対象commit `e91651c`）。install：https://expo.dev/accounts/en540424/projects/travel-rate-camera-app/builds/1a0e9573-9c1b-496f-bdca-5c1951fc587b 。次（Human）：新Buildで#67（＋#66回帰・未了の#52・#55〜#65）を確認 → push判断（force不可）。→ **#67はHuman実機確認OK**（2026-10-20 Human報告：撮り直して選んだ写真が正しく保存される）。スマートカメラ・リアルタイム翻訳・写真翻訳・写真プレビュー改善もHuman実機確認まで完了（同Human報告）
- **【2026-10-20続報3】分析画面再設計・カテゴリー分析実装済み / Human実機確認待ち（未push）**：分析タブを「無料＝全体としていつ・いくら使ったか」「Pro＝＋何にいくら使ったか」が一目で分かる形に再設計（Human評価「縦棒グラフが簡易的で少しダサい」への対応）。**Free/Pro境界は不変**（カテゴリーの保存＝無料、カテゴリー別の分析＝Pro。`SHOW_PRO && useIsPro()`）。期間は既存の**今日／月／年**を維持（週は追加しない）。順序：期間切替→まとめ（黒ヒーロー`AnalysisSummaryCard`：購入済みの合計を大きく＋購入済み件数・候補合計・保存件数）→縦棒グラフ（無料/Pro共通`SpendBarChart`：目盛り線3本＋きりのいい上端・固定高さの読み取り欄・上角丸の棒・月は横スクロール維持で日付＋曜日・今日強調・今月は今日が見える位置から。色は`chartBar`/`primaryDark`のまま）→Pro：カテゴリー別（`CategorySpendCard`：名前・件数・金額・全体比の横棒・%〔最大剰余法で合計100・<1%〕・未分類は灰色＋説明）→旅行別／無料版：旅行別→カテゴリー別のPro導線（実データを出さない小カード・最下部）。集計は`utils/analytics-core.ts`へ移し1回の走査に（旧useMemo群と同値をoracleテストで固定・購入済み合計＝棒の合計＝カテゴリー合計）。分析画面は旧`DT`→`src/theme/tokens.ts`へ移行。カテゴリー行tapは表示のみ（履歴の絞り込みにroute paramが無く履歴画面は対象外）。新規依存なし・DB/保存/OCR/カメラ/翻訳/履歴/カレンダー/CSV/RevenueCat不変。tsc pass／`npm test` **491 pass**（本件+29）／lint 20（16/4）baseline・新規0／`git diff --check` clean／`expo export --platform ios` pass。独立UIレビュー（must 1・should 8）をBuild前に反映。commit `6ce72c5`（未push）。実機確認`TEST_CHECKLIST.md` **#68**（M節）。**Preview Build `8bf4932a-c82e-4cdd-baf4-e7d5715acd2c`**（**FINISHED**・2026-10-20 09:25〜09:31 JST・preview/internal・app 1.0.0 / buildNumber 1・SDK 56.0.0・対象commit `6ce72c5`）。install：https://expo.dev/accounts/en540424/projects/travel-rate-camera-app/builds/8bf4932a-c82e-4cdd-baf4-e7d5715acd2c 。**LPのモック`AnalyticsScreen.tsx`は旧画面のままで「本体に一致」ではなくなった（LP更新はHuman判断・今回LPは不変）**。詳細はVault `02_Development-Logs/2026-10/2026-10-20_旅レートカメラ_分析画面再設計・カテゴリー分析_開発ログ.md`。次（Human）：`8bf4932a`で#68（無料・Pro両方）→ push判断（force不可）
- **【2026-10-20続報4】Free分析Human確認済み / 目盛り調整済み / Pro実機確認待ち（未push）**：Preview `8bf4932a`でFree版の分析画面はHuman実機確認OK（黒いまとめカード良い・全体が以前よりかなり良い・縦棒は基本的に良い）。指摘の「目盛りが¥4万・¥2万だけで下端や意味が分かりにくい」に対し、`ae98f3f`で**上端・半分・0の3本すべてに金額**（0の線に「¥0」）、上端10万円未満は桁区切りの円（最大33,120円→「¥40,000／¥20,000／¥0」。読み取り欄の「¥33,120」と同じ書き方）、10万円以上は万・半分1億円以上は億（1つのグラフで単位を混ぜない）。上端のnice scale（33,000円→40,000円）・棒・選択表示・土日・今日の強調・横スクロール・棒色・まとめカード・期間切替は無変更。test 493 pass（+2）／lint 20（16/4）＝baseline・新規0。**Pro確認経路**：PreviewはEAS internal＝ad hoc署名。2026-07-11に**同じ配布証明書・同じad hocプロファイル**（`*[expo] com.estep.travelratecamera AdHoc 1780618911100`。ビルドログで照合）のdevelopment BuildでSandbox購入→`pro`有効化を実機確認済みのため、**QA専用Buildもコード側のPro上書きも作らず**、Preview 1本でSandbox確認する。Apple公式文書はad hocを明記していないので、購入シートの「[Environment: Sandbox]」表示を必須の確認点にした（出なければキャンセル→TestFlight判断はHuman）。手順は`TEST_CHECKLIST.md` #69（目盛り）・#70（Pro・Sandbox）。RevenueCatのSandbox Testing Access（Project settings→General。既定Anybody）はHuman確認。**現在のPro専用機能（コード確認）**＝保存件数（無料は1旅行10件）・同時に管理できる旅行（無料1件）・履歴のカテゴリー絞り込み・分析のカテゴリー別・CSV書き出し（今の旅行・最大500件）の5つ。Pro画面/購入画面の「旅行作成数 無制限」「旅行をいくつでも作成」は実際の制限（同時に管理できる数）とずれる文言（Human判断・未変更）。Preview Build `b0d82d7f-47af-443a-b96c-aac650e9df9c`（FINISHED・2026-10-20 10:51〜10:57 JST・app 1.0.0 / buildNumber 1・SDK 56.0.0・preview / internal（既存のad hoc証明書・プロファイルをそのまま使用）・commit `ae98f3f`）。push未実施（Human判断待ち・force不可）。作業ログ：Vault `2026-10-20_旅レートカメラ_分析目盛り調整・Pro実機確認経路_開発ログ`
- **【2026-10-20続報7】App Store提出資料・LPを現行仕様へ追従 / Human確認待ち（アプリのコード変更なし）**：Vault `旅レートカメラ_AppStore提出パッケージ_2026-09-12.md` を2026-10-20版へ（翻訳3機能・翻訳タブとスマートカメラの翻訳表示はiOS 18以降・新しい分析・Free＝記録中の旅行1件まで・ASO）。LPは別repo `travel-rate-camera-lp` の branch `feat/lp-sync-app-2026-10`（`cc0d8f8`・`d65b0cb`〔法務・要Human承認〕・`dae89bb`）にlocal commit、production・push未実施。作業ログ：Vault `2026-10-20_旅レートカメラ_AppStore資料・LPの現行仕様追従_開発ログ`
- **【2026-10-20続報6】Freeの終了済み旅行で、保存済みの記録を編集できるようにした / Human実機確認待ち（未push）**：#71〜#73のHuman実機確認は合格。その確認で出た1点として、Human確定仕様を「Freeの終了済み旅行＝**既存記録の編集はOK・新しい記録を増やすのはNG**」へ更新（旅行後にレシートを見て金額・商品名（メモ）・メモ・カテゴリーを直せるように）。**変更**：`item-edit`の「Freeプランでは編集できません」ガードを削除（通常の編集画面をそのまま使う。写真の差し替えも既存の編集項目として含む）／`item-detail`は閲覧のみ旅行でも通常どおり「編集する」＋削除（候補⇔購入済みは編集画面で切替）／`trip-records`の各記録に「編集」を追加し、ルートStackの`trip-record-edit`（`item-edit`をre-exportするだけ。別実装なし）で開く（戻ると旅行の記録へ）／案内文を「Freeプランでは、この旅行に新しい記録は追加できません。保存済みの記録は編集できます。」へ（詳細・旅行の記録）。`trip-edit`の閲覧のみ画面の文言・Pro→Freeの記録中旅行のバッジ（閲覧のみ→新規記録不可）も実態へ。**不変**：`isTripReadOnly`／`isTripLockedOnFree`の判定（再開・切替・旅行編集・記録の追加は引き続き不可）・保存処理・10件制限・記録中1件制限・Pro複数旅行・分析・CSV・RevenueCat・DB schema。test 504 pass／tsc pass／lint 20（16/4）＝baseline。実機確認は`TEST_CHECKLIST.md` #74（#71・#73の期待も更新）。**Preview Build `241a213d-766d-4914-94be-0450ad43880b`**（FINISHED・2026-10-20 21:01〜21:07 JST・commit `670abbe`・preview / internal・既存ad hoc証明書）install：https://expo.dev/accounts/en540424/projects/travel-rate-camera-app/builds/241a213d-766d-4914-94be-0450ad43880b 。push未実施（Human確認後、これまでの未push分と合わせて）。作業ログ：Vault `2026-10-20_旅レートカメラ_旅行管理のFree-Pro境界_開発ログ`（追記）
- **【2026-10-20続報5】旅行管理のFree/Pro境界を実装 / Human実機確認待ち（未push）**：Human確定仕様「Free＝記録中の旅行1件・終了した旅行は何件でも残り閲覧できるが再開不可・新規記録不可・許可は閲覧／記録の削除／候補⇔購入済みの切替のみ」「Pro＝複数の旅行を記録中のまま切り替えて記録・保存無制限」を実装。**スキーマ変更なし**（既存`archived_at`＝終了済み、`is_active`＝使用中を再利用）。**元の挙動**：Freeは非アーカイブ数1件で作成をブロック（シートはPro導線のみ）・記録中0件なら終了旅行を復元できた・旅行切替にFree判定なし（Proから戻ると記録中の複数旅行へ交互に保存できた）・終了旅行の記録はカレンダー経由で金額/メモ/写真まで編集できた・終了旅行の記録を旅行ごとに見る画面は無かった。**変更**：純ロジック`src/utils/trip-recording-core.ts`（Freeの記録対象＝非アーカイブのうち使用中の1件、無ければ作成が新しい順。test 11件）／`config/limits.ts`の`canRestoreTrip`をFree常にfalseへ、`canSwitchTrip`・`isTripReadOnly`追加／`use-trips`（native・web）の`switchTrip`に判定を前置（切替処理本体は不変・戻り値`{blocked}`）、`endCurrentAndCreateTrip`・`endCurrentAndSwitchTrip`（終了＋作成／切替を1 transaction。終了は記録対象の1件だけ）／`TripLimitSheet`を3択＋終了確認の2段に／旅行作成・旅行一覧・設定の切替・旅行編集から接続／新画面`trip-records.tsx`（旅行ごとの記録一覧。閲覧・候補⇔購入済み・削除・写真拡大のみ）／Freeで閲覧のみの旅行は`trip-edit`・`item-edit`を閉じ、`item-detail`は編集の代わりに候補⇔購入済みボタン／Pro説明の「旅行作成数 無制限」「旅行をいくつでも作成」等を「複数の旅行を同時に管理」「記録中の旅行1件まで」へ整理。**Pro→Free**：データは書き換えず、使用中の旅行だけを記録対象・他は閲覧のみ（自動アーカイブはしない：RevenueCat確認前は`isPro=false`のため）。**保存処理・OCR・カメラ・翻訳・分析・CSV・DB schemaは無変更**。test 504 pass（+11）／tsc pass／lint 20（16/4）＝baseline。実機確認は`TEST_CHECKLIST.md` #71（Free）・#72（Pro）・#73（Pro→Free）。commit `31538f4`（本体）・`bf2c550`（終了＋切替の連打防止。db-guardianレビュー「問題なし」の任意強化）。**Preview Build `462515c3-8219-423d-b0a9-3b44ad8d52bc`**（FINISHED・2026-10-20 12:40〜12:46 JST・commit `bf2c550`・preview / internal・既存ad hoc証明書）install：https://expo.dev/accounts/en540424/projects/travel-rate-camera-app/builds/462515c3-8219-423d-b0a9-3b44ad8d52bc 。push未実施（Human確認後）。**Human判断事項**：Vault提出パッケージ（2026-09-12）の説明文・Pro項目に「同時に管理できる旅行は1件」「旅行作成数：無制限」が残っている（L136-137・L141・L294。正本は未変更）／Freeの閲覧のみ旅行で旅行名・予算の修正を許すか（今回は不可）。作業ログ：Vault `2026-10-20_旅レートカメラ_旅行管理のFree-Pro境界_開発ログ`
- **【2026-10-24続報2】初回リリース候補を統合 / 最終コード監査済み / 新Build未実施・Human GO待ち（branch `integrate/first-release-candidate`・base `d188d03`。main未merge）**：`feat/translation-jpy-photo-viewer` `d188d03`（`fix/photo-translation-progressive` `903aa20`を含むため個別には取り込まない）へ `fix/price-ocr-misread` `ad46db6` を `--no-ff` merge（`9527ca6`）。衝突は本ファイルの追記位置だけで、3件の記録をすべて残して解消。コード・`TEST_CHECKLIST.md`は自動で合わさる。変更範囲は翻訳画面・写真翻訳・写真ビューア・`fit-photo`（任意propsと面1つの追加のみ）・`extract-prices.ts`。DB・保存処理・メインカメラの撮影経路・旅行切替・`FREE_LIMITS`・native・app.json/eas.json/package.jsonは差分なし。**独立監査（Fable 5.1 / High・read-only）**：Build前のブロッカーなし。価格解析は約330入力×7通貨で比較し、87825efが正しくHEADが誤る組はなし、KRW/JPY/THB/TWDは出力が完全一致。指摘1件を修正（`a763292`：`$12.001`・`€12,001`＝`$12.00 1`の空白落ちを12001と読み、選択なしの約¥に誤った額が出うる → 通貨の小数点の記号で区切られた「整数部2桁以上＋3桁」は`000`の時だけ桁区切り）。Fableの再確認：`a763292`で変わる11組はすべてProductionの読みへ戻り、新しい誤りなし。既知の残り（誤った値は出さないか、Productionと同じかそれより近い）：EURの`€1.250`→1.25（1250とも1.25とも書かれる）／英語式のEUR `€12,500`・`12,500 EUR`→12.50（Productionは12.50・500.00。翻訳画面では出さない）／行末のサイズ`Latte 4.50 L`は容量と区別できず候補なし／`12.50.13.50`のようなピリオド連結は候補なし／OCRが小数点をカンマと読んだ`$1,250,00`→1.25／翻訳画面は曖昧な価格（`$3.999`・`0.69 lb`・`€1.250`）を出さない（メインカメラより控えめ。違う値は出さない）。tsc pass／`npm test` **682 pass**／lint 20（16/4）baseline。実機確認は`TEST_CHECKLIST.md` **R節**（#79→#77→#78→#75→#76→回帰の順・1回のPreview Buildでまとめて確認）。
- **【2026-10-24】価格OCRの桁区切り・日付の読み違いを修正 / 新Build未実施・Human判断待ち（branch `fix/price-ocr-misread`・base main `87825ef`。main未merge・翻訳改善branchとは独立）**：**再現（main `87825ef`＝Production `145232cf`と同じコード）**：USD `$1,250.00`→`1.25`と`250.00`、`$12,000`→`12.00`、`2026.10.24`・`Exp 10.24.2026`→`10.24`、`Tax 4.99%`→`4.99`、`Water 1.50 L`→`1.50`。同じ原因でEUR `€ 1,250.00`→`1.25`・`€1.250`→`1.25`・`1.250 €`→`250.00`、GBP `1,250.00`→`1250.00`と`250.00`・`2026.10.24 £4.99`→`10.24`。**原因**：`extract-prices.ts`の正規表現が数字のまとまりの途中から・途中までを拾っていた（USD Pass1 `\$\s*(\d{1,4}(?:[.,]\d{1,2})?)`は桁区切りを知らず右端の境界も無い／Pass2 `\b(\d{1,3}\.\d{2})\b`の`\b`はカンマ・ピリオドの直後でも成立）。**修正**：一致の前後に桁・桁区切り・小数点が続く時だけ、まとまり全体を1つの金額として読み直す（`wholeNumber`／`parseAmountToken`：桁区切り3桁ごと・小数1〜2桁のみ。日付等の読めないまとまりは候補にしない。Hermes向けに後読みは使わない）。前後に何も続かない一致は従来と同じ経路。桁区切り＋小数（`1,250.00`・`1.250,00`）は記号の並びで読む。記号1種類＋3桁は、区切り2つ以上・整数部2桁以上（`12,000`・`€ 12.000`）・USD/GBPのカンマ（`$1,250`）を桁区切り、残る「1桁＋記号＋3桁」（燃料・単価の`$3.999`・`€1,799`・アイルランド式`€1.799`、`€1.250`）はEURで両方の書き方があるため従来どおり小数第2位まで。読めないまとまりは、ピリオドだけ（日付）なら候補にせず、カンマを含む（空白の抜けた`$10.50,12.50`）なら従来どおり。通貨記号・コード付きで桁区切りのある金額だけ上限を999,999.99へ（`$12,000`→12000。`$123456`のような区切りの無い長い数字は従来の9999.99のまま）。記号なしの小数は直後が%・容量（ml/cl/fl oz、Lは後ろに数字が無い時）なら除外（重さ`0.69 lb`は量り売りの単価なので残す）。対象はUSD・EUR/GBPの記号付き＋記号なし小数のみ。EUR/GBPのOCR崩れ救済（空白小数・行またぎ・スラッシュ）とKRW/JPY/THB/TWDは不変。呼び出し側（メインカメラの価格候補・スマートカメラ・OCR比較）・保存処理・DB・カメラUI・`FREE_LIMITS`は不変（候補文字列の形式も同じ`"1250.00"`）。独立監査（別agent・2回）：1回目で最初の版の後退4件（3桁小数を約1000倍に読む・量り売り単価の除外・価格の連結を両方捨てる・`$123456`を通す）、再監査でEURの後退2件（`12,000 EUR`→12.00・`€1.799`→1799）を指摘され、上記のとおり修正＋テスト追加。残る既知の読み違い（Productionと同じ・悪化なし）：OCRが小数点をカンマと読んだ`$1,250,00`→1.25等。tsc pass／`npm test` **612 pass**（新規108）／lint 20（16/4）baseline。新規テストのうち修正前のコードで失敗するのは不具合のケースだけ（37件）で、「従来どおり」のケースは修正前後とも通過。翻訳改善branch `d188d03`へ本修正を重ねたテストも667 pass（`git merge-tree`で確認：衝突は本ファイル`.claude/mvp-tasks.md`の追記位置だけ。コードと`TEST_CHECKLIST.md`は自動で合わさる）。重ねると翻訳画面でも`$1,250.00`→約¥203,750と出る。実機確認`TEST_CHECKLIST.md` **#79**（Q節）。No OTAのため端末へ届けるには新Buildが必要（Human GO待ち）。
- **【2026-10-24続報】翻訳中の円換算＋写真翻訳の写真表示を改善 / 新Build未実施・Human判断待ち（branch `feat/translation-jpy-photo-viewer`・base `fix/photo-translation-progressive` `903aa20`。main未merge）**：**A 円換算**：カメラ翻訳・写真翻訳に、旅行の通貨・レート（保存と同じ`trips.manual_rate`。為替取得なし）で「$12.50（約¥2,038）」を添える。価格抽出は既存`extractPriceCandidates`を**変更せず**呼び、`live-text-core.ts`に翻訳ページ用の絞り込み（日付・時刻・%・量・電話番号を除外／旅行の通貨以外の通貨記号・コードがある行は換算しない／行内の数字の一部だけの読み取り＝`$1,250.00`→1.25等は採らない）と、カメラの「商品名＋価格」組立（`buildTranslationPriceEntries`・メインカメラと同じ左隣／直上）、写真の「価格だけの段落」を位置から一意な時だけ商品名へ結び付ける`annotatePhotoBlockPrices`を追加。カメラは位置の揺れる価格の上に重ねず、枠下部の帯（3件）＋枠下の一覧（6件）。写真翻訳は価格のある行を前後の文章とつながない（`groupLinesIntoBlocks`の既存`hasPrice`引数を使用）。JPY旅行・旅行なしは出さない、レート0は「レート未設定」。**B 写真表示**：原因は結果画面の写真が**高さ220固定の枠にcontain**（縦撮り3:4は約165×220の細い画像＋左右の黒い余白）。既存`FitPhoto`（写真の形の枠・切り抜きなし）に面`photoTranslation`（画面高×0.52・300〜460pt）を追加して使用、タップで新規`PhotoZoomViewer`（iOS ScrollViewズーム・ピンチ/ドラッグ/ダブルタップ・「元の大きさ」・Safe Area。新native依存なし。既存`PhotoModal`は不変）。**不変**：メインカメラ（`SmartCameraLayer`）・価格OCR・保存・DB・翻訳の送り方（#75・#76）・Swift。tsc pass／`npm test` **559 pass**（新規42。小数の無い桁区切り`$1,250`・`$12,000`の一部読み取り防止、サイズ表記`M $5.25 L $6.00`を含む）／lint 20（16/4）baseline。commit `418eaae`・追補`c08f224`。実機確認`TEST_CHECKLIST.md` **#77・#78**（P節）。**既存の発見（未修正・保護領域のためHuman判断）**：既存`extractPriceCandidates`のUSDモードは`$1,250.00`を`1.25`・`250.00`、`2026.10.24`を`10.24`と読む。メインカメラのスマートカメラ表示と、保存の価格OCR候補にも同じ読みが出うる。No OTAのため端末へ届けるには新Buildが必要（Human GO待ち）。
- **【2026-10-24】写真翻訳の長時間待機（「翻訳しています…」と「…」のまま）を改善 / 新Build未実施・Human判断待ち（branch `fix/photo-translation-progressive`・base `main` `87825ef`）**：Preview実機で英文8件の写真がOCR後に長く翻訳待ちになる報告。**コードで確定した原因**：①写真の全段落を1回の`translateBatch`で送っており、Apple `translations(from:)`は全件完了まで1件も返さない（全件「…」）②`translateBatch`はtimeoutなし（初回DLのため意図的）で、nativeの応答が返らないと画面側に停滞検知・やり直しが無く永久ローディング③`cancelled`時はエラー文言もやり直しボタンも出ない行き止まり④「初回は言語データ…」は固定文言で実際の導入状態を示していない。**実機でしか確定できない候補**（端末ログなし）：(a)英語/日本語の翻訳データ未導入でAppleのDL案内が出ない・DL待ち(b)OSの全画面カメラ（写真を撮る）でホストViewが外れて同じcoordinatorが再接続される経路（`activeDrainCount`はリセットされない）(c)単なるモデルの初回読込＋①。**修正（JSのみ・Swift/DB/OCR/保存は不変）**：`src/lib/photo-translation-core.ts`（新規・純関数）で最初2件→以降6件のまとまりに分けて順番に送り、終わったものから表示（件数表示）。失敗した翻訳元の残りは送らない（DL案内の繰り返し防止）。訳済みはcacheから即表示。言語ペアが未導入なら並行して調べ「ダウンロードが必要」を表示。15秒進まなければ失敗扱いせず「時間がかかっています（やり直す）」。やり直しは`TranslationHost`を`instanceKey`で作り直してから送り直す（応答の返らない要求の後ろに並び続けない）。`cancelled`も含め訳せない段落があれば「もう一度翻訳する」。翻訳中も「原文を編集」可。tsc pass／`npm test` **517 pass**（新規13）／lint 20（16/4）baseline・変更ファイル0件。実機確認`TEST_CHECKLIST.md` **#75・#76**（O節。今のBuildで先にできる切り分け手順も記載）。**No OTA（expo-updatesなし）のため、修正を端末へ届けるには新Buildが必要**。Production `145232cf`（`87825ef`）は修正前で同じ症状を含む可能性が高い。次（Human）：①今のBuildで切り分け（撮る/選ぶ・DL済み言語・2分待ち）②修正を初回リリースに入れるか判断→入れるならPreview Build→#75・#76→main merge→Production Build。Swift側coordinatorの強化（`hostDidDisappear`での`activeDrainCount`扱い等）は実機ログを見てから別途提案。
- **【2026-10-01更新】正式採用App Iconをアプリ本体へ反映（Human実機確認待ち）**：`assets/images/icon.png`（`icon`／`ios.icon`の参照先。app.jsonは不変）を、LP repo `docs/brand/travel-rate-camera-app-icon-selected-reference.png`（1254px・白地モックアップ）から作った**1024×1024・RGB不透明（colortype 2・alphaなし）**へ置換（旧：Expoテンプレの青いicon・RGBA）。タイルをLPと同じ範囲で正方形に切り出し、外側4隅（白地・落ち影＝iOSマスクで消える領域）だけ隣接タイル色の放射延長で埋め、LANCZOSで1024へ（タイル実寸944pxのため約1.085倍。512px Web版は不使用）。再描画・生成・要素追加なし。**Android adaptiveIcon（Expoテンプレ素材）・Splash（`#208AEF`・iOSは画像なし）・favicon は不変**。tsc pass／`npm test` **379 pass**／lint 20（16/4）維持／`expo config --type public`で`icon`・`ios.icon`とも新ファイルへ解決。commit `3c86b64`（未push）。**Preview Build `be61a603-cbf6-4443-aa0f-f11a94fde5c3`**（**FINISHED**・対象commit `3c86b64`・app 1.0.0 / buildNumber 1。IPA内`AppIcon60x60@2x.png`を展開し新icon・alpha全面255を確認。**09-18〜19の未push修正13 commitもこのBuildに初搭載**＝実機確認#55・#56・JPY number-pad等も本Buildで確認する）。install：https://expo.dev/accounts/en540424/projects/travel-rate-camera-app/builds/be61a603-cbf6-4443-aa0f-f11a94fde5c3 。push（13＋1 commit）は実機確認後にHuman判断
- **【2026-09-12更新】LP全面再構築 完了**：LP `b24451b`。アプリ`src/theme/tokens.ts`由来のティール配色へ統一（旧LPは青で別ブランドだった）。未実装の「自動レート取得」のPro掲載を是正、価格（月額¥500／年額¥4,000）を明記しPricingを復活、翻訳/STT/TTS/カテゴリー/CSVを追加。掲載仕様は`src/lib/appSpec.ts`へ単一ソース化。Privacy/Terms/Contact/Licensesは本文不変（リンク色のみ）。**masterへのpush＝Vercel自動デプロイのため本番反映済み**
- **【2026-09-12更新】production Build前の技術設定監査 完了**：`RELEASE_PREP.md`（新規）。最大論点は**buildNumber未設定**（`ios.buildNumber`なし・`autoIncrement`なし・現在値1）で、このままだと2回目以降のsubmitが弾かれる。`eas.json` productionへ`autoIncrement: true`追加を推奨
- **【2026-09-12更新】buildNumber方針 Human確定・適用済み**：`eas.json` production profileへ`autoIncrement: true`を追加（preview等の他profile・`app.json`・`cli.appVersionSource`は無変更）。`eas config --profile production --platform ios`で解決結果を確認済み。詳細：`RELEASE_PREP.md`§1
- **【2026-09-12更新】App Store提出準備 完了（Human-only作業を除く）**：Vault `旅レートカメラ_AppStore提出パッケージ_2026-09-12.md`（**新設・提出文言の正本**）。旧`提出文書セット_2026-09-11.md`は**差分文書**で、説明文・キーワード・スクショを旧07-07版（＝「純無料・課金なし・保存30件」という現在と逆の前提）へ委譲しており提出に使えなかったため、**コピペ可能な確定文言として1冊に統合**しsupersededにした。内容：ASC全項目の入力値（文字数実測つき）／App Privacyファクトシート（コード実測）／RevenueCat整合／Age Rating回答ファクト／App Review Notes／スクショ8枚設計
- **【2026-09-12更新】icon/splash/権限・production前提の追加監査**：`RELEASE_PREP.md`§7・§8。**production Build自体を技術的に止める要因はゼロ**。submitは**ASCアプリレコード未作成**のため不可（＝Humanのクリティカルパス）。iOS splashは**画像なし・背景`#208AEF`（青）でブランド色ティール`#0E9488`と不一致**（release blockerではないため未変更・Human判断）
- **【2026-09-12更新】`TEST_CHECKLIST.md`に確認順の優先度（P0 24項目／P1 29項目）を追加**。**項目番号は不変**（`#27〜#36`等の相互参照を壊さないため）
- 最終App Store submission（App Store Connect入力・App Privacy申告・スクショ撮影・production Build・提出）は**Human作業**。提出文書：Vault `旅レートカメラ_AppStore提出パッケージ_2026-09-12.md`

## 現在の開発フェーズ（2026-07-01時点の記述・履歴）

MVP仕上げフェーズの中盤初期。

OCR基盤・複数通貨OCR改善は一段落しており、USD / EUR / JPY / KRW / THB / TWD / GBP は実機確認済み。
換算画面・分析画面は主要機能は実機確認OKでMVP仮完了（換算画面の微スクロール修正のみ実機再確認待ち）。一方で、設定・旅行管理・通貨選択・レート設定・データ管理・ヘルプ・アプリについて・Pro版導線はまだ残っており、MVP完成直前ではない。

## 完了済み

- カメラ基本機能
- OCR読み取り基盤
- 複数通貨OCR改善
- OCR失敗時の手入力導線
- 自動スクロール
- TextInput focus
- キーボード表示
- OCRメモ候補改善
- OCR価格候補除外改善
- 多言語OCRの限界調査
- 履歴の基本機能
- 候補／購入済み管理
- 商品写真まわり
  - 【2026-08-16確定・履歴/商品編集の写真編集：実機合格・完了】`item-edit.tsx`で写真の削除・再撮影・ライブラリ選択が保存前に即時DB確定＋fileを即時削除する構造だったため、「破棄して移動」を選んでも元画像へ戻らない、再撮影時に未保存警告が出ない、写真ライブラリが起動しない、の3系統の不具合があった。写真も金額・メモ・statusと同じ「保存するまでdraft、保存で初めてDB確定、破棄なら元へ完全復帰」のtransactionモデルへ統一する修正（`f2a4a64`、`originalPhotoUri`/`draftPhotoUri`分離、未保存draft fileの台帳管理と離脱時cleanup）を実施。あわせて、写真ライブラリが開かない不具合（`ActionSheet`のRN Modal dismiss中に`ImagePicker`のpresentが競合していた。`onDismiss`完了後に起動する方式へ修正）、未保存ガードが下タブ移動（`tabPress`）のみでヘッダー戻る・iOSスワイプバックが対象外だった構造的ギャップ（`beforeRemove`リスナー追加・未保存中は`gestureEnabled: false`でスワイプ抑止）も同時に修正
  - Preview Build（Build ID: `f5d80f54-1df2-4157-9d12-695e20704969`、commit `f2a4a64`）でHuman実機確認。報告された全項目（写真削除→破棄→元画像維持／再撮影→破棄→元画像維持／保存確定→旧file cleanup／ライブラリ起動／未保存ガード3経路／破棄時の金額・メモ・status revert／既存保存・履歴表示への回帰なし）がOK
- 旅行作成・編集・アーカイブ・アクティブ旅行切替の基盤
- カレンダーの一部調整
- 換算画面（converter.tsx）UI調整 → 主要機能は実機確認OK・MVPとして一旦完了（2026-07-01）。ただし下記の微スクロール修正のみ実機再確認待ち
  - 実機確認済み：JPY国内モードで通貨チップ・方向切替・レート設定導線が非表示／国内モードが「円の買い物メモ入力画面」として自然／海外モードで旅行通貨・旅行レートを使う画面に整理／通貨チップと旅行レートのズレ問題は解消
  - 逆算モード（円→外貨）は実用性があるため今後も維持する方針。見た目の統一は任意の将来改善として残す（触らなくてよい）
  - 【実機確認で判明した微修正・2026-07-01（1回目・未完了）】1画面に収まっているのに上下に少しだけスクロールできてしまう（ふわっと動く）挙動の修正として、`history/item-edit.tsx`・`item-detail.tsx`と同じ実測ベースの方式（`onLayout`/`onContentSizeChange`で高さを比較し`canScroll`を算出、`scrollEnabled`/`bounces`/`overScrollMode`を連動）を適用したが、実機では直っておらず通常時も普通にスクロールできる状態だった。この1回目の対応は未完了として扱う
  - 【2026-07-01・2回目の修正】実測ベースの`canScroll`判定（`scrollAreaHeight`/`contentHeight`）を廃止し、キーボード表示状態のみでスクロール可否を決める方式に変更。`scrollEnabled={keyboardVisible}`とし、`bounces={false}`・`alwaysBounceVertical={false}`・`overScrollMode="never"`・`showsVerticalScrollIndicator={false}`を常時固定値にした。キーボード表示中（`keyboardDidShow`）のみスクロールを許可し、`keyboardDidHide`時に`scrollViewRef.current?.scrollTo({ y: 0, animated: false })`で位置をリセットする。ブラウザ拡張未接続のため実機確認はできておらず、**実機確認待ち**（iOSでの`bounces`/`scrollEnabled`挙動はブラウザでは再現できないため、次回は必ず実機での確認が必要）

- 分析画面（analytics.tsx）UI・期間切替・グラフ改善 → 実機確認OK・MVPとして仮完了（2026-07-01、6回の実機確認・追加修正を経て）
  - 実機確認済み：今日／月／年の期間切替／今日表示はグラフなしの一覧表示／月表示は横スクロールの日別グラフ＋横スワイプ導線／月表示の初期表示範囲（1日〜10日程度）／年表示は12ヶ月グラフ（1画面表示）／棒タップ時の選択中金額カード表示（金額見切れなし）／選択中・未選択の棒の色分け／旅行別購入済み合計が選択期間に連動して表示される、いずれもOK
  - 方針決定：旅行別購入済みリストが増えた場合、MVPでは画面全体の縦スクロールで見る方針とし、カード内スクロール・上位N件表示・折りたたみ表示は入れない
  - 方針決定：分析画面はMVPでは「見る専用」画面として仮完了とする（棒グラフ・旅行別購入済みからの他画面遷移はMVP後）
  - MVP後の拡張候補は「MVP後でよいタスク」を参照

## 一部完了・要再調整

- カレンダー画面
  - 背景
  - 合計カード
  - レコード表示
  - 見やすさ
  - 一度調整したがまだ完全には納得していない
  - ただし今は最優先ではない（他画面を先に進める方針）
  - 【2026-07-01追記・後続タスク】現在、月合計・選択日合計・選択日の記録カードの情報が近く、ユーザーが月単位と日単位を勘違いしやすい可能性がある。後続タスクで、カレンダー画面の「月の合計」「選択日の合計」「選択日の記録」を見出しとカード構成で明確に分けて区別する（今回は記録のみ・実装はまだ着手しない）
  - 【2026-07-09対応済み】上記の見出し区別、および国旗画像（日本の国旗だけ枠からはみ出して大きく見える不具合）を`6dc2c69`（Fix pre-TestFlight QA issues）で修正。`summaryCardTitle`/`sectionLabel`のフォントサイズ・色・余白を強化して月合計/選択日合計/選択日の記録を視覚的に区別し、国旗コンテナに`overflow: 'hidden'`を追加して国旗はみ出しを解消。2026-07-30の現行実体監査で現行コードでも維持されていることを再確認済み。本行より上の「後続タスク」は解消済みのため未完了タスクとして扱わない

## MVP前に必要な残タスク

1. 設定画面UI整理（Step 1・Step 2・Step 2.5完了・2026-07-02、Step 3〜5は未着手）
   - 【Step 1完了】旅行作成/編集導線の二重化整理：`settings.tsx`内にあったインラインの旅行作成/編集フォーム（`creating`/`editingTripId`関連のstate・ハンドラ・フォームJSX・専用スタイル）を削除。「旅行を編集」ボタンは`router.push({ pathname: '/trip-edit', params: { id } })`で専用画面`/trip-edit`へ遷移する形に変更。新規旅行作成は`/trip-create`に一本化（既存の空状態ボタンをそのまま活用）。「旅行を切り替える」ボタン（`ActiveTripSwitchSheet`）、「旅行管理」（`/trip-list`）、レート設定／通貨選択／データ管理／ヘルプ／アプリについて／Pro導線の各`SettingRow`はすべて維持。保存・編集・切替のロジック本体（`useTrips`/`useRates`）は無変更
   - 【Step 2完了】設定トップのUI整理：
     - 「現在の旅行」という見出しをアクティブ旅行カードの上に追加し、旅行未選択時の文言も「旅行が未選択です」「まず旅行を作成すると〜」に微調整
     - アクティブ旅行カードの下に「この旅行で保存・換算されます。通貨や旅行を変えたいときは『旅行を編集』『旅行を切り替える』から。」という補足文を追加し、旅行作成/編集/切替/管理の役割の違いを明示
     - 「旅行とレート」セクションの下に「レート設定は今の旅行のレートを調整、通貨選択は新規旅行作成時などの初期通貨で今の旅行の通貨は変わらない」旨の補足文を追加し、`currency-select.tsx`が今の旅行の通貨を変えるものではないという誤解を防止
     - 「サポート」セクションから「アプリについて」を分離し、新しく「アプリ情報」セクションを新設
     - Pro導線のセクションに`title="Pro"`を追加（誘導の強さ自体は変更なし、控えめな1行のまま）
     - `SettingRow`/`SettingSection`（共有UIコンポーネント）自体は無変更。すべて`settings.tsx`内の文言・レイアウト追加のみで対応
   - 【Step 2.5完了・2026-07-02】実機確認で見つかった表示崩れのピンポイント修正：
     - 金額/レート見切れ対策：`settings.tsx`(heroBudgetValue/heroRate)、`trip-list.tsx`(budgetValue/statBoxValue/otherBudget/activeRate/otherRate)、`trip-edit.tsx`(rateInput/budgetInput)、`trip-create.tsx`(previewValue)、`rate-setup.tsx`(heroRate/previewTo)、`purchase-confirm.tsx`(planPrice)、`data-management.tsx`(statValue)に`lineHeight`を追加（未指定だったのが根本原因）。特にfontSize26〜30の「金額ヒーロー」系（settings/trip-list/rate-setupの各`heroRate`/`budgetValue`）は`letterSpacing`の負値も緩め、`numberOfLines={1}`＋`adjustsFontSizeToFit`＋`minimumFontScale`を追加（analytics.tsx/converter.tsxで確立済みの見切れ対策パターンを踏襲）
     - 設定タブの「設定」タイトル見切れ：`title`スタイルに`lineHeight: 33`を追加（`history/index.tsx`のtitleスタイルが既に`lineHeight`を持っていたのに対し、`settings.tsx`だけ未設定だったことが原因）
     - 戻るボタンの「Tabs」表示：`src/app/_layout.tsx`のルート`Stack`の`screenOptions`に`headerBackButtonDisplayMode: 'minimal'`を追加（戻るボタンの文字を非表示にし矢印のみに）。あわせて`(tabs)`の`Stack.Screen`に`options={{ title: '' }}`を明示し、フォールバック時の表示も防止
   - 価格ヒーロー見切れ修正 → Step 2.5でsettings/trip-list/trip-create/trip-edit/rate-setup/purchase-confirm/data-managementの金額系表示に対応済み。残りは実機での最終確認待ち
   - レート表示整理 → 未着手（Step 4想定。文言・役割整理はStep 2で一部対応済み）
   - 次のステップ案：Step 3 旅行管理・アクティブ旅行切替の分かりやすさ改善（`trip-list.tsx`/`ActiveTripSwitchSheet`）／Step 4 通貨選択・レート設定画面自体の役割整理／Step 5 データ管理・ヘルプ・アプリについて・Pro説明の最低限整備

2. 通貨選択画面
   - 国旗表示
   - 通貨コード
   - 日本語名
   - 主要通貨を選びやすくする
   - 換算画面・旅行作成・レート設定との整合性

3. レート設定画面
   - 手動レート設定を分かりやすくする
   - 保存時レート固定の前提を壊さない
   - 既存履歴を再計算しない

4. データ管理画面
   - 保存データ削除
   - 旅行データの扱い
   - 注意文
   - 初期化確認
   - CSV/PDFやバックアップはMVP後でよい

5. ヘルプ画面
   - 基本の使い方
   - OCRが読めない時は手入力できる説明
   - レートは手動設定である説明
   - 保存時レートで記録される説明

6. アプリについて
   - アプリ説明
   - バージョン表示が可能なら表示
   - 問い合わせや利用上の注意の置き場

7. 旅レートカメラPro版の説明・誘導
   - 【2026-07-11現行化】本項目作成時点（2026-07-01）はRevenueCat実装を後回しにする方針だったが、2026-07-09のPro課金方針再判定により、Pro課金導線を含めて公開する方針へ変更された（詳細：`旅レートカメラ_RevenueCat・AppStoreConnect課金設定メモ`／`Fable追加レビュー1_旅レートカメラ公開直前・Pro課金導入前完全横断監査レビュー結果`）。RevenueCat実装・購入/復元処理・isPro永続化・FREE_LIMITS実制御は現在、公開前に必要な実装タスクとして扱う。本ファイルはタスクの粒度管理用であり、実行順序の正本ではない（実行順序はFable追加レビュー1 §10参照）
   - Pro機能の説明と導線だけ整理 → 現在はPro5画面の文言・価格の現行化（月額¥400/年額¥3,000/買い切りなし）も対象に含まれる（【2026-09-11現行化】価格はHuman確定で**月額¥500／年額¥4,000**へ。アプリ内はRevenueCat `priceString`表示のためコード変更なし。ASC/RevenueCat実設定の一致確認はHuman）
   - 無料版制限の説明
   - 保存上限や詳細分析などの将来Pro候補を整理 → 高性能OCR・Pro Plusは初回公開に含めない（詳細：`旅レートカメラ_ProPlus・高性能OCR・クラウド機能_構想設計書_v1`）
   - 【2026-07-11・RevenueCatバッチ0完了】課金基盤（購入・復元の本実装ではない）を導入。
     - SDK導入済み：`react-native-purchases`（`package.json`）
     - 設定値：`EXPO_PUBLIC_REVENUECAT_IOS_KEY`環境変数（`.env`はGit管理外・`.env.example`に雛形あり）。実値の保存場所は本ファイルに記載しない
     - 初期化基盤：`src/lib/revenuecat.native.ts`（実装）／`src/lib/revenuecat.web.ts`（Webは無効化スタブ）／`src/hooks/use-purchases.ts`の`usePurchasesInit()`から`src/app/_layout.tsx`で1回呼び出し。iOS以外・Key未設定・通信失敗のいずれでも無料機能は継続利用可能
     - Entitlement判定基盤：`src/config/revenuecat.ts`の`REVENUECAT_ENTITLEMENT_ID = 'pro'`（RevenueCat Dashboard側のEntitlement識別子は本バッチの人間確認により`pro`へ変更する方針。Dashboard側の実変更はユーザー側作業）／`src/stores/purchases-store.ts`の`isPro`
     - Offering/Package取得基盤：`REVENUECAT_OFFERING_ID = 'default'`から`monthlyPackage`/`annualPackage`を取得（`purchases-store.ts`）
     - 【バッチ0時点】未実装のまま：購入処理・復元処理（ダミー実装なし）、`isPro`のFREE_LIMITS連動（既存`settings-store.ts`の`isPro`とは意図的に未接続）、`SHOW_PRO=false`維持
     - 【バッチ0時点】次のバッチ：購入/復元接続・`isPro`永続化・Pro5画面の文言/価格現行化・FREE_LIMITS実制御（優先順は「旅レートカメラ_RevenueCat・AppStoreConnect課金設定メモ」9節・「Fable追加レビュー1」10節を参照）
     - 【2026-07-13現行化】上記「次のバッチ」はcommit `a8824ff`（feat: complete RevenueCat pro plan management）で完了済みと確認。`purchase-confirm.tsx`が`purchase(pkg)`を、`purchase-restore.tsx`が`restore()`を実際に呼び出し済み。`use-history.ts`の`addEntry`が`!isPro && totalCount >= FREE_HISTORY_LIMIT`でブロックし、`converter.tsx`が`blocked`時に`SaveLimitSheet`を表示。`trip-create.tsx`も`TripLimitSheet`を表示。`SHOW_PRO`は`true`。設定画面の現在プラン表示は`CurrentPlanCard`で実装済み。残るのは実機Sandboxでの動作検証
     - 【2026-07-13・PROバッジ修正完了】`CurrentPlanCard`のPROバッジが無料/Pro状態を問わず常時表示されていた点はユーザー確定方針により修正済み。`isPro === true`の時だけゴールドPROバッジを表示し、無料時は非表示。無料時の見出しを「無料プランをご利用中」へ変更し、無料であることを誤解なく示す。カードのpadding/gapを縮小（18→16 / 8→6）、アクションボタンのmarginTopを微調整（4→8）。Pro表示・購入・復元・RevenueCat処理・DB・保存処理・FREE_LIMITS数値は無変更

## 多言語OCR・翻訳・テキスト入力（中核構想・2026-07-22決定）

【2026-07-22決定・2026-08-14現行実体監査で本ファイルへ反映】カメラ撮影・保存画像/スクリーンショット・テキスト入力の3方式による多言語OCR・翻訳・原文/日本語訳表示・金額抽出・円換算・商品/旅行記録としての保存を、後回し機能ではなく正式な中核構想として決定済み。詳細・判断順序の正本はVault `AI-Workflow-System/07_project-kits/tabirate-camera/旅レートカメラ_多言語OCR・翻訳・テキスト入力_中核構想設計書_v1.md`。

- **実装状況（2026-08-14時点）**：Apple Translation（オンデバイス翻訳）を採用し、TranslationHost経由でRelease正式経路へ接続済み（Translation Phase 3B〜3D完了、検証用の黒い[検証]翻訳候補パネルは撤去し本番memo候補UIへ統合済み）。ただしReleaseビルドでの実機実証、およびiOS16.4〜17.xでのweak-link動作実証はまだ実施していない
- **OCR文字認識エンジン自体**：`expo-text-extractor`呼び出しは引き続き`recognitionLanguages`等の言語指定手段を持たず、OSデフォルト認識に依存（この点は変更なし）
- **OCR候補品質改善（対応済み）**：THB/TWD価格候補の誤検出修正（cal/時刻/商品コード混入防止）、KRW/JPYのカンマ区切り非価格数字（例：「2,000 kcal」）誤検出修正、memo候補への商品情報tier追加（カロリー・容量・重量・栄養情報）、memo内部候補数上限を8→12に拡張、栄養情報の%表記保持を実施済み。実機確認で「総内容量120g」「505 kcal」「炭水化物79g 24%」等をmemo候補として認識できることを確認済み
- **【2026-08-15確定・KRW/JPY価格OCR改善：条件付き合格・Release候補として採用】** preview Release実機確認を経て正式判断。主要な取りこぼし回帰（`50c92c7`由来のHAS_ALPHA行全体除外による₩/¥記号欠落＋英字同居時の価格消失、`2774725`で修正）と、Vision OCRの桁区切りカンマ→ピリオド誤認（例：4,500→raw「4.500」、`eb8d5d9`でKRW P4.7/JPY P5.7として救済）の両方を修正済み。preview Release実機で複数価格の同時正常取得（4,900/4,500・4,000/6,500/2,700等）を確認済み。**既知制約として、Vision OCR rawは撮影条件（距離・傾き・反射・背景・周辺文字混入等）によって撮影ごとに揺れる。これはKRW固有の問題ではなくOCR全般（USD/EUR/GBP/THB/TWD/JPY共通）の性質であり、raw自体が別の数字へ誤認された場合はextract-prices側だけでは完全復元できない。この制約は現Releaseを止める未完了事項として扱わない**（自動テスト68 pass / 0 fail、`node --test src/utils/extract-prices.test.mjs`で固定化済み）。実機確認用に一時追加していたOCR raw診断UI（`5944750`）は確認完了後に撤去済み
- **将来改善候補（Release前必須ではない。実運用で問題が多い場合に再検討）**：confidence / boundingBoxの活用（native側は取得済みだが`CameraPreview.native.tsx`の`recognizeText()`が`fullText`のみ返しJS側で捨てている）、さらなるOCRノイズ除去・撮影条件依存の追加対策、翻訳専用長文モード（将来機能）、Phase 6 source auto-detect、TWD `$3.99 → 4`（既知仕様として対応保留）
- **DB方針**：現時点でDBスキーマ・保存処理は変更しない（OCR写真は現行仕様どおりDBに保存しない）
- **方式の優先順位**：オンデバイスOCR・オンデバイス翻訳・端末内保存が第一候補。クラウドOCR・外部翻訳APIは既定路線ではなく、「オンデバイスが製品品質に届かなかった場合にのみ検討する未決定の代替案」
- **次アクション（着手時期は人間判断待ち）**：英/日/韓/中(簡体・繁体)/タイ語での翻訳実機精度検証 → 品質判定 → （不足時のみ）外部方式の比較検討。Release build実証・iOS16.4〜17.x weak-link実証も次アクションに含む
- **無料/Pro境界**：未決定。オンデバイス方式の原価構造が判明してから再設計する方針であり、既存`FREE_LIMITS`の数値には影響しない

### 専用翻訳ページ（自由入力テキスト翻訳・OCRメモ候補翻訳とは独立）

【2026-08-16確定・実機合格・安定】7タブ内の専用翻訳タブ（`src/app/(tabs)/translation.tsx`）を新規実装。既存のOCRメモ候補翻訳（`translation-service.ts`経由、上記の中核構想の一部）とは完全に独立した並列経路で、自由入力テキストを任意のsource/targetで翻訳する機能。

- 実装済み機能：source/target選択（言語ピッカー`translation-language-select.tsx`）、swap、複数行入力（1000文字上限）、翻訳実行、コピー（`expo-clipboard`を動的import化しトップレベルimportを避けた）、クリア、旅行設定の通貨から初期source候補を提案（初回表示時のみ・以後は再介入しない）
- 実機確認で判明し修正済みの不具合：
  - swap時に旅行設定由来の言語（例：KRW旅行でko/ja）へ巻き戻る不具合 → `2c58a636`で修正（`sourceOverride`/`targetOverride`の分離stateを`languageOverride: {source, target}`単一オブジェクトへ統合し、どちらか一方の変更でも両方を同時に確定）
  - 言語ピッカーで片側だけ変更した際に、触っていない反対側が旅行設定へ巻き戻る不具合 → `818f1ca`で修正（触っていない側の値をroute paramsで明示的に往復させる方式へ変更。コンポーネントのref/stateに依存する方式は経路依存の不具合を残すため廃止）
- Human実機確認（Preview Build経由）で上記修正を含め全項目合格。翻訳ページはこの時点で安定として扱う
- 次フェーズ候補（優先順、着手時期は人間判断待ち・今回は未着手）：1. 音声入力（マイク→speech to text→既存翻訳へ接続）、2. 翻訳結果の読み上げ（target languageでTTS）、3. 翻訳元の自動検出、4. 翻訳履歴、5. カメラ翻訳。直近の次アクションは「1・2（音声入力＋読み上げ）の事前監査」

## MVP後でよいタスク

- ~~OCRエンジン変更~~／~~recognitionLanguages対応~~（2026-07-22の中核構想決定により、上記「多言語OCR・翻訳・テキスト入力（中核構想）」節へ格上げ・移管。クラウドOCR・外部翻訳APIを既定路線とはしない。本行は旧記述として取り消し線のみ残す）
- 外部APIによる自動為替取得
- ~~RevenueCat本実装~~（2026-07-09方針変更により公開前必須タスクへ変更済み。現状は項目7を正とする。本行は旧記述として取り消し線のみ残す）
- CSV/PDF出力
- クラウド同期
- バックアップ
- AI OCR
- 大規模UI刷新
- カレンダーの高度機能化
- 分析画面：旅行別購入済みから該当旅行の履歴への遷移
- 分析画面：棒グラフの棒から該当期間の履歴への遷移
- 分析画面とカレンダー画面の連携
- 分析画面：旅行別購入済みリストの折りたたみ／上位表示／詳細表示

## 絶対に触らない領域

- DBスキーマ
- migration
- addEntry
- saveEntry
- 保存処理
- 削除処理
- 履歴ロジック
- FREE_LIMITS（数値そのものの変更。RevenueCat連携によるisPro判定実装は対象外）
- OCRエンジン変更
- 外部API追加
- 大規模リファクタリング

> 【2026-07-11現行化】旧版では本欄に「RevenueCat」を触ってはいけない領域として含めていたが、2026-07-09のPro課金方針再判定により、RevenueCat実装は現在「公開前に必要な実装タスク」に変わっている。触ってはいけないのは引き続き上記の他項目（DB・保存処理・FREE_LIMITSの数値等）であり、RevenueCat自体は禁止領域から除外する。

## 今後の作業ルール

- 実装前にこのファイルを確認する
- 完了したタスクはこのファイルに反映する
- 新しいタスクが出たらこのファイルに追加する
- DB・保存処理・OCR中核などの禁止領域に触る場合は、必ず事前確認する
- カレンダーは後で再調整するが、今は他画面を優先する
- Claude Codeが勝手に「レビューだけ」「見送り」「別方針」に縮小しない
- ただし禁止領域は守る

## 次に優先して検討する候補

> 【2026-09-11現行化】以下は2026-07-01時点の候補。現在の最優先は冒頭「現在地」節の「次のアクション」（最新HEADでPreview Build→`TEST_CHECKLIST.md`で実機/Sandbox確認）。換算画面の微スクロール・設定画面Step 2.5の実機確認は、その後の実機確認で問題が出なければ完了扱いとする。

- 換算画面：微スクロール修正（今回のkeyboardVisible方式・2回目）が実機で本当に直っているかを最優先で確認。前回の実測ベース方式は直っていなかった実績があるため、必ず実機で「通常時に上下へ動かないか」を確認してほしい。キーボード表示時の操作性、キーボードを閉じた直後の位置ズレも合わせて確認
- 設定画面：Step 2.5の表示崩れ修正（金額見切れ・「設定」タイトル見切れ・戻るボタン「Tabs」表示）が実機で本当に直っているかを最優先で確認
- 換算画面：円→外貨の逆算モードのカードスタイルを、円換算モードと統一するか検討（任意・急ぎではない）
- 設定画面UI整理（Step 3以降）
