/**
 * Categories management (spec §8.8) — the two separate lists (expense /
 * income) as sections. Tap a category to edit; + Add per section.
 */
import { Feather } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import type { ComponentProps } from 'react';
import { useCallback, useState } from 'react';
import { Alert, Pressable, SectionList, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { listCategories } from '@/db/queries/categories';
import type { Category, CategoryKind } from '@/domain/types';
import { useTheme } from '@/theme/ThemeContext';
import { minTouchTarget, radius, screenPaddingH, space, type } from '@/theme/tokens';

interface Section {
  kind: CategoryKind;
  title: string;
  data: Category[];
}

export default function CategoriesScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const [sections, setSections] = useState<Section[]>([]);

  useFocusEffect(
    useCallback(() => {
      Promise.all([listCategories('expense'), listCategories('income')])
        .then(([expense, income]) =>
          setSections([
            { kind: 'expense', title: 'Expense categories', data: expense },
            { kind: 'income', title: 'Income categories', data: income },
          ]),
        )
        .catch((e) => Alert.alert('Database error', String(e)));
    }, []),
  );

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.bg }]}>
      <Text style={[type.h1, styles.title, { color: colors.text }]}>Categories</Text>
      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        stickySectionHeadersEnabled={false}
        renderSectionHeader={({ section }) => (
          <View style={styles.sectionHeader}>
            <Text style={[type.h2, { color: colors.text }]}>{section.title}</Text>
            <Pressable
              accessibilityRole="button"
              onPress={() =>
                router.push({ pathname: '/category/new', params: { kind: section.kind } })
              }
              style={styles.sectionAdd}>
              <Text style={[type.label, { color: colors.primary }]}>+ Add</Text>
            </Pressable>
          </View>
        )}
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push({ pathname: '/category/[id]', params: { id: item.id } })}
            style={({ pressed }) => [
              styles.row,
              { backgroundColor: pressed ? colors.surfaceAlt : colors.surface },
            ]}>
            <View style={[styles.iconBox, { backgroundColor: `${item.color ?? colors.primary}22` }]}>
              <Feather
                name={(item.icon as ComponentProps<typeof Feather>['name']) ?? 'circle'}
                size={16}
                color={item.color ?? colors.primary}
              />
            </View>
            <Text style={[type.body, styles.rowLabel, { color: colors.text }]}>{item.name}</Text>
            {item.isDefault ? (
              <Text style={[type.caption, { color: colors.textSubtle }]}>default</Text>
            ) : null}
          </Pressable>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  title: {
    paddingHorizontal: screenPaddingH,
    paddingVertical: space.md,
  },
  list: {
    paddingHorizontal: screenPaddingH,
    paddingBottom: space.xxl,
    gap: space.sm,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: space.lg,
    marginBottom: space.xs,
  },
  sectionAdd: {
    minHeight: minTouchTarget - space.md,
    justifyContent: 'center',
    paddingHorizontal: space.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.md,
    borderRadius: radius.md,
    minHeight: minTouchTarget,
  },
  iconBox: {
    width: 32,
    height: 32,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowLabel: { flex: 1 },
});
