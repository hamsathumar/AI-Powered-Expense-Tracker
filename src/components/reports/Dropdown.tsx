/**
 * Pill dropdown (Reports v2) — the "Expense ▾" / "Category ▾" controls above
 * the breakdown. A pill in the app's chip language that opens a small themed
 * menu anchored under itself, rather than a full-screen picker: the choice is
 * a view switch, so it should feel instant and stay in place.
 *
 * The menu is a transparent Modal positioned from the pill's measured window
 * coordinates — RN has no native popover, and a Modal is the only way to draw
 * above the ScrollView without clipping.
 */
import { Feather } from '@expo/vector-icons';
import { useRef, useState } from 'react';
import { Dimensions, Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { hapticTick } from '@/lib/haptics';
import { useTheme } from '@/theme/ThemeContext';
import { layout, minTouchTarget, radius, shadow, space, type } from '@/theme/tokens';

export interface DropdownOption<T extends string> {
  value: T;
  label: string;
}

interface Props<T extends string> {
  value: T;
  options: DropdownOption<T>[];
  onChange: (value: T) => void;
  accessibilityLabel: string;
  /** Which edge of the pill the menu lines up with. */
  align?: 'left' | 'right';
}

const MENU_MIN_W = 168;
const MENU_GAP = space.xs;

export function Dropdown<T extends string>({
  value,
  options,
  onChange,
  accessibilityLabel,
  align = 'left',
}: Props<T>) {
  const { colors, isDark } = useTheme();
  const pillRef = useRef<View>(null);
  const [anchor, setAnchor] = useState<{ top: number; left: number; right: number } | null>(null);

  const selected = options.find((o) => o.value === value);
  const screen = Dimensions.get('window');

  const open = () => {
    pillRef.current?.measureInWindow((x, y, width, height) => {
      setAnchor({
        top: y + height + MENU_GAP,
        left: x,
        right: screen.width - (x + width),
      });
    });
  };

  return (
    <>
      <Pressable
        ref={pillRef}
        accessibilityRole="button"
        accessibilityLabel={`${accessibilityLabel}: ${selected?.label ?? value}`}
        accessibilityState={{ expanded: anchor != null }}
        onPress={open}
        style={[styles.pill, { backgroundColor: colors.surfaceAlt }]}>
        <Text numberOfLines={1} style={[type.label, styles.pillLabel, { color: colors.text }]}>
          {selected?.label ?? value}
        </Text>
        <Feather name="chevron-down" size={16} color={colors.textMuted} />
      </Pressable>

      <Modal visible={anchor != null} transparent animationType="fade" onRequestClose={() => setAnchor(null)}>
        <Pressable style={styles.scrim} onPress={() => setAnchor(null)}>
          {anchor ? (
            <View
              style={[
                styles.menu,
                {
                  top: anchor.top,
                  backgroundColor: colors.surface,
                  borderColor: colors.border,
                },
                align === 'left' ? { left: anchor.left } : { right: anchor.right },
                !isDark && shadow,
              ]}>
              {options.map((option) => {
                const isSelected = option.value === value;
                return (
                  <Pressable
                    key={option.value}
                    accessibilityRole="button"
                    accessibilityState={{ selected: isSelected }}
                    onPress={() => {
                      if (!isSelected) hapticTick();
                      onChange(option.value);
                      setAnchor(null);
                    }}
                    style={[styles.item, isSelected && { backgroundColor: colors.surfaceAlt }]}>
                    <Text style={[type.body, styles.itemLabel, { color: colors.text }]}>{option.label}</Text>
                    {isSelected ? <Feather name="check" size={16} color={colors.primary} /> : null}
                  </Pressable>
                );
              })}
            </View>
          ) : null}
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: minTouchTarget,
    paddingHorizontal: layout.chipPaddingH,
    borderRadius: radius.pill,
  },
  pillLabel: { flexShrink: 1 },
  // Conventional dismiss layer (chrome, not a themeable design colour).
  scrim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.15)' },
  menu: {
    position: 'absolute',
    minWidth: MENU_MIN_W,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: space.xs,
    overflow: 'hidden',
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: minTouchTarget,
    paddingHorizontal: space.lg,
  },
  itemLabel: { flex: 1 },
});
