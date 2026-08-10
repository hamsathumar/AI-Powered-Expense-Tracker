/**
 * One Approval-Queue card (design §5.6): the transaction row plus (when
 * present) the voice transcript and confidence-flag pills, and inline
 * Approve · Edit · Reject actions. Extracted so the queue can live embedded
 * in Home. Callbacks keep it dumb/reusable.
 */
import { Feather } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { TransactionRow } from '@/components/TransactionRow';
import type { TransactionListItem } from '@/db/queries/transactions';
import { useTheme } from '@/theme/ThemeContext';
import { minTouchTarget, radius, space, type } from '@/theme/tokens';

interface Props {
  item: TransactionListItem;
  onApprove: () => void;
  onReject: () => void;
  onEdit: () => void;
}

export function QueueItemCard({ item, onApprove, onReject, onEdit }: Props) {
  const { colors } = useTheme();

  return (
    <View style={[styles.card, { backgroundColor: colors.surface }]}>
      <TransactionRow item={item} />

      {item.tx.transcript ? (
        <Text style={[type.caption, styles.transcript, { color: colors.textMuted }]}>
          “{item.tx.transcript}”
        </Text>
      ) : null}

      {item.tx.confidenceFlags.length > 0 ? (
        <View style={styles.flagRow}>
          {item.tx.confidenceFlags.map((flag) => (
            <View key={flag} style={[styles.flagPill, { backgroundColor: colors.warning }]}>
              <Text style={[type.caption, { color: colors.onPrimary }]}>
                {flag.replaceAll('_', ' ')}
              </Text>
            </View>
          ))}
        </View>
      ) : null}

      <View style={[styles.actions, { borderTopColor: colors.border }]}>
        <Pressable accessibilityRole="button" onPress={onReject} style={styles.action}>
          <Feather name="x" size={16} color={colors.danger} />
          <Text style={[type.label, { color: colors.danger }]}>Reject</Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={onEdit} style={styles.action}>
          <Feather name="edit-2" size={16} color={colors.textMuted} />
          <Text style={[type.label, { color: colors.textMuted }]}>Edit</Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={onApprove} style={styles.action}>
          <Feather name="check" size={16} color={colors.success} />
          <Text style={[type.label, { color: colors.success }]}>Approve</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.md,
    gap: space.sm,
    paddingBottom: space.xs,
  },
  transcript: {
    paddingHorizontal: space.md,
    fontStyle: 'italic',
  },
  flagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.xs,
    paddingHorizontal: space.md,
  },
  flagPill: {
    borderRadius: radius.pill,
    paddingHorizontal: space.sm,
    paddingVertical: 2,
  },
  actions: {
    flexDirection: 'row',
    borderTopWidth: 1,
  },
  action: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xs,
    minHeight: minTouchTarget,
  },
});
