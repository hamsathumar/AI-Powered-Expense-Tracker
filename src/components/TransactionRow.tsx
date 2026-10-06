/**
 * Transaction row (design-system.md §5.1) — the most repeated component in
 * the app.
 *
 *   [icon]  Name                        −Rs200.00
 *           Category · Account · 14:20
 *
 * Transfer rows show "Account A → Account B"; lending rows show the person
 * and direction in words. Pending rows get an amber left edge + label —
 * never colour alone. Rows on a private account carry a lock + "Private".
 */
import { Feather } from '@expo/vector-icons';
import { format } from 'date-fns';
import type { ComponentProps } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Amount } from '@/components/Amount';
import type { TransactionListItem } from '@/db/queries/transactions';
import { lendingPresentation } from '@/domain/lendingPresentation';
import { useTheme } from '@/theme/ThemeContext';
import { radius, space, type } from '@/theme/tokens';

const TYPE_ICONS: Record<string, ComponentProps<typeof Feather>['name']> = {
  transfer: 'repeat',
  lending: 'users',
};

export function TransactionRow({ item }: { item: TransactionListItem }) {
  const { colors } = useTheme();
  const { tx } = item;

  const lend = tx.type === 'lending' ? lendingPresentation(tx.direction) : null;
  const icon = lend
    ? lend.icon
    : tx.type === 'expense' || tx.type === 'income'
      ? ((item.categoryIcon as ComponentProps<typeof Feather>['name']) ?? 'circle')
      : TYPE_ICONS[tx.type];
  const iconColor = lend ? colors[lend.tone] : (item.categoryColor ?? colors[tx.type]);

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
      subtitle = lendingPresentation(tx.direction).label(item.personName ?? '—');
      break;
  }
  const time = format(new Date(tx.occurredAt), 'HH:mm');
  const pending = tx.status === 'pending';
  const isPrivate = item.accountPrivate || item.toAccountPrivate;

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
        <View style={styles.metaRow}>
          {isPrivate ? <Feather name="lock" size={11} color={colors.textMuted} /> : null}
          <Text numberOfLines={1} style={[type.caption, styles.metaText, { color: colors.textMuted }]}>
            {isPrivate ? 'Private · ' : ''}
            {subtitle} · {time}
            {pending ? ' · Pending' : ''}
          </Text>
        </View>
      </View>
      <Amount
        valueMinor={tx.amountMinor}
        txType={tx.type}
        direction={tx.type === 'lending' ? tx.direction : undefined}
      />
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
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  metaText: { flexShrink: 1 },
});
