/**
 * Appearance subpage (Settings → Appearance). Overrides the system theme
 * (v2 §5.10): Follow system / Light / Dark, persisted via ThemeContext.setMode.
 * The selected option shows a check — colour never carries the choice alone.
 */
import { Feather } from '@expo/vector-icons';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ScreenHeader } from '@/components/ScreenHeader';
import type { AppearanceMode } from '@/db/queries/settings';
import { PressableScale } from '@/components/PressableScale';
import { useTheme } from '@/theme/ThemeContext';
import { layout, radius, screenPaddingH, space, type } from '@/theme/tokens';

const OPTIONS: { mode: AppearanceMode; label: string; hint: string; icon: 'smartphone' | 'sun' | 'moon' }[] = [
  { mode: 'system', label: 'Follow system', hint: 'Match your device setting', icon: 'smartphone' },
  { mode: 'light', label: 'Light', hint: 'Always the warm light theme', icon: 'sun' },
  { mode: 'dark', label: 'Dark', hint: 'Always the warm dark theme', icon: 'moon' },
];

export default function AppearanceScreen() {
  const { colors, mode, setMode } = useTheme();

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.bg }]} edges={['top']}>
      <ScreenHeader title="Appearance" />
      <ScrollView contentContainerStyle={styles.container}>
        {OPTIONS.map((opt) => {
          const selected = opt.mode === mode;
          return (
            <PressableScale
              key={opt.mode}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              onPress={() => void setMode(opt.mode)}
              scaleTo={0.98}
              style={[
                styles.row,
                { backgroundColor: colors.surface, borderColor: selected ? colors.primary : colors.border },
              ]}>
              <View style={[styles.tile, { backgroundColor: colors.primarySoft }]}>
                <Feather name={opt.icon} size={18} color={colors.primary} />
              </View>
              <View style={styles.text}>
                <Text style={[type.h2, { color: colors.text }]}>{opt.label}</Text>
                <Text style={[type.caption, { color: colors.textMuted }]}>{opt.hint}</Text>
              </View>
              {selected ? <Feather name="check" size={20} color={colors.primary} /> : null}
            </PressableScale>
          );
        })}
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
    gap: space.md + 2,
    borderRadius: layout.cardRadius,
    borderWidth: StyleSheet.hairlineWidth,
    padding: space.lg,
  },
  tile: {
    width: 38,
    height: 38,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: { flex: 1, gap: 2 },
});
