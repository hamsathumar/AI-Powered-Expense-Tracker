/**
 * Voice capture (spec §8.3, design §5.5) — the app's signature interaction.
 * One tap records; stopping sends the audio to Gemini, validates the result,
 * and drops a pending transaction into the queue. Speed is the point: no
 * confirmation dialog, and a failure keeps the recording so nothing spoken
 * is lost (technical-plan §5.7).
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
import { usePendingCount } from '@/state/PendingCount';
import { useTheme } from '@/theme/ThemeContext';
import { minTouchTarget, radius, screenPaddingH, space, type } from '@/theme/tokens';

type Phase = 'idle' | 'recording' | 'processing' | 'success' | 'error';

function formatDuration(ms: number): string {
  const total = Math.floor(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

export default function VoiceScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const { refresh } = usePendingCount();

  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(recorder);

  const [phase, setPhase] = useState<Phase>('idle');
  const [message, setMessage] = useState('Tap to record');
  const [result, setResult] = useState<VoiceResult | null>(null);
  // Kept in state (not a ref) so the Retry button reactively appears; a failed
  // parse holds the recording so nothing spoken is lost (technical-plan §5.7).
  const [retryUri, setRetryUri] = useState<string | null>(null);

  // Lazy state init gives a single stable Animated.Value without a ref.
  const [pulse] = useState(() => new Animated.Value(1));
  useEffect(() => {
    if (phase !== 'recording') {
      pulse.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.25, duration: 600, useNativeDriver: true }),
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
      setPhase('recording');
      setMessage('Listening… tap to stop');
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

  const onPressButton = () => {
    if (phase === 'recording') void stopRecording();
    else if (phase === 'idle' || phase === 'success' || phase === 'error') void startRecording();
  };

  const recording = phase === 'recording';
  const busy = phase === 'processing';

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.bg }]}>
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close"
          onPress={() => router.back()}
          style={styles.close}>
          <Feather name="x" size={24} color={colors.textMuted} />
        </Pressable>
      </View>

      <View style={styles.center}>
        {recording ? (
          <Text style={[type.display, { color: colors.text }]}>
            {formatDuration(recorderState.durationMillis)}
          </Text>
        ) : null}

        <View style={styles.buttonWrap}>
          <Animated.View
            style={[
              styles.pulseRing,
              { backgroundColor: colors.primarySoft, transform: [{ scale: pulse }] },
              !recording && styles.hidden,
            ]}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={recording ? 'Stop recording' : 'Start recording'}
            disabled={busy}
            onPress={onPressButton}
            style={({ pressed }) => [
              styles.recordButton,
              { backgroundColor: pressed ? colors.primaryPress : colors.primary },
            ]}>
            <Feather
              name={recording ? 'square' : busy ? 'loader' : 'mic'}
              size={44}
              color={colors.onPrimary}
            />
          </Pressable>
        </View>

        {phase === 'success' && result ? (
          <View style={styles.result}>
            <Text style={[type.h2, styles.centerText, { color: colors.text }]}>
              Logged “{result.name}” — sent to Queue
            </Text>
            {result.flags.length > 0 ? (
              <View style={styles.flagRow}>
                {result.flags.map((flag) => (
                  <View key={flag} style={[styles.flagPill, { backgroundColor: colors.warning }]}>
                    <Text style={[type.caption, { color: colors.onPrimary }]}>
                      {flag.replaceAll('_', ' ')}
                    </Text>
                  </View>
                ))}
              </View>
            ) : null}
            <Text style={[type.caption, styles.centerText, { color: colors.textMuted }]}>
              Review and approve it in the Queue. Tap the mic to add another.
            </Text>
          </View>
        ) : phase === 'error' ? (
          <View style={styles.result}>
            <Text style={[type.body, styles.centerText, { color: colors.danger }]}>{message}</Text>
            {retryUri ? (
              <Pressable accessibilityRole="button" onPress={retry} style={styles.retry}>
                <Text style={[type.label, { color: colors.primary }]}>Retry parsing</Text>
              </Pressable>
            ) : null}
          </View>
        ) : (
          <Text style={[type.body, styles.centerText, { color: colors.textMuted }]}>{message}</Text>
        )}
      </View>
    </SafeAreaView>
  );
}

const RING = 180;
const BUTTON = 140;

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  header: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: screenPaddingH,
    paddingVertical: space.md,
  },
  close: {
    minWidth: minTouchTarget,
    minHeight: minTouchTarget,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: screenPaddingH,
    gap: space.xl,
  },
  buttonWrap: {
    width: RING,
    height: RING,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pulseRing: {
    position: 'absolute',
    width: RING,
    height: RING,
    borderRadius: RING / 2,
  },
  hidden: { opacity: 0 },
  recordButton: {
    width: BUTTON,
    height: BUTTON,
    borderRadius: BUTTON / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  result: { alignItems: 'center', gap: space.md },
  centerText: { textAlign: 'center' },
  flagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.xs,
    justifyContent: 'center',
  },
  flagPill: {
    borderRadius: radius.pill,
    paddingHorizontal: space.sm,
    paddingVertical: 2,
  },
  retry: {
    minHeight: minTouchTarget,
    justifyContent: 'center',
  },
});
