/**
 * Full payment history for one recurring template ("See all" from the detail
 * screen). Same date + amount + "Price rose" rows, uncapped and newest first.
 */
import { Feather } from '@expo/vector-icons';
import { format, parseISO } from 'date-fns';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Amount } from '@/components/Amount';
import {
  getTemplateItem,
  listPaymentsForRecurring,
  type RecurringPayment,
} from '@/db/queries/recurring';
import { useTheme } from '@/theme/ThemeContext';
import { radius, screenPaddingH, space, type } from '@/theme/tokens';

export default function RecurringPaymentsScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [name, setName] = useState('');
  const [payments, setPayments] = useState<RecurringPayment[]>([]);

  const reload = useCallback(() => {
    Promise.all([getTemplateItem(id), listPaymentsForRecurring(id)])
      .then(([item, pays]) => {
        setName(item?.template.name ?? 'Payments');
        setPayments(pays);
      })
      .catch((e) => Alert.alert('Error', String(e)));
  }, [id]);

  useFocusEffect(reload);

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg }]} edges={['top']}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back" hitSlop={12} onPress={() => router.back()}>
          <Feather name="chevron-left" size={26} color={colors.text} />
        </Pressable>
        <Text numberOfLines={1} style={[type.h2, styles.title, { color: colors.text }]}>
          {name}
        </Text>
        <View style={styles.spacer} />
      </View>

      <FlatList
        data={payments}
        keyExtractor={(p) => p.id}
        contentContainerStyle={styles.list}
        renderItem={({ item, index }) => {
          const older = payments[index + 1];
          const priceRose = older ? item.amountMinor > older.amountMinor : false;
          return (
            <View style={[styles.row, { backgroundColor: colors.surface }]}>
              <Text style={[type.body, { color: colors.text }]}>
                {format(parseISO(item.occurredAt), 'd MMM yyyy')}
              </Text>
              {priceRose ? (
                <View style={[styles.tag, { backgroundColor: `${colors.warning}22` }]}>
                  <Feather name="arrow-up-right" size={11} color={colors.warning} />
                  <Text style={[type.caption, { color: colors.warning }]}>Price rose</Text>
                </View>
              ) : null}
              <View style={styles.flexEnd}>
                <Amount valueMinor={item.amountMinor} colorOverride={colors.text} />
              </View>
            </View>
          );
        }}
        ListEmptyComponent={
          <Text style={[type.caption, styles.empty, { color: colors.textSubtle }]}>
            No payments recorded yet.
          </Text>
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: screenPaddingH,
    paddingVertical: space.md,
    gap: space.md,
  },
  title: { flex: 1 },
  spacer: { width: 26 },
  list: {
    paddingHorizontal: screenPaddingH,
    paddingBottom: space.xxl,
    gap: space.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    padding: space.md,
    borderRadius: radius.md,
  },
  tag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingVertical: 2,
    paddingHorizontal: space.sm,
    borderRadius: radius.pill,
  },
  flexEnd: { flex: 1, alignItems: 'flex-end' },
  empty: { textAlign: 'center', paddingTop: space.xxl },
});
