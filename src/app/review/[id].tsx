/**
 * Voice operation resolution screen (Transaction AI V1).
 *
 * Lets the user resolve the fields the AI left genuinely UNSET — account,
 * category, destination, person, direction — and acknowledge any surfaced
 * conflict. The Approve button is driven by the SAME deterministic gate used at
 * commit (`evaluateApproval`); it is disabled until the operation is safe. On
 * approve, the (edited) operation is persisted and committed through the final
 * gate. Nothing is defaulted here — the user chooses every value.
 */
import { Feather } from '@expo/vector-icons';
import { format } from 'date-fns';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AmountInput } from '@/components/AmountInput';
import { DateTimeField } from '@/components/DateTimeField';
import { ScreenHeader } from '@/components/ScreenHeader';
import { commitPendingOperation } from '@/ai/commitOperation';
import { resolveDateExpression } from '@/ai/interpretation/dates';
import { evaluateApproval } from '@/ai/interpretation/gate';
import type { LendingDirection, ResolvedOperation, ResolvedRef } from '@/ai/interpretation/types';
import { listAccounts } from '@/db/queries/accounts';
import { listCategories } from '@/db/queries/categories';
import { createPerson, listPeople } from '@/db/queries/people';
import { deletePendingOperation, getPendingOperation, updatePendingOperation } from '@/db/queries/pendingOperations';
import { formatMinorUnits, parseAmountInput } from '@/domain/money';
import type { Account, Category, Person } from '@/domain/types';
import { useTheme } from '@/theme/ThemeContext';
import { fontFamily, layout, radius, space, type } from '@/theme/tokens';

const DIRECTIONS: { value: LendingDirection; label: string }[] = [
  { value: 'lend', label: 'I lent' },
  { value: 'lend_repayment_received', label: 'They repaid me' },
  { value: 'borrow', label: 'I borrowed' },
  { value: 'borrow_repayment_made', label: 'I repaid them' },
];

function resolvedRef(id: string, name: string): ResolvedRef {
  return { reference: name, id, status: 'resolved', options: [] };
}

type ThemeColors = ReturnType<typeof useTheme>['colors'];

function Chip({
  label,
  active,
  onPress,
  colors,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  colors: ThemeColors;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={[
        styles.chip,
        {
          backgroundColor: active ? colors.primary : colors.surface,
          borderColor: active ? colors.primary : colors.border,
        },
      ]}>
      <Text style={[type.label, { color: active ? colors.onPrimary : colors.text }]}>{label}</Text>
    </Pressable>
  );
}

function Group({
  title,
  children,
  colors,
}: {
  title: string;
  children: ReactNode;
  colors: ThemeColors;
}) {
  return (
    <View style={styles.group}>
      <Text style={[type.sectionLabel, { color: colors.textMuted }]}>{title}</Text>
      <View style={styles.chipWrap}>{children}</View>
    </View>
  );
}

export default function ReviewOperationScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [op, setOp] = useState<ResolvedOperation | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [expenseCats, setExpenseCats] = useState<Category[]>([]);
  const [incomeCats, setIncomeCats] = useState<Category[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  // Editable fields (audit F5). Held as their own state so a half-typed amount
  // never has to round-trip through the operation.
  const [amountText, setAmountText] = useState('');
  const [nameText, setNameText] = useState('');
  const [date, setDate] = useState<Date | null>(null);
  const [capturedAt, setCapturedAt] = useState<Date>(() => new Date());

  useEffect(() => {
    Promise.all([
      getPendingOperation(id),
      listAccounts(),
      listCategories('expense'),
      listCategories('income'),
      listPeople(),
    ])
      .then(([rec, acc, ec, ic, ppl]) => {
        if (!rec) throw new Error('Item not found');
        setOp(rec.op);
        setAccounts(acc);
        setExpenseCats(ec);
        setIncomeCats(ic);
        setPeople(ppl);
        setNameText(rec.op.name);
        setAmountText(rec.op.amountMinor === null ? '' : formatMinorUnits(rec.op.amountMinor).replace(/,/g, ''));
        // The date the operation currently means: its expression resolved
        // against the CAPTURE time, exactly as the commit path will read it.
        const reference = new Date(rec.createdAt);
        const safeReference = Number.isNaN(reference.getTime()) ? new Date() : reference;
        setCapturedAt(safeReference);
        setDate(new Date(resolveDateExpression(rec.op.dateExpression, safeReference).iso));
      })
      .catch((e) => {
        Alert.alert('Cannot open', String(e));
        router.back();
      });
  }, [id, router]);

  /**
   * The operation as the user has it right now — the edits folded in (audit
   * F5). The gate below runs on THIS, so the Approve button always reflects
   * what would actually be committed.
   */
  const editedOp = useMemo<ResolvedOperation | null>(() => {
    if (!op) return null;
    const parsedAmount = parseAmountInput(amountText);
    const amountChanged = parsedAmount !== null && parsedAmount !== op.amountMinor;

    const originalDate = new Date(resolveDateExpression(op.dateExpression, capturedAt).iso);
    const dateChanged =
      date !== null && format(date, 'yyyy-MM-dd') !== format(originalDate, 'yyyy-MM-dd');

    // Editing a field IS the confirmation the matching conflict was asking
    // for, so those clear themselves; everything else needs "Keep as-is".
    const conflicts = op.conflicts.filter((c) => {
      if (amountChanged && (c.kind === 'amount_uncertain' || c.kind === 'amount_by_reference')) return false;
      if (dateChanged && c.kind === 'date_unresolved') return false;
      return true;
    });

    return {
      ...op,
      amountMinor: parsedAmount,
      // A figure the user typed is the strongest grounding there is.
      amountProvenance: amountChanged ? 'USER_EXPLICIT' : op.amountProvenance,
      name: nameText.trim() || op.name,
      dateExpression: dateChanged ? format(date!, 'yyyy-MM-dd') : op.dateExpression,
      conflicts,
    };
  }, [op, amountText, nameText, date, capturedAt]);

  const gate = useMemo(() => (editedOp ? evaluateApproval(editedOp) : null), [editedOp]);

  // Specialized operations are completed in their dedicated editors — redirect
  // there rather than through the ordinary review screen.
  useEffect(() => {
    if (!op) return;
    if (op.kind === 'bill_split') {
      router.replace({ pathname: '/bill-split', params: { fromPending: id } });
    } else if (op.kind === 'recurring') {
      router.replace({ pathname: '/recurring/new', params: { fromPending: id } });
    }
  }, [op, id, router]);

  if (!op) {
    return <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} />;
  }

  const specialized = op.kind === 'bill_split' || op.kind === 'recurring';
  const isExpInc = op.kind === 'expense' || op.kind === 'income';
  const categories = op.operation === 'income' ? incomeCats : expenseCats;
  // What still needs confirming AFTER the user's edits are folded in.
  const conflicts = editedOp?.conflicts ?? op.conflicts;

  /**
   * "Heard 'Nusky' — did you mean Nuski?" (audit F10). Near-matches are only
   * ever offered, never applied: the ref stays ambiguous and the gate keeps
   * blocking until the user actually picks one.
   */
  const suggestionFor = (ref: ResolvedRef | null): string | null => {
    if (!ref || ref.status !== 'ambiguous' || ref.options.length === 0) return null;
    if (!ref.reference) return null;
    const names = ref.options.map((o) => o.name).join(', ');
    return `Heard “${ref.reference}” — did you mean ${names}?`;
  };

  const Suggestion = ({ refValue }: { refValue: ResolvedRef | null }) => {
    const hint = suggestionFor(refValue);
    if (!hint) return null;
    return <Text style={[type.caption, { color: colors.textSubtle }]}>{hint}</Text>;
  };

  const patch = (next: Partial<ResolvedOperation>) => setOp((prev) => (prev ? { ...prev, ...next } : prev));

  const acknowledgeConflict = (index: number) =>
    patch({ conflicts: op.conflicts.filter((_, i) => i !== index) });

  const addPersonFromReference = async () => {
    const name = op.person?.reference?.trim();
    if (!name) return;
    try {
      const person = await createPerson(name, false);
      setPeople((p) => [...p, person]);
      patch({ person: resolvedRef(person.id, person.name) });
    } catch (e) {
      // The DB-boundary guard rejected it (TC-026). Say so instead of failing silently.
      Alert.alert('Could not add person', e instanceof Error ? e.message : String(e));
    }
  };

  const save = async () => {
    if (!editedOp) return;
    await updatePendingOperation(id, editedOp);
  };

  const approve = async () => {
    await save();
    const res = await commitPendingOperation(id);
    if (res.committed) {
      router.back();
    } else {
      Alert.alert('Not ready yet', res.blockers.map((b) => b.message).join('\n'));
      setOp((prev) => prev); // keep state
    }
  };

  const reject = () => {
    deletePendingOperation(id).then(() => router.back());
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <ScreenHeader title="Finish details" />
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={[styles.summary, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[type.caption, { color: colors.textMuted }]}>{op.operation.toUpperCase()}</Text>
          {op.transcript ? (
            <Text style={[type.body, { color: colors.textSubtle, fontStyle: 'italic' }]}>“{op.transcript}”</Text>
          ) : null}
        </View>

        {/* Editable core fields (audit F5): a near-miss is fixed here, never by
            rejecting and re-entering the whole transaction by hand. */}
        {!specialized ? (
          <>
            <AmountInput value={amountText} onChange={setAmountText} />
            <View style={styles.group}>
              <Text style={[type.sectionLabel, { color: colors.textMuted }]}>Name</Text>
              <TextInput
                value={nameText}
                onChangeText={setNameText}
                placeholder="What was it for?"
                placeholderTextColor={colors.textSubtle}
                style={[
                  type.body,
                  styles.textField,
                  { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text },
                ]}
              />
            </View>
            <View style={styles.group}>
              <Text style={[type.sectionLabel, { color: colors.textMuted }]}>Date</Text>
              {date ? <DateTimeField value={date} onChange={setDate} /> : null}
              {op.dateExpression ? (
                <Text style={[type.caption, { color: colors.textSubtle }]}>You said “{op.dateExpression}”</Text>
              ) : null}
            </View>
          </>
        ) : null}

        {conflicts.length > 0 ? (
          <View style={styles.group}>
            <Text style={[type.sectionLabel, { color: colors.warning }]}>Please confirm</Text>
            {conflicts.map((c, i) => (
              <View key={i} style={[styles.conflict, { borderColor: colors.warning }]}>
                <Text style={[type.body, { color: colors.text, flex: 1 }]}>{c.note || c.kind}</Text>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => acknowledgeConflict(op.conflicts.indexOf(c))}>
                  <Text style={[type.label, { color: colors.primary }]}>Keep as-is</Text>
                </Pressable>
              </View>
            ))}
          </View>
        ) : null}

        {specialized ? (
          <View style={[styles.conflict, { borderColor: colors.border }]}>
            <Text style={[type.body, { color: colors.textMuted, flex: 1 }]}>
              Opening the {op.kind === 'bill_split' ? 'Bill Split' : 'recurring'} editor…
            </Text>
          </View>
        ) : null}

        {!specialized ? (
          <>
            <Group colors={colors} title={op.kind === 'transfer' ? 'From account' : 'Account'}>
              {accounts.map((a) => (
                <Chip
                  colors={colors}
                  key={a.id}
                  label={a.name}
                  active={op.account?.id === a.id}
                  onPress={() => patch({ account: resolvedRef(a.id, a.name) })}
                />
              ))}
            </Group>
            <Suggestion refValue={op.account} />

            {isExpInc ? (
              <>
                <Group colors={colors} title="Category">
                  {categories.map((c) => (
                    <Chip
                      colors={colors}
                      key={c.id}
                      label={c.name}
                      active={op.category?.id === c.id}
                      onPress={() => patch({ category: resolvedRef(c.id, c.name) })}
                    />
                  ))}
                </Group>
                <Suggestion refValue={op.category} />
              </>
            ) : null}

            {op.kind === 'transfer' ? (
              <>
                <Group colors={colors} title="To account">
                  {accounts
                    .filter((a) => a.id !== op.account?.id)
                    .map((a) => (
                      <Chip
                        colors={colors}
                        key={a.id}
                        label={a.name}
                        active={op.toAccount?.id === a.id}
                        onPress={() => patch({ toAccount: resolvedRef(a.id, a.name) })}
                      />
                    ))}
                </Group>
                <Suggestion refValue={op.toAccount} />
              </>
            ) : null}

            {op.kind === 'lending' ? (
              <>
                <Group colors={colors} title="Person">
                  {people.map((p) => (
                    <Chip
                  colors={colors}
                      key={p.id}
                      label={p.name}
                      active={op.person?.id === p.id}
                      onPress={() => patch({ person: resolvedRef(p.id, p.name) })}
                    />
                  ))}
                  {op.person?.reference && !people.some((p) => p.name.toLowerCase() === op.person!.reference!.toLowerCase()) ? (
                    <Chip colors={colors} label={`+ Add “${op.person.reference}”`} active={false} onPress={addPersonFromReference} />
                  ) : null}
                </Group>
                <Suggestion refValue={op.person} />
                <Group colors={colors} title="Direction">
                  {DIRECTIONS.map((d) => (
                    <Chip
                  colors={colors}
                      key={d.value}
                      label={d.label}
                      active={op.direction === d.value}
                      onPress={() => patch({ direction: d.value })}
                    />
                  ))}
                </Group>
              </>
            ) : null}
          </>
        ) : null}
      </ScrollView>

      <View style={[styles.footer, { borderTopColor: colors.border, backgroundColor: colors.bg }]}>
        <Pressable accessibilityRole="button" onPress={reject} style={[styles.footerBtn, { backgroundColor: colors.surfaceAlt }]}>
          <Feather name="trash-2" size={16} color={colors.expense} />
          <Text style={[styles.footerLabel, { color: colors.expense }]}>Reject</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          disabled={!gate?.approvable}
          onPress={approve}
          style={[styles.footerBtn, styles.approveBtn, { backgroundColor: gate?.approvable ? colors.positiveFill : colors.surfaceAlt }]}>
          <Feather name="check" size={16} color={gate?.approvable ? colors.onFilled : colors.textSubtle} />
          <Text style={[styles.footerLabel, { color: gate?.approvable ? colors.onFilled : colors.textSubtle }]}>
            Approve
          </Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: layout.screenPaddingH, gap: space.xl, paddingBottom: space.xxl },
  summary: { borderRadius: layout.cardRadius, borderWidth: StyleSheet.hairlineWidth, padding: space.lg, gap: space.sm },
  textField: {
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: space.md,
    minHeight: 48,
  },
  group: { gap: space.sm },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chip: { borderRadius: radius.pill, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: space.md, paddingVertical: space.sm },
  conflict: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    padding: space.md,
  },
  footer: { flexDirection: 'row', gap: space.md, padding: layout.screenPaddingH, borderTopWidth: StyleSheet.hairlineWidth },
  footerBtn: { height: 50, borderRadius: radius.pill, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm, paddingHorizontal: space.lg },
  approveBtn: { flex: 1 },
  footerLabel: { fontFamily: fontFamily.heading, fontSize: 15 },
});
