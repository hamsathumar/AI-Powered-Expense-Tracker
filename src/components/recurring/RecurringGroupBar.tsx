/**
 * Stacked "where the monthly spend goes" bar for the Recurring summary card
 * (Feature 4). Each segment's width is proportional to that group's
 * monthly-normalised total; every segment is paired with a legend label so
 * meaning never rests on colour alone (design-system §1). Colours are the
 * fixed `recurringGroupColors` tokens.
 */
import { StyleSheet, Text, View } from 'react-native';

import { groupLegendLabel } from '@/domain/recurringDisplay';
import type { RecurringGroup } from '@/domain/types';
import { useTheme } from '@/theme/ThemeContext';
import { radius, recurringGroupColors, space, type } from '@/theme/tokens';

export interface GroupSegment {
  group: RecurringGroup;
  monthlyMinor: number;
}

/** Fixed render order so the bar and legend stay stable across renders. */
const ORDER: RecurringGroup[] = ['subscription', 'bill', 'rent', 'loan', 'other'];

export function RecurringGroupBar({ segments }: { segments: GroupSegment[] }) {
  const { colors } = useTheme();
  const byGroup = new Map(segments.map((s) => [s.group, s.monthlyMinor]));
  const visible = ORDER.filter((g) => (byGroup.get(g) ?? 0) > 0);
  const total = visible.reduce((sum, g) => sum + (byGroup.get(g) ?? 0), 0);

  if (total === 0) return null;

  return (
    <View style={styles.wrap}>
      <View style={[styles.track, { backgroundColor: colors.surfaceAlt }]}>
        {visible.map((g) => (
          <View
            key={g}
            style={{ flex: byGroup.get(g) ?? 0, backgroundColor: recurringGroupColors[g] }}
          />
        ))}
      </View>
      <View style={styles.legend}>
        {visible.map((g) => (
          <View key={g} style={styles.legendItem}>
            <View style={[styles.dot, { backgroundColor: recurringGroupColors[g] }]} />
            <Text style={[type.caption, { color: colors.textMuted }]}>{groupLegendLabel(g)}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.sm },
  track: {
    flexDirection: 'row',
    height: 8,
    borderRadius: radius.pill,
    overflow: 'hidden',
    gap: 2,
  },
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.md,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs + 2,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
});
