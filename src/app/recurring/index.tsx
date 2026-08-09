/**
 * Recurring templates (spec §5, §8.10): list with pause/resume; tap to
 * edit. Due occurrences are generated on app foreground and land in the
 * Queue as pending.
 */
import { Feather } from '@expo/vector-icons';
import { format, parseISO } from 'date-fns';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Amount } from '@/components/Amount';
import { listTemplates, setTemplateActive } from '@/db/queries/recurring';
import type { RecurringTemplate } from '@/domain/types';
import { useTheme } from '@/theme/ThemeContext';
import { minTouchTarget, radius, screenPaddingH, space, type } from '@/theme/tokens';

function frequencyLabel(t: RecurringTemplate): string {
  switch (t.frequency) {
    case 'daily':
      return 'Daily';
    case 'weekly':
      return 'Weekly';
    case 'monthly':
      return 'Monthly';
    case 'custom':
      return `Every ${t.intervalDays} days`;
  }
}

export default function RecurringScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const [templates, setTemplates] = useState<RecurringTemplate[]>([]);

  const reload = useCallback(() => {
    listTemplates()
      .then(setTemplates)
      .catch((e) => Alert.alert('Database error', String(e)));
  }, []);

  useFocusEffect(reload);

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.bg }]}>
      <View style={styles.header}>
        <Text style={[type.h1, { color: colors.text }]}>Recurring</Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push('/recurring/new')}
          style={[styles.addButton, { backgroundColor: colors.primary }]}>
          <Text style={[type.label, { color: colors.onPrimary }]}>+ Add</Text>
        </Pressable>
      </View>

      <FlatList
        data={templates}
        keyExtractor={(t) => t.id}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push({ pathname: '/recurring/[id]', params: { id: item.id } })}
            style={({ pressed }) => [
              styles.row,
              { backgroundColor: pressed ? colors.surfaceAlt : colors.surface },
              !item.active && styles.dimmed,
            ]}>
            <View style={styles.middle}>
              <Text numberOfLines={1} style={[type.body, { color: colors.text }]}>
                {item.name}
              </Text>
              <Text style={[type.caption, { color: colors.textMuted }]}>
                {frequencyLabel(item)} · next {format(parseISO(item.nextDueDate), 'd MMM')}
                {item.endDate ? ` · ends ${format(parseISO(item.endDate), 'd MMM yyyy')}` : ''}
                {item.active ? '' : ' · paused'}
              </Text>
            </View>
            <Amount valueMinor={item.amountMinor} txType={item.type} />
            <Switch
              value={item.active}
              onValueChange={(active) => setTemplateActive(item.id, active).then(reload)}
              trackColor={{ true: colors.primary }}
            />
          </Pressable>
        )}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Feather name="repeat" size={28} color={colors.textSubtle} />
            <Text style={[type.body, styles.emptyText, { color: colors.textMuted }]}>
              No recurring templates — add rent, salary, or subscriptions once and let them queue
              themselves.
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
    justifyContent: 'center',
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
  middle: { flex: 1, gap: 2 },
  dimmed: { opacity: 0.55 },
  empty: {
    alignItems: 'center',
    gap: space.md,
    paddingTop: space.xxl * 2,
  },
  emptyText: { textAlign: 'center' },
});
