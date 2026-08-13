import ExpoModulesCore

// TabirateTranslation のエラー種別。
// `code`はExceptionの型名から自動生成される（例: TranslationHostUnmountedException → ERR_TRANSLATION_HOST_UNMOUNTED）。
// PoCでは「なぜ翻訳できなかったか」を原因ごとに切り分けることが目的なので、まとめて1種類にしない。

/// iOS 18.0未満。TranslationSession・LanguageAvailability自体が存在しない。
internal final class TranslationUnsupportedOsException: GenericException<String> {
  override var reason: String {
    "この機能は現在のOSバージョンでサポートされていません: \(param)"
  }
}

/// SwiftUIホストViewがまだマウントされていない（＝モデルDL可能なsessionを取得できない）。
internal final class TranslationHostUnavailableException: Exception {
  override var reason: String {
    "翻訳ホストViewがマウントされていません。TranslationHostを画面に配置してから呼び出してください"
  }
}

/// 処理待ち・処理中にホストViewが画面から外れた。
/// TranslationSessionをView消失後に使うとfatalErrorになるため、実行せずに失敗させる。
internal final class TranslationHostUnmountedException: Exception {
  override var reason: String {
    "翻訳ホストViewが画面から外れたため、リクエストを破棄しました"
  }
}

/// translationTaskのTaskがキャンセルされた（View消失・設定変更・明示cancel）。
internal final class TranslationCancelledException: Exception {
  override var reason: String {
    "翻訳リクエストがキャンセルされました"
  }
}

/// Translation framework側が投げたエラー（言語未導入・DL拒否・実行時失敗など）。
internal final class TranslationFailedException: GenericException<String> {
  override var reason: String {
    "翻訳に失敗しました: \(param)"
  }
}
