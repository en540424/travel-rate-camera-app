# 読み取り中 ・ components

`main/` と同一スクリーンの `phase='scanning'` 表示。

| Component | 状態 | 流用元 |
|---|---|---|
| `TripRateHeader` | 同一 | main/ |
| `ModeSegment` | `disabled`（opacity 0.55） | main/ |
| `ScanningOverlay` | カメラ枠を暗転＋スキャンライン＋状態pill（**この状態のみ**） | 新規（CameraStage の子） |
| `ShutterButton` | 無効表示「金額とメモを認識中…」 | main/（disabled派生） |
| `BottomTabBar` | active=カメラ | 共通 |

## ツリー

```
<MainCameraScreen phase="scanning">
├─ <TripRateHeader/>
├─ <ModeSegment disabled/>
├─ <CameraStage>
│   └─ <ScanningOverlay/>   // 暗転・ライン・「読み取り中…」pill
└─ <ShutterButton disabled label="金額とメモを認識中…"/>
```

## ポイント

- 別画面ではなく `phase` の値。`main/` と同じファイル内で出し分ける。
- 待ち時間の不安軽減が目的（ライン＋テキスト）。完了で結果パネルへ。
