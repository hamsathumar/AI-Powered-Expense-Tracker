/**
 * Amount entry field. The user types major units ("1,250.50"); the parent
 * holds the raw string and converts via parseAmountInput() on save — minor
 * units never appear in the UI layer.
 */
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { parseAmountInput } from '@/domain/money';
import { useCurrency } from '@/theme/CurrencyContext';
import { useTheme } from '@/theme/ThemeContext';
import { radius, space, type } from '@/theme/tokens';

interface Props {
  value: string;
  onChange: (text: string) => void;
  label?: string;
  /** Zero is valid for some fields (e.g. opening balance). */
  allowZero?: boolean;
}

export function AmountInput({ value, onChange, label = 'Amount', allowZero = false }: Props) {
  const { colors } = useTheme();
  const { symbol } = useCurrency();
  const invalid = value.length > 0 && parseAmountInput(value, { allowZero }) === null;

  return (
    <View style={styles.container}>
      <Text style={[type.label, { color: colors.textMuted }]}>{label}</Text>
      <View
        style={[
          styles.field,
          {
            backgroundColor: colors.surface,
            borderColor: invalid ? colors.danger : colors.border,
          },
        ]}>
        <Text style={[type.display, { color: colors.textSubtle }]}>{symbol}</Text>
        <TextInput
          value={value}
          onChangeText={onChange}
          keyboardType="decimal-pad"
          placeholder="0.00"
          placeholderTextColor={colors.textSubtle}
          style={[type.display, styles.input, { color: colors.text }]}
        />
      </View>
      {invalid ? (
        <Text style={[type.caption, { color: colors.danger }]}>
          Enter a positive amount with up to 2 decimals
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: space.sm,
  },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    borderWidth: 1,
    borderRadius: radius.lg,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  },
  input: {
    flex: 1,
    padding: 0,
  },
});
