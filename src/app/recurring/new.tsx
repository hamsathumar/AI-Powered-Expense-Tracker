import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import { RecurringForm } from '@/components/RecurringForm';
import { createTemplate } from '@/db/queries/recurring';
import { useTheme } from '@/theme/ThemeContext';

export default function NewRecurringScreen() {
  const router = useRouter();
  const { colors } = useTheme();

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <RecurringForm
        title="New recurring"
        onSubmit={async (template) => {
          await createTemplate(template);
          router.back();
        }}
      />
    </SafeAreaView>
  );
}
