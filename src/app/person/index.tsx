/**
 * People list (spec §8.9): everyone with their worded net balance.
 * Tap for detail + Settle Up; + Add to create.
 */
import { Feather } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PersonRow } from '@/components/PersonRow';
import { createPerson, listPeopleWithNetBalances, type PersonWithNet } from '@/db/queries/people';
import { useTheme } from '@/theme/ThemeContext';
import { minTouchTarget, radius, screenPaddingH, space, type } from '@/theme/tokens';

export default function PeopleScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const [people, setPeople] = useState<PersonWithNet[]>([]);

  const reload = useCallback(() => {
    listPeopleWithNetBalances()
      .then(setPeople)
      .catch((e) => Alert.alert('Database error', String(e)));
  }, []);

  useFocusEffect(reload);

  const addPerson = () => {
    Alert.prompt('New person', 'Name', async (text) => {
      const trimmed = text?.trim();
      if (!trimmed) return;
      try {
        await createPerson(trimmed);
      } catch (e) {
        Alert.alert('Could not add person', e instanceof Error ? e.message : String(e));
        return;
      }
      reload();
    });
  };

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.bg }]}>
      <View style={styles.header}>
        <Text style={[type.h1, { color: colors.text }]}>People</Text>
        <Pressable
          accessibilityRole="button"
          onPress={addPerson}
          style={[styles.addButton, { backgroundColor: colors.primary }]}>
          <Text style={[type.label, { color: colors.onPrimary }]}>+ Add</Text>
        </Pressable>
      </View>

      <FlatList
        data={people}
        keyExtractor={(item) => item.person.id}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            onPress={() =>
              router.push({ pathname: '/person/[id]', params: { id: item.person.id } })
            }>
            <PersonRow person={item.person} netMinor={item.netMinor} />
          </Pressable>
        )}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Feather name="users" size={28} color={colors.textSubtle} />
            <Text style={[type.body, styles.emptyText, { color: colors.textMuted }]}>
              No people yet — they appear when you lend, borrow, or add them here.
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
  empty: {
    alignItems: 'center',
    gap: space.md,
    paddingTop: space.xxl * 2,
  },
  emptyText: { textAlign: 'center' },
});
