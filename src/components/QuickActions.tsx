/**
 * Home quick-action row (design §6): compact shortcuts to the secondary
 * screens that used to sit as header icons — Recurring, Bill Splitter,
 * People, Categories. A single row of four icon+label tiles, reusing the
 * rounded tinted-icon-square language from transaction/account rows.
 */
import { Feather } from '@expo/vector-icons';
import { useRouter, type Href } from 'expo-router';
import type { ComponentProps } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { PressableScale } from '@/components/PressableScale';
import { useTheme } from '@/theme/ThemeContext';
import { layout, minTouchTarget, space, type } from '@/theme/tokens';

interface Action {
  href: Href;
  icon: ComponentProps<typeof Feather>['name'];
  label: string;
}

const ACTIONS: Action[] = [
  { href: '/recurring', icon: 'repeat', label: 'Recurring' },
  { href: '/bill-split', icon: 'divide-circle', label: 'Split' },
  { href: '/person', icon: 'users', label: 'People' },
  { href: '/categories', icon: 'tag', label: 'Categories' },
];

export function QuickActions() {
  const { colors } = useTheme();
  const router = useRouter();

  return (
    <View style={styles.row}>
      {ACTIONS.map((action) => (
        <PressableScale
          key={action.label}
          accessibilityRole="button"
          accessibilityLabel={action.label}
          onPress={() => router.push(action.href)}
          scaleTo={0.93}
          style={styles.tile}>
          <View
            style={[styles.iconBox, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Feather name={action.icon} size={19} color={colors.primary} />
          </View>
          <Text numberOfLines={1} style={[type.caption, { color: colors.textMuted }]}>
            {action.label}
          </Text>
        </PressableScale>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: space.sm,
  },
  tile: {
    flex: 1,
    alignItems: 'center',
    gap: space.sm - 2,
    minHeight: minTouchTarget,
  },
  iconBox: {
    width: layout.quickActionTile.size,
    height: layout.quickActionTile.size,
    borderRadius: layout.quickActionTile.radius,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
