/**
 * Wrapping chip selector (design-system.md §5.4) — used for accounts,
 * categories, and people. Shows all options at a glance; selected chip gets
 * a primarySoft background with a primary border. Optional trailing "+ Add".
 *
 * Selection cross-fades over 150ms (§7) instead of snapping, and ticks. Each
 * chip is its own component so it can own the animation hook — a hook can't
 * live inside the map.
 */
import { Feather } from '@expo/vector-icons';
import type { ComponentProps } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  interpolateColor,
  useAnimatedStyle,
  useDerivedValue,
  withTiming,
} from 'react-native-reanimated';

import { hapticTick } from '@/lib/haptics';
import { useReduceMotion } from '@/theme/FeedbackContext';
import { useTheme } from '@/theme/ThemeContext';
import { layout, minTouchTarget, motion, radius, space, type } from '@/theme/tokens';

export interface ChipItem {
  id: string;
  label: string;
  icon?: ComponentProps<typeof Feather>['name'];
  color?: string;
}

interface Props {
  label?: string;
  items: ChipItem[];
  selectedId?: string | null;
  /** Multi-select mode: pass the selected set instead of selectedId. */
  selectedIds?: string[];
  onSelect: (id: string) => void;
  onAddNew?: () => void;
  emptyHint?: string;
}

function Chip({
  item,
  selected,
  onPress,
}: {
  item: ChipItem;
  selected: boolean;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  const reduceMotion = useReduceMotion();

  const progress = useDerivedValue(() => {
    const target = selected ? 1 : 0;
    return reduceMotion ? target : withTiming(target, { duration: motion.select });
  }, [selected, reduceMotion]);

  const animatedStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(progress.value, [0, 1], [colors.surface, colors.primarySoft]),
    borderColor: interpolateColor(progress.value, [0, 1], [colors.border, colors.primary]),
  }));

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={() => {
        hapticTick();
        onPress();
      }}>
      <Animated.View style={[styles.chip, animatedStyle]}>
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
      </Animated.View>
    </Pressable>
  );
}

export function ChipSelector({
  label,
  items,
  selectedId,
  selectedIds,
  onSelect,
  onAddNew,
  emptyHint,
}: Props) {
  const { colors } = useTheme();
  const isSelected = (id: string) => (selectedIds ? selectedIds.includes(id) : id === selectedId);

  return (
    <View style={styles.container}>
      {label ? <Text style={[type.label, { color: colors.textMuted }]}>{label}</Text> : null}
      {items.length === 0 && emptyHint ? (
        <Text style={[type.caption, { color: colors.textSubtle }]}>{emptyHint}</Text>
      ) : null}
      <View style={styles.row}>
        {items.map((item) => (
          <Chip
            key={item.id}
            item={item}
            selected={isSelected(item.id)}
            onPress={() => onSelect(item.id)}
          />
        ))}
        {onAddNew ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              hapticTick();
              onAddNew();
            }}
            style={[styles.chip, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Feather name="plus" size={14} color={colors.primary} />
            <Text style={[type.label, { color: colors.primary }]}>Add</Text>
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
    paddingVertical: layout.chipPaddingV,
    paddingHorizontal: layout.chipPaddingH,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
});
