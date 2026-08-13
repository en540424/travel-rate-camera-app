Pod::Spec.new do |s|
  # Pod名を"Translation"にするとApple純正のTranslation frameworkとモジュール名が衝突するため、
  # プロジェクト固有の接頭辞をつけている（ディレクトリ名はmodules/translationのまま）。
  s.name           = 'TabirateTranslation'
  s.version        = '1.0.0'
  s.summary        = 'Apple Translation FrameworkのローカルExpo Module（実機PoC・本番未接続）'
  s.description    = 'TranslationSession/LanguageAvailabilityを呼び出すPoC用モジュール。モデルDL可能なsessionはSwiftUIのtranslationTask経由でしか取得できないため、透明なSwiftUIホストViewを内包する'
  s.author         = ''
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = {
    :ios => '16.4',
    :tvos => '16.4'
  }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  # Translationはfrom iOS 18.0(フレームワーク自体はiOS 17.4+)。
  # deployment targetは16.4のままのため、iOS 16.4〜17.xでdyldがロードに失敗しないようweak linkする。
  # 使用箇所はすべて#available(iOS 18.0, *)でガード済み（TabirateTranslationModule.swift等）。
  s.weak_frameworks = 'Translation'

  # Swift/Objective-C compatibility
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
