// [検証] Phase 2：翻訳の実機確認用パネル。__DEV__ビルドでのみ描画する。
//
// 本番のメモ候補チップ・handleToggleMemoLine・保存処理には一切関与しない
// （既存表示の隣に検証用の表示を足すだけ）。正式なUIはPhase 3で決める。
//
// **このファイルはトップレベルで`modules/translation`をimportしないこと。**
// Androidにはnative実体が無く、`requireNativeViewManager`がimport時点で例外を投げるため、
// ホストViewは実行時に動的importで読み込む。
import { useEffect, useState } from 'react';
import type { ComponentType } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import type { ViewProps } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import type { MemoCandidate } from '@/lib/translation-types';

/**
 * 透明な翻訳ホストView。これがマウントされている間だけ`translateBatch`が成功する。
 *
 * `position: absolute` + `pointerEvents: none`で、既存レイアウトへの影響とタッチの奪取を防ぐ
 * （PoC画面の1x1 flex childをそのまま流用すると、置き場所によっては行が1px押し出される）。
 */
export function DevTranslationHost({ active }: { active: boolean }) {
  const [Host, setHost] = useState<ComponentType<ViewProps> | null>(null);

  useEffect(() => {
    if (!__DEV__ || Platform.OS !== 'ios') return;
    let cancelled = false;
    import('../../modules/translation')
      .then((m) => {
        if (!cancelled) setHost(() => m.TabirateTranslationHost);
      })
      .catch((error: unknown) => {
        console.warn('[TranslationDev] ホストViewを読み込めませんでした', error);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!__DEV__ || !active || Host == null) return null;
  return <Host style={styles.host} pointerEvents="none" />;
}

function statusLabel(candidate: MemoCandidate): string {
  switch (candidate.translationStatus) {
    case 'pending':
      return '翻訳中…';
    case 'translated':
      return '';
    case 'unavailable':
      return `翻訳できません（${candidate.errorCode ?? 'unavailable'}）`;
    case 'failed':
      return `翻訳失敗（${candidate.errorCode ?? 'failed'}）`;
    case 'idle':
      return candidate.errorCode ? `未翻訳（${candidate.errorCode}）` : '未翻訳';
  }
}

/**
 * 翻訳候補の検証表示。主表示＝訳文（無ければ原文）、補助表示＝原文。
 * 失敗しても原文は消さない（Phase 1 Serviceの原文フォールバックがそのまま見える）。
 */
export function DevMemoTranslationPanel({
  candidates,
  sourceLanguage,
}: {
  candidates: MemoCandidate[] | null;
  sourceLanguage: string | null;
}) {
  if (!__DEV__) return null;

  return (
    <View style={styles.panel}>
      <ThemedText style={styles.title}>
        [検証] 翻訳候補 {sourceLanguage != null ? `（${sourceLanguage} → ja）` : ''}
      </ThemedText>

      {sourceLanguage == null ? (
        <ThemedText style={styles.note}>JPY旅行のため翻訳スキップ（ja → ja）</ThemedText>
      ) : candidates == null || candidates.length === 0 ? (
        <ThemedText style={styles.note}>候補なし</ThemedText>
      ) : (
        candidates.map((candidate, index) => {
          const label = statusLabel(candidate);
          const translated = candidate.translatedText;
          return (
            <View key={`${index}-${candidate.originalText}`} style={styles.row}>
              {/* 主表示：訳文（無ければ原文） */}
              <ThemedText style={styles.primary} numberOfLines={1}>
                {translated ?? candidate.originalText}
              </ThemedText>
              {/* 補助表示：訳文がある時だけ原文を併記する */}
              {translated != null && (
                <ThemedText style={styles.secondary} numberOfLines={1}>
                  {candidate.originalText}
                </ThemedText>
              )}
              {label !== '' && <ThemedText style={styles.status}>{label}</ThemedText>}
              {candidate.resolvedSourceLanguage != null && (
                <ThemedText style={styles.meta}>
                  detected: {candidate.resolvedSourceLanguage}
                </ThemedText>
              )}
            </View>
          );
        })
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  // レイアウトへ影響させないため絶対配置。描画物を持たないViewなので見た目にも出ない。
  host: { position: 'absolute', top: 0, left: 0, width: 1, height: 1, opacity: 0 },
  panel: { marginTop: 10, padding: 8, backgroundColor: '#1a1a2e', borderRadius: 6, gap: 6 },
  title: { fontSize: 11, color: '#6cb6ff', fontWeight: '700' },
  note: { fontSize: 11, color: '#8b949e' },
  row: { gap: 1 },
  primary: { fontSize: 14, color: '#e6edf3' },
  secondary: { fontSize: 11, color: '#8b949e' },
  status: { fontSize: 10, color: '#f0a020' },
  meta: { fontSize: 10, color: '#6e7681' },
});
