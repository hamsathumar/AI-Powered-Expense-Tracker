/**
 * Income vs spending over time (Reports v2). Two series drawn from the same
 * bucketed data (domain/reportRange.buildBuckets), switchable between grouped
 * bars and lines — bars for comparing individual days, lines for reading the
 * shape of a long range.
 *
 * Hand-built on react-native-svg like DonutChart: the app has no charting
 * dependency and a grouped bar chart is a handful of rects. Colour is paired
 * with the legend labels below, never used alone.
 */
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import Animated, { useAnimatedProps, useSharedValue, withTiming } from 'react-native-reanimated';
import Svg, { Circle, Line, Polyline, Rect } from 'react-native-svg';

import { formatCompactMinor } from '@/domain/money';
import { useReduceMotion } from '@/theme/FeedbackContext';
import { useTheme } from '@/theme/ThemeContext';
import { layout, motion, space, tabularNums, type } from '@/theme/tokens';

const AnimatedRect = Animated.createAnimatedComponent(Rect);

export type TrendMode = 'bar' | 'line';

export interface TrendPoint {
  key: string;
  label: string;
  expenseMinor: number;
  incomeMinor: number;
}

interface Props {
  points: TrendPoint[];
  mode: TrendMode;
}

const AXIS_GUTTER = 40; // room for the y-axis labels
const GRID_LINES = 4; // + the zero line
const MAX_X_LABELS = 6;
const BAR_MAX_W = 9;
const BAR_GAP = 2;
const X_LABEL_W = 48;

/** Round a maximum up to a readable axis top (1, 2, 2.5, 5, 10 × 10ⁿ). */
function niceMax(value: number): number {
  if (value <= 0) return 1;
  const magnitude = Math.pow(10, Math.floor(Math.log10(value)));
  const scaled = value / magnitude;
  const step = scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 2.5 ? 2.5 : scaled <= 5 ? 5 : 10;
  return step * magnitude;
}

export function TrendChart({ points, mode }: Props) {
  const { colors } = useTheme();
  const reduceMotion = useReduceMotion();
  const [width, setWidth] = useState(0);

  // Bars grow up from the baseline when the data changes, so switching period
  // or filter reads as the chart redrawing rather than teleporting.
  const grow = useSharedValue(reduceMotion ? 1 : 0);
  const dataKey = points.map((p) => `${p.key}:${p.expenseMinor}:${p.incomeMinor}`).join('|');

  useEffect(() => {
    if (reduceMotion) {
      grow.value = 1;
      return;
    }
    grow.value = 0;
    grow.value = withTiming(1, { duration: motion.chart });
  }, [dataKey, reduceMotion, grow]);

  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);

  const plotH = layout.reports.trendChartH;
  const plotW = Math.max(0, width - AXIS_GUTTER);
  const peak = Math.max(...points.map((p) => Math.max(p.expenseMinor, p.incomeMinor)), 0);
  const top = niceMax(peak);
  const y = (valueMinor: number) => plotH - (valueMinor / top) * plotH;

  const slotW = points.length > 0 ? plotW / points.length : 0;
  const barW = Math.max(layout.reports.trendBarMinW, Math.min(BAR_MAX_W, slotW / 2 - BAR_GAP));

  // Label every nth bucket so the axis never crowds.
  const labelStep = Math.max(1, Math.ceil(points.length / MAX_X_LABELS));

  const polyline = (pick: (p: TrendPoint) => number) =>
    points.map((p, i) => `${i * slotW + slotW / 2},${y(pick(p))}`).join(' ');

  const series = [
    { key: 'expense' as const, color: colors.expense, label: 'Spending', pick: (p: TrendPoint) => p.expenseMinor },
    { key: 'income' as const, color: colors.income, label: 'Income', pick: (p: TrendPoint) => p.incomeMinor },
  ];

  return (
    <View style={styles.wrap} onLayout={onLayout}>
      <View style={styles.plotRow}>
        {/* y-axis labels, top value first */}
        <View style={[styles.axisY, { height: plotH }]}>
          {Array.from({ length: GRID_LINES + 1 }, (_, i) => (
            <Text
              key={i}
              style={[type.caption, styles.axisText, { color: colors.textSubtle }]}>
              {/* With no data every tick would read "0" — label the baseline only. */}
              {peak > 0 || i === GRID_LINES ? formatCompactMinor((top / GRID_LINES) * (GRID_LINES - i)) : ''}
            </Text>
          ))}
        </View>

        {plotW > 0 ? (
          <Svg width={plotW} height={plotH}>
            {Array.from({ length: GRID_LINES + 1 }, (_, i) => {
              const gy = (plotH / GRID_LINES) * i;
              return (
                <Line
                  key={i}
                  x1={0}
                  y1={gy}
                  x2={plotW}
                  y2={gy}
                  stroke={colors.border}
                  strokeWidth={StyleSheet.hairlineWidth * 2}
                />
              );
            })}

            {mode === 'bar'
              ? points.map((p, i) =>
                  series.map((s, si) => {
                    const value = s.pick(p);
                    if (value <= 0) return null;
                    const h = Math.max(1, plotH - y(value));
                    const x = i * slotW + slotW / 2 + (si === 0 ? -barW - BAR_GAP / 2 : BAR_GAP / 2);
                    return (
                      <GrowingBar
                        key={`${p.key}-${s.key}`}
                        x={x}
                        width={barW}
                        fullHeight={h}
                        plotHeight={plotH}
                        color={s.color}
                        grow={grow}
                      />
                    );
                  }),
                )
              : series.map((s) => (
                  <Polyline
                    key={s.key}
                    points={polyline(s.pick)}
                    fill="none"
                    stroke={s.color}
                    strokeWidth={2}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                  />
                ))}

            {/* Dots make a short line series readable as data points. */}
            {mode === 'line' && points.length <= 16
              ? points.flatMap((p, i) =>
                  series.map((s) => (
                    <Circle
                      key={`${p.key}-${s.key}-dot`}
                      cx={i * slotW + slotW / 2}
                      cy={y(s.pick(p))}
                      r={3}
                      fill={s.color}
                    />
                  )),
                )
              : null}
          </Svg>
        ) : null}
      </View>

      {/* x-axis — labels are absolutely placed on their bucket's centre so a
          31-day month can label every 6th day without squeezing the rest. */}
      <View style={[styles.axisX, { marginLeft: AXIS_GUTTER }]}>
        {points.map((p, i) =>
          i % labelStep === 0 ? (
            <Text
              key={p.key}
              numberOfLines={1}
              style={[
                type.caption,
                styles.xLabel,
                { color: colors.textSubtle, left: i * slotW + slotW / 2 - X_LABEL_W / 2 },
              ]}>
              {p.label}
            </Text>
          ) : null,
        )}
      </View>

      <View style={styles.legend}>
        {series.map((s) => (
          <View key={s.key} style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: s.color }]} />
            <Text style={[type.caption, { color: colors.textMuted }]}>{s.label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

/** A bar that grows from the baseline. Own component so it can hold a hook. */
function GrowingBar({
  x,
  width,
  fullHeight,
  plotHeight,
  color,
  grow,
}: {
  x: number;
  width: number;
  fullHeight: number;
  plotHeight: number;
  color: string;
  grow: { value: number };
}) {
  const animatedProps = useAnimatedProps(() => {
    const h = Math.max(0.01, fullHeight * grow.value);
    return { y: plotHeight - h, height: h };
  });

  return (
    <AnimatedRect
      animatedProps={animatedProps}
      x={x}
      width={width}
      rx={width / 2}
      fill={color}
    />
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.sm },
  plotRow: { flexDirection: 'row', alignItems: 'flex-start' },
  // Shifted up by half a line so each label centres on its gridline.
  axisY: { width: AXIS_GUTTER, justifyContent: 'space-between', transform: [{ translateY: -8 }] },
  axisText: { ...tabularNums, textAlign: 'right', paddingRight: space.sm },
  axisX: { height: 18 },
  xLabel: { position: 'absolute', width: X_LABEL_W, textAlign: 'center', ...tabularNums },
  legend: { flexDirection: 'row', justifyContent: 'center', gap: space.lg },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: space.xs + 2 },
  legendDot: { width: 10, height: 10, borderRadius: 5 },
});
