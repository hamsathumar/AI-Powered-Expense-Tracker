/**
 * Fades and lifts a screen's content each time the screen gains focus.
 *
 * This is how tab switching gets its smoothness. The Tabs navigator itself
 * stays on instant switching — `animation: 'shift'` was tried and removed
 * because it intermittently left a tab rendered blank (see `(tabs)/_layout`),
 * so the motion lives in the content instead, where it cannot break routing.
 *
 * It also covers the flash of empty state: screens render zeros while their
 * queries are in flight, and a 200ms fade means you see the settled screen
 * rather than a jump from Rs0.00 to the real figure.
 */
import { useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { useReduceMotion } from '@/theme/FeedbackContext';
import { motion } from '@/theme/tokens';

/** How far the content rises as it fades in. Deliberately small — a lift, not a slide. */
const RISE = 10;

interface Props {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

export function ScreenFade({ children, style }: Props) {
  const reduceMotion = useReduceMotion();
  const opacity = useSharedValue(0);
  const offsetY = useSharedValue(RISE);

  useFocusEffect(
    useCallback(() => {
      if (reduceMotion) {
        // eslint-disable-next-line react-hooks/immutability
        opacity.value = 1;
        // eslint-disable-next-line react-hooks/immutability
        offsetY.value = 0;
        return;
      }
      // Reset then play, so returning to a tab animates again rather than
      // appearing already-settled.
       
      opacity.value = 0;
       
      offsetY.value = RISE;
       
      opacity.value = withTiming(1, { duration: motion.enter });
       
      offsetY.value = withTiming(0, { duration: motion.enter });
    }, [reduceMotion, opacity, offsetY]),
  );

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: offsetY.value }],
  }));

  return <Animated.View style={[styles.fill, style, animatedStyle]}>{children}</Animated.View>;
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
