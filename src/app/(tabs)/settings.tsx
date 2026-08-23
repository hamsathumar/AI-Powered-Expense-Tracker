/**
 * Settings (design-system-v2.md §5.10) — Profile pinned at the top, then a
 * plain list of rows, each with a tinted icon tile, title, a one-line current
 * value, and a chevron. Each row pushes a subpage (slide_from_right): Currency,
 * Data & Backup, Voice, Appearance, About Kaasu. The current-value line is what
 * makes the list readable without opening anything.
 */
import { Feather } from '@expo/vector-icons';
import { useFocusEffect, useRouter, type Href } from 'expo-router';
import { useCallback, useState, type ComponentProps } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ScreenFade } from '@/components/motion/ScreenFade';

import { hasGeminiApiKey } from '@/ai/secureConfig';
import { getProfile, setSetting, SETTINGS_KEYS } from '@/db/queries/settings';
import { pickProfilePhoto, deleteProfilePhoto } from '@/services/profilePhoto';
import { useCurrency } from '@/theme/CurrencyContext';
import { useTheme } from '@/theme/ThemeContext';
import { layout, minTouchTarget, radius, screenPaddingH, space, type } from '@/theme/tokens';

const APPEARANCE_LABEL = { system: 'Follow system', light: 'Light', dark: 'Dark' } as const;

export default function SettingsScreen() {
  const { colors, mode } = useTheme();
  const currency = useCurrency();
  const router = useRouter();

  const [name, setName] = useState('');
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [hasKey, setHasKey] = useState(false);

  const loadAll = useCallback(() => {
    Promise.all([getProfile(), hasGeminiApiKey(), currency.reload()])
      .then(([profile, keyPresent]) => {
        setName(profile.name ?? '');
        setPhotoUri(profile.photoUri);
        setHasKey(keyPresent);
      })
      .catch(() => {});
  }, [currency]);

  useFocusEffect(loadAll);

  const changePhoto = async () => {
    try {
      const uri = await pickProfilePhoto();
      if (!uri) return;
      deleteProfilePhoto(photoUri);
      await setSetting(SETTINGS_KEYS.profilePhotoUri, uri);
      setPhotoUri(uri);
    } catch {
      // ignore — picking can be cancelled
    }
  };

  const saveName = () => void setSetting(SETTINGS_KEYS.profileName, name.trim());

  const rows: {
    icon: ComponentProps<typeof Feather>['name'];
    title: string;
    value: string;
    href: Href;
  }[] = [
    { icon: 'dollar-sign', title: 'Currency', value: `${currency.code} · ${currency.symbol.trim()}`, href: '/settings/currency' },
    { icon: 'database', title: 'Data & Backup', value: 'Export, restore, or clear', href: '/settings/data' },
    { icon: 'mic', title: 'Voice', value: hasKey ? 'Gemini · key connected' : 'No key yet', href: '/settings/voice' },
    { icon: 'sun', title: 'Appearance', value: APPEARANCE_LABEL[mode], href: '/settings/appearance' },
    { icon: 'info', title: 'About Kaasu', value: 'Version 1.0.0', href: '/settings/about' },
  ];

  return (
    <SafeAreaView
      // No 'bottom': inside the tab navigator the tab bar already owns the
      // home-indicator inset. Applying it here too clips the scroll content
      // and leaves a dead strip above the tab bar.
      edges={['top', 'left', 'right']}
      style={[styles.safeArea, { backgroundColor: colors.bg }]}>
      <ScreenFade>
        <ScrollView contentContainerStyle={styles.container}>
        <Text style={[type.h1, { color: colors.text }]}>Settings</Text>

        <View style={styles.profile}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Change profile photo"
            onPress={changePhoto}
            style={[styles.avatar, { backgroundColor: colors.primarySoft }]}>
            {photoUri ? (
              <Image source={{ uri: photoUri }} style={styles.avatarImage} />
            ) : (
              <Text style={[styles.avatarInitial, { color: colors.primary }]}>
                {(name.trim()[0] ?? 'K').toUpperCase()}
              </Text>
            )}
            <View style={[styles.avatarEdit, { backgroundColor: colors.primary, borderColor: colors.bg }]}>
              <Feather name="camera" size={13} color={colors.onPrimary} />
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

        <View style={styles.rows}>
          {rows.map((row) => (
            <Pressable
              key={row.title}
              accessibilityRole="button"
              onPress={() => router.push(row.href)}
              style={[styles.row, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <View style={[styles.tile, { backgroundColor: colors.primarySoft }]}>
                <Feather name={row.icon} size={18} color={colors.primary} />
              </View>
              <View style={styles.rowText}>
                <Text style={[type.h2, { color: colors.text }]}>{row.title}</Text>
                <Text numberOfLines={1} style={[type.caption, { color: colors.textMuted }]}>
                  {row.value}
                </Text>
              </View>
              <Feather name="chevron-right" size={18} color={colors.textSubtle} />
            </Pressable>
          ))}
        </View>
        </ScrollView>
      </ScreenFade>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  container: {
    paddingHorizontal: screenPaddingH,
    paddingTop: space.md,
    paddingBottom: space.xxl,
    gap: space.lg,
  },
  profile: { alignItems: 'center', gap: space.md },
  avatar: {
    width: 96,
    height: 96,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarImage: { width: 96, height: 96, borderRadius: radius.pill },
  avatarInitial: { fontFamily: type.displayXL.fontFamily, fontSize: 30 },
  avatarEdit: {
    position: 'absolute',
    right: 0,
    bottom: 2,
    width: 32,
    height: 32,
    borderRadius: radius.pill,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nameInput: { textAlign: 'center', minWidth: 160 },
  rows: { gap: space.md - 2 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md + 2,
    borderRadius: layout.cardRadius,
    borderWidth: StyleSheet.hairlineWidth,
    padding: space.lg,
    minHeight: minTouchTarget,
  },
  tile: {
    width: 38,
    height: 38,
    borderRadius: layout.iconTile.radius,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowText: { flex: 1, gap: 2 },
});
