/**
 * Top-of-screen rollup for the Recurring tabs.
 *
 * Expenses variant: "N ACTIVE · Rs.../mo · Next 7 days Rs..." with the group
 * bar. Income variant: "N SOURCES · Rs.../mo · Left over Rs..." (the left-over
 * is monthly income − monthly expense, so it can be negative). Money stays in
 * integer minor units; <Amount> owns sign/colour.
 */
import { StyleSheet, Text, View } from 'react-native';

import { Amount } from '@/components/Amount';
import { RecurringGroupBar, type GroupSegment } from '@/components/recurring/RecurringGroupBar';
import { formatAmount } from '@/domain/money';
import { useCurrency } from '@/theme/CurrencyContext';
import { useTheme } from '@/theme/ThemeContext';
import { layout, shadow, space, type } from '@/theme/tokens';

interface Props {
  variant: 'expenses' | 'income';
  count: number;
  monthlyMinor: number;
  /** Expenses: next-7-days due total. Income: the left-over figure. */
  asideMinor: number;
  segments?: GroupSegment[];
}

export function RecurringSummaryCard({ variant, count, monthlyMinor, asideMinor, segments }: Props) {
  const { colors } = useTheme();
  const { symbol } = useCurrency();
  const income = variant === 'income';

  const eyebrow = income
    ? `${count} ${count === 1 ? 'SOURCE' : 'SOURCES'}`
    : `${count} ACTIVE`;
  const monthlyColor = income ? colors.income : colors.text;
  const asideLabel = income ? 'Left over' : 'Next 7 days';
  // Left-over can be negative (spend more than you earn) — <Amount> shows the
  // sign; income green stays only when there is something left over.
  const asideColor = income ? (asideMinor >= 0 ? colors.income : colors.expense) : colors.warning;

  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }, shadow]}>
      <View style={styles.topRow}>
        <View style={styles.left}>
          <Text style={[type.sectionLabel, { color: colors.textSubtle }]}>{eyebrow}</Text>
          <View style={styles.monthlyRow}>
            <Text style={[type.display, { color: monthlyColor }]}>
              {formatAmount(monthlyMinor, symbol)}
            </Text>
            <Text style={[type.body, styles.perMo, { color: colors.textMuted }]}>/mo</Text>
          </View>
        </View>
        <View style={styles.aside}>
          <Text style={[type.caption, { color: colors.textMuted }]}>{asideLabel}</Text>
          {income ? (
            <Text style={[type.amount, { color: asideColor }]}>
              {asideMinor < 0 ? '−' : ''}
              {formatAmount(Math.abs(asideMinor), symbol)}
            </Text>
          ) : (
            <Amount valueMinor={asideMinor} textStyle={type.amount} colorOverride={asideColor} />
          )}
        </View>
      </View>

      {!income && segments ? <RecurringGroupBar segments={segments} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: layout.heroCardRadius,
    borderWidth: StyleSheet.hairlineWidth,
    padding: space.lg,
    gap: space.lg,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: space.md,
  },
  left: { gap: space.xs, flexShrink: 1 },
  monthlyRow: { flexDirection: 'row', alignItems: 'baseline', gap: space.xs },
  perMo: { marginBottom: 2 },
  aside: { alignItems: 'flex-end', gap: space.xs },
});
