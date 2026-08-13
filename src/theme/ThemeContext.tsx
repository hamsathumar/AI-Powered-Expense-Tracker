/**
 * Theme context — supplies the active colour set (light/dark) to the app.
 *
 * Follows the system appearance by default (`useColorScheme()`), with a manual
 * override stored in settings (v2 §5.10 Appearance): 'system' | 'light' |
 * 'dark'. The stored preference is loaded once on mount and can be changed from
 * the Appearance subpage via `setMode`.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react';
import { useColorScheme } from 'react-native';

import {
  DEFAULT_APPEARANCE,
  getAppearance,
  setSetting,
  SETTINGS_KEYS,
  type AppearanceMode,
} from '@/db/queries/settings';
import { darkColors, lightColors, type ThemeColors } from '@/theme/tokens';

export interface Theme {
  colors: ThemeColors;
  isDark: boolean;
  mode: AppearanceMode;
  setMode: (mode: AppearanceMode) => Promise<void>;
  reloadAppearance: () => Promise<void>;
}

const ThemeContext = createContext<Theme>({
  colors: lightColors,
  isDark: false,
  mode: DEFAULT_APPEARANCE,
  setMode: async () => {},
  reloadAppearance: async () => {},
});

export function ThemeProvider({ children }: PropsWithChildren) {
  const scheme = useColorScheme();
  const [mode, setModeState] = useState<AppearanceMode>(DEFAULT_APPEARANCE);

  const reloadAppearance = useCallback(async () => {
    setModeState(await getAppearance());
  }, []);

  useEffect(() => {
    getAppearance().then(setModeState).catch(() => {});
  }, []);

  const setMode = useCallback(async (next: AppearanceMode) => {
    await setSetting(SETTINGS_KEYS.appearance, next);
    setModeState(next);
  }, []);

  const isDark = mode === 'system' ? scheme === 'dark' : mode === 'dark';

  const value = useMemo<Theme>(
    () => ({ colors: isDark ? darkColors : lightColors, isDark, mode, setMode, reloadAppearance }),
    [isDark, mode, setMode, reloadAppearance],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
  return useContext(ThemeContext);
}
