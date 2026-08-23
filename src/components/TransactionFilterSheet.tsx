/**
 * Filter sheet for the Accounts ledger.
 *
 * Deliberately separate from the Reports filter: this list is the ledger, so
 * it covers all four transaction types and both live statuses, while Reports
 * enforce the golden rule (approved expense/income only). Sharing one sheet
 * would invite transfers and lending into a report.
 *
 * Same structural rules as the Reports sheet: the scrim is a sibling behind
 * the sheet (never an ancestor of the ScrollView, or it eats scroll drags),
 * the body remounts on open so a dismissed edit is discarded, and the calendar
 * is an in-sheet cover rather than a nested Modal.
 */
import { Feather } from '@expo/vector-icons';
import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ChipSelector, type ChipItem } from '@/components/ChipSelector';
import { DateRangePicker } from '@/components/reports/DateRangePicker';
import type { TransactionFilter } from '@/db/queries/transactionFilterSql';
import { fromDay } from '@/domain/reportRange';
import type { Account, Category, Person, TransactionStatus, TransactionType } from '@/domain/types';
import { useTheme } from '@/theme/ThemeContext';
import { layout, minTouchTarget, radius, screenPaddingH, space, type } from '@/theme/tokens';
import { format } from 'date-fns';

const ALL = '__all__';

const TYPE_OPTIONS: { value: TransactionType; label: string; icon: ChipItem['icon'] }[] = [
  { value: 'expense', label: 'Expense', icon: 'arrow-down' },
  { value: 'income', label: 'Income', icon: 'arrow-up' },
  { value: 'transfer', label: 'Transfer', icon: 'repeat' },
  { value: 'lending', label: 'Lending', icon: 'users' },
];

const STATUS_OPTIONS: { value: TransactionStatus; label: string; icon: ChipItem['icon'] }[] = [
  { value: 'approved', label: 'Approved', icon: 'check-circle' },
  { value: 'pending', label: 'Pending', icon: 'clock' },
];

interface Props {
  visible: boolean;
  value: TransactionFilter;
  accounts: Account[];
  categories: Category[];
  people: Person[];
  onClose: () => void;
  onApply: (value: TransactionFilter) => void;
}

function toggle<T>(list: T[] | null | undefined, item: T): T[] {
  const current = list ?? [];
  return current.includes(item) ? current.filter((x) => x !== item) : [...current, item];
}

/** Human summary of the active date range, for the calendar button. */
function rangeText(filter: TransactionFilter): string {
  const { startDay, endDay } = filter;
  if (!startDay && !endDay) return 'Any date';
  if (startDay && endDay) {
    return `${format(fromDay(startDay), 'd MMM yyyy')} – ${format(fromDay(endDay), 'd MMM yyyy')}`;
  }
  if (startDay) return `From ${format(fromDay(startDay), 'd MMM yyyy')}`;
  return `Until ${format(fromDay(endDay!), 'd MMM yyyy')}`;
}

export function TransactionFilterSheet({ visible, ...rest }: Props) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={rest.onClose}>
      {visible ? <FilterBody {...rest} /> : null}
    </Modal>
  );
}

function FilterBody({
  value,
  accounts,
  categories,
  people,
  onClose,
  onApply,
}: Omit<Props, 'visible'>) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  const [draft, setDraft] = useState<TransactionFilter>(value);
  const [calendarOpen, setCalendarOpen] = useState(false);

  const accountChips: ChipItem[] = [
    { id: ALL, label: 'All', icon: 'grid' },
    ...accounts.map((a) => ({
      id: a.id,
      label: a.name,
      icon: (a.icon ?? 'credit-card') as ChipItem['icon'],
      color: a.color,
    })),
  ];

  const categoryChips: ChipItem[] = [
    { id: ALL, label: 'All', icon: 'grid' },
    ...categories.map((c) => ({
      id: c.id,
      label: c.name,
      icon: (c.icon ?? 'circle') as ChipItem['icon'],
      color: c.color,
    })),
  ];

  const personChips: ChipItem[] = [
    { id: ALL, label: 'All', icon: 'grid' },
    ...people.map((p) => ({ id: p.id, label: p.name, icon: 'user' as const })),
  ];

  return (
    <View style={styles.root}>
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
          <View style={styles.section}>
            <Text style={[type.label, { color: colors.textMuted }]}>Date range</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Date range: ${rangeText(draft)}. Opens a calendar.`}
              onPress={() => setCalendarOpen(true)}
              style={({ pressed }) => [
                styles.rangeButton,
                { backgroundColor: colors.surfaceAlt },
                pressed && styles.pressed,
              ]}>
              <Feather name="calendar" size={18} color={colors.primary} />
              <Text numberOfLines={1} style={[type.body, styles.rangeLabel, { color: colors.text }]}>
                {rangeText(draft)}
              </Text>
              {draft.startDay || draft.endDay ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Clear date range"
                  hitSlop={space.sm}
                  onPress={() => setDraft((d) => ({ ...d, startDay: null, endDay: null }))}>
                  <Feather name="x" size={18} color={colors.textSubtle} />
                </Pressable>
              ) : (
                <Feather name="chevron-right" size={18} color={colors.textSubtle} />
              )}
            </Pressable>
          </View>

          <View style={styles.section}>
            <Text style={[type.label, { color: colors.textMuted }]}>Type</Text>
            <ChipSelector
              items={TYPE_OPTIONS.map((t) => ({ id: t.value, label: t.label, icon: t.icon }))}
              selectedIds={draft.types ?? []}
              onSelect={(id) =>
                setDraft((d) => ({ ...d, types: toggle(d.types, id as TransactionType) }))
              }
            />
          </View>

          <View style={styles.section}>
            <Text style={[type.label, { color: colors.textMuted }]}>Status</Text>
            <ChipSelector
              items={STATUS_OPTIONS.map((s) => ({ id: s.value, label: s.label, icon: s.icon }))}
              selectedIds={draft.statuses ?? []}
              onSelect={(id) =>
                setDraft((d) => ({ ...d, statuses: toggle(d.statuses, id as TransactionStatus) }))
              }
            />
          </View>

          <View style={styles.section}>
            <Text style={[type.label, { color: colors.textMuted }]}>Account</Text>
            <Text style={[type.caption, { color: colors.textSubtle }]}>
              Includes transfers where this account is either end.
            </Text>
            <ChipSelector
              items={accountChips}
              selectedId={draft.accountId ?? ALL}
              onSelect={(id) => setDraft((d) => ({ ...d, accountId: id === ALL ? null : id }))}
            />
          </View>

          <View style={styles.section}>
            <Text style={[type.label, { color: colors.textMuted }]}>Category</Text>
            <ChipSelector
              items={categoryChips}
              selectedIds={
                draft.categoryIds && draft.categoryIds.length > 0 ? draft.categoryIds : [ALL]
              }
              onSelect={(id) =>
                setDraft((d) =>
                  id === ALL
                    ? { ...d, categoryIds: [] }
                    : { ...d, categoryIds: toggle(d.categoryIds, id) },
                )
              }
            />
          </View>

          <View style={styles.section}>
            <Text style={[type.label, { color: colors.textMuted }]}>Person</Text>
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
            // Search is owned by the bar on the screen, so it survives a clear.
            onPress={() => setDraft((d) => ({ search: d.search }))}
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
            startDay={draft.startDay ?? draft.endDay ?? format(new Date(), 'yyyy-MM-dd')}
            endDay={draft.endDay ?? draft.startDay ?? format(new Date(), 'yyyy-MM-dd')}
            onCancel={() => setCalendarOpen(false)}
            onApply={(startDay, endDay) => {
              setDraft((d) => ({ ...d, startDay, endDay }));
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
