import ExpoModulesCore
import Vision

/// 認識精度モード。Apple Visionの`VNRequestTextRecognitionLevel`に対応する。
enum VisionOcrRecognitionLevel: String, Enumerable {
  case accurate
  case fast

  var visionValue: VNRequestTextRecognitionLevel {
    switch self {
    case .accurate: return .accurate
    case .fast: return .fast
    }
  }
}

/// JS側(`VisionOcrOptions`)から渡されるOCRオプション。
/// 未指定フィールドはVisionの既定挙動にできるだけ近い値をデフォルトにする。
struct VisionOcrOptionsRecord: Record {
  @Field var languages: [String] = []
  @Field var recognitionLevel: VisionOcrRecognitionLevel = .accurate
  @Field var usesLanguageCorrection: Bool = true
  @Field var automaticallyDetectsLanguage: Bool = false
  // 0 = 未指定扱い（Vision自体のデフォルトも0.0＝フィルタなし）
  @Field var minimumTextHeight: Double = 0
  @Field var maxCandidates: Int = 3
}
