/**
 * Reports (spec §8.11, design-system-v2 §6): a month switcher, income vs
 * spending, spending by category (bars), a donut card with a legend, daily
 * spending bars, and a by-account breakdown — all for one month. The golden
 * rule is enforced in the SQL layer (reports.ts): transfers and lending never
 * appear here. Category colours stay consistent across bars, donut and legend
 * (v2 §2.9); the donut legend is required (colour is never the only key).
 */
import { Feather } from '@expo/vector-icons';
import { addMonths, format, getDaysInMonth } from 'date-fns';
import { useFocusEffect } from 'expo-router';
import type { ComponentProps } from 'react';
import { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ACCOUNT_TYPE_META } from '@/components/AccountCard';
import { Amount } from '@/components/Amount';
import { DonutChart } from '@/components/DonutChart';
import {
  getDailySpending,
  getMonthlySummary,
  getSpendingByAccount,
  getSpendingByCategory,
  monthKey,
  type AccountSpending,
  type CategorySpending,
  type DailySpending,
  type MonthlySummary,
} from '@/db/queries/reports';
import { formatAmount } from '@/domain/money';
import { useTheme } from '@/theme/ThemeContext';
import { layout, radius, screenPaddingH, shadow, space, tabularNums, type } from '@/theme/tokens';

const DAILY_CHART_H = 110;

export default function ReportsScreen() {
  const { colors, isDark } = useTheme();
  const [monthDate, setMonthDate] = useState(() => new Date());
  const [summary, setSummary] = useState<MonthlySummary>({ incomeMinor: 0, expenseMinor: 0 });
  const [categories, setCategories] = useState<CategorySpending[]>([]);
  const [daily, setDaily] = useState<DailySpending[]>([]);
  const [byAccount, setByAccount] = useState<AccountSpending[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const month = monthKey(monthDate);
  const isCurrentMonth = month === monthKey(new Date());

  const reload = useCallback(() => {
    Promise.all([
      getMonthlySummary(month),
      getSpendingByCategory(month),
      getDailySpending(month),
      getSpendingByAccount(month),
    ])
      .then(([s, c, d, a]) => {
        setSummary(s);
        setCategories(c);
        setDaily(d);
        setByAccount(a);
        setSelectedId(null);
      })
      .catch((e) => Alert.alert('Database error', String(e)));
  }, [month]);

  useFocusEffect(reload);

  const maxCategoryMinor = categories[0]?.totalMinor ?? 0;

  // Fill every day of the month so gaps show as empty bars.
  const daysInMonth = getDaysInMonth(monthDate);
  const dailyByDay = new Map(daily.map((d) => [d.day, d.totalMinor]));
  const dailyBars = Array.from({ length: daysInMonth }, (_, i) => ({
    day: i + 1,
    totalMinor: dailyByDay.get(i + 1) ?? 0,
  }));
  const maxDaily = Math.max(1, ...dailyBars.map((b) => b.totalMinor));
  const todayDay = isCurrentMonth ? new Date().getDate() : -1;
  const avgPerDayMinor = Math.round(summary.expenseMinor / daysInMonth);

  const hasSpending = categories.length > 0;

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.bg }]}>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={[type.h1, { color: colors.text }]}>Reports</Text>

        {/* Month switcher */}
        <View style={styles.monthNav}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Previous month"
            onPress={() => setMonthDate((d) => addMonths(d, -1))}
            style={[styles.monthArrow, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Feather name="chevron-left" size={18} color={colors.primary} />
          </Pressable>
          <Text style={[type.h2, { color: colors.text }]}>{format(monthDate, 'MMMM yyyy')}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Next month"
            disabled={isCurrentMonth}
            onPress={() => setMonthDate((d) => addMonths(d, 1))}
            style={[
              styles.monthArrow,
              { backgroundColor: colors.surface, borderColor: colors.border },
              isCurrentMonth && styles.dimmed,
            ]}>
            <Feather name="chevron-right" size={18} color={colors.textSubtle} />
          </Pressable>
        </View>

        {/* Income vs spending */}
        <View style={styles.summaryRow}>
          <View style={[styles.summaryCard, { backgroundColor: colors.surface }, !isDark && shadow]}>
            <View style={styles.summaryLabel}>
              <Feather name="arrow-up" size={14} color={colors.income} />
              <Text style={[type.caption, { color: colors.textMuted }]}>Income</Text>
            </View>
            <Amount valueMinor={summary.incomeMinor} txType="income" textStyle={type.display} />
          </View>
          <View style={[styles.summaryCard, { backgroundColor: colors.surface }, !isDark && shadow]}>
            <View style={styles.summaryLabel}>
              <Feather name="arrow-down" size={14} color={colors.expense} />
              <Text style={[type.caption, { color: colors.textMuted }]}>Spending</Text>
            </View>
            <Amount valueMinor={summary.expenseMinor} txType="expense" textStyle={type.display} />
          </View>
        </View>

        {!hasSpending ? (
          <View style={styles.empty}>
            <Feather name="pie-chart" size={28} color={colors.textSubtle} />
            <Text style={[type.body, styles.emptyText, { color: colors.textMuted }]}>
              No approved spending this month yet.
            </Text>
          </View>
        ) : (
          <>
            {/* Spending by category */}
            <Text style={[type.h2, { color: colors.text }]}>Spending by category</Text>
            <View style={styles.barList}>
              {categories.map((cat) => {
                const fraction = maxCategoryMinor > 0 ? cat.totalMinor / maxCategoryMinor : 0;
                const share =
                  summary.expenseMinor > 0 ? Math.round((cat.totalMinor / summary.expenseMinor) * 100) : 0;
                const barColor = cat.color ?? colors.expense;
                const selected = cat.categoryId === selectedId;
                return (
                  <Pressable
                    key={cat.categoryId}
                    accessibilityRole="button"
                    onPress={() => setSelectedId((prev) => (prev === cat.categoryId ? null : cat.categoryId))}
                    style={[styles.barItem, selected && { backgroundColor: colors.surfaceAlt, borderColor: barColor }]}>
                    <View style={styles.barHeader}>
                      <Feather
                        name={(cat.icon as ComponentProps<typeof Feather>['name']) ?? 'circle'}
                        size={14}
                        color={barColor}
                      />
                      <Text numberOfLines={1} style={[type.body, styles.barName, { color: colors.text }]}>
                        {cat.name}
                      </Text>
                      <Text style={[type.caption, styles.pct, { color: colors.textMuted }]}>{share}%</Text>
                      <Amount valueMinor={cat.totalMinor} textStyle={type.label} colorOverride={colors.text} />
                    </View>
                    <View style={[styles.barTrack, { backgroundColor: colors.surfaceAlt }]}>
                      <View style={[styles.barFill, { backgroundColor: barColor, flex: Math.max(fraction, 0.02) }]} />
                      <View style={{ flex: 1 - Math.max(fraction, 0.02) }} />
                    </View>
                  </Pressable>
                );
              })}
            </View>

            {/* Donut card with legend */}
            <View style={[styles.card, { backgroundColor: colors.surface }, !isDark && shadow]}>
              <DonutChart
                total={summary.expenseMinor}
                selectedId={selectedId}
                onSelect={setSelectedId}
                segments={categories.map((cat) => ({
                  id: cat.categoryId,
                  label: cat.name,
                  value: cat.totalMinor,
                  color: cat.color ?? colors.expense,
                }))}
              />
              <View style={styles.legend}>
                {categories.map((cat) => {
                  const share =
                    summary.expenseMinor > 0 ? Math.round((cat.totalMinor / summary.expenseMinor) * 100) : 0;
                  return (
                    <View key={cat.categoryId} style={styles.legendItem}>
                      <View style={[styles.legendChip, { backgroundColor: cat.color ?? colors.expense }]} />
                      <Text style={[type.caption, { color: colors.textMuted }]}>
                        {cat.name} {share}%
                      </Text>
                    </View>
                  );
                })}
              </View>
            </View>

            {/* Daily spending */}
            <View style={styles.sectionHead}>
              <Text style={[type.h2, { color: colors.text }]}>Daily spending</Text>
              <Text style={[type.caption, { color: colors.textMuted }]}>
                Avg {formatAmount(avgPerDayMinor)}/day
              </Text>
            </View>
            <View style={[styles.card, { backgroundColor: colors.surface }, !isDark && shadow]}>
              <View style={styles.dailyChart}>
                {dailyBars.map((b) => (
                  <View
                    key={b.day}
                    style={[
                      styles.dailyBar,
                      {
                        height: `${Math.max(2, (b.totalMinor / maxDaily) * 100)}%`,
                        backgroundColor: b.day === todayDay ? colors.primary : colors.primarySoft,
                      },
                    ]}
                  />
                ))}
              </View>
              <View style={styles.dailyAxis}>
                <Text style={[type.caption, styles.axisLabel, { color: colors.textSubtle }]}>1</Text>
                <Text style={[type.caption, styles.axisLabel, { color: colors.textSubtle }]}>
                  {Math.round(daysInMonth / 2)}
                </Text>
                <Text style={[type.caption, styles.axisLabel, { color: colors.textSubtle }]}>{daysInMonth}</Text>
              </View>
            </View>

            {/* By account */}
            {byAccount.length > 0 ? (
              <>
                <Text style={[type.h2, { color: colors.text }]}>By account</Text>
                <View style={styles.accountList}>
                  {byAccount.map((a) => (
                    <View
                      key={a.accountId}
                      style={[styles.accountRow, { backgroundColor: colors.surface }, !isDark && shadow]}>
                      <View style={[styles.accountRule, { backgroundColor: colors[ACCOUNT_TYPE_META[a.type].colorKey] }]} />
                      <Text numberOfLines={1} style={[type.body, styles.accountName, { color: colors.text }]}>
                        {a.name}
                      </Text>
                      <Amount valueMinor={a.totalMinor} txType="expense" textStyle={type.label} />
                    </View>
                  ))}
                </View>
              </>
            ) : null}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  container: {
    paddingHorizontal: screenPaddingH,
    paddingVertical: space.md,
    paddingBottom: space.xxl * 2,
    gap: space.lg,
  },
  monthNav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  monthArrow: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dimmed: { opacity: 0.4 },
  summaryRow: { flexDirection: 'row', gap: space.md },
  summaryCard: { flex: 1, borderRadius: layout.cardRadius, padding: space.lg, gap: space.sm },
  summaryLabel: { flexDirection: 'row', alignItems: 'center', gap: space.xs + 2 },
  barList: { gap: space.md - 2 },
  barItem: {
    gap: space.xs + 2,
    borderWidth: 1,
    borderColor: 'transparent',
    borderRadius: radius.md,
    padding: space.sm,
  },
  barHeader: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  barName: { flex: 1 },
  pct: { ...tabularNums },
  barTrack: { flexDirection: 'row', height: 8, borderRadius: radius.pill, overflow: 'hidden' },
  barFill: { borderRadius: radius.pill },
  card: { borderRadius: layout.heroCardRadius, padding: space.xl, gap: space.lg },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm + 2, justifyContent: 'center' },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: space.xs + 2 },
  legendChip: { width: 10, height: 10, borderRadius: 3 },
  sectionHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  dailyChart: { height: DAILY_CHART_H, flexDirection: 'row', alignItems: 'flex-end', gap: 3 },
  dailyBar: { flex: 1, borderRadius: radius.sm, minHeight: 2 },
  dailyAxis: { flexDirection: 'row', justifyContent: 'space-between' },
  axisLabel: { ...tabularNums },
  accountList: { gap: space.sm },
  accountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    borderRadius: radius.md,
    padding: space.md + 2,
  },
  accountRule: { width: 4, height: 28, borderRadius: radius.pill },
  accountName: { flex: 1 },
  empty: { alignItems: 'center', gap: space.md, paddingTop: space.xxl },
  emptyText: { textAlign: 'center' },
});
