import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { color, radius, shadow } from '@/theme/tokens';

// 6ステップの軽いオンボーディング（説明は短く）
const STEPS: { title: string; body: string }[] = [
  { title: 'カメラで撮る', body: '値札やメニューをカメラで読み取ります。' },
  { title: '日本円で確認', body: 'その場で日本円に換算して表示します。' },
  { title: '候補か購入済みで保存', body: '迷い中は「候補」、買ったら「購入済み」。' },
  { title: '履歴で見返す', body: '保存した商品を一覧で振り返れます。' },
  { title: 'カレンダーで確認', body: '日別に、その日の記録をまとめて確認。' },
  { title: '分析で把握', body: '残り予算や使い方の傾向をチェック。' },
];

interface FaqItem {
  q: string;
  a: string;
}

const FAQ: FaqItem[] = [
  {
    q: '候補と購入済みの違いは？',
    a: '「候補」は買うか迷っているもの、「購入済み」は買ったものです。残り予算は両方を差し引いて表示します。',
  },
  {
    q: 'レートはどう決まりますか？',
    a: '旅行ごとに手入力したレートで換算します。レートを変えても、保存済みの記録は保存時のレートを維持します。',
  },
  {
    q: 'データはどこに保存されますか？',
    a: 'すべてこの端末内にのみ保存され、クラウドには送信されません。',
  },
];

export default function HelpScreen() {
  const [openFaq, setOpenFaq] = useState<number | null>(null);

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <ThemedText style={styles.lead}>使い方（6ステップ）</ThemedText>

        <View style={styles.steps}>
          {STEPS.map((s, i) => (
            <View key={s.title} style={styles.stepCard}>
              <View style={styles.stepNum}>
                <ThemedText style={styles.stepNumText}>{i + 1}</ThemedText>
              </View>
              <View style={styles.stepText}>
                <ThemedText style={styles.stepTitle}>{s.title}</ThemedText>
                <ThemedText style={styles.stepBody}>{s.body}</ThemedText>
              </View>
            </View>
          ))}
        </View>

        {/* FAQ（下部導線） */}
        <ThemedText style={styles.faqLead}>よくある質問</ThemedText>
        <View style={styles.faqCard}>
          {FAQ.map((item, i) => (
            <View key={item.q}>
              {i > 0 && <View style={styles.sep} />}
              <Pressable
                onPress={() => setOpenFaq((cur) => (cur === i ? null : i))}
                style={({ pressed }) => [styles.faqRow, pressed && styles.pressed]}>
                <View style={styles.faqQRow}>
                  <ThemedText style={styles.faqQ}>{item.q}</ThemedText>
                  <ThemedText style={styles.faqChevron}>{openFaq === i ? '−' : '+'}</ThemedText>
                </View>
                {openFaq === i && <ThemedText style={styles.faqA}>{item.a}</ThemedText>}
              </Pressable>
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bgScreen },
  scroll: {
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 60,
    gap: 12,
    maxWidth: 480,
    width: '100%',
    alignSelf: 'center',
  },
  lead: { fontSize: 13, fontWeight: '700', color: color.muted, letterSpacing: 0.3, paddingHorizontal: 4 },
  steps: { gap: 10 },
  stepCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: color.card,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: color.line,
    padding: 14,
    ...shadow.card,
  },
  stepNum: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: color.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepNumText: { fontSize: 14, fontWeight: '800', color: '#FFFFFF' },
  stepText: { flex: 1, gap: 2 },
  stepTitle: { fontSize: 15, fontWeight: '700', color: color.text },
  stepBody: { fontSize: 12.5, fontWeight: '500', color: color.muted, lineHeight: 18 },
  faqLead: {
    fontSize: 13,
    fontWeight: '700',
    color: color.muted,
    letterSpacing: 0.3,
    paddingHorizontal: 4,
    marginTop: 12,
  },
  faqCard: {
    backgroundColor: color.card,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: color.line,
    overflow: 'hidden',
    ...shadow.card,
  },
  faqRow: { paddingVertical: 14, paddingHorizontal: 16, gap: 8 },
  pressed: { backgroundColor: color.line3 },
  faqQRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  faqQ: { flex: 1, fontSize: 14.5, fontWeight: '700', color: color.text },
  faqChevron: { fontSize: 19, fontWeight: '600', color: color.faint },
  faqA: { fontSize: 13, fontWeight: '500', color: color.body, lineHeight: 21 },
  sep: { height: StyleSheet.hairlineWidth, backgroundColor: color.line2, marginLeft: 16 },
});
