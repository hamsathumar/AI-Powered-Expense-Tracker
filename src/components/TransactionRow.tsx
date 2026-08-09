/**
 * Transaction row (design-system.md §5.1) — the most repeated component in
 * the app.
 *
 *   [icon]  Name                        −Rs200.00
 *           Category · Account · 14:20
 *
 * Transfer rows show "Account A → Account B"; lending rows show the person
 * and direction in words. Pending rows get an amber left edge + label —
 * never colour alone.
 */
import { Feather } from '@expo/vector-icons';
import { format } from 'date-fns';
import type { ComponentProps } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Amount } from '@/components/Amount';
import type { TransactionListItem } from '@/db/queries/transactions';
import type { LendingDirection } from '@/domain/types';
import { useTheme } from '@/theme/ThemeContext';
import { radius, space, type } from '@/theme/tokens';

const LENDING_LABELS: Record<LendingDirection, (name: string) => string> = {
  lend: (n) => `Lent to ${n}`,
  lend_repayment_received: (n) => `${n} repaid you`,
  borrow: (n) => `Borrowed from ${n}`,
  borrow_repayment_made: (n) => `Repaid ${n}`,
};

const TYPE_ICONS: Record<string, ComponentProps<typeof Feather>['name']> = {
  transfer: 'repeat',
  lending: 'users',
};

export function TransactionRow({ item }: { item: TransactionListItem }) {
  const { colors } = useTheme();
  const { tx } = item;

  const icon =
    tx.type === 'expense' || tx.type === 'income'
      ? ((item.categoryIcon as ComponentProps<typeof Feather>['name']) ?? 'circle')
      : TYPE_ICONS[tx.type];
  const iconColor = item.categoryColor ?? colors[tx.type];

  let subtitle: string;
  switch (tx.type) {
    case 'expense':
    case 'income':
      subtitle = `${item.categoryName ?? '—'} · ${item.accountName ?? '—'}`;
      break;
    case 'transfer':
      subtitle = `${item.accountName ?? '—'} → ${item.toAccountName ?? '—'}`;
      break;
    case 'lending':
      subtitle = LENDING_LABELS[tx.direction](item.personName ?? '—');
      break;
  }
  const time = format(new Date(tx.occurredAt), 'HH:mm');
  const pending = tx.status === 'pending';

  return (
    <View
      style={[
        styles.row,
        { backgroundColor: colors.surface },
        pending && { borderLeftWidth: 3, borderLeftColor: colors.warning },
      ]}>
      <View style={[styles.iconBox, { backgroundColor: `${iconColor}22` }]}>
        <Feather name={icon} size={18} color={iconColor} />
      </View>
      <View style={styles.middle}>
        <Text numberOfLines={1} style={[type.body, { color: colors.text }]}>
          {tx.name}
        </Text>
        <Text numberOfLines={1} style={[type.caption, { color: colors.textMuted }]}>
          {subtitle} · {time}
          {pending ? ' · Pending' : ''}
        </Text>
      </View>
      <Amount valueMinor={tx.amountMinor} txType={tx.type} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.md,
    borderRadius: radius.md,
  },
  iconBox: {
    width: 36,
    height: 36,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  middle: {
    flex: 1,
    gap: 2,
  },
});
