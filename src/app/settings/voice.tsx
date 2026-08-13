/**
 * Voice subpage (Settings → Voice). The Gemini API key (stored in the keychain,
 * never a committed file) and the model name (user-editable so a deprecated
 * default can be swapped without a code change).
 */
import { Feather } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Linking, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { clearGeminiApiKey, getGeminiApiKey, setGeminiApiKey } from '@/ai/secureConfig';
import { ScreenHeader } from '@/components/ScreenHeader';
import { DEFAULT_GEMINI_MODEL, getGeminiModel, setSetting, SETTINGS_KEYS } from '@/db/queries/settings';
import { useTheme } from '@/theme/ThemeContext';
import { minTouchTarget, radius, screenPaddingH, space, type } from '@/theme/tokens';

export default function VoiceSettingsScreen() {
  const { colors } = useTheme();
  const [keyInput, setKeyInput] = useState('');
  const [hasKey, setHasKey] = useState(false);
  const [model, setModel] = useState(DEFAULT_GEMINI_MODEL);

  const load = useCallback(() => {
    Promise.all([getGeminiApiKey(), getGeminiModel()])
      .then(([key, m]) => {
        setHasKey(Boolean(key));
        setModel(m);
      })
      .catch(() => {});
  }, []);
  useFocusEffect(load);

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

  const keyEmpty = keyInput.trim().length === 0;

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.bg }]} edges={['top']}>
      <ScreenHeader title="Voice" />
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text style={[type.body, { color: colors.textMuted }]}>
          Voice logging sends your recording to Gemini. Get a free key from Google AI Studio and set a
          spending cap on it.
        </Text>
        <Pressable accessibilityRole="link" onPress={() => Linking.openURL('https://aistudio.google.com/apikey')}>
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
          style={[type.body, styles.field, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text }]}
        />
        <Pressable
          accessibilityRole="button"
          disabled={keyEmpty}
          onPress={saveKey}
          style={({ pressed }) => [
            styles.button,
            { backgroundColor: keyEmpty ? colors.surfaceAlt : pressed ? colors.primaryPress : colors.primary },
          ]}>
          <Text style={[type.label, { color: keyEmpty ? colors.textSubtle : colors.onPrimary }]}>Save key</Text>
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
          style={[type.body, styles.field, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text }]}
        />
        <Text style={[type.caption, { color: colors.textSubtle }]}>
          Change this if Google deprecates the default.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  container: { paddingHorizontal: screenPaddingH, paddingTop: space.sm, paddingBottom: space.xxl, gap: space.sm },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    borderRadius: radius.md,
    padding: space.md,
  },
  field: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  },
  button: {
    minHeight: minTouchTarget,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textButton: { minHeight: minTouchTarget, alignItems: 'center', justifyContent: 'center' },
  modelLabel: { marginTop: space.sm },
});
