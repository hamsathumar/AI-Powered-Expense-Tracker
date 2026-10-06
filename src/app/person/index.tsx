/**
 * People list (spec §8.9): everyone with their worded net balance.
 * Tap for detail + Settle Up; + Add to create.
 *
 * Three orders (domain/peopleOrder.ts): Manual — hold a row, then drag it to
 * where it belongs (saved, and used by every person picker); A–Z; and Owed.
 * Only Manual can be rearranged; the choice itself is remembered.
 */
import { Feather } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedRef } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PersonRow } from '@/components/PersonRow';
import { SegmentedControl } from '@/components/SegmentedControl';
import { SortableList } from '@/components/SortableList';
import {
  createPerson,
  listPeopleWithNetBalances,
  savePeopleOrder,
  type PersonWithNet,
} from '@/db/queries/people';
import { getSetting, setSetting, SETTINGS_KEYS } from '@/db/queries/settings';
import {
  DEFAULT_PEOPLE_SORT,
  isPeopleSortMode,
  type PeopleSortMode,
  sortPeople,
} from '@/domain/peopleOrder';
import { useTheme } from '@/theme/ThemeContext';
import { layout, minTouchTarget, radius, screenPaddingH, space, type } from '@/theme/tokens';

const SORT_OPTIONS: { value: PeopleSortMode; label: string }[] = [
  { value: 'manual', label: 'Manual' },
  { value: 'name', label: 'A–Z' },
  { value: 'owed', label: 'Owed' },
];

const keyOf = (item: PersonWithNet) => item.person.id;

export default function PeopleScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const scrollRef = useAnimatedRef<Animated.ScrollView>();
  const [people, setPeople] = useState<PersonWithNet[]>([]);
  const [sortMode, setSortMode] = useState<PeopleSortMode>(DEFAULT_PEOPLE_SORT);
  const [dragging, setDragging] = useState(false);

  const reload = useCallback(() => {
    listPeopleWithNetBalances()
      .then(setPeople)
      .catch((e) => Alert.alert('Database error', String(e)));
  }, []);

  useFocusEffect(reload);

  useEffect(() => {
    getSetting(SETTINGS_KEYS.peopleSort)
      .then((v) => {
        if (isPeopleSortMode(v)) setSortMode(v);
      })
      .catch(() => {});
  }, []);

  const changeSort = (mode: PeopleSortMode) => {
    setSortMode(mode);
    setSetting(SETTINGS_KEYS.peopleSort, mode).catch(() => {});
  };

  const shown = useMemo(() => sortPeople(people, sortMode), [people, sortMode]);

  const onReorder = useCallback(
    (ids: string[]) => {
      // Optimistic: re-number locally so the list doesn't flash back, then save.
      const rank = new Map(ids.map((id, i) => [id, i]));
      setPeople((prev) =>
        prev.map((p) => ({ ...p, person: { ...p.person, sortOrder: rank.get(p.person.id) ?? 0 } })),
      );
      savePeopleOrder(ids).catch((e) => {
        Alert.alert('Could not save the order', String(e));
        reload();
      });
    },
    [reload],
  );

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

  const renderItem = useCallback(
    (item: PersonWithNet) => (
      <Pressable
        accessibilityRole="button"
        accessibilityHint={sortMode === 'manual' ? 'Hold, then drag to reorder' : undefined}
        onPress={() => router.push({ pathname: '/person/[id]', params: { id: item.person.id } })}>
        <PersonRow
          person={item.person}
          netMinor={item.netMinor}
          style={{ height: layout.personRowH }}
        />
      </Pressable>
    ),
    [router, sortMode],
  );

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

      <Animated.ScrollView
        ref={scrollRef}
        scrollEnabled={!dragging}
        contentContainerStyle={styles.list}>
        {people.length === 0 ? (
          <View style={styles.empty}>
            <Feather name="users" size={28} color={colors.textSubtle} />
            <Text style={[type.body, styles.emptyText, { color: colors.textMuted }]}>
              No people yet — they appear when you lend, borrow, or add them here.
            </Text>
          </View>
        ) : (
          <>
            {people.length > 1 ? (
              <View style={styles.sortBlock}>
                <SegmentedControl options={SORT_OPTIONS} value={sortMode} onChange={changeSort} />
                {sortMode === 'manual' ? (
                  <Text style={[type.caption, { color: colors.textMuted }]}>
                    Hold a person, then drag to reorder.
                  </Text>
                ) : null}
              </View>
            ) : null}
            <SortableList
              data={shown}
              keyOf={keyOf}
              renderItem={renderItem}
              rowHeight={layout.personRowH}
              gap={space.sm}
              enabled={sortMode === 'manual'}
              scrollRef={scrollRef}
              onDragActive={setDragging}
              onReorder={onReorder}
            />
          </>
        )}
      </Animated.ScrollView>
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
  },
  sortBlock: { gap: space.sm, marginBottom: space.md },
  empty: {
    alignItems: 'center',
    gap: space.md,
    paddingTop: space.xxl * 2,
  },
  emptyText: { textAlign: 'center' },
});
