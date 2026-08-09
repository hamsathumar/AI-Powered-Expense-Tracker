import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CategoryForm } from '@/components/CategoryForm';
import { createCategory } from '@/db/queries/categories';
import type { CategoryKind } from '@/domain/types';
import { useTheme } from '@/theme/ThemeContext';

export default function NewCategoryScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const { kind } = useLocalSearchParams<{ kind: CategoryKind }>();
  const categoryKind: CategoryKind = kind === 'income' ? 'income' : 'expense';

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <CategoryForm
        title={categoryKind === 'income' ? 'New income category' : 'New expense category'}
        onSubmit={async (values) => {
          await createCategory({ ...values, kind: categoryKind });
          router.back();
        }}
      />
    </SafeAreaView>
  );
}
