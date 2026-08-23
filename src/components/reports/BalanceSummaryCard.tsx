/**
 * Reports summary card (v2) — total balance across all accounts, plus income
 * and spending for the active period with a like-for-like comparison against
 * the equally long period before it (domain/reportRange.previousRange).
 *
 * The delta is never colour-alone: it carries an arrow, a signed percentage,
 * and the previous figure spelled out underneath. "Good" and "bad" differ by
 * metric — income rising is good, spending rising is not — so the tint is
 * chosen from the *meaning* of the change, not from its sign.
 */
import { Feather } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';

import { AnimatedAmount } from '@/components/AnimatedAmount';
import { formatAmount } from '@/domain/money';
import { useCurrency } from '@/theme/CurrencyContext';
import { useTheme } from '@/theme/ThemeContext';
import { layout, radius, shadow, space, tabularNums, type } from '@/theme/tokens';

interface Metric {
  currentMinor: number;
  previousMinor: number;
}

interface Props {
  totalBalanceMinor: number;
  income: Metric;
  expense: Metric;
  /** e.g. "vs previous month" — spells out what the comparison is against. */
  comparisonLabel: string;
}

/** null when there is no baseline to compare against (previous period empty). */
function changeFraction({ currentMinor, previousMinor }: Metric): number | null {
  if (previousMinor === 0) return currentMinor === 0 ? 0 : null;
  return (currentMinor - previousMinor) / previousMinor;
}

export function BalanceSummaryCard({ totalBalanceMinor, income, expense, comparisonLabel }: Props) {
  const { colors, isDark } = useTheme();
  const { symbol } = useCurrency();

  const tiles = [
    { key: 'income' as const, label: 'Income', metric: income, riseIsGood: true },
    { key: 'expense' as const, label: 'Spending', metric: expense, riseIsGood: false },
  ];

  return (
    <View style={[styles.card, { backgroundColor: colors.surface }, !isDark && shadow]}>
      <View style={styles.totalRow}>
        <Text style={[type.h2, { color: colors.text }]}>Total balance</Text>
        <AnimatedAmount valueMinor={totalBalanceMinor} textStyle={type.display} />
      </View>

      <View style={styles.tiles}>
        {tiles.map(({ key, label, metric, riseIsGood }) => {
          const fraction = changeFraction(metric);
          const rising = fraction != null && fraction > 0;
          const flat = fraction === 0 || fraction == null;
          const good = riseIsGood ? rising : !rising;
          const deltaColor = flat ? colors.textMuted : good ? colors.income : colors.expense;
          const tint = key === 'income' ? colors.income : colors.expense;

          return (
            <View key={key} style={[styles.tile, { backgroundColor: `${tint}14` }]}>
              <View style={styles.tileHead}>
                <View style={styles.tileLabel}>
                  <Feather
                    name={key === 'income' ? 'arrow-up' : 'arrow-down'}
                    size={13}
                    color={tint}
                  />
                  <Text numberOfLines={1} style={[type.caption, { color: colors.textMuted }]}>
                    {label}
                  </Text>
                </View>
                {fraction != null && fraction !== 0 ? (
                  <View style={styles.delta}>
                    <Text style={[type.caption, styles.deltaText, { color: deltaColor }]}>
                      {rising ? '+' : '−'}
                      {Math.abs(Math.round(fraction * 100))}%
                    </Text>
                    <Feather
                      name={rising ? 'trending-up' : 'trending-down'}
                      size={12}
                      color={deltaColor}
                    />
                  </View>
                ) : null}
              </View>

              <AnimatedAmount
                valueMinor={metric.currentMinor}
                textStyle={type.amount}
                colorOverride={colors.text}
              />
              <Text numberOfLines={1} style={[type.caption, { color: colors.textSubtle }]}>
                was {formatAmount(metric.previousMinor, symbol)}
              </Text>
            </View>
          );
        })}
      </View>

      <Text style={[type.caption, { color: colors.textSubtle }]}>{comparisonLabel}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: layout.heroCardRadius,
    padding: space.lg,
    gap: space.md,
  },
  totalRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: space.sm,
  },
  tiles: { flexDirection: 'row', gap: space.sm },
  tile: {
    flex: 1,
    borderRadius: radius.md,
    padding: space.md,
    gap: space.xs,
  },
  tileHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.xs,
  },
  tileLabel: { flexDirection: 'row', alignItems: 'center', gap: space.xs, flexShrink: 1 },
  delta: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  deltaText: { ...tabularNums },
});
