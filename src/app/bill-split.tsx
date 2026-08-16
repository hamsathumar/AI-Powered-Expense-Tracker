/**
 * Bill Splitter (spec §4, §8.6) — a transaction generator, not an entity.
 * Collects total / category / participants / payer / method, previews the
 * exact shares, then atomically inserts the generated transactions (which
 * land in the queue as pending, approved independently — decision P7).
 */
import { Feather } from '@expo/vector-icons';
import * as Crypto from 'expo-crypto';
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
import { PeoplePicker } from '@/components/PeoplePicker';
import { initials } from '@/components/PersonRow';
import { ScreenHeader } from '@/components/ScreenHeader';
import { SegmentedControl } from '@/components/SegmentedControl';
import { listAccounts } from '@/db/queries/accounts';
import { listCategories } from '@/db/queries/categories';
import { createPerson, listPeople } from '@/db/queries/people';
import { insertTransactionsAtomically } from '@/db/queries/transactions';
import { equalSharesMinor, generateBillSplitTransactions } from '@/domain/billSplit';
import { formatAmount, parseAmountInput } from '@/domain/money';
import type { Account, Category, Person } from '@/domain/types';
import { useTheme } from '@/theme/ThemeContext';
import { minTouchTarget, radius, screenPaddingH, space, type } from '@/theme/tokens';

const ME = 'me';

export default function BillSplitScreen() {
  const { colors } = useTheme();
  const router = useRouter();

  const [amountText, setAmountText] = useState('');
  const [name, setName] = useState('');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [participantIds, setParticipantIds] = useState<string[]>([ME]);
  const [payerId, setPayerId] = useState<string>(ME);
  const [method, setMethod] = useState<'equal' | 'custom'>('equal');
  const [customTexts, setCustomTexts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  const [categories, setCategories] = useState<Category[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [people, setPeople] = useState<Person[]>([]);

  const reload = useCallback(async () => {
    const [cats, accs, ppl] = await Promise.all([
      listCategories('expense'),
      listAccounts(),
      listPeople(),
    ]);
    setCategories(cats);
    setAccounts(accs);
    setPeople(ppl);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async load
    reload().catch((e) => Alert.alert('Database error', String(e)));
  }, [reload]);

  const personName = (id: string) =>
    id === ME ? 'Me' : (people.find((p) => p.id === id)?.name ?? '?');

  // Commit a whole participant set (from the picker), keeping the payer valid.
  const setParticipants = (ids: string[]) => {
    if (!ids.includes(payerId)) setPayerId(ids[0] ?? ME);
    setParticipantIds(ids);
  };

  const removeParticipant = (id: string) => {
    setParticipants(participantIds.filter((x) => x !== id));
  };

  const createPersonAndReload = async (name: string) => {
    const person = await createPerson(name);
    await reload();
    return person;
  };

  /** Current shares per participant id, or null if inputs are incomplete. */
  const computeShares = (): Map<string, number> | null => {
    const totalMinor = parseAmountInput(amountText);
    if (totalMinor === null || participantIds.length === 0) return null;
    if (method === 'equal') {
      const payerIndex = Math.max(participantIds.indexOf(payerId), 0);
      const shares = equalSharesMinor(totalMinor, participantIds.length, payerIndex);
      return new Map(participantIds.map((id, i) => [id, shares[i]!]));
    }
    const entries: [string, number][] = [];
    for (const id of participantIds) {
      const minor = parseAmountInput(customTexts[id] ?? '', { allowZero: true });
      if (minor === null) return null;
      entries.push([id, minor]);
    }
    return new Map(entries);
  };

  const shares = computeShares();
  const totalMinor = parseAmountInput(amountText);
  const customSum = shares
    ? [...shares.values()].reduce((a, b) => a + b, 0)
    : null;
  const customMismatch =
    method === 'custom' && totalMinor !== null && customSum !== null && customSum !== totalMinor;

  const save = async () => {
    if (totalMinor === null) return Alert.alert('Not quite', 'Enter the bill total.');
    if (!name.trim()) return Alert.alert('Not quite', 'Name the bill (e.g. Dinner).');
    if (!categoryId) return Alert.alert('Not quite', 'Pick a category for your share.');
    if (!accountId) return Alert.alert('Not quite', 'Pick your account.');
    if (participantIds.filter((id) => id !== ME).length === 0) {
      return Alert.alert('Not quite', 'Add at least one other participant — otherwise it is just an expense.');
    }
    if (!shares) return Alert.alert('Not quite', 'Fill in every share amount.');

    setSaving(true);
    try {
      const rows = generateBillSplitTransactions({
        billSplitId: Crypto.randomUUID(),
        name: name.trim(),
        occurredAt: new Date().toISOString(),
        accountId,
        categoryId,
        totalMinor,
        myShareMinor: participantIds.includes(ME) ? (shares.get(ME) ?? 0) : 0,
        others: participantIds
          .filter((id) => id !== ME)
          .map((id) => ({ personId: id, shareMinor: shares.get(id) ?? 0 })),
        payer: payerId === ME ? { kind: 'me' } : { kind: 'person', personId: payerId },
      });
      if (rows.length === 0) {
        Alert.alert('Nothing to record', 'You are not a participant and someone else paid.');
        setSaving(false);
        return;
      }
      await insertTransactionsAtomically(rows);
      router.back();
    } catch (e) {
      Alert.alert('Split failed', String(e));
      setSaving(false);
    }
  };

  const payerChips: ChipItem[] = participantIds.map((id) => ({ id, label: personName(id) }));
  const pickerOptions = [{ id: ME, name: 'Me' }, ...people.map((p) => ({ id: p.id, name: p.name }))];

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.bg }]} edges={['top']}>
      <ScreenHeader title="Split a bill" />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}>
        <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
          {/* 1. What was it */}
          <View style={styles.fieldGroup}>
            <Text style={[type.label, { color: colors.textMuted }]}>What was it</Text>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="e.g. Dinner at Upali's"
              placeholderTextColor={colors.textSubtle}
              style={[
                type.input,
                styles.textField,
                { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text },
              ]}
            />
          </View>

          {/* 2. Total */}
          <AmountInput value={amountText} onChange={setAmountText} label="Total" />

          {/* 3. Paid from */}
          <ChipSelector
            label="Paid from"
            items={accounts.map((a) => ({ id: a.id, label: a.name }))}
            selectedId={accountId}
            onSelect={setAccountId}
            emptyHint="No accounts yet — create one in the Accounts tab first."
          />

          {/* 4. Who was in — chosen from the People sheet, listed below. */}
          <View style={styles.fieldGroup}>
            <View style={styles.participantsHeader}>
              <Text style={[type.label, { color: colors.textMuted }]}>Who was in</Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => setPickerOpen(true)}
                hitSlop={space.sm}
                style={styles.addParticipants}>
                <Feather name="user-plus" size={16} color={colors.primary} />
                <Text style={[type.label, { color: colors.primary }]}>Add</Text>
              </Pressable>
            </View>
            {participantIds.length === 0 ? (
              <Text style={[type.caption, { color: colors.textSubtle }]}>
                No participants yet — tap Add.
              </Text>
            ) : (
              <View style={styles.participantList}>
                {participantIds.map((id) => (
                  <View
                    key={id}
                    style={[styles.participantRow, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                    <View style={[styles.participantAvatar, { backgroundColor: colors.primarySoft }]}>
                      <Text style={[type.label, { color: colors.primary }]}>
                        {id === ME ? 'Me' : initials(personName(id))}
                      </Text>
                    </View>
                    <Text numberOfLines={1} style={[type.body, styles.participantName, { color: colors.text }]}>
                      {personName(id)}
                    </Text>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Remove ${personName(id)}`}
                      onPress={() => removeParticipant(id)}
                      hitSlop={space.sm}>
                      <Feather name="x" size={18} color={colors.textSubtle} />
                    </Pressable>
                  </View>
                ))}
              </View>
            )}
          </View>

          {/* Who actually paid (kept so "someone else paid" still works). */}
          <ChipSelector
            label="Who paid?"
            items={payerChips}
            selectedId={payerId}
            onSelect={setPayerId}
          />

          {/* 5. How to split */}
          <View style={styles.fieldGroup}>
            <Text style={[type.label, { color: colors.textMuted }]}>How to split</Text>
            <SegmentedControl
              options={[
                { value: 'equal', label: 'Split equally' },
                { value: 'custom', label: 'Custom amount' },
              ]}
              value={method}
              onChange={setMethod}
            />
          </View>

          {method === 'custom' ? (
            <View style={styles.fieldGroup}>
              {participantIds.map((id) => (
                <View key={id} style={styles.customRow}>
                  <Text style={[type.body, styles.customName, { color: colors.text }]}>
                    {personName(id)}
                  </Text>
                  <TextInput
                    value={customTexts[id] ?? ''}
                    onChangeText={(text) => setCustomTexts((prev) => ({ ...prev, [id]: text }))}
                    keyboardType="decimal-pad"
                    placeholder="0.00"
                    placeholderTextColor={colors.textSubtle}
                    style={[
                      type.amount,
                      styles.customInput,
                      { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text },
                    ]}
                  />
                </View>
              ))}
              {totalMinor !== null && customSum !== null ? (
                <View style={styles.reconcile}>
                  <Text style={[type.caption, { color: colors.textMuted }]}>
                    Assigned {formatAmount(customSum)} of {formatAmount(totalMinor)}
                  </Text>
                  <Text
                    style={[
                      type.label,
                      { color: customMismatch ? colors.warning : colors.income },
                    ]}>
                    {customMismatch
                      ? `${formatAmount(Math.abs(totalMinor - customSum))} ${customSum > totalMinor ? 'over' : 'left'}`
                      : 'Balanced'}
                  </Text>
                </View>
              ) : null}
            </View>
          ) : null}

          {/* 6. Category — last (for your share's spending). */}
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

          {shares && totalMinor !== null && !customMismatch ? (
            <View style={[styles.preview, { backgroundColor: colors.surfaceAlt }]}>
              {participantIds.map((id) => (
                <Text key={id} style={[type.caption, { color: colors.textMuted }]}>
                  {personName(id)}: {formatAmount(shares.get(id) ?? 0)}
                  {id === payerId ? ' · paid the bill' : ''}
                  {id === ME
                    ? participantIds.includes(ME)
                      ? ' · your spending'
                      : ''
                    : payerId === ME
                      ? ' · will owe you'
                      : ''}
                </Text>
              ))}
              {payerId !== ME && participantIds.includes(ME) ? (
                <Text style={[type.caption, { color: colors.textMuted }]}>
                  Recorded as: you borrow {formatAmount(shares.get(ME) ?? 0)} from{' '}
                  {personName(payerId)} + the same as spending — your account nets zero.
                </Text>
              ) : null}
            </View>
          ) : null}

          <Pressable
            accessibilityRole="button"
            disabled={saving || customMismatch}
            onPress={save}
            style={({ pressed }) => [
              styles.saveButton,
              { backgroundColor: pressed ? colors.primaryPress : colors.primary },
              (saving || customMismatch) && styles.disabled,
            ]}>
            <Text style={[type.h2, { color: colors.onPrimary }]}>
              {saving ? 'Splitting…' : 'Create split'}
            </Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>

      <PeoplePicker
        visible={pickerOpen}
        title="Who was in?"
        options={pickerOptions}
        selectedIds={participantIds}
        onClose={() => setPickerOpen(false)}
        onDone={setParticipants}
        onCreatePerson={createPersonAndReload}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  flex: { flex: 1 },
  container: {
    paddingHorizontal: screenPaddingH,
    paddingVertical: space.md,
    paddingBottom: space.xxl,
    gap: space.xl,
  },
  fieldGroup: { gap: space.sm },
  participantsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  addParticipants: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    paddingVertical: space.xs,
  },
  participantList: { gap: space.sm },
  participantRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  participantAvatar: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  participantName: { flex: 1 },
  textField: {
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  },
  customRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
  },
  customName: { flex: 1 },
  customInput: {
    width: 120,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    textAlign: 'right',
  },
  reconcile: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: space.xs,
  },
  preview: {
    borderRadius: radius.md,
    padding: space.md,
    gap: space.xs,
  },
  saveButton: {
    minHeight: minTouchTarget + space.sm,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabled: { opacity: 0.6 },
});
