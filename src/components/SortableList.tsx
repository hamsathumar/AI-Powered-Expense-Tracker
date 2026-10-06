/**
 * Hold-and-drag reordering for a short list of fixed-height rows (the People
 * list). No library: Reanimated + Gesture Handler, both already in the app.
 *
 * How it works — every row is absolutely positioned at `slot * index`, so
 * reordering is just changing which slot each key owns:
 *   - holding a row for `motion.holdToDrag` lifts it (scale + shadow, a firm
 *     haptic) and it follows the finger;
 *   - as its centre crosses into another slot, the rows in between glide one
 *     slot over and a selection tick fires;
 *   - letting go settles it into its slot and reports the new order once.
 * Near the top/bottom edge of the scroll view, a frame callback scrolls so a
 * row can be carried past the visible area. The slot maths is the pure,
 * tested `domain/peopleOrder.ts`.
 *
 * Reduce motion: rows jump instead of glide and nothing scales; the haptics
 * still fire (they are gated separately in lib/haptics).
 *
 * Needs `GestureHandlerRootView` at the app root (mounted in `_layout`).
 */
import { type ReactNode, useCallback, useEffect, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  type AnimatedRef,
  measure,
  runOnJS,
  scrollTo,
  type SharedValue,
  useAnimatedReaction,
  useAnimatedRef,
  useAnimatedStyle,
  useDerivedValue,
  useFrameCallback,
  useScrollOffset,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { orderFromPositions, reflowPositions, slotForOffset } from '@/domain/peopleOrder';
import { hapticPress, hapticTick } from '@/lib/haptics';
import { useReduceMotion } from '@/theme/FeedbackContext';
import { layout, motion, shadow } from '@/theme/tokens';

interface Props<T> {
  data: T[];
  keyOf: (item: T) => string;
  renderItem: (item: T) => ReactNode;
  rowHeight: number;
  gap: number;
  /** False → rows are plain (no hold-to-drag), e.g. while sorted by name. */
  enabled: boolean;
  /** The scroll view the list lives in — auto-scrolled during a drag. */
  scrollRef: AnimatedRef<Animated.ScrollView>;
  /** Lets the parent lock its own scrolling while a row is held. */
  onDragActive?: (active: boolean) => void;
  /** Called once per drop, only when the order actually changed. */
  onReorder: (keys: string[]) => void;
}

function indexMap(keys: string[]): Record<string, number> {
  return Object.fromEntries(keys.map((k, i) => [k, i]));
}

export function SortableList<T>({
  data,
  keyOf,
  renderItem,
  rowHeight,
  gap,
  enabled,
  scrollRef,
  onDragActive,
  onReorder,
}: Props<T>) {
  const reduceMotion = useReduceMotion();
  const slot = rowHeight + gap;
  const count = data.length;
  const keys = useMemo(() => data.map(keyOf), [data, keyOf]);
  const keysSignature = keys.join('\u0000');

  const positions = useSharedValue<Record<string, number>>(indexMap(keys));
  const activeId = useSharedValue('');
  const startTop = useSharedValue(0);
  const translationY = useSharedValue(0);
  const scrollStart = useSharedValue(0);
  const fingerY = useSharedValue(0);
  const scrollOffset = useScrollOffset(scrollRef);
  const listRef = useAnimatedRef<View>();

  // New data (a reload, or our own committed drop) → the slots follow it.
  useEffect(() => {
    positions.set(indexMap(keys));
    // keysSignature captures `keys` by value; `positions` is a stable ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keysSignature]);

  // Where the held row's top is, in list coordinates — finger travel plus any
  // auto-scroll since pickup, clamped to the list.
  const dragTop = useDerivedValue(() => {
    const raw = startTop.value + translationY.value + (scrollOffset.value - scrollStart.value);
    return Math.max(0, Math.min((count - 1) * slot, raw));
  });

  // Crossing into another slot reflows the others and ticks.
  useAnimatedReaction(
    () => (activeId.value === '' ? -1 : slotForOffset(dragTop.value, slot, count)),
    (to, previous) => {
      if (to < 0 || to === previous) return;
      const next = reflowPositions(positions.value, activeId.value, to);
      if (next !== positions.value) {
        positions.set(next);
        runOnJS(hapticTick)();
      }
    },
  );

  const autoScroll = useFrameCallback(() => {
    if (activeId.value === '') return;
    const viewport = measure(scrollRef);
    const list = measure(listRef);
    if (!viewport || !list) return;
    const y = fingerY.value;
    const edge = layout.dragAutoScrollEdge;
    const viewportBottom = viewport.pageY + viewport.height;
    if (y < viewport.pageY + edge && scrollOffset.value > 0) {
      scrollTo(scrollRef, 0, Math.max(0, scrollOffset.value - layout.dragAutoScrollStep), false);
    } else if (y > viewportBottom - edge && list.pageY + list.height > viewportBottom) {
      scrollTo(scrollRef, 0, scrollOffset.value + layout.dragAutoScrollStep, false);
    }
  }, false);

  const handlePickUp = useCallback(() => {
    hapticPress();
    autoScroll.setActive(true);
    onDragActive?.(true);
  }, [autoScroll, onDragActive]);

  const handleDrop = useCallback(() => {
    autoScroll.setActive(false);
    onDragActive?.(false);
    const next = orderFromPositions(positions.value);
    if (next.join('\u0000') !== keysSignature) {
      hapticTick();
      onReorder(next);
    }
  }, [autoScroll, onDragActive, onReorder, positions, keysSignature]);

  return (
    <View ref={listRef} style={{ height: count > 0 ? count * slot - gap : 0 }}>
      {data.map((item) => {
        const key = keyOf(item);
        return (
          <SortableRow
            key={key}
            id={key}
            rowHeight={rowHeight}
            slot={slot}
            enabled={enabled && count > 1}
            reduceMotion={reduceMotion}
            positions={positions}
            activeId={activeId}
            startTop={startTop}
            translationY={translationY}
            scrollStart={scrollStart}
            scrollOffset={scrollOffset}
            fingerY={fingerY}
            dragTop={dragTop}
            onPickUp={handlePickUp}
            onDrop={handleDrop}>
            {renderItem(item)}
          </SortableRow>
        );
      })}
    </View>
  );
}

interface RowProps {
  id: string;
  rowHeight: number;
  slot: number;
  enabled: boolean;
  reduceMotion: boolean;
  positions: SharedValue<Record<string, number>>;
  activeId: SharedValue<string>;
  startTop: SharedValue<number>;
  translationY: SharedValue<number>;
  scrollStart: SharedValue<number>;
  scrollOffset: SharedValue<number>;
  fingerY: SharedValue<number>;
  dragTop: SharedValue<number>;
  onPickUp: () => void;
  onDrop: () => void;
  children: ReactNode;
}

function SortableRow({
  id,
  rowHeight,
  slot,
  enabled,
  reduceMotion,
  positions,
  activeId,
  startTop,
  translationY,
  scrollStart,
  scrollOffset,
  fingerY,
  dragTop,
  onPickUp,
  onDrop,
  children,
}: RowProps) {
  // Resting top of this row; glides when another row's drag pushes it along.
  const y = useSharedValue((positions.value[id] ?? 0) * slot);

  useAnimatedReaction(
    () => positions.value[id] ?? 0,
    (pos, previous) => {
      if (activeId.value === id) return; // the held row follows the finger instead
      const target = pos * slot;
      y.set(
        previous === null || reduceMotion ? target : withTiming(target, { duration: motion.layout }),
      );
    },
  );

  const gesture = useMemo(
    () =>
      Gesture.Pan()
        .enabled(enabled)
        .activateAfterLongPress(motion.holdToDrag)
        .onStart((e) => {
          startTop.set((positions.value[id] ?? 0) * slot);
          translationY.set(0);
          scrollStart.set(scrollOffset.value);
          fingerY.set(e.absoluteY);
          activeId.set(id);
          runOnJS(onPickUp)();
        })
        .onUpdate((e) => {
          translationY.set(e.translationY);
          fingerY.set(e.absoluteY);
        })
        .onFinalize(() => {
          if (activeId.value !== id) return;
          const target = (positions.value[id] ?? 0) * slot;
          y.set(dragTop.value); // hand over from the finger without a jump…
          activeId.set('');
          y.set(reduceMotion ? target : withTiming(target, { duration: motion.layout })); // …then settle
          runOnJS(onDrop)();
        }),
    [
      enabled,
      id,
      slot,
      reduceMotion,
      positions,
      activeId,
      startTop,
      translationY,
      scrollStart,
      scrollOffset,
      fingerY,
      dragTop,
      y,
      onPickUp,
      onDrop,
    ],
  );

  const style = useAnimatedStyle(() => {
    const active = activeId.value === id;
    const lift = active && !reduceMotion;
    return {
      zIndex: active ? 10 : 0,
      shadowOpacity: withTiming(lift ? shadow.shadowOpacity * 3 : 0, { duration: motion.pressIn }),
      transform: [
        { translateY: active ? dragTop.value : y.value },
        {
          scale: reduceMotion
            ? 1
            : withTiming(lift ? layout.dragLiftScale : 1, { duration: motion.pressIn }),
        },
      ],
    };
  });

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View style={[styles.row, { height: rowHeight }, styles.shadowBase, style]}>
        {children}
      </Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  row: { position: 'absolute', left: 0, right: 0, top: 0 },
  shadowBase: {
    shadowColor: shadow.shadowColor,
    shadowRadius: shadow.shadowRadius,
    shadowOffset: shadow.shadowOffset,
  },
});
