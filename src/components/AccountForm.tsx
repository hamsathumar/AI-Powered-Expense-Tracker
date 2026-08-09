/**
 * Shared create/edit form for accounts (spec §8.7). Archiving is a soft
 * delete — transaction history must never be destroyed by removing an
 * account.
 */
import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { AmountInput } from '@/components/AmountInput';
import { ChipSelector } from '@/components/ChipSelector';
import { formatMinorUnits, parseAmountInput } from '@/domain/money';
import type { Account, AccountType } from '@/domain/types';
import { useTheme } from '@/theme/ThemeContext';
import { minTouchTarget, radius, screenPaddingH, space, type } from '@/theme/tokens';

const TYPE_OPTIONS: { id: AccountType; label: string; icon: 'briefcase' | 'credit-card' | 'dollar-sign' }[] = [
  { id: 'bank', label: 'Bank', icon: 'briefcase' },
  { id: 'card', label: 'Card', icon: 'credit-card' },
  { id: 'cash', label: 'Cash', icon: 'dollar-sign' },
];

export interface AccountFormValues {
  name: string;
  type: AccountType;
  openingBalanceMinor: number;
}

interface Props {
  title: string;
  initial?: Account;
  onSubmit: (values: AccountFormValues) => Promise<void>;
  onArchive?: () => Promise<void>;
}

export function AccountForm({ title, initial, onSubmit, onArchive }: Props) {
  const { colors } = useTheme();
  const [name, setName] = useState(initial?.name ?? '');
  const [accountType, setAccountType] = useState<AccountType>(initial?.type ?? 'bank');
  const [openingText, setOpeningText] = useState(
    initial ? formatMinorUnits(initial.openingBalanceMinor).replace(/,/g, '') : '',
  );
  const [busy, setBusy] = useState(false);

  const save = async () => {
    const openingBalanceMinor =
      openingText.trim() === '' ? 0 : parseAmountInput(openingText, { allowZero: true });
    if (openingBalanceMinor === null) {
      Alert.alert('Not quite', 'Opening balance must be a valid amount (or left empty).');
      return;
    }
    if (!name.trim()) {
      Alert.alert('Not quite', 'Give the account a name.');
      return;
    }
    setBusy(true);
    try {
      await onSubmit({ name: name.trim(), type: accountType, openingBalanceMinor });
    } catch (e) {
      Alert.alert('Save failed', String(e));
      setBusy(false);
    }
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
            type.body,
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

      <AmountInput
        value={openingText}
        onChange={setOpeningText}
        label="Opening balance (optional)"
        allowZero
      />

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
});
