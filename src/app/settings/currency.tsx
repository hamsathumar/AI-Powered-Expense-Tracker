/**
 * Currency subpage (Settings → Currency). Display-only preference: changes the
 * symbol everywhere, never converts stored amounts.
 */
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ChipSelector } from '@/components/ChipSelector';
import { ScreenHeader } from '@/components/ScreenHeader';
import { CURRENCIES } from '@/domain/money';
import { useCurrency } from '@/theme/CurrencyContext';
import { useTheme } from '@/theme/ThemeContext';
import { screenPaddingH, space, type } from '@/theme/tokens';

export default function CurrencyScreen() {
  const { colors } = useTheme();
  const currency = useCurrency();

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.bg }]} edges={['top']}>
      <ScreenHeader title="Currency" />
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={[type.body, { color: colors.textMuted }]}>
          Changes the displayed symbol only — it never converts existing amounts.
        </Text>
        <View>
          <ChipSelector
            items={CURRENCIES.map((c) => ({ id: c.code, label: `${c.code} ${c.symbol.trim()}` }))}
            selectedId={currency.code}
            onSelect={(code) => void currency.setCurrency(code)}
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  container: { paddingHorizontal: screenPaddingH, paddingTop: space.sm, paddingBottom: space.xxl, gap: space.lg },
});
