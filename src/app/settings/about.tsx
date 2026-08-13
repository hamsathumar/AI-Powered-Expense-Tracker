/**
 * About subpage (Settings → About Kaasu). Version and a one-line description —
 * Kaasu is a private, single-user, voice-first money tracker.
 */
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ScreenHeader } from '@/components/ScreenHeader';
import { useTheme } from '@/theme/ThemeContext';
import { fontFamily, layout, radius, screenPaddingH, space, type } from '@/theme/tokens';

const ROWS: { label: string; value: string }[] = [
  { label: 'Version', value: '1.0.0' },
  { label: 'Name', value: 'Kaasu · “money” in Tamil/Malayalam' },
  { label: 'Storage', value: 'On this device only' },
];

export default function AboutScreen() {
  const { colors } = useTheme();

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.bg }]} edges={['top']}>
      <ScreenHeader title="About Kaasu" />
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.brand}>
          <View style={[styles.logo, { backgroundColor: colors.primary }]}>
            <Text style={[styles.logoText, { color: colors.onPrimary }]}>K</Text>
          </View>
          <Text style={[type.body, styles.tagline, { color: colors.textMuted }]}>
            A quiet, private, voice-first record of your money. It holds no money and connects to no
            institution.
          </Text>
        </View>

        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          {ROWS.map((row, i) => (
            <View
              key={row.label}
              style={[styles.row, i < ROWS.length - 1 && { borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth }]}>
              <Text style={[type.caption, { color: colors.textMuted }]}>{row.label}</Text>
              <Text style={[type.body, styles.value, { color: colors.text }]}>{row.value}</Text>
            </View>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  container: { paddingHorizontal: screenPaddingH, paddingTop: space.md, paddingBottom: space.xxl, gap: space.xl },
  brand: { alignItems: 'center', gap: space.md },
  logo: {
    width: 72,
    height: 72,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoText: { fontFamily: fontFamily.headingBold, fontSize: 34 },
  tagline: { textAlign: 'center' },
  card: {
    borderRadius: layout.cardRadius,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: space.lg,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.lg,
    paddingVertical: space.md + 2,
  },
  value: { flexShrink: 1, textAlign: 'right' },
});
