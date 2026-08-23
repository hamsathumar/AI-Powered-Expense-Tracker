/**
 * Long-press peek — a quick look at a transaction without leaving the list.
 *
 * Answers "what was that, exactly?" (amount, category, account, person, when)
 * in one gesture, for the common case where you don't actually want to edit
 * anything. The full detail screen is one tap away from here for when you do.
 *
 * Scales up rather than sliding: it belongs to the row you pressed, not to the
 * bottom of the screen.
 */
import { Feather } from '@expo/vector-icons';
import { format } from 'date-fns';
import type { ComponentProps } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, ZoomIn } from 'react-native-reanimated';

import { Amount } from '@/components/Amount';
import type { TransactionListItem } from '@/db/queries/transactions';
import type { LendingDirection } from '@/domain/types';
import { useReduceMotion } from '@/theme/FeedbackContext';
import { useTheme } from '@/theme/ThemeContext';
import { layout, minTouchTarget, radius, screenPaddingH, space, type } from '@/theme/tokens';

const LENDING_LABELS: Record<LendingDirection, (name: string) => string> = {
  lend: (n) => `Lent to ${n}`,
  lend_repayment_received: (n) => `${n} repaid you`,
  borrow: (n) => `Borrowed from ${n}`,
  borrow_repayment_made: (n) => `Repaid ${n}`,
};

interface Props {
  item: TransactionListItem | null;
  onClose: () => void;
  onOpenDetail: (id: string) => void;
}

export function TransactionPeek({ item, onClose, onOpenDetail }: Props) {
  const { colors, isDark } = useTheme();
  const reduceMotion = useReduceMotion();

  if (!item) return null;
  const { tx } = item;

  const rows: { icon: ComponentProps<typeof Feather>['name']; label: string; value: string }[] = [
    { icon: 'calendar', label: 'When', value: format(new Date(tx.occurredAt), 'EEE d MMM yyyy · HH:mm') },
    { icon: 'credit-card', label: 'Account', value: item.accountName ?? '—' },
  ];
  if (tx.type === 'expense' || tx.type === 'income') {
    rows.splice(1, 0, { icon: 'tag', label: 'Category', value: item.categoryName ?? '—' });
  }
  if (tx.type === 'transfer') {
    rows.push({ icon: 'repeat', label: 'To', value: item.toAccountName ?? '—' });
  }
  if (tx.type === 'lending') {
    rows.push({
      icon: 'users',
      label: 'Person',
      value: LENDING_LABELS[tx.direction](item.personName ?? '—'),
    });
  }
  if (tx.status === 'pending') {
    rows.push({ icon: 'clock', label: 'Status', value: 'Pending approval' });
  }

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.scrim} onPress={onClose} accessibilityLabel="Close preview">
        <Animated.View
          entering={reduceMotion ? undefined : ZoomIn.duration(160)}
          style={[styles.card, { backgroundColor: colors.surface }]}>
          <Pressable onPress={() => {}} style={styles.cardInner}>
            <Animated.View
              entering={reduceMotion ? undefined : FadeIn.delay(60)}
              style={styles.headline}>
              <Text numberOfLines={2} style={[type.h2, { color: colors.text }]}>
                {tx.name}
              </Text>
              <Amount valueMinor={tx.amountMinor} txType={tx.type} textStyle={type.display} />
            </Animated.View>

            <View style={[styles.divider, { backgroundColor: colors.border }]} />

            <View style={styles.rows}>
              {rows.map((row) => (
                <View key={row.label} style={styles.row}>
                  <Feather name={row.icon} size={15} color={colors.textSubtle} />
                  <Text style={[type.caption, styles.rowLabel, { color: colors.textMuted }]}>
                    {row.label}
                  </Text>
                  <Text numberOfLines={1} style={[type.label, styles.rowValue, { color: colors.text }]}>
                    {row.value}
                  </Text>
                </View>
              ))}
            </View>

            <Pressable
              accessibilityRole="button"
              onPress={() => onOpenDetail(tx.id)}
              style={({ pressed }) => [
                styles.openButton,
                { backgroundColor: isDark ? colors.surfaceAlt : colors.primarySoft },
                pressed && styles.pressed,
              ]}>
              <Text style={[type.label, { color: colors.primary }]}>Open details</Text>
              <Feather name="chevron-right" size={16} color={colors.primary} />
            </Pressable>
          </Pressable>
        </Animated.View>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  // Conventional modal scrim (chrome, not a themeable design colour).
  scrim: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: screenPaddingH,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  card: {
    width: '100%',
    maxWidth: 420,
    borderRadius: layout.heroCardRadius,
  },
  cardInner: { padding: space.lg, gap: space.md },
  headline: { gap: space.xs },
  divider: { height: StyleSheet.hairlineWidth },
  rows: { gap: space.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  rowLabel: { width: 72 },
  rowValue: { flex: 1, textAlign: 'right' },
  pressed: { opacity: 0.7 },
  openButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xs,
    minHeight: minTouchTarget,
    borderRadius: radius.pill,
  },
});
