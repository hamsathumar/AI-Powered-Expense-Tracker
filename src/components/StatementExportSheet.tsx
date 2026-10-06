/**
 * "Export PDF" sheet on a person's profile: pick the period, then share.
 * Presets show their real dates (domain/statementPeriod.ts) so "last week"
 * never has to be guessed; Custom opens the same calendar range picker the
 * filters use, as an in-sheet cover (nested Modals are unreliable on iOS).
 *
 * The body remounts on every open, so a dismissed choice never lingers.
 */
import { Feather } from '@expo/vector-icons';
import { useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DateRangePicker } from '@/components/reports/DateRangePicker';
import { hapticTick } from '@/lib/haptics';
import { toDay } from '@/domain/reportRange';
import {
  describeRange,
  normalizeRange,
  STATEMENT_PRESETS,
  statementPeriod,
  type DayRange,
  type StatementPreset,
} from '@/domain/statementPeriod';
import { useTheme } from '@/theme/ThemeContext';
import { layout, minTouchTarget, radius, screenPaddingH, space, type } from '@/theme/tokens';

interface Props {
  visible: boolean;
  personName: string;
  onClose: () => void;
  /** Resolves when the share sheet is done; rejects with a user-facing error. */
  onExport: (range: DayRange) => Promise<void>;
}

export function StatementExportSheet({ visible, ...rest }: Props) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={rest.onClose}>
      {visible ? <SheetBody {...rest} /> : null}
    </Modal>
  );
}

function SheetBody({ personName, onClose, onExport }: Omit<Props, 'visible'>) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [preset, setPreset] = useState<StatementPreset>('lastMonth');
  const [custom, setCustom] = useState<DayRange | null>(null);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const today = new Date();
  const rangeFor = (p: StatementPreset): DayRange | null =>
    p === 'custom' ? custom : statementPeriod(p, today);
  const selected = rangeFor(preset);

  const choose = (p: StatementPreset) => {
    hapticTick();
    setError(null);
    setPreset(p);
    if (p === 'custom') setCalendarOpen(true);
  };

  const exportPdf = async () => {
    if (!selected || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onExport(selected);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const fallbackDay = toDay(today);

  return (
    <View style={styles.root}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Close"
        onPress={busy ? undefined : onClose}
        style={styles.scrim}
      />

      <View
        style={[
          styles.sheet,
          { backgroundColor: colors.bg, paddingBottom: insets.bottom + space.lg },
          calendarOpen && styles.sheetTall,
        ]}>
        <View style={styles.grabberRow}>
          <View style={[styles.grabber, { backgroundColor: colors.border }]} />
        </View>

        <View style={styles.titleRow}>
          <View style={styles.titleText}>
            <Text style={[type.h1, { color: colors.text }]}>Export PDF</Text>
            <Text numberOfLines={1} style={[type.caption, { color: colors.textMuted }]}>
              Statement with {personName}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close"
            onPress={onClose}
            disabled={busy}
            hitSlop={space.sm}
            style={styles.closeHit}>
            <Feather name="x" size={22} color={colors.textMuted} />
          </Pressable>
        </View>

        <View style={styles.options}>
          {STATEMENT_PRESETS.map((opt) => {
            const isSelected = opt.value === preset;
            const range = rangeFor(opt.value);
            return (
              <Pressable
                key={opt.value}
                accessibilityRole="radio"
                accessibilityState={{ selected: isSelected }}
                onPress={() => choose(opt.value)}
                style={[
                  styles.option,
                  {
                    backgroundColor: isSelected ? colors.primarySoft : colors.surface,
                    borderColor: isSelected ? colors.primary : colors.border,
                  },
                ]}>
                <Feather
                  name={isSelected ? 'check-circle' : 'circle'}
                  size={20}
                  color={isSelected ? colors.primary : colors.textSubtle}
                />
                <View style={styles.optionText}>
                  <Text style={[type.body, { color: colors.text }]}>{opt.label}</Text>
                  <Text style={[type.caption, { color: colors.textMuted }]}>
                    {range ? describeRange(range) : 'Choose dates'}
                  </Text>
                </View>
                {opt.value === 'custom' ? (
                  <Feather name="calendar" size={18} color={colors.textMuted} />
                ) : null}
              </Pressable>
            );
          })}
        </View>

        {error ? (
          <Text style={[type.caption, styles.error, { color: colors.danger }]}>{error}</Text>
        ) : null}

        <Pressable
          accessibilityRole="button"
          disabled={!selected || busy}
          onPress={exportPdf}
          style={({ pressed }) => [
            styles.exportButton,
            { backgroundColor: pressed ? colors.primaryPress : colors.primary },
            (!selected || busy) && styles.disabled,
          ]}>
          {busy ? (
            <ActivityIndicator color={colors.onPrimary} />
          ) : (
            <>
              <Feather name="share" size={18} color={colors.onPrimary} />
              <Text style={[type.h2, { color: colors.onPrimary }]}>Export & share</Text>
            </>
          )}
        </Pressable>

        {calendarOpen ? (
          <DateRangePicker
            startDay={custom?.startDay ?? fallbackDay}
            endDay={custom?.endDay ?? fallbackDay}
            onCancel={() => {
              setCalendarOpen(false);
              if (!custom) setPreset('lastMonth');
            }}
            onApply={(startDay, endDay) => {
              setCustom(normalizeRange(startDay, endDay));
              setCalendarOpen(false);
            }}
          />
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  // Conventional modal scrim (chrome, not a themeable design colour).
  scrim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  sheet: {
    borderTopLeftRadius: layout.sheetRadius,
    borderTopRightRadius: layout.sheetRadius,
    overflow: 'hidden',
    gap: space.lg,
  },
  // The calendar cover needs room for a full month grid.
  sheetTall: { minHeight: '75%' },
  grabberRow: { alignItems: 'center', paddingTop: space.sm },
  grabber: { width: 36, height: 4, borderRadius: radius.pill },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: screenPaddingH,
  },
  titleText: { flex: 1, gap: 2 },
  closeHit: {
    minWidth: minTouchTarget,
    minHeight: minTouchTarget,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  options: { paddingHorizontal: screenPaddingH, gap: space.sm },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: space.md,
    minHeight: minTouchTarget + space.md,
  },
  optionText: { flex: 1, gap: 2 },
  error: { paddingHorizontal: screenPaddingH },
  exportButton: {
    marginHorizontal: screenPaddingH,
    minHeight: layout.primaryButtonH,
    borderRadius: radius.lg,
    flexDirection: 'row',
    gap: space.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabled: { opacity: 0.6 },
});
