import ExpoModulesCore
import SwiftUI
import Translation
import UIKit

/// `translationTask`を張るためだけのSwiftUIルート。描画物は持たない（透明）。
/// sessionはactionクロージャの引数としてのみ受け取り、coordinatorへ即座に渡して使い切る。
@available(iOS 18.0, *)
internal struct TabirateTranslationHostRootView: View {
  @ObservedObject var coordinator: TabirateTranslationCoordinator

  var body: some View {
    Color.clear
      .translationTask(coordinator.configuration) { session in
        await coordinator.drain(using: session)
      }
  }
}

/// React Nativeのツリーへマウントする透明なホストView。
///
/// モデル未導入時のダウンロード許可を出せる`TranslationSession`は、Apple公式上
/// SwiftUIの`translationTask`経由でしか取得できない（iOS 26+の`init(installedSource:target:)`は
/// 導入済み言語専用でDLを要求できない）。そのため実体のないSwiftUI Viewを画面に置き、
/// **そのViewの寿命 = sessionを使ってよい期間**として扱う。
///
/// iOS 18.0未満ではTranslation関連の型が存在しないため、ホスティング自体を行わない
/// （Viewは透明な空Viewとして存在するだけで、JS側APIはunsupported_osで失敗する）。
internal final class TabirateTranslationHostView: ExpoView {
  private var hostingController: UIViewController?

  /// iOS 18.0未満では`TabirateTranslationCoordinator`型が存在しないためAnyObjectで保持する
  private var coordinatorRef: AnyObject?

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    isUserInteractionEnabled = false
    backgroundColor = .clear

    if #available(iOS 18.0, *) {
      let coordinator = TabirateTranslationCoordinator()
      let controller = UIHostingController(rootView: TabirateTranslationHostRootView(coordinator: coordinator))
      controller.view.backgroundColor = .clear
      controller.view.isUserInteractionEnabled = false
      coordinatorRef = coordinator
      hostingController = controller
    }
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    if window == nil {
      detachHostingController()
    } else {
      attachHostingController()
    }
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    hostingController?.view.frame = bounds
  }

  /// SwiftUIのライフサイクル（onAppear/task系）を正しく動かすため、
  /// 単にaddSubviewするのではなく親UIViewControllerへ子として追加する。
  private func attachHostingController() {
    guard let controller = hostingController,
          controller.parent == nil,
          let parent = closestViewController() else {
      return
    }
    parent.addChild(controller)
    controller.view.frame = bounds
    addSubview(controller.view)
    controller.didMove(toParent: parent)

    if #available(iOS 18.0, *), let coordinator = coordinatorRef as? TabirateTranslationCoordinator {
      coordinator.hostDidAppear()
      TabirateTranslationRegistry.shared.register(coordinator)
    }
  }

  /// 画面から外れたら、まずcoordinatorを停止させてから（＝以降sessionへ触れない状態にしてから）
  /// hosting controllerを取り外す。順序を逆にすると、停止前にSwiftUI側が破棄されうる。
  private func detachHostingController() {
    if #available(iOS 18.0, *), let coordinator = coordinatorRef as? TabirateTranslationCoordinator {
      TabirateTranslationRegistry.shared.unregister(coordinator)
      coordinator.hostDidDisappear()
    }

    guard let controller = hostingController, controller.parent != nil else {
      return
    }
    controller.willMove(toParent: nil)
    controller.view.removeFromSuperview()
    controller.removeFromParent()
  }

  private func closestViewController() -> UIViewController? {
    var responder: UIResponder? = self
    while let current = responder {
      if let controller = current as? UIViewController {
        return controller
      }
      responder = current.next
    }
    return nil
  }
}
