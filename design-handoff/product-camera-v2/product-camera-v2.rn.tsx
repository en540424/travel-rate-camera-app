/**
 * v2 商品写真モード・ 撮影前（補助モード／金額読み取りなし）
 * folder: product-camera-v2/  ・ route: app/(tabs)/index.tsx（captureMode==='photo'）
 *
 * 価格OCRモードと同じ骨格。差分は「目的バナー」「正方ガイド」「チャコールのシャッター」。
 * シャッター色は tokens.ts の正式トークン color.productShutter（'#36443F'）を使う。
 * 現状実装では商品写真は ImagePicker（launchCameraAsync / launchImageLibraryAsync）経由で
 * pendingPhotoUri にセットされる。その配線・保存ロジックは変更しない（spec参照）。
 */
import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';

const color = {
  primaryDark: '#0A766E', primarySoft: '#E7F5F2',
  text: '#16211F', body: '#5B6764', muted: '#7E8986',
  candidateText: '#9A6516', candidateSoft2: '#FDFAF3', candidateBorder: '#F0E6CF',
  bgScreen: '#F4F6F5', card: '#FFFFFF', line2: '#EEF1F0',
  productShutter: '#36443F', // tokens.ts の正式トークン color.productShutter（チャコール）
};

export function ProductCameraStage() {
  return (
    <>
      {/* 目的バナー（candidate=amber系の淡い注意。金額読み取りはしない、を明示） */}
      <View style={styles.purposeBanner}>
        <Text style={styles.purposeIcon}>🖼️</Text>
        <Text style={styles.purposeText}>
          履歴で見返すための<Text style={styles.purposeStrong}>商品写真を撮るモード</Text>です。金額の読み取りはしません。
        </Text>
      </View>

      {/* CameraStage（正方ガイド＋チャコールシャッター） */}
      <View style={styles.camera}>
        {/* <CameraPreview ... /> もしくは ImagePicker 起動ボタン */}
        <View style={styles.squareGuide} />
        <Text style={styles.guide}>商品が枠に収まるように</Text>
        <Pressable style={styles.shutter}>
          <Text style={styles.shutterText}>商品を撮る</Text>
        </Pressable>
      </View>

      {/* ライブラリから選ぶ サブ導線 */}
      <Pressable style={styles.libraryRow} hitSlop={8}>
        <Text style={styles.libraryText}>写真ライブラリから選ぶ</Text>
      </Pressable>
    </>
  );
}

const styles = StyleSheet.create({
  purposeBanner: { flexDirection: 'row', gap: 8, backgroundColor: color.candidateSoft2, borderWidth: 1, borderColor: color.candidateBorder, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 12 },
  purposeIcon: { fontSize: 14 },
  purposeText: { flex: 1, fontSize: 12, lineHeight: 17, fontWeight: '500', color: color.candidateText },
  purposeStrong: { fontWeight: '700' },

  camera: { flex: 1, borderRadius: 16, overflow: 'hidden', backgroundColor: '#A9B2AB', position: 'relative' },
  squareGuide: { position: 'absolute', top: '46%', left: '50%', width: 150, height: 150, marginLeft: -75, marginTop: -75, borderWidth: 2, borderColor: 'rgba(255,255,255,0.9)', borderRadius: 14 },
  guide: { position: 'absolute', bottom: 74, left: 0, right: 0, textAlign: 'center', fontSize: 12, fontWeight: '600', color: '#fff' },
  shutter: { position: 'absolute', bottom: 14, alignSelf: 'center', minWidth: 140, height: 44, borderRadius: 16, backgroundColor: color.productShutter, alignItems: 'center', justifyContent: 'center', shadowColor: '#10211F', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 5, elevation: 3 },
  shutterText: { fontSize: 15, fontWeight: '700', color: '#fff' },

  libraryRow: { alignItems: 'center', justifyContent: 'center' },
  libraryText: { fontSize: 13, fontWeight: '700', color: color.body },
});
