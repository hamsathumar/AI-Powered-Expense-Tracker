import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AccountForm } from '@/components/AccountForm';
import {
  archiveAccount,
  countAccountTransactions,
  getAccount,
  updateAccount,
} from '@/db/queries/accounts';
import type { Account } from '@/domain/types';
import { useTheme } from '@/theme/ThemeContext';

export default function EditAccountScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [account, setAccount] = useState<Account | null>(null);
  const [hasHistory, setHasHistory] = useState(false);

  useEffect(() => {
     
    Promise.all([getAccount(id), countAccountTransactions(id)])
      .then(([a, count]) => {
        if (!a) throw new Error('Account not found');
        setHasHistory(count > 0);
        setAccount(a);
      })
      .catch((e) => {
        Alert.alert('Error', String(e));
        router.back();
      });
  }, [id, router]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      {account ? (
        <AccountForm
          title="Edit account"
          initial={account}
          hasHistory={hasHistory}
          onSubmit={async (values) => {
            await updateAccount(account.id, values);
            router.back();
          }}
          onArchive={async () => {
            await archiveAccount(account.id);
            router.back();
          }}
        />
      ) : null}
    </SafeAreaView>
  );
}
