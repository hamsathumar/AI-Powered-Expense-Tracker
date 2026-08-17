/**
 * Home (design-system-v2.md §6) — the daily surface, top to bottom:
 * balance canopy → quick-action row → To review (approval queue) → Spending
 * this month → Coming up → bottom spacer. The Hold-to-speak bar + `+` circle
 * float above the tab bar. All figures are approved-only; pending items live
 * in the queue and never enter headline totals.
 */
import { Feather } from '@expo/vector-icons';
import { format } from 'date-fns';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeOut, LinearTransition } from 'react-native-reanimated';

import { Amount } from '@/components/Amount';
import { BalanceCanopy } from '@/components/BalanceCanopy';
import { PressableScale } from '@/components/PressableScale';
import { QueueItemCard } from '@/components/QueueItemCard';
import { QuickActions } from '@/components/QuickActions';
import { SectionHeader } from '@/components/SectionHeader';
import { TransactionRow } from '@/components/TransactionRow';
import { VoiceBar } from '@/components/VoiceBar';
import { VoiceReviewSection } from '@/components/VoiceReviewSection';
import {
  getMonthlySummary,
  getSpendingByCategory,
  getTotalBalanceMinor,
  monthKey,
  type CategorySpending,
  type MonthlySummary,
} from '@/db/queries/reports';
import { listPeopleWithNetBalances, type PersonWithNet } from '@/db/queries/people';
import { listTemplates } from '@/db/queries/recurring';
import {
  approveAllPending,
  listApprovedItemsForDay,
  listPendingTransactionItems,
  setTransactionStatus,
  type TransactionListItem,
} from '@/db/queries/transactions';
import type { RecurringTemplate } from '@/domain/types';
import { usePendingCount } from '@/state/PendingCount';
import { useCurrency } from '@/theme/CurrencyContext';
import { useTheme } from '@/theme/ThemeContext';
import {
  bottomClearance,
  categoryPalette,
  fontFamily,
  layout,
  radius,
  space,
  tabularNums,
  type,
} from '@/theme/tokens';
import { formatAmount } from '@/domain/money';

const HOME_SPENDING_ROWS = 4;
const smallAmount = { fontSize: 15, lineHeight: 20 };

export default function HomeScreen() {
  const { colors, isDark } = useTheme();
  const router = useRouter();
  const { symbol } = useCurrency();
  const { refresh: refreshBadge } = usePendingCount();

  const [pending, setPending] = useState<TransactionListItem[]>([]);
  const [todayItems, setTodayItems] = useState<TransactionListItem[]>([]);
  const [totalMinor, setTotalMinor] = useState(0);
  const [summary, setSummary] = useState<MonthlySummary>({ incomeMinor: 0, expenseMinor: 0 });
  const [spending, setSpending] = useState<CategorySpending[]>([]);
  const [templates, setTemplates] = useState<RecurringTemplate[]>([]);
  const [owed, setOwed] = useState<PersonWithNet[]>([]);
  // Voice pending-operation count, reported up by VoiceReviewSection so the
  // single "To review" header/empty state can account for both queues.
  const [voicePendingCount, setVoicePendingCount] = useState(0);

  const reload = useCallback(() => {
    const month = monthKey(new Date());
    const day = format(new Date(), 'yyyy-MM-dd');
    Promise.all([
      listPendingTransactionItems(),
      getTotalBalanceMinor(),
      getMonthlySummary(month),
      getSpendingByCategory(month),
      listTemplates(),
      listPeopleWithNetBalances(),
      listApprovedItemsForDay(day),
    ])
      .then(([pendingItems, total, monthSummary, byCategory, allTemplates, people, todaysItems]) => {
        setPending(pendingItems);
        setTotalMinor(total);
        setSummary(monthSummary);
        setSpending(byCategory);
        setTemplates(allTemplates);
        setOwed(people.filter((p) => p.netMinor > 0));
        setTodayItems(todaysItems);
      })
      .catch((e) => Alert.alert('Database error', String(e)));
    refreshBadge();
  }, [refreshBadge]);

  useFocusEffect(reload);

  const act = (id: string, status: 'approved' | 'rejected') => {
    setTransactionStatus(id, status).then(reload);
  };

  const bulkApprove = () => {
    Alert.alert('Approve all?', `${pending.length} pending transactions will start counting.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Approve all', onPress: () => approveAllPending().then(reload) },
    ]);
  };

  // Top categories + a taupe "Everything else" overflow row (v2 §2.9).
  const spendRows = useMemo(() => {
    const rows = spending.slice(0, HOME_SPENDING_ROWS).map((c, i) => ({
      key: c.categoryId,
      name: c.name,
      icon: (c.icon ?? 'tag') as ComponentIcon,
      color: c.color ?? categoryPalette[i % categoryPalette.length]!,
      totalMinor: c.totalMinor,
    }));
    const restMinor = spending
      .slice(HOME_SPENDING_ROWS)
      .reduce((sum, c) => sum + c.totalMinor, 0);
    if (restMinor > 0) {
      rows.push({
        key: '__else__',
        name: 'Everything else',
        icon: 'more-horizontal',
        color: categoryPalette[categoryPalette.length - 1]!, // warm taupe
        totalMinor: restMinor,
      });
    }
    return rows;
  }, [spending]);

  const upcoming = useMemo(
    () =>
      templates
        .filter((t) => t.active)
        .sort((a, b) => a.nextDueDate.localeCompare(b.nextDueDate))
        .slice(0, 2),
    [templates],
  );
  const owedTop = useMemo(() => [...owed].sort((a, b) => b.netMinor - a.netMinor).slice(0, 2), [owed]);
  const hasComingUp = upcoming.length > 0 || owedTop.length > 0;

  const badgeText = isDark ? colors.bg : colors.onPrimary;
  const reviewTotal = pending.length + voicePendingCount;

  return (
    <View style={[styles.root, { backgroundColor: isDark ? colors.surface : colors.primary }]}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <BalanceCanopy
          monthLabel={format(new Date(), 'MMMM')}
          totalBalanceMinor={totalMinor}
          monthIncomeMinor={summary.incomeMinor}
          monthExpenseMinor={summary.expenseMinor}
          pendingCount={pending.length}
        />

        <View style={[styles.sheet, { backgroundColor: colors.bg }]}>
          <QuickActions />

          {/* To review — ONE approval queue: AI voice pending operations
              (VoiceReviewSection, headerless) + manual pending transactions,
              under a single header with a single empty state. */}
          <View style={styles.section}>
            <SectionHeader
              title="To review"
              right={
                <View style={styles.headerRight}>
                  {reviewTotal > 0 ? (
                    <View style={[styles.badge, { backgroundColor: colors.warning }]}>
                      <Text style={[styles.badgeLabel, { color: badgeText }]}>{reviewTotal}</Text>
                    </View>
                  ) : null}
                  {pending.length > 1 ? (
                    <Pressable accessibilityRole="button" onPress={bulkApprove} hitSlop={space.sm}>
                      <Text style={[type.label, { color: colors.primary }]}>Approve all</Text>
                    </Pressable>
                  ) : null}
                </View>
              }
            />
            <View style={styles.reviewStack}>
              {/* Voice pending ops (renders nothing when empty) */}
              <VoiceReviewSection onCountChange={setVoicePendingCount} />

              {pending.length > 0 ? (
                <View style={styles.queueList}>
                  {pending.map((item) => (
                    <Animated.View
                      key={item.tx.id}
                      entering={FadeIn.duration(200)}
                      exiting={FadeOut.duration(200)}
                      layout={LinearTransition.duration(220)}>
                      <QueueItemCard
                        item={item}
                        onApprove={() => act(item.tx.id, 'approved')}
                        onReject={() => act(item.tx.id, 'rejected')}
                        onEdit={() =>
                          router.push({ pathname: '/transaction/[id]', params: { id: item.tx.id } })
                        }
                      />
                    </Animated.View>
                  ))}
                </View>
              ) : null}

              {pending.length === 0 && voicePendingCount === 0 ? (
                <View style={[styles.emptyCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                  <Feather name="check-circle" size={22} color={colors.textSubtle} />
                  <Text style={[type.body, styles.emptyText, { color: colors.textMuted }]}>
                    Queue is clear — tap mic to speak, or tap + to add something.
                  </Text>
                </View>
              ) : null}
            </View>
          </View>

          {/* Today — approved transactions logged today (any type) */}
          <View style={styles.section}>
            <SectionHeader title="Today" />
            {todayItems.length === 0 ? (
              <View style={[styles.emptyCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <Feather name="sunrise" size={22} color={colors.textSubtle} />
                <Text style={[type.body, styles.emptyText, { color: colors.textMuted }]}>
                  Nothing logged today yet — approved transactions land here as they happen.
                </Text>
              </View>
            ) : (
              <View style={styles.todayList}>
                {todayItems.map((item) => (
                  <TransactionRow key={item.tx.id} item={item} />
                ))}
              </View>
            )}
          </View>

          {/* Spending this month */}
          {spendRows.length > 0 ? (
            <View style={styles.section}>
              <SectionHeader
                title="Spending this month"
                right={
                  <Amount
                    valueMinor={summary.expenseMinor}
                    textStyle={{ ...type.amount, ...smallAmount }}
                    colorOverride={colors.textMuted}
                  />
                }
              />
              <View style={styles.spendList}>
                {spendRows.map((row) => {
                  const pct =
                    summary.expenseMinor > 0
                      ? Math.round((row.totalMinor / summary.expenseMinor) * 100)
                      : 0;
                  return (
                    <View key={row.key} style={styles.spendRow}>
                      <View style={styles.spendTop}>
                        <Feather name={row.icon} size={14} color={row.color} />
                        <Text style={[type.body, styles.spendName, { color: colors.text }]} numberOfLines={1}>
                          {row.name}
                        </Text>
                        <Text style={[type.caption, styles.pct, { color: colors.textMuted }]}>{pct}%</Text>
                        <Amount
                          valueMinor={row.totalMinor}
                          textStyle={{ ...type.amount, ...smallAmount }}
                          colorOverride={colors.text}
                        />
                      </View>
                      <View style={[styles.track, { backgroundColor: colors.surfaceAlt }]}>
                        <View style={[styles.fill, { backgroundColor: row.color, width: `${pct}%` }]} />
                      </View>
                    </View>
                  );
                })}
              </View>
            </View>
          ) : null}

          {/* Coming up — next recurring + who owes you */}
          {hasComingUp ? (
            <View style={styles.section}>
              <SectionHeader title="Coming up" />
              <View style={styles.comingList}>
                {upcoming.map((t) => (
                  <PressableScale
                    key={t.id}
                    accessibilityRole="button"
                    accessibilityLabel={`${t.name}, recurring`}
                    onPress={() => router.push({ pathname: '/recurring/[id]', params: { id: t.id } })}
                    scaleTo={0.98}
                    style={[styles.comingRow, { backgroundColor: colors.surface }]}>
                    <View style={[styles.comingTile, { backgroundColor: colors.primarySoft }]}>
                      <Feather name="repeat" size={18} color={colors.primary} />
                    </View>
                    <View style={styles.comingText}>
                      <Text style={[type.body, { color: colors.text }]} numberOfLines={1}>
                        {t.name}
                      </Text>
                      <Text style={[type.caption, { color: colors.textMuted }]}>
                        Recurring · due {format(new Date(t.nextDueDate), 'd MMM')}
                      </Text>
                    </View>
                    <Amount
                      valueMinor={t.amountMinor}
                      textStyle={{ ...type.amount, ...smallAmount }}
                      colorOverride={colors.text}
                    />
                  </PressableScale>
                ))}
                {owedTop.map(({ person, netMinor }) => (
                  <PressableScale
                    key={person.id}
                    accessibilityRole="button"
                    accessibilityLabel={`${person.name} owes you`}
                    onPress={() => router.push({ pathname: '/person/[id]', params: { id: person.id } })}
                    scaleTo={0.98}
                    style={[styles.comingRow, { backgroundColor: colors.surface }]}>
                    <View style={[styles.avatar, { backgroundColor: colors.primarySoft }]}>
                      <Text style={[styles.avatarText, { color: colors.primary }]}>
                        {person.name.slice(0, 1).toUpperCase()}
                      </Text>
                    </View>
                    <View style={styles.comingText}>
                      <Text style={[type.body, { color: colors.text }]} numberOfLines={1}>
                        {person.name}
                      </Text>
                      <Text style={[type.caption, { color: colors.textMuted }]}>Tap to settle up</Text>
                    </View>
                    <Text style={[type.amount, smallAmount, { color: colors.lending }]}>
                      Owes you {formatAmount(netMinor, symbol)}
                    </Text>
                  </PressableScale>
                ))}
              </View>
            </View>
          ) : null}

          <View style={{ height: bottomClearance.home }} />
        </View>
      </ScrollView>

      <View style={styles.voiceBar}>
        <VoiceBar
          onSpeak={() => router.push('/voice')}
          onAdd={() => router.push('/transaction/new')}
        />
      </View>
    </View>
  );
}

type ComponentIcon = React.ComponentProps<typeof Feather>['name'];

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { paddingBottom: 0 },
  sheet: {
    marginTop: -layout.sheetOverlap,
    borderTopLeftRadius: layout.sheetRadius,
    borderTopRightRadius: layout.sheetRadius,
    paddingTop: space.xl,
    paddingHorizontal: layout.screenPaddingH,
    gap: space.xl,
  },
  section: { gap: space.md },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  badge: {
    borderRadius: radius.pill,
    paddingHorizontal: space.sm,
    paddingVertical: 1,
    minWidth: 20,
    alignItems: 'center',
  },
  badgeLabel: { fontFamily: fontFamily.heading, fontSize: 12 },
  reviewStack: { gap: space.md - 2 },
  queueList: { gap: space.md - 2 },
  emptyCard: {
    borderRadius: layout.cardRadius,
    borderWidth: StyleSheet.hairlineWidth,
    padding: space.xl,
    alignItems: 'center',
    gap: space.md,
  },
  emptyText: { textAlign: 'center' },
  todayList: { gap: space.sm },
  spendList: { gap: space.md + 2 },
  spendRow: { gap: space.sm - 2 },
  spendTop: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  spendName: { flex: 1 },
  pct: { ...tabularNums },
  track: { height: 8, borderRadius: radius.pill, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: radius.pill },
  comingList: { gap: space.sm + 2 },
  comingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    borderRadius: layout.cardRadius,
    padding: space.md + 2,
  },
  comingTile: {
    width: layout.iconTile.size,
    height: layout.iconTile.size,
    borderRadius: layout.iconTile.radius,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatar: {
    width: layout.iconTile.size,
    height: layout.iconTile.size,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontFamily: fontFamily.heading, fontSize: 15 },
  comingText: { flex: 1, gap: 2 },
  voiceBar: {
    position: 'absolute',
    left: layout.screenPaddingH,
    right: layout.screenPaddingH,
    bottom: space.md,
  },
});
