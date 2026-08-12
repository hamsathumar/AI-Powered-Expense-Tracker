/**
 * Voice capture (spec §8.3, design-system-v2.md §5.5) — the app's signature
 * interaction. Tap to record; stopping sends the audio to Gemini, validates,
 * and drops a pending transaction into the queue. Speed is the point: no
 * confirmation dialog before logging, and a failure keeps the recording so
 * nothing spoken is lost (technical-plan §5.7).
 *
 * The capture screen is a full-bleed brand surface (brown in light; the
 * neutral dark surface in dark, per v2 §2.8) with a gold "Listening" eyebrow,
 * an amplitude meter, timer, and a large mic/stop button. On success it hands
 * off to the "Logged" confirmation on the app background, which shows the
 * parsed row and offers Approve now / Review later.
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
import { useEffect, useState } from 'react';
import { Alert, Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { logVoiceTransaction, type VoiceResult } from '@/ai/parseVoice';
import { hasGeminiApiKey } from '@/ai/secureConfig';
import { TransactionRow } from '@/components/TransactionRow';
import {
  listPendingTransactionItems,
  setTransactionStatus,
  type TransactionListItem,
} from '@/db/queries/transactions';
import { usePendingCount } from '@/state/PendingCount';
import { useTheme } from '@/theme/ThemeContext';
import { fontFamily, layout, minTouchTarget, radius, screenPaddingH, space, type } from '@/theme/tokens';

type Phase = 'idle' | 'recording' | 'processing' | 'success' | 'error';

function formatDuration(ms: number): string {
  const total = Math.floor(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

const BAR_COUNT = 9;

/** Decorative amplitude meter — staggered looping bars while recording.
 *  (There is no on-device transcription; this signals activity, not level.) */
function AmplitudeMeter({ active, color }: { active: boolean; color: string }) {
  // Lazy state init gives stable Animated.Values without touching a ref in
  // render (matches the pulse pattern below).
  const [bars] = useState(() => [...Array(BAR_COUNT)].map(() => new Animated.Value(0.3)));

  useEffect(() => {
    if (!active) {
      bars.forEach((b) => b.setValue(0.3));
      return;
    }
    const loops = bars.map((b, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.timing(b, { toValue: 0.5 + (i % 3) * 0.25, duration: 340 + i * 40, useNativeDriver: true }),
          Animated.timing(b, { toValue: 0.3, duration: 340 + i * 40, useNativeDriver: true }),
        ]),
      ),
    );
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
  }, [active, bars]);

  return (
    <View style={styles.meter}>
      {bars.map((b, i) => (
        <Animated.View
          key={i}
          style={[styles.bar, { backgroundColor: color, transform: [{ scaleY: b }] }]}
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

  const [phase, setPhase] = useState<Phase>('idle');
  const [message, setMessage] = useState('Tap to speak');
  const [result, setResult] = useState<VoiceResult | null>(null);
  const [loggedItem, setLoggedItem] = useState<TransactionListItem | null>(null);
  const [retryUri, setRetryUri] = useState<string | null>(null);

  const [pulse] = useState(() => new Animated.Value(1));
  useEffect(() => {
    if (phase !== 'recording') {
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

  const process = async (uri: string) => {
    setPhase('processing');
    setMessage('Understanding…');
    try {
      const parsed = await logVoiceTransaction(uri);
      const items = await listPendingTransactionItems();
      setLoggedItem(items.find((i) => i.tx.id === parsed.id) ?? null);
      setRetryUri(null);
      refresh();
      setResult(parsed);
      setPhase('success');
    } catch (e) {
      setRetryUri(uri); // keep the recording for retry — never lose it
      setMessage(e instanceof Error ? e.message : String(e));
      setPhase('error');
    }
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
    await process(uri);
  };

  const retry = () => {
    if (retryUri) void process(retryUri);
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
  const onCaptureMuted = isDark ? colors.textMuted : colors.onPrimary;
  const ringColor = isDark ? `${colors.primary}33` : `${colors.onPrimary}22`;
  const buttonBg = isDark ? colors.primary : colors.onPrimary;
  const buttonIcon = isDark ? colors.onPrimary : colors.primary;

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

      <View style={styles.center}>
        {phase === 'error' ? (
          <>
            <Text style={[type.body, styles.centerText, { color: onCapture }]}>{message}</Text>
            {retryUri ? (
              <Pressable accessibilityRole="button" onPress={retry} style={styles.retry}>
                <Text style={[type.label, { color: isDark ? colors.primary : colors.canopyAccent }]}>
                  Retry parsing
                </Text>
              </Pressable>
            ) : null}
          </>
        ) : (
          <>
            <Text style={[type.sectionLabel, { color: colors.canopyAccent }]}>
              {busy ? 'Understanding' : recording ? 'Listening' : 'Ready'}
            </Text>
            {recording ? <AmplitudeMeter active color={onCapture} /> : null}
            <Text style={[styles.hint, styles.centerText, { color: onCapture }]}>
              {busy ? 'Understanding…' : recording ? 'Speak your transaction' : 'Tap the mic and say it'}
            </Text>
            {recording ? (
              <Text style={[styles.timer, { color: onCaptureMuted }]}>
                {formatDuration(recorderState.durationMillis)}
              </Text>
            ) : null}
          </>
        )}
      </View>

      <View style={styles.buttonArea}>
        <View style={styles.buttonWrap}>
          <Animated.View
            style={[styles.ring, { backgroundColor: ringColor, transform: [{ scale: pulse }] }, !recording && styles.hidden]}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={recording ? 'Stop recording' : 'Start recording'}
            disabled={busy}
            onPress={onPressButton}
            style={[styles.recordButton, { backgroundColor: buttonBg }]}>
            <Feather name={recording ? 'square' : busy ? 'loader' : 'mic'} size={30} color={buttonIcon} />
          </Pressable>
        </View>
        <Text style={[type.caption, styles.centerText, { color: onCaptureMuted }]}>
          {recording ? 'Tap to stop · it lands in your queue' : busy ? 'Almost there…' : 'One tap, one sentence'}
        </Text>
      </View>
    </SafeAreaView>
  );
}

const RING = 96;
const BUTTON = 74;

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
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.xxl,
    gap: space.xl,
  },
  meter: { height: 66, flexDirection: 'row', alignItems: 'center', gap: space.xs + 1 },
  bar: { width: 5, height: 56, borderRadius: radius.pill },
  hint: { fontFamily: fontFamily.heading, fontSize: 22, lineHeight: 30 },
  timer: { ...type.amount, fontSize: 15 },
  buttonArea: { alignItems: 'center', gap: space.lg, paddingBottom: space.xxl + space.md },
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
  retry: { minHeight: minTouchTarget, justifyContent: 'center' },
  centerText: { textAlign: 'center' },

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
