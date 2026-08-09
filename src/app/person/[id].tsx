/**
 * Person detail (spec §3.3): worded net balance, full history involving
 * them, Settle Up. The Settle Up prefill uses the APPROVED-only balance;
 * when pending lending rows exist, a hint says they're not included
 * (decision P8, spec §3.5).
 */
import { Feather } from '@expo/vector-icons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { describeNet, initials } from '@/components/PersonRow';
import { TransactionRow } from '@/components/TransactionRow';
import {
  getPerson,
  getPersonNetBalanceMinor,
  hasPendingLending,
  renamePerson,
} from '@/db/queries/people';
import {
  listTransactionItemsForPerson,
  type TransactionListItem,
} from '@/db/queries/transactions';
import type { Person } from '@/domain/types';
import { useTheme } from '@/theme/ThemeContext';
import { minTouchTarget, radius, screenPaddingH, space, type } from '@/theme/tokens';

export default function PersonDetailScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [person, setPerson] = useState<Person | null>(null);
  const [netMinor, setNetMinor] = useState(0);
  const [pendingCount, setPendingCount] = useState(0);
  const [history, setHistory] = useState<TransactionListItem[]>([]);

  const reload = useCallback(() => {
    Promise.all([
      getPerson(id),
      getPersonNetBalanceMinor(id),
      hasPendingLending(id),
      listTransactionItemsForPerson(id),
    ])
      .then(([p, net, pending, items]) => {
        if (!p) throw new Error('Person not found');
        setPerson(p);
        setNetMinor(net);
        setPendingCount(pending);
        setHistory(items);
      })
      .catch((e) => {
        Alert.alert('Error', String(e));
        router.back();
      });
  }, [id, router]);

  useFocusEffect(reload);

  const rename = () => {
    if (!person) return;
    Alert.prompt('Rename person', undefined, async (text) => {
      const trimmed = text?.trim();
      if (!trimmed) return;
      await renamePerson(person.id, trimmed);
      reload();
    }, undefined, person.name);
  };

  if (!person) return <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.bg }]} />;

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.bg }]}>
      <FlatList
        data={history}
        keyExtractor={(item) => item.tx.id}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => <TransactionRow item={item} />}
        ListHeaderComponent={
          <View style={styles.header}>
            <View style={styles.identityRow}>
              <View style={[styles.avatar, { backgroundColor: colors.primarySoft }]}>
                <Text style={[type.h2, { color: colors.primary }]}>{initials(person.name)}</Text>
              </View>
              <View style={styles.identityText}>
                <Text numberOfLines={1} style={[type.h1, { color: colors.text }]}>
                  {person.name}
                </Text>
                <Text
                  style={[
                    type.h2,
                    { color: netMinor === 0 ? colors.textMuted : colors.lending },
                  ]}>
                  {describeNet(netMinor)}
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Rename"
                onPress={rename}
                style={styles.renameButton}>
                <Feather name="edit-2" size={18} color={colors.textMuted} />
              </Pressable>
            </View>

            {pendingCount > 0 ? (
              <View style={[styles.hint, { backgroundColor: colors.surfaceAlt }]}>
                <Feather name="alert-circle" size={14} color={colors.warning} />
                <Text style={[type.caption, styles.hintText, { color: colors.textMuted }]}>
                  {pendingCount} pending lending item{pendingCount === 1 ? '' : 's'} not included
                  in this balance — approve them first if they should count.
                </Text>
              </View>
            ) : null}

            {netMinor !== 0 ? (
              <Pressable
                accessibilityRole="button"
                onPress={() =>
                  router.push({ pathname: '/settle-up', params: { personId: person.id } })
                }
                style={({ pressed }) => [
                  styles.settleButton,
                  { backgroundColor: pressed ? colors.primaryPress : colors.primary },
                ]}>
                <Text style={[type.h2, { color: colors.onPrimary }]}>Settle up</Text>
              </Pressable>
            ) : null}

            {history.length > 0 ? (
              <Text style={[type.h2, { color: colors.text }]}>History</Text>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          <Text style={[type.body, styles.emptyText, { color: colors.textMuted }]}>
            No transactions with {person.name} yet.
          </Text>
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  list: {
    paddingHorizontal: screenPaddingH,
    paddingVertical: space.md,
    paddingBottom: space.xxl,
    gap: space.sm,
  },
  header: { gap: space.lg, marginBottom: space.sm },
  identityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
  },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  identityText: { flex: 1, gap: 2 },
  renameButton: {
    minWidth: minTouchTarget,
    minHeight: minTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    borderRadius: radius.md,
    padding: space.md,
  },
  hintText: { flex: 1 },
  settleButton: {
    minHeight: minTouchTarget + space.sm,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    textAlign: 'center',
    paddingTop: space.xl,
  },
});
