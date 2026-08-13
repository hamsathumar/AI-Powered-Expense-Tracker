/**
 * Data & Backup subpage (Settings → Data & Backup). JSON export/restore
 * (restore REPLACES all data) plus a type-to-confirm wipe. Destructive actions
 * always state what will happen before proceeding (v2 §5.10).
 */
import { Feather } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ScreenHeader } from '@/components/ScreenHeader';
import { clearAllData, restoreBackup } from '@/db/backup';
import { getProfile } from '@/db/queries/settings';
import { parseBackup } from '@/domain/backupFormat';
import { DEFAULT_CURRENCY_CODE } from '@/domain/money';
import { pickBackupText, shareBackup } from '@/services/backupFile';
import { deleteProfilePhoto } from '@/services/profilePhoto';
import { useCurrency } from '@/theme/CurrencyContext';
import { useTheme } from '@/theme/ThemeContext';
import { minTouchTarget, radius, screenPaddingH, space, type } from '@/theme/tokens';

export default function DataScreen() {
  const { colors } = useTheme();
  const currency = useCurrency();
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useFocusEffect(
    useCallback(() => {
      getProfile().then((p) => setPhotoUri(p.photoUri)).catch(() => {});
    }, []),
  );

  const createBackup = async () => {
    setBusy(true);
    try {
      await shareBackup();
    } catch (e) {
      Alert.alert('Backup failed', String(e));
    } finally {
      setBusy(false);
    }
  };

  const restore = async () => {
    try {
      const text = await pickBackupText();
      if (!text) return;
      const backup = parseBackup(text);
      Alert.alert(
        'Replace all data?',
        `This replaces ALL current data in Kaasu with the backup from ${new Date(backup.exportedAt).toLocaleString()}. This cannot be undone.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Replace',
            style: 'destructive',
            onPress: async () => {
              setBusy(true);
              try {
                await restoreBackup(backup);
                await currency.reload();
                Alert.alert('Restored', 'Your data was restored from the backup.');
              } catch (e) {
                Alert.alert('Restore failed', String(e));
              } finally {
                setBusy(false);
              }
            },
          },
        ],
      );
    } catch (e) {
      Alert.alert('Not a valid backup', String(e));
    }
  };

  const clearData = () => {
    Alert.prompt(
      'Clear all data',
      'This wipes every account, transaction, and setting and cannot be undone. Type DELETE to confirm.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: async (text?: string) => {
            if (text !== 'DELETE') {
              Alert.alert('Not cleared', 'You must type DELETE exactly.');
              return;
            }
            setBusy(true);
            try {
              await clearAllData();
              deleteProfilePhoto(photoUri);
              await currency.setCurrency(DEFAULT_CURRENCY_CODE);
              Alert.alert('Cleared', 'Kaasu is back to a fresh state. Your API key was kept.');
            } catch (e) {
              Alert.alert('Clear failed', String(e));
            } finally {
              setBusy(false);
            }
          },
        },
      ],
      'plain-text',
    );
  };

  const actions: { icon: 'upload' | 'download' | 'trash-2'; label: string; onPress: () => void; danger?: boolean }[] = [
    { icon: 'upload', label: 'Create local backup', onPress: createBackup },
    { icon: 'download', label: 'Restore local backup', onPress: restore },
    { icon: 'trash-2', label: 'Clear all data', onPress: clearData, danger: true },
  ];

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.bg }]} edges={['top']}>
      <ScreenHeader title="Data & Backup" />
      <ScrollView contentContainerStyle={styles.container}>
        {actions.map((a) => {
          const tint = a.danger ? colors.danger : colors.text;
          return (
            <Pressable
              key={a.label}
              accessibilityRole="button"
              disabled={busy}
              onPress={a.onPress}
              style={[
                styles.row,
                { backgroundColor: colors.surface, borderColor: colors.border, opacity: busy ? 0.5 : 1 },
              ]}>
              <Feather name={a.icon} size={18} color={tint} />
              <Text style={[type.body, styles.rowLabel, { color: tint }]}>{a.label}</Text>
              <Feather name="chevron-right" size={18} color={colors.textSubtle} />
            </Pressable>
          );
        })}
        <Text style={[type.caption, { color: colors.textSubtle }]}>
          Backups are a plain JSON file you can save anywhere. Restore replaces everything currently in
          Kaasu.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  container: { paddingHorizontal: screenPaddingH, paddingTop: space.sm, paddingBottom: space.xxl, gap: space.md - 2 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: space.lg,
    minHeight: minTouchTarget + space.xs,
  },
  rowLabel: { flex: 1 },
});
