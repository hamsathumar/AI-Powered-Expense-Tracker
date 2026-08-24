/**
 * Accounts tab (spec §8.7): account cards with computed balances (approved
 * only — §4.2), then the transaction ledger below.
 *
 * The ledger controls float over the list rather than scrolling away with it:
 * a search pill + filter button at the bottom, with "add account" stacked
 * above them. Search and the filter sheet feed one `TransactionFilter`, which
 * also drives the CSV export in the header — so what you export is exactly
 * what you are looking at.
 *
 * Tapping an account card sets that filter's account (and tapping it again
 * clears it), so the cards and the sheet are two ways to set one piece of
 * state rather than two competing filters.
 *
 * Unlike Reports, this list is the ledger: all four transaction types, and
 * pending rows included — only rejected ones are hidden.
 */
import { Feather } from '@expo/vector-icons';
import { format, isToday, isYesterday } from 'date-fns';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  SectionList,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AccountCard } from '@/components/AccountCard';
import { Fab } from '@/components/Fab';
import { ScreenFade } from '@/components/motion/ScreenFade';
import { PressableScale } from '@/components/PressableScale';
import { SwipeableRow } from '@/components/SwipeableRow';
import { TransactionFilterSheet } from '@/components/TransactionFilterSheet';
import { TransactionPeek } from '@/components/TransactionPeek';
import { TransactionRow } from '@/components/TransactionRow';
import { listAccountBalancesMinor, listAccounts } from '@/db/queries/accounts';
import { listCategories } from '@/db/queries/categories';
import { listPeople } from '@/db/queries/people';
import {
  hasActiveTransactionFilter,
  type TransactionFilter,
} from '@/db/queries/transactionFilterSql';
import {
  deleteTransaction,
  listTransactionItems,
  setTransactionStatus,
  type TransactionListItem,
} from '@/db/queries/transactions';
import { accountDeltaMinor } from '@/domain/accountActivity';
import { formatAmount } from '@/domain/money';
import type { Account, Category, Person } from '@/domain/types';
import { hapticError, hapticPress, hapticSuccess, hapticTick } from '@/lib/haptics';
import { usePendingCount } from '@/state/PendingCount';
import { shareTransactionsCsv } from '@/services/transactionCsv';
import { useTheme } from '@/theme/ThemeContext';
import {
  bottomClearance,
  fontFamily,
  layout,
  motion,
  minTouchTarget,
  radius,
  screenPaddingH,
  shadow,
  space,
  tabularNums,
  type,
} from '@/theme/tokens';

/** The ledger is paged for rendering; the CSV export deliberately is not. */
const LIST_LIMIT = 500;

function dayTitle(iso: string): string {
  const date = new Date(iso);
  if (isToday(date)) return `Today · ${format(date, 'd MMM')}`;
  if (isYesterday(date)) return `Yesterday · ${format(date, 'd MMM')}`;
  return format(date, 'EEE d MMM yyyy');
}

export default function AccountsScreen() {
  const { colors, isDark } = useTheme();
  const router = useRouter();

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [balances, setBalances] = useState<Map<string, number>>(new Map());
  const [categories, setCategories] = useState<Category[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [transactions, setTransactions] = useState<TransactionListItem[]>([]);

  const [filter, setFilter] = useState<TransactionFilter>({});
  const [search, setSearch] = useState('');
  const [filterOpen, setFilterOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [peekItem, setPeekItem] = useState<TransactionListItem | null>(null);
  const { refresh: refreshPendingCount } = usePendingCount();

  // One definition of "what is being listed", shared by the list and the export.
  const activeFilter: TransactionFilter = useMemo(() => ({ ...filter, search }), [filter, search]);
  const filterKey = JSON.stringify(activeFilter);

  const loadReference = useCallback(() => {
    Promise.all([
      listAccounts(),
      listAccountBalancesMinor(),
      listCategories('expense'),
      listCategories('income'),
      listPeople(),
    ])
      .then(([acc, bal, expenseCats, incomeCats, ppl]) => {
        setAccounts(acc);
        setBalances(bal);
        setCategories([...expenseCats, ...incomeCats]);
        setPeople(ppl);
      })
      .catch((e) => Alert.alert('Database error', String(e)));
  }, []);

  const loadTransactions = useCallback(() => {
    listTransactionItems({ ...(JSON.parse(filterKey) as TransactionFilter), limit: LIST_LIMIT })
      .then(setTransactions)
      .catch((e) => Alert.alert('Database error', String(e)));
  }, [filterKey]);

  // Accounts/balances refresh on focus; the list also re-runs on filter change.
  useFocusEffect(
    useCallback(() => {
      loadReference();
      loadTransactions();
    }, [loadReference, loadTransactions]),
  );
  useEffect(loadTransactions, [loadTransactions]);

  const selectedAccount = accounts.find((a) => a.id === filter.accountId) ?? null;
  const filtersActive = hasActiveTransactionFilter(filter);

  const setAccountFilter = (accountId: string | null) => {
    hapticTick();
    setFilter((f) => ({ ...f, accountId: f.accountId === accountId ? null : accountId }));
  };

  const onRefresh = async () => {
    hapticTick();
    setRefreshing(true);
    loadReference();
    loadTransactions();
    setRefreshing(false);
  };

  /** Swipe-committed status change on a pending row. */
  const onSwipeStatus = (item: TransactionListItem, status: 'approved' | 'rejected') => {
    setTransactionStatus(item.tx.id, status)
      .then(() => {
        if (status === 'approved') hapticSuccess();
        else hapticError();
        refreshPendingCount();
        loadReference();
        loadTransactions();
      })
      .catch((e) => Alert.alert('Could not update', String(e)));
  };

  /** Deleting is not undoable, so it always asks — a swipe is easy to do by accident. */
  const onSwipeDelete = (item: TransactionListItem) => {
    Alert.alert('Delete transaction?', `"${item.tx.name}" will be removed permanently.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () =>
          deleteTransaction(item.tx.id)
            .then(() => {
              hapticError();
              refreshPendingCount();
              loadReference();
              loadTransactions();
            })
            .catch((e) => Alert.alert('Could not delete', String(e))),
      },
    ]);
  };

  /**
   * Export exactly what the ledger is showing — no filter means everything.
   * Runs its own unlimited query so a long history isn't truncated to the
   * page the list renders.
   */
  const onExport = async () => {
    if (exporting) return;
    hapticPress();
    setExporting(true);
    try {
      const rows = await listTransactionItems(activeFilter);
      // The iOS share sheet is its own confirmation — no success alert needed.
      await shareTransactionsCsv(rows, filter.accountId ?? undefined);
      hapticSuccess();
    } catch (e) {
      hapticError();
      Alert.alert('Export failed', e instanceof Error ? e.message : String(e));
    } finally {
      setExporting(false);
    }
  };

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
      netMinor: data.reduce(
        (sum, i) => sum + accountDeltaMinor(i.tx, filter.accountId ?? undefined),
        0,
      ),
      data,
    }));
  }, [transactions, filter.accountId]);

  const header = (
    <View style={styles.headerBlock}>
      <View style={styles.titleRow}>
        <Text style={[type.h1, styles.title, { color: colors.text }]}>Accounts</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            filtersActive || search
              ? 'Export the filtered transactions as CSV'
              : 'Export all transactions as CSV'
          }
          accessibilityState={{ busy: exporting }}
          onPress={onExport}
          style={({ pressed }) => [
            styles.headerButton,
            { backgroundColor: colors.surface, borderColor: colors.border },
            pressed && styles.pressed,
          ]}>
          {exporting ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : (
            <Feather name="share" size={18} color={colors.primary} />
          )}
        </Pressable>
      </View>

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
              selected={item.id === filter.accountId}
              onPress={() => setAccountFilter(item.id)}
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
            accessibilityLabel={`Clear the ${selectedAccount.name} filter`}
            onPress={() => setAccountFilter(null)}
            style={[styles.chip, { backgroundColor: colors.primarySoft }]}>
            <Text style={[type.caption, { color: colors.primary }]}>{selectedAccount.name}</Text>
            <Feather name="x" size={12} color={colors.primary} />
          </Pressable>
        ) : null}
      </View>
    </View>
  );

  return (
    <SafeAreaView
      // No 'bottom': inside the tab navigator the tab bar already owns the
      // home-indicator inset. Applying it here too clips the scroll content
      // and leaves a dead strip above the tab bar.
      edges={['top', 'left', 'right']}
      style={[styles.safeArea, { backgroundColor: colors.bg }]}>
      <ScreenFade>
        <SectionList
        sections={sections}
        keyExtractor={(item) => item.tx.id}
        contentContainerStyle={styles.list}
        stickySectionHeadersEnabled={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
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
        renderItem={({ item }) => {
          const pending = item.tx.status === 'pending';
          return (
            // NOTE: do NOT wrap these rows in a Reanimated layout animation.
            // `LinearTransition` on the items of a virtualized list (SectionList
            // / FlatList) makes rows measure to zero and never appear — the data
            // is there, the row just never draws. That is what hid approved
            // transactions here while Home's plain .map() list kept showing them.
            <SwipeableRow
                // Pending rows can be triaged in place; anything else can only
                // be deleted, which still asks first.
                left={
                  pending
                    ? {
                        icon: 'check',
                        label: 'Approve',
                        color: colors.positiveFill,
                        onTrigger: () => onSwipeStatus(item, 'approved'),
                      }
                    : undefined
                }
                right={
                  pending
                    ? {
                        icon: 'x',
                        label: 'Reject',
                        color: colors.warning,
                        onTrigger: () => onSwipeStatus(item, 'rejected'),
                      }
                    : {
                        icon: 'trash-2',
                        label: 'Delete',
                        color: colors.danger,
                        onTrigger: () => onSwipeDelete(item),
                      }
                }>
                <PressableScale
                  accessibilityRole="button"
                  accessibilityHint="Long press for a quick preview"
                  scaleTo={motion.pressScale.card}
                  onPress={() =>
                    router.push({ pathname: '/transaction/detail/[id]', params: { id: item.tx.id } })
                  }
                  onLongPress={() => {
                    hapticPress();
                    setPeekItem(item);
                  }}>
                  <TransactionRow item={item} />
                </PressableScale>
            </SwipeableRow>
          );
        }}
        ListEmptyComponent={
          accounts.length > 0 ? (
            <Text style={[type.caption, styles.emptyText, { color: colors.textSubtle }]}>
              {search || filtersActive ? 'No matching transactions.' : 'No transactions yet.'}
            </Text>
          ) : null
          }
        />
      </ScreenFade>

      {/* Floating ledger controls. KeyboardAvoidingView measures its own frame,
          so it lifts the bar by exactly the keyboard's overlap — which also
          accounts for the tab bar sitting below this screen. */}
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        pointerEvents="box-none"
        style={styles.floatingLayer}>
        <View pointerEvents="box-none" style={styles.floatingStack}>
          <Fab
            icon="plus"
            accessibilityLabel="Add account"
            size={layout.accounts.buttonSize}
            onPress={() => router.push('/account/new')}
          />

          <View pointerEvents="box-none" style={styles.barRow}>
            <View
              style={[
                styles.searchBox,
                { backgroundColor: colors.surface, borderColor: colors.border },
                !isDark && shadow,
              ]}>
              <Feather name="search" size={18} color={colors.textSubtle} />
              <TextInput
                value={search}
                onChangeText={setSearch}
                placeholder="Search transactions"
                placeholderTextColor={colors.textSubtle}
                autoCapitalize="none"
                returnKeyType="search"
                style={[styles.searchInput, { color: colors.text }]}
              />
              {search.length > 0 ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Clear search"
                  onPress={() => setSearch('')}
                  hitSlop={space.sm}>
                  <Feather name="x" size={18} color={colors.textSubtle} />
                </Pressable>
              ) : null}
            </View>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Filter transactions"
              onPress={() => {
                hapticTick();
                setFilterOpen(true);
              }}
              style={({ pressed }) => [
                styles.filterButton,
                { backgroundColor: colors.surface, borderColor: colors.border },
                !isDark && shadow,
                pressed && styles.pressed,
              ]}>
              <Feather name="filter" size={20} color={colors.primary} />
              {filtersActive ? (
                <View
                  style={[
                    styles.filterDot,
                    { backgroundColor: colors.warning, borderColor: colors.surface },
                  ]}
                />
              ) : null}
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>

      <TransactionPeek
        item={peekItem}
        onClose={() => setPeekItem(null)}
        onOpenDetail={(id) => {
          setPeekItem(null);
          router.push({ pathname: '/transaction/detail/[id]', params: { id } });
        }}
      />

      <TransactionFilterSheet
        visible={filterOpen}
        value={filter}
        accounts={accounts}
        categories={categories}
        people={people}
        onClose={() => setFilterOpen(false)}
        onApply={(next) => {
          setFilter(next);
          setFilterOpen(false);
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  list: {
    paddingHorizontal: screenPaddingH,
    paddingBottom: bottomClearance.accounts,
    gap: space.sm,
  },
  headerBlock: {
    gap: space.md,
    paddingTop: space.md,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
  },
  title: { flex: 1 },
  headerButton: {
    width: minTouchTarget,
    height: minTouchTarget,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.7 },
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
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    borderRadius: radius.pill,
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
  },
  empty: {
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.xl,
  },
  emptyText: { textAlign: 'center', paddingTop: space.lg },

  floatingLayer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
  },
  floatingStack: {
    paddingHorizontal: screenPaddingH,
    paddingBottom: layout.accounts.floatingBottom,
    gap: layout.accounts.stackGap,
    // The add button sits above the filter button, hard right.
    alignItems: 'flex-end',
  },
  barRow: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'stretch',
    gap: space.sm,
  },
  searchBox: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    height: layout.accounts.barHeight,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.pill,
    paddingHorizontal: space.lg,
  },
  // iOS reliably centres a single-line TextInput only when it has an explicit
  // height and no vertical padding — with padding-based sizing the glyphs sit
  // toward the top of the line box and read as un-centred against the search
  // icon. Fill the row's height and let iOS centre the line.
  searchInput: {
    flex: 1,
    height: layout.accounts.barHeight,
    paddingVertical: 0,
    fontFamily: fontFamily.body,
    fontSize: 15,
    includeFontPadding: false,
  },
  filterButton: {
    width: layout.accounts.buttonSize,
    height: layout.accounts.buttonSize,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterDot: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 2,
  },
});
