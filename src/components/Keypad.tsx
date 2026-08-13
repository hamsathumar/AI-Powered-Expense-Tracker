/**
 * Amount keypad (design-system-v2.md §5.13; restyle per the reference).
 * A pinned bottom panel: a prominent running-expression header, then a grid
 * of pill keys — a visible AC (clear-all) key, a backspace, the operators
 * `÷ × − +`, digits, `.`, and a wide `=`. A `Save transaction` button sits
 * beneath. Quick math evaluates left-to-right on `=`; the stored value is
 * always integer minor units (see domain/keypad).
 *
 * Tones read against the theme without new tokens: digits on `surface`, the
 * panel a soft `primarySoft` tint, operators a gold `canopyAccent` wash with
 * `lending` glyphs, AC a `danger` wash with `danger` text, `=`/Save the brand
 * `primary`. The panel carries an upward shadow so it floats above the form.
 */
import { Feather } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PressableScale } from '@/components/PressableScale';
import type { KeypadKey } from '@/domain/keypad';
import { useTheme } from '@/theme/ThemeContext';
import { fontFamily, keypadShadow, layout, radius, space } from '@/theme/tokens';

type Variant = 'digit' | 'op' | 'clear' | 'equals';

interface Cell {
  key: KeypadKey;
  label?: string;
  icon?: 'delete';
  variant: Variant;
  span?: number;
}

const ROWS: Cell[][] = [
  [
    { key: 'clear', label: 'AC', variant: 'clear', span: 2 },
    { key: 'backspace', icon: 'delete', variant: 'digit' },
    { key: '/', label: '÷', variant: 'op' },
  ],
  [
    { key: '7', label: '7', variant: 'digit' },
    { key: '8', label: '8', variant: 'digit' },
    { key: '9', label: '9', variant: 'digit' },
    { key: '*', label: '×', variant: 'op' },
  ],
  [
    { key: '4', label: '4', variant: 'digit' },
    { key: '5', label: '5', variant: 'digit' },
    { key: '6', label: '6', variant: 'digit' },
    { key: '-', label: '−', variant: 'op' },
  ],
  [
    { key: '1', label: '1', variant: 'digit' },
    { key: '2', label: '2', variant: 'digit' },
    { key: '3', label: '3', variant: 'digit' },
    { key: '+', label: '+', variant: 'op' },
  ],
  [
    { key: '.', label: '.', variant: 'digit' },
    { key: '0', label: '0', variant: 'digit' },
    { key: 'equals', label: '=', variant: 'equals', span: 2 },
  ],
];

const A11Y: Partial<Record<KeypadKey, string>> = {
  clear: 'Clear all',
  backspace: 'Backspace',
  '/': 'Divide',
  '*': 'Multiply',
  '-': 'Subtract',
  '+': 'Add',
  equals: 'Equals',
};

interface Props {
  onKey: (key: KeypadKey) => void;
  onSave: () => void;
  saveLabel: string;
  expression: string;
  saving?: boolean;
  saveDisabled?: boolean;
}

export function Keypad({ onKey, onSave, saveLabel, expression, saving = false, saveDisabled = false }: Props) {
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();

  const digitBg = isDark ? colors.surfaceAlt : colors.surface;
  const opBg = `${colors.canopyAccent}2E`;
  const clearBg = `${colors.danger}1F`;

  const bgFor = (v: Variant): string =>
    v === 'op' ? opBg : v === 'clear' ? clearBg : v === 'equals' ? colors.primary : digitBg;
  const fgFor = (v: Variant): string =>
    v === 'op' ? colors.lending : v === 'clear' ? colors.danger : v === 'equals' ? colors.onPrimary : colors.text;

  return (
    <View
      style={[
        styles.panel,
        {
          backgroundColor: isDark ? colors.surface : colors.primarySoft,
          borderTopColor: colors.border,
          paddingBottom: insets.bottom + space.sm,
        },
        !isDark && keypadShadow,
      ]}>
      <Text numberOfLines={1} style={[styles.expression, { color: colors.text }]}>
        {expression || ' '}
      </Text>

      <View style={styles.grid}>
        {ROWS.map((row, ri) => (
          <View key={ri} style={styles.row}>
            {row.map((cell) => (
              <PressableScale
                key={cell.key}
                accessibilityRole="button"
                accessibilityLabel={A11Y[cell.key] ?? cell.label}
                onPress={() => onKey(cell.key)}
                scaleTo={0.94}
                style={[styles.key, { flex: cell.span ?? 1, backgroundColor: bgFor(cell.variant) }]}>
                {cell.icon === 'delete' ? (
                  <Feather name="delete" size={20} color={colors.text} />
                ) : (
                  <Text style={[styles.keyLabel, { color: fgFor(cell.variant) }]}>{cell.label}</Text>
                )}
              </PressableScale>
            ))}
          </View>
        ))}
      </View>

      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={saveLabel}
        disabled={saving || saveDisabled}
        onPress={onSave}
        scaleTo={0.97}
        style={[styles.save, { backgroundColor: colors.primary }, (saving || saveDisabled) && styles.disabled]}>
        <Text style={[styles.saveLabel, { color: colors.onPrimary }]}>
          {saving ? 'Saving…' : saveLabel}
        </Text>
      </PressableScale>
    </View>
  );
}

const KEY_H = 50;

const styles = StyleSheet.create({
  panel: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopLeftRadius: layout.sheetRadius,
    borderTopRightRadius: layout.sheetRadius,
    paddingTop: space.md,
    paddingHorizontal: space.md,
    gap: space.sm + 2,
  },
  expression: {
    fontFamily: fontFamily.headingBold,
    fontSize: 24,
    lineHeight: 32,
    textAlign: 'right',
    paddingHorizontal: space.xs,
  },
  grid: { gap: space.sm },
  row: { flexDirection: 'row', gap: space.sm },
  key: {
    height: KEY_H,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  keyLabel: { fontFamily: fontFamily.heading, fontSize: 20 },
  save: {
    height: layout.primaryButtonH,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveLabel: { fontFamily: fontFamily.heading, fontSize: 16 },
  disabled: { opacity: 0.6 },
});
