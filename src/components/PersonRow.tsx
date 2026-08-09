/**
 * Person balance row (design-system.md §5.7):
 *
 *   [avatar initials]  Kamal          Owes you Rs500
 *
 * Direction is stated in WORDS — never colour or sign alone.
 */
import { StyleSheet, Text, View } from 'react-native';

import { formatAmount } from '@/domain/money';
import type { Person } from '@/domain/types';
import { useTheme } from '@/theme/ThemeContext';
import { minTouchTarget, radius, space, type } from '@/theme/tokens';

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]!.toUpperCase())
    .join('');
}

/** Worded net balance. Positive = they owe the user (§4.3). */
export function describeNet(netMinor: number): string {
  if (netMinor > 0) return `Owes you ${formatAmount(netMinor)}`;
  if (netMinor < 0) return `You owe ${formatAmount(-netMinor)}`;
  return 'Settled up';
}

interface Props {
  person: Person;
  netMinor: number;
}

export function PersonRow({ person, netMinor }: Props) {
  const { colors } = useTheme();

  return (
    <View style={[styles.row, { backgroundColor: colors.surface }]}>
      <View style={[styles.avatar, { backgroundColor: colors.primarySoft }]}>
        <Text style={[type.label, { color: colors.primary }]}>{initials(person.name)}</Text>
      </View>
      <View style={styles.middle}>
        <Text numberOfLines={1} style={[type.body, { color: colors.text }]}>
          {person.name}
        </Text>
        {person.unresolved ? (
          <Text style={[type.caption, { color: colors.warning }]}>⚠ Unconfirmed name</Text>
        ) : null}
      </View>
      <Text
        style={[
          type.label,
          { color: netMinor === 0 ? colors.textMuted : colors.lending },
        ]}>
        {describeNet(netMinor)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.md,
    borderRadius: radius.md,
    minHeight: minTouchTarget + space.md,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  middle: { flex: 1, gap: 2 },
});
