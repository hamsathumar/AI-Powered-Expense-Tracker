/**
 * Reports filter sheet (v2) — one place to define what the whole Reports tab
 * is reporting on: the period (preset or a hand-picked range), one account,
 * categories to include, categories to exclude, and one person.
 *
 * It edits a DRAFT and only commits on Done, so half-made choices never make
 * the screen re-query. "Clear filters" resets everything except the period,
 * which always has to be something.
 *
 * Include vs exclude are mutually exclusive per category: picking a category
 * in one list removes it from the other, so the two can never contradict.
 *
 * Layout note — the scrim is a SIBLING behind the sheet, never an ancestor of
 * the ScrollView. Wrapping the sheet in a Pressable makes it claim the touch
 * responder, so drags that begin on empty space (the gap beside a wrapped chip
 * row) never reach the ScrollView and the sheet appears to only scroll from
 * on top of a control.
 */
import { Feather } from '@expo/vector-icons';
import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ChipSelector, type ChipItem } from '@/components/ChipSelector';
import { DateRangePicker } from '@/components/reports/DateRangePicker';
import type { Account, Category, CategoryKind, Person } from '@/domain/types';
import {
  customPeriod,
  periodFor,
  rangeLabel,
  RANGE_PRESETS,
  type Period,
  type RangePreset,
} from '@/domain/reportRange';
import { useTheme } from '@/theme/ThemeContext';
import { layout, minTouchTarget, radius, screenPaddingH, space, type } from '@/theme/tokens';

export interface ReportFilterValue {
  period: Period;
  accountId: string | null;
  personId: string | null;
  /** Empty = every category. */
  includeCategoryIds: string[];
  excludeCategoryIds: string[];
}

interface Props {
  visible: boolean;
  value: ReportFilterValue;
  accounts: Account[];
  categories: Category[];
  people: Person[];
  onClose: () => void;
  onApply: (value: ReportFilterValue) => void;
}

const ALL = '__all__';

/** True when anything beyond the period narrows the report. */
export function hasActiveFilters(value: ReportFilterValue): boolean {
  return (
    value.accountId != null ||
    value.personId != null ||
    value.includeCategoryIds.length > 0 ||
    value.excludeCategoryIds.length > 0
  );
}

type KindFilter = CategoryKind | 'all';

const KIND_FILTERS: { value: KindFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'expense', label: 'Expense' },
  { value: 'income', label: 'Income' },
];

const PRESET_OPTIONS: { value: RangePreset; label: string }[] = [
  ...RANGE_PRESETS,
  { value: 'custom', label: 'Custom' },
];

function toggle(list: string[], id: string): string[] {
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
}

export function ReportFilterSheet({ visible, ...rest }: Props) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={rest.onClose}>
      {/* The body is mounted fresh on each open, so its draft always starts
          from `value` and a dismissed edit is genuinely discarded. */}
      {visible ? <FilterSheetBody {...rest} /> : null}
    </Modal>
  );
}

function FilterSheetBody({
  value,
  accounts,
  categories,
  people,
  onClose,
  onApply,
}: Omit<Props, 'visible'>) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  const [draft, setDraft] = useState<ReportFilterValue>(value);
  const [includeKind, setIncludeKind] = useState<KindFilter>('all');
  const [excludeKind, setExcludeKind] = useState<KindFilter>('all');
  const [calendarOpen, setCalendarOpen] = useState(false);

  const setPreset = (preset: RangePreset) => {
    if (preset === 'custom') {
      setCalendarOpen(true);
      return;
    }
    setDraft((d) => ({ ...d, period: periodFor(preset, d.period.anchor) }));
  };

  const toggleCategory = (list: 'includeCategoryIds' | 'excludeCategoryIds', id: string) => {
    const other = list === 'includeCategoryIds' ? 'excludeCategoryIds' : 'includeCategoryIds';
    setDraft((d) =>
      id === ALL
        ? { ...d, [list]: [] }
        : { ...d, [list]: toggle(d[list], id), [other]: d[other].filter((x) => x !== id) },
    );
  };

  const categoryChips = (kind: KindFilter): ChipItem[] => [
    { id: ALL, label: 'All', icon: 'grid' },
    ...categories
      .filter((c) => kind === 'all' || c.kind === kind)
      .map((c) => ({
        id: c.id,
        label: c.name,
        icon: (c.icon ?? 'circle') as ChipItem['icon'],
        color: c.color,
      })),
  ];

  const accountChips: ChipItem[] = [
    { id: ALL, label: 'All', icon: 'grid' },
    ...accounts.map((a) => ({
      id: a.id,
      label: a.name,
      icon: (a.icon ?? 'credit-card') as ChipItem['icon'],
      color: a.color,
    })),
  ];

  const personChips: ChipItem[] = [
    { id: ALL, label: 'All', icon: 'grid' },
    ...people.map((p) => ({ id: p.id, label: p.name, icon: 'user' as const })),
  ];

  return (
    <View style={styles.root}>
      {/* Sibling, not a wrapper — see the note at the top of the file. */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Close filters"
        onPress={onClose}
        style={styles.scrim}
      />

      <View style={[styles.sheet, { backgroundColor: colors.bg, paddingBottom: insets.bottom }]}>
        <View style={styles.grabberRow}>
          <View style={[styles.grabber, { backgroundColor: colors.border }]} />
        </View>

        <View style={styles.titleRow}>
          <Text style={[type.h1, { color: colors.text }]}>Filter</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close"
            onPress={onClose}
            hitSlop={space.sm}
            style={styles.closeHit}>
            <Feather name="x" size={22} color={colors.textMuted} />
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          {/* Period */}
          <View style={styles.section}>
            <Text style={[type.label, { color: colors.textMuted }]}>Period</Text>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Date range: ${rangeLabel(draft.period)}. Opens a calendar.`}
              onPress={() => setCalendarOpen(true)}
              style={({ pressed }) => [
                styles.rangeButton,
                { backgroundColor: colors.surfaceAlt },
                pressed && styles.pressed,
              ]}>
              <Feather name="calendar" size={18} color={colors.primary} />
              <Text numberOfLines={1} style={[type.body, styles.rangeLabel, { color: colors.text }]}>
                {rangeLabel(draft.period)}
              </Text>
              <Feather name="chevron-right" size={18} color={colors.textSubtle} />
            </Pressable>

            <View style={styles.presetRow}>
              {PRESET_OPTIONS.map((preset) => {
                const selected = draft.period.preset === preset.value;
                return (
                  <Pressable
                    key={preset.value}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    onPress={() => setPreset(preset.value)}
                    style={[
                      styles.preset,
                      { backgroundColor: selected ? colors.primary : colors.surfaceAlt },
                    ]}>
                    <Text style={[type.label, { color: selected ? colors.onPrimary : colors.text }]}>
                      {preset.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          {/* Account */}
          <View style={styles.section}>
            <Text style={[type.label, { color: colors.textMuted }]}>Select account</Text>
            <ChipSelector
              items={accountChips}
              selectedId={draft.accountId ?? ALL}
              onSelect={(id) => setDraft((d) => ({ ...d, accountId: id === ALL ? null : id }))}
            />
          </View>

          {/* Include categories */}
          <View style={styles.section}>
            <Text style={[type.label, { color: colors.textMuted }]}>Include categories</Text>
            <KindPills value={includeKind} onChange={setIncludeKind} />
            <ChipSelector
              items={categoryChips(includeKind)}
              selectedIds={draft.includeCategoryIds.length > 0 ? draft.includeCategoryIds : [ALL]}
              onSelect={(id) => toggleCategory('includeCategoryIds', id)}
            />
          </View>

          {/* Exclude categories */}
          <View style={styles.section}>
            <Text style={[type.label, { color: colors.textMuted }]}>Exclude categories</Text>
            <KindPills value={excludeKind} onChange={setExcludeKind} />
            <ChipSelector
              items={categoryChips(excludeKind)}
              selectedIds={draft.excludeCategoryIds.length > 0 ? draft.excludeCategoryIds : [ALL]}
              onSelect={(id) => toggleCategory('excludeCategoryIds', id)}
            />
          </View>

          {/* Person */}
          <View style={styles.section}>
            <Text style={[type.label, { color: colors.textMuted }]}>Select a person</Text>
            <Text style={[type.caption, { color: colors.textSubtle }]}>
              Spending and income tagged with someone — lending balances live on the People screen.
            </Text>
            <ChipSelector
              items={personChips}
              selectedId={draft.personId ?? ALL}
              onSelect={(id) => setDraft((d) => ({ ...d, personId: id === ALL ? null : id }))}
              emptyHint="No people yet."
            />
          </View>
        </ScrollView>

        <View style={[styles.footer, { borderTopColor: colors.border, backgroundColor: colors.bg }]}>
          <Pressable
            accessibilityRole="button"
            onPress={() =>
              setDraft((d) => ({
                period: d.period,
                accountId: null,
                personId: null,
                includeCategoryIds: [],
                excludeCategoryIds: [],
              }))
            }
            style={styles.clear}>
            <Text style={[type.label, { color: colors.primary }]}>Clear filters</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() => onApply(draft)}
            style={[styles.done, { backgroundColor: colors.primary }]}>
            <Text style={[type.label, { color: colors.onPrimary }]}>Done</Text>
          </Pressable>
        </View>

        {calendarOpen ? (
          <DateRangePicker
            startDay={draft.period.range.startDay}
            endDay={draft.period.range.endDay}
            onCancel={() => setCalendarOpen(false)}
            onApply={(startDay, endDay) => {
              setDraft((d) => ({ ...d, period: customPeriod(startDay, endDay) }));
              setCalendarOpen(false);
            }}
          />
        ) : null}
      </View>
    </View>
  );
}

function KindPills({ value, onChange }: { value: KindFilter; onChange: (v: KindFilter) => void }) {
  const { colors } = useTheme();
  return (
    <View style={styles.kindRow}>
      {KIND_FILTERS.map((k) => {
        const selected = k.value === value;
        return (
          <Pressable
            key={k.value}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            onPress={() => onChange(k.value)}
            style={[
              styles.kindPill,
              {
                backgroundColor: selected ? colors.primarySoft : 'transparent',
                borderColor: selected ? colors.primary : colors.border,
              },
            ]}>
            <Text style={[type.caption, { color: selected ? colors.primary : colors.textMuted }]}>
              {k.label}
            </Text>
          </Pressable>
        );
      })}
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
    maxHeight: '90%',
    borderTopLeftRadius: layout.sheetRadius,
    borderTopRightRadius: layout.sheetRadius,
    overflow: 'hidden',
  },
  grabberRow: { alignItems: 'center', paddingTop: space.sm },
  grabber: { width: 36, height: 4, borderRadius: radius.pill },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: screenPaddingH,
    paddingTop: space.sm,
  },
  closeHit: {
    minWidth: minTouchTarget,
    minHeight: minTouchTarget,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  body: { padding: screenPaddingH, gap: space.xl, paddingBottom: space.xl },
  section: { gap: space.sm },
  rangeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: minTouchTarget + space.sm,
    paddingHorizontal: space.lg,
    borderRadius: radius.pill,
  },
  rangeLabel: { flex: 1 },
  pressed: { opacity: 0.7 },
  presetRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  preset: {
    paddingVertical: layout.chipPaddingV,
    paddingHorizontal: layout.chipPaddingH,
    borderRadius: radius.pill,
    minHeight: Math.max(36, minTouchTarget - space.sm),
    justifyContent: 'center',
  },
  kindRow: { flexDirection: 'row', gap: space.sm },
  kindPill: {
    paddingVertical: space.xs + 2,
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: screenPaddingH,
    paddingVertical: space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  clear: { minHeight: minTouchTarget, justifyContent: 'center', paddingHorizontal: space.md },
  done: {
    flex: 1,
    height: layout.primaryButtonH,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
