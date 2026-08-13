import ExpoModulesCore
import Foundation
import Translation

/// JS側リクエストとSwiftUIの`translationTask`を橋渡しする調停役。
///
/// **設計上の最重要ルール**
/// Apple公式が明記しているとおり、`TranslationSession`は「紐づいたViewが消えた後」または
/// 「configurationを変更した後」に使うと`fatalError`になる。
/// そのため本クラスは **sessionをプロパティとして一切保持しない**。
/// sessionを触ってよいのは`drain(using:)`のスコープ内だけで、抜けたら参照を捨てる。
///
/// JSからのリクエストはいったん`pending`へ積み、configurationを更新して
/// `translationTask`のactionを起動させ、その中で処理する。
/// ホストViewが外れた場合は未処理リクエストをすべて失敗させ、sessionには触れない。
@available(iOS 18.0, *)
@MainActor
internal final class TabirateTranslationCoordinator: ObservableObject {

  internal enum JobKind {
    case translate
    case prepare
  }

  internal struct Job {
    let kind: JobKind
    let source: Locale.Language
    let target: Locale.Language
    let texts: [String]
    let promise: Promise
    let startedAt: Date
  }

  /// SwiftUI側が監視する設定。`translationTask`はこの値が変わるたびに新しいsessionでactionを再実行する。
  @Published private(set) var configuration: TranslationSession.Configuration?

  private var pending: [Job] = []

  /// ホストViewが画面上に存在する間だけtrue。falseの間はsessionを一切触らない。
  private var isHostAlive = false

  // MARK: - JS側からの受付

  func submit(_ job: Job) {
    guard isHostAlive else {
      job.promise.reject(TranslationHostUnavailableException())
      return
    }
    pending.append(job)
    applyConfiguration(source: job.source, target: job.target)
  }

  /// 同じ言語ペアなら`invalidate()`で再実行、違うペアなら新しい設定へ差し替える。
  /// どちらの場合も必ず再代入して`@Published`を発火させる
  /// （`invalidate()`がmutatingかどうかの実装詳細に依存しないようにするため）。
  private func applyConfiguration(source: Locale.Language, target: Locale.Language) {
    if var current = configuration, current.source == source, current.target == target {
      current.invalidate()
      configuration = current
    } else {
      configuration = TranslationSession.Configuration(source: source, target: target)
    }
  }

  // MARK: - SwiftUIの translationTask から呼ばれる

  /// **`session`はこのスコープ外へ絶対に持ち出さない。**
  /// 現在のconfigurationと同じ言語ペアのジョブだけを処理する。
  /// 別ペアのジョブが残っていれば、設定を切り替えて次のtranslationTask実行へ引き継ぐ。
  func drain(using session: TranslationSession) async {
    let source = configuration?.source
    let target = configuration?.target

    while isHostAlive, !Task.isCancelled {
      guard let index = pending.firstIndex(where: { $0.source == source && $0.target == target }) else {
        break
      }
      let job = pending.remove(at: index)
      await run(job, using: session)
    }

    if isHostAlive, !Task.isCancelled, let next = pending.first {
      applyConfiguration(source: next.source, target: next.target)
    }
  }

  private func run(_ job: Job, using session: TranslationSession) async {
    // 待機中にViewが外れていた場合はsessionへ触れずに失敗させる（fatalError回避）
    guard isHostAlive, !Task.isCancelled else {
      job.promise.reject(TranslationHostUnmountedException())
      return
    }

    do {
      switch job.kind {
      case .prepare:
        try await session.prepareTranslation()
        job.promise.resolve([
          "prepared": true,
          "elapsedMs": Self.elapsedMs(since: job.startedAt),
        ])

      case .translate:
        let requests = job.texts.enumerated().map { index, text in
          TranslationSession.Request(sourceText: text, clientIdentifier: String(index))
        }
        // translations(from:)は送った順と同じ順序で返る（Apple公式記載）
        let responses = try await session.translations(from: requests)
        let results: [[String: Any]] = responses.map { response in
          [
            "sourceText": response.sourceText,
            "translatedText": response.targetText,
            "sourceLanguage": response.sourceLanguage.minimalIdentifier,
            "targetLanguage": response.targetLanguage.minimalIdentifier,
            "clientIdentifier": response.clientIdentifier ?? "",
          ]
        }
        job.promise.resolve([
          "results": results,
          "elapsedMs": Self.elapsedMs(since: job.startedAt),
        ])
      }
    } catch is CancellationError {
      job.promise.reject(TranslationCancelledException())
    } catch {
      job.promise.reject(TranslationFailedException(error.localizedDescription))
    }
  }

  // MARK: - ホストViewのライフサイクル

  func hostDidAppear() {
    isHostAlive = true
  }

  /// ホストViewが画面から外れた時に呼ぶ。
  /// 未処理ジョブをすべて失敗させ、configurationも破棄する。sessionには触れない。
  func hostDidDisappear() {
    isHostAlive = false
    configuration = nil
    failAll(with: TranslationHostUnmountedException())
  }

  /// JSからの明示キャンセル。未処理ジョブを破棄する。
  func cancelAll() {
    configuration = nil
    failAll(with: TranslationCancelledException())
  }

  private func failAll(with exception: Exception) {
    let cancelled = pending
    pending.removeAll()
    for job in cancelled {
      job.promise.reject(exception)
    }
  }

  private static func elapsedMs(since date: Date) -> Double {
    Date().timeIntervalSince(date) * 1000
  }
}
