/**
 * Calendar range picker — replaces the iOS wheel/compact date fields in the
 * filter sheet with a real month grid, so picking "10–14 August" is two taps
 * on the days themselves rather than two spins of a system picker.
 *
 * Rendered as an absolutely-positioned cover over the filter sheet rather than
 * a second Modal: nesting Modals on iOS is unreliable ("attempt to present
 * while a presentation is in progress"), and a cover reads the same.
 *
 * Selection state is a DRAFT — nothing is applied until "Select", so a
 * half-picked range never re-queries the reports screen. Grid maths and the
 * meaning of each tap live in `domain/calendarGrid.ts` and are tested there.
 */
import { Feather } from '@expo/vector-icons';
import { addMonths, format, isSameMonth } from 'date-fns';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  isSelectionEdge,
  isWithinSelection,
  monthGrid,
  nextRangeSelection,
  WEEKDAY_LABELS,
  type RangeSelection,
} from '@/domain/calendarGrid';
import { fromDay, toDay } from '@/domain/reportRange';
import { useTheme } from '@/theme/ThemeContext';
import {
  layout,
  minTouchTarget,
  radius,
  screenPaddingH,
  space,
  tabularNums,
  type,
} from '@/theme/tokens';

interface Props {
  startDay: string;
  endDay: string;
  onCancel: () => void;
  onApply: (startDay: string, endDay: string) => void;
}

const CELL_HEIGHT = 44;

export function DateRangePicker({ startDay, endDay, onCancel, onApply }: Props) {
  const { colors } = useTheme();
  const [selection, setSelection] = useState<RangeSelection>({ startDay, endDay });
  const [month, setMonth] = useState(() => fromDay(startDay));

  const today = toDay(new Date());
  const rows = monthGrid(month);
  const complete = selection.endDay != null;

  // Reporting on the future is meaningless — there is nothing recorded there.
  const canGoForward = !isSameMonth(month, new Date()) && month < new Date();

  const headline = complete
    ? `${format(fromDay(selection.startDay), 'd MMM')} – ${format(fromDay(selection.endDay!), 'd MMM yyyy')}`
    : `${format(fromDay(selection.startDay), 'd MMM yyyy')} – …`;

  return (
    <View style={[styles.cover, { backgroundColor: colors.bg }]}>
      <View style={styles.topBar}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Cancel date range"
          onPress={onCancel}
          hitSlop={space.sm}
          style={styles.topAction}>
          <Feather name="x" size={22} color={colors.text} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Apply date range"
          disabled={!complete}
          onPress={() => complete && onApply(selection.startDay, selection.endDay!)}
          hitSlop={space.sm}
          style={styles.topAction}>
          <Text style={[type.label, { color: complete ? colors.primary : colors.textSubtle }]}>
            Select
          </Text>
        </Pressable>
      </View>

      <View style={styles.headline}>
        <Text style={[type.caption, { color: colors.textMuted }]}>Select range</Text>
        <Text style={[type.h1, styles.headlineText, { color: colors.text }]}>{headline}</Text>
        {!complete ? (
          <Text style={[type.caption, { color: colors.textSubtle }]}>
            Now pick the end of the range.
          </Text>
        ) : null}
      </View>

      <View style={styles.monthNav}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Previous month"
          onPress={() => setMonth((m) => addMonths(m, -1))}
          style={[styles.monthArrow, { backgroundColor: colors.surfaceAlt }]}>
          <Feather name="chevron-left" size={18} color={colors.primary} />
        </Pressable>
        <Text style={[type.h2, styles.monthTitle, { color: colors.text }]}>
          {format(month, 'MMMM yyyy')}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Next month"
          disabled={!canGoForward}
          onPress={() => setMonth((m) => addMonths(m, 1))}
          style={[
            styles.monthArrow,
            { backgroundColor: colors.surfaceAlt },
            !canGoForward && styles.dimmed,
          ]}>
          <Feather name="chevron-right" size={18} color={colors.primary} />
        </Pressable>
      </View>

      <View style={[styles.weekdays, { borderBottomColor: colors.border }]}>
        {WEEKDAY_LABELS.map((label, i) => (
          <Text
            key={`${label}-${i}`}
            style={[type.caption, styles.weekday, { color: colors.textSubtle }]}>
            {label}
          </Text>
        ))}
      </View>

      <ScrollView contentContainerStyle={styles.grid}>
        {rows.map((week, weekIndex) => (
          <View key={weekIndex} style={styles.week}>
            {week.map((day, dayIndex) => {
              if (day == null) {
                return <View key={`pad-${dayIndex}`} style={styles.cell} />;
              }
              const inRange = isWithinSelection(day, selection);
              const edge = isSelectionEdge(day, selection);
              const isToday = day === today;
              const future = day > today;

              return (
                <View key={day} style={styles.cell}>
                  {/* Connecting band behind the mid-range days. */}
                  {inRange && !edge ? (
                    <View style={[styles.band, { backgroundColor: colors.primarySoft }]} />
                  ) : null}
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={format(fromDay(day), 'd MMMM yyyy')}
                    accessibilityState={{ selected: inRange, disabled: future }}
                    disabled={future}
                    onPress={() => setSelection((current) => nextRangeSelection(current, day))}
                    style={[
                      styles.dayHit,
                      edge && { backgroundColor: colors.primary },
                      !edge && isToday && { borderWidth: 1, borderColor: colors.primary },
                    ]}>
                    <Text
                      style={[
                        type.body,
                        styles.dayText,
                        {
                          color: edge
                            ? colors.onPrimary
                            : future
                              ? colors.textSubtle
                              : isToday
                                ? colors.primary
                                : colors.text,
                        },
                      ]}>
                      {Number(day.slice(-2))}
                    </Text>
                  </Pressable>
                </View>
              );
            })}
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  cover: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderTopLeftRadius: layout.sheetRadius,
    borderTopRightRadius: layout.sheetRadius,
    paddingHorizontal: screenPaddingH,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: space.md,
  },
  topAction: {
    minWidth: minTouchTarget,
    minHeight: minTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headline: { gap: space.xs, paddingBottom: space.md },
  headlineText: { ...tabularNums },
  monthNav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: space.md,
  },
  monthArrow: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  monthTitle: { flex: 1, textAlign: 'center' },
  dimmed: { opacity: 0.4 },
  weekdays: {
    flexDirection: 'row',
    paddingBottom: space.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  weekday: { flex: 1, textAlign: 'center' },
  grid: { paddingTop: space.sm, paddingBottom: space.xl },
  week: { flexDirection: 'row' },
  cell: {
    flex: 1,
    height: CELL_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Full-width so consecutive in-range days read as one continuous band.
  band: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    marginVertical: space.xs,
  },
  dayHit: {
    width: CELL_HEIGHT - space.sm,
    height: CELL_HEIGHT - space.sm,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayText: { ...tabularNums },
});
