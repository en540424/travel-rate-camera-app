import { useCallback, useRef, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from 'react-native';

import { color, spacing } from '@/theme/tokens';
import { barHeightPx, findPeakBucket, formatAxisLabels, niceAxisMax, type SpendBucket } from '@/utils/analytics-core';
import { formatJpy } from '@/utils/format';

const WEEKDAYS_JA = ['日', '月', '火', '水', '木', '金', '土'];

/** 棒を描く領域の高さ（ラベル行は含まない） */
const CHART_H = 148;
/** 右側の縦軸目盛りの幅（「¥15,000」が1.3倍の文字でも収まる幅。収まらなければ縮小） */
const Y_AXIS_W = 46;
// 月表示は31日分を横スクロールで表示する（2026-07のHuman実機確認で確定した方式）。
// 初期表示でだいたい10日分が見える幅にする
const MONTH_VISIBLE_DAYS = 10;
const DAY_COL_MIN_WIDTH = 28;
/** 月表示：日付ラベル（日＋曜日）の高さ。行の高さ(15+13)×文字拡大の上限1.3に余白1 */
const MONTH_LABEL_H = 38;
const LABELS_MARGIN_TOP = 6;
/** 目盛り・日付ラベルは文字拡大で棒の領域を押し潰さないよう上限を設ける */
const LABEL_MAX_SCALE = 1.3;

export interface SpendBarChartProps {
  /** 年表示＝月別12本、月表示＝日別（横スクロール） */
  kind: 'year' | 'month';
  buckets: readonly SpendBucket[];
  year: number;
  month: number;
  /** 今日の日付キー（`YYYY-MM-DD`）。今月・今日の列ラベルを強調し、月表示の初期位置に使う */
  todayKey: string;
  selectedKey: string | null;
  onSelect: (key: string | null) => void;
}

/**
 * 購入済み金額の縦棒グラフ（分析画面。無料版・Proで同じものを使う）。
 * グラフライブラリは使わずViewの高さ指定だけで描く（`design/旅レートカメラ_実装引き継ぎ資料.md`のMiniBarChart方針）。
 *
 * - 棒の色は`color.chartBar`（Human実機評価で決めた色）、選択中は`color.primaryDark`。選択中は他の棒を薄くする
 * - 上の読み取り欄は高さ固定で、未選択時は「いちばん多い日（月）」、選択時はその棒の日付と金額を文字で出す
 *   （色だけで選択状態を伝えない）
 * - 縦軸の上端はきりのいい金額（`niceAxisMax`）。目盛り線は上端・半分・0の3本だけ
 */
export function SpendBarChart({ kind, buckets, year, month, todayKey, selectedKey, onSelect }: SpendBarChartProps) {
  // 棒の領域の実幅（月表示の列幅と初期スクロール位置に使う）
  const [plotWidth, setPlotWidth] = useState<number | null>(null);
  const onPlotLayout = useCallback((e: LayoutChangeEvent) => {
    const w = Math.round(e.nativeEvent.layout.width);
    setPlotWidth((prev) => (prev === w ? prev : w));
  }, []);

  const maxAmount = Math.max(0, ...buckets.map((b) => b.amount));
  const axisMax = niceAxisMax(maxAmount);
  const axisLabels = formatAxisLabels(axisMax);
  const selected = buckets.find((b) => b.key === selectedKey && b.amount > 0) ?? null;
  const peak = findPeakBucket(buckets);
  const shown = selected ?? peak;

  const [todayYear, todayMonth, todayDay] = todayKey.split('-').map(Number);
  const currentIndex =
    kind === 'year'
      ? todayYear === year
        ? todayMonth
        : null
      : todayYear === year && todayMonth === month
        ? todayDay
        : null;

  const bucketLabel = (b: SpendBucket) =>
    kind === 'year' ? `${year}年${b.index}月` : `${month}月${b.index}日（${WEEKDAYS_JA[b.weekday ?? 0]}）`;

  // 読み上げ用。今日（今月）は緑の丸・太字の見た目だけでなく、言葉でも伝える
  const a11yLabel = (b: SpendBucket) => {
    const current = b.index === currentIndex ? (kind === 'year' ? '今月 ' : '今日 ') : '';
    return b.amount > 0
      ? `${current}${bucketLabel(b)} 購入済み ${formatJpy(b.amount)}`
      : `${current}${bucketLabel(b)} 記録なし`;
  };

  const handlePress = (key: string) => onSelect(selectedKey === key ? null : key);

  return (
    <View>
      {/* 読み取り欄：高さを固定し、選択の有無で下のグラフが上下に動かないようにする */}
      <View style={styles.readout}>
        {shown ? (
          <>
            <View style={styles.readoutLeft}>
              <Text style={styles.readoutCaption} numberOfLines={1}>
                {selected ? '選択中' : kind === 'year' ? 'この年でいちばん多い月' : 'この月でいちばん多い日'}
              </Text>
              <Text style={styles.readoutLabel} numberOfLines={1}>
                {bucketLabel(shown)}
              </Text>
            </View>
            <Text
              style={[styles.readoutAmount, selected && styles.readoutAmountSelected]}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.6}>
              {formatJpy(shown.amount)}
            </Text>
          </>
        ) : null}
      </View>

      <View style={styles.plotRow}>
        <View style={styles.plotArea} onLayout={onPlotLayout}>
          {/* 目盛り線（棒の後ろに固定。月表示は棒だけが横にスクロールする） */}
          <View style={[styles.gridLayer, { height: CHART_H }]} pointerEvents="none">
            <View style={[styles.gridLine, { top: 0 }]} />
            <View style={[styles.gridLine, { top: CHART_H / 2 }]} />
            <View style={[styles.baseline, { top: CHART_H - 1 }]} />
          </View>

          {kind === 'year' ? (
            <YearBars
              buckets={buckets}
              axisMax={axisMax}
              selectedKey={selected?.key ?? null}
              currentIndex={currentIndex}
              a11yLabel={a11yLabel}
              onPress={handlePress}
            />
          ) : plotWidth !== null ? (
            // 列幅は実幅が測れてから決める（概算の幅で初期スクロール位置を決めてずれるのを避ける）
            <MonthBars
              key={`${year}-${month}`}
              buckets={buckets}
              axisMax={axisMax}
              selectedKey={selected?.key ?? null}
              currentIndex={currentIndex}
              colWidth={Math.max(DAY_COL_MIN_WIDTH, Math.floor(plotWidth / MONTH_VISIBLE_DAYS))}
              visibleWidth={plotWidth}
              a11yLabel={a11yLabel}
              onPress={handlePress}
            />
          ) : (
            <View style={{ height: CHART_H + LABELS_MARGIN_TOP + MONTH_LABEL_H }} />
          )}
        </View>

        {/* 縦軸の目盛り（上端・半分）。棒の領域の外に置くので横スクロールしても動かない。
            金額は読み取り欄と各棒の読み上げで伝わるので、目盛りは読み上げ対象から外す */}
        <View
          style={[styles.yAxis, { height: CHART_H }]}
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants">
          <Text
            style={[styles.yLabel, { top: -7 }]}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.75}
            maxFontSizeMultiplier={LABEL_MAX_SCALE}>
            {axisLabels.top}
          </Text>
          <Text
            style={[styles.yLabel, { top: CHART_H / 2 - 7 }]}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.75}
            maxFontSizeMultiplier={LABEL_MAX_SCALE}>
            {axisLabels.half}
          </Text>
        </View>
      </View>

      <Text style={styles.hint}>
        {kind === 'month'
          ? '左右にスワイプで1日〜月末、棒をタップで金額を表示'
          : '棒をタップすると、その月の金額を表示します'}
      </Text>
    </View>
  );
}

interface BarsProps {
  buckets: readonly SpendBucket[];
  axisMax: number;
  selectedKey: string | null;
  /** 今月（年表示）・今日（月表示）の位置。期間外ならnull */
  currentIndex: number | null;
  a11yLabel: (b: SpendBucket) => string;
  onPress: (key: string) => void;
}

function barStyleFor(b: SpendBucket, selectedKey: string | null) {
  if (selectedKey === null) return styles.barNormal;
  return b.key === selectedKey ? styles.barSelected : styles.barDimmed;
}

/** 年表示：12か月分を1画面に収める */
function YearBars({ buckets, axisMax, selectedKey, currentIndex, a11yLabel, onPress }: BarsProps) {
  return (
    <>
      <View style={[styles.barsRow, { height: CHART_H }]}>
        {buckets.map((b) => {
          const h = barHeightPx(b.amount, axisMax, CHART_H);
          return (
            <Pressable
              key={b.key}
              style={styles.yearCol}
              disabled={b.amount <= 0}
              onPress={() => onPress(b.key)}
              accessible={b.amount > 0}
              accessibilityRole="button"
              accessibilityLabel={a11yLabel(b)}
              accessibilityState={{ selected: b.key === selectedKey, disabled: b.amount <= 0 }}>
              {h > 0 && <View style={[styles.bar, styles.yearBar, { height: h }, barStyleFor(b, selectedKey)]} />}
            </Pressable>
          );
        })}
      </View>
      {/* ラベルは各棒の読み上げに含めるので、ここは読み上げ対象から外す */}
      <View style={styles.labelsRow} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {buckets.map((b) => {
          const isCurrent = b.index === currentIndex;
          return (
            <View key={b.key} style={styles.yearLabelCol}>
              <View style={[styles.dayPill, isCurrent && styles.dayPillCurrent]}>
                <Text
                  style={[
                    styles.xLabel,
                    isCurrent && styles.xLabelOnPill,
                    !isCurrent && b.key === selectedKey && styles.xLabelSelected,
                  ]}
                  numberOfLines={1}
                  maxFontSizeMultiplier={LABEL_MAX_SCALE}>
                  {b.index}
                </Text>
              </View>
            </View>
          );
        })}
      </View>
    </>
  );
}

/**
 * 月表示：31日分を1画面に収めず、日付が読める列幅で横スクロールする。
 * 棒の行とラベルの行は同じ列幅・同じgap(0)にする（gapがずれると右へ行くほど棒とラベルがずれる）。
 * 今月を開いたときは今日の列が右寄りに見える位置から始める（それ以外の月は1日から）。
 */
function MonthBars({
  buckets,
  axisMax,
  selectedKey,
  currentIndex,
  a11yLabel,
  onPress,
  colWidth,
  visibleWidth,
}: BarsProps & { colWidth: number; visibleWidth: number }) {
  const scrollRef = useRef<ScrollView>(null);
  const didInitialScroll = useRef(false);

  const onContentSizeChange = (contentWidth: number) => {
    if (didInitialScroll.current) return;
    didInitialScroll.current = true;
    if (currentIndex === null) return;
    const maxX = Math.max(0, contentWidth - visibleWidth);
    // 列の途中で切れないよう、列幅の倍数に揃える
    const x = Math.min(maxX, Math.max(0, Math.round((currentIndex * colWidth - visibleWidth * 0.85) / colWidth) * colWidth));
    if (x > 0) scrollRef.current?.scrollTo({ x, animated: false });
  };

  const barWidth = Math.min(14, Math.round(colWidth * 0.5));

  return (
    <ScrollView
      ref={scrollRef}
      horizontal
      showsHorizontalScrollIndicator={false}
      onContentSizeChange={onContentSizeChange}>
      <View>
        <View style={[styles.barsRow, { height: CHART_H }]}>
          {buckets.map((b) => {
            const h = barHeightPx(b.amount, axisMax, CHART_H);
            return (
              <Pressable
                key={b.key}
                style={[styles.monthCol, { width: colWidth }]}
                disabled={b.amount <= 0}
                onPress={() => onPress(b.key)}
                accessible={b.amount > 0}
                accessibilityRole="button"
                accessibilityLabel={a11yLabel(b)}
                accessibilityState={{ selected: b.key === selectedKey, disabled: b.amount <= 0 }}>
                {h > 0 && <View style={[styles.bar, { width: barWidth, height: h }, barStyleFor(b, selectedKey)]} />}
              </Pressable>
            );
          })}
        </View>
        {/* ラベルは各棒の読み上げに含めるので、ここは読み上げ対象から外す */}
        <View
          style={[styles.labelsRow, { height: MONTH_LABEL_H }]}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants">
          {buckets.map((b) => {
            const isCurrent = b.index === currentIndex;
            const isSelected = b.key === selectedKey;
            return (
              <View key={b.key} style={[styles.monthLabelCol, { width: colWidth }]}>
                <View style={[styles.dayPill, isCurrent && styles.dayPillCurrent]}>
                  <Text
                    style={[
                      styles.xLabel,
                      isCurrent && styles.xLabelOnPill,
                      !isCurrent && isSelected && styles.xLabelSelected,
                    ]}
                    numberOfLines={1}
                    maxFontSizeMultiplier={LABEL_MAX_SCALE}>
                    {b.index}
                  </Text>
                </View>
                <Text
                  style={[
                    styles.weekdayLabel,
                    b.weekday === 6 && styles.weekdaySat,
                    b.weekday === 0 && styles.weekdaySun,
                  ]}
                  numberOfLines={1}
                  maxFontSizeMultiplier={LABEL_MAX_SCALE}>
                  {WEEKDAYS_JA[b.weekday ?? 0]}
                </Text>
              </View>
            );
          })}
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  // ── 読み取り欄 ──
  readout: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: spacing.md,
    minHeight: 46,
    marginBottom: 14,
  },
  readoutLeft: { flexShrink: 1, gap: 2 },
  readoutCaption: {
    fontSize: 11,
    fontWeight: '600',
    color: color.muted,
  },
  readoutLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: color.text,
  },
  readoutAmount: {
    flexShrink: 0,
    maxWidth: '60%',
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '700',
    color: color.text,
    fontVariant: ['tabular-nums'],
  },
  readoutAmountSelected: { color: color.primaryDark },

  // ── グラフ本体 ──
  plotRow: { flexDirection: 'row' },
  plotArea: { flex: 1 },
  gridLayer: { position: 'absolute', left: 0, right: 0, top: 0 },
  gridLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: StyleSheet.hairlineWidth,
    backgroundColor: color.inputBorder,
    opacity: 0.6,
  },
  baseline: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: color.inputBorder,
  },
  yAxis: { width: Y_AXIS_W },
  yLabel: {
    position: 'absolute',
    left: 6,
    right: 0,
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '600',
    color: color.muted,
    fontVariant: ['tabular-nums'],
  },

  barsRow: { flexDirection: 'row', alignItems: 'flex-end' },
  yearCol: { flex: 1, height: '100%', alignItems: 'center', justifyContent: 'flex-end' },
  monthCol: { height: '100%', alignItems: 'center', justifyContent: 'flex-end' },
  bar: {
    borderTopLeftRadius: 6,
    borderTopRightRadius: 6,
    borderBottomLeftRadius: 2,
    borderBottomRightRadius: 2,
  },
  yearBar: { width: '58%', maxWidth: 20 },
  barNormal: { backgroundColor: color.chartBar },
  barSelected: { backgroundColor: color.primaryDark },
  barDimmed: { backgroundColor: color.chartBar, opacity: 0.45 },

  labelsRow: { flexDirection: 'row', marginTop: LABELS_MARGIN_TOP },
  xLabel: {
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '600',
    color: color.muted,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  yearLabelCol: { flex: 1, alignItems: 'center' },
  xLabelSelected: { color: color.primaryDark, fontWeight: '800' },
  monthLabelCol: { alignItems: 'center', gap: 1 },
  dayPill: {
    minWidth: 22,
    paddingHorizontal: 3,
    borderRadius: 999,
    alignItems: 'center',
  },
  dayPillCurrent: { backgroundColor: color.primary },
  xLabelOnPill: { color: '#FFFFFF', fontWeight: '800' },
  weekdayLabel: {
    fontSize: 9.5,
    lineHeight: 13,
    fontWeight: '600',
    color: color.muted,
    textAlign: 'center',
  },
  weekdaySat: { color: color.saturdayBlue },
  weekdaySun: { color: color.sundayRed },

  hint: {
    marginTop: 10,
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '500',
    color: color.muted,
  },
});
