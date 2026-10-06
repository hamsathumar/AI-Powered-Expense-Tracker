/**
 * Shared create/edit form for accounts (spec §8.7). Archiving is a soft
 * delete — transaction history must never be destroyed by removing an
 * account.
 *
 * "Private account" keeps the account's own ledger and balance but takes it
 * out of Reports and Home totals (see reportSql.reportRowsSql). Privacy belongs
 * to the ACCOUNT, so flipping it re-reads past months too — that is confirmed
 * first when the account already has history, like an opening-balance change.
 */
import { useState } from 'react';
import { Feather } from '@expo/vector-icons';
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';

import { AmountInput } from '@/components/AmountInput';
import { ChipSelector } from '@/components/ChipSelector';
import { SegmentedControl } from '@/components/SegmentedControl';
import {
  applyBalanceSign,
  formatMinorUnits,
  parseAmountInput,
  splitBalanceSign,
} from '@/domain/money';
import type { Account, AccountType } from '@/domain/types';
import { hapticTick } from '@/lib/haptics';
import { useTheme } from '@/theme/ThemeContext';
import { layout, minTouchTarget, radius, screenPaddingH, space, type } from '@/theme/tokens';

const TYPE_OPTIONS: { id: AccountType; label: string; icon: 'briefcase' | 'credit-card' | 'dollar-sign' }[] = [
  { id: 'bank', label: 'Bank', icon: 'briefcase' },
  { id: 'card', label: 'Card', icon: 'credit-card' },
  { id: 'cash', label: 'Cash', icon: 'dollar-sign' },
];

export interface AccountFormValues {
  name: string;
  type: AccountType;
  openingBalanceMinor: number;
  isPrivate: boolean;
}

interface Props {
  title: string;
  initial?: Account;
  /** True when the account already has transactions — editing the opening
   *  balance then shifts every balance derived from it, so we confirm first. */
  hasHistory?: boolean;
  onSubmit: (values: AccountFormValues) => Promise<void>;
  onArchive?: () => Promise<void>;
}

export function AccountForm({ title, initial, hasHistory = false, onSubmit, onArchive }: Props) {
  const { colors } = useTheme();
  const [name, setName] = useState(initial?.name ?? '');
  const [accountType, setAccountType] = useState<AccountType>(initial?.type ?? 'bank');
  const initialSplit = splitBalanceSign(initial?.openingBalanceMinor ?? 0);
  const [openingText, setOpeningText] = useState(
    initial ? formatMinorUnits(initialSplit.magnitudeMinor).replace(/,/g, '') : '',
  );
  // The decimal pad has no minus key, so the sign is its own control.
  const [openingNegative, setOpeningNegative] = useState(initialSplit.negative);
  const [isPrivate, setIsPrivate] = useState(initial?.isPrivate ?? false);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    const magnitude =
      openingText.trim() === '' ? 0 : parseAmountInput(openingText, { allowZero: true });
    if (magnitude === null) {
      Alert.alert('Not quite', 'Opening balance must be a valid amount (or left empty).');
      return;
    }
    if (!name.trim()) {
      Alert.alert('Not quite', 'Give the account a name.');
      return;
    }
    const openingBalanceMinor = applyBalanceSign(magnitude, openingNegative);
    const submit = async () => {
      setBusy(true);
      try {
        await onSubmit({ name: name.trim(), type: accountType, openingBalanceMinor, isPrivate });
      } catch (e) {
        Alert.alert('Save failed', String(e));
        setBusy(false);
      }
    };

    // Changes that rewrite history get one confirmation, listing each.
    const warnings: string[] = [];
    if (initial && hasHistory && openingBalanceMinor !== initial.openingBalanceMinor) {
      warnings.push('Changing the opening balance shifts the balance on every past day, not just today.');
    }
    if (initial && hasHistory && isPrivate !== initial.isPrivate) {
      warnings.push(
        isPrivate
          ? 'Making it private takes ALL of its transactions out of your reports and totals — past months included.'
          : 'Making it personal again brings ALL of its transactions back into your reports and totals — past months included.',
      );
    }
    if (warnings.length > 0) {
      Alert.alert('Save these changes?', `This account already has transactions.\n\n${warnings.join('\n\n')}`, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Save', style: 'destructive', onPress: () => void submit() },
      ]);
      return;
    }
    await submit();
  };

  const confirmArchive = () => {
    Alert.alert(
      'Archive account?',
      'It disappears from lists but its transaction history is kept.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Archive', style: 'destructive', onPress: () => void onArchive?.() },
      ],
    );
  };

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled"
      style={{ backgroundColor: colors.bg }}>
      <Text style={[type.h1, { color: colors.text }]}>{title}</Text>

      <View style={styles.fieldGroup}>
        <Text style={[type.label, { color: colors.textMuted }]}>Name</Text>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="e.g. Commercial Bank"
          placeholderTextColor={colors.textSubtle}
          style={[
            type.input,
            styles.textField,
            { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text },
          ]}
        />
      </View>

      <ChipSelector
        label="Type"
        items={TYPE_OPTIONS}
        selectedId={accountType}
        onSelect={(id) => setAccountType(id as AccountType)}
      />

      <View style={styles.fieldGroup}>
        <AmountInput
          value={openingText}
          onChange={setOpeningText}
          label="Opening balance (optional)"
          allowZero
        />
        <SegmentedControl
          options={[
            { value: 'positive', label: 'Money in account (+)' },
            { value: 'negative', label: 'Owing / overdrawn (−)' },
          ]}
          value={openingNegative ? 'negative' : 'positive'}
          onChange={(v) => setOpeningNegative(v === 'negative')}
        />
        <Text style={[type.caption, { color: colors.textMuted }]}>
          Use − for a card with a balance owed or an overdrawn account.
        </Text>
      </View>

      <View style={[styles.privateRow, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <View style={[styles.privateTile, { backgroundColor: colors.primarySoft }]}>
          <Feather name="lock" size={18} color={colors.primary} />
        </View>
        <View style={styles.privateText}>
          <Text style={[type.h2, { color: colors.text }]}>Private account</Text>
          <Text style={[type.caption, { color: colors.textMuted }]}>
            Keeps its own balance, but stays out of your reports and totals — for money
            that isn&apos;t yours, like a shared room fund.
          </Text>
        </View>
        <Switch
          accessibilityLabel="Private account"
          value={isPrivate}
          onValueChange={(next) => {
            hapticTick();
            setIsPrivate(next);
          }}
          trackColor={{ true: colors.primary, false: colors.border }}
        />
      </View>

      <Pressable
        accessibilityRole="button"
        disabled={busy}
        onPress={save}
        style={({ pressed }) => [
          styles.saveButton,
          { backgroundColor: pressed ? colors.primaryPress : colors.primary },
          busy && styles.disabled,
        ]}>
        <Text style={[type.h2, { color: colors.onPrimary }]}>{busy ? 'Saving…' : 'Save'}</Text>
      </Pressable>

      {onArchive ? (
        <Pressable accessibilityRole="button" onPress={confirmArchive} style={styles.archiveButton}>
          <Text style={[type.label, { color: colors.danger }]}>Archive account</Text>
        </Pressable>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: screenPaddingH,
    paddingVertical: space.lg,
    gap: space.xl,
  },
  fieldGroup: { gap: space.sm },
  textField: {
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  },
  saveButton: {
    minHeight: minTouchTarget + space.sm,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  archiveButton: {
    minHeight: minTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabled: { opacity: 0.6 },
  privateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: space.md,
  },
  privateTile: {
    width: layout.iconTileSm.size,
    height: layout.iconTileSm.size,
    borderRadius: layout.iconTileSm.radius,
    alignItems: 'center',
    justifyContent: 'center',
  },
  privateText: { flex: 1, gap: 2 },
});
