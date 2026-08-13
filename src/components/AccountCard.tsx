/**
 * Account card (design-system-v2.md §5.12). An account-level container — not a
 * transaction row: it carries a 4px type-coloured left edge, a 40pt tinted
 * tile, an h2 name, the balance, an edit pencil, and a soft elevation so it
 * reads as a card that owns the list beneath it.
 *
 * Selected state is unmistakable (and never colour-alone): the card fills
 * `primarySoft`, its border becomes `primary`, and a filled "Showing below"
 * chip replaces the type subtitle so the active account and what it's filtering
 * are both explicit.
 */
import { Feather } from '@expo/vector-icons';
import type { ComponentProps } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Amount } from '@/components/Amount';
import type { Account, AccountType } from '@/domain/types';
import { useTheme } from '@/theme/ThemeContext';
import { layout, minTouchTarget, radius, shadow, space, type } from '@/theme/tokens';

type ColorKey = 'accountBank' | 'accountCard' | 'accountCash';

export const ACCOUNT_TYPE_META: Record<
  AccountType,
  { label: string; icon: ComponentProps<typeof Feather>['name']; colorKey: ColorKey }
> = {
  bank: { label: 'Bank', icon: 'briefcase', colorKey: 'accountBank' },
  card: { label: 'Card', icon: 'credit-card', colorKey: 'accountCard' },
  cash: { label: 'Cash', icon: 'dollar-sign', colorKey: 'accountCash' },
};

interface Props {
  account: Account;
  balanceMinor: number;
  selected: boolean;
  onPress: () => void;
  onEdit: () => void;
}

export function AccountCard({ account, balanceMinor, selected, onPress, onEdit }: Props) {
  const { colors, isDark } = useTheme();
  const meta = ACCOUNT_TYPE_META[account.type];
  const accent = colors[meta.colorKey];
  const icon = (account.icon as ComponentProps<typeof Feather>['name']) ?? meta.icon;
  const subtitle = [meta.label, account.ownerLabel].filter(Boolean).join(' · ');

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[
        styles.card,
        {
          backgroundColor: selected ? colors.primarySoft : colors.surface,
          borderColor: selected ? colors.primary : colors.border,
        },
        !isDark && shadow,
      ]}>
      <View style={[styles.edge, { backgroundColor: accent }]} />
      <View style={styles.content}>
        <View style={[styles.tile, { backgroundColor: `${accent}1F` }]}>
          <Feather name={icon} size={20} color={accent} />
        </View>
        <View style={styles.middle}>
          <Text numberOfLines={1} style={[type.h2, { color: colors.text }]}>
            {account.name}
          </Text>
          {selected ? (
            <View style={[styles.chip, { backgroundColor: colors.primary }]}>
              <Feather name="check" size={11} color={colors.onPrimary} />
              <Text style={[type.caption, { color: colors.onPrimary }]}>Showing below</Text>
            </View>
          ) : (
            <Text numberOfLines={1} style={[type.caption, { color: colors.textMuted }]}>
              {subtitle}
            </Text>
          )}
        </View>
        <View style={styles.trailing}>
          <Amount valueMinor={balanceMinor} />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Edit ${account.name}`}
            hitSlop={space.sm}
            onPress={onEdit}
            style={styles.edit}>
            <Feather name="edit-2" size={16} color={colors.textMuted} />
          </Pressable>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    borderRadius: layout.cardRadius,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  edge: { width: layout.accountEdge },
  content: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.lg,
  },
  tile: {
    width: layout.iconTile.size,
    height: layout.iconTile.size,
    borderRadius: layout.iconTile.radius,
    alignItems: 'center',
    justifyContent: 'center',
  },
  middle: { flex: 1, gap: space.xs },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    alignSelf: 'flex-start',
    borderRadius: radius.pill,
    paddingHorizontal: space.sm,
    paddingVertical: 2,
  },
  trailing: { alignItems: 'flex-end', gap: space.xs },
  edit: {
    minWidth: minTouchTarget - space.md,
    minHeight: minTouchTarget - space.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
