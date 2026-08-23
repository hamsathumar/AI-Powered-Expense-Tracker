/**
 * Reports (spec §8.11, design-system-v2 §6) — v2.
 *
 * One period + one filter drive the whole screen: a balance card with a
 * like-for-like comparison against the previous period, Quick Insights, an
 * income-vs-spending trend chart (bars or lines), and a donut breakdown that
 * can be sliced by category, account, person, or recurring-vs-one-off, for
 * either spending or income. Tapping a slice opens its drill-down.
 *
 * The golden rule is enforced in the SQL layer (db/queries/reports.ts):
 * transfers and lending never appear here, in any grouping. A "person" slice
 * therefore means spending/income TAGGED with that person — their lending
 * balance belongs to the People screen, not to a report.
 *
 * Category colours stay consistent across donut, legend and list (v2 §2.9);
 * slices without a stored colour get a stable one from `paletteColorForKey`,
 * and every colour is paired with a label (colour is never the only key).
 */
import { Feather } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DonutChart } from '@/components/DonutChart';
import { Fab } from '@/components/Fab';
import { ScreenFade } from '@/components/motion/ScreenFade';
import { BalanceSummaryCard } from '@/components/reports/BalanceSummaryCard';
import { BreakdownRow } from '@/components/reports/BreakdownRow';
import { Dropdown } from '@/components/reports/Dropdown';
import { QuickInsights } from '@/components/reports/QuickInsights';
import {
  hasActiveFilters,
  ReportFilterSheet,
  type ReportFilterValue,
} from '@/components/reports/ReportFilterSheet';
import { TrendChart, type TrendMode, type TrendPoint } from '@/components/reports/TrendChart';
import { listAccounts } from '@/db/queries/accounts';
import { listCategories } from '@/db/queries/categories';
import { listPeople } from '@/db/queries/people';
import {
  getBreakdown,
  getDailyTotals,
  getLargestTransaction,
  getRangeSummary,
  getTotalBalanceMinor,
  type BreakdownDim,
  type BreakdownSlice,
  type LargestTransaction,
  type RangeSummary,
  type ReportFilter,
  type ReportKind,
} from '@/db/queries/reports';
import {
  bucketIndexForDay,
  buildBuckets,
  dayCount,
  elapsedDays,
  granularityFor,
  isFuturePeriod,
  periodFor,
  previousRange,
  rangeLabel,
  shiftPeriod,
} from '@/domain/reportRange';
import type { Account, Category, Person } from '@/domain/types';
import { hapticPress, hapticTick } from '@/lib/haptics';
import { useTheme } from '@/theme/ThemeContext';
import {
  bottomClearance,
  layout,
  minTouchTarget,
  paletteColorForKey,
  radius,
  screenPaddingH,
  shadow,
  space,
  type,
} from '@/theme/tokens';

const KIND_OPTIONS: { value: ReportKind; label: string }[] = [
  { value: 'expense', label: 'Spending' },
  { value: 'income', label: 'Income' },
];

const DIM_OPTIONS: { value: BreakdownDim; label: string }[] = [
  { value: 'category', label: 'Category' },
  { value: 'account', label: 'Account' },
  { value: 'person', label: 'Person' },
  { value: 'recurring', label: 'Recurring' },
];

/** What the previous-period comparison is against, in words. */
const PERIOD_NOUN: Record<string, string> = {
  daily: 'day',
  weekly: 'week',
  monthly: 'month',
  yearly: 'year',
};

const EMPTY_SUMMARY: RangeSummary = { incomeMinor: 0, expenseMinor: 0, txCount: 0 };

/** "Filters are on" badge on the filter FAB — paired with the pill above. */
const FAB_DOT_SIZE = 12;

export default function ReportsScreen() {
  const { colors, isDark } = useTheme();
  const router = useRouter();

  const [value, setValue] = useState<ReportFilterValue>(() => ({
    period: periodFor('monthly', new Date()),
    accountId: null,
    personId: null,
    includeCategoryIds: [],
    excludeCategoryIds: [],
  }));
  const [kind, setKind] = useState<ReportKind>('expense');
  const [dim, setDim] = useState<BreakdownDim>('category');
  const [trendMode, setTrendMode] = useState<TrendMode>('bar');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const [totalBalanceMinor, setTotalBalanceMinor] = useState(0);
  const [summary, setSummary] = useState<RangeSummary>(EMPTY_SUMMARY);
  const [previous, setPrevious] = useState<RangeSummary>(EMPTY_SUMMARY);
  const [trend, setTrend] = useState<TrendPoint[]>([]);
  const [slices, setSlices] = useState<BreakdownSlice[]>([]);
  const [expenseByCategory, setExpenseByCategory] = useState<BreakdownSlice[]>([]);
  const [largest, setLargest] = useState<LargestTransaction | null>(null);

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [people, setPeople] = useState<Person[]>([]);

  const { period } = value;
  const filter: ReportFilter = {
    startDay: period.range.startDay,
    endDay: period.range.endDay,
    accountId: value.accountId,
    personId: value.personId,
    includeCategoryIds: value.includeCategoryIds,
    excludeCategoryIds: value.excludeCategoryIds,
  };
  const filterKey = JSON.stringify(filter);

  const reload = useCallback(() => {
    const active: ReportFilter = JSON.parse(filterKey);
    const prior: ReportFilter = { ...active, ...previousRange(active) };
    const buckets = buildBuckets(active, granularityFor(active));

    Promise.all([
      getTotalBalanceMinor(),
      getRangeSummary(active),
      getRangeSummary(prior),
      getDailyTotals(active),
      getBreakdown(active, dim, kind),
      getBreakdown(active, 'category', 'expense'),
      getLargestTransaction(active, 'expense'),
    ])
      .then(([balance, current, before, days, breakdown, byCategory, biggest]) => {
        setTotalBalanceMinor(balance);
        setSummary(current);
        setPrevious(before);
        setSlices(breakdown);
        setExpenseByCategory(byCategory);
        setLargest(biggest);
        setSelectedId(null);

        // Fold the per-day rows into the chart's buckets — one query serves
        // day, week and month granularities.
        const points: TrendPoint[] = buckets.map((b) => ({
          key: b.key,
          label: b.label,
          expenseMinor: 0,
          incomeMinor: 0,
        }));
        for (const row of days) {
          const index = bucketIndexForDay(buckets, row.day);
          if (index < 0) continue;
          points[index].expenseMinor += row.expenseMinor;
          points[index].incomeMinor += row.incomeMinor;
        }
        setTrend(points);
      })
      .catch((e) => Alert.alert('Database error', String(e)));
  }, [filterKey, dim, kind]);

  useFocusEffect(reload);

  // Filter-sheet options. These change rarely, so they load with the screen.
  useFocusEffect(
    useCallback(() => {
      Promise.all([listAccounts(), listCategories('expense'), listCategories('income'), listPeople()])
        .then(([a, expenseCats, incomeCats, p]) => {
          setAccounts(a);
          setCategories([...expenseCats, ...incomeCats]);
          setPeople(p);
        })
        .catch((e) => Alert.alert('Database error', String(e)));
    }, []),
  );

  const kindTotalMinor = kind === 'expense' ? summary.expenseMinor : summary.incomeMinor;
  const slicesTotalMinor = slices.reduce((sum, s) => sum + s.totalMinor, 0);
  const biggestSliceMinor = slices[0]?.totalMinor ?? 0;
  const colorFor = (slice: BreakdownSlice) => slice.color ?? paletteColorForKey(slice.id);

  const topCategory = expenseByCategory[0] ?? null;
  const periodNoun = PERIOD_NOUN[period.preset] ?? `${dayCount(period.range)} days`;
  const filtered = hasActiveFilters(value);
  const canGoForward = !isFuturePeriod(shiftPeriod(period, 1), new Date());

  const openSlice = (sliceDim: BreakdownDim, sliceId: string, sliceKind: ReportKind) => {
    router.push({
      pathname: '/reports/[dim]/[id]',
      params: {
        dim: sliceDim,
        id: sliceId,
        kind: sliceKind,
        from: period.range.startDay,
        to: period.range.endDay,
        periodLabel: rangeLabel(period),
        account: value.accountId ?? '',
        person: value.personId ?? '',
        include: value.includeCategoryIds.join(','),
        exclude: value.excludeCategoryIds.join(','),
      },
    });
  };

  const hasAnything = summary.txCount > 0;

  return (
    <SafeAreaView
      // No 'bottom': inside the tab navigator the tab bar already owns the
      // home-indicator inset. Applying it here too clips the scroll content
      // and leaves a dead strip above the tab bar.
      edges={['top', 'left', 'right']}
      style={[styles.safeArea, { backgroundColor: colors.bg }]}>
      <ScreenFade>
        <ScrollView
          contentContainerStyle={styles.container}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                hapticTick();
                setRefreshing(true);
                reload();
                setRefreshing(false);
              }}
              tintColor={colors.primary}
              colors={[colors.primary]}
            />
          }>
        <Text style={[type.h1, { color: colors.text }]}>Reports</Text>

        {/* Period switcher */}
        <View style={styles.periodNav}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Previous period"
            onPress={() => {
              hapticTick();
              setValue((v) => ({ ...v, period: shiftPeriod(v.period, -1) }));
            }}
            style={[styles.periodArrow, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Feather name="chevron-left" size={18} color={colors.primary} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Period: ${rangeLabel(period)}. Opens filters.`}
            onPress={() => setFilterOpen(true)}
            style={styles.periodLabel}>
            <Text numberOfLines={1} style={[type.h2, styles.periodText, { color: colors.text }]}>
              {rangeLabel(period)}
            </Text>
            <Feather name="chevron-down" size={16} color={colors.textMuted} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Next period"
            disabled={!canGoForward}
            onPress={() => {
              hapticTick();
              setValue((v) => ({ ...v, period: shiftPeriod(v.period, 1) }));
            }}
            style={[
              styles.periodArrow,
              { backgroundColor: colors.surface, borderColor: colors.border },
              !canGoForward && styles.dimmed,
            ]}>
            <Feather name="chevron-right" size={18} color={colors.primary} />
          </Pressable>
        </View>

        {filtered ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Filters are active. Clear them."
            onPress={() =>
              setValue((v) => ({
                ...v,
                accountId: null,
                personId: null,
                includeCategoryIds: [],
                excludeCategoryIds: [],
              }))
            }
            style={[styles.filterPill, { backgroundColor: colors.primarySoft }]}>
            <Feather name="filter" size={13} color={colors.primary} />
            <Text style={[type.caption, styles.filterPillText, { color: colors.primary }]}>
              Filters active
            </Text>
            <Feather name="x" size={13} color={colors.primary} />
          </Pressable>
        ) : null}

        <BalanceSummaryCard
          totalBalanceMinor={totalBalanceMinor}
          income={{ currentMinor: summary.incomeMinor, previousMinor: previous.incomeMinor }}
          expense={{ currentMinor: summary.expenseMinor, previousMinor: previous.expenseMinor }}
          comparisonLabel={`Compared with the previous ${periodNoun}`}
        />

        <QuickInsights
          data={{
            incomeMinor: summary.incomeMinor,
            expenseMinor: summary.expenseMinor,
            elapsedDays: elapsedDays(period.range, new Date()),
            txCount: summary.txCount,
            topCategory: topCategory
              ? {
                  id: topCategory.id,
                  name: topCategory.name,
                  icon: topCategory.icon,
                  color: colorFor(topCategory),
                  shareOfExpense:
                    summary.expenseMinor > 0 ? topCategory.totalMinor / summary.expenseMinor : 0,
                }
              : null,
            largest: largest
              ? { id: largest.id, name: largest.name, amountMinor: largest.amountMinor }
              : null,
          }}
          onPressTopCategory={(id) => openSlice('category', id, 'expense')}
          onPressLargest={(id) => router.push(`/transaction/detail/${id}`)}
        />

        {/* Trend */}
        <View style={[styles.card, { backgroundColor: colors.surface }, !isDark && shadow]}>
          <View style={styles.cardHead}>
            <Text style={[type.h2, { color: colors.text }]}>Income vs spending</Text>
            <View style={[styles.modeToggle, { backgroundColor: colors.surfaceAlt }]}>
              {(['bar', 'line'] as const).map((mode) => {
                const selected = trendMode === mode;
                return (
                  <Pressable
                    key={mode}
                    accessibilityRole="button"
                    accessibilityLabel={mode === 'bar' ? 'Bar chart' : 'Line chart'}
                    accessibilityState={{ selected }}
                    onPress={() => {
                      if (!selected) hapticTick();
                      setTrendMode(mode);
                    }}
                    style={[styles.modeButton, selected && { backgroundColor: colors.primary }]}>
                    <Feather
                      name={mode === 'bar' ? 'bar-chart-2' : 'activity'}
                      size={16}
                      color={selected ? colors.onPrimary : colors.textMuted}
                    />
                  </Pressable>
                );
              })}
            </View>
          </View>
          <TrendChart points={trend} mode={trendMode} />
        </View>

        {/* Breakdown controls */}
        <View style={styles.dropdownRow}>
          <Dropdown
            value={kind}
            options={KIND_OPTIONS}
            onChange={setKind}
            accessibilityLabel="Show"
          />
          <Dropdown
            value={dim}
            options={DIM_OPTIONS}
            onChange={setDim}
            accessibilityLabel="Group by"
            align="right"
          />
        </View>

        {/* Donut + ranked slices */}
        <View style={[styles.card, { backgroundColor: colors.surface }, !isDark && shadow]}>
          <DonutChart
            total={slicesTotalMinor}
            centerLabel={kind === 'expense' ? 'Spending' : 'Income'}
            selectedId={selectedId}
            onSelect={(id) => {
              hapticTick();
              setSelectedId(id);
            }}
            segments={slices.map((s) => ({
              id: s.id,
              label: s.name,
              value: s.totalMinor,
              color: colorFor(s),
            }))}
          />

          {slices.length === 0 ? (
            <View style={styles.empty}>
              <Feather name="pie-chart" size={26} color={colors.textSubtle} />
              <Text style={[type.body, styles.emptyText, { color: colors.textMuted }]}>
                {hasAnything
                  ? `No approved ${kind === 'expense' ? 'spending' : 'income'} to group by ${
                      DIM_OPTIONS.find((o) => o.value === dim)?.label.toLowerCase() ?? dim
                    } in this period.`
                  : 'No approved transactions in this period yet.'}
              </Text>
              {dim === 'person' ? (
                <Text style={[type.caption, styles.emptyText, { color: colors.textSubtle }]}>
                  Only transactions tagged with a person are grouped here.
                </Text>
              ) : null}
            </View>
          ) : (
            <>
              <View style={styles.legend}>
                {slices.map((s) => (
                  <View key={s.id} style={styles.legendItem}>
                    <View style={[styles.legendChip, { backgroundColor: colorFor(s) }]} />
                    <Text style={[type.caption, { color: colors.textMuted }]}>
                      {s.name} {Math.round((s.totalMinor / Math.max(1, slicesTotalMinor)) * 100)}%
                    </Text>
                  </View>
                ))}
              </View>

              <View style={styles.sliceList}>
                {slices.map((s) => (
                  <BreakdownRow
                    key={s.id}
                    row={{
                      id: s.id,
                      name: s.name,
                      icon: s.icon,
                      color: colorFor(s),
                      totalMinor: s.totalMinor,
                      txCount: s.txCount,
                      share: slicesTotalMinor > 0 ? s.totalMinor / slicesTotalMinor : 0,
                    }}
                    barFraction={biggestSliceMinor > 0 ? s.totalMinor / biggestSliceMinor : 0}
                    selected={s.id === selectedId}
                    onPress={() => openSlice(dim, s.id, kind)}
                    onLongPress={() => setSelectedId((prev) => (prev === s.id ? null : s.id))}
                  />
                ))}
              </View>
            </>
          )}
        </View>

        {/* The donut totals only what this grouping can attribute; say so when
            it differs from the period total (e.g. untagged rows in a person
            grouping). */}
        {slices.length > 0 && slicesTotalMinor !== kindTotalMinor ? (
          <Text style={[type.caption, styles.footnote, { color: colors.textSubtle }]}>
            Grouped {Math.round((slicesTotalMinor / Math.max(1, kindTotalMinor)) * 100)}% of this
            period&apos;s {kind === 'expense' ? 'spending' : 'income'} — the rest has no{' '}
            {DIM_OPTIONS.find((o) => o.value === dim)?.label.toLowerCase() ?? dim}.
          </Text>
        ) : null}
        </ScrollView>
      </ScreenFade>

      <Fab
        icon="filter"
        accessibilityLabel="Filter reports"
        size={layout.fabSm}
        onPress={() => {
          hapticPress();
          setFilterOpen(true);
        }}
        style={[styles.fab, { bottom: layout.reports.filterFabBottom }]}
      />
      {filtered ? (
        <View
          pointerEvents="none"
          style={[
            styles.fabDot,
            {
              // Sits on the FAB's top-right corner.
              bottom: layout.reports.filterFabBottom + layout.fabSm - FAB_DOT_SIZE,
              right: screenPaddingH,
              backgroundColor: colors.warning,
              borderColor: colors.bg,
            },
          ]}
        />
      ) : null}

      <ReportFilterSheet
        visible={filterOpen}
        value={value}
        accounts={accounts}
        categories={categories}
        people={people}
        onClose={() => setFilterOpen(false)}
        onApply={(next) => {
          setValue(next);
          setFilterOpen(false);
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  container: {
    paddingHorizontal: screenPaddingH,
    paddingVertical: space.md,
    paddingBottom: bottomClearance.reports,
    gap: space.lg,
  },
  periodNav: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  periodArrow: {
    width: minTouchTarget,
    height: minTouchTarget,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  periodLabel: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xs,
    minHeight: minTouchTarget,
  },
  periodText: { flexShrink: 1, textAlign: 'center' },
  dimmed: { opacity: 0.4 },
  filterPill: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    paddingVertical: space.xs + 2,
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
  },
  filterPillText: { marginHorizontal: 2 },
  card: { borderRadius: layout.heroCardRadius, padding: space.lg, gap: space.lg },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm },
  modeToggle: { flexDirection: 'row', borderRadius: radius.pill, padding: space.xs, gap: space.xs },
  modeButton: {
    width: 40,
    height: 32,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dropdownRow: { flexDirection: 'row', gap: space.sm, justifyContent: 'space-between' },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm + 2, justifyContent: 'center' },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: space.xs + 2 },
  legendChip: { width: 10, height: 10, borderRadius: 3 },
  sliceList: { gap: space.xs },
  empty: { alignItems: 'center', gap: space.sm, paddingVertical: space.lg },
  emptyText: { textAlign: 'center' },
  footnote: { textAlign: 'center' },
  fab: { position: 'absolute', right: screenPaddingH },
  fabDot: {
    position: 'absolute',
    width: FAB_DOT_SIZE,
    height: FAB_DOT_SIZE,
    borderRadius: FAB_DOT_SIZE / 2,
    borderWidth: 2,
  },
});
