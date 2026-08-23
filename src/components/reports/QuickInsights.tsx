/**
 * Quick Insights (Reports v2) — the five numbers that answer "how did this
 * period go?" without reading a chart: savings rate, average daily spend,
 * transaction count, the top spending category, and the single largest
 * transaction.
 *
 * Every figure obeys the golden rule (it is computed from approved
 * expense/income only) and respects the active period + filter. The two
 * entity-backed tiles are pressable: Top category drills into the breakdown,
 * Largest expense opens that transaction.
 */
import { Feather } from '@expo/vector-icons';
import type { ComponentProps } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Amount } from '@/components/Amount';
import { formatPercent } from '@/domain/money';
import { useTheme } from '@/theme/ThemeContext';
import { layout, radius, shadow, space, tabularNums, type } from '@/theme/tokens';

type FeatherName = ComponentProps<typeof Feather>['name'];

export interface InsightsData {
  incomeMinor: number;
  expenseMinor: number;
  /** Days of the period that have actually happened (reportRange.elapsedDays). */
  elapsedDays: number;
  txCount: number;
  topCategory: { id: string; name: string; icon: string | null; color: string; shareOfExpense: number } | null;
  largest: { id: string; name: string; amountMinor: number } | null;
}

interface Props {
  data: InsightsData;
  onPressTopCategory: (categoryId: string) => void;
  onPressLargest: (transactionId: string) => void;
}

function Tile({
  icon,
  tint,
  label,
  children,
  trailing,
  onPress,
}: {
  icon: FeatherName;
  tint: string;
  label: string;
  children: React.ReactNode;
  trailing?: React.ReactNode;
  onPress?: () => void;
}) {
  const { colors } = useTheme();
  const body = (
    <>
      <View style={[styles.iconTile, { backgroundColor: `${tint}1F` }]}>
        <Feather name={icon} size={18} color={tint} />
      </View>
      <View style={styles.tileText}>
        <Text numberOfLines={1} style={[type.caption, { color: colors.textMuted }]}>
          {label}
        </Text>
        {children}
      </View>
      {trailing}
    </>
  );

  if (!onPress) {
    return <View style={[styles.tile, { backgroundColor: colors.surfaceAlt }]}>{body}</View>;
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.tile,
        { backgroundColor: colors.surfaceAlt },
        pressed && styles.pressed,
      ]}>
      {body}
    </Pressable>
  );
}

export function QuickInsights({ data, onPressTopCategory, onPressLargest }: Props) {
  const { colors, isDark } = useTheme();
  const { incomeMinor, expenseMinor, elapsedDays, txCount, topCategory, largest } = data;

  // Savings rate is only meaningful against income you actually earned.
  const savingsFraction = incomeMinor > 0 ? (incomeMinor - expenseMinor) / incomeMinor : null;
  const avgDailyMinor = Math.round(expenseMinor / Math.max(1, elapsedDays));

  return (
    <View style={[styles.card, { backgroundColor: colors.surface }, !isDark && shadow]}>
      <Text style={[type.h2, { color: colors.text }]}>Quick Insights</Text>

      <View style={styles.row}>
        <View style={styles.half}>
          <Tile icon="percent" tint={colors.income} label="Savings rate">
            <Text style={[type.amount, { color: savingsFraction == null ? colors.textSubtle : colors.text }]}>
              {savingsFraction == null ? 'No income' : formatPercent(savingsFraction, 1)}
            </Text>
          </Tile>
        </View>
        <View style={styles.half}>
          <Tile icon="calendar" tint={colors.primary} label="Avg. daily">
            <Amount valueMinor={avgDailyMinor} textStyle={type.amount} colorOverride={colors.text} />
          </Tile>
        </View>
      </View>

      <Tile icon="list" tint={colors.transfer} label="Transactions">
        <Text style={[type.amount, styles.count, { color: colors.text }]}>{txCount}</Text>
      </Tile>

      {topCategory ? (
        <Tile
          icon={(topCategory.icon as FeatherName) ?? 'tag'}
          tint={topCategory.color}
          label="Top category"
          onPress={() => onPressTopCategory(topCategory.id)}
          trailing={
            <View style={styles.trailing}>
              <Text style={[type.label, styles.count, { color: colors.textMuted }]}>
                {formatPercent(topCategory.shareOfExpense)}
              </Text>
              <Feather name="chevron-right" size={16} color={colors.textSubtle} />
            </View>
          }>
          <Text numberOfLines={1} style={[type.body, { color: colors.text }]}>
            {topCategory.name}
          </Text>
        </Tile>
      ) : null}

      {largest ? (
        <Tile
          icon="arrow-up-right"
          tint={colors.expense}
          label="Largest expense"
          onPress={() => onPressLargest(largest.id)}
          trailing={
            <View style={styles.trailing}>
              <Amount valueMinor={largest.amountMinor} txType="expense" textStyle={type.label} />
              <Feather name="chevron-right" size={16} color={colors.textSubtle} />
            </View>
          }>
          <Text numberOfLines={1} style={[type.body, { color: colors.text }]}>
            {largest.name}
          </Text>
        </Tile>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: layout.heroCardRadius,
    padding: space.lg,
    gap: space.sm,
  },
  row: { flexDirection: 'row', gap: space.sm },
  half: { flex: 1 },
  tile: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.md,
    borderRadius: radius.md,
  },
  pressed: { opacity: 0.7 },
  iconTile: {
    width: layout.reports.insightTile.size,
    height: layout.reports.insightTile.size,
    borderRadius: layout.reports.insightTile.radius,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileText: { flex: 1, gap: 2 },
  trailing: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  count: { ...tabularNums },
});
