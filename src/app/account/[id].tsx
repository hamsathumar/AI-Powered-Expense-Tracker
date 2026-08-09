import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AccountForm } from '@/components/AccountForm';
import { archiveAccount, getAccount, updateAccount } from '@/db/queries/accounts';
import type { Account } from '@/domain/types';
import { useTheme } from '@/theme/ThemeContext';

export default function EditAccountScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [account, setAccount] = useState<Account | null>(null);

  useEffect(() => {
     
    getAccount(id)
      .then((a) => {
        if (!a) throw new Error('Account not found');
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
