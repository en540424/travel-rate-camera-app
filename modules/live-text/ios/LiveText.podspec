Pod::Spec.new do |s|
  s.name           = 'LiveText'
  s.version        = '1.0.0'
  s.summary        = 'カメラ映像のリアルタイム文字認識（Apple Vision）のローカルExpo Module'
  s.description    = 'expo-cameraのAVCaptureSessionへ映像フレーム出力を1つ追加し、一定間隔でVNRecognizeTextRequestを実行する。フレームはメモリ上で認識して破棄し、ファイルへ書き出さない'
  s.author         = ''
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = {
    :ios => '16.4',
    :tvos => '16.4'
  }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.frameworks = 'AVFoundation', 'Vision', 'CoreMedia', 'CoreVideo'

  # Swift/Objective-C compatibility
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
