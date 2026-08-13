/**
 * Recurring templates (spec §5, redesign screenshot 4a/4c). Two tabs —
 * Expenses and Income — over one chronological list grouped by due date, with
 * a rollup card on top (group bar on Expenses, left-over forecast on Income).
 * Paused templates collect in a de-emphasised section at the bottom. Due
 * occurrences are still generated on app foreground and land in the Queue as
 * pending; the detail screen adds a manual mark-as-paid fast path.
 */
import { Feather } from '@expo/vector-icons';
import { differenceInCalendarDays, format, parseISO } from 'date-fns';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PressableScale } from '@/components/PressableScale';
import { RecurringListRow } from '@/components/recurring/RecurringListRow';
import { RecurringSummaryCard } from '@/components/recurring/RecurringSummaryCard';
import { type GroupSegment } from '@/components/recurring/RecurringGroupBar';
import {
  getApprovedAggregates,
  getLastApprovedDates,
  getLastPaymentAmounts,
  listTemplateItems,
  type ApprovedAggregate,
  type RecurringListItem,
} from '@/db/queries/recurring';
import { formatAmount } from '@/domain/money';
import { isCurrentPeriodPaid, monthlyAmountMinor } from '@/domain/recurring';
import { dueEyebrow } from '@/domain/recurringDisplay';
import type { RecurringGroup } from '@/domain/types';
import { useCurrency } from '@/theme/CurrencyContext';
import { useTheme } from '@/theme/ThemeContext';
import { layout, radius, screenPaddingH, shadow, space, type } from '@/theme/tokens';

type Tab = 'expenses' | 'income';

const GROUP_ORDER: RecurringGroup[] = ['subscription', 'bill', 'rent', 'loan', 'other'];

/** The amount a row displays: newest actual payment if it differs, else stored. */
function shownAmount(item: RecurringListItem, lastPayments: Record<string, number>): number {
  const last = lastPayments[item.template.id];
  return last !== undefined && last !== item.template.amountMinor ? last : item.template.amountMinor;
}

interface DueSection {
  key: string;
  title: string;
  totalMinor: number;
  items: RecurringListItem[];
}

export default function RecurringScreen() {
  const { colors } = useTheme();
  const { symbol } = useCurrency();
  const router = useRouter();

  const [items, setItems] = useState<RecurringListItem[]>([]);
  const [lastPayments, setLastPayments] = useState<Record<string, number>>({});
  const [approved, setApproved] = useState<Record<string, ApprovedAggregate>>({});
  const [lastApprovedDates, setLastApprovedDates] = useState<Record<string, string>>({});
  const [tab, setTab] = useState<Tab>('expenses');

  const reload = useCallback(() => {
    Promise.all([
      listTemplateItems(),
      getLastPaymentAmounts(),
      getApprovedAggregates(),
      getLastApprovedDates(),
    ])
      .then(([templateItems, last, agg, approvedDates]) => {
        setItems(templateItems);
        setLastPayments(last);
        setApproved(agg);
        setLastApprovedDates(approvedDates);
      })
      .catch((e) => Alert.alert('Database error', String(e)));
  }, []);

  useFocusEffect(reload);

  const today = format(new Date(), 'yyyy-MM-dd');

  // Left-over forecast spans ALL active templates, not just the current tab.
  const { monthlyIncomeAll, monthlyExpenseAll } = useMemo(() => {
    let inc = 0;
    let exp = 0;
    for (const { template: t } of items) {
      if (t.status !== 'active') continue;
      if (t.type === 'income') inc += monthlyAmountMinor(t);
      else if (t.type === 'expense') exp += monthlyAmountMinor(t);
    }
    return { monthlyIncomeAll: inc, monthlyExpenseAll: exp };
  }, [items]);

  // Templates shown under the current tab: Income tab = income; Expenses tab =
  // everything else (expense plus any transfer/lending templates, which stay
  // visible but never enter the spending rollup — golden rule).
  const tabItems = useMemo(
    () =>
      items.filter((i) =>
        tab === 'income' ? i.template.type === 'income' : i.template.type !== 'income',
      ),
    [items, tab],
  );

  const activeItems = useMemo(
    () => tabItems.filter((i) => i.template.status === 'active'),
    [tabItems],
  );
  const pausedItems = useMemo(
    () => tabItems.filter((i) => i.template.status === 'paused'),
    [tabItems],
  );

  // Summary money is expense/income only (movements excluded).
  const moneyType = tab === 'income' ? 'income' : 'expense';
  const monthlyMinor = tab === 'income' ? monthlyIncomeAll : monthlyExpenseAll;

  const next7Minor = useMemo(() => {
    let sum = 0;
    for (const item of activeItems) {
      const t = item.template;
      if (t.type !== moneyType) continue;
      const days = differenceInCalendarDays(parseISO(t.nextDueDate), parseISO(today));
      if (days >= 0 && days <= 7) sum += shownAmount(item, lastPayments);
    }
    return sum;
  }, [activeItems, moneyType, today, lastPayments]);

  const segments: GroupSegment[] = useMemo(() => {
    const totals = new Map<RecurringGroup, number>();
    for (const { template: t } of activeItems) {
      if (t.type !== 'expense') continue;
      totals.set(t.recurringGroup, (totals.get(t.recurringGroup) ?? 0) + monthlyAmountMinor(t));
    }
    return GROUP_ORDER.map((g) => ({ group: g, monthlyMinor: totals.get(g) ?? 0 }));
  }, [activeItems]);

  const sections: DueSection[] = useMemo(() => {
    const byDate = new Map<string, RecurringListItem[]>();
    for (const item of activeItems) {
      const key = item.template.nextDueDate;
      const list = byDate.get(key) ?? [];
      list.push(item);
      byDate.set(key, list);
    }
    return [...byDate.keys()]
      .sort((a, b) => a.localeCompare(b))
      .map((date) => {
        const secItems = byDate.get(date)!;
        const { lead, dateLabel, showDate } = dueEyebrow(date, today);
        const title = showDate ? `${lead} · ${dateLabel.toUpperCase()}` : lead.toUpperCase();
        const totalMinor = secItems.reduce((s, it) => s + shownAmount(it, lastPayments), 0);
        return { key: date, title, totalMinor, items: secItems };
      });
  }, [activeItems, today, lastPayments]);

  const openDetail = (id: string) =>
    router.push({ pathname: '/recurring/[id]', params: { id } });

  const empty = activeItems.length === 0 && pausedItems.length === 0;

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.bg }]} edges={['top']}>
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          hitSlop={12}
          onPress={() => router.back()}>
          <Feather name="chevron-left" size={26} color={colors.text} />
        </Pressable>
        <Text style={[type.h1, { color: colors.text }]}>Recurring</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}>
        <RecurringSummaryCard
          variant={tab === 'income' ? 'income' : 'expenses'}
          count={activeItems.length}
          monthlyMinor={monthlyMinor}
          asideMinor={tab === 'income' ? monthlyIncomeAll - monthlyExpenseAll : next7Minor}
          segments={tab === 'income' ? undefined : segments}
        />

        <View style={[styles.toggle, { backgroundColor: colors.surfaceAlt }]}>
          {(['expenses', 'income'] as Tab[]).map((t) => {
            const selected = t === tab;
            return (
              <Pressable
                key={t}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                onPress={() => setTab(t)}
                style={[
                  styles.toggleSeg,
                  selected && { backgroundColor: colors.surface, ...shadow },
                ]}>
                <Text
                  style={[
                    type.label,
                    { color: selected ? colors.text : colors.textMuted },
                  ]}>
                  {t === 'expenses' ? 'Expenses' : 'Income'}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {empty ? (
          <View style={styles.empty}>
            <Feather name="repeat" size={28} color={colors.textSubtle} />
            <Text style={[type.body, styles.emptyText, { color: colors.textMuted }]}>
              {tab === 'income'
                ? 'No recurring income yet — add your salary or rent-in and it will show here with a monthly forecast.'
                : 'No recurring expenses yet — add rent, subscriptions, or a loan once and let them queue themselves.'}
            </Text>
          </View>
        ) : null}

        {sections.map((section) => (
          <View key={section.key} style={styles.section}>
            <View style={styles.sectionHead}>
              <Text style={[type.sectionLabel, { color: colors.primary }]}>{section.title}</Text>
              <Text style={[type.label, { color: colors.textMuted }]}>
                {formatAmount(section.totalMinor, symbol)}
              </Text>
            </View>
            <View style={styles.rows}>
              {section.items.map((item) => (
                <RecurringListRow
                  key={item.template.id}
                  item={item}
                  lastPaymentMinor={lastPayments[item.template.id]}
                  approved={approved[item.template.id]}
                  paid={isCurrentPeriodPaid(
                    item.template,
                    lastApprovedDates[item.template.id] ?? null,
                  )}
                  onPress={() => openDetail(item.template.id)}
                />
              ))}
            </View>
          </View>
        ))}

        {pausedItems.length > 0 ? (
          <View style={styles.section}>
            <View style={styles.sectionHead}>
              <Text style={[type.sectionLabel, { color: colors.textSubtle }]}>
                PAUSED · {pausedItems.length}
              </Text>
            </View>
            <View style={styles.rows}>
              {pausedItems.map((item) => (
                <RecurringListRow
                  key={item.template.id}
                  item={item}
                  onPress={() => openDetail(item.template.id)}
                  dimmed
                  subtitleOverride={
                    item.template.pausedUntil
                      ? `Paused until ${format(parseISO(item.template.pausedUntil), 'd MMM')}`
                      : 'Paused'
                  }
                />
              ))}
            </View>
          </View>
        ) : null}
      </ScrollView>

      <PressableScale
        accessibilityRole="button"
        accessibilityLabel="Add recurring"
        onPress={() => router.push('/recurring/new')}
        scaleTo={0.9}
        style={[styles.fab, { backgroundColor: colors.primary }, shadow]}>
        <Feather name="plus" size={26} color={colors.onPrimary} />
      </PressableScale>
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
  headerSpacer: { width: 26 },
  scroll: {
    paddingHorizontal: screenPaddingH,
    paddingBottom: space.xxl * 3,
    gap: space.lg,
  },
  toggle: {
    flexDirection: 'row',
    borderRadius: radius.pill,
    padding: space.xs,
  },
  toggleSeg: {
    flex: 1,
    minHeight: 40,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  section: { gap: space.sm },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.xs,
  },
  rows: { gap: space.sm },
  empty: {
    alignItems: 'center',
    gap: space.md,
    paddingTop: space.xxl,
  },
  emptyText: { textAlign: 'center' },
  fab: {
    position: 'absolute',
    right: screenPaddingH + space.xs,
    bottom: space.xxl,
    width: layout.fabSm,
    height: layout.fabSm,
    borderRadius: layout.fabSm / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
