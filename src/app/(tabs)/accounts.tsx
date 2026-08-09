/**
 * Accounts tab (spec §8.7): every non-archived account with its computed
 * balance (approved transactions only — §4.2 math in SQL). Tap to edit;
 * + Add to create.
 */
import { Feather } from '@expo/vector-icons';
import { Link, useFocusEffect, useRouter } from 'expo-router';
import type { ComponentProps } from 'react';
import { useCallback, useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Amount } from '@/components/Amount';
import { listAccountBalancesMinor, listAccounts } from '@/db/queries/accounts';
import type { Account, AccountType } from '@/domain/types';
import { useTheme } from '@/theme/ThemeContext';
import { minTouchTarget, radius, screenPaddingH, space, type } from '@/theme/tokens';

const TYPE_META: Record<AccountType, { label: string; icon: ComponentProps<typeof Feather>['name'] }> = {
  bank: { label: 'Bank', icon: 'briefcase' },
  card: { label: 'Card', icon: 'credit-card' },
  cash: { label: 'Cash', icon: 'dollar-sign' },
};

export default function AccountsScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [balances, setBalances] = useState<Map<string, number>>(new Map());

  useFocusEffect(
    useCallback(() => {
      Promise.all([listAccounts(), listAccountBalancesMinor()])
        .then(([acc, bal]) => {
          setAccounts(acc);
          setBalances(bal);
        })
        .catch((e) => Alert.alert('Database error', String(e)));
    }, []),
  );

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.bg }]}>
      <View style={styles.header}>
        <Text style={[type.h1, { color: colors.text }]}>Accounts</Text>
        <Link
          href="/account/new"
          accessibilityRole="button"
          style={[
            type.label,
            styles.addButton,
            { backgroundColor: colors.primary, color: colors.onPrimary },
          ]}>
          + Add
        </Link>
      </View>

      <FlatList
        data={accounts}
        keyExtractor={(a) => a.id}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push({ pathname: '/account/[id]', params: { id: item.id } })}
            style={({ pressed }) => [
              styles.row,
              { backgroundColor: pressed ? colors.surfaceAlt : colors.surface },
            ]}>
            <View style={[styles.iconBox, { backgroundColor: colors.primarySoft }]}>
              <Feather name={TYPE_META[item.type].icon} size={18} color={colors.primary} />
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
          </Pressable>
        )}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Feather name="briefcase" size={28} color={colors.textSubtle} />
            <Text style={[type.body, styles.emptyText, { color: colors.textMuted }]}>
              No accounts yet — add your bank, card, or cash wallet.
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
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.md,
    borderRadius: radius.md,
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
  empty: {
    alignItems: 'center',
    gap: space.md,
    paddingTop: space.xxl * 2,
  },
  emptyText: { textAlign: 'center' },
});
