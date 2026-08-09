/**
 * Balance hero card (design-system.md §5.2): primary-brown filled card with
 * the total balance, this month's income/expense summary, an eye toggle to
 * hide amounts in public, and the pending-review count. Approved
 * transactions only — pending items must NEVER appear in headline totals.
 */
import { Feather } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Amount } from '@/components/Amount';
import { useTheme } from '@/theme/ThemeContext';
import { minTouchTarget, radius, shadow, space, type } from '@/theme/tokens';

interface Props {
  totalBalanceMinor: number;
  monthIncomeMinor: number;
  monthExpenseMinor: number;
  pendingCount: number;
}

export function BalanceHero({
  totalBalanceMinor,
  monthIncomeMinor,
  monthExpenseMinor,
  pendingCount,
}: Props) {
  const { colors, isDark } = useTheme();
  const [hidden, setHidden] = useState(false);

  return (
    <View style={[styles.card, { backgroundColor: colors.primary }, !isDark && shadow]}>
      <View style={styles.topRow}>
        <Text style={[type.label, { color: colors.onPrimary, opacity: 0.8 }]}>Total balance</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={hidden ? 'Show amounts' : 'Hide amounts'}
          onPress={() => setHidden((h) => !h)}
          hitSlop={space.sm}
          style={styles.eye}>
          <Feather name={hidden ? 'eye-off' : 'eye'} size={18} color={colors.onPrimary} />
        </Pressable>
      </View>

      {hidden ? (
        <Text style={[type.displayXL, { color: colors.onPrimary }]}>Rs ••••••</Text>
      ) : (
        <Amount
          valueMinor={totalBalanceMinor}
          textStyle={type.displayXL}
          colorOverride={colors.onPrimary}
        />
      )}

      <View style={styles.summaryRow}>
        <View style={styles.summaryItem}>
          <Text style={[type.caption, { color: colors.onPrimary, opacity: 0.8 }]}>
            This month in
          </Text>
          {hidden ? (
            <Text style={[type.amount, { color: colors.onPrimary }]}>••••</Text>
          ) : (
            <Amount
              valueMinor={monthIncomeMinor}
              txType="income"
              colorOverride={colors.onPrimary}
            />
          )}
        </View>
        <View style={styles.summaryItem}>
          <Text style={[type.caption, { color: colors.onPrimary, opacity: 0.8 }]}>
            This month out
          </Text>
          {hidden ? (
            <Text style={[type.amount, { color: colors.onPrimary }]}>••••</Text>
          ) : (
            <Amount
              valueMinor={monthExpenseMinor}
              txType="expense"
              colorOverride={colors.onPrimary}
            />
          )}
        </View>
      </View>

      {pendingCount > 0 ? (
        <View style={[styles.pendingPill, { backgroundColor: colors.primaryPress }]}>
          <Feather name="inbox" size={12} color={colors.onPrimary} />
          <Text style={[type.caption, { color: colors.onPrimary }]}>
            {pendingCount} to review — not counted above
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.lg,
    padding: space.xl,
    gap: space.md,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  eye: {
    minWidth: minTouchTarget - space.md,
    minHeight: minTouchTarget - space.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  summaryRow: {
    flexDirection: 'row',
    gap: space.xxl,
  },
  summaryItem: {
    gap: space.xs,
  },
  pendingPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    alignSelf: 'flex-start',
    borderRadius: radius.pill,
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
  },
});
