/**
 * Amount entry field. The user types major units ("1,250.50"); the parent
 * holds the raw string and converts via parseAmountInput() on save — minor
 * units never appear in the UI layer.
 */
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { DEFAULT_CURRENCY_SYMBOL, parseAmountInput } from '@/domain/money';
import { useTheme } from '@/theme/ThemeContext';
import { radius, space, type } from '@/theme/tokens';

interface Props {
  value: string;
  onChange: (text: string) => void;
}

export function AmountInput({ value, onChange }: Props) {
  const { colors } = useTheme();
  const invalid = value.length > 0 && parseAmountInput(value) === null;

  return (
    <View style={styles.container}>
      <Text style={[type.label, { color: colors.textMuted }]}>Amount</Text>
      <View
        style={[
          styles.field,
          {
            backgroundColor: colors.surface,
            borderColor: invalid ? colors.danger : colors.border,
          },
        ]}>
        <Text style={[type.display, { color: colors.textSubtle }]}>
          {DEFAULT_CURRENCY_SYMBOL}
        </Text>
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
