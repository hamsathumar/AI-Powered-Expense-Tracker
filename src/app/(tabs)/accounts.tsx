/**
 * Accounts tab (spec §8.7): account cards with computed balances (approved
 * only — §4.2), then a searchable transaction list below.
 *
 * Interaction: tapping a card SELECTS it, filtering the transaction list to
 * that account (including transfers that touch it — real money moves through
 * it). A trailing pencil edits the account. + Add is a floating button.
 */
import { Feather } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import type { ComponentProps } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Amount } from '@/components/Amount';
import { Fab } from '@/components/Fab';
import { TransactionRow } from '@/components/TransactionRow';
import { listAccountBalancesMinor, listAccounts } from '@/db/queries/accounts';
import { listTransactionItems, type TransactionListItem } from '@/db/queries/transactions';
import type { Account, AccountType } from '@/domain/types';
import { useTheme } from '@/theme/ThemeContext';
import { minTouchTarget, radius, screenPaddingH, space, type } from '@/theme/tokens';

const TYPE_META: Record<
  AccountType,
  { label: string; icon: ComponentProps<typeof Feather>['name']; colorKey: 'accountBank' | 'accountCard' | 'accountCash' }
> = {
  bank: { label: 'Bank', icon: 'briefcase', colorKey: 'accountBank' },
  card: { label: 'Card', icon: 'credit-card', colorKey: 'accountCard' },
  cash: { label: 'Cash', icon: 'dollar-sign', colorKey: 'accountCash' },
};

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
          {accounts.map((item) => {
            const selected = item.id === selectedId;
            return (
              <Pressable
                key={item.id}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                onPress={() => setSelectedId((prev) => (prev === item.id ? null : item.id))}
                style={[
                  styles.row,
                  {
                    backgroundColor: selected ? colors.primarySoft : colors.surface,
                    borderColor: selected ? colors.primary : 'transparent',
                  },
                ]}>
                <View
                  style={[
                    styles.iconBox,
                    { backgroundColor: `${colors[TYPE_META[item.type].colorKey]}22` },
                  ]}>
                  <Feather
                    name={TYPE_META[item.type].icon}
                    size={18}
                    color={colors[TYPE_META[item.type].colorKey]}
                  />
                </View>
                <View style={styles.middle}>
                  <Text numberOfLines={1} style={[type.body, { color: colors.text }]}>
                    {item.name}
                  </Text>
                  <Text style={[type.caption, { color: colors.textMuted }]}>
                    {TYPE_META[item.type].label}
                  </Text>
                </View>
                <Amount valueMinor={balances.get(item.id) ?? item.openingBalanceMinor} />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Edit ${item.name}`}
                  hitSlop={space.sm}
                  onPress={() => router.push({ pathname: '/account/[id]', params: { id: item.id } })}
                  style={styles.editButton}>
                  <Feather name="edit-2" size={16} color={colors.textMuted} />
                </Pressable>
              </Pressable>
            );
          })}
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
          style={[type.body, styles.searchInput, { color: colors.text }]}
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
      <FlatList
        data={transactions}
        keyExtractor={(item) => item.tx.id}
        contentContainerStyle={styles.list}
        ListHeaderComponent={header}
        renderItem={({ item }) => <TransactionRow item={item} />}
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
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.md,
    borderRadius: radius.md,
    borderWidth: 1,
    minHeight: minTouchTarget + space.md,
  },
  iconBox: {
    width: 36,
    height: 36,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  middle: { flex: 1, gap: 2 },
  editButton: {
    minWidth: minTouchTarget - space.md,
    minHeight: minTouchTarget - space.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
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
  searchInput: { flex: 1, paddingVertical: space.sm },
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
