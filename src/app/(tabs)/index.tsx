/**
 * Home — for now: recent transactions + the entry point to the manual form.
 * The balance hero card and summary arrive in Stage 5.
 */
import { Feather } from '@expo/vector-icons';
import { Link, useFocusEffect } from 'expo-router';
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
  setTransactionStatus,
  type TransactionListItem,
} from '@/db/queries/transactions';
import { useTheme } from '@/theme/ThemeContext';
import { minTouchTarget, radius, screenPaddingH, space, type } from '@/theme/tokens';

export default function HomeScreen() {
  const { colors } = useTheme();
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
  }, []);

  // Refetch whenever the screen regains focus (e.g. returning from the form).
  useFocusEffect(reload);

  // TEMPORARY until the Approval Queue (Stage 8): long-press a pending row
  // to approve/reject, so approved-only balances and reports are testable.
  const onLongPress = (item: TransactionListItem) => {
    if (item.tx.status !== 'pending') return;
    Alert.alert(item.tx.name, 'Pending transaction', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Reject',
        style: 'destructive',
        onPress: () => setTransactionStatus(item.tx.id, 'rejected').then(reload),
      },
      {
        text: 'Approve',
        onPress: () => setTransactionStatus(item.tx.id, 'approved').then(reload),
      },
    ]);
  };

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.bg }]}>
      <View style={styles.header}>
        <Text style={[type.h1, { color: colors.text }]}>Kaasu</Text>
        <View style={styles.headerActions}>
          <Link href="/person" accessibilityRole="button" style={styles.iconLink}>
            <Feather name="users" size={20} color={colors.textMuted} />
          </Link>
          <Link href="/categories" accessibilityRole="button" style={styles.iconLink}>
            <Feather name="tag" size={20} color={colors.textMuted} />
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
        renderItem={({ item }) => (
          <Pressable onLongPress={() => onLongPress(item)}>
            <TransactionRow item={item} />
          </Pressable>
        )}
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
              No transactions yet — tap + Add to record your first.
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
  empty: {
    alignItems: 'center',
    gap: space.md,
    paddingTop: space.xxl * 2,
  },
  emptyText: { textAlign: 'center' },
});
