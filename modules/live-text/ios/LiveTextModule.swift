import ExpoModulesCore

// カメラ映像のリアルタイム文字認識（スマートカメラ・翻訳ページのカメラ翻訳）のローカルExpo Module。
//
// 既存のexpo-camera（CameraView）が動かしているAVCaptureSessionへ映像フレーム出力
// （AVCaptureVideoDataOutput）を1つだけ追加し、一定間隔ごとにApple Vision
// （VNRecognizeTextRequest）で文字を認識する。
//
// なぜ自前のカメラを作らないのか：
//   メインカメラのシャッター（takePictureAsync）→価格OCR→保存は完成済みの正式フローであり、
//   CameraViewを置き換えると撮影・ズーム・権限の挙動がすべて変わってしまう。
//   出力を1つ足すだけなら、撮影の経路（写真出力・入力デバイス・プレビュー）には一切触れずに済む。
// なぜ定期的にtakePictureAsyncしないのか：
//   日本で販売されたiPhoneは写真撮影のシャッター音を消せないため、撮影のたびに音が鳴る。
//   また撮影のたびに画像ファイルが書き出される。映像フレームなら音も出ずファイルも残らない。
public class LiveTextModule: Module {
  public func definition() -> ModuleDefinition {
    Name("LiveText")

    View(LiveTextScannerView.self) {
      Events("onTextDetected", "onScannerStatus")

      /// falseにすると出力をsessionから外す（安全スイッチ）。
      Prop("enabled") { (view: LiveTextScannerView, value: Bool) in
        view.isScannerEnabled = value
      }

      /// trueの間はフレームを捨てるだけで、出力の付け外しはしない（シャッター処理中など）。
      Prop("paused") { (view: LiveTextScannerView, value: Bool) in
        view.isScannerPaused = value
      }

      /// 認識の最小間隔(ms)。300未満は300に丸める。
      Prop("intervalMs") { (view: LiveTextScannerView, value: Double) in
        view.intervalMs = value
      }

      /// Visionの認識言語（例: ko-KR, en-US）。実機が対応しない言語は黙って除外する。
      Prop("languages") { (view: LiveTextScannerView, value: [String]) in
        view.languages = value
      }

      /// 検出する最小の文字の高さ（画像高さに対する比率 0〜1）。0でフィルタなし。
      Prop("minimumTextHeight") { (view: LiveTextScannerView, value: Double) in
        view.minimumTextHeight = value
      }

      OnViewDidUpdateProps { (view: LiveTextScannerView) in
        view.applyProps()
      }
    }
  }
}
