# 旅レートカメラ MVP残タスク管理 2026-07-01

## 現在の開発フェーズ

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
   - Pro機能の説明と導線だけ整理 → 現在はPro5画面の文言・価格の現行化（月額¥400/年額¥3,000/買い切りなし）も対象に含まれる
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
     - 【2026-07-13現行化】上記「次のバッチ」はcommit `a8824ff`（feat: complete RevenueCat pro plan management）で完了済みと確認。`purchase-confirm.tsx`が`purchase(pkg)`を、`purchase-restore.tsx`が`restore()`を実際に呼び出し済み。`use-history.ts`の`addEntry`が`!isPro && totalCount >= FREE_HISTORY_LIMIT`でブロックし、`converter.tsx`が`blocked`時に`SaveLimitSheet`を表示。`trip-create.tsx`も`TripLimitSheet`を表示。`SHOW_PRO`は`true`。設定画面の現在プラン表示は`CurrentPlanCard`で実装済み。残るのは実機Sandboxでの動作検証と、`CurrentPlanCard`のPROバッジが無料/Pro状態を問わず常時表示される点の要判断（意図的な一体感重視のデザインか、要件7「無料ユーザーにPROバッジを出さない」との不整合か、ユーザー判断待ち）

## MVP後でよいタスク

- OCRエンジン変更
- recognitionLanguages対応
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

- 換算画面：微スクロール修正（今回のkeyboardVisible方式・2回目）が実機で本当に直っているかを最優先で確認。前回の実測ベース方式は直っていなかった実績があるため、必ず実機で「通常時に上下へ動かないか」を確認してほしい。キーボード表示時の操作性、キーボードを閉じた直後の位置ズレも合わせて確認
- 設定画面：Step 2.5の表示崩れ修正（金額見切れ・「設定」タイトル見切れ・戻るボタン「Tabs」表示）が実機で本当に直っているかを最優先で確認
- 換算画面：円→外貨の逆算モードのカードスタイルを、円換算モードと統一するか検討（任意・急ぎではない）
- 設定画面UI整理（Step 3以降）
