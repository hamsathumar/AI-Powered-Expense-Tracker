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
 */
import DateTimePicker from '@react-native-community/datetimepicker';
import { Feather } from '@expo/vector-icons';
import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ChipSelector, type ChipItem } from '@/components/ChipSelector';
import type { Account, Category, CategoryKind, Person } from '@/domain/types';
import {
  customPeriod,
  fromDay,
  periodFor,
  rangeLabel,
  toDay,
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
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();

  const [draft, setDraft] = useState<ReportFilterValue>(value);
  const [includeKind, setIncludeKind] = useState<KindFilter>('all');
  const [excludeKind, setExcludeKind] = useState<KindFilter>('all');

  const setPreset = (preset: RangePreset) => {
    if (preset === 'custom') {
      setDraft((d) => ({ ...d, period: customPeriod(d.period.range.startDay, d.period.range.endDay) }));
      return;
    }
    setDraft((d) => ({ ...d, period: periodFor(preset, d.period.anchor) }));
  };

  const setCustomDay = (edge: 'start' | 'end', date: Date) => {
    setDraft((d) => {
      const day = toDay(date);
      const { startDay, endDay } = d.period.range;
      return {
        ...d,
        period: edge === 'start' ? customPeriod(day, endDay) : customPeriod(startDay, day),
      };
    });
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

  const isCustom = draft.period.preset === 'custom';

  return (
    <Pressable style={styles.scrim} onPress={onClose}>
        <Pressable
          style={[styles.sheet, { backgroundColor: colors.bg, paddingBottom: insets.bottom }]}
          onPress={() => {}}>
          <View style={styles.grabberRow}>
            <View style={[styles.grabber, { backgroundColor: colors.border }]} />
          </View>

          <View style={styles.titleRow}>
            <Text style={[type.h1, { color: colors.text }]}>Filter</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} hitSlop={space.sm}>
              <Feather name="x" size={22} color={colors.textMuted} />
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
            {/* Period */}
            <View style={styles.section}>
              <Text style={[type.label, { color: colors.textMuted }]}>Period</Text>
              <View style={styles.presetRow}>
                {[...RANGE_PRESETS, { value: 'custom' as const, label: 'Custom' }].map((p) => {
                  const selected = draft.period.preset === p.value;
                  return (
                    <Pressable
                      key={p.value}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                      onPress={() => setPreset(p.value)}
                      style={[
                        styles.preset,
                        {
                          backgroundColor: selected ? colors.primary : colors.surfaceAlt,
                        },
                      ]}>
                      <Text style={[type.label, { color: selected ? colors.onPrimary : colors.text }]}>
                        {p.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              <View style={[styles.rangeCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <View style={styles.rangeHead}>
                  <Feather name="calendar" size={16} color={colors.primary} />
                  <Text style={[type.body, styles.rangeLabel, { color: colors.text }]}>
                    {rangeLabel(draft.period)}
                  </Text>
                </View>
                <View style={styles.rangeRow}>
                  <Text style={[type.caption, { color: colors.textMuted }]}>From</Text>
                  <DateTimePicker
                    value={fromDay(draft.period.range.startDay)}
                    mode="date"
                    display="compact"
                    accentColor={colors.primary}
                    themeVariant={isDark ? 'dark' : 'light'}
                    onChange={(_e, date) => date && setCustomDay('start', date)}
                  />
                  <Text style={[type.caption, { color: colors.textMuted }]}>To</Text>
                  <DateTimePicker
                    value={fromDay(draft.period.range.endDay)}
                    mode="date"
                    display="compact"
                    accentColor={colors.primary}
                    themeVariant={isDark ? 'dark' : 'light'}
                    onChange={(_e, date) => date && setCustomDay('end', date)}
                  />
                </View>
                {isCustom ? null : (
                  <Text style={[type.caption, { color: colors.textSubtle }]}>
                    Changing a date switches to a custom range.
                  </Text>
                )}
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
      </Pressable>
    </Pressable>
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
              { backgroundColor: selected ? colors.primarySoft : 'transparent', borderColor: selected ? colors.primary : colors.border },
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
  // Conventional modal scrim (chrome, not a themeable design colour).
  scrim: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: {
    maxHeight: '90%',
    borderTopLeftRadius: layout.sheetRadius,
    borderTopRightRadius: layout.sheetRadius,
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
  body: { padding: screenPaddingH, gap: space.xl, paddingBottom: space.xl },
  section: { gap: space.sm },
  presetRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  preset: {
    paddingVertical: layout.chipPaddingV,
    paddingHorizontal: layout.chipPaddingH,
    borderRadius: radius.pill,
    minHeight: Math.max(36, minTouchTarget - space.sm),
    justifyContent: 'center',
  },
  rangeCard: {
    borderRadius: layout.cardRadius,
    borderWidth: StyleSheet.hairlineWidth,
    padding: space.md,
    gap: space.sm,
  },
  rangeHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  rangeLabel: { flex: 1 },
  rangeRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' },
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
