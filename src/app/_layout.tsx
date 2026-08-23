import { Inter_400Regular, Inter_500Medium } from '@expo-google-fonts/inter';
import { Sora_600SemiBold, Sora_700Bold } from '@expo-google-fonts/sora';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { AppState } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { evaluateRecurringTemplates } from '@/db/queries/recurring';
import { PendingCountProvider, usePendingCount } from '@/state/PendingCount';
import { VoiceJobsProvider } from '@/state/VoiceJobs';
import { CurrencyProvider } from '@/theme/CurrencyContext';
import { FeedbackProvider } from '@/theme/FeedbackContext';
import { ThemeProvider, useTheme } from '@/theme/ThemeContext';

// Keep the native splash visible until fonts are ready — avoids a flash of
// fallback type (design-system.md §10).
SplashScreen.preventAutoHideAsync();

/** §4.5: evaluate recurring templates on launch and whenever the app
 *  returns to the foreground. Generation is idempotent, so this is safe to
 *  run as often as it fires. */
function RecurringEvaluator() {
  const { refresh } = usePendingCount();

  useEffect(() => {
    const run = () => {
      evaluateRecurringTemplates()
        .then((generated) => {
          if (generated > 0) refresh();
        })
        .catch((e) => console.warn('Recurring evaluation failed:', e));
    };
    run();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') run();
    });
    return () => sub.remove();
  }, [refresh]);

  return null;
}

function RootStack() {
  const { colors } = useTheme();
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.bg },
        // Native iOS slide for pushed screens (forms, detail pages) + back gesture.
        animation: 'slide_from_right',
      }}>
      <Stack.Screen name="(tabs)" />
      {/* Voice capture reads as an overlay — slide up from the bottom. */}
      <Stack.Screen name="voice" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
    </Stack>
  );
}

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    Sora_600SemiBold,
    Sora_700Bold,
    Inter_400Regular,
    Inter_500Medium,
  });

  useEffect(() => {
    if (fontsLoaded) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded]);

  if (!fontsLoaded) {
    return null; // native splash is still covering the screen
  }

  return (
    // Required for swipe actions on rows — gesture-handler needs this at the
    // root, and without it gestures silently never fire.
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemeProvider>
        <CurrencyProvider>
          <FeedbackProvider>
            <PendingCountProvider>
            {/* TC-027: voice parses are owned here, above the router, so they
                survive leaving the voice screen and being killed by iOS. */}
              <VoiceJobsProvider>
                <RecurringEvaluator />
                <StatusBar style="auto" />
                <RootStack />
              </VoiceJobsProvider>
            </PendingCountProvider>
          </FeedbackProvider>
        </CurrencyProvider>
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}
