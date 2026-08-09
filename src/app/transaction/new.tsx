import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import { TransactionForm } from '@/components/TransactionForm';
import { insertTransaction } from '@/db/queries/transactions';
import { usePendingCount } from '@/state/PendingCount';
import { useTheme } from '@/theme/ThemeContext';

export default function NewTransactionScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const { refresh } = usePendingCount();

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <TransactionForm
        title="New transaction"
        submitLabel="Save (goes to Queue)"
        onSubmit={async (tx) => {
          await insertTransaction(tx);
          refresh();
          router.back();
        }}
      />
    </SafeAreaView>
  );
}
