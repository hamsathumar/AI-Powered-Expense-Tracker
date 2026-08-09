/**
 * Theme context — supplies the active colour set (light/dark) to the app.
 *
 * Follows the system appearance via `useColorScheme()`. A manual override
 * (stored in the `settings` table) is planned for a later stage; when it
 * lands, only this file needs to change.
 */
import { createContext, useContext, useMemo, type PropsWithChildren } from 'react';
import { useColorScheme } from 'react-native';

import { darkColors, lightColors, type ThemeColors } from '@/theme/tokens';

export interface Theme {
  colors: ThemeColors;
  isDark: boolean;
}

const ThemeContext = createContext<Theme>({ colors: lightColors, isDark: false });

export function ThemeProvider({ children }: PropsWithChildren) {
  const scheme = useColorScheme();
  const isDark = scheme === 'dark';

  const value = useMemo<Theme>(
    () => ({ colors: isDark ? darkColors : lightColors, isDark }),
    [isDark],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
  return useContext(ThemeContext);
}
