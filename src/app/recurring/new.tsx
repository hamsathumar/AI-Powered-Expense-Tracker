import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { buildRecurringInitial, recurringEndNote, recurringFrequencyNote } from '@/ai/specializedPrefill';
import { RecurringForm } from '@/components/RecurringForm';
import { createTemplate } from '@/db/queries/recurring';
import { deletePendingOperation, getPendingOperation } from '@/db/queries/pendingOperations';
import type { RecurringTemplate } from '@/domain/types';
import { useTheme } from '@/theme/ThemeContext';

export default function NewRecurringScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const params = useLocalSearchParams<{ fromPending?: string }>();
  const fromPending = typeof params.fromPending === 'string' ? params.fromPending : null;

  // Handoff: when opened from a pending AI recurring operation, prefill the
  // existing RecurringForm from an application-owned adapter (never raw AI).
  const [initial, setInitial] = useState<RecurringTemplate | null>(null);
  const [ready, setReady] = useState(!fromPending);

  useEffect(() => {
    if (!fromPending) return;
    getPendingOperation(fromPending)
      .then((rec) => {
        if (rec) {
          const now = new Date();
          setInitial(buildRecurringInitial(rec.op, now));
          // TC-025 / audit F7: never let a stated-but-unrepresentable schedule
          // detail (end condition, yearly cadence) fall back silently.
          const notes = [recurringFrequencyNote(rec.op), recurringEndNote(rec.op, now)].filter(
            (n): n is string => n !== null,
          );
          if (notes.length > 0) Alert.alert('Check the schedule', notes.join('\n\n'));
        }
        setReady(true);
      })
      .catch((e) => {
        Alert.alert('Could not open', String(e));
        router.back();
      });
  }, [fromPending, router]);

  if (!ready) return <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} />;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <RecurringForm
        title={fromPending ? 'Review recurring' : 'New recurring'}
        initial={initial ?? undefined}
        onSubmit={async (template) => {
          await createTemplate(template);
          // Consume the pending AI operation so it leaves the review queue.
          if (fromPending) await deletePendingOperation(fromPending);
          router.back();
        }}
      />
    </SafeAreaView>
  );
}
