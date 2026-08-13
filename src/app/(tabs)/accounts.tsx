/**
 * Accounts tab (spec §8.7): account cards with computed balances (approved
 * only — §4.2), then a searchable transaction list below.
 *
 * Interaction: tapping a card SELECTS it, filtering the transaction list to
 * that account (including transfers that touch it — real money moves through
 * it). A trailing pencil edits the account. + Add is a floating button.
 */
import { Feather } from '@expo/vector-icons';
import { format, isToday, isYesterday } from 'date-fns';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, SectionList, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AccountCard } from '@/components/AccountCard';
import { Fab } from '@/components/Fab';
import { TransactionRow } from '@/components/TransactionRow';
import { listAccountBalancesMinor, listAccounts } from '@/db/queries/accounts';
import { listTransactionItems, type TransactionListItem } from '@/db/queries/transactions';
import { accountDeltaMinor } from '@/domain/accountActivity';
import { formatAmount } from '@/domain/money';
import type { Account } from '@/domain/types';
import { useTheme } from '@/theme/ThemeContext';
import { fontFamily, minTouchTarget, radius, screenPaddingH, space, tabularNums, type } from '@/theme/tokens';

function dayTitle(iso: string): string {
  const date = new Date(iso);
  if (isToday(date)) return `Today · ${format(date, 'd MMM')}`;
  if (isYesterday(date)) return `Yesterday · ${format(date, 'd MMM')}`;
  return format(date, 'EEE d MMM yyyy');
}

export default function AccountsScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [balances, setBalances] = useState<Map<string, number>>(new Map());
  const [transactions, setTransactions] = useState<TransactionListItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const loadAccounts = useCallback(() => {
    Promise.all([listAccounts(), listAccountBalancesMinor()])
      .then(([acc, bal]) => {
        setAccounts(acc);
        setBalances(bal);
      })
      .catch((e) => Alert.alert('Database error', String(e)));
  }, []);

  const loadTransactions = useCallback(() => {
    listTransactionItems({ accountId: selectedId ?? undefined, search })
      .then(setTransactions)
      .catch((e) => Alert.alert('Database error', String(e)));
  }, [selectedId, search]);

  // Accounts/balances refresh on focus; the list also re-runs on filter change.
  useFocusEffect(
    useCallback(() => {
      loadAccounts();
      loadTransactions();
    }, [loadAccounts, loadTransactions]),
  );
  useEffect(loadTransactions, [loadTransactions]);

  const selectedAccount = accounts.find((a) => a.id === selectedId) ?? null;

  // Group the transaction list by local day, with each day's net cash effect
  // (v2 §6). Transactions arrive newest-first, so days stay in that order.
  const sections = useMemo(() => {
    const byDay = new Map<string, TransactionListItem[]>();
    for (const item of transactions) {
      const key = format(new Date(item.tx.occurredAt), 'yyyy-MM-dd');
      byDay.set(key, [...(byDay.get(key) ?? []), item]);
    }
    return [...byDay.entries()].map(([key, data]) => ({
      key,
      title: dayTitle(data[0]!.tx.occurredAt),
      netMinor: data.reduce((sum, i) => sum + accountDeltaMinor(i.tx, selectedId ?? undefined), 0),
      data,
    }));
  }, [transactions, selectedId]);

  const header = (
    <View style={styles.headerBlock}>
      <Text style={[type.h1, { color: colors.text }]}>Accounts</Text>

      {accounts.length === 0 ? (
        <View style={styles.empty}>
          <Feather name="briefcase" size={28} color={colors.textSubtle} />
          <Text style={[type.body, styles.emptyText, { color: colors.textMuted }]}>
            No accounts yet — tap + to add your bank, card, or cash wallet.
          </Text>
        </View>
      ) : (
        <View style={styles.cards}>
          {accounts.map((item) => (
            <AccountCard
              key={item.id}
              account={item}
              balanceMinor={balances.get(item.id) ?? item.openingBalanceMinor}
              selected={item.id === selectedId}
              onPress={() => setSelectedId((prev) => (prev === item.id ? null : item.id))}
              onEdit={() => router.push({ pathname: '/account/[id]', params: { id: item.id } })}
            />
          ))}
        </View>
      )}

      <View style={styles.txHeading}>
        <Text style={[type.h2, { color: colors.text }]}>Transactions</Text>
        {selectedAccount ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => setSelectedId(null)}
            style={[styles.filterChip, { backgroundColor: colors.primarySoft }]}>
            <Text style={[type.caption, { color: colors.primary }]}>{selectedAccount.name}</Text>
            <Feather name="x" size={12} color={colors.primary} />
          </Pressable>
        ) : null}
      </View>

      <View style={[styles.searchBox, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Feather name="search" size={16} color={colors.textSubtle} />
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search transactions"
          placeholderTextColor={colors.textSubtle}
          autoCapitalize="none"
          style={[styles.searchInput, { color: colors.text }]}
        />
        {search.length > 0 ? (
          <Pressable accessibilityRole="button" onPress={() => setSearch('')} hitSlop={space.sm}>
            <Feather name="x" size={16} color={colors.textSubtle} />
          </Pressable>
        ) : null}
      </View>
    </View>
  );

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.bg }]}>
      <SectionList
        sections={sections}
        keyExtractor={(item) => item.tx.id}
        contentContainerStyle={styles.list}
        stickySectionHeadersEnabled={false}
        ListHeaderComponent={header}
        renderSectionHeader={({ section }) => (
          <View style={styles.dayHeader}>
            <Text style={[type.sectionLabel, { color: colors.textSubtle }]}>{section.title}</Text>
            <Text style={[styles.dayNet, { color: colors.textMuted }]}>
              {section.netMinor > 0 ? '+' : section.netMinor < 0 ? '−' : ''}
              {formatAmount(Math.abs(section.netMinor))}
            </Text>
          </View>
        )}
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            onPress={() =>
              router.push({ pathname: '/transaction/detail/[id]', params: { id: item.tx.id } })
            }>
            <TransactionRow item={item} />
          </Pressable>
        )}
        ListEmptyComponent={
          accounts.length > 0 ? (
            <Text style={[type.caption, styles.emptyText, { color: colors.textSubtle }]}>
              {search || selectedAccount ? 'No matching transactions.' : 'No transactions yet.'}
            </Text>
          ) : null
        }
      />

      <Fab
        icon="plus"
        accessibilityLabel="Add account"
        onPress={() => router.push('/account/new')}
        style={styles.fab}
      />
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
    gap: space.md,
    paddingTop: space.md,
  },
  cards: { gap: space.sm },
  dayHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    paddingTop: space.lg,
    paddingBottom: space.sm,
  },
  dayNet: { fontFamily: type.amount.fontFamily, fontSize: 13, ...tabularNums },
  txHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    marginTop: space.sm,
  },
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    borderRadius: radius.pill,
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    minHeight: minTouchTarget,
  },
  // No lineHeight here: on iOS a TextInput inheriting type.body's lineHeight
  // renders glyphs offset toward the top of the line box, so the text looks
  // un-centred against the search icon. Set the font explicitly, drop
  // lineHeight, and let the row's alignItems:'center' centre it.
  searchInput: {
    flex: 1,
    paddingVertical: space.sm,
    fontFamily: fontFamily.body,
    fontSize: 15,
    includeFontPadding: false,
  },
  empty: {
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.xl,
  },
  emptyText: { textAlign: 'center', paddingTop: space.lg },
  fab: {
    position: 'absolute',
    right: screenPaddingH,
    bottom: space.xl,
  },
});
