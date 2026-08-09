import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CategoryForm } from '@/components/CategoryForm';
import { archiveCategory, getCategory, updateCategory } from '@/db/queries/categories';
import type { Category } from '@/domain/types';
import { useTheme } from '@/theme/ThemeContext';

export default function EditCategoryScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [category, setCategory] = useState<Category | null>(null);

  useEffect(() => {
     
    getCategory(id)
      .then((c) => {
        if (!c) throw new Error('Category not found');
        setCategory(c);
      })
      .catch((e) => {
        Alert.alert('Error', String(e));
        router.back();
      });
  }, [id, router]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      {category ? (
        <CategoryForm
          title="Edit category"
          initial={category}
          onSubmit={async (values) => {
            await updateCategory(category.id, values);
            router.back();
          }}
          onArchive={async () => {
            await archiveCategory(category.id);
            router.back();
          }}
        />
      ) : null}
    </SafeAreaView>
  );
}
