/**
 * Settings: Profile (always visible) + an accordion of Currency · Data &
 * Backup · Voice (Gemini). One section open at a time keeps the screen short.
 *
 * Profile and currency are local-only personal preferences. Data backup is
 * a JSON export/restore (restore REPLACES all data) plus a type-to-confirm
 * wipe. The Gemini key lives in the keychain, never in a committed file.
 */
import { Feather } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState, type ComponentProps, type ReactNode } from 'react';
import {
  Alert,
  Image,
  LayoutAnimation,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { clearGeminiApiKey, getGeminiApiKey, setGeminiApiKey } from '@/ai/secureConfig';
import { ChipSelector } from '@/components/ChipSelector';
import { clearAllData, restoreBackup } from '@/db/backup';
import {
  DEFAULT_GEMINI_MODEL,
  getGeminiModel,
  getProfile,
  setSetting,
  SETTINGS_KEYS,
} from '@/db/queries/settings';
import { parseBackup } from '@/domain/backupFormat';
import { CURRENCIES, DEFAULT_CURRENCY_CODE } from '@/domain/money';
import { pickBackupText, shareBackup } from '@/services/backupFile';
import { deleteProfilePhoto, pickProfilePhoto } from '@/services/profilePhoto';
import { useCurrency } from '@/theme/CurrencyContext';
import { useTheme } from '@/theme/ThemeContext';
import { minTouchTarget, radius, screenPaddingH, space, type } from '@/theme/tokens';

type SectionKey = 'currency' | 'data' | 'gemini';

export default function SettingsScreen() {
  const { colors } = useTheme();
  const currency = useCurrency();

  const [open, setOpen] = useState<SectionKey | null>(null);
  const [name, setName] = useState('');
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [keyInput, setKeyInput] = useState('');
  const [hasKey, setHasKey] = useState(false);
  const [model, setModel] = useState(DEFAULT_GEMINI_MODEL);
  const [busy, setBusy] = useState(false);

  const toggle = (section: SectionKey) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setOpen((prev) => (prev === section ? null : section));
  };

  const loadAll = useCallback(() => {
    Promise.all([getProfile(), getGeminiApiKey(), getGeminiModel(), currency.reload()])
      .then(([profile, key, m]) => {
        setName(profile.name ?? '');
        setPhotoUri(profile.photoUri);
        setHasKey(Boolean(key));
        setModel(m);
      })
      .catch(() => {});
  }, [currency]);

  useFocusEffect(loadAll);

  // --- Profile ---
  const changePhoto = async () => {
    try {
      const uri = await pickProfilePhoto();
      if (!uri) return;
      deleteProfilePhoto(photoUri);
      await setSetting(SETTINGS_KEYS.profilePhotoUri, uri);
      setPhotoUri(uri);
    } catch (e) {
      Alert.alert('Photo error', String(e));
    }
  };

  const saveName = async () => {
    await setSetting(SETTINGS_KEYS.profileName, name.trim());
  };

  // --- Data ---
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
      const backup = parseBackup(text); // validates before we touch anything
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
                loadAll();
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
              loadAll();
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

  // --- Gemini ---
  const saveKey = async () => {
    const trimmed = keyInput.trim();
    if (!trimmed) return;
    await setGeminiApiKey(trimmed);
    setHasKey(true);
    setKeyInput('');
    Alert.alert('Saved', 'Your Gemini API key is stored securely on this device.');
  };

  const removeKey = () => {
    Alert.alert('Remove API key?', 'Voice logging will stop working until you add one again.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          await clearGeminiApiKey();
          setHasKey(false);
        },
      },
    ]);
  };

  const saveModel = async () => {
    const trimmed = model.trim() || DEFAULT_GEMINI_MODEL;
    await setSetting(SETTINGS_KEYS.geminiModel, trimmed);
    setModel(trimmed);
    Alert.alert('Saved', `Model set to ${trimmed}.`);
  };

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.bg }]}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text style={[type.h1, { color: colors.text }]}>Settings</Text>

        {/* Profile — always visible */}
        <View style={styles.profile}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Change profile photo"
            onPress={changePhoto}
            style={[styles.avatar, { backgroundColor: colors.primarySoft, borderColor: colors.border }]}>
            {photoUri ? (
              <Image source={{ uri: photoUri }} style={styles.avatarImage} />
            ) : (
              <Feather name="user" size={36} color={colors.primary} />
            )}
            <View style={[styles.avatarEdit, { backgroundColor: colors.primary }]}>
              <Feather name="camera" size={12} color={colors.onPrimary} />
            </View>
          </Pressable>
          <TextInput
            value={name}
            onChangeText={setName}
            onEndEditing={saveName}
            placeholder="Your name"
            placeholderTextColor={colors.textSubtle}
            style={[type.h2, styles.nameInput, { color: colors.text }]}
          />
        </View>

        {/* Currency */}
        <Section
          icon="dollar-sign"
          title="Currency"
          expanded={open === 'currency'}
          onToggle={() => toggle('currency')}>
          <Text style={[type.caption, { color: colors.textMuted }]}>
            Changes the displayed symbol only — it never converts existing amounts.
          </Text>
          <ChipSelector
            label=""
            items={CURRENCIES.map((c) => ({ id: c.code, label: `${c.code} ${c.symbol.trim()}` }))}
            selectedId={currency.code}
            onSelect={(code) => void currency.setCurrency(code)}
          />
        </Section>

        {/* Data & Backup */}
        <Section
          icon="database"
          title="Data & Backup"
          expanded={open === 'data'}
          onToggle={() => toggle('data')}>
          <ActionRow icon="upload" label="Create local backup" onPress={createBackup} disabled={busy} />
          <ActionRow icon="download" label="Restore local backup" onPress={restore} disabled={busy} />
          <ActionRow icon="trash-2" label="Clear all data" danger onPress={clearData} disabled={busy} />
        </Section>

        {/* Voice / Gemini */}
        <Section
          icon="mic"
          title="Voice (Gemini)"
          expanded={open === 'gemini'}
          onToggle={() => toggle('gemini')}>
          <Text style={[type.caption, { color: colors.textMuted }]}>
            Voice logging sends your recording to Gemini. Get a free key from Google AI Studio and
            set a spending cap on it.
          </Text>
          <Pressable
            accessibilityRole="link"
            onPress={() => Linking.openURL('https://aistudio.google.com/apikey')}>
            <Text style={[type.label, { color: colors.primary }]}>Open Google AI Studio →</Text>
          </Pressable>

          <View style={[styles.statusRow, { backgroundColor: colors.surfaceAlt }]}>
            <Feather
              name={hasKey ? 'check-circle' : 'alert-circle'}
              size={16}
              color={hasKey ? colors.success : colors.warning}
            />
            <Text style={[type.caption, { color: colors.textMuted }]}>
              {hasKey ? 'API key stored on this device.' : 'No API key yet.'}
            </Text>
          </View>

          <TextInput
            value={keyInput}
            onChangeText={setKeyInput}
            placeholder={hasKey ? 'Replace API key' : 'Paste your Gemini API key'}
            placeholderTextColor={colors.textSubtle}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
            style={[
              type.body,
              styles.field,
              { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text },
            ]}
          />
          <Pressable
            accessibilityRole="button"
            disabled={keyInput.trim().length === 0}
            onPress={saveKey}
            style={({ pressed }) => [
              styles.button,
              {
                backgroundColor:
                  keyInput.trim().length === 0 ? colors.surfaceAlt : pressed ? colors.primaryPress : colors.primary,
              },
            ]}>
            <Text style={[type.label, { color: colors.onPrimary }]}>Save key</Text>
          </Pressable>
          {hasKey ? (
            <Pressable accessibilityRole="button" onPress={removeKey} style={styles.textButton}>
              <Text style={[type.label, { color: colors.danger }]}>Remove key</Text>
            </Pressable>
          ) : null}

          <Text style={[type.label, styles.modelLabel, { color: colors.textMuted }]}>Model</Text>
          <TextInput
            value={model}
            onChangeText={setModel}
            onEndEditing={saveModel}
            placeholder={DEFAULT_GEMINI_MODEL}
            placeholderTextColor={colors.textSubtle}
            autoCapitalize="none"
            autoCorrect={false}
            style={[
              type.body,
              styles.field,
              { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text },
            ]}
          />
          <Text style={[type.caption, { color: colors.textSubtle }]}>
            Change this if Google deprecates the default.
          </Text>
        </Section>
      </ScrollView>
    </SafeAreaView>
  );
}

function Section({
  icon,
  title,
  expanded,
  onToggle,
  children,
}: {
  icon: ComponentProps<typeof Feather>['name'];
  title: string;
  expanded: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  const { colors } = useTheme();
  return (
    <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        onPress={onToggle}
        style={styles.sectionHeader}>
        <Feather name={icon} size={18} color={colors.primary} />
        <Text style={[type.h2, styles.sectionTitle, { color: colors.text }]}>{title}</Text>
        <Feather name={expanded ? 'chevron-up' : 'chevron-down'} size={20} color={colors.textMuted} />
      </Pressable>
      {expanded ? <View style={styles.sectionBody}>{children}</View> : null}
    </View>
  );
}

function ActionRow({
  icon,
  label,
  onPress,
  danger,
  disabled,
}: {
  icon: 'upload' | 'download' | 'trash-2';
  label: string;
  onPress: () => void;
  danger?: boolean;
  disabled?: boolean;
}) {
  const { colors } = useTheme();
  const tint = danger ? colors.danger : colors.text;
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.actionRow,
        { backgroundColor: pressed ? colors.surfaceAlt : colors.bg },
        disabled && styles.disabled,
      ]}>
      <Feather name={icon} size={18} color={tint} />
      <Text style={[type.body, styles.actionLabel, { color: tint }]}>{label}</Text>
      <Feather name="chevron-right" size={18} color={colors.textSubtle} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  container: {
    paddingHorizontal: screenPaddingH,
    paddingVertical: space.md,
    paddingBottom: space.xxl,
    gap: space.md,
  },
  profile: {
    alignItems: 'center',
    gap: space.md,
    marginBottom: space.sm,
  },
  avatar: {
    width: 96,
    height: 96,
    borderRadius: 48,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarImage: {
    width: 96,
    height: 96,
    borderRadius: 48,
  },
  avatarEdit: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nameInput: {
    textAlign: 'center',
    minWidth: 160,
  },
  section: {
    borderWidth: 1,
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    minHeight: minTouchTarget + space.sm,
  },
  sectionTitle: { flex: 1 },
  sectionBody: {
    paddingHorizontal: space.lg,
    paddingBottom: space.lg,
    gap: space.sm,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    borderRadius: radius.md,
    padding: space.md,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    borderRadius: radius.md,
    paddingHorizontal: space.lg,
    minHeight: minTouchTarget + space.xs,
  },
  actionLabel: { flex: 1 },
  field: {
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  },
  button: {
    minHeight: minTouchTarget,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textButton: {
    minHeight: minTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modelLabel: { marginTop: space.sm },
  disabled: { opacity: 0.5 },
});
