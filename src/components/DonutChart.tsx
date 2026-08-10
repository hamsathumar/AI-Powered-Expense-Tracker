/**
 * Donut chart (design §5.11) — hand-built on react-native-svg. Category
 * segments coloured from the same palette as the bar list, percentage labels
 * on larger segments, and a center hole showing the total. Tapping a segment
 * selects it (dims the others); the parent highlights the matching bar row.
 */
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, G, Text as SvgText } from 'react-native-svg';

import { Amount } from '@/components/Amount';
import { useTheme } from '@/theme/ThemeContext';
import { type } from '@/theme/tokens';

export interface DonutSegment {
  id: string;
  label: string;
  value: number;
  color: string;
}

const SIZE = 210;
const STROKE = 34;

interface Props {
  segments: DonutSegment[];
  total: number;
  selectedId?: string | null;
  onSelect?: (id: string | null) => void;
}

export function DonutChart({ segments, total, selectedId, onSelect }: Props) {
  const { colors } = useTheme();
  const r = (SIZE - STROKE) / 2;
  const c = SIZE / 2;
  const circumference = 2 * Math.PI * r;

  const positive = segments.filter((s) => s.value > 0);
  const fractionOf = (v: number) => (total > 0 ? v / total : 0);
  const arcs = positive.map((s, i) => ({
    ...s,
    fraction: fractionOf(s.value),
    // Cumulative start = sum of prior fractions (n is small — categories).
    start: positive.slice(0, i).reduce((sum, p) => sum + fractionOf(p.value), 0),
  }));

  return (
    <View style={styles.wrap}>
      <Svg width={SIZE} height={SIZE}>
        <G rotation={-90} origin={`${c}, ${c}`}>
          {arcs.map((a) => {
            const dashLen = a.fraction * circumference;
            const dimmed = selectedId != null && selectedId !== a.id;
            return (
              <Circle
                key={a.id}
                cx={c}
                cy={c}
                r={r}
                fill="none"
                stroke={a.color}
                strokeWidth={STROKE}
                strokeDasharray={`${dashLen} ${circumference - dashLen}`}
                strokeDashoffset={-a.start * circumference}
                opacity={dimmed ? 0.3 : 1}
                onPress={() => onSelect?.(selectedId === a.id ? null : a.id)}
              />
            );
          })}
        </G>
        {arcs
          .filter((a) => a.fraction >= 0.08)
          .map((a) => {
            const mid = (a.start + a.fraction / 2) * 2 * Math.PI - Math.PI / 2;
            return (
              <SvgText
                key={a.id}
                x={c + r * Math.cos(mid)}
                y={c + r * Math.sin(mid)}
                fill="#FFFFFF"
                fontSize={11}
                fontWeight="bold"
                textAnchor="middle"
                alignmentBaseline="middle">
                {Math.round(a.fraction * 100)}%
              </SvgText>
            );
          })}
      </Svg>
      <View style={styles.center} pointerEvents="none">
        <Text style={[type.caption, { color: colors.textMuted }]}>Total</Text>
        <Amount valueMinor={total} textStyle={type.h2} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: SIZE,
    height: SIZE,
    alignSelf: 'center',
  },
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
