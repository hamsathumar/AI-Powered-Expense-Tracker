import { Feather } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import type { ComponentProps } from 'react';
import type { ColorValue } from 'react-native';

import { usePendingCount } from '@/state/PendingCount';
import { useTheme } from '@/theme/ThemeContext';
import { type as typeScale } from '@/theme/tokens';

type FeatherIconName = ComponentProps<typeof Feather>['name'];

function tabIcon(name: FeatherIconName) {
  return function TabIcon({ color, size }: { color: ColorValue; size: number }) {
    return <Feather name={name} color={color} size={size} />;
  };
}

/**
 * The four tabs from design-system.md §6: Home · Accounts · Reports · Queue.
 * Secondary screens (People, Bill Splitter, Recurring, Categories, Settings)
 * are deliberately NOT tabs — they'll be reached from Home.
 */
export default function TabsLayout() {
  const { colors } = useTheme();
  const { count } = usePendingCount();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textSubtle,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
        },
        tabBarLabelStyle: { fontFamily: typeScale.caption.fontFamily },
      }}>
      <Tabs.Screen
        name="index"
        options={{ title: 'Home', tabBarIcon: tabIcon('home') }}
      />
      <Tabs.Screen
        name="accounts"
        options={{ title: 'Accounts', tabBarIcon: tabIcon('credit-card') }}
      />
      <Tabs.Screen
        name="reports"
        options={{ title: 'Reports', tabBarIcon: tabIcon('pie-chart') }}
      />
      <Tabs.Screen
        name="queue"
        options={{
          title: 'Queue',
          tabBarIcon: tabIcon('inbox'),
          tabBarBadge: count > 0 ? count : undefined,
          tabBarBadgeStyle: { backgroundColor: colors.warning, color: colors.onPrimary },
        }}
      />
    </Tabs>
  );
}
