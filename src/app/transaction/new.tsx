/**
 * Manual transaction form (spec §8.5). The TypeSelector drives which fields
 * render — mirroring the discriminated union exactly:
 *   expense/income → account + category (+ optional person)
 *   transfer       → from-account + to-account
 *   lending        → account + person + direction
 *
 * Every save enters as status='pending' — nothing is final until approved
 * in the queue, regardless of source (spec §1).
 */
import DateTimePicker from '@react-native-community/datetimepicker';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AmountInput } from '@/components/AmountInput';
import { ChipSelector, type ChipItem } from '@/components/ChipSelector';
import { TypeSelector } from '@/components/TypeSelector';
import { createAccount, listAccounts } from '@/db/queries/accounts';
import { listCategories } from '@/db/queries/categories';
import { createPerson, listPeople } from '@/db/queries/people';
import { insertTransaction, type NewTransaction } from '@/db/queries/transactions';
import { parseAmountInput } from '@/domain/money';
import type {
  Account,
  Category,
  LendingDirection,
  Person,
  TransactionType,
} from '@/domain/types';
import { useTheme } from '@/theme/ThemeContext';
import { minTouchTarget, radius, screenPaddingH, space, type } from '@/theme/tokens';

const DIRECTION_OPTIONS: { value: LendingDirection; label: string }[] = [
  { value: 'lend', label: 'Lent out' },
  { value: 'lend_repayment_received', label: 'They repaid me' },
  { value: 'borrow', label: 'Borrowed' },
  { value: 'borrow_repayment_made', label: 'I repaid them' },
];

export default function NewTransactionScreen() {
  const { colors, isDark } = useTheme();
  const router = useRouter();

  const [txType, setTxType] = useState<TransactionType>('expense');
  const [name, setName] = useState('');
  const [amountText, setAmountText] = useState('');
  const [accountId, setAccountId] = useState<string | null>(null);
  const [toAccountId, setToAccountId] = useState<string | null>(null);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [personId, setPersonId] = useState<string | null>(null);
  const [direction, setDirection] = useState<LendingDirection>('lend');
  const [occurredAt, setOccurredAt] = useState(() => new Date());
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);

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

  // Category selection is per-kind (two separate lists — spec §3.2).
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
    // Quick-create as cash; full account management arrives in Stage 4.
    Alert.prompt('New account', 'Name (created as Cash — edit later in Accounts)', async (text) => {
      const trimmed = text?.trim();
      if (!trimmed) return;
      const account = await createAccount({ name: trimmed, type: 'cash' });
      await reload();
      setAccountId((prev) => prev ?? account.id);
    });
  };

  const buildTransaction = (): NewTransaction | string => {
    const amountMinor = parseAmountInput(amountText);
    if (amountMinor === null) return 'Enter a valid amount.';
    if (!name.trim()) return 'Give the transaction a short name.';
    if (!accountId) return 'Pick an account.';

    const base = {
      status: 'pending' as const,
      source: 'manual' as const,
      name: name.trim(),
      amountMinor,
      occurredAt: occurredAt.toISOString(),
      description: description.trim() || undefined,
      confidenceFlags: [] as const,
    };

    switch (txType) {
      case 'expense':
      case 'income':
        if (!categoryId) return 'Pick a category.';
        return {
          ...base,
          type: txType,
          accountId,
          categoryId,
          personId: personId ?? undefined,
          confidenceFlags: [],
        };
      case 'transfer':
        if (!toAccountId) return 'Pick the destination account.';
        if (toAccountId === accountId) return 'Transfer needs two different accounts.';
        return { ...base, type: 'transfer', accountId, toAccountId, confidenceFlags: [] };
      case 'lending':
        if (!personId) return 'Pick a person.';
        return { ...base, type: 'lending', accountId, personId, direction, confidenceFlags: [] };
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
      await insertTransaction(result);
      router.back();
    } catch (e) {
      Alert.alert('Save failed', String(e));
      setSaving(false);
    }
  };

  const accountChips: ChipItem[] = accounts.map((a) => ({ id: a.id, label: a.name }));
  const showCategory = txType === 'expense' || txType === 'income';

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.bg }]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}>
        <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
          <Text style={[type.h1, { color: colors.text }]}>New transaction</Text>

          <TypeSelector value={txType} onChange={setTxType} />

          <AmountInput value={amountText} onChange={setAmountText} />

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
              {saving ? 'Saving…' : 'Save (goes to Queue)'}
            </Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  flex: { flex: 1 },
  container: {
    paddingHorizontal: screenPaddingH,
    paddingBottom: space.xxl,
    gap: space.xl,
  },
  fieldGroup: { gap: space.sm },
  // Native picker manages its own size; keep it left-aligned, not stretched.
  pickerRow: { alignItems: 'flex-start' },
  textField: {
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  },
  multiline: { minHeight: 64, textAlignVertical: 'top' },
  saveButton: {
    minHeight: minTouchTarget + space.sm,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabled: { opacity: 0.6 },
});
