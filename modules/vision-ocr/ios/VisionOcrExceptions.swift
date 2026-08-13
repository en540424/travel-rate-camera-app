import ExpoModulesCore

// VisionOcr のエラー種別。
// promiseを「OCR failed」のような一つのメッセージへまとめず、原因ごとに区別できるようにする。
// `code`はExceptionの型名から自動生成される（例: VisionOcrFileNotFoundException → ERR_VISION_OCR_FILE_NOT_FOUND）。

internal final class VisionOcrFileNotFoundException: GenericException<String> {
  override var reason: String {
    "指定されたURIに画像ファイルが見つかりません: \(param)"
  }
}

internal final class VisionOcrInvalidUriException: GenericException<String> {
  override var reason: String {
    "画像URIを解釈できません: \(param)"
  }
}

internal final class VisionOcrImageDecodeFailedException: GenericException<String> {
  override var reason: String {
    "画像データのデコードに失敗しました: \(param)"
  }
}

internal final class VisionOcrCgImageConversionFailedException: GenericException<String> {
  override var reason: String {
    "画像からCGImageへの変換に失敗しました: \(param)"
  }
}

internal final class VisionOcrUnsupportedLanguageException: GenericException<[String]> {
  override var reason: String {
    "指定言語がこの端末・認識モードでサポートされていません: \(param.joined(separator: ", "))"
  }
}

internal final class VisionOcrRequestFailedException: GenericException<String> {
  override var reason: String {
    "Vision text recognition requestに失敗しました: \(param)"
  }
}

internal final class VisionOcrNoResultException: Exception {
  override var reason: String {
    "Vision requestは成功しましたが、認識結果が0件でした"
  }
}

internal final class VisionOcrOsNotSupportedException: GenericException<String> {
  override var reason: String {
    "この機能は現在のOSバージョンでサポートされていません: \(param)"
  }
}
