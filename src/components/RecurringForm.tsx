/**
 * Recurring template form (spec §5): the transaction shape minus
 * date/status, plus a schedule. Generated occurrences land in the queue as
 * pending — never auto-posted.
 */
import DateTimePicker from '@react-native-community/datetimepicker';
import { format, parseISO } from 'date-fns';
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

import { AmountInput } from '@/components/AmountInput';
import { ChipSelector, type ChipItem } from '@/components/ChipSelector';
import { TypeSelector } from '@/components/TypeSelector';
import { listAccounts } from '@/db/queries/accounts';
import { listCategories } from '@/db/queries/categories';
import { listPeople } from '@/db/queries/people';
import type { NewRecurringTemplate } from '@/db/queries/recurring';
import { formatMinorUnits, parseAmountInput } from '@/domain/money';
import { GROUP_OPTIONS } from '@/domain/recurringDisplay';
import type {
  Account,
  Category,
  LendingDirection,
  Person,
  RecurringFrequency,
  RecurringGroup,
  RecurringTemplate,
  TransactionType,
} from '@/domain/types';
import { useTheme } from '@/theme/ThemeContext';
import { minTouchTarget, radius, screenPaddingH, space, type } from '@/theme/tokens';

const FREQUENCY_OPTIONS: { id: RecurringFrequency; label: string }[] = [
  { id: 'daily', label: 'Daily' },
  { id: 'weekly', label: 'Weekly' },
  { id: 'monthly', label: 'Monthly' },
  { id: 'custom', label: 'Every N days' },
];

const DIRECTION_OPTIONS: { value: LendingDirection; label: string }[] = [
  { value: 'lend', label: 'Lent out' },
  { value: 'lend_repayment_received', label: 'They repaid me' },
  { value: 'borrow', label: 'Borrowed' },
  { value: 'borrow_repayment_made', label: 'I repaid them' },
];

interface Props {
  title: string;
  initial?: RecurringTemplate;
  onSubmit: (template: NewRecurringTemplate) => Promise<void>;
  onDelete?: () => Promise<void>;
}

export function RecurringForm({ title, initial, onSubmit, onDelete }: Props) {
  const { colors, isDark } = useTheme();

  const [txType, setTxType] = useState<TransactionType>(initial?.type ?? 'expense');
  const [name, setName] = useState(initial?.name ?? '');
  const [amountText, setAmountText] = useState(
    initial ? formatMinorUnits(initial.amountMinor).replace(/,/g, '') : '',
  );
  const [accountId, setAccountId] = useState<string | null>(initial?.accountId ?? null);
  const [toAccountId, setToAccountId] = useState<string | null>(initial?.toAccountId ?? null);
  const [categoryId, setCategoryId] = useState<string | null>(initial?.categoryId ?? null);
  const [personId, setPersonId] = useState<string | null>(initial?.personId ?? null);
  const [direction, setDirection] = useState<LendingDirection>(initial?.direction ?? 'lend');
  const [group, setGroup] = useState<RecurringGroup>(initial?.recurringGroup ?? 'other');
  const [installmentsText, setInstallmentsText] = useState(
    initial?.totalInstallments ? String(initial.totalInstallments) : '',
  );
  const [principalText, setPrincipalText] = useState(
    initial?.principalMinor ? formatMinorUnits(initial.principalMinor).replace(/,/g, '') : '',
  );
  const [frequency, setFrequency] = useState<RecurringFrequency>(initial?.frequency ?? 'monthly');
  const [intervalText, setIntervalText] = useState(
    initial?.intervalDays ? String(initial.intervalDays) : '',
  );
  const [nextDue, setNextDue] = useState(() =>
    initial ? parseISO(initial.nextDueDate) : new Date(),
  );
  const [hasEndDate, setHasEndDate] = useState(Boolean(initial?.endDate));
  const [endDate, setEndDate] = useState(() =>
    initial?.endDate ? parseISO(initial.endDate) : new Date(),
  );
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

  const categories = txType === 'income' ? incomeCategories : expenseCategories;
  const accountChips: ChipItem[] = accounts.map((a) => ({ id: a.id, label: a.name }));
  const showCategory = txType === 'expense' || txType === 'income';
  // Group taxonomy + loan tracking apply to expenses only (spec Features 4–5);
  // income/transfer/lending templates stay in the neutral 'other' group.
  const showGroup = txType === 'expense';
  const showLoanFields = showGroup && group === 'loan';

  const save = async () => {
    const amountMinor = parseAmountInput(amountText);
    if (amountMinor === null) return Alert.alert('Not quite', 'Enter a valid amount.');
    if (!name.trim()) return Alert.alert('Not quite', 'Name the template (e.g. Boarding Rent).');
    if (!accountId) return Alert.alert('Not quite', 'Pick an account.');
    if (showCategory && !categoryId) return Alert.alert('Not quite', 'Pick a category.');
    if (txType === 'transfer' && (!toAccountId || toAccountId === accountId)) {
      return Alert.alert('Not quite', 'Transfer needs two different accounts.');
    }
    if (txType === 'lending' && !personId) return Alert.alert('Not quite', 'Pick a person.');
    const intervalDays = frequency === 'custom' ? Number(intervalText) : undefined;
    if (frequency === 'custom' && (!Number.isInteger(intervalDays) || intervalDays! < 1)) {
      return Alert.alert('Not quite', 'Enter the interval in days (a whole number ≥ 1).');
    }

    // Loan tracking is optional; if the user typed values, they must be valid.
    let totalInstallments: number | undefined;
    let principalMinor: number | undefined;
    if (showLoanFields) {
      if (installmentsText.trim()) {
        const n = Number(installmentsText);
        if (!Number.isInteger(n) || n < 1) {
          return Alert.alert('Not quite', 'Installments must be a whole number ≥ 1.');
        }
        totalInstallments = n;
      }
      if (principalText.trim()) {
        const p = parseAmountInput(principalText);
        if (p === null) return Alert.alert('Not quite', 'Enter a valid loan amount.');
        principalMinor = p;
      }
    }

    setSaving(true);
    try {
      await onSubmit({
        type: txType,
        name: name.trim(),
        amountMinor,
        accountId,
        toAccountId: txType === 'transfer' ? (toAccountId ?? undefined) : undefined,
        categoryId: showCategory ? (categoryId ?? undefined) : undefined,
        personId: txType === 'transfer' ? undefined : (personId ?? undefined),
        direction: txType === 'lending' ? direction : undefined,
        frequency,
        intervalDays,
        nextDueDate: format(nextDue, 'yyyy-MM-dd'),
        endDate: hasEndDate ? format(endDate, 'yyyy-MM-dd') : undefined,
        // Preserve the lifecycle state on edit; new templates start active.
        status: initial?.status ?? 'active',
        pausedUntil: initial?.pausedUntil,
        recurringGroup: showGroup ? group : 'other',
        totalInstallments,
        principalMinor,
      });
    } catch (e) {
      Alert.alert('Save failed', String(e));
      setSaving(false);
    }
  };

  const confirmDelete = () => {
    Alert.alert('Delete template?', 'Already-generated transactions are kept.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => void onDelete?.() },
    ]);
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.flex}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text style={[type.h1, { color: colors.text }]}>{title}</Text>

        <TypeSelector value={txType} onChange={setTxType} />
        <AmountInput value={amountText} onChange={setAmountText} />

        <View style={styles.fieldGroup}>
          <Text style={[type.label, { color: colors.textMuted }]}>Name</Text>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="e.g. Boarding Rent"
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
          emptyHint="No accounts yet — create one in the Accounts tab first."
        />

        {txType === 'transfer' ? (
          <ChipSelector
            label="To account"
            items={accountChips.filter((a) => a.id !== accountId)}
            selectedId={toAccountId}
            onSelect={setToAccountId}
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

        {showGroup ? (
          <ChipSelector
            label="Group"
            items={GROUP_OPTIONS}
            selectedId={group}
            onSelect={(id) => setGroup(id as RecurringGroup)}
          />
        ) : null}

        {showLoanFields ? (
          <View style={styles.fieldGroup}>
            <Text style={[type.label, { color: colors.textMuted }]}>
              Loan amount (optional)
            </Text>
            <TextInput
              value={principalText}
              onChangeText={setPrincipalText}
              keyboardType="decimal-pad"
              placeholder="e.g. 2400000"
              placeholderTextColor={colors.textSubtle}
              style={[
                type.body,
                styles.textField,
                { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text },
              ]}
            />
            <Text style={[type.label, { color: colors.textMuted }]}>
              Total installments (optional)
            </Text>
            <TextInput
              value={installmentsText}
              onChangeText={setInstallmentsText}
              keyboardType="number-pad"
              placeholder="e.g. 24"
              placeholderTextColor={colors.textSubtle}
              style={[
                type.body,
                styles.textField,
                { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text },
              ]}
            />
            <Text style={[type.caption, { color: colors.textSubtle }]}>
              We show a progress bar once both are set — how many installments are paid and how
              much principal is left.
            </Text>
          </View>
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
          />
        ) : null}

        <ChipSelector
          label="Repeats"
          items={FREQUENCY_OPTIONS}
          selectedId={frequency}
          onSelect={(id) => setFrequency(id as RecurringFrequency)}
        />

        {frequency === 'custom' ? (
          <View style={styles.fieldGroup}>
            <Text style={[type.label, { color: colors.textMuted }]}>Interval (days)</Text>
            <TextInput
              value={intervalText}
              onChangeText={setIntervalText}
              keyboardType="number-pad"
              placeholder="e.g. 10"
              placeholderTextColor={colors.textSubtle}
              style={[
                type.body,
                styles.textField,
                { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text },
              ]}
            />
          </View>
        ) : null}

        <View style={styles.fieldGroup}>
          <Text style={[type.label, { color: colors.textMuted }]}>
            {txType === 'income' ? 'Next expected' : 'Next due'}
          </Text>
          <View style={styles.pickerRow}>
            <DateTimePicker
              value={nextDue}
              mode="date"
              display="compact"
              onChange={(_e, date) => date && setNextDue(date)}
              themeVariant={isDark ? 'dark' : 'light'}
              accentColor={colors.primary}
            />
          </View>
        </View>

        <View style={styles.fieldGroup}>
          <ChipSelector
            label="Ends"
            items={[
              { id: 'never', label: 'Never' },
              { id: 'on', label: 'On date' },
            ]}
            selectedId={hasEndDate ? 'on' : 'never'}
            onSelect={(id) => setHasEndDate(id === 'on')}
          />
          {hasEndDate ? (
            <View style={styles.pickerRow}>
              <DateTimePicker
                value={endDate}
                mode="date"
                display="compact"
                onChange={(_e, date) => date && setEndDate(date)}
                themeVariant={isDark ? 'dark' : 'light'}
                accentColor={colors.primary}
              />
            </View>
          ) : null}
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
            {saving ? 'Saving…' : 'Save template'}
          </Text>
        </Pressable>

        {onDelete ? (
          <Pressable accessibilityRole="button" onPress={confirmDelete} style={styles.deleteButton}>
            <Text style={[type.label, { color: colors.danger }]}>Delete template</Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: {
    paddingHorizontal: screenPaddingH,
    paddingBottom: space.xxl,
    gap: space.xl,
  },
  fieldGroup: { gap: space.sm },
  textField: {
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  },
  pickerRow: { alignItems: 'flex-start' },
  saveButton: {
    minHeight: minTouchTarget + space.sm,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteButton: {
    minHeight: minTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabled: { opacity: 0.6 },
});
