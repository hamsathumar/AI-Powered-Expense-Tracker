import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AccountForm } from '@/components/AccountForm';
import { createAccount } from '@/db/queries/accounts';
import { useTheme } from '@/theme/ThemeContext';

export default function NewAccountScreen() {
  const router = useRouter();
  const { colors } = useTheme();

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <AccountForm
        title="New account"
        onSubmit={async (values) => {
          await createAccount(values);
          router.back();
        }}
      />
    </SafeAreaView>
  );
}
