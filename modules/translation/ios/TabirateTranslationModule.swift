import ExpoModulesCore
import Foundation
import Translation

/// Apple Translation Framework（`TranslationSession` / `LanguageAvailability`）を呼び出すローカルExpo Module。
///
/// **実機PoC専用。本番のOCR経路・メモ候補・保存処理・DBへは一切接続しない。**
///
/// 可用性の確認（`getAvailability` / `getSupportedLanguages`）はSwiftUI非依存で実行できるが、
/// 実際の翻訳とモデル準備（`prepare` / `translateBatch`）はモデルDL要求のために
/// SwiftUIホストView（`TabirateTranslationHostView`）がマウントされている必要がある。
public class TabirateTranslationModule: Module {
  public func definition() -> ModuleDefinition {
    Name("TabirateTranslation")

    View(TabirateTranslationHostView.self) {}

    /// この端末でTranslation APIが使えるか（iOS 18.0以降か）。
    /// iOS 18未満でもクラッシュせずfalseを返し、呼び出し側が原文表示へフォールバックできるようにする。
    Function("isSupportedOs") { () -> Bool in
      if #available(iOS 18.0, *) {
        return true
      }
      return false
    }

    /// 実機がサポートする翻訳言語の一覧。静的な想定リストを持たず、都度実機から取得する。
    AsyncFunction("getSupportedLanguages") { (promise: Promise) in
      guard #available(iOS 18.0, *) else {
        promise.reject(TranslationUnsupportedOsException("LanguageAvailabilityはiOS 18.0以降が必要です"))
        return
      }
      Task { @MainActor in
        let languages = LanguageAvailability().supportedLanguages
        promise.resolve(languages.map { $0.minimalIdentifier })
      }
    }

    /// 言語ペアの状態を取得する（installed / supported / unsupported）。
    /// ホストViewは不要。
    AsyncFunction("getAvailability") { (source: String, target: String, promise: Promise) in
      guard #available(iOS 18.0, *) else {
        promise.reject(TranslationUnsupportedOsException("LanguageAvailabilityはiOS 18.0以降が必要です"))
        return
      }
      Task { @MainActor in
        let sourceLanguage = Locale.Language(identifier: source)
        let targetLanguage = Locale.Language(identifier: target)
        let status = await LanguageAvailability().status(from: sourceLanguage, to: targetLanguage)
        promise.resolve([
          "sourceLanguage": sourceLanguage.minimalIdentifier,
          "targetLanguage": targetLanguage.minimalIdentifier,
          "status": Self.statusString(status),
        ])
      }
    }

    /// 言語モデルの事前ダウンロード。未導入ならシステムの許可UI・進捗UIがフレームワーク側から出る。
    /// 自前でダウンロードUIを再現しない。
    AsyncFunction("prepare") { (source: String, target: String, promise: Promise) in
      guard #available(iOS 18.0, *) else {
        promise.reject(TranslationUnsupportedOsException("TranslationSessionはiOS 18.0以降が必要です"))
        return
      }
      Task { @MainActor in
        Self.submit(
          kind: .prepare,
          source: source,
          target: target,
          texts: [],
          promise: promise
        )
      }
    }

    /// 複数テキストをまとめて翻訳する。
    /// Apple公式の指針どおり、1バッチ内は同一source言語であることを前提とする（混在は品質低下要因）。
    AsyncFunction("translateBatch") { (texts: [String], source: String, target: String, promise: Promise) in
      guard #available(iOS 18.0, *) else {
        promise.reject(TranslationUnsupportedOsException("TranslationSessionはiOS 18.0以降が必要です"))
        return
      }
      Task { @MainActor in
        Self.submit(
          kind: .translate,
          source: source,
          target: target,
          texts: texts,
          promise: promise
        )
      }
    }

    /// 未処理リクエストを破棄する。
    AsyncFunction("cancelAll") { (promise: Promise) in
      guard #available(iOS 18.0, *) else {
        promise.resolve(nil)
        return
      }
      Task { @MainActor in
        (TabirateTranslationRegistry.shared.current as? TabirateTranslationCoordinator)?.cancelAll()
        promise.resolve(nil)
      }
    }
  }

  /// マウント中のホストViewのcoordinatorへジョブを渡す。未マウントならその旨を返して終わる。
  @available(iOS 18.0, *)
  @MainActor
  private static func submit(
    kind: TabirateTranslationCoordinator.JobKind,
    source: String,
    target: String,
    texts: [String],
    promise: Promise
  ) {
    guard let coordinator = TabirateTranslationRegistry.shared.current as? TabirateTranslationCoordinator else {
      promise.reject(TranslationHostUnavailableException())
      return
    }
    coordinator.submit(
      .init(
        kind: kind,
        source: Locale.Language(identifier: source),
        target: Locale.Language(identifier: target),
        texts: texts,
        promise: promise,
        startedAt: Date()
      )
    )
  }

  @available(iOS 18.0, *)
  private static func statusString(_ status: LanguageAvailability.Status) -> String {
    switch status {
    case .installed: return "installed"
    case .supported: return "supported"
    case .unsupported: return "unsupported"
    @unknown default: return "unknown"
    }
  }
}
