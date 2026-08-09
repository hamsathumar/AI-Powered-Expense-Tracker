/**
 * THE amount component (design-system.md §10): centrally owns sign, colour,
 * currency symbol, and tabular figures so those rules can never drift
 * between screens. Never render a money value with a bare <Text>.
 *
 * Sign rules (design-system.md §3.2 + §2.2): expense −, income +; transfer
 * and lending are unsigned movements. Colour is ALWAYS paired with the sign
 * or the row's icon/label — never meaning by colour alone.
 */
import { Text, type TextStyle } from 'react-native';

import { formatAmount } from '@/domain/money';
import type { TransactionType } from '@/domain/types';
import { useTheme } from '@/theme/ThemeContext';
import { type as typeScale } from '@/theme/tokens';

interface Props {
  valueMinor: number;
  /** Drives sign + colour. Omit for neutral (e.g. account balances). */
  txType?: TransactionType;
  /** Type-scale style; defaults to the transaction-row amount style. */
  textStyle?: TextStyle;
}

export function Amount({ valueMinor, txType, textStyle = typeScale.amount }: Props) {
  const { colors } = useTheme();

  // Typed amounts are always-positive by convention; neutral values (e.g.
  // account balances) may be genuinely negative and must show it.
  const sign = txType === 'expense' ? '−' : txType === 'income' ? '+' : valueMinor < 0 ? '−' : '';
  const color = txType ? colors[txType] : colors.text;

  return (
    <Text style={[typeScale.amount, textStyle, { color }]}>
      {sign}
      {formatAmount(valueMinor)}
    </Text>
  );
}
