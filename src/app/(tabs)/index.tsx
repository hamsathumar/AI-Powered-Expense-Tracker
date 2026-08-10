/**
 * Home — the daily surface: balance hero, quick-actions to the secondary
 * screens, and the Approval Queue embedded directly (grouped by day, with
 * Approve/Edit/Reject + Approve all). The manual-add and voice FABs float
 * bottom-right as a pair. Recent transactions now live on the Accounts tab.
 */
import { Feather } from '@expo/vector-icons';
import { format, isToday, isYesterday } from 'date-fns';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Alert, Pressable, SectionList, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeOut, LinearTransition } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BalanceHero } from '@/components/BalanceHero';
import { Fab } from '@/components/Fab';
import { QueueItemCard } from '@/components/QueueItemCard';
import { QuickActions } from '@/components/QuickActions';
import {
  getMonthlySummary,
  getTotalBalanceMinor,
  monthKey,
  type MonthlySummary,
} from '@/db/queries/reports';
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

export default function HomeScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const { refresh: refreshBadge } = usePendingCount();

  const [pending, setPending] = useState<TransactionListItem[]>([]);
  const [totalMinor, setTotalMinor] = useState(0);
  const [summary, setSummary] = useState<MonthlySummary>({ incomeMinor: 0, expenseMinor: 0 });

  const reload = useCallback(() => {
    Promise.all([
      listPendingTransactionItems(),
      getTotalBalanceMinor(),
      getMonthlySummary(monthKey(new Date())),
    ])
      .then(([pendingItems, total, monthSummary]) => {
        setPending(pendingItems);
        setTotalMinor(total);
        setSummary(monthSummary);
      })
      .catch((e) => Alert.alert('Database error', String(e)));
    refreshBadge();
  }, [refreshBadge]);

  useFocusEffect(reload);

  const sections = useMemo(() => {
    const byDay = new Map<string, TransactionListItem[]>();
    for (const item of pending) {
      const key = format(new Date(item.tx.occurredAt), 'yyyy-MM-dd');
      byDay.set(key, [...(byDay.get(key) ?? []), item]);
    }
    return [...byDay.entries()].map(([key, data]) => ({
      key,
      title: dayTitle(data[0]!.tx.occurredAt),
      data,
    }));
  }, [pending]);

  const act = (id: string, status: 'approved' | 'rejected') => {
    setTransactionStatus(id, status).then(reload);
  };

  const bulkApprove = () => {
    Alert.alert('Approve all?', `${pending.length} pending transactions will start counting.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Approve all', onPress: () => approveAllPending().then(reload) },
    ]);
  };

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.bg }]}>
      <SectionList
        sections={sections}
        keyExtractor={(item) => item.tx.id}
        contentContainerStyle={styles.list}
        stickySectionHeadersEnabled={false}
        ListHeaderComponent={
          <View style={styles.headerBlock}>
            <Text style={[type.h1, { color: colors.text }]}>Kaasu</Text>
            <BalanceHero
              totalBalanceMinor={totalMinor}
              monthIncomeMinor={summary.incomeMinor}
              monthExpenseMinor={summary.expenseMinor}
              pendingCount={pending.length}
            />
            <QuickActions />
            <View style={styles.queueHeading}>
              <Text style={[type.h2, { color: colors.text }]}>
                Queue{pending.length > 0 ? ` (${pending.length})` : ''}
              </Text>
              {pending.length > 1 ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={bulkApprove}
                  style={[styles.bulkButton, { backgroundColor: colors.primarySoft }]}>
                  <Text style={[type.label, { color: colors.primary }]}>Approve all</Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        }
        renderSectionHeader={({ section }) => (
          <Text style={[type.label, styles.sectionTitle, { color: colors.textMuted }]}>
            {section.title}
          </Text>
        )}
        renderItem={({ item }) => (
          // Approving/rejecting removes the row — it fades and the rest slide
          // up to fill the gap (design §7).
          <Animated.View
            entering={FadeIn.duration(200)}
            exiting={FadeOut.duration(200)}
            layout={LinearTransition.duration(220)}>
            <QueueItemCard
              item={item}
              onApprove={() => act(item.tx.id, 'approved')}
              onReject={() => act(item.tx.id, 'rejected')}
              onEdit={() => router.push({ pathname: '/transaction/[id]', params: { id: item.tx.id } })}
            />
          </Animated.View>
        )}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Feather name="inbox" size={28} color={colors.textSubtle} />
            <Text style={[type.body, styles.emptyText, { color: colors.textMuted }]}>
              Queue is clear — tap the mic or + to add something.
            </Text>
          </View>
        }
      />

      {/* Manual add (top) + voice (bottom) as a related pair, one-handed
          reachable above the tab bar (design §5.5 / §4.1). */}
      <View style={styles.fabStack}>
        <Fab
          icon="plus"
          size={52}
          accessibilityLabel="Add transaction"
          onPress={() => router.push('/transaction/new')}
        />
        <Fab
          icon="mic"
          size={60}
          accessibilityLabel="Log by voice"
          onPress={() => router.push('/voice')}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  list: {
    paddingHorizontal: screenPaddingH,
    paddingBottom: space.xxl * 3,
    gap: space.sm,
  },
  headerBlock: {
    gap: space.lg,
    paddingTop: space.md,
    marginBottom: space.sm,
  },
  queueHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  bulkButton: {
    minHeight: minTouchTarget - space.sm,
    borderRadius: radius.pill,
    paddingHorizontal: space.lg,
    justifyContent: 'center',
  },
  sectionTitle: {
    marginTop: space.md,
    marginBottom: space.xs,
  },
  empty: {
    alignItems: 'center',
    gap: space.md,
    paddingTop: space.xl,
  },
  emptyText: { textAlign: 'center' },
  fabStack: {
    position: 'absolute',
    right: screenPaddingH,
    bottom: space.xl,
    alignItems: 'center',
    gap: space.md,
  },
});
