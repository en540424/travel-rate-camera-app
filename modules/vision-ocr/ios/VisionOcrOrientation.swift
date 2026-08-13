import ImageIO
import UIKit

/// `UIImage.imageOrientation`（EXIF由来）を`VNImageRequestHandler`が要求する
/// `CGImagePropertyOrientation`へ変換する。
///
/// `UIImage(data:).cgImage` は向き情報を保持しないため（向きは`UIImage`側のプロパティにのみ残る）、
/// この変換結果を`VNImageRequestHandler`へ明示的に渡さないと、
/// 縦横が入れ替わった/回転した画像でVisionが誤った向きのままテキストを認識してしまう。
func cgImagePropertyOrientation(from uiOrientation: UIImage.Orientation) -> CGImagePropertyOrientation {
  switch uiOrientation {
  case .up: return .up
  case .upMirrored: return .upMirrored
  case .down: return .down
  case .downMirrored: return .downMirrored
  case .left: return .left
  case .leftMirrored: return .leftMirrored
  case .right: return .right
  case .rightMirrored: return .rightMirrored
  @unknown default: return .up
  }
}
