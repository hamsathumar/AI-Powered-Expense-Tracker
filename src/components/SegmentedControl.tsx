/**
 * Generic two-plus-segment control (design-system-v2.md §5.15 "How to split").
 * A pill track (`surfaceAlt`) with the selected segment filled `primary` and
 * `onPrimary` label — the same segmented language as the TypeSelector, so the
 * choice reads as one connected control rather than separate pills.
 */
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useTheme } from '@/theme/ThemeContext';
import { minTouchTarget, radius, space, type } from '@/theme/tokens';

interface Props<T extends string> {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}

export function SegmentedControl<T extends string>({ options, value, onChange }: Props<T>) {
  const { colors } = useTheme();
  return (
    <View style={[styles.track, { backgroundColor: colors.surfaceAlt }]}>
      {options.map((opt) => {
        const selected = opt.value === value;
        return (
          <Pressable
            key={opt.value}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            onPress={() => onChange(opt.value)}
            style={[styles.segment, selected && { backgroundColor: colors.primary }]}>
            <Text style={[type.label, { color: selected ? colors.onPrimary : colors.textMuted }]}>
              {opt.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    flexDirection: 'row',
    borderRadius: radius.pill,
    padding: space.xs,
  },
  segment: {
    flex: 1,
    minHeight: minTouchTarget - 2 * space.xs,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
