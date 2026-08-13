/**
 * Amount display (design-system-v2.md §5.13) — the transaction form's amount
 * as a centred, read-only figure (not a text input; the keypad drives it):
 * eyebrow "Amount", the signed value in Sora 700/40 coloured by type, and the
 * cents at 26pt in `textMuted`.
 *
 * Cents use a muted TEXT token, never a tint of the semantic hue (v2 §2.7) —
 * the digits are data and must keep body contrast. Sign comes from the type,
 * keeping meaning independent of colour.
 */
import { StyleSheet, Text, View } from 'react-native';

import { formatMinorUnits } from '@/domain/money';
import type { TransactionType } from '@/domain/types';
import { useCurrency } from '@/theme/CurrencyContext';
import { useTheme } from '@/theme/ThemeContext';
import { space, type } from '@/theme/tokens';

interface Props {
  valueMinor: number;
  txType: TransactionType;
}

export function AmountDisplay({ valueMinor, txType }: Props) {
  const { colors } = useTheme();
  const { symbol } = useCurrency();

  const sign = valueMinor <= 0 ? '' : txType === 'expense' ? '−' : txType === 'income' ? '+' : '';
  const [major, cents] = formatMinorUnits(Math.abs(valueMinor)).split('.');
  const color = colors[txType];

  return (
    <View style={styles.wrap}>
      <Text style={[type.sectionLabel, { color: colors.textSubtle }]}>Amount</Text>
      <View style={styles.figure}>
        <Text style={[type.amountInput, { color }]}>
          {sign}
          {symbol}
          {major}
        </Text>
        <Text style={[type.amountInputCents, { color: colors.textMuted }]}>.{cents}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: space.xs },
  figure: { flexDirection: 'row', alignItems: 'baseline', gap: space.xs },
});
