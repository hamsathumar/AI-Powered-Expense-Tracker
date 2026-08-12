/**
 * Approval-queue card (design-system-v2.md §5.6). A `surface` card with a 36pt
 * round category icon, name + amount on one baseline, `Category · Account ·
 * time`, the ALWAYS-visible transcript (when present) so the parse can be
 * verified, confidence-flag pills, then the action row: a filled green
 * Approve pill + 44pt outlined Edit and Reject icon buttons, left-inset to
 * align with the text column.
 */
import { Feather } from '@expo/vector-icons';
import { format } from 'date-fns';
import type { ComponentProps } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Amount } from '@/components/Amount';
import type { TransactionListItem } from '@/db/queries/transactions';
import type { LendingDirection } from '@/domain/types';
import { useTheme } from '@/theme/ThemeContext';
import { fontFamily, layout, minTouchTarget, radius, space, type } from '@/theme/tokens';

const LENDING_LABELS: Record<LendingDirection, (name: string) => string> = {
  lend: (n) => `Lent to ${n}`,
  lend_repayment_received: (n) => `${n} repaid you`,
  borrow: (n) => `Borrowed from ${n}`,
  borrow_repayment_made: (n) => `Repaid ${n}`,
};

const TYPE_ICONS: Record<'transfer' | 'lending', ComponentProps<typeof Feather>['name']> = {
  transfer: 'repeat',
  lending: 'users',
};

interface Props {
  item: TransactionListItem;
  onApprove: () => void;
  onReject: () => void;
  onEdit: () => void;
}

export function QueueItemCard({ item, onApprove, onReject, onEdit }: Props) {
  const { colors, isDark } = useTheme();
  const { tx } = item;

  const icon =
    tx.type === 'expense' || tx.type === 'income'
      ? ((item.categoryIcon as ComponentProps<typeof Feather>['name']) ?? 'circle')
      : TYPE_ICONS[tx.type];
  const iconColor = item.categoryColor ?? colors[tx.type];

  let meta: string;
  switch (tx.type) {
    case 'expense':
    case 'income':
      meta = `${item.categoryName ?? '—'} · ${item.accountName ?? '—'}`;
      break;
    case 'transfer':
      meta = `${item.accountName ?? '—'} → ${item.toAccountName ?? '—'}`;
      break;
    case 'lending':
      meta = LENDING_LABELS[tx.direction](item.personName ?? '—');
      break;
  }
  const time = format(new Date(tx.occurredAt), 'HH:mm');

  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <View style={styles.body}>
        <View style={[styles.icon, { backgroundColor: `${iconColor}22` }]}>
          <Feather name={icon} size={18} color={iconColor} />
        </View>
        <View style={styles.middle}>
          <View style={styles.titleRow}>
            <Text numberOfLines={1} style={[styles.name, { color: colors.text }]}>
              {tx.name}
            </Text>
            <Amount valueMinor={tx.amountMinor} txType={tx.type} />
          </View>
          <Text numberOfLines={1} style={[type.caption, { color: colors.textMuted }]}>
            {meta} · {time}
          </Text>
          {tx.transcript ? (
            <Text style={[styles.transcript, { color: colors.textSubtle }]}>“{tx.transcript}”</Text>
          ) : null}
          {tx.confidenceFlags.length > 0 ? (
            <View style={styles.flagRow}>
              {tx.confidenceFlags.map((flag) => (
                <View key={flag} style={[styles.flagPill, { borderColor: colors.warning }]}>
                  <Text style={[type.caption, { color: isDark ? colors.warning : colors.lending }]}>
                    {flag.replaceAll('_', ' ')}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}
        </View>
      </View>

      <View style={styles.actions}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Approve"
          onPress={onApprove}
          style={[styles.approve, { backgroundColor: colors.positiveFill }]}>
          <Feather name="check" size={15} color={colors.onFilled} />
          <Text style={[styles.approveLabel, { color: colors.onFilled }]}>Approve</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Edit"
          onPress={onEdit}
          style={[styles.iconButton, { borderColor: colors.border }]}>
          <Feather name="edit-2" size={15} color={colors.textMuted} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Reject"
          onPress={onReject}
          style={[styles.iconButton, { borderColor: colors.border }]}>
          <Feather name="x" size={16} color={colors.expense} />
        </Pressable>
      </View>
    </View>
  );
}

const ACTION_INSET = 36 + space.md; // icon width + gap → align actions with text

const styles = StyleSheet.create({
  card: {
    borderRadius: layout.cardRadius,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  body: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.md,
    paddingTop: space.md + 2,
    paddingHorizontal: space.md + 2,
    paddingBottom: space.sm + 2,
  },
  icon: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  middle: { flex: 1, gap: space.xs },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: space.sm,
  },
  name: { flex: 1, fontFamily: fontFamily.heading, fontSize: 16 },
  transcript: { fontFamily: fontFamily.body, fontSize: 13, lineHeight: 19, fontStyle: 'italic' },
  flagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs, paddingTop: 2 },
  flagPill: {
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: space.sm,
    paddingVertical: 1,
  },
  actions: {
    flexDirection: 'row',
    gap: space.sm,
    paddingLeft: ACTION_INSET + space.md + 2,
    paddingRight: space.md + 2,
    paddingBottom: space.md + 2,
  },
  approve: {
    flex: 1,
    minHeight: minTouchTarget,
    borderRadius: radius.pill,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xs + 2,
  },
  approveLabel: { fontFamily: fontFamily.medium, fontSize: 13 },
  iconButton: {
    width: minTouchTarget,
    minHeight: minTouchTarget,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
