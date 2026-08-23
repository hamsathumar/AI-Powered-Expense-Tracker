/**
 * A row you can swipe to act on, without opening it.
 *
 * Behaviour is "swipe past the threshold to commit", not "swipe to reveal a
 * button you then tap" — one gesture instead of two, which is the whole point
 * on a list you're triaging. The action's colour and icon slide in behind the
 * row as you drag, and a haptic fires the instant you cross the point of no
 * return, so you can feel the commit before you let go.
 *
 * `activeOffsetX` keeps vertical list scrolling intact: the pan only takes
 * over once the finger has moved further horizontally than vertically.
 *
 * Requires `GestureHandlerRootView` at the app root (mounted in `_layout`) —
 * without it gestures silently never fire.
 */
import { Feather } from '@expo/vector-icons';
import type { ComponentProps } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { hapticPress } from '@/lib/haptics';
import { useReduceMotion } from '@/theme/FeedbackContext';
import { useTheme } from '@/theme/ThemeContext';
import { motion, radius, space, type } from '@/theme/tokens';

export interface SwipeAction {
  icon: ComponentProps<typeof Feather>['name'];
  label: string;
  /** Background revealed behind the row. */
  color: string;
  onTrigger: () => void;
}

interface Props {
  /** Revealed by dragging RIGHT (finger moves →). Conventionally the positive one. */
  left?: SwipeAction;
  /** Revealed by dragging LEFT. Conventionally the destructive one. */
  right?: SwipeAction;
  children: React.ReactNode;
}

/** How far you must drag before letting go commits the action. */
const THRESHOLD = 96;
/** Drag stops here, so the row never flies off screen. */
const MAX_TRAVEL = 132;

export function SwipeableRow({ left, right, children }: Props) {
  const { colors } = useTheme();
  const reduceMotion = useReduceMotion();

  const translateX = useSharedValue(0);
  /** Tracks whether we have already buzzed for the current drag. */
  const armed = useSharedValue(false);

  const settle = () => {
    'worklet';
    translateX.value = reduceMotion ? 0 : withTiming(0, { duration: motion.select });
  };

  const pan = Gesture.Pan()
    // Only claim the gesture once it is clearly horizontal — the list must
    // still scroll normally.
    .activeOffsetX([-14, 14])
    .failOffsetY([-10, 10])
    .onUpdate((event) => {
      const canGoRight = left != null;
      const canGoLeft = right != null;
      let next = event.translationX;
      if (next > 0 && !canGoRight) next = 0;
      if (next < 0 && !canGoLeft) next = 0;
      translateX.value = Math.max(-MAX_TRAVEL, Math.min(MAX_TRAVEL, next));

      const past = Math.abs(translateX.value) >= THRESHOLD;
      if (past && !armed.value) {
        armed.value = true;
        runOnJS(hapticPress)();
      } else if (!past && armed.value) {
        armed.value = false;
      }
    })
    .onEnd(() => {
      const committed = Math.abs(translateX.value) >= THRESHOLD;
      const action = translateX.value > 0 ? left : right;
      armed.value = false;
      settle();
      if (committed && action) runOnJS(action.onTrigger)();
    })
    .onFinalize(() => {
      armed.value = false;
      settle();
    });

  const rowStyle = useAnimatedStyle(() => ({ transform: [{ translateX: translateX.value }] }));

  // Only the side being dragged toward is shown, and it fades up with the drag.
  const leftStyle = useAnimatedStyle(() => ({
    opacity: translateX.value > 0 ? Math.min(1, translateX.value / THRESHOLD) : 0,
  }));
  const rightStyle = useAnimatedStyle(() => ({
    opacity: translateX.value < 0 ? Math.min(1, -translateX.value / THRESHOLD) : 0,
  }));

  return (
    <View style={styles.wrap}>
      {left ? (
        <Animated.View
          pointerEvents="none"
          style={[styles.action, styles.actionLeft, { backgroundColor: left.color }, leftStyle]}>
          <Feather name={left.icon} size={18} color={colors.onFilled} />
          <Text style={[type.caption, { color: colors.onFilled }]}>{left.label}</Text>
        </Animated.View>
      ) : null}

      {right ? (
        <Animated.View
          pointerEvents="none"
          style={[styles.action, styles.actionRight, { backgroundColor: right.color }, rightStyle]}>
          <Feather name={right.icon} size={18} color={colors.onFilled} />
          <Text style={[type.caption, { color: colors.onFilled }]}>{right.label}</Text>
        </Animated.View>
      ) : null}

      <GestureDetector gesture={pan}>
        <Animated.View style={rowStyle}>{children}</Animated.View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { borderRadius: radius.md, overflow: 'hidden' },
  action: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: MAX_TRAVEL,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.lg,
  },
  actionLeft: { left: 0, justifyContent: 'flex-start' },
  actionRight: { right: 0, justifyContent: 'flex-end' },
});
