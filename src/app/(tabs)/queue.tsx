/**
 * The Approval Queue (spec §7, design §5.6): all pending transactions
 * grouped by day. Per item: Approve · Edit · Reject; plus bulk approve.
 * Voice transcripts and confidence flags render here when the voice layer
 * lands (Stage 9) — the fields are already displayed if present.
 */
import { Feather } from '@expo/vector-icons';
import { format, isToday, isYesterday } from 'date-fns';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Alert, Pressable, SectionList, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { TransactionRow } from '@/components/TransactionRow';
import {
  approveAllPending,
  listPendingTransactionItems,
  setTransactionStatus,
  type TransactionListItem,
} from '@/db/queries/transactions';
import { usePendingCount } from '@/state/PendingCount';
import { useTheme } from '@/theme/ThemeContext';
import { minTouchTarget, radius, screenPaddingH, space, type } from '@/theme/tokens';

function dayTitle(iso: string): string {
  const date = new Date(iso);
  if (isToday(date)) return 'Today';
  if (isYesterday(date)) return 'Yesterday';
  return format(date, 'EEE d MMM yyyy');
}

export default function QueueScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const { refresh } = usePendingCount();
  const [items, setItems] = useState<TransactionListItem[]>([]);

  const reload = useCallback(() => {
    listPendingTransactionItems()
      .then(setItems)
      .catch((e) => Alert.alert('Database error', String(e)));
    refresh();
  }, [refresh]);

  useFocusEffect(reload);

  const sections = useMemo(() => {
    const byDay = new Map<string, TransactionListItem[]>();
    for (const item of items) {
      const key = format(new Date(item.tx.occurredAt), 'yyyy-MM-dd');
      byDay.set(key, [...(byDay.get(key) ?? []), item]);
    }
    return [...byDay.entries()].map(([key, data]) => ({
      key,
      title: dayTitle(data[0]!.tx.occurredAt),
      data,
    }));
  }, [items]);

  const act = (id: string, status: 'approved' | 'rejected') => {
    setTransactionStatus(id, status).then(reload);
  };

  const bulkApprove = () => {
    Alert.alert('Approve all?', `${items.length} pending transactions will start counting.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Approve all', onPress: () => approveAllPending().then(reload) },
    ]);
  };

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.bg }]}>
      <View style={styles.header}>
        <Text style={[type.h1, { color: colors.text }]}>Queue</Text>
        {items.length > 1 ? (
          <Pressable
            accessibilityRole="button"
            onPress={bulkApprove}
            style={[styles.bulkButton, { backgroundColor: colors.primarySoft }]}>
            <Text style={[type.label, { color: colors.primary }]}>
              Approve all ({items.length})
            </Text>
          </Pressable>
        ) : null}
      </View>

      <SectionList
        sections={sections}
        keyExtractor={(item) => item.tx.id}
        contentContainerStyle={styles.list}
        stickySectionHeadersEnabled={false}
        renderSectionHeader={({ section }) => (
          <Text style={[type.h2, styles.sectionTitle, { color: colors.text }]}>
            {section.title}
          </Text>
        )}
        renderItem={({ item }) => (
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
              <Pressable
                accessibilityRole="button"
                onPress={() => act(item.tx.id, 'rejected')}
                style={styles.action}>
                <Feather name="x" size={16} color={colors.danger} />
                <Text style={[type.label, { color: colors.danger }]}>Reject</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={() =>
                  router.push({ pathname: '/transaction/[id]', params: { id: item.tx.id } })
                }
                style={styles.action}>
                <Feather name="edit-2" size={16} color={colors.textMuted} />
                <Text style={[type.label, { color: colors.textMuted }]}>Edit</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={() => act(item.tx.id, 'approved')}
                style={styles.action}>
                <Feather name="check" size={16} color={colors.success} />
                <Text style={[type.label, { color: colors.success }]}>Approve</Text>
              </Pressable>
            </View>
          </View>
        )}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Feather name="inbox" size={28} color={colors.textSubtle} />
            <Text style={[type.body, styles.emptyText, { color: colors.textMuted }]}>
              Queue is clear — everything is reviewed.
            </Text>
          </View>
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: screenPaddingH,
    paddingVertical: space.md,
  },
  bulkButton: {
    minHeight: minTouchTarget - space.sm,
    borderRadius: radius.pill,
    paddingHorizontal: space.lg,
    justifyContent: 'center',
  },
  list: {
    paddingHorizontal: screenPaddingH,
    paddingBottom: space.xxl,
    gap: space.sm,
  },
  sectionTitle: {
    marginTop: space.lg,
    marginBottom: space.xs,
  },
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
  empty: {
    alignItems: 'center',
    gap: space.md,
    paddingTop: space.xxl * 2,
  },
  emptyText: { textAlign: 'center' },
});
