/**
 * Settle Up (spec §3.5) — not a separate entity: it pre-fills a Lending
 * transaction in the repayment direction for the person's outstanding
 * APPROVED balance, editable for partial settlement. Enters the queue as
 * pending like everything else.
 */
import { format } from 'date-fns';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AmountInput } from '@/components/AmountInput';
import { ChipSelector } from '@/components/ChipSelector';
import { describeNet } from '@/components/PersonRow';
import { ScreenHeader } from '@/components/ScreenHeader';
import { listAccounts } from '@/db/queries/accounts';
import { getPerson, getPersonNetBalanceMinor } from '@/db/queries/people';
import { insertTransaction, listTransactionItemsForPerson } from '@/db/queries/transactions';
import { formatAmount, formatMinorUnits, parseAmountInput } from '@/domain/money';
import { allocateSettlement, type SettlementCharge } from '@/domain/settlement';
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
  const [charges, setCharges] = useState<SettlementCharge[]>([]);
  const [priorRepaidMinor, setPriorRepaidMinor] = useState(0);

  const load = useCallback(async () => {
    const [p, net, acc, history] = await Promise.all([
      getPerson(personId),
      getPersonNetBalanceMinor(personId),
      listAccounts(),
      listTransactionItemsForPerson(personId),
    ]);
    if (!p) throw new Error('Person not found');
    if (net === 0) {
      Alert.alert('Nothing to settle', `${p.name} is settled up.`);
      router.back();
      return;
    }
    // net > 0: they owe you → charges are `lend`, repayments `lend_repayment_received`.
    // net < 0: you owe them → charges are `borrow`, repayments `borrow_repayment_made`.
    const chargeDir = net > 0 ? 'lend' : 'borrow';
    const repayDir = net > 0 ? 'lend_repayment_received' : 'borrow_repayment_made';
    const lending = history.filter((i) => i.tx.type === 'lending' && i.tx.status === 'approved');
    setCharges(
      lending
        .filter((i) => i.tx.type === 'lending' && i.tx.direction === chargeDir)
        .map((i) => ({
          id: i.tx.id,
          name: i.tx.name,
          occurredAt: i.tx.occurredAt,
          source: i.tx.source,
          amountMinor: i.tx.amountMinor,
        })),
    );
    setPriorRepaidMinor(
      lending
        .filter((i) => i.tx.type === 'lending' && i.tx.direction === repayDir)
        .reduce((sum, i) => sum + i.tx.amountMinor, 0),
    );
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

  // Which outstanding charges this settlement covers, oldest-first (FIFO).
  const settlementMinor = parseAmountInput(amountText) ?? 0;
  const coverage = allocateSettlement(charges, priorRepaidMinor, settlementMinor);

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
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.bg }]} edges={['top']}>
      <ScreenHeader title="Settle up" />
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <View style={[styles.personCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={[styles.avatar, { backgroundColor: colors.primarySoft }]}>
            <Text style={[styles.avatarText, { color: colors.primary }]}>
              {person.name.slice(0, 1).toUpperCase()}
            </Text>
          </View>
          <Text style={[type.h2, { color: colors.text }]}>{person.name}</Text>
          <Text style={[type.display, { color: colors.lending }]}>{describeNet(netMinor)}</Text>
          <Text style={[type.caption, { color: colors.textMuted }]}>
            {receiving ? 'They pay you back' : 'You pay them back'} · edit for a partial settlement
          </Text>
        </View>

        <AmountInput
          value={amountText}
          onChange={setAmountText}
          label={receiving ? 'They are paying you' : 'You are paying'}
        />

        <ChipSelector
          label={receiving ? 'Into account' : 'From account'}
          items={accounts.map((a) => ({ id: a.id, label: a.name }))}
          selectedId={accountId}
          onSelect={setAccountId}
          emptyHint="No accounts yet — create one in the Accounts tab first."
        />

        {coverage.length > 0 ? (
          <View style={styles.covers}>
            <Text style={[type.h2, { color: colors.text }]}>What this covers</Text>
            {coverage.map((c) => (
              <View
                key={c.id}
                style={[styles.coverRow, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <View style={styles.coverText}>
                  <Text numberOfLines={1} style={[type.body, { color: colors.text }]}>
                    {c.name}
                  </Text>
                  <Text style={[type.caption, { color: colors.textMuted }]}>
                    {c.source === 'bill_split' ? 'Split' : 'Lending'} · {format(new Date(c.occurredAt), 'd MMM')}
                    {c.coveredMinor < c.chargeMinor ? ` · partial of ${formatAmount(c.chargeMinor)}` : ''}
                  </Text>
                </View>
                <Text style={[type.amount, { color: colors.text }]}>{formatAmount(c.coveredMinor)}</Text>
              </View>
            ))}
          </View>
        ) : null}

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
            {saving ? 'Saving…' : 'Record repayment'}
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
    paddingTop: space.sm,
    paddingBottom: space.xxl,
    gap: space.xl,
  },
  personCard: {
    alignItems: 'center',
    gap: space.sm,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: space.xl,
    paddingHorizontal: space.lg,
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontFamily: type.displayXL.fontFamily, fontSize: 20 },
  covers: { gap: space.sm },
  coverRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: space.md + 2,
    paddingVertical: space.md,
  },
  coverText: { flex: 1, gap: 2 },
  saveButton: {
    minHeight: minTouchTarget + space.sm,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  note: {
    borderRadius: radius.md,
    padding: space.md,
  },
  disabled: { opacity: 0.6 },
});
