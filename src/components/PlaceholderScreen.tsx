/**
 * Temporary stand-in used while screens are being built stage by stage.
 * Styled entirely from theme tokens — doubles as a visual check that the
 * theme foundation (colours, fonts, spacing) works in light and dark mode.
 */
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useTheme } from '@/theme/ThemeContext';
import { screenPaddingH, space, type } from '@/theme/tokens';

interface Props {
  title: string;
  stage: string;
}

export function PlaceholderScreen({ title, stage }: Props) {
  const { colors } = useTheme();

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.bg }]}>
      <View style={styles.container}>
        <Text style={[type.h1, { color: colors.text }]}>{title}</Text>
        <Text style={[type.body, styles.subtitle, { color: colors.textMuted }]}>
          Coming in {stage}.
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  container: {
    flex: 1,
    paddingHorizontal: screenPaddingH,
    justifyContent: 'center',
    alignItems: 'center',
  },
  subtitle: {
    marginTop: space.sm,
  },
});
