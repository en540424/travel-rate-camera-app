import Foundation

/// 現在マウントされている翻訳ホストViewのcoordinatorを1つだけ保持する。
///
/// `TranslationCoordinator`はiOS 18.0以降でしか存在しない型のため、
/// このレジストリ自体はOSバージョンに依存しない`AnyObject`で保持し、
/// 利用側で`if #available(iOS 18.0, *)`とキャストを行う。
///
/// 保持は必ずweak。Viewが破棄された後にcoordinator経由でsessionへ触れないようにするため、
/// 強参照は持たない。
@MainActor
internal final class TabirateTranslationRegistry {
  static let shared = TabirateTranslationRegistry()

  private init() {}

  private weak var coordinatorRef: AnyObject?

  func register(_ coordinator: AnyObject) {
    coordinatorRef = coordinator
  }

  /// 自分が登録したcoordinatorのときだけ解除する（別Viewが既に登録済みなら触らない）。
  func unregister(_ coordinator: AnyObject) {
    if coordinatorRef === coordinator {
      coordinatorRef = nil
    }
  }

  var current: AnyObject? {
    coordinatorRef
  }
}
