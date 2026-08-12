/**
 * The transaction form (spec §8.5) — shared by manual entry and queue
 * editing. The TypeSelector drives which fields render, mirroring the
 * discriminated union exactly. The caller decides what happens on submit
 * (insert as pending / update in place).
 */
import DateTimePicker from '@react-native-community/datetimepicker';
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
import { Keypad } from '@/components/Keypad';
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
import { radius, screenPaddingH, space, type } from '@/theme/tokens';

// Enough scroll clearance so no field hides behind the pinned keypad panel.
const KEYPAD_CLEARANCE = 360;

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
  const { colors, isDark } = useTheme();

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
  // The amount keypad is pinned to the bottom; while a text field (Name/Note)
  // has focus the iOS keyboard would cover it, hiding Save. Hide the keypad
  // then and restore it on dismiss so the form stays usable in both modes.
  // Only the text fields raise the system keyboard (the amount keypad is plain
  // Views), so these events map exactly to text-field focus/blur.
  const [keyboardUp, setKeyboardUp] = useState(false);
  useEffect(() => {
    const show = Keyboard.addListener('keyboardWillShow', () => setKeyboardUp(true));
    const hide = Keyboard.addListener('keyboardWillHide', () => setKeyboardUp(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

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

  const addPerson = () => {
    Alert.prompt('New person', 'Name', async (text) => {
      const trimmed = text?.trim();
      if (!trimmed) return;
      const person = await createPerson(trimmed);
      await reload();
      setPersonId(person.id);
    });
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
        if (!categoryId) return 'Pick a category.';
        return { ...base, type: txType, accountId, categoryId, personId: personId ?? undefined };
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

  return (
    <View style={styles.flex}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}>
        <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
          <Text style={[type.h1, { color: colors.text }]}>{title}</Text>

          <TypeSelector value={txType} onChange={setTxType} />

          {/* Tapping the amount dismisses the text keyboard, bringing the
              number keypad back into view. */}
          <Pressable accessibilityRole="button" onPress={Keyboard.dismiss}>
            <AmountDisplay
              valueMinor={displayMinor(keypad)}
              txType={txType}
              expression={expressionString(keypad)}
            />
          </Pressable>

        <View style={styles.fieldGroup}>
          <Text style={[type.label, { color: colors.textMuted }]}>Name</Text>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder={txType === 'transfer' ? 'e.g. To savings' : 'e.g. Lunch'}
            placeholderTextColor={colors.textSubtle}
            style={[
              type.body,
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

        {showCategory ? (
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
        ) : null}

        {txType === 'lending' ? (
          <ChipSelector
            label="Direction"
            items={DIRECTION_OPTIONS.map((d) => ({ id: d.value, label: d.label }))}
            selectedId={direction}
            onSelect={(id) => setDirection(id as LendingDirection)}
          />
        ) : null}

        {txType !== 'transfer' ? (
          <ChipSelector
            label={txType === 'lending' ? 'Person' : 'Person (optional)'}
            items={people.map((p) => ({ id: p.id, label: p.name }))}
            selectedId={personId}
            onSelect={(id) => setPersonId((prev) => (prev === id ? null : id))}
            onAddNew={addPerson}
            emptyHint="No people yet — add one."
          />
        ) : null}

        <View style={styles.fieldGroup}>
          <Text style={[type.label, { color: colors.textMuted }]}>When</Text>
          <View style={styles.pickerRow}>
            <DateTimePicker
              value={occurredAt}
              mode="datetime"
              display="compact"
              onChange={(_event, date) => date && setOccurredAt(date)}
              themeVariant={isDark ? 'dark' : 'light'}
              accentColor={colors.primary}
            />
          </View>
        </View>

        <View style={styles.fieldGroup}>
          <Text style={[type.label, { color: colors.textMuted }]}>Note (optional)</Text>
          <TextInput
            value={description}
            onChangeText={setDescription}
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

      </ScrollView>
      </KeyboardAvoidingView>

      {/* Hidden while a text field is focused so the iOS keyboard can take the
          bottom; it returns (with Save) once the keyboard is dismissed. */}
      {keyboardUp ? null : (
        <Keypad
          onKey={(k: KeypadKey) => setKeypad((s) => pressKey(s, k))}
          onSave={save}
          saveLabel={submitLabel}
          saving={saving}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: {
    paddingHorizontal: screenPaddingH,
    paddingBottom: KEYPAD_CLEARANCE,
    gap: space.xl,
  },
  fieldGroup: { gap: space.sm },
  textField: {
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  },
  multiline: { minHeight: 64, textAlignVertical: 'top' },
  pickerRow: { alignItems: 'flex-start' },
});
