import ExpoModulesCore
import Vision

// Apple Visionを直接呼び出すローカルExpo Module。
// iOSの通常OCR経路（CameraPreview.native.tsx → onOcrResult）で優先的に使い、
// 失敗時のみ現行の`expo-text-extractor`へフォールバックする。
// __DEV__比較パネル（ocr-benchmark.ts）からも新旧比較用に独立して呼ばれる。
public class VisionOcrModule: Module {
  public func definition() -> ModuleDefinition {
    Name("VisionOcr")

    AsyncFunction("recognizeText") { (uri: String, options: VisionOcrOptionsRecord) -> [String: Any] in
      try VisionOcrModule.performRecognizeText(uri: uri, options: options)
    }

    AsyncFunction("getSupportedLanguages") { (recognitionLevel: VisionOcrRecognitionLevel) -> [String] in
      // VNRecognizeTextRequestの最低要件(iOS 13+)は現行podspecのdeployment target(16.4)で常に満たされるが、
      // podspec側のtargetが将来下げられた場合にクラッシュせずエラーを返せるようにガードする。
      guard #available(iOS 16.0, *) else {
        throw VisionOcrOsNotSupportedException("VisionOcr requires iOS 16.0+")
      }
      return try VisionOcrRecognizer.supportedLanguages(for: recognitionLevel)
    }
  }

  private static func performRecognizeText(uri: String, options: VisionOcrOptionsRecord) throws -> [String: Any] {
    guard #available(iOS 16.0, *) else {
      throw VisionOcrOsNotSupportedException("VisionOcr requires iOS 16.0+")
    }

    let startedAt = Date()

    let loaded = try VisionOcrRecognizer.loadImage(uriString: uri)
    let supportedLanguages = try VisionOcrRecognizer.supportedLanguages(for: options.recognitionLevel)

    if !options.languages.isEmpty {
      let unsupported = options.languages.filter { !supportedLanguages.contains($0) }
      if !unsupported.isEmpty {
        throw VisionOcrUnsupportedLanguageException(unsupported)
      }
    }

    let maxCandidates = min(max(options.maxCandidates, 1), 5)

    let (lines, fullText) = try VisionOcrRecognizer.recognizeText(
      cgImage: loaded.cgImage,
      orientation: loaded.orientation,
      options: options,
      maxCandidates: maxCandidates
    )

    let elapsedMs = Date().timeIntervalSince(startedAt) * 1000

    return [
      "fullText": fullText,
      "lines": lines,
      "requestedLanguages": options.languages,
      "supportedLanguages": supportedLanguages,
      "recognitionLevel": options.recognitionLevel.rawValue,
      "elapsedMs": elapsedMs,
    ]
  }
}
