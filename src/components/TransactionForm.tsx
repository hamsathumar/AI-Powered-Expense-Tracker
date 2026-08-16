/**
 * The transaction form (spec §8.5) — shared by manual entry and queue
 * editing. The TypeSelector drives which fields render, mirroring the
 * discriminated union exactly. The caller decides what happens on submit
 * (insert as pending / update in place).
 */
import { Feather } from '@expo/vector-icons';
import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { AmountDisplay } from '@/components/AmountDisplay';
import { ChipSelector, type ChipItem } from '@/components/ChipSelector';
import { DateTimeField } from '@/components/DateTimeField';
import { Keypad } from '@/components/Keypad';
import { PeoplePicker } from '@/components/PeoplePicker';
import { TypeSelector } from '@/components/TypeSelector';
import { createAccount, listAccounts } from '@/db/queries/accounts';
import { listCategories } from '@/db/queries/categories';
import { createPerson, listPeople } from '@/db/queries/people';
import type { NewTransaction } from '@/db/queries/transactions';
import {
  displayMinor,
  expressionString,
  initialKeypadState,
  keypadFromMinor,
  pressKey,
  resultMinor,
  type KeypadKey,
} from '@/domain/keypad';
import type {
  Account,
  Category,
  LendingDirection,
  Person,
  Transaction,
  TransactionType,
} from '@/domain/types';
import { useTheme } from '@/theme/ThemeContext';
import { keypadShadow, layout, radius, screenPaddingH, space, type } from '@/theme/tokens';

// Enough scroll clearance so no field hides behind the pinned keypad panel.
const KEYPAD_CLEARANCE = 470;
// When the keypad is hidden the pinned Save bar takes its place; leave enough
// room so the last field never scrolls beneath it.
const SAVE_BAR_CLEARANCE = 120;

const DIRECTION_OPTIONS: { value: LendingDirection; label: string }[] = [
  { value: 'lend', label: 'Lent out' },
  { value: 'lend_repayment_received', label: 'They repaid me' },
  { value: 'borrow', label: 'Borrowed' },
  { value: 'borrow_repayment_made', label: 'I repaid them' },
];

interface Props {
  title: string;
  submitLabel: string;
  initial?: Transaction;
  onSubmit: (tx: NewTransaction) => Promise<void>;
}

export function TransactionForm({ title, submitLabel, initial, onSubmit }: Props) {
  const { colors } = useTheme();

  const [txType, setTxType] = useState<TransactionType>(initial?.type ?? 'expense');
  const [name, setName] = useState(initial?.name ?? '');
  const [keypad, setKeypad] = useState(() =>
    initial ? keypadFromMinor(initial.amountMinor) : initialKeypadState(),
  );
  const [accountId, setAccountId] = useState<string | null>(initial?.accountId ?? null);
  const [toAccountId, setToAccountId] = useState<string | null>(
    initial?.type === 'transfer' ? initial.toAccountId : null,
  );
  const [categoryId, setCategoryId] = useState<string | null>(
    initial?.type === 'expense' || initial?.type === 'income' ? initial.categoryId : null,
  );
  const [personId, setPersonId] = useState<string | null>(
    initial?.type === 'transfer' ? null : (initial?.personId ?? null),
  );
  const [direction, setDirection] = useState<LendingDirection>(
    initial?.type === 'lending' ? initial.direction : 'lend',
  );
  const [occurredAt, setOccurredAt] = useState(() =>
    initial ? new Date(initial.occurredAt) : new Date(),
  );
  const [description, setDescription] = useState(initial?.description ?? '');
  const [saving, setSaving] = useState(false);
  const [personPickerOpen, setPersonPickerOpen] = useState(false);
  // The amount keypad is a CONTEXTUAL input accessory: it shows only while the
  // Amount field is focused. Focusing a text field (Name/Note) blurs the
  // amount and lets the system keyboard take over; tapping the amount brings
  // the keypad back. Dismissing the system keyboard does NOT auto-show the
  // keypad — visibility tracks amount focus alone, never the keyboard. Start
  // focused so the primary action (entering the amount) is ready immediately.
  const [amountFocused, setAmountFocused] = useState(true);

  const focusAmount = () => {
    Keyboard.dismiss(); // dismiss the system keyboard if a text field had it
    setAmountFocused(true);
  };
  const blurAmount = () => {
    Keyboard.dismiss();
    setAmountFocused(false);
  };
  const onKeypadKey = (k: KeypadKey) => {
    setKeypad((s) => pressKey(s, k));
    // '=' resolves the calculation into the amount and exits keypad mode.
    if (k === 'equals') setAmountFocused(false);
  };

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [expenseCategories, setExpenseCategories] = useState<Category[]>([]);
  const [incomeCategories, setIncomeCategories] = useState<Category[]>([]);
  const [people, setPeople] = useState<Person[]>([]);

  const reload = useCallback(async () => {
    const [acc, exp, inc, ppl] = await Promise.all([
      listAccounts(),
      listCategories('expense'),
      listCategories('income'),
      listPeople(),
    ]);
    setAccounts(acc);
    setExpenseCategories(exp);
    setIncomeCategories(inc);
    setPeople(ppl);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async load
    reload().catch((e) => Alert.alert('Database error', String(e)));
  }, [reload]);

  const categories = txType === 'income' ? incomeCategories : expenseCategories;
  const selectedPersonName = people.find((p) => p.id === personId)?.name ?? null;

  const createPersonAndReload = async (name: string) => {
    const person = await createPerson(name);
    await reload();
    return person;
  };

  const addAccount = () => {
    Alert.prompt('New account', 'Name (created as Cash — edit later in Accounts)', async (text) => {
      const trimmed = text?.trim();
      if (!trimmed) return;
      const account = await createAccount({ name: trimmed, type: 'cash' });
      await reload();
      setAccountId((prev) => prev ?? account.id);
    });
  };

  const buildTransaction = (): NewTransaction | string => {
    const amountMinor = resultMinor(keypad);
    if (amountMinor === null) return 'Enter an amount above zero.';
    if (!name.trim()) return 'Give the transaction a short name.';
    if (!accountId) return 'Pick an account.';

    const base = {
      status: initial?.status ?? ('pending' as const),
      source: initial?.source ?? ('manual' as const),
      name: name.trim(),
      amountMinor,
      occurredAt: occurredAt.toISOString(),
      description: description.trim() || undefined,
      transcript: initial?.transcript,
      confidenceFlags: initial?.confidenceFlags ?? [],
      billSplitId: initial?.billSplitId,
      recurringId: initial?.recurringId,
    };

    switch (txType) {
      case 'expense':
      case 'income':
        // Person belongs to Lending / Bill Split, not plain expense/income.
        if (!categoryId) return 'Pick a category.';
        return { ...base, type: txType, accountId, categoryId };
      case 'transfer':
        if (!toAccountId) return 'Pick the destination account.';
        if (toAccountId === accountId) return 'Transfer needs two different accounts.';
        return { ...base, type: 'transfer', accountId, toAccountId };
      case 'lending':
        if (!personId) return 'Pick a person.';
        return { ...base, type: 'lending', accountId, personId, direction };
    }
  };

  const save = async () => {
    const result = buildTransaction();
    if (typeof result === 'string') {
      Alert.alert('Not quite', result);
      return;
    }
    setSaving(true);
    try {
      await onSubmit(result);
    } catch (e) {
      Alert.alert('Save failed', String(e));
      setSaving(false);
    }
  };

  const accountChips: ChipItem[] = accounts.map((a) => ({ id: a.id, label: a.name }));
  const showCategory = txType === 'expense' || txType === 'income';

  const categoryField = showCategory ? (
    <ChipSelector
      label="Category"
      items={categories.map((c) => ({
        id: c.id,
        label: c.name,
        icon: c.icon as ChipItem['icon'],
        color: c.color,
      }))}
      selectedId={categoryId}
      onSelect={setCategoryId}
    />
  ) : null;

  return (
    <View style={styles.flex}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}>
        <ScrollView
          contentContainerStyle={[
            styles.container,
            { paddingBottom: amountFocused ? KEYPAD_CLEARANCE : SAVE_BAR_CLEARANCE },
          ]}
          keyboardShouldPersistTaps="handled">
          {/* Tapping empty space blurs the amount, dismissing the keypad. */}
          <Pressable onPress={blurAmount} style={styles.fields}>
            <Text style={[type.h1, { color: colors.text }]}>{title}</Text>

            <TypeSelector value={txType} onChange={setTxType} />

            {/* Tapping the amount focuses it and brings the keypad back. */}
            <Pressable accessibilityRole="button" accessibilityLabel="Edit amount" onPress={focusAmount}>
              <AmountDisplay valueMinor={displayMinor(keypad)} txType={txType} />
            </Pressable>

            <View style={styles.fieldGroup}>
              <Text style={[type.label, { color: colors.textMuted }]}>Name</Text>
              <TextInput
                value={name}
                onChangeText={setName}
                onFocus={() => setAmountFocused(false)}
                placeholder={txType === 'transfer' ? 'e.g. To savings' : 'e.g. Lunch'}
                placeholderTextColor={colors.textSubtle}
                style={[
                  type.input,
                  styles.textField,
                  { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text },
                ]}
              />
            </View>

            <ChipSelector
              label={txType === 'transfer' ? 'From account' : 'Account'}
              items={accountChips}
              selectedId={accountId}
              onSelect={setAccountId}
              onAddNew={addAccount}
              emptyHint="No accounts yet — add one."
            />

            {txType === 'transfer' ? (
              <ChipSelector
                label="To account"
                items={accountChips.filter((a) => a.id !== accountId)}
                selectedId={toAccountId}
                onSelect={setToAccountId}
                emptyHint="Add a second account to transfer."
              />
            ) : null}

            {txType === 'lending' ? (
              <ChipSelector
                label="Direction"
                items={DIRECTION_OPTIONS.map((d) => ({ id: d.value, label: d.label }))}
                selectedId={direction}
                onSelect={(id) => setDirection(id as LendingDirection)}
              />
            ) : null}

            {/* Person is only for Lending — expense/income use Bill Split to
                involve people. Chosen from the People sheet, not a chip wrap. */}
            {txType === 'lending' ? (
              <View style={styles.fieldGroup}>
                <Text style={[type.label, { color: colors.textMuted }]}>Person</Text>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => {
                    setAmountFocused(false);
                    setPersonPickerOpen(true);
                  }}
                  style={[
                    styles.selectField,
                    { backgroundColor: colors.surface, borderColor: colors.border },
                  ]}>
                  <Text
                    style={[
                      type.body,
                      { color: selectedPersonName ? colors.text : colors.textSubtle },
                    ]}>
                    {selectedPersonName ?? 'Choose a person'}
                  </Text>
                  <Feather name="chevron-down" size={18} color={colors.textSubtle} />
                </Pressable>
              </View>
            ) : null}

            <View style={styles.fieldGroup}>
              <Text style={[type.label, { color: colors.textMuted }]}>Date</Text>
              <DateTimeField value={occurredAt} onChange={setOccurredAt} />
            </View>

            {/* Expense/income order (v2 fix): Amount, Name, Account, Date,
                Category, Note — Category is second-last, before Note. */}
            {categoryField}

            <View style={styles.fieldGroup}>
              <Text style={[type.label, { color: colors.textMuted }]}>Note (optional)</Text>
              <TextInput
                value={description}
                onChangeText={setDescription}
                onFocus={() => setAmountFocused(false)}
                placeholder="Anything worth remembering"
                placeholderTextColor={colors.textSubtle}
                multiline
                style={[
                  type.body,
                  styles.textField,
                  styles.multiline,
                  { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text },
                ]}
              />
            </View>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Contextual keypad: visible only while the Amount field is focused.
          When it's hidden the keypad's Save goes with it, so a pinned Save bar
          takes its place — otherwise there'd be no way to submit once you've
          moved off the amount (e.g. after typing a Note). */}
      {amountFocused ? (
        <Keypad
          onKey={onKeypadKey}
          onSave={save}
          saveLabel={submitLabel}
          expression={expressionString(keypad)}
          saving={saving}
        />
      ) : (
        <View style={[styles.saveBar, keypadShadow, { backgroundColor: colors.surface, borderTopColor: colors.border }]}>
          <Pressable
            accessibilityRole="button"
            disabled={saving}
            onPress={save}
            style={({ pressed }) => [
              styles.saveButton,
              { backgroundColor: pressed ? colors.primaryPress : colors.primary },
              saving && styles.disabled,
            ]}>
            <Text style={[type.h2, { color: colors.onPrimary }]}>
              {saving ? 'Saving…' : submitLabel}
            </Text>
          </Pressable>
        </View>
      )}

      <PeoplePicker
        visible={personPickerOpen}
        title="Choose a person"
        multiple={false}
        options={people.map((p) => ({ id: p.id, name: p.name }))}
        selectedIds={personId ? [personId] : []}
        onClose={() => setPersonPickerOpen(false)}
        onDone={(ids) => setPersonId(ids[0] ?? null)}
        onCreatePerson={createPersonAndReload}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: {
    paddingHorizontal: screenPaddingH,
  },
  fields: { gap: space.xl },
  fieldGroup: { gap: space.sm },
  textField: {
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  },
  multiline: { minHeight: 64, textAlignVertical: 'top' },
  selectField: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    minHeight: 48,
  },
  saveBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: screenPaddingH,
    paddingTop: space.md,
    paddingBottom: space.xxl,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  saveButton: {
    minHeight: layout.primaryButtonH,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabled: { opacity: 0.6 },
});
