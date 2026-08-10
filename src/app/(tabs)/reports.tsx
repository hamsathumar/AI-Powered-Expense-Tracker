/**
 * Reports (spec §8.11): spending by category + income vs expense for a
 * month. Golden rule enforced in the SQL layer (reports.ts) — transfers and
 * lending never appear here. Bars are plain themed views: dependency-free
 * and readable; a chart library can be revisited later if wanted.
 */
import { Feather } from '@expo/vector-icons';
import { addMonths, format } from 'date-fns';
import { useFocusEffect } from 'expo-router';
import type { ComponentProps } from 'react';
import { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Amount } from '@/components/Amount';
import { DonutChart } from '@/components/DonutChart';
import {
  getMonthlySummary,
  getSpendingByCategory,
  monthKey,
  type CategorySpending,
  type MonthlySummary,
} from '@/db/queries/reports';
import { useTheme } from '@/theme/ThemeContext';
import { minTouchTarget, radius, screenPaddingH, space, type } from '@/theme/tokens';

export default function ReportsScreen() {
  const { colors } = useTheme();
  const [monthDate, setMonthDate] = useState(() => new Date());
  const [summary, setSummary] = useState<MonthlySummary>({ incomeMinor: 0, expenseMinor: 0 });
  const [categories, setCategories] = useState<CategorySpending[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const month = monthKey(monthDate);
  const isCurrentMonth = month === monthKey(new Date());

  const reload = useCallback(() => {
    Promise.all([getMonthlySummary(month), getSpendingByCategory(month)])
      .then(([s, c]) => {
        setSummary(s);
        setCategories(c);
        setSelectedId(null);
      })
      .catch((e) => Alert.alert('Database error', String(e)));
  }, [month]);

  useFocusEffect(reload);

  const maxCategoryMinor = categories[0]?.totalMinor ?? 0;

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.bg }]}>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={[type.h1, { color: colors.text }]}>Reports</Text>

        <View style={styles.monthNav}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Previous month"
            onPress={() => setMonthDate((d) => addMonths(d, -1))}
            style={styles.monthArrow}>
            <Feather name="chevron-left" size={22} color={colors.textMuted} />
          </Pressable>
          <Text style={[type.h2, { color: colors.text }]}>{format(monthDate, 'MMMM yyyy')}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Next month"
            disabled={isCurrentMonth}
            onPress={() => setMonthDate((d) => addMonths(d, 1))}
            style={[styles.monthArrow, isCurrentMonth && styles.dimmed]}>
            <Feather name="chevron-right" size={22} color={colors.textMuted} />
          </Pressable>
        </View>

        <View style={styles.summaryRow}>
          <View style={[styles.summaryCard, { backgroundColor: colors.surface }]}>
            <Text style={[type.caption, { color: colors.textMuted }]}>Income</Text>
            <Amount valueMinor={summary.incomeMinor} txType="income" />
          </View>
          <View style={[styles.summaryCard, { backgroundColor: colors.surface }]}>
            <Text style={[type.caption, { color: colors.textMuted }]}>Spending</Text>
            <Amount valueMinor={summary.expenseMinor} txType="expense" />
          </View>
        </View>

        <Text style={[type.h2, { color: colors.text }]}>Spending by category</Text>

        {categories.length === 0 ? (
          <View style={styles.empty}>
            <Feather name="pie-chart" size={28} color={colors.textSubtle} />
            <Text style={[type.body, styles.emptyText, { color: colors.textMuted }]}>
              No approved spending this month yet.
            </Text>
          </View>
        ) : (
          <>
            <View style={styles.barList}>
              {categories.map((cat) => {
                const fraction = maxCategoryMinor > 0 ? cat.totalMinor / maxCategoryMinor : 0;
                const share =
                  summary.expenseMinor > 0
                    ? Math.round((cat.totalMinor / summary.expenseMinor) * 100)
                    : 0;
                const barColor = cat.color ?? colors.expense;
                const selected = cat.categoryId === selectedId;
                return (
                  <Pressable
                    key={cat.categoryId}
                    accessibilityRole="button"
                    onPress={() =>
                      setSelectedId((prev) => (prev === cat.categoryId ? null : cat.categoryId))
                    }
                    style={[
                      styles.barItem,
                      selected && { backgroundColor: colors.surfaceAlt, borderColor: barColor },
                    ]}>
                    <View style={styles.barHeader}>
                      <Feather
                        name={(cat.icon as ComponentProps<typeof Feather>['name']) ?? 'circle'}
                        size={14}
                        color={barColor}
                      />
                      <Text numberOfLines={1} style={[type.label, styles.barName, { color: colors.text }]}>
                        {cat.name}
                      </Text>
                      <Text style={[type.caption, { color: colors.textMuted }]}>{share}%</Text>
                      <Amount valueMinor={cat.totalMinor} txType="expense" textStyle={type.label} />
                    </View>
                    <View style={[styles.barTrack, { backgroundColor: colors.surfaceAlt }]}>
                      <View
                        style={[
                          styles.barFill,
                          { backgroundColor: barColor, flex: Math.max(fraction, 0.02) },
                        ]}
                      />
                      <View style={{ flex: 1 - Math.max(fraction, 0.02) }} />
                    </View>
                  </Pressable>
                );
              })}
            </View>

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
    paddingBottom: space.xxl,
    gap: space.xl,
  },
  monthNav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  monthArrow: {
    minWidth: minTouchTarget,
    minHeight: minTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dimmed: { opacity: 0.3 },
  summaryRow: {
    flexDirection: 'row',
    gap: space.md,
  },
  summaryCard: {
    flex: 1,
    borderRadius: radius.md,
    padding: space.lg,
    gap: space.xs,
  },
  barList: { gap: space.sm },
  barItem: {
    gap: space.xs,
    borderWidth: 1,
    borderColor: 'transparent',
    borderRadius: radius.md,
    padding: space.sm,
  },
  barHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  barName: { flex: 1 },
  barTrack: {
    flexDirection: 'row',
    height: 8,
    borderRadius: radius.pill,
    overflow: 'hidden',
  },
  barFill: { borderRadius: radius.pill },
  empty: {
    alignItems: 'center',
    gap: space.md,
    paddingTop: space.xxl,
  },
  emptyText: { textAlign: 'center' },
});
