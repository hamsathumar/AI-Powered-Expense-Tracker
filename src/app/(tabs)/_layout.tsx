import { Feather } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import type { ComponentProps } from 'react';
import type { ColorValue } from 'react-native';

import { useTheme } from '@/theme/ThemeContext';
import { type as typeScale } from '@/theme/tokens';

type FeatherIconName = ComponentProps<typeof Feather>['name'];

function tabIcon(name: FeatherIconName) {
  return function TabIcon({ color, size }: { color: ColorValue; size: number }) {
    return <Feather name={name} color={color} size={size} />;
  };
}

/**
 * Four tabs (design §6): Home · Accounts · Reports · Settings.
 * The Approval Queue is embedded in Home (no longer a tab); other secondary
 * screens (People, Bill Splitter, Recurring, Categories) are reached from
 * Home's quick-action row.
 */
export default function TabsLayout() {
  const { colors } = useTheme();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        // Smooth cross-shift between tabs instead of an instant cut (design §7).
        animation: 'shift',
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textSubtle,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
        },
        tabBarLabelStyle: { fontFamily: typeScale.caption.fontFamily },
      }}>
      <Tabs.Screen name="index" options={{ title: 'Home', tabBarIcon: tabIcon('home') }} />
      <Tabs.Screen
        name="accounts"
        options={{ title: 'Accounts', tabBarIcon: tabIcon('credit-card') }}
      />
      <Tabs.Screen name="reports" options={{ title: 'Reports', tabBarIcon: tabIcon('pie-chart') }} />
      <Tabs.Screen name="settings" options={{ title: 'Settings', tabBarIcon: tabIcon('settings') }} />
    </Tabs>
  );
}
