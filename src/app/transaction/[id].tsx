/**
 * Edit an existing transaction (queue "Edit" action + the detail-screen Edit).
 * Both pending and approved rows are editable: balances/reports are derived in
 * SQL from approved rows on the fly, so updating fields simply recomputes every
 * total — there is no stored balance to reconcile. Rejected rows stay locked.
 */
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { TransactionForm } from '@/components/TransactionForm';
import { getTransaction, updateTransaction } from '@/db/queries/transactions';
import type { Transaction } from '@/domain/types';
import { useTheme } from '@/theme/ThemeContext';

export default function EditTransactionScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [tx, setTx] = useState<Transaction | null>(null);

  useEffect(() => {
    getTransaction(id)
      .then((found) => {
        if (!found) throw new Error('Transaction not found');
        if (found.status === 'rejected') {
          throw new Error('Rejected transactions cannot be edited');
        }
        setTx(found);
      })
      .catch((e) => {
        Alert.alert('Cannot edit', String(e));
        router.back();
      });
  }, [id, router]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      {tx ? (
        <TransactionForm
          title="Edit transaction"
          submitLabel="Save changes"
          initial={tx}
          onSubmit={async (updated) => {
            await updateTransaction(tx.id, updated);
            router.back();
          }}
        />
      ) : null}
    </SafeAreaView>
  );
}
