/**
 * Four-segment type selector (design-system.md §5.3) — the transaction
 * form's primary control. Pill-shaped track, selected segment filled with
 * primary; each segment meets the 44pt touch target.
 */
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { TransactionType } from '@/domain/types';
import { useTheme } from '@/theme/ThemeContext';
import { minTouchTarget, radius, space, type } from '@/theme/tokens';

const SEGMENTS: { value: TransactionType; label: string }[] = [
  { value: 'expense', label: 'Expense' },
  { value: 'income', label: 'Income' },
  { value: 'transfer', label: 'Transfer' },
  { value: 'lending', label: 'Lending' },
];

interface Props {
  value: TransactionType;
  onChange: (next: TransactionType) => void;
}

export function TypeSelector({ value, onChange }: Props) {
  const { colors } = useTheme();

  return (
    <View style={[styles.track, { backgroundColor: colors.surfaceAlt }]}>
      {SEGMENTS.map((segment) => {
        const selected = segment.value === value;
        return (
          <Pressable
            key={segment.value}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            onPress={() => onChange(segment.value)}
            style={[styles.segment, selected && { backgroundColor: colors.primary }]}>
            <Text
              style={[
                type.label,
                { color: selected ? colors.onPrimary : colors.textMuted },
              ]}>
              {segment.label}
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
