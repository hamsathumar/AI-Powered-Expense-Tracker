import { Link } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useTheme } from '@/theme/ThemeContext';
import { minTouchTarget, radius, screenPaddingH, space, type } from '@/theme/tokens';

export default function HomeScreen() {
  const { colors } = useTheme();

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.bg }]}>
      <View style={styles.container}>
        <Text style={[type.h1, { color: colors.text }]}>Kaasu</Text>
        <Text style={[type.body, { color: colors.textMuted }]}>
          Dashboard coming in stage 5.
        </Text>
        {/* TEMPORARY — stage 2 verification entry point; remove with dev-db.tsx */}
        <Link
          href="/dev-db"
          style={[
            styles.devLink,
            type.label,
            { backgroundColor: colors.surfaceAlt, color: colors.textMuted },
          ]}>
          DEV: database check
        </Link>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  container: {
    flex: 1,
    paddingHorizontal: screenPaddingH,
    justifyContent: 'center',
    alignItems: 'center',
    gap: space.md,
  },
  devLink: {
    marginTop: space.xl,
    minHeight: minTouchTarget,
    borderRadius: radius.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    overflow: 'hidden',
    textAlign: 'center',
  },
});
