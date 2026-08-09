/**
 * Settings — Gemini API key (secret; stored in the keychain) and model name.
 * The key can be extracted from any client app: acceptable for a private,
 * unpublished, personal app, but set a spending cap on the Google AI Studio
 * key (technical-plan §5.6).
 */
import { Feather } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import {
  Alert,
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
import {
  DEFAULT_GEMINI_MODEL,
  getGeminiModel,
  setSetting,
  SETTINGS_KEYS,
} from '@/db/queries/settings';
import { useTheme } from '@/theme/ThemeContext';
import { minTouchTarget, radius, screenPaddingH, space, type } from '@/theme/tokens';

export default function SettingsScreen() {
  const { colors } = useTheme();
  const [keyInput, setKeyInput] = useState('');
  const [hasKey, setHasKey] = useState(false);
  const [model, setModel] = useState(DEFAULT_GEMINI_MODEL);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all([getGeminiApiKey(), getGeminiModel()])
      .then(([key, m]) => {
        setHasKey(Boolean(key));
        setModel(m);
      })
      .catch(() => {});
  }, []);

  const saveKey = async () => {
    const trimmed = keyInput.trim();
    if (!trimmed) return;
    setSaving(true);
    try {
      await setGeminiApiKey(trimmed);
      setHasKey(true);
      setKeyInput('');
      Alert.alert('Saved', 'Your Gemini API key is stored securely on this device.');
    } finally {
      setSaving(false);
    }
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

        <View style={styles.section}>
          <Text style={[type.h2, { color: colors.text }]}>Voice (Gemini)</Text>
          <Text style={[type.body, { color: colors.textMuted }]}>
            Voice logging sends your recording to Google&apos;s Gemini API. Get a free key from
            Google AI Studio and set a spending cap on it.
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

          <Text style={[type.label, { color: colors.textMuted }]}>
            {hasKey ? 'Replace API key' : 'API key'}
          </Text>
          <TextInput
            value={keyInput}
            onChangeText={setKeyInput}
            placeholder="Paste your Gemini API key"
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
            disabled={saving || keyInput.trim().length === 0}
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
        </View>

        <View style={styles.section}>
          <Text style={[type.h2, { color: colors.text }]}>Model</Text>
          <Text style={[type.body, { color: colors.textMuted }]}>
            The Gemini model used for parsing. Change this if Google deprecates the default.
          </Text>
          <TextInput
            value={model}
            onChangeText={setModel}
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
          <Pressable
            accessibilityRole="button"
            onPress={saveModel}
            style={({ pressed }) => [
              styles.button,
              { backgroundColor: pressed ? colors.primaryPress : colors.primary },
            ]}>
            <Text style={[type.label, { color: colors.onPrimary }]}>Save model</Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  container: {
    paddingHorizontal: screenPaddingH,
    paddingVertical: space.md,
    paddingBottom: space.xxl,
    gap: space.xl,
  },
  section: { gap: space.sm },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    borderRadius: radius.md,
    padding: space.md,
  },
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
});
