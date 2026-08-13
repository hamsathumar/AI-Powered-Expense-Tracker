/**
 * One recurring template as a list row (screenshot 4a). Mirrors the tinted
 * icon-square language of TransactionRow.
 *
 *   [icon]  Netflix                         Rs1,890.00
 *           Monthly · Visa Credit
 *
 * Variable bills (Feature 6) show the most recent actual payment with a "≈"
 * prefix and a "Last month" caption instead of the flat template amount.
 * Loans (Feature 5) add a progress bar + "N of M paid · Rs left · Ends …".
 */
import { Feather } from '@expo/vector-icons';
import { format, parseISO } from 'date-fns';
import type { ComponentProps } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Amount } from '@/components/Amount';
import { PressableScale } from '@/components/PressableScale';
import type { ApprovedAggregate, RecurringListItem } from '@/db/queries/recurring';
import { formatAmount } from '@/domain/money';
import { frequencyLabel } from '@/domain/recurringDisplay';
import { useCurrency } from '@/theme/CurrencyContext';
import { useTheme } from '@/theme/ThemeContext';
import { radius, recurringGroupColors, space, type } from '@/theme/tokens';

const TYPE_ICONS: Record<string, ComponentProps<typeof Feather>['name']> = {
  transfer: 'repeat',
  lending: 'users',
  income: 'trending-up',
};

interface Props {
  item: RecurringListItem;
  /** Most recent actual payment amount, if any — enables the "≈ / Last month" row. */
  lastPaymentMinor?: number;
  /** Approved count + sum for loan progress. */
  approved?: ApprovedAggregate;
  /** Replaces the "Monthly · Account" caption (e.g. "Paused until 1 Oct"). */
  subtitleOverride?: string;
  /** Current period already settled by an approved payment — shows a done tag. */
  paid?: boolean;
  onPress: () => void;
  dimmed?: boolean;
}

export function RecurringListRow({
  item,
  lastPaymentMinor,
  approved,
  subtitleOverride,
  paid,
  onPress,
  dimmed,
}: Props) {
  const { colors } = useTheme();
  const { symbol } = useCurrency();
  const { template } = item;

  const icon: ComponentProps<typeof Feather>['name'] =
    template.type === 'expense' || template.type === 'income'
      ? ((item.categoryIcon as ComponentProps<typeof Feather>['name']) ??
        TYPE_ICONS[template.type] ??
        'circle')
      : (TYPE_ICONS[template.type] ?? 'repeat');
  const iconColor = item.categoryColor ?? colors[template.type];

  // Variable-amount bill: the newest actual payment differs from the stored
  // template amount → show it as the approximate current figure.
  const isVariable =
    lastPaymentMinor !== undefined && lastPaymentMinor !== template.amountMinor;
  const shownMinor = isVariable ? lastPaymentMinor! : template.amountMinor;

  const isLoan =
    template.recurringGroup === 'loan' && template.totalInstallments != null;
  const paidCount = approved?.count ?? 0;
  const totalCount = template.totalInstallments ?? 0;
  const fraction = totalCount > 0 ? Math.min(1, Math.max(0, paidCount / totalCount)) : 0;
  const remainingMinor =
    template.principalMinor != null
      ? Math.max(0, template.principalMinor - (approved?.sumMinor ?? 0))
      : null;

  const subtitle =
    subtitleOverride ??
    `${frequencyLabel(template.frequency, template.intervalDays)}${
      item.accountName ? ` · ${item.accountName}` : ''
    }`;

  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={`${template.name}, recurring`}
      onPress={onPress}
      scaleTo={0.98}
      style={[styles.row, { backgroundColor: colors.surface }, dimmed && styles.dimmed]}>
      <View style={styles.head}>
        <View style={[styles.iconBox, { backgroundColor: `${iconColor}22` }]}>
          <Feather name={icon} size={18} color={iconColor} />
        </View>
        <View style={styles.middle}>
          <Text numberOfLines={1} style={[type.body, { color: colors.text }]}>
            {template.name}
          </Text>
          <Text numberOfLines={1} style={[type.caption, { color: colors.textMuted }]}>
            {subtitle}
          </Text>
        </View>
        <View style={styles.amountCol}>
          <View style={styles.amountRow}>
            {isVariable ? (
              <Text style={[type.amount, { color: colors.textMuted }]}>≈</Text>
            ) : null}
            <Amount valueMinor={shownMinor} colorOverride={colors.text} />
          </View>
          {paid ? (
            <View style={styles.paidTag}>
              <Feather name="check-circle" size={11} color={colors.success} />
              <Text style={[type.caption, { color: colors.success }]}>Paid</Text>
            </View>
          ) : isVariable ? (
            <Text style={[type.caption, { color: colors.textSubtle }]}>Last month</Text>
          ) : null}
        </View>
      </View>

      {isLoan ? (
        <View style={styles.loan}>
          <View style={[styles.loanTrack, { backgroundColor: colors.surfaceAlt }]}>
            <View
              style={[
                styles.loanFill,
                { backgroundColor: recurringGroupColors.loan, width: `${fraction * 100}%` },
              ]}
            />
          </View>
          <View style={styles.loanMeta}>
            <Text style={[type.caption, { color: colors.textMuted }]}>
              {paidCount} of {totalCount} paid
              {remainingMinor != null ? ` · ${formatAmount(remainingMinor, symbol)} left` : ''}
            </Text>
            {template.endDate ? (
              <Text style={[type.caption, { color: colors.textSubtle }]}>
                Ends {format(parseISO(template.endDate), 'MMM yyyy')}
              </Text>
            ) : null}
          </View>
        </View>
      ) : null}
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  row: {
    borderRadius: radius.md,
    padding: space.md,
    gap: space.sm,
  },
  dimmed: { opacity: 0.55 },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  iconBox: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  middle: { flex: 1, gap: 2 },
  amountCol: { alignItems: 'flex-end', gap: 2 },
  amountRow: { flexDirection: 'row', alignItems: 'baseline', gap: 2 },
  paidTag: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  loan: { gap: space.xs + 2 },
  loanTrack: {
    height: 5,
    borderRadius: radius.pill,
    overflow: 'hidden',
  },
  loanFill: { height: '100%', borderRadius: radius.pill },
  loanMeta: { flexDirection: 'row', justifyContent: 'space-between', gap: space.sm },
});
