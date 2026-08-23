/**
 * One slice of a report breakdown — category, account, person, or the
 * recurring/one-off split. Icon tile, name with its share, transaction count,
 * amount, and a share bar. Tapping opens the drill-down; long content wraps
 * rather than truncating, because a category name is the row's identity.
 *
 * The tile colour matches the donut segment for the same slice, and is always
 * paired with the name and the percentage — never meaning by colour alone.
 */
import { Feather } from '@expo/vector-icons';
import type { ComponentProps } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Amount } from '@/components/Amount';
import { formatPercent } from '@/domain/money';
import { useTheme } from '@/theme/ThemeContext';
import { layout, radius, space, tabularNums, type } from '@/theme/tokens';

export interface BreakdownRowData {
  id: string;
  name: string;
  icon: string | null;
  color: string;
  totalMinor: number;
  txCount: number;
  /** Share of the breakdown's total, 0–1. */
  share: number;
}

interface Props {
  row: BreakdownRowData;
  /** Share relative to the biggest slice, so the bars use the full width. */
  barFraction: number;
  selected?: boolean;
  onPress: () => void;
  onLongPress?: () => void;
}

export function BreakdownRow({ row, barFraction, selected, onPress, onLongPress }: Props) {
  const { colors } = useTheme();
  const fill = Math.max(0.02, Math.min(1, barFraction));

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${row.name}, ${formatPercent(row.share, 1)}, ${row.txCount} transaction${row.txCount === 1 ? '' : 's'}`}
      accessibilityState={{ selected }}
      onPress={onPress}
      onLongPress={onLongPress}
      style={({ pressed }) => [
        styles.row,
        selected && { backgroundColor: colors.surfaceAlt },
        pressed && styles.pressed,
      ]}>
      <View style={styles.head}>
        <View style={[styles.iconTile, { backgroundColor: `${row.color}1F` }]}>
          <Feather
            name={(row.icon as ComponentProps<typeof Feather>['name']) ?? 'circle'}
            size={18}
            color={row.color}
          />
        </View>

        <View style={styles.text}>
          <Text style={[type.body, { color: colors.text }]}>
            {row.name}{' '}
            <Text style={[type.caption, styles.share, { color: colors.textMuted }]}>
              ({formatPercent(row.share, 1)})
            </Text>
          </Text>
          <Text style={[type.caption, { color: colors.textMuted }]}>
            {row.txCount} transaction{row.txCount === 1 ? '' : 's'}
          </Text>
        </View>

        <Amount valueMinor={row.totalMinor} textStyle={type.amount} colorOverride={colors.text} />
        <Feather name="chevron-right" size={18} color={colors.textSubtle} />
      </View>

      <View style={[styles.track, { backgroundColor: `${row.color}26` }]}>
        <View style={[styles.fill, { backgroundColor: row.color, flex: fill }]} />
        <View style={{ flex: 1 - fill }} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    gap: space.sm,
    paddingVertical: space.sm,
    paddingHorizontal: space.sm,
    borderRadius: radius.md,
  },
  pressed: { opacity: 0.7 },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  iconTile: {
    width: layout.iconTile.size,
    height: layout.iconTile.size,
    borderRadius: layout.iconTile.radius,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: { flex: 1, gap: 2 },
  share: { ...tabularNums },
  track: {
    flexDirection: 'row',
    height: layout.reports.breakdownTrackH,
    borderRadius: radius.pill,
    overflow: 'hidden',
  },
  fill: { borderRadius: radius.pill },
});
