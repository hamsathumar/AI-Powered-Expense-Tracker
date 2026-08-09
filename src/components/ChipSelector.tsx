/**
 * Wrapping chip selector (design-system.md §5.4) — used for accounts,
 * categories, and people. Shows all options at a glance; selected chip gets
 * a primarySoft background with a primary border. Optional trailing "+ Add".
 */
import { Feather } from '@expo/vector-icons';
import type { ComponentProps } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useTheme } from '@/theme/ThemeContext';
import { minTouchTarget, radius, space, type } from '@/theme/tokens';

export interface ChipItem {
  id: string;
  label: string;
  icon?: ComponentProps<typeof Feather>['name'];
  color?: string;
}

interface Props {
  label: string;
  items: ChipItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onAddNew?: () => void;
  emptyHint?: string;
}

export function ChipSelector({ label, items, selectedId, onSelect, onAddNew, emptyHint }: Props) {
  const { colors } = useTheme();

  return (
    <View style={styles.container}>
      <Text style={[type.label, { color: colors.textMuted }]}>{label}</Text>
      {items.length === 0 && emptyHint ? (
        <Text style={[type.caption, { color: colors.textSubtle }]}>{emptyHint}</Text>
      ) : null}
      <View style={styles.row}>
        {items.map((item) => {
          const selected = item.id === selectedId;
          return (
            <Pressable
              key={item.id}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              onPress={() => onSelect(item.id)}
              style={[
                styles.chip,
                {
                  backgroundColor: selected ? colors.primarySoft : colors.surface,
                  borderColor: selected ? colors.primary : colors.border,
                },
              ]}>
              {item.icon ? (
                <Feather
                  name={item.icon}
                  size={14}
                  color={item.color ?? (selected ? colors.primary : colors.textMuted)}
                />
              ) : null}
              <Text style={[type.label, { color: selected ? colors.primary : colors.text }]}>
                {item.label}
              </Text>
            </Pressable>
          );
        })}
        {onAddNew ? (
          <Pressable
            accessibilityRole="button"
            onPress={onAddNew}
            style={[styles.chip, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Feather name="plus" size={14} color={colors.textMuted} />
            <Text style={[type.label, { color: colors.textMuted }]}>Add</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: space.sm,
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.sm,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    minHeight: Math.max(36, minTouchTarget - space.sm),
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
});
