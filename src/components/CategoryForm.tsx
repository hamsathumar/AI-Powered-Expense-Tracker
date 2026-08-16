/**
 * Shared create/edit form for categories (spec §8.8). Icon options are a
 * curated Feather subset; colours come from the fixed category palette
 * (design-system.md §2.6) so custom categories never clash with semantic
 * colours.
 */
import { Feather } from '@expo/vector-icons';
import type { ComponentProps } from 'react';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import type { Category } from '@/domain/types';
import { useTheme } from '@/theme/ThemeContext';
import {
  categoryPalette,
  minTouchTarget,
  radius,
  screenPaddingH,
  space,
  type,
} from '@/theme/tokens';

type FeatherName = ComponentProps<typeof Feather>['name'];

const ICON_OPTIONS: FeatherName[] = [
  'coffee', 'shopping-cart', 'navigation', 'home', 'zap', 'heart',
  'shopping-bag', 'film', 'book', 'gift', 'user', 'briefcase',
  'trending-up', 'pen-tool', 'percent', 'rotate-ccw', 'music', 'globe',
  'phone', 'truck', 'scissors', 'more-horizontal',
];

export interface CategoryFormValues {
  name: string;
  icon: string;
  color: string;
}

interface Props {
  title: string;
  initial?: Category;
  onSubmit: (values: CategoryFormValues) => Promise<void>;
  onArchive?: () => Promise<void>;
}

export function CategoryForm({ title, initial, onSubmit, onArchive }: Props) {
  const { colors } = useTheme();
  const [name, setName] = useState(initial?.name ?? '');
  const [icon, setIcon] = useState<FeatherName>((initial?.icon as FeatherName) ?? 'coffee');
  const [color, setColor] = useState<string>(initial?.color ?? categoryPalette[0]);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!name.trim()) {
      Alert.alert('Not quite', 'Give the category a name.');
      return;
    }
    setBusy(true);
    try {
      await onSubmit({ name: name.trim(), icon, color });
    } catch (e) {
      Alert.alert('Save failed', String(e));
      setBusy(false);
    }
  };

  const confirmArchive = () => {
    Alert.alert(
      'Archive category?',
      'It disappears from pickers but existing transactions keep it.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Archive', style: 'destructive', onPress: () => void onArchive?.() },
      ],
    );
  };

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled"
      style={{ backgroundColor: colors.bg }}>
      <Text style={[type.h1, { color: colors.text }]}>{title}</Text>

      <View style={styles.fieldGroup}>
        <Text style={[type.label, { color: colors.textMuted }]}>Name</Text>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="e.g. Streaming"
          placeholderTextColor={colors.textSubtle}
          style={[
            type.input,
            styles.textField,
            { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text },
          ]}
        />
      </View>

      <View style={styles.fieldGroup}>
        <Text style={[type.label, { color: colors.textMuted }]}>Icon</Text>
        <View style={styles.grid}>
          {ICON_OPTIONS.map((option) => {
            const selected = option === icon;
            return (
              <Pressable
                key={option}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                onPress={() => setIcon(option)}
                style={[
                  styles.cell,
                  {
                    backgroundColor: selected ? colors.primarySoft : colors.surface,
                    borderColor: selected ? colors.primary : colors.border,
                  },
                ]}>
                <Feather name={option} size={18} color={selected ? colors.primary : colors.textMuted} />
              </Pressable>
            );
          })}
        </View>
      </View>

      <View style={styles.fieldGroup}>
        <Text style={[type.label, { color: colors.textMuted }]}>Colour</Text>
        <View style={styles.grid}>
          {categoryPalette.map((swatch) => {
            const selected = swatch === color;
            return (
              <Pressable
                key={swatch}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                onPress={() => setColor(swatch)}
                style={[
                  styles.cell,
                  { backgroundColor: swatch, borderColor: selected ? colors.text : 'transparent' },
                ]}>
                {selected ? <Feather name="check" size={16} color="#FFFFFF" /> : null}
              </Pressable>
            );
          })}
        </View>
      </View>

      <Pressable
        accessibilityRole="button"
        disabled={busy}
        onPress={save}
        style={({ pressed }) => [
          styles.saveButton,
          { backgroundColor: pressed ? colors.primaryPress : colors.primary },
          busy && styles.disabled,
        ]}>
        <Text style={[type.h2, { color: colors.onPrimary }]}>{busy ? 'Saving…' : 'Save'}</Text>
      </Pressable>

      {onArchive ? (
        <Pressable accessibilityRole="button" onPress={confirmArchive} style={styles.archiveButton}>
          <Text style={[type.label, { color: colors.danger }]}>Archive category</Text>
        </Pressable>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: screenPaddingH,
    paddingVertical: space.lg,
    gap: space.xl,
  },
  fieldGroup: { gap: space.sm },
  textField: {
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.sm,
  },
  cell: {
    width: minTouchTarget,
    height: minTouchTarget,
    borderRadius: radius.md,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveButton: {
    minHeight: minTouchTarget + space.sm,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  archiveButton: {
    minHeight: minTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabled: { opacity: 0.6 },
});
