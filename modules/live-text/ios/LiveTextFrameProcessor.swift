@preconcurrency import AVFoundation
import CoreMedia
import CoreVideo
import Foundation
import ImageIO
import Vision

/// 映像フレームを間引きながらApple Visionで文字認識する。
///
/// - フレームは`frameQueue`（serial）で同期的に処理する。処理中に届いたフレームは
///   `alwaysDiscardsLateVideoFrames`によりAVFoundation側で捨てられるため、同時に処理するのは常に1枚。
/// - フレーム（画像）はメモリ上で認識して即座に破棄する。ファイルへは一切書き出さない。
final class LiveTextFrameProcessor: NSObject, AVCaptureVideoDataOutputSampleBufferDelegate {
  /// sessionへの出力の付け外しを直列化するキュー（全インスタンス共通）。
  static let configQueue = DispatchQueue(label: "com.estep.travelratecamera.livetext.config")

  private let frameQueue = DispatchQueue(label: "com.estep.travelratecamera.livetext.frames", qos: .userInitiated)

  private struct Settings {
    var active = false
    var intervalMs: Double = 1000
    var languages: [String] = []
    var minimumTextHeight: Double = 0
  }

  private let lock = NSLock()
  private var settings = Settings()

  // 以下はframeQueue上でのみ触る
  private var lastRecognitionAt: CFAbsoluteTime = 0
  private var supportedLanguagesCache: [String]?

  /// 1回の認識が終わるたびに呼ばれる（frameQueue上）。行が0件でも呼ぶ（古い表示を消すため）。
  var onRecognized: (([String: Any]) -> Void)?

  /// 1フレームあたりにJSへ返す行数の上限（イベントを肥大化させない）。
  private static let maxLines = 80

  func update(active: Bool, intervalMs: Double, languages: [String], minimumTextHeight: Double) {
    lock.lock()
    defer { lock.unlock() }
    settings = Settings(
      active: active,
      intervalMs: max(intervalMs, 300),
      languages: languages,
      minimumTextHeight: min(max(minimumTextHeight, 0), 1)
    )
  }

  private func currentSettings() -> Settings {
    lock.lock()
    defer { lock.unlock() }
    return settings
  }

  /// sessionへ追加する出力を作る。付け直すたびに新しい出力を作る（一度外した出力を使い回さない）。
  func makeOutput() -> AVCaptureVideoDataOutput {
    let output = AVCaptureVideoDataOutput()
    output.alwaysDiscardsLateVideoFrames = true
    output.videoSettings = [
      kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_420YpCbCr8BiPlanarFullRange,
    ]
    output.setSampleBufferDelegate(self, queue: frameQueue)
    return output
  }

  func captureOutput(
    _ output: AVCaptureOutput,
    didOutput sampleBuffer: CMSampleBuffer,
    from connection: AVCaptureConnection
  ) {
    let current = currentSettings()
    guard current.active else { return }

    let startedAt = CFAbsoluteTimeGetCurrent()
    guard (startedAt - lastRecognitionAt) * 1000 >= current.intervalMs else { return }
    lastRecognitionAt = startedAt

    guard let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }

    let orientation = Self.visionOrientation(for: connection)
    let bufferWidth = CVPixelBufferGetWidth(pixelBuffer)
    let bufferHeight = CVPixelBufferGetHeight(pixelBuffer)
    // Visionへ渡す向きで90度回転する場合、正立画像の幅・高さはバッファと入れ替わる
    let isRotated = orientation == .right || orientation == .left
    let uprightWidth = isRotated ? bufferHeight : bufferWidth
    let uprightHeight = isRotated ? bufferWidth : bufferHeight

    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = true
    if current.minimumTextHeight > 0 {
      request.minimumTextHeight = Float(current.minimumTextHeight)
    }

    let languages = resolveLanguages(current.languages)
    if !languages.isEmpty {
      request.recognitionLanguages = languages
    } else if #available(iOS 16.0, *) {
      // 指定言語が1つも使えない端末では、Visionの言語自動判定に任せる
      request.automaticallyDetectsLanguage = true
    }

    let handler = VNImageRequestHandler(cvPixelBuffer: pixelBuffer, orientation: orientation, options: [:])
    do {
      try handler.perform([request])
    } catch {
      // 1フレームの失敗は次のフレームで取り返せるため、JSへは何も送らない
      return
    }

    let observations = request.results ?? []
    var lines: [[String: Any]] = []
    for observation in observations {
      guard let best = observation.topCandidates(1).first else { continue }
      let box = observation.boundingBox
      // Visionの正規化座標は「左下原点」。JSでそのまま描画に使えるよう「左上原点」へ変換する
      lines.append([
        "text": best.string,
        "confidence": Double(best.confidence),
        "x": Double(box.minX),
        "y": Double(1 - box.maxY),
        "width": Double(box.width),
        "height": Double(box.height),
      ])
      if lines.count >= Self.maxLines { break }
    }

    onRecognized?([
      "lines": lines,
      "imageWidth": uprightWidth,
      "imageHeight": uprightHeight,
      "elapsedMs": (CFAbsoluteTimeGetCurrent() - startedAt) * 1000,
      "timestamp": Date().timeIntervalSince1970 * 1000,
    ])
  }

  /// 実機の対応言語だけに絞る（既存のvision-ocrのように未対応言語でエラーにしない）。
  private func resolveLanguages(_ requested: [String]) -> [String] {
    guard !requested.isEmpty else { return [] }
    if supportedLanguagesCache == nil {
      let probe = VNRecognizeTextRequest()
      probe.recognitionLevel = .accurate
      supportedLanguagesCache = (try? probe.supportedRecognitionLanguages()) ?? []
    }
    let supported = supportedLanguagesCache ?? []
    if supported.isEmpty { return requested }
    return requested.filter { supported.contains($0) }
  }

  /// 映像フレームの向きを、文字が正立して見えるVision用の向きへ変換する。
  /// アプリは縦画面固定。背面カメラのフレームは通常センサー本来の横向きで届くため`.right`になる。
  /// 接続側で回転済み（縦向き）で届く端末・OSでも正しく扱えるよう、接続の実際の向きから決める。
  static func visionOrientation(for connection: AVCaptureConnection) -> CGImagePropertyOrientation {
    if #available(iOS 17.0, *) {
      switch Int(connection.videoRotationAngle.rounded()) {
      case 90: return .up
      case 180: return .left
      case 270: return .down
      default: return .right
      }
    }
    switch connection.videoOrientation {
    case .portrait: return .up
    case .portraitUpsideDown: return .down
    case .landscapeLeft: return .left
    case .landscapeRight: return .right
    @unknown default: return .right
    }
  }
}
