/**
 * Edit a PENDING transaction (queue "Edit" action, spec §7). Approved and
 * rejected rows are historical facts — not editable in v1.
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
        if (found.status !== 'pending') {
          throw new Error('Only pending transactions can be edited');
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
