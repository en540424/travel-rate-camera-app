# デザイントークン比較表

参考デザイン（Apple / Wise / Revolut / Airbnb）と現行 designTokens.ts の差分を管理するファイル。
参考デザインを取り込んだあとに、ここを埋めてから designTokens.ts を更新する。

---

## 比較表

### カラー

| トークン名 | 現行 DT | Apple | Wise | Revolut | Airbnb | 採用候補 | 備考 |
|-----------|---------|-------|------|---------|--------|---------|------|
| primary | `#14A3A0` | `#0066cc` | `#9fe870` | `#494fdf` | `#ff385c` | **`#14A3A0` 維持** | アプリ独自のティール。参照3社はブランド異色のため変更不要 |
| primaryDark | `#0E7F7C` | `#0071e3` (focus) | `#163300` | `#3a40c4` | `#e00b41` | **`#0E7F7C` 維持** | プレス状態用。現行値が自然なティールダーク |
| primarySoft | `#DDF7F5` | — | `#e2f6d5` (pale) | — | — | **`#DDF7F5` 維持** | 候補バッジ背景・ハイライト用 |
| background | `#F8FAFA` | `#f5f5f7` (parchment) | `#e8ebe6` (canvas-soft) | `#f4f4f4` | `#f7f7f7` | **`#F8FAFA` 維持** | わずかにティール味のある薄灰。ブランドとの一貫性優先 |
| surface | `#FFFFFF` | `#ffffff` | `#ffffff` | `#ffffff` | `#ffffff` | `#FFFFFF` | 全社共通。変更なし |
| textPrimary | `#1F2933` | `#1d1d1f` | `#0e0f0c` | `#191c1f` | `#222222` | **`#1F2933` 維持** | Revolut #191c1f に最も近い。現行値で可 |
| textSecondary | `#6B7280` | `#7a7a7a` (muted-48) | `#454745` (body) | `#505a63` (mute) | `#6a6a6a` (muted) | **`#6B7280` 維持** | 参照各社の中間値。読み取り性に問題なし |
| textMuted | `#9CA3AF` | `#cccccc` (on-dark) | `#868685` | `#8d969e` | `#929292` | `#9CA3AF` または `#8E9BAA` | Wise/Revolut より若干明るい。コントラスト4.5:1以上を要確認 |
| border | `#E5E7EB` | `#e0e0e0` | `#e8ebe6` | `#e2e2e7` | `#dddddd` | **`#E5E7EB` 維持** | 全社がほぼ同値帯(#ddd〜#e8e)。現行値は中間 |
| borderSoft | `#EEF2F2` | `#f0f0f0` (divider-soft) | — | — | `#ebebeb` | **`#EEF2F2` 維持** | 薄ボーダー用。現行値は妥当 |
| candidate | `#F59E0B` | — | `#ffd11a` (warning) | `#ec7e00` (warning) | — | **`#F59E0B` 維持** | 候補ステータス色。アンバー系は旅行アプリ文脈に合致 |
| candidateBg | `#FEF3C7` | — | `#ffc091` (accent) | — | — | **`#FEF3C7` 維持** | candidate の背景色 |
| purchased | `#14A3A0` | — | `#2ead4b` (positive) | `#00a87e` (teal) | — | **`#14A3A0` 維持** | ティールをステータス色に兼用。一貫性あり |
| purchasedBg | `#DDF7F5` | — | — | — | — | **`#DDF7F5` 維持** | primarySoft と同値。整合性あり |
| danger | `#E35D5B` | — | `#d03238` | `#e23b4a` | `#c13515` | **`#E35D5B` 維持** | Revolut #e23b4a に近い。現行値は彩度やや低め、柔らかく見える |
| dangerSoft | `#FDECEC` | — | `#320707` (on-dark) | — | — | **`#FDECEC` 維持** | エラー背景色 |
| accent | `#FFB84D` | — | `#ffc091` (orange) | — | — | **`#FFB84D` 維持** | ウォームアクセント。現行値は妥当 |

---

### 角丸

| トークン名 | 現行 DT | Apple | Wise | Revolut | Airbnb | 採用候補 | 備考 |
|-----------|---------|-------|------|---------|--------|---------|------|
| radius.sm | `10` | `8` (sm) | `8` | `8` | `8` | **`8` に更新推奨** | 全社が8px。10は少し大きい。ラベルや小チップに影響 |
| radius.md | `14` | `11` (md) | `12` | `12` | `14` | **`12` に更新推奨** | Wise/Revolutが12。Airbnb14と迷うが12がfintech標準 |
| radius.lg | `18` | `18` (lg) | `16` | `20` | `20` | **`18` 維持** | Appleと一致。カード角丸として適切 |
| radius.xl | `24` | — | `24` (xl) | `28` | `32` | **`24` 維持** | Wiseと一致。大きすぎず適切 |
| radius.pill | `999` | `9999` | `9999` | `9999` | `9999` | `999` 維持 | 実質的に同義。RN慣習値で可 |

---

### フォントサイズ

| 用途 / トークン | 現行 DT | Apple | Wise | Revolut | Airbnb | 採用候補 | 備考 |
|--------------|---------|-------|------|---------|--------|---------|------|
| xs (12px) | `12` | `12` (fine-print) | `12` (caption) | `13` (caption) | `13` (caption-sm) | **`12` 維持** | ラベル最小値 |
| sm (14px) | `14` | `14` (caption) | `14` (body-sm) | `14` (body-sm) | `14` (body-sm) | **`14` 維持** | 副テキスト標準 |
| md (16px) | `16` | `17` (body) | `16` (body-md) | `16` (body-md) | `16` (body-md) | **`16` 維持** | Wise/Revolut/Airbnb 共通。Apple だけ17px |
| lg (20px) | `20` | `21` (tagline) | `20` (body-lg) | `20` (heading-sm) | `20` (display-sm) | **`20` 維持** | 小見出し・金額表示 |
| xl (28px) | `28` | `28` (lead) | `24` (display-xs) | `24` (heading-md) | `28` (display-xl) | **`28` 維持** | 大金額表示。Apple / Airbnb も28px台使用 |
| xxl (36px) | `36` | `40` (display-lg) | `32` (display-sm) | `32` (heading-lg) | — | **`36` 維持** | ヒーロー数値表示 |
| 大金額表示 | `28px/700` | `28px/400` (lead) | `24px/600` (xs) | `32px/500` (heading-lg) | `28px/700` (display-xl) | **`28px/700` 維持** | 購入金額は太字強調が適切 |
| 中金額 | `20px/600` | `21px/600` (tagline) | `20px/400` (body-lg) | `20px/500` (heading-sm) | `20px/600` (display-sm) | **`20px/600` 維持** | |
| 通貨コード | `14px/600` | `14px/600` (caption-strong) | `14px/600` (body-sm-strong) | `14px/600` (button-sm) | `14px/500` (caption) | **`14px/600` 維持** | |

---

### フォントウェイト

| トークン名 | 現行 DT | Apple | Wise | Revolut | Airbnb | 採用候補 | 備考 |
|-----------|---------|-------|------|---------|--------|---------|------|
| regular | `'400'` | 400 | 400 | 400 | 400 | `'400'` 維持 | |
| medium | `'500'` | — (未使用) | 500 (display) | 500 (display/button) | 500 (nav) | `'500'` 維持 | Appleは300/400/600/700のみ。他社はmedium使用 |
| semibold | `'600'` | 600 (headline) | 600 (inter body) | 600 (button/bold) | 600 (title) | `'600'` 維持 | |
| bold | `'700'` | — (600で代用) | 700 (Wise Sans) | 700 (link-emph) | 700 (display) | `'700'` 維持 | 金額強調に使用中 |

---

### 影（shadow）

| トークン名 | 現行 DT | Apple | Wise | Revolut | 採用候補 | 備考 |
|-----------|---------|-------|------|---------|---------|------|
| shadowOpacity | `0.06` | `0.22` (product) / なし(card) | — | — | **`0.06` 維持** | Appleはカードに影なし。fintech系も微影。0.06は適切 |
| shadowRadius | `12` | `30` (product) | — | — | **`12` 維持** | ぼかし量は現行値がモバイルに適切 |
| shadowOffset.y | `4` | `5` (product) | — | — | **`4` 維持** | |

---

## 推奨変更サマリー

変更すべき値（採用候補が「更新推奨」のもの）:

| 項目 | 現行 | 推奨値 | 影響画面 |
|------|------|--------|---------|
| `radius.sm` | `10` | `8` | 小タグ、バッジ、インラインチップ全般 |
| `radius.md` | `14` | `12` | カード内セクション、入力フィールド |

その他のトークンは現行値を維持。

---

## 更新手順

1. designTokens.ts で `radius.sm: 10 → 8`、`radius.md: 14 → 12` を変更
2. history.tsx / analytics.tsx / camera画面を実機確認
3. 変更によって角丸が崩れる箇所があれば個別に `radius.lg` を当てて調整
4. 問題なければ完了

---

## 参照ファイル

- `apple-design.md` — Apple.com デザイン分析（写真主役・SF Pro・単一アクセントブルー）
- `wise-design.md` — Wise デザイン分析（ライムグリーン・Wise Sans 900・セージキャンバス）
- `revolut-design.md` — Revolut デザイン分析（コバルト・Aeonik Pro・黒/白コントラスト）
- `airbnb-design.md` — Airbnb デザイン分析（ラウシュレッド・Cereal VF・温かいホワイト）
