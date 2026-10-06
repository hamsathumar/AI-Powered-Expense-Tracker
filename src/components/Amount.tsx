/**
 * THE amount component (design-system.md §10): centrally owns sign, colour,
 * currency symbol, and tabular figures so those rules can never drift
 * between screens. Never render a money value with a bare <Text>.
 *
 * Sign rules (design-system.md §3.2 + §2.2): expense −, income +; transfer
 * is an unsigned movement. A lending row passed its `direction` takes its
 * sign and lent/borrowed tone from `lendingPresentation`. Colour is ALWAYS paired with the sign
 * or the row's icon/label — never meaning by colour alone.
 */
import { Text, type TextStyle } from 'react-native';

import { formatAmount } from '@/domain/money';
import { lendingPresentation } from '@/domain/lendingPresentation';
import type { LendingDirection, TransactionType } from '@/domain/types';
import { useCurrency } from '@/theme/CurrencyContext';
import { useTheme } from '@/theme/ThemeContext';
import { type as typeScale } from '@/theme/tokens';

interface Props {
  valueMinor: number;
  /** Drives sign + colour. Omit for neutral (e.g. account balances). */
  txType?: TransactionType;
  /** With txType "lending": which of the four directions (null/omitted → neutral). */
  direction?: LendingDirection | null;
  /** Type-scale style; defaults to the transaction-row amount style. */
  textStyle?: TextStyle;
  /** Overrides the semantic colour, e.g. onPrimary inside the hero card
   *  (the sign still comes from txType, keeping meaning colour-independent). */
  colorOverride?: string;
}

export function Amount({
  valueMinor,
  txType,
  direction,
  textStyle = typeScale.amount,
  colorOverride,
}: Props) {
  const { colors } = useTheme();
  const { symbol } = useCurrency(); // subscribe so amounts re-render on change

  // Typed amounts are always-positive by convention; neutral values (e.g.
  // account balances) may be genuinely negative and must show it.
  const lend = txType === 'lending' && direction ? lendingPresentation(direction) : null;
  const sign = lend
    ? lend.sign
    : txType === 'expense'
      ? '−'
      : txType === 'income'
        ? '+'
        : valueMinor < 0
          ? '−'
          : '';
  const color = colorOverride ?? (lend ? colors[lend.tone] : txType ? colors[txType] : colors.text);

  return (
    <Text style={[typeScale.amount, textStyle, { color }]}>
      {sign}
      {formatAmount(valueMinor, symbol)}
    </Text>
  );
}
