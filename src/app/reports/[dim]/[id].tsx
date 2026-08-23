/**
 * Report drill-down — one slice of a breakdown (a category, an account, a
 * person, or the recurring/one-off split) for the period and filter that were
 * active on the Reports tab.
 *
 * The whole report context arrives as route params rather than shared state,
 * so the screen is self-contained and survives a deep link or a reload: the
 * period days, which kind (spending/income), and every narrowing the filter
 * sheet applied. The golden rule still lives in the SQL layer — this screen
 * can only ever show approved expense/income.
 *
 * Layout: a stat grid answering "how much, how often, how big", then the
 * transactions themselves grouped by day with a per-day total, so a suspicious
 * number can be traced to the row that caused it in one tap.
 */
import { Feather } from '@expo/vector-icons';
import { format, formatDistanceToNowStrict } from 'date-fns';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import type { ComponentProps } from 'react';
import { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Amount } from '@/components/Amount';
import { ScreenHeader } from '@/components/ScreenHeader';
import { TransactionRow } from '@/components/TransactionRow';
import {
  getBreakdown,
  getSliceStats,
  listSliceTransactionIds,
  type BreakdownDim,
  type ReportFilter,
  type ReportKind,
  type SliceStats,
} from '@/db/queries/reports';
import { listTransactionItemsByIds, type TransactionListItem } from '@/db/queries/transactions';
import { useTheme } from '@/theme/ThemeContext';
import {
  layout,
  paletteColorForKey,
  radius,
  screenPaddingH,
  shadow,
  space,
  tabularNums,
  type,
} from '@/theme/tokens';

const DIM_NOUN: Record<BreakdownDim, string> = {
  category: 'category',
  account: 'account',
  person: 'person',
  recurring: 'group',
};

interface DaySection {
  day: string;
  label: string;
  totalMinor: number;
  items: TransactionListItem[];
}

/** csv route param → id list ('' means "no narrowing"). */
function idsParam(raw: string | undefined): string[] {
  return raw ? raw.split(',').filter(Boolean) : [];
}

export default function ReportSliceScreen() {
  const { colors, isDark } = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{
    dim: BreakdownDim;
    id: string;
    kind: ReportKind;
    from: string;
    to: string;
    periodLabel?: string;
    account?: string;
    person?: string;
    include?: string;
    exclude?: string;
  }>();

  const dim = params.dim;
  const kind = params.kind ?? 'expense';

  const [stats, setStats] = useState<SliceStats | null>(null);
  const [sections, setSections] = useState<DaySection[]>([]);
  const [slice, setSlice] = useState<{ name: string; icon: string | null; color: string } | null>(null);

  const filterKey = JSON.stringify({
    startDay: params.from,
    endDay: params.to,
    accountId: params.account || null,
    personId: params.person || null,
    includeCategoryIds: idsParam(params.include),
    excludeCategoryIds: idsParam(params.exclude),
  } satisfies ReportFilter);

  const reload = useCallback(() => {
    const filter: ReportFilter = JSON.parse(filterKey);
    Promise.all([
      getSliceStats(filter, dim, params.id, kind),
      listSliceTransactionIds(filter, dim, params.id, kind).then(listTransactionItemsByIds),
      getBreakdown(filter, dim, kind),
    ])
      .then(([sliceStats, items, breakdown]) => {
        setStats(sliceStats);

        const found = breakdown.find((s) => s.id === params.id);
        setSlice(
          found
            ? { name: found.name, icon: found.icon, color: found.color ?? paletteColorForKey(found.id) }
            : null,
        );

        // Group by local calendar day, preserving the newest-first ordering.
        const byDay = new Map<string, DaySection>();
        for (const item of items) {
          const date = new Date(item.tx.occurredAt);
          const day = format(date, 'yyyy-MM-dd');
          let section = byDay.get(day);
          if (!section) {
            section = { day, label: format(date, 'EEE, d MMM'), totalMinor: 0, items: [] };
            byDay.set(day, section);
          }
          section.totalMinor += item.tx.amountMinor;
          section.items.push(item);
        }
        setSections([...byDay.values()]);
      })
      .catch((e) => Alert.alert('Database error', String(e)));
  }, [filterKey, dim, kind, params.id]);

  useFocusEffect(reload);

  const tint = slice?.color ?? colors[kind];
  const kindLabel = kind === 'expense' ? 'spending' : 'income';

  const statTiles = stats
    ? [
        { label: 'Total', value: <Amount valueMinor={stats.totalMinor} textStyle={type.amount} colorOverride={colors.text} /> },
        { label: 'Average', value: <Amount valueMinor={stats.averageMinor} textStyle={type.amount} colorOverride={colors.text} /> },
        {
          label: 'Largest',
          value: <Amount valueMinor={stats.largestMinor} textStyle={type.amount} colorOverride={colors.text} />,
          hint: stats.largestName ?? undefined,
        },
        {
          label: 'Transactions',
          value: (
            <Text style={[type.amount, styles.figure, { color: colors.text }]}>{stats.txCount}</Text>
          ),
          hint: `${stats.allTimeCount} all time`,
        },
      ]
    : [];

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.bg }]} edges={['top', 'left', 'right']}>
      <ScreenHeader title={slice?.name ?? 'Breakdown'} />

      <ScrollView contentContainerStyle={styles.container}>
        {/* Slice identity + which period this is */}
        <View style={[styles.heroCard, { backgroundColor: colors.surface }, !isDark && shadow]}>
          <View style={[styles.iconTile, { backgroundColor: `${tint}1F` }]}>
            <Feather
              name={(slice?.icon as ComponentProps<typeof Feather>['name']) ?? 'circle'}
              size={22}
              color={tint}
            />
          </View>
          <View style={styles.heroText}>
            <Text numberOfLines={2} style={[type.h2, { color: colors.text }]}>
              {slice?.name ?? 'Breakdown'}
            </Text>
            <Text style={[type.caption, { color: colors.textMuted }]}>
              {kindLabel} · {params.periodLabel ?? `${params.from} – ${params.to}`}
            </Text>
          </View>
        </View>

        {/* Stat grid */}
        <View style={styles.statGrid}>
          {statTiles.map((tile) => (
            <View
              key={tile.label}
              style={[styles.statTile, { backgroundColor: colors.surface }, !isDark && shadow]}>
              <Text style={[type.caption, { color: colors.textMuted }]}>{tile.label}</Text>
              {tile.value}
              {tile.hint ? (
                <Text numberOfLines={1} style={[type.caption, { color: colors.textSubtle }]}>
                  {tile.hint}
                </Text>
              ) : null}
            </View>
          ))}
        </View>

        {/* All-time context — deliberately ignores the period AND the filter,
            so it answers "what does this cost me overall?" */}
        {stats ? (
          <View style={[styles.allTime, { backgroundColor: colors.surfaceAlt }]}>
            <View style={styles.allTimeRow}>
              <Feather name="clock" size={15} color={colors.textMuted} />
              <Text style={[type.caption, styles.allTimeLabel, { color: colors.textMuted }]}>
                All time {kindLabel} in this {DIM_NOUN[dim]}
              </Text>
              <Amount
                valueMinor={stats.allTimeTotalMinor}
                textStyle={type.label}
                colorOverride={colors.text}
              />
            </View>
            <Text style={[type.caption, { color: colors.textSubtle }]}>
              {stats.lastOccurredAt
                ? `Last transaction ${formatDistanceToNowStrict(new Date(stats.lastOccurredAt), { addSuffix: true })}`
                : 'No transactions yet'}
            </Text>
          </View>
        ) : null}

        <Text style={[type.h2, { color: colors.text }]}>Transaction insights</Text>

        {sections.length === 0 ? (
          <View style={styles.empty}>
            <Feather name="inbox" size={26} color={colors.textSubtle} />
            <Text style={[type.body, styles.emptyText, { color: colors.textMuted }]}>
              No approved {kindLabel} here in this period.
            </Text>
          </View>
        ) : (
          sections.map((section) => (
            <View key={section.day} style={styles.section}>
              <View style={styles.sectionHead}>
                <Text style={[type.sectionLabel, { color: colors.textSubtle }]}>{section.label}</Text>
                <Amount valueMinor={section.totalMinor} txType={kind} textStyle={type.label} />
              </View>
              {section.items.map((item) => (
                <Pressable
                  key={item.tx.id}
                  accessibilityRole="button"
                  accessibilityLabel={`Open ${item.tx.name}`}
                  onPress={() => router.push(`/transaction/detail/${item.tx.id}`)}
                  style={({ pressed }) => [pressed && styles.pressed]}>
                  <TransactionRow item={item} />
                </Pressable>
              ))}
            </View>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  container: {
    paddingHorizontal: screenPaddingH,
    paddingBottom: space.xxl * 2,
    gap: space.lg,
  },
  heroCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    borderRadius: layout.heroCardRadius,
    padding: space.lg,
  },
  iconTile: {
    width: 48,
    height: 48,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroText: { flex: 1, gap: 2 },
  statGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  statTile: {
    flexGrow: 1,
    flexBasis: '45%',
    borderRadius: layout.cardRadius,
    padding: space.md,
    gap: space.xs,
  },
  figure: { ...tabularNums },
  allTime: { borderRadius: layout.cardRadius, padding: space.md, gap: space.xs },
  allTimeRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  allTimeLabel: { flex: 1 },
  section: { gap: space.sm },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.xs,
  },
  pressed: { opacity: 0.7 },
  empty: { alignItems: 'center', gap: space.sm, paddingVertical: space.xl },
  emptyText: { textAlign: 'center' },
});
