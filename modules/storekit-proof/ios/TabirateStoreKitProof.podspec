Pod::Spec.new do |s|
  s.name           = 'TabirateStoreKitProof'
  s.version        = '1.0.0'
  s.summary        = 'Pro+ の本人認証の証拠（StoreKit 2 の署名付き取引 JWS）を取り出すローカル Expo Module'
  s.description    = 'Transaction.currentEntitlements から、指定した商品の検証済み取引の jwsRepresentation を返す。購入・復元は行わない（RevenueCat の経路に触れない）'
  s.author         = ''
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = {
    :ios => '16.4'
  }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'StoreKit'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
