/**
 * Home — for now: recent transactions + the entry point to the manual form.
 * The balance hero card and summary arrive in Stage 5.
 */
import { Feather } from '@expo/vector-icons';
import { Link, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BalanceHero } from '@/components/BalanceHero';
import { TransactionRow } from '@/components/TransactionRow';
import {
  getMonthlySummary,
  getTotalBalanceMinor,
  monthKey,
  type MonthlySummary,
} from '@/db/queries/reports';
import {
  countPendingTransactions,
  listRecentTransactionItems,
  type TransactionListItem,
} from '@/db/queries/transactions';
import { usePendingCount } from '@/state/PendingCount';
import { useTheme } from '@/theme/ThemeContext';
import { minTouchTarget, radius, screenPaddingH, shadow, space, type } from '@/theme/tokens';

export default function HomeScreen() {
  const { colors, isDark } = useTheme();
  const router = useRouter();
  const { refresh: refreshBadge } = usePendingCount();
  const [items, setItems] = useState<TransactionListItem[]>([]);

  const [totalMinor, setTotalMinor] = useState(0);
  const [summary, setSummary] = useState<MonthlySummary>({ incomeMinor: 0, expenseMinor: 0 });
  const [pendingCount, setPendingCount] = useState(0);

  const reload = useCallback(() => {
    Promise.all([
      listRecentTransactionItems(30),
      getTotalBalanceMinor(),
      getMonthlySummary(monthKey(new Date())),
      countPendingTransactions(),
    ])
      .then(([txItems, total, monthSummary, pending]) => {
        setItems(txItems);
        setTotalMinor(total);
        setSummary(monthSummary);
        setPendingCount(pending);
      })
      .catch((e) => Alert.alert('Database error', String(e)));
    refreshBadge();
  }, [refreshBadge]);

  // Refetch whenever the screen regains focus (e.g. returning from the form).
  useFocusEffect(reload);

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.bg }]}>
      <View style={styles.header}>
        <Text style={[type.h1, { color: colors.text }]}>Kaasu</Text>
        <View style={styles.headerActions}>
          <Link href="/recurring" accessibilityRole="button" style={styles.iconLink}>
            <Feather name="repeat" size={20} color={colors.textMuted} />
          </Link>
          <Link href="/bill-split" accessibilityRole="button" style={styles.iconLink}>
            <Feather name="divide-circle" size={20} color={colors.textMuted} />
          </Link>
          <Link href="/person" accessibilityRole="button" style={styles.iconLink}>
            <Feather name="users" size={20} color={colors.textMuted} />
          </Link>
          <Link href="/categories" accessibilityRole="button" style={styles.iconLink}>
            <Feather name="tag" size={20} color={colors.textMuted} />
          </Link>
          <Link href="/settings" accessibilityRole="button" style={styles.iconLink}>
            <Feather name="settings" size={20} color={colors.textMuted} />
          </Link>
          <Link
            href="/transaction/new"
            accessibilityRole="button"
            style={[
              type.label,
              styles.addButton,
              { backgroundColor: colors.primary, color: colors.onPrimary },
            ]}>
            + Add
          </Link>
        </View>
      </View>

      <FlatList
        data={items}
        keyExtractor={(item) => item.tx.id}
        renderItem={({ item }) => <TransactionRow item={item} />}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <View style={styles.heroWrap}>
            <BalanceHero
              totalBalanceMinor={totalMinor}
              monthIncomeMinor={summary.incomeMinor}
              monthExpenseMinor={summary.expenseMinor}
              pendingCount={pendingCount}
            />
            {items.length > 0 ? (
              <Text style={[type.h2, styles.listTitle, { color: colors.text }]}>Recent</Text>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Feather name="feather" size={28} color={colors.textSubtle} />
            <Text style={[type.body, styles.emptyText, { color: colors.textMuted }]}>
              No transactions yet — tap the mic to record your first.
            </Text>
          </View>
        }
      />

      {/* Signature interaction (design §5.5): the voice button is the app's
          core promise — frictionless capture, one tap away, always on Home.
          Imperative navigation (not <Link asChild>) so the function/array
          style isn't routed through expo-router's <Slot>, which can't merge
          it and would silently drop the button. */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Log by voice"
        onPress={() => router.push('/voice')}
        style={({ pressed }) => [
          styles.fab,
          { backgroundColor: pressed ? colors.primaryPress : colors.primary },
          !isDark && shadow,
        ]}>
        <Feather name="mic" size={26} color={colors.onPrimary} />
      </Pressable>
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
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
  },
  iconLink: {
    minHeight: minTouchTarget,
    minWidth: minTouchTarget,
    textAlign: 'center',
    paddingTop: space.md,
  },
  addButton: {
    minHeight: minTouchTarget - space.sm,
    borderRadius: radius.pill,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    overflow: 'hidden',
    textAlign: 'center',
  },
  list: {
    paddingHorizontal: screenPaddingH,
    paddingBottom: space.xxl,
    gap: space.sm,
  },
  heroWrap: { gap: space.lg, marginBottom: space.sm },
  listTitle: { marginBottom: 0 },
  fab: {
    position: 'absolute',
    right: screenPaddingH,
    bottom: space.xl,
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  empty: {
    alignItems: 'center',
    gap: space.md,
    paddingTop: space.xxl * 2,
  },
  emptyText: { textAlign: 'center' },
});
