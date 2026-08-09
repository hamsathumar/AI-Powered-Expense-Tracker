/**
 * Settle Up (spec §3.5) — not a separate entity: it pre-fills a Lending
 * transaction in the repayment direction for the person's outstanding
 * APPROVED balance, editable for partial settlement. Enters the queue as
 * pending like everything else.
 */
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AmountInput } from '@/components/AmountInput';
import { ChipSelector } from '@/components/ChipSelector';
import { describeNet } from '@/components/PersonRow';
import { listAccounts } from '@/db/queries/accounts';
import { getPerson, getPersonNetBalanceMinor } from '@/db/queries/people';
import { insertTransaction } from '@/db/queries/transactions';
import { formatMinorUnits, parseAmountInput } from '@/domain/money';
import type { Account, Person } from '@/domain/types';
import { useTheme } from '@/theme/ThemeContext';
import { minTouchTarget, radius, screenPaddingH, space, type } from '@/theme/tokens';

export default function SettleUpScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const { personId } = useLocalSearchParams<{ personId: string }>();

  const [person, setPerson] = useState<Person | null>(null);
  const [netMinor, setNetMinor] = useState(0);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [amountText, setAmountText] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const [p, net, acc] = await Promise.all([
      getPerson(personId),
      getPersonNetBalanceMinor(personId),
      listAccounts(),
    ]);
    if (!p) throw new Error('Person not found');
    if (net === 0) {
      Alert.alert('Nothing to settle', `${p.name} is settled up.`);
      router.back();
      return;
    }
    setPerson(p);
    setNetMinor(net);
    setAccounts(acc);
    setAmountText(formatMinorUnits(Math.abs(net)).replace(/,/g, ''));
  }, [personId, router]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async load
    load().catch((e) => {
      Alert.alert('Error', String(e));
      router.back();
    });
  }, [load, router]);

  if (!person) {
    return <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.bg }]} />;
  }

  // net > 0: they owe the user → money comes IN (lend_repayment_received).
  // net < 0: the user owes them → money goes OUT (borrow_repayment_made).
  const receiving = netMinor > 0;
  const direction = receiving ? 'lend_repayment_received' : 'borrow_repayment_made';

  const save = async () => {
    const amountMinor = parseAmountInput(amountText);
    if (amountMinor === null) {
      Alert.alert('Not quite', 'Enter a valid amount.');
      return;
    }
    if (amountMinor > Math.abs(netMinor)) {
      Alert.alert('Not quite', `That's more than the outstanding ${formatMinorUnits(Math.abs(netMinor))}.`);
      return;
    }
    if (!accountId) {
      Alert.alert('Not quite', receiving ? 'Which account receives it?' : 'Which account pays it?');
      return;
    }
    setSaving(true);
    try {
      await insertTransaction({
        type: 'lending',
        status: 'pending',
        source: 'manual',
        name: `Settle up — ${person.name}`,
        amountMinor,
        occurredAt: new Date().toISOString(),
        accountId,
        personId: person.id,
        direction,
        confidenceFlags: [],
      });
      router.back();
    } catch (e) {
      Alert.alert('Save failed', String(e));
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.bg }]}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text style={[type.h1, { color: colors.text }]}>Settle up with {person.name}</Text>
        <Text style={[type.body, { color: colors.textMuted }]}>
          {describeNet(netMinor)} ·{' '}
          {receiving ? 'they pay you back' : 'you pay them back'}. Edit the amount for a partial
          settlement.
        </Text>

        <AmountInput value={amountText} onChange={setAmountText} />

        <ChipSelector
          label={receiving ? 'Into account' : 'From account'}
          items={accounts.map((a) => ({ id: a.id, label: a.name }))}
          selectedId={accountId}
          onSelect={setAccountId}
          emptyHint="No accounts yet — create one in the Accounts tab first."
        />

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

        <View style={[styles.note, { backgroundColor: colors.surfaceAlt }]}>
          <Text style={[type.caption, { color: colors.textMuted }]}>
            Settling is a repayment, not spending — it will move the account balance but never
            appear in reports.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  container: {
    paddingHorizontal: screenPaddingH,
    paddingVertical: space.md,
    gap: space.xl,
  },
  saveButton: {
    minHeight: minTouchTarget + space.sm,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  note: {
    borderRadius: radius.md,
    padding: space.md,
  },
  disabled: { opacity: 0.6 },
});
