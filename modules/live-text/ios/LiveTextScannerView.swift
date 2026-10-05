@preconcurrency import AVFoundation
import ExpoModulesCore
import UIKit

/// 透明・タッチ透過のView（描画物を持たない）。
///
/// 同じカメラ枠（親View）の中にあるexpo-cameraのプレビュー（`AVCaptureVideoPreviewLayer`）を探し、
/// そのsessionへ映像フレーム出力を1つ追加して、文字認識の結果を`onTextDetected`で返す。
///
/// 安全規約（既存の価格OCR・撮影フローを壊さないためのもの。変更しないこと）:
/// - expo-cameraの入力デバイス・写真出力・プレビューには一切触れない。触るのは自分が足した出力だけ
/// - sessionが動いている（`isRunning`）のを確認してから追加する（JS側もonCameraReady後にだけenabledにする）
/// - 撮影処理中は出力の付け外しをせず、フレームを捨てるだけ（`paused`）
/// - 探索範囲は親View（カメラ枠）から2階層まで。画面全体は探さない（別画面のカメラを掴まない）
/// - expo-cameraはアンマウント時にsessionの全出力を外す。その状態は「未接続」として扱い、触らない
final class LiveTextScannerView: ExpoView {
  let onTextDetected = EventDispatcher()
  let onScannerStatus = EventDispatcher()

  var isScannerEnabled = false
  var isScannerPaused = false
  var intervalMs: Double = 1000
  var languages: [String] = []
  var minimumTextHeight: Double = 0

  private let processor = LiveTextFrameProcessor()
  private var attachTimer: Timer?
  private var attachedOutput: AVCaptureVideoDataOutput?
  private weak var attachedSession: AVCaptureSession?
  private var isAttaching = false
  /// 追加できなかったsession。同じsessionへは繰り返し追加を試みない（構成変更を連発しない）。
  private weak var rejectedSession: AVCaptureSession?
  private var lastStatus: String?

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    isUserInteractionEnabled = false
    backgroundColor = .clear
    processor.onRecognized = { [weak self] payload in
      DispatchQueue.main.async {
        guard let self, self.isScannerEnabled, !self.isScannerPaused, self.window != nil else { return }
        self.onTextDetected(payload)
      }
    }
  }

  deinit {
    attachTimer?.invalidate()
    if let session = attachedSession, let output = attachedOutput {
      Self.detach(output: output, from: session)
    }
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    applyProps()
  }

  func applyProps() {
    let inWindow = window != nil
    processor.update(
      active: isScannerEnabled && !isScannerPaused && inWindow,
      intervalMs: intervalMs,
      languages: languages,
      minimumTextHeight: minimumTextHeight
    )

    if !isScannerEnabled {
      rejectedSession = nil
      if isScannerPaused {
        // 撮影処理中はsessionの構成を変えない。出力が残っていれば、確認ループが一時停止明けに外す
        if attachedOutput != nil, inWindow {
          startAttachLoop()
        } else {
          stopAttachLoop()
        }
        return
      }
      stopAttachLoop()
      detachIfNeeded()
      emitStatus("off")
      return
    }

    if inWindow {
      startAttachLoop()
    } else {
      // 画面から外れただけ（タブ切替など）。sessionには触らず、確認ループだけ止める
      stopAttachLoop()
    }
  }

  // MARK: - 出力の付け外し

  private func startAttachLoop() {
    guard attachTimer == nil else { return }
    tick()
    let timer = Timer(timeInterval: 0.5, repeats: true) { [weak self] _ in
      self?.tick()
    }
    RunLoop.main.add(timer, forMode: .common)
    attachTimer = timer
  }

  private func stopAttachLoop() {
    attachTimer?.invalidate()
    attachTimer = nil
  }

  /// 0.5秒ごとに「自分の出力が今もsessionに付いているか」を確認し、外れていれば付け直す。
  /// **撮影処理中（paused）は付けも外しもしない**（takePictureAsyncの最中にsessionの構成を変えない）。
  private func tick() {
    guard window != nil, !isAttaching else { return }

    if !isScannerEnabled {
      // 一時停止中に無効化された分は、一時停止が明けてから外す
      guard !isScannerPaused else { return }
      stopAttachLoop()
      detachIfNeeded()
      emitStatus("off")
      return
    }

    if let session = attachedSession, let output = attachedOutput, session.outputs.contains(output) {
      emitStatus(session.isRunning ? "scanning" : "waiting")
      return
    }
    // expo-camera側のアンマウント等で外れた。参照だけ捨てる（sessionには触らない）
    attachedOutput = nil
    attachedSession = nil

    guard !isScannerPaused else { return }

    guard let previewLayer = findPreviewLayer(), let session = previewLayer.session else {
      emitStatus("waiting")
      return
    }
    if let rejected = rejectedSession, rejected === session {
      emitStatus("unavailable")
      return
    }
    guard session.isRunning else {
      emitStatus("waiting")
      return
    }

    isAttaching = true
    let output = processor.makeOutput()
    LiveTextFrameProcessor.configQueue.async { [weak self] in
      // 追加可否の確認と追加は同じ構成変更の中で行う（確認後に状態が変わる隙間を作らない）
      var added = false
      var rejected = false
      if session.isRunning {
        session.beginConfiguration()
        if session.canAddOutput(output) {
          session.addOutput(output)
          added = true
        } else {
          rejected = true
        }
        session.commitConfiguration()
      }

      DispatchQueue.main.async {
        guard let self else {
          if added { LiveTextScannerView.detach(output: output, from: session) }
          return
        }
        self.isAttaching = false
        guard added else {
          if rejected {
            self.rejectedSession = session
            self.emitStatus("unavailable")
          } else {
            // sessionが止まっていた（タブ切替・バックグラウンド等）。次の確認で付け直す
            self.emitStatus("waiting")
          }
          return
        }
        self.attachedOutput = output
        self.attachedSession = session
        // 追加処理中に無効化された場合は、次の確認（一時停止中なら明けてから）で外す
        if self.isScannerEnabled {
          self.emitStatus("scanning")
        } else {
          self.startAttachLoop()
        }
      }
    }
  }

  private func detachIfNeeded() {
    guard let session = attachedSession, let output = attachedOutput else {
      attachedSession = nil
      attachedOutput = nil
      return
    }
    attachedSession = nil
    attachedOutput = nil
    Self.detach(output: output, from: session)
  }

  private static func detach(output: AVCaptureVideoDataOutput, from session: AVCaptureSession) {
    LiveTextFrameProcessor.configQueue.async {
      guard session.outputs.contains(output) else { return }
      session.beginConfiguration()
      session.removeOutput(output)
      session.commitConfiguration()
    }
  }

  // MARK: - プレビューの探索（カメラ枠の中だけ）

  private func findPreviewLayer() -> AVCaptureVideoPreviewLayer? {
    var container: UIView? = superview
    var depth = 0
    while let current = container, depth < 2 {
      if let found = Self.searchPreviewLayer(in: current, excluding: self) {
        return found
      }
      container = current.superview
      depth += 1
    }
    return nil
  }

  private static func searchPreviewLayer(in view: UIView, excluding: UIView) -> AVCaptureVideoPreviewLayer? {
    if view === excluding {
      return nil
    }
    if let preview = view.layer as? AVCaptureVideoPreviewLayer {
      return preview
    }
    for sublayer in view.layer.sublayers ?? [] {
      if let preview = sublayer as? AVCaptureVideoPreviewLayer {
        return preview
      }
    }
    for subview in view.subviews {
      if let found = searchPreviewLayer(in: subview, excluding: excluding) {
        return found
      }
    }
    return nil
  }

  // MARK: - 状態通知

  /// off（無効）/ waiting（カメラ準備待ち）/ scanning（認識中）/ unavailable（このカメラでは使えない）
  private func emitStatus(_ status: String) {
    guard status != lastStatus else { return }
    lastStatus = status
    onScannerStatus(["status": status])
  }
}
