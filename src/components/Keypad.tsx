/**
 * Amount keypad (design-system-v2.md §5.13) — a pinned bottom panel: a
 * 4-column grid of 50pt keys (digits + `.` on the raised surface, the
 * operators `+ − × =` accented, a backspace key) and the primary
 * `Save transaction` button directly beneath. Quick math evaluates on `=`;
 * the stored value is always integer minor units (see domain/keypad).
 *
 * The panel carries an upward shadow so it reads as floating above the form
 * (v2 §4.1). Key presses are dumb — the parent owns the calculator state.
 */
import { Feather } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PressableScale } from '@/components/PressableScale';
import type { KeypadKey } from '@/domain/keypad';
import { useTheme } from '@/theme/ThemeContext';
import { fontFamily, keypadShadow, layout, radius, space, type } from '@/theme/tokens';

interface Cell {
  key: KeypadKey;
  label?: string;
  icon?: 'delete';
  op?: boolean;
}

const ROWS: Cell[][] = [
  [{ key: '1', label: '1' }, { key: '2', label: '2' }, { key: '3', label: '3' }, { key: '+', label: '+', op: true }],
  [{ key: '4', label: '4' }, { key: '5', label: '5' }, { key: '6', label: '6' }, { key: '-', label: '−', op: true }],
  [{ key: '7', label: '7' }, { key: '8', label: '8' }, { key: '9', label: '9' }, { key: '*', label: '×', op: true }],
  [{ key: '.', label: '.' }, { key: '0', label: '0' }, { key: 'backspace', icon: 'delete' }, { key: 'equals', label: '=', op: true }],
];

interface Props {
  onKey: (key: KeypadKey) => void;
  onSave: () => void;
  saveLabel: string;
  saving?: boolean;
  saveDisabled?: boolean;
}

export function Keypad({ onKey, onSave, saveLabel, saving = false, saveDisabled = false }: Props) {
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();

  // Digit keys sit one step raised from the panel; operators carry the accent.
  const keyBg = isDark ? colors.surfaceAlt : colors.bg;
  const opBg = isDark ? colors.primarySoft : colors.surfaceAlt;

  return (
    <View
      style={[
        styles.panel,
        {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          paddingBottom: insets.bottom + space.sm,
        },
        !isDark && keypadShadow,
      ]}>
      <View style={styles.grid}>
        {ROWS.map((row, ri) => (
          <View key={ri} style={styles.row}>
            {row.map((cell) => (
              <PressableScale
                key={cell.key}
                accessibilityRole="button"
                accessibilityLabel={cell.icon === 'delete' ? 'Backspace (hold to clear all)' : cell.label}
                accessibilityHint={cell.icon === 'delete' ? 'Long-press to clear the amount' : undefined}
                onPress={() => onKey(cell.key)}
                // Long-pressing backspace clears the whole entry (AC) — keeps
                // the 4×4 grid unchanged (design-system-v2.md §5.13).
                onLongPress={cell.icon === 'delete' ? () => onKey('clear') : undefined}
                scaleTo={0.94}
                style={[styles.key, { backgroundColor: cell.op ? opBg : keyBg }]}>
                {cell.icon === 'delete' ? (
                  <Feather name="delete" size={20} color={colors.text} />
                ) : (
                  <Text style={[type.keypadKey, { color: cell.op ? colors.primary : colors.text }]}>
                    {cell.label}
                  </Text>
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
        style={[
          styles.save,
          { backgroundColor: colors.primary },
          (saving || saveDisabled) && styles.disabled,
        ]}>
        <Text style={[styles.saveLabel, { color: colors.onPrimary }]}>
          {saving ? 'Saving…' : saveLabel}
        </Text>
      </PressableScale>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: space.md + 2,
    paddingHorizontal: space.md,
    gap: space.sm + 2,
  },
  grid: { gap: space.sm },
  row: { flexDirection: 'row', gap: space.sm },
  key: {
    flex: 1,
    height: layout.keypadKeyH,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  save: {
    height: layout.primaryButtonH,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveLabel: { fontFamily: fontFamily.heading, fontSize: 16 },
  disabled: { opacity: 0.6 },
});
