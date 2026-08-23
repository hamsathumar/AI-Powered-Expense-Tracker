/**
 * Four-segment type selector (design-system.md §5.3) — the transaction
 * form's primary control. Pill-shaped track, selected segment filled with
 * primary; each segment meets the 44pt touch target.
 *
 * The fill slides between segments (§7, 150ms) and ticks — this control
 * changes which fields the form shows, so it deserves a confirmation you can
 * feel. Under reduce-motion the fill jumps instead.
 */
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import Animated, { useAnimatedStyle, withTiming } from 'react-native-reanimated';

import type { TransactionType } from '@/domain/types';
import { hapticTick } from '@/lib/haptics';
import { useReduceMotion } from '@/theme/FeedbackContext';
import { useTheme } from '@/theme/ThemeContext';
import { minTouchTarget, motion, radius, space, type } from '@/theme/tokens';

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
  const reduceMotion = useReduceMotion();
  const [trackWidth, setTrackWidth] = useState(0);

  const index = Math.max(0, SEGMENTS.findIndex((s) => s.value === value));
  const segmentWidth = trackWidth / SEGMENTS.length;

  const indicatorStyle = useAnimatedStyle(() => {
    const x = segmentWidth * index;
    return {
      width: segmentWidth,
      transform: [
        { translateX: reduceMotion ? x : withTiming(x, { duration: motion.select }) },
      ],
    };
  });

  return (
    <View
      style={[styles.track, { backgroundColor: colors.surfaceAlt }]}
      onLayout={(e: LayoutChangeEvent) => setTrackWidth(e.nativeEvent.layout.width - 2 * space.xs)}>
      {trackWidth > 0 ? (
        <Animated.View
          pointerEvents="none"
          style={[styles.indicator, { backgroundColor: colors.primary }, indicatorStyle]}
        />
      ) : null}

      {SEGMENTS.map((segment) => {
        const selected = segment.value === value;
        return (
          <Pressable
            key={segment.value}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            onPress={() => {
              if (!selected) hapticTick();
              onChange(segment.value);
            }}
            style={styles.segment}>
            <Text style={[type.label, { color: selected ? colors.onPrimary : colors.textMuted }]}>
              {segment.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const SEGMENT_HEIGHT = minTouchTarget - 2 * space.xs;

const styles = StyleSheet.create({
  track: {
    flexDirection: 'row',
    borderRadius: radius.pill,
    padding: space.xs,
  },
  indicator: {
    position: 'absolute',
    left: space.xs,
    top: space.xs,
    height: SEGMENT_HEIGHT,
    borderRadius: radius.pill,
  },
  segment: {
    flex: 1,
    minHeight: SEGMENT_HEIGHT,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
