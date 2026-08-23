/**
 * Donut chart (design §5.11) — hand-built on react-native-svg. Category
 * segments coloured from the same palette as the bar list, percentage labels
 * on larger segments, and a center hole showing the total (or the selected
 * slice's own read-out). Tapping a segment selects it and dims the others;
 * the parent highlights the matching row.
 *
 * Each segment is a filled WEDGE path, not a dashed circle stroke. That
 * matters for touch, not looks: a dashed <Circle> is hit-tested across the
 * whole ring, so the last-drawn segment captured every tap and only one slice
 * was ever selectable. The geometry lives in `domain/donutArcs.ts` and is
 * unit-tested there.
 */
import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedProps, useSharedValue, withTiming } from 'react-native-reanimated';
import Svg, { Circle, Path, Text as SvgText } from 'react-native-svg';

import { AnimatedAmount } from '@/components/AnimatedAmount';
import {
  annularSectorPath,
  buildArcs,
  midAngle,
  polarPoint,
  type DonutArc,
} from '@/domain/donutArcs';
import { useReduceMotion } from '@/theme/FeedbackContext';
import { useTheme } from '@/theme/ThemeContext';
import { layout, motion, space, type } from '@/theme/tokens';

const AnimatedPath = Animated.createAnimatedComponent(Path);

/** 12 o'clock start, matching `buildArcs`. */
const SWEEP_START = -Math.PI / 2;
const TAU = Math.PI * 2;

export interface DonutSegment {
  id: string;
  label: string;
  value: number;
  color: string;
}

const SIZE = layout.reports.donutSize;
const STROKE = layout.reports.donutStroke;

/** Below this share a percentage label doesn't fit inside the band. */
const LABEL_MIN_FRACTION = 0.08;

interface Props {
  segments: DonutSegment[];
  total: number;
  selectedId?: string | null;
  onSelect?: (id: string | null) => void;
  /** Caption above the centre figure — "Total", "Spending", "Income". */
  centerLabel?: string;
}

export function DonutChart({ segments, total, selectedId, onSelect, centerLabel = 'Total' }: Props) {
  const { colors } = useTheme();
  const center = SIZE / 2;
  const outerRadius = SIZE / 2;
  const innerRadius = outerRadius - STROKE;
  const midRadius = outerRadius - STROKE / 2;

  const reduceMotion = useReduceMotion();
  const arcs = buildArcs(segments, total);
  const selected = arcs.find((a) => a.id === selectedId) ?? null;

  // One shared clock drives every slice: the donut draws itself clockwise from
  // 12 o'clock. Keyed on the segment set so it replays when the grouping or
  // the filter changes, not on every unrelated re-render.
  const sweep = useSharedValue(reduceMotion ? 1 : 0);
  const sweepKey = arcs.map((a) => `${a.id}:${a.value}`).join('|');

  useEffect(() => {
    if (reduceMotion) {
      sweep.value = 1;
      return;
    }
    sweep.value = 0;
    sweep.value = withTiming(1, { duration: motion.chart });
  }, [sweepKey, reduceMotion, sweep]);

  return (
    <View style={styles.wrap}>
      <Svg width={SIZE} height={SIZE}>
        {/* Empty track — a donut with no data still reads as a chart. */}
        <Circle
          cx={center}
          cy={center}
          r={midRadius}
          fill="none"
          stroke={colors.surfaceAlt}
          strokeWidth={STROKE}
        />

        {arcs.map((arc) => (
          <DonutSlice
            key={arc.id}
            arc={arc}
            center={center}
            outerRadius={outerRadius}
            innerRadius={innerRadius}
            sweep={sweep}
            dimmed={selectedId != null && selectedId !== arc.id}
            onPress={() => onSelect?.(selectedId === arc.id ? null : arc.id)}
          />
        ))}

        {arcs
          .filter((arc) => arc.fraction >= LABEL_MIN_FRACTION)
          .map((arc) => {
            const point = polarPoint(center, center, midRadius, midAngle(arc));
            return (
              <SvgText
                key={arc.id}
                x={point.x}
                y={point.y}
                fill="#FFFFFF"
                fontSize={11}
                fontWeight="bold"
                textAnchor="middle"
                alignmentBaseline="middle"
                // Labels must not eat the wedge's own taps.
                pointerEvents="none">
                {Math.round(arc.fraction * 100)}%
              </SvgText>
            );
          })}
      </Svg>

      <View style={styles.center} pointerEvents="none">
        <Text numberOfLines={2} style={[type.caption, styles.centerLabel, { color: colors.textMuted }]}>
          {selected ? selected.label : centerLabel}
        </Text>
        <AnimatedAmount valueMinor={selected ? selected.value : total} textStyle={type.h2} />
        {selected ? (
          <Text style={[type.caption, { color: colors.textSubtle }]}>
            {Math.round(selected.fraction * 100)}% of total
          </Text>
        ) : null}
      </View>
    </View>
  );
}

/**
 * One wedge. Its own component because the sweep needs a hook per slice, and a
 * hook cannot live inside a map.
 */
function DonutSlice({
  arc,
  center,
  outerRadius,
  innerRadius,
  sweep,
  dimmed,
  onPress,
}: {
  arc: DonutArc;
  center: number;
  outerRadius: number;
  innerRadius: number;
  sweep: { value: number };
  dimmed: boolean;
  onPress: () => void;
}) {
  const animatedProps = useAnimatedProps(() => {
    // Reveal clockwise: this slice is clipped to however far the sweep has got.
    const revealedTo = SWEEP_START + sweep.value * TAU;
    const end = Math.min(arc.endAngle, revealedTo);
    if (end <= arc.startAngle) return { d: '' };
    return {
      d: annularSectorPath(center, center, outerRadius, innerRadius, arc.startAngle, end),
    };
  });

  return (
    <AnimatedPath
      animatedProps={animatedProps}
      fill={arc.color}
      opacity={dimmed ? 0.3 : 1}
      onPress={onPress}
    />
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: SIZE,
    height: SIZE,
    alignSelf: 'center',
  },
  centerLabel: { maxWidth: SIZE - 2 * STROKE - space.sm, textAlign: 'center' },
  center: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
