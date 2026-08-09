/**
 * TEMPORARY — Stage 2 verification screen ("throwaway screen" per
 * technical-plan.md §7.2). Exercises the DB layer end-to-end on the device:
 * migrations, seeded categories, account creation, all four transaction
 * types, balance + person-balance math, and the pending/approved split.
 *
 * DELETE this file (and its link on Home) once real screens exist.
 */
import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { createAccount, getAccountBalanceMinor, listAccounts } from '@/db/queries/accounts';
import { listCategories } from '@/db/queries/categories';
import { createPerson, getPersonNetBalanceMinor, listPeople } from '@/db/queries/people';
import { insertTransaction, listRecentTransactions } from '@/db/queries/transactions';
import { useTheme } from '@/theme/ThemeContext';
import { minTouchTarget, radius, screenPaddingH, space, type } from '@/theme/tokens';

export default function DevDbScreen() {
  const { colors } = useTheme();
  const [log, setLog] = useState<string[]>([]);

  const append = (line: string) => setLog((prev) => [...prev, line]);

  const showSeeds = useCallback(async () => {
    const expense = await listCategories('expense');
    const income = await listCategories('income');
    append(`✓ migrations ran — categories seeded: ${expense.length} expense, ${income.length} income`);
    append(`  expense: ${expense.map((c) => c.name).join(', ')}`);
    append(`  income:  ${income.map((c) => c.name).join(', ')}`);
  }, []);

  useEffect(() => {
    // Throwaway dev screen; state updates happen after awaits, not synchronously.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    showSeeds().catch((e) => append(`✗ DB init failed: ${String(e)}`));
  }, [showSeeds]);

  const runScenario = async () => {
    try {
      // Reuse existing test entities on re-runs instead of duplicating.
      const accounts = await listAccounts();
      const account =
        accounts.find((a) => a.name === 'Test Cash') ??
        (await createAccount({ name: 'Test Cash', type: 'cash', openingBalanceMinor: 100000 }));
      const people = await listPeople();
      const kamal =
        people.find((p) => p.name === 'Test Kamal') ?? (await createPerson('Test Kamal'));
      const food = (await listCategories('expense')).find((c) => c.name === 'Food')!;
      const salary = (await listCategories('income')).find((c) => c.name === 'Salary')!;

      const base = {
        status: 'approved' as const,
        source: 'manual' as const,
        occurredAt: new Date().toISOString(),
        confidenceFlags: [],
      };
      // Approved: -200.00 expense, +500.00 income, lend 100.00 to Kamal
      await insertTransaction({ ...base, type: 'expense', name: 'Test lunch', amountMinor: 20000, accountId: account.id, categoryId: food.id });
      await insertTransaction({ ...base, type: 'income', name: 'Test salary', amountMinor: 50000, accountId: account.id, categoryId: salary.id });
      await insertTransaction({ ...base, type: 'lending', name: 'Test lend to Kamal', amountMinor: 10000, accountId: account.id, personId: kamal.id, direction: 'lend' });
      // Pending expense — must NOT move any balance
      await insertTransaction({ ...base, status: 'pending', type: 'expense', name: 'Test pending', amountMinor: 99900, accountId: account.id, categoryId: food.id });

      const balance = await getAccountBalanceMinor(account.id);
      const net = await getPersonNetBalanceMinor(kamal.id);
      const txCount = (await listRecentTransactions()).length;

      append(`— scenario run at ${new Date().toLocaleTimeString()} —`);
      append(`✓ inserted 4 transactions (3 approved + 1 pending); total rows: ${txCount}`);
      append(`  balance: ${balance} minor units (opening 100000 − 20000 + 50000 − 10000 per approved run)`);
      append(`  Kamal net: ${net} (positive = owes user)`);
      append(`  pending 99900 correctly excluded: ${balance % 100 === 0 ? 'yes' : 'NO — BUG'}`);
    } catch (e) {
      append(`✗ scenario failed: ${String(e)}`);
    }
  };

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.bg }]}>
      <View style={styles.container}>
        <Text style={[type.h1, { color: colors.text }]}>DB check (temporary)</Text>
        <TouchableOpacity
          onPress={runScenario}
          style={[styles.button, { backgroundColor: colors.primary }]}>
          <Text style={[type.label, { color: colors.onPrimary }]}>Run test scenario</Text>
        </TouchableOpacity>
        <ScrollView style={styles.log}>
          {log.map((line, i) => (
            <Text key={i} style={[type.caption, styles.logLine, { color: colors.textMuted }]}>
              {line}
            </Text>
          ))}
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  container: { flex: 1, paddingHorizontal: screenPaddingH, gap: space.lg },
  button: {
    minHeight: minTouchTarget,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  log: { flex: 1 },
  logLine: { marginBottom: space.xs },
});
