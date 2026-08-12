/**
 * Section header (design-system-v2.md §10) — a Home/Reports section title
 * (h2) with an optional trailing node: a count badge, an "Approve all"
 * action, or a summary figure. Keeps the section spacing consistent across
 * the app so headings never drift.
 */
import { StyleSheet, Text, View, type ViewStyle } from 'react-native';

import { useTheme } from '@/theme/ThemeContext';
import { space, type } from '@/theme/tokens';

interface Props {
  title: string;
  right?: React.ReactNode;
  style?: ViewStyle;
}

export function SectionHeader({ title, right, style }: Props) {
  const { colors } = useTheme();
  return (
    <View style={[styles.row, style]}>
      <Text style={[type.h2, { color: colors.text }]}>{title}</Text>
      {right}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
  },
});
