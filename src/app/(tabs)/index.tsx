/**
 * Home — for now: recent transactions + the entry point to the manual form.
 * The balance hero card and summary arrive in Stage 5.
 */
import { Feather } from '@expo/vector-icons';
import { Link, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, FlatList, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { TransactionRow } from '@/components/TransactionRow';
import {
  listRecentTransactionItems,
  type TransactionListItem,
} from '@/db/queries/transactions';
import { useTheme } from '@/theme/ThemeContext';
import { minTouchTarget, radius, screenPaddingH, space, type } from '@/theme/tokens';

export default function HomeScreen() {
  const { colors } = useTheme();
  const [items, setItems] = useState<TransactionListItem[]>([]);

  // Refetch whenever the screen regains focus (e.g. returning from the form).
  useFocusEffect(
    useCallback(() => {
      listRecentTransactionItems(30)
        .then(setItems)
        .catch((e) => Alert.alert('Database error', String(e)));
    }, []),
  );

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.bg }]}>
      <View style={styles.header}>
        <Text style={[type.h1, { color: colors.text }]}>Kaasu</Text>
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

      <FlatList
        data={items}
        keyExtractor={(item) => item.tx.id}
        renderItem={({ item }) => <TransactionRow item={item} />}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          items.length > 0 ? (
            <Text style={[type.h2, styles.listTitle, { color: colors.text }]}>Recent</Text>
          ) : null
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
  listTitle: { marginBottom: space.sm },
  empty: {
    alignItems: 'center',
    gap: space.md,
    paddingTop: space.xxl * 2,
  },
  emptyText: { textAlign: 'center' },
});
