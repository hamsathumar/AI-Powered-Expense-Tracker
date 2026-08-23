/**
 * Generic two-plus-segment control (design-system-v2.md §5.15 "How to split").
 * A pill track (`surfaceAlt`) with the selected segment filled `primary` and
 * `onPrimary` label — the same segmented language as the TypeSelector, so the
 * choice reads as one connected control rather than separate pills.
 *
 * The fill SLIDES between segments rather than jumping (design-system.md §7,
 * 150ms). One absolutely-positioned indicator moves under the labels; the
 * labels themselves only cross-fade their colour. Under reduce-motion the
 * indicator jumps, which is the same end state without the travel.
 */
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import Animated, { useAnimatedStyle, withTiming } from 'react-native-reanimated';

import { hapticTick } from '@/lib/haptics';
import { useReduceMotion } from '@/theme/FeedbackContext';
import { useTheme } from '@/theme/ThemeContext';
import { minTouchTarget, motion, radius, space, type } from '@/theme/tokens';

interface Props<T extends string> {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}

export function SegmentedControl<T extends string>({ options, value, onChange }: Props<T>) {
  const { colors } = useTheme();
  const reduceMotion = useReduceMotion();
  const [trackWidth, setTrackWidth] = useState(0);

  const index = Math.max(0, options.findIndex((o) => o.value === value));
  const segmentWidth = options.length > 0 ? trackWidth / options.length : 0;

  const indicatorStyle = useAnimatedStyle(() => {
    const x = segmentWidth * index;
    return {
      width: segmentWidth,
      transform: [
        { translateX: reduceMotion ? x : withTiming(x, { duration: motion.select }) },
      ],
    };
  });

  const onLayout = (e: LayoutChangeEvent) =>
    setTrackWidth(e.nativeEvent.layout.width - 2 * space.xs);

  return (
    <View style={[styles.track, { backgroundColor: colors.surfaceAlt }]} onLayout={onLayout}>
      {trackWidth > 0 ? (
        <Animated.View
          pointerEvents="none"
          style={[styles.indicator, { backgroundColor: colors.primary }, indicatorStyle]}
        />
      ) : null}

      {options.map((opt) => {
        const selected = opt.value === value;
        return (
          <Pressable
            key={opt.value}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            onPress={() => {
              if (!selected) hapticTick();
              onChange(opt.value);
            }}
            style={styles.segment}>
            <Text style={[type.label, { color: selected ? colors.onPrimary : colors.textMuted }]}>
              {opt.label}
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
