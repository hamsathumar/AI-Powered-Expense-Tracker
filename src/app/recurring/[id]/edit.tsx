import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { RecurringForm } from '@/components/RecurringForm';
import { deleteTemplate, getTemplate, updateTemplate } from '@/db/queries/recurring';
import type { RecurringTemplate } from '@/domain/types';
import { useTheme } from '@/theme/ThemeContext';

export default function EditRecurringScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [template, setTemplate] = useState<RecurringTemplate | null>(null);

  useEffect(() => {
    getTemplate(id)
      .then((t) => {
        if (!t) throw new Error('Template not found');
        setTemplate(t);
      })
      .catch((e) => {
        Alert.alert('Error', String(e));
        router.back();
      });
  }, [id, router]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      {template ? (
        <RecurringForm
          title="Edit recurring"
          initial={template}
          onSubmit={async (values) => {
            await updateTemplate(template.id, values);
            router.back();
          }}
          onDelete={async () => {
            await deleteTemplate(template.id);
            router.back();
          }}
        />
      ) : null}
    </SafeAreaView>
  );
}
