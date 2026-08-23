/**
 * Feel preferences — haptics on/off and motion level — shared by every screen.
 *
 * Two rules this context exists to enforce:
 *   1. Motion is OFF whenever the OS asks for reduced motion, regardless of
 *      the app setting. The app switch can only reduce motion further, never
 *      override an accessibility request.
 *   2. Haptics are gated in ONE place. `lib/haptics.ts` reads a module flag set
 *      from here, so non-component code (services, queries) can fire haptics
 *      without threading the preference through every call.
 */
import { createContext, use, useCallback, useEffect, useMemo, useState } from 'react';
import { useReducedMotion } from 'react-native-reanimated';

import {
  getHapticsEnabled,
  getMotionMode,
  setSetting,
  SETTINGS_KEYS,
  type MotionMode,
} from '@/db/queries/settings';
import { setHapticsEnabled } from '@/lib/haptics';

interface FeedbackValue {
  /** User preference. The actual firing is gated inside lib/haptics. */
  haptics: boolean;
  setHaptics: (enabled: boolean) => Promise<void>;
  motion: MotionMode;
  setMotion: (mode: MotionMode) => Promise<void>;
  /** Resolved answer for components: true = animate as little as possible. */
  reduceMotion: boolean;
}

const FeedbackContext = createContext<FeedbackValue>({
  haptics: true,
  setHaptics: async () => {},
  motion: 'system',
  setMotion: async () => {},
  reduceMotion: false,
});

export function FeedbackProvider({ children }: { children: React.ReactNode }) {
  const systemReduceMotion = useReducedMotion();
  const [haptics, setHapticsState] = useState(true);
  const [motion, setMotionState] = useState<MotionMode>('system');

  useEffect(() => {
    let cancelled = false;
    Promise.all([getHapticsEnabled(), getMotionMode()])
      .then(([enabled, mode]) => {
        if (cancelled) return;
        setHapticsState(enabled);
        setHapticsEnabled(enabled);
        setMotionState(mode);
      })
      .catch(() => {
        // Preferences are an enhancement — defaults are fine if the read fails.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const setHaptics = useCallback(async (enabled: boolean) => {
    setHapticsState(enabled);
    setHapticsEnabled(enabled);
    await setSetting(SETTINGS_KEYS.haptics, enabled ? 'on' : 'off');
  }, []);

  const setMotion = useCallback(async (mode: MotionMode) => {
    setMotionState(mode);
    await setSetting(SETTINGS_KEYS.motion, mode);
  }, []);

  const value = useMemo<FeedbackValue>(
    () => ({
      haptics,
      setHaptics,
      motion,
      setMotion,
      // The OS request wins; the app setting can only reduce further.
      reduceMotion: systemReduceMotion || motion === 'reduced',
    }),
    [haptics, setHaptics, motion, setMotion, systemReduceMotion],
  );

  return <FeedbackContext value={value}>{children}</FeedbackContext>;
}

export function useFeedback(): FeedbackValue {
  return use(FeedbackContext);
}

/** Shorthand for the common case: "should I animate?" */
export function useReduceMotion(): boolean {
  return use(FeedbackContext).reduceMotion;
}
