import ImageIO
import UIKit
import Vision

/// Apple Visionを直接呼び出すOCRの中核処理。
/// `VisionOcrModule`（Expo Modulesの定義DSL）を薄く保つため、画像読み込み・言語チェック・
/// テキスト認識のロジックはここに集約する。
enum VisionOcrRecognizer {
  struct LoadedImage {
    let cgImage: CGImage
    let orientation: CGImagePropertyOrientation
  }

  /// 画像URI（`file://...`または素のパス）からCGImageと向きを読み込む。
  /// ファイル未存在・URI不正・デコード失敗・CGImage変換失敗を区別してthrowする。
  static func loadImage(uriString: String) throws -> LoadedImage {
    guard let url = resolveFileURL(from: uriString) else {
      throw VisionOcrInvalidUriException(uriString)
    }
    guard FileManager.default.fileExists(atPath: url.path) else {
      throw VisionOcrFileNotFoundException(uriString)
    }
    guard let data = try? Data(contentsOf: url) else {
      throw VisionOcrImageDecodeFailedException(uriString)
    }
    guard let image = UIImage(data: data) else {
      throw VisionOcrImageDecodeFailedException(uriString)
    }
    guard let cgImage = image.cgImage else {
      throw VisionOcrCgImageConversionFailedException(uriString)
    }
    return LoadedImage(cgImage: cgImage, orientation: cgImagePropertyOrientation(from: image.imageOrientation))
  }

  /// `file://`付き・素のファイルパスの両方を受け付ける。file以外のスキーム（http等）はURI不正として扱う。
  private static func resolveFileURL(from uriString: String) -> URL? {
    guard !uriString.isEmpty else { return nil }
    if let url = URL(string: uriString), let scheme = url.scheme {
      return scheme == "file" ? url : nil
    }
    return URL(fileURLWithPath: uriString)
  }

  /// 指定した認識モードで、実機がサポートする言語一覧を取得する。
  static func supportedLanguages(for level: VisionOcrRecognitionLevel) throws -> [String] {
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = level.visionValue
    do {
      return try request.supportedRecognitionLanguages()
    } catch {
      throw VisionOcrRequestFailedException("supportedRecognitionLanguages: \(error.localizedDescription)")
    }
  }

  /// Vision text recognitionを実行し、行ごとの結果（JSへそのまま返せる辞書形式）と全文を返す。
  static func recognizeText(
    cgImage: CGImage,
    orientation: CGImagePropertyOrientation,
    options: VisionOcrOptionsRecord,
    maxCandidates: Int
  ) throws -> (lines: [[String: Any]], fullText: String) {
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = options.recognitionLevel.visionValue
    request.usesLanguageCorrection = options.usesLanguageCorrection

    // automaticallyDetectsLanguageはiOS 16以降のみのプロパティ。
    // 未対応OSではこの設定だけを静かにスキップし、他の設定・OCR自体はそのまま実行する。
    if #available(iOS 16.0, *) {
      request.automaticallyDetectsLanguage = options.automaticallyDetectsLanguage
    }

    if options.minimumTextHeight > 0 {
      request.minimumTextHeight = Float(options.minimumTextHeight)
    }

    if !options.languages.isEmpty {
      request.recognitionLanguages = options.languages
    }

    let handler = VNImageRequestHandler(cgImage: cgImage, orientation: orientation, options: [:])

    do {
      try handler.perform([request])
    } catch {
      throw VisionOcrRequestFailedException(error.localizedDescription)
    }

    guard let observations = request.results as? [VNRecognizedTextObservation], !observations.isEmpty else {
      throw VisionOcrNoResultException()
    }

    let lines = sortByReadingOrder(observations).map { observation -> [String: Any]? in
      let topCandidates = observation.topCandidates(maxCandidates)
      guard let best = topCandidates.first else { return nil }
      let candidateDicts: [[String: Any]] = topCandidates.map {
        ["text": $0.string, "confidence": Double($0.confidence)]
      }
      let box = observation.boundingBox
      return [
        "text": best.string,
        "confidence": Double(best.confidence),
        // Visionの正規化座標（原点は画像の左下）をそのまま保持する。画面描画用の変換はここでは行わない。
        "boundingBox": [
          "x": box.origin.x,
          "y": box.origin.y,
          "width": box.size.width,
          "height": box.size.height,
        ],
        "candidates": candidateDicts,
      ]
    }.compactMap { $0 }

    let fullText = lines.compactMap { $0["text"] as? String }.joined(separator: "\n")
    return (lines, fullText)
  }

  /// Visionの返却順は保証されないため、正規化座標（左下原点）を基準に
  /// 「上から下、同じ高さなら左から右」の読み順へ安定ソートする。
  /// 文章の校正・翻訳・言い換えは一切行わない。
  private static func sortByReadingOrder(
    _ observations: [VNRecognizedTextObservation]
  ) -> [VNRecognizedTextObservation] {
    let sameLineThreshold: CGFloat = 0.01
    return observations.enumerated().sorted { lhs, rhs in
      let a = lhs.element.boundingBox
      let b = rhs.element.boundingBox
      if abs(a.origin.y - b.origin.y) > sameLineThreshold {
        return a.origin.y > b.origin.y
      }
      if a.origin.x != b.origin.x {
        return a.origin.x < b.origin.x
      }
      return lhs.offset < rhs.offset
    }.map { $0.element }
  }
}
