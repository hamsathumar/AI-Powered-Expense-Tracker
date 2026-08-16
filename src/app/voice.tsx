/**
 * Voice capture (spec §8.3, design-system-v2.md §5.5) — the app's signature
 * interaction. Tap to record; stopping sends the audio to Gemini, validates,
 * and drops a pending transaction into the queue. Speed is the point: no
 * confirmation dialog before logging, and a failure keeps the recording so
 * nothing spoken is lost (technical-plan §5.7).
 *
 * The capture screen is a full-bleed brand surface (brown in light; the
 * neutral dark surface in dark, per v2 §2.8). It reads as a single instrument
 * that never looks static: a gold eyebrow names the current state, a live
 * waveform reacts while you speak, and the moment you stop the bars collapse
 * into a single travelling gold pulse. That pulse line stays mounted and
 * constant through the whole processing wait while the eyebrow/headline/caption
 * crossfade through a short Transcribing → Understanding → Saving sequence — a
 * perceived-progress trick (see PROCESSING_STAGES) that runs on a timer over
 * the single real async call, not a real per-step progress tracker. On success
 * it hands off to the "Logged" confirmation (parsed row + Approve now / Review
 * later).
 *
 * Backgrounding resilience (fix): iOS tears down an in-flight network request
 * once the app is suspended, so switching apps mid-parse used to surface a
 * terminal "network error" and drop the work. We now detect that the app was
 * backgrounded during processing and treat the resulting failure as an
 * interruption, not a failure — the recording is retained and the parse
 * resumes automatically the moment we're back in the foreground.
 */
import { Feather } from '@expo/vector-icons';
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Alert, Animated, AppState, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { logVoiceTransaction, type VoiceResult } from '@/ai/parseVoice';
import { hasGeminiApiKey } from '@/ai/secureConfig';
import { TransactionRow } from '@/components/TransactionRow';
import {
  listPendingTransactionItems,
  setTransactionStatus,
  type TransactionListItem,
} from '@/db/queries/transactions';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { usePendingCount } from '@/state/PendingCount';
import { useTheme } from '@/theme/ThemeContext';
import { fontFamily, layout, radius, screenPaddingH, space, type } from '@/theme/tokens';

type Phase = 'idle' | 'recording' | 'processing' | 'success' | 'error';

function formatDuration(ms: number): string {
  const total = Math.floor(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

type WaveMode = 'ready' | 'listening' | 'processing';

const WAVE_BARS = 40;

/**
 * Perceived-progress stages shown during the processing gap (recording stopped
 * → real result ready). This is purely presentational: the labels cycle on a
 * timer while the single real async call runs underneath, so the screen reads
 * as staged work rather than one frozen message. It is NOT wired to the real
 * transcription / parse / insert milestones. Durations vary slightly per stage
 * (0.7–1.3s) so the cadence feels natural; the last stage loops if the real
 * work outlasts the sequence. Copy stays in Kaasu's plain, warm voice
 * (design-system.md §1).
 */
const PROCESSING_STAGES = [
  { eyebrow: 'Transcribing', heading: 'Catching that…', caption: 'Turning your voice into words.', hold: 1000 },
  { eyebrow: 'Understanding', heading: 'Working on it…', caption: 'Turning your words into a transaction.', hold: 1500 },
  { eyebrow: 'Saving', heading: 'Almost done…', caption: 'Getting it ready for your queue.', hold: 600 },
] as const;

/** The real async result, buffered so it lands only at a stage boundary — never
 *  mid-stage (see the stage-sequencing effect). */
type Outcome =
  | { kind: 'success'; result: VoiceResult; loggedItem: TransactionListItem | null }
  | { kind: 'error'; message: string };

/** Cosine window so the row of bars reads as a tapered *shape* (short at the
 *  edges, tall in the middle) rather than a flat meter. Returns 0.18–1. */
function taper(i: number): number {
  const t = i / (WAVE_BARS - 1);
  return 0.18 + Math.sin(Math.PI * t) * 0.82;
}

/**
 * The instrument. Three visual modes sharing one footprint so state changes
 * crossfade in place and the screen never looks stuck:
 *  - ready       → a still row of low dots
 *  - listening   → 40 tapered bars looping at speech-like speed
 *  - processing  → the bars are gone; a 2px line carries a gold pulse across it
 */
function Waveform({
  mode,
  onColor,
  gold,
  reduceMotion,
}: {
  mode: WaveMode;
  onColor: string;
  gold: string;
  reduceMotion: boolean;
}) {
  const [bars] = useState(() => [...Array(WAVE_BARS)].map(() => new Animated.Value(0.25)));
  const [pulse] = useState(() => new Animated.Value(0));
  const [width, setWidth] = useState(0);

  useEffect(() => {
    if (mode !== 'listening') {
      bars.forEach((b) => b.setValue(0.25));
      return;
    }
    const loops = bars.map((b, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.timing(b, {
            toValue: 0.45 + ((i * 7) % 5) * 0.11,
            duration: 300 + (i % 6) * 45,
            useNativeDriver: true,
          }),
          Animated.timing(b, {
            toValue: 0.25,
            duration: 300 + (i % 6) * 45,
            useNativeDriver: true,
          }),
        ]),
      ),
    );
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
  }, [mode, bars]);

  useEffect(() => {
    if (mode !== 'processing') {
      pulse.setValue(0);
      return;
    }
    if (reduceMotion) {
      // Reduce-motion: keep the line, park the pulse near centre — no travel.
      pulse.setValue(0.5);
      return;
    }
    const loop = Animated.loop(
      Animated.timing(pulse, {
        toValue: 1,
        duration: 1300,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [mode, pulse, reduceMotion]);

  if (mode === 'processing') {
    return (
      <View style={styles.waveArea} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
        <View style={[styles.pulseLine, { backgroundColor: `${onColor}2E` }]} />
        <Animated.View
          style={[
            styles.pulseDot,
            {
              backgroundColor: gold,
              transform: [
                {
                  translateX: pulse.interpolate({
                    inputRange: [0, 1],
                    outputRange: [-PULSE_W, width],
                  }),
                },
              ],
            },
          ]}
        />
      </View>
    );
  }

  return (
    <View style={styles.waveArea}>
      {bars.map((b, i) => (
        <Animated.View
          key={i}
          style={[
            styles.waveBar,
            {
              backgroundColor: mode === 'ready' ? `${onColor}3D` : onColor,
              height: 6 + taper(i) * 42,
              transform: [{ scaleY: mode === 'ready' ? 0.1 : b }],
            },
          ]}
        />
      ))}
    </View>
  );
}

export default function VoiceScreen() {
  const { colors, isDark } = useTheme();
  const router = useRouter();
  const { refresh } = usePendingCount();

  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(recorder);

  const reduceMotion = useReducedMotion();

  const [phase, setPhase] = useState<Phase>('idle');
  const [message, setMessage] = useState('Tap to speak');
  const [result, setResult] = useState<VoiceResult | null>(null);
  const [loggedItem, setLoggedItem] = useState<TransactionListItem | null>(null);
  const [retryUri, setRetryUri] = useState<string | null>(null);

  // Perceived-progress stage machine (cosmetic). `stage` is the logical stage
  // the timer has advanced to; `shownStage` is what's currently rendered, and
  // lags `stage` by one crossfade so the label/caption swap happens at 0 opacity.
  const [stage, setStage] = useState(0);
  const [shownStage, setShownStage] = useState(0);
  const [fadeText] = useState(() => new Animated.Value(1));
  const outcomeRef = useRef<Outcome | null>(null); // real result, buffered

  // The pulse ring breathes while recording AND while understanding, so the
  // processing wait doesn't feel frozen.
  const [pulse] = useState(() => new Animated.Value(1));
  useEffect(() => {
    if (phase !== 'recording' && phase !== 'processing') {
      pulse.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.12, duration: 600, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 600, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [phase, pulse]);

  // Continuous spin for the loader icon while Gemini is parsing.
  const [spin] = useState(() => new Animated.Value(0));
  useEffect(() => {
    if (phase !== 'processing') {
      spin.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.timing(spin, {
        toValue: 1,
        duration: 900,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [phase, spin]);
  const spinDeg = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  // ---- Backgrounding resilience --------------------------------------------
  // Refs (not state) so the single AppState listener always sees live values
  // without re-subscribing, and so the async parse can coordinate with it.
  const phaseRef = useRef(phase);
  const inFlightRef = useRef(false); // a parse request is currently running
  const interruptedRef = useRef(false); // app went to background during a parse
  const lastUriRef = useRef<string | null>(null); // audio of the active parse
  const processRef = useRef<(uri: string) => Promise<void>>(async () => { });
  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  const process = async (uri: string) => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    interruptedRef.current = false; // fresh attempt
    outcomeRef.current = null; // discard any stale buffered result
    lastUriRef.current = uri;
    setPhase('processing');
    setMessage('Understanding…');
    try {
      const parsed = await logVoiceTransaction(uri);
      const items = await listPendingTransactionItems();
      const item = items.find((i) => i.tx.id === parsed.id) ?? null;
      refresh();
      // Buffer the result — the stage machine lands it at a stage boundary so
      // the processing sequence never cuts away mid-stage.
      outcomeRef.current = { kind: 'success', result: parsed, loggedItem: item };
      inFlightRef.current = false;
    } catch (e) {
      setRetryUri(uri); // keep the recording — never lose it

      // If the app was backgrounded mid-request, iOS almost certainly killed
      // the network call. Don't burn the recording on that: resume instead.
      if (interruptedRef.current) {
        inFlightRef.current = false;
        if (AppState.currentState === 'active') {
          void process(uri); // already back in front → retry straight away
        } else {
          // Still away — stay in the working state; the AppState listener
          // resumes the parse the moment we return to the foreground.
          setMessage('Paused — resuming when you reopen Kaasu…');
        }
        return;
      }

      inFlightRef.current = false;
      outcomeRef.current = { kind: 'error', message: e instanceof Error ? e.message : String(e) };
    }
  };
  useEffect(() => {
    processRef.current = process;
  });

  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'background' || next === 'inactive') {
        if (phaseRef.current === 'processing') interruptedRef.current = true;
      } else if (next === 'active') {
        // Resume a parse the OS interrupted while we were away. Guard on
        // inFlightRef so we never start a second request (double-insert).
        if (
          interruptedRef.current &&
          !inFlightRef.current &&
          lastUriRef.current &&
          phaseRef.current === 'processing'
        ) {
          void processRef.current(lastUriRef.current);
        }
      }
    });
    return () => sub.remove();
  }, []);

  // Perceived-progress stage machine. Runs only while processing: it cycles the
  // labels on a timer, and it is the single place that lands the real result —
  // always at a stage boundary, so the sequence finishes its current stage
  // rather than cutting away mid-message. If the work outlasts the sequence the
  // last stage (Saving) loops; if it finishes early we still see the current
  // stage through before switching. Fully decoupled from the real async work.
  useEffect(() => {
    if (phase !== 'processing') return;

    // This effect runs once per fresh entry to processing (phase changes to
    // 'processing'). A background→foreground resume keeps phase === 'processing'
    // so the effect is NOT re-run — the original timer chain simply continues,
    // meaning the sequence resumes where it left off rather than restarting.
    // `stage`/`shownStage` are reset to 0 by whoever starts a fresh sequence
    // (stopRecording / retry), so the first render already shows stage 0.
    let current = 0;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    const land = (outcome: Outcome) => {
      if (outcome.kind === 'success') {
        setResult(outcome.result);
        setLoggedItem(outcome.loggedItem);
        setRetryUri(null);
        setPhase('success');
      } else {
        setMessage(outcome.message);
        setPhase('error');
      }
    };

    const tick = () => {
      if (cancelled) return;
      const outcome = outcomeRef.current;
      if (outcome) {
        land(outcome); // current stage held its minimum — safe to switch now
        return;
      }
      current = Math.min(current + 1, PROCESSING_STAGES.length - 1); // loop on last
      setStage(current);
      timer = setTimeout(tick, PROCESSING_STAGES[current].hold);
    };

    timer = setTimeout(tick, PROCESSING_STAGES[0].hold);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [phase]);

  // Crossfade the label/caption when the stage advances: fade out, swap the
  // rendered stage at zero opacity, fade back in. Under reduce-motion this
  // effect is a no-op — the render reads `stage` directly for an instant swap.
  useEffect(() => {
    if (reduceMotion || stage === shownStage) return;
    Animated.timing(fadeText, { toValue: 0, duration: 160, useNativeDriver: true }).start(() => {
      setShownStage(stage);
      Animated.timing(fadeText, { toValue: 1, duration: 220, useNativeDriver: true }).start();
    });
  }, [stage, shownStage, fadeText, reduceMotion]);

  const startRecording = async () => {
    if (!(await hasGeminiApiKey())) {
      Alert.alert('No API key', 'Add your Gemini API key in Settings to log by voice.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Open Settings', onPress: () => router.push('/settings') },
      ]);
      return;
    }
    const permission = await requestRecordingPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Microphone needed', 'Enable microphone access for Kaasu in iOS Settings.');
      return;
    }
    try {
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      setResult(null);
      setLoggedItem(null);
      setPhase('recording');
      setMessage('Listening…');
    } catch (e) {
      setMessage(String(e));
      setPhase('error');
    }
  };

  // Rewind the perceived-progress sequence to stage 0 before a fresh parse, so
  // it never opens mid-sequence. (A background resume skips this on purpose.)
  const beginStageSequence = () => {
    setStage(0);
    setShownStage(0);
    fadeText.setValue(1);
  };

  const stopRecording = async () => {
    try {
      await recorder.stop();
    } catch {
      // fall through — uri may still be set
    }
    const uri = recorder.uri;
    if (!uri) {
      setMessage('Recording was empty — try again.');
      setPhase('error');
      return;
    }
    beginStageSequence();
    await process(uri);
  };

  const retry = () => {
    if (retryUri) {
      beginStageSequence();
      void process(retryUri);
    }
  };

  const sayAnother = () => {
    setResult(null);
    setLoggedItem(null);
    setPhase('idle');
    setMessage('Tap to speak');
  };

  const approveNow = async () => {
    if (!result) return;
    await setTransactionStatus(result.id, 'approved');
    refresh();
    router.back();
  };

  const onPressButton = () => {
    if (phase === 'recording') void stopRecording();
    else if (phase === 'idle' || phase === 'error') void startRecording();
  };

  const recording = phase === 'recording';
  const busy = phase === 'processing';

  // ---- Confirmation ("Logged") — on the app background (v2 §5.5) ----------
  if (phase === 'success' && result) {
    return (
      <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.bg }]}>
        <View style={styles.confirmCenter}>
          <View style={[styles.check, { backgroundColor: `${colors.income}1F` }]}>
            <Feather name="check" size={34} color={colors.income} />
          </View>
          <Text style={[type.h1, { color: colors.text }]}>Logged</Text>

          {loggedItem ? (
            <View style={[styles.loggedCard, { borderColor: colors.border }]}>
              <TransactionRow item={loggedItem} />
            </View>
          ) : (
            <Text style={[type.h2, styles.centerText, { color: colors.text }]}>“{result.name}”</Text>
          )}

          {result.flags.length > 0 ? (
            <View style={styles.flagRow}>
              {result.flags.map((flag) => (
                <View key={flag} style={[styles.flagPill, { borderColor: colors.warning }]}>
                  <Text style={[type.caption, { color: isDark ? colors.warning : colors.lending }]}>
                    {flag.replaceAll('_', ' ')}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}

          <Text style={[type.body, styles.centerText, { color: colors.textMuted }]}>
            Waiting in your queue on Home. Nothing is counted until you approve it.
          </Text>

          <View style={styles.confirmActions}>
            <Pressable
              accessibilityRole="button"
              onPress={approveNow}
              style={[styles.confirmButton, { backgroundColor: colors.positiveFill }]}>
              <Text style={[styles.confirmLabel, { color: colors.onFilled }]}>Approve now</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => router.back()}
              style={[styles.confirmButton, { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: StyleSheet.hairlineWidth }]}>
              <Text style={[styles.confirmLabel, { color: colors.textMuted }]}>Review later</Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.sayAnotherWrap}>
          <Pressable
            accessibilityRole="button"
            onPress={sayAnother}
            style={[styles.sayAnother, { backgroundColor: colors.surfaceAlt }]}>
            <Feather name="mic" size={16} color={colors.primary} />
            <Text style={[type.label, { color: colors.primary }]}>Say another</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  // ---- Capture (idle / recording / processing / error) — brand surface ----
  const captureBg = isDark ? colors.surface : colors.primary;
  const onCapture = isDark ? colors.text : colors.onPrimary;
  const onCaptureMuted = isDark ? colors.textMuted : `${colors.onPrimary}B3`;
  const ringColor = isDark ? `${colors.primary}33` : `${colors.onPrimary}22`;
  const buttonBg = isDark ? colors.primary : colors.onPrimary;
  const buttonIcon = isDark ? colors.onPrimary : colors.primary;
  const gold = colors.canopyAccent;

  // Under reduce-motion there's no crossfade, so render the live `stage`
  // directly (instant swap); otherwise render `shownStage`, which lags by one
  // fade so text swaps at zero opacity.
  const displayStage = reduceMotion ? stage : shownStage;
  const stageInfo = PROCESSING_STAGES[Math.min(displayStage, PROCESSING_STAGES.length - 1)];
  const eyebrow = busy ? stageInfo.eyebrow : recording ? 'Listening' : 'Ready';
  const heading = busy ? stageInfo.heading : recording ? 'I’m listening…' : 'What did you\nspend on?';
  const subtitle = busy
    ? stageInfo.caption
    : recording
      ? 'Tap the button below when you’re done.'
      : 'Tap the mic and just say it — amount, place, the rest is on me.';

  const isError = phase === 'error';

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: captureBg }]}>
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close"
          onPress={() => router.back()}
          style={[styles.close, { backgroundColor: isDark ? colors.surfaceAlt : colors.primaryPress }]}>
          <Feather name="x" size={20} color={onCapture} />
        </Pressable>
      </View>

      {isError ? (
        // ---- Failure — dashed ring, what happened, recovery pair (v2) ------
        <View style={styles.failCenter}>
          <View style={[styles.failRing, { borderColor: `${onCapture}59` }]}>
            <Feather name="alert-triangle" size={30} color={gold} />
          </View>
          <Text style={[type.sectionLabel, { color: gold }]}>Couldn’t log that</Text>
          <Text style={[styles.hint, styles.centerText, { color: onCapture }]}>{message}</Text>
          <Text style={[type.body, styles.centerText, { color: onCaptureMuted }]}>
            {retryUri
              ? 'Your recording is safe — try again without repeating yourself.'
              : 'Nothing was saved. Give it another go.'}
          </Text>
          <View style={styles.failActions}>
            {retryUri ? (
              <Pressable
                accessibilityRole="button"
                onPress={retry}
                style={[styles.failPrimary, { backgroundColor: buttonBg }]}>
                <Feather name="refresh-cw" size={16} color={buttonIcon} />
                <Text style={[styles.confirmLabel, { color: buttonIcon }]}>Retry parsing</Text>
              </Pressable>
            ) : (
              <Pressable
                accessibilityRole="button"
                onPress={startRecording}
                style={[styles.failPrimary, { backgroundColor: buttonBg }]}>
                <Feather name="mic" size={16} color={buttonIcon} />
                <Text style={[styles.confirmLabel, { color: buttonIcon }]}>Record again</Text>
              </Pressable>
            )}
            <Pressable
              accessibilityRole="button"
              onPress={() => router.back()}
              style={[styles.failSecondary, { borderColor: `${onCapture}40` }]}>
              <Text style={[styles.confirmLabel, { color: onCapture }]}>Close</Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <>
          <View style={styles.instrument}>
            <Animated.Text style={[type.sectionLabel, { color: gold, opacity: busy ? fadeText : 1 }]}>
              {eyebrow}
            </Animated.Text>
            <Waveform
              mode={busy ? 'processing' : recording ? 'listening' : 'ready'}
              onColor={onCapture}
              gold={gold}
              reduceMotion={reduceMotion}
            />
            {recording ? (
              <Text style={[styles.timer, { color: onCaptureMuted }]}>
                {formatDuration(recorderState.durationMillis)}
              </Text>
            ) : null}
          </View>

          <Animated.View style={[styles.prompt, busy && { opacity: fadeText }]}>
            <Text style={[styles.heading, styles.centerText, { color: onCapture }]}>{heading}</Text>
            <Text style={[styles.subtitle, styles.centerText, { color: onCaptureMuted }]}>
              {subtitle}
            </Text>
          </Animated.View>

          <View style={styles.buttonArea}>
            <View style={styles.buttonWrap}>
              <Animated.View
                style={[
                  styles.ring,
                  { backgroundColor: ringColor, transform: [{ scale: pulse }] },
                  !(recording || busy) && styles.hidden,
                ]}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={recording ? 'Stop recording' : 'Start recording'}
                disabled={busy}
                onPress={onPressButton}
                style={[styles.recordButton, { backgroundColor: buttonBg }]}>
                {busy ? (
                  <Animated.View style={{ transform: [{ rotate: spinDeg }] }}>
                    <Feather name="loader" size={30} color={buttonIcon} />
                  </Animated.View>
                ) : (
                  <Feather name={recording ? 'square' : 'mic'} size={30} color={buttonIcon} />
                )}
              </Pressable>
            </View>
            <Text style={[type.label, styles.centerText, { color: onCaptureMuted }]}>
              {recording ? 'Tap to stop' : busy ? 'Almost there…' : 'Tap to speak'}
            </Text>
          </View>
        </>
      )}
    </SafeAreaView>
  );
}

const RING = 96;
const BUTTON = 74;
const PULSE_W = 56;

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  header: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: screenPaddingH,
    paddingVertical: space.md,
  },
  close: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Capture layout — three stacked regions between the header and the button.
  instrument: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: space.lg,
    paddingHorizontal: space.xl,
    paddingBottom: space.xl,
  },
  prompt: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: space.md,
    paddingHorizontal: space.xl,
    paddingTop: space.sm,
  },
  heading: { fontFamily: fontFamily.headingBold, fontSize: 32, lineHeight: 38 },
  subtitle: { ...type.body, fontSize: 16, lineHeight: 24, maxWidth: 320 },

  // Waveform / instrument
  waveArea: {
    height: 60,
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  waveBar: { width: 3, borderRadius: radius.pill },
  pulseLine: { position: 'absolute', left: 0, right: 0, height: 2, borderRadius: 1 },
  pulseDot: { position: 'absolute', width: PULSE_W, height: 3, borderRadius: radius.pill },

  timer: { ...type.amount, fontSize: 15 },

  buttonArea: { alignItems: 'center', gap: space.md, paddingBottom: space.xxl + space.md },
  buttonWrap: { width: RING, height: RING, alignItems: 'center', justifyContent: 'center' },
  ring: { position: 'absolute', width: RING, height: RING, borderRadius: RING / 2 },
  hidden: { opacity: 0 },
  recordButton: {
    width: BUTTON,
    height: BUTTON,
    borderRadius: BUTTON / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  centerText: { textAlign: 'center' },
  hint: { fontFamily: fontFamily.heading, fontSize: 22, lineHeight: 30 },

  // Failure state
  failCenter: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.xxl,
    gap: space.lg,
  },
  failRing: {
    width: 88,
    height: 88,
    borderRadius: radius.pill,
    borderWidth: 2,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.xs,
  },
  failActions: { width: '100%', gap: space.sm + 2, paddingTop: space.md },
  failPrimary: {
    height: 50,
    borderRadius: radius.pill,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
  },
  failSecondary: {
    height: 50,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Confirmation
  confirmCenter: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.xxl,
    gap: space.lg,
  },
  check: {
    width: 72,
    height: 72,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loggedCard: {
    width: '100%',
    borderRadius: layout.cardRadius,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  flagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs, justifyContent: 'center' },
  flagPill: {
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: space.sm,
    paddingVertical: 1,
  },
  confirmActions: { flexDirection: 'row', gap: space.sm + 2, width: '100%' },
  confirmButton: {
    flex: 1,
    height: 50,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmLabel: { fontFamily: fontFamily.heading, fontSize: 15 },
  sayAnotherWrap: { alignItems: 'center', paddingBottom: space.xxl },
  sayAnother: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    borderRadius: radius.pill,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm + 2,
  },
});
