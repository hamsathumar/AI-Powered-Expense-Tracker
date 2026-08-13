/**
 * Date & time field (overrides design-system-v2.md §5.9). v2 kept the bare
 * system picker; this replaces it with the app's own pill/card language: two
 * pills ("13 Aug 2026" / "00:18") in Sora/Inter and theme tokens that open a
 * themed bottom sheet. The wheel inside the sheet stays the native picker
 * (accent + theme-variant themed) — the reliable, smaller build than a custom
 * calendar — but its chrome now matches the rest of the form.
 */
import DateTimePicker from '@react-native-community/datetimepicker';
import { format } from 'date-fns';
import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '@/theme/ThemeContext';
import { fontFamily, radius, space, tabularNums, type } from '@/theme/tokens';

type Mode = 'date' | 'time';

interface Props {
  value: Date;
  onChange: (date: Date) => void;
}

export function DateTimeField({ value, onChange }: Props) {
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const [mode, setMode] = useState<Mode | null>(null);
  const [draft, setDraft] = useState(value);

  const open = (m: Mode) => {
    setDraft(value);
    setMode(m);
  };
  const commit = () => {
    onChange(draft);
    setMode(null);
  };

  return (
    <View style={styles.row}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Date: ${format(value, 'd MMM yyyy')}`}
        onPress={() => open('date')}
        style={[styles.pill, { backgroundColor: colors.surfaceAlt }]}>
        <Text style={[styles.pillText, { color: colors.text }]}>{format(value, 'd MMM yyyy')}</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Time: ${format(value, 'HH:mm')}`}
        onPress={() => open('time')}
        style={[styles.pill, { backgroundColor: colors.surfaceAlt }]}>
        <Text style={[styles.pillText, { color: colors.text }]}>{format(value, 'HH:mm')}</Text>
      </Pressable>

      <Modal visible={mode !== null} transparent animationType="slide" onRequestClose={() => setMode(null)}>
        <Pressable style={styles.scrim} onPress={() => setMode(null)}>
          {/* Inner press swallows taps so scrubbing the wheel doesn't dismiss. */}
          <Pressable
            style={[
              styles.sheet,
              { backgroundColor: colors.surface, paddingBottom: insets.bottom + space.lg },
            ]}
            onPress={() => {}}>
            <View style={styles.sheetHeader}>
              <Text style={[type.h2, { color: colors.text }]}>
                {mode === 'time' ? 'Select time' : 'Select date'}
              </Text>
              <Pressable accessibilityRole="button" onPress={commit} hitSlop={space.sm}>
                <Text style={[type.label, { color: colors.primary }]}>Done</Text>
              </Pressable>
            </View>
            {mode ? (
              <DateTimePicker
                value={draft}
                mode={mode}
                display="spinner"
                onChange={(_e, date) => date && setDraft(date)}
                themeVariant={isDark ? 'dark' : 'light'}
                accentColor={colors.primary}
                style={styles.picker}
              />
            ) : null}
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: space.sm },
  pill: {
    borderRadius: radius.pill,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm + 1,
  },
  pillText: { fontFamily: fontFamily.body, fontSize: 14, ...tabularNums },
  // Conventional modal scrim (chrome, not a themeable design colour).
  scrim: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: {
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: space.lg,
    paddingTop: space.lg,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  picker: { alignSelf: 'stretch' },
});
