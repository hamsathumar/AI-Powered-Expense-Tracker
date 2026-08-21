/**
 * Voice capture v2 — the app's signature interaction (spec §8.3; design ref:
 * "Voice capture — organic orb flow").
 *
 * TWO consumers, ONE microphone capture (see src/hooks/useVoiceCapture.ts):
 *  - Pipeline B (display): iOS on-device speech streams PARTIAL words + volume
 *    while you speak, so the screen genuinely reacts — live transcript on screen
 *    and an audio-reactive Skia orb (src/components/voice/VoiceOrb.tsx).
 *  - Pipeline A (unchanged interpretation): on stop, the same utterance's
 *    persisted WAV is handed to interpretVoice() → Gemini → validate → resolve →
 *    pending operations. Nothing is committed or auto-approved here.
 *
 * Phases share one surface and crossfade — never a hard cut:
 *   ready → listening → processing → success (per-transaction confirm cards) .
 * The processing wait shows warm, cycling micro-copy tied to real latency (it
 * loops until Gemini actually returns), NOT a scripted timeline. Haptics + short
 * sound cues punctuate start / stop / logged.
 *
 * Backgrounding resilience (v1.1, TC-027): this screen NO LONGER owns the
 * parse. A capture is handed to the durable job queue
 * (src/db/queries/voiceJobs.ts + src/ai/voiceJobRunner.ts), which runs above
 * the router — so the work survives leaving this screen, survives iOS
 * suspending the app, and survives the app being killed outright. The screen
 * simply WATCHES its job and renders the same states as before; if the user
 * walks away, the result lands in the queue and a local notification says so.
 */
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { evaluatePendingByIds, type EvaluatedPending } from '@/ai/commitOperation';
import { hasGeminiApiKey } from '@/ai/secureConfig';
import type { VoiceJob } from '@/db/queries/voiceJobs';
import { ConfirmCard } from '@/components/voice/ConfirmCard';
import { VoiceOrb, type OrbPhase } from '@/components/voice/VoiceOrb';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { useVoiceCapture, type CaptureResult } from '@/hooks/useVoiceCapture';
import { hapticError, hapticStart, hapticStop, hapticSuccess } from '@/lib/haptics';
import { playChime, playStart, playWhoosh, primeSoundSession } from '@/lib/soundFx';
import { ensureNotificationPermission } from '@/lib/notifications';
import { usePendingCount } from '@/state/PendingCount';
import { useVoiceJob, useVoiceJobs } from '@/state/VoiceJobs';
import { useTheme } from '@/theme/ThemeContext';
import { fontFamily, radius, screenPaddingH, space, type } from '@/theme/tokens';

type Phase = 'ready' | 'listening' | 'processing' | 'success' | 'error';

const AUDIO_MIME = 'audio/wav'; // pipeline B persists WAV; Gemini accepts it

/** Warm, conversational lines that rotate while Gemini works. No status jargon,
 *  no timeline — they loop until the real result lands (design: "kill the
 *  literal status labels"). */
const PROCESSING_COPY = [
  'Got it — one sec…',
  'Picking out the details…',
  'Making sense of that…',
  'Almost there…',
];

function formatDuration(ms: number): string {
  const total = Math.floor(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

export default function VoiceScreen() {
  const { colors, isDark } = useTheme();
  const router = useRouter();
  const { refresh } = usePendingCount();
  const reduceMotion = useReducedMotion();

  const [phase, setPhase] = useState<Phase>('ready');
  const [confirmItems, setConfirmItems] = useState<EvaluatedPending[]>([]);
  const [capturedTranscript, setCapturedTranscript] = useState('');
  const [retryUri, setRetryUri] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [elapsedMs, setElapsedMs] = useState(0);
  const [copyIndex, setCopyIndex] = useState(0);
  const listenStartRef = useRef(0);

  // TC-027: the parse belongs to the durable queue, not to this screen. We only
  // hold the id of the job we started, and watch it.
  const { submit } = useVoiceJobs();
  const [jobId, setJobId] = useState<string | null>(null);
  const job = useVoiceJob(jobId);
  const shownJobRef = useRef<string | null>(null);

  useEffect(() => {
    primeSoundSession();
    // Asked once, on the screen that will actually produce notifications.
    void ensureNotificationPermission();
  }, []);

  const mountedRef = useRef(true);
  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    [],
  );

  // ---- Watch the durable job (TC-027) --------------------------------------
  // The runner does the work; the screen only reflects the job's final state.
  // If the user leaves mid-parse the job still finishes and notifies.
  const showOutcome = useCallback(
    async (finished: VoiceJob) => {
      if (finished.status === 'failed') {
        setRetryUri(finished.audioUri); // never lose the recording
        setErrorMsg(finished.error ?? 'That did not go through.');
        setPhase('error');
        hapticError();
        return;
      }
      let items: EvaluatedPending[] = [];
      try {
        items = await evaluatePendingByIds(finished.pendingIds);
      } catch {
        items = [];
      }
      if (!mountedRef.current) return;
      setConfirmItems(items);
      setRetryUri(null);
      setPhase('success');
      playChime();
      hapticSuccess();
      refresh();
    },
    [refresh],
  );

  useEffect(() => {
    if (!job || !mountedRef.current) return;
    // Still in flight — `startJob` already put the screen in 'processing'.
    if (job.status === 'queued' || job.status === 'running') return;
    if (shownJobRef.current === job.id) return; // already rendered this outcome
    shownJobRef.current = job.id;
    void showOutcome(job);
  }, [job, showOutcome]);

  // ---- Capture (pipeline B) ------------------------------------------------
  const startJob = useCallback(
    async (audioUri: string, transcript: string) => {
      setCopyIndex(0);
      setPhase('processing');
      try {
        const id = await submit({ audioUri, audioMime: AUDIO_MIME, transcript });
        if (!mountedRef.current) return;
        shownJobRef.current = null;
        setJobId(id);
      } catch (e) {
        if (!mountedRef.current) return;
        setRetryUri(audioUri);
        setErrorMsg(e instanceof Error ? e.message : String(e));
        setPhase('error');
        hapticError();
      }
    },
    [submit],
  );

  const handleDone = useCallback(
    (res: CaptureResult) => {
      if (!mountedRef.current) return;
      if (res.cancelled) {
        setPhase('ready');
        return;
      }
      if (!res.uri) {
        setErrorMsg('That recording came through empty — give it another go.');
        setPhase('error');
        return;
      }
      setCapturedTranscript(res.transcript);
      void startJob(res.uri, res.transcript);
    },
    [startJob],
  );
  const capture = useVoiceCapture({ onDone: handleDone });
  const { cancel: cancelCapture } = capture; // stable (useCallback) — safe dep

  // Cancel any live recognition if the screen is torn down mid-listen.
  useEffect(() => () => cancelCapture(), [cancelCapture]);

  // ---- Timers / cosmetic cycles --------------------------------------------
  useEffect(() => {
    if (phase !== 'listening') return;
    // start time is stamped in begin(); the interval only reads it (no setState
    // in the effect body — that would cascade renders).
    const id = setInterval(() => setElapsedMs(Date.now() - listenStartRef.current), 250);
    return () => clearInterval(id);
  }, [phase]);

  useEffect(() => {
    if (phase !== 'processing') return;
    const id = setInterval(() => setCopyIndex((i) => (i + 1) % PROCESSING_COPY.length), 2500);
    return () => clearInterval(id);
  }, [phase]);

  // ---- Controls ------------------------------------------------------------
  const begin = async () => {
    if (!(await hasGeminiApiKey())) {
      Alert.alert('No API key', 'Add your Gemini API key in Settings to log by voice.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Open Settings', onPress: () => router.push('/settings') },
      ]);
      return;
    }
    const outcome = await capture.start();
    if (!outcome.ok) {
      if (outcome.reason === 'permission') {
        Alert.alert(
          'Microphone & speech needed',
          'Enable Microphone and Speech Recognition for Kaasu in iOS Settings to log by voice.',
        );
      } else {
        setErrorMsg(outcome.message);
        setPhase('error');
      }
      return;
    }
    hapticStart();
    playStart();
    setJobId(null);
    shownJobRef.current = null;
    setConfirmItems([]);
    setCapturedTranscript('');
    listenStartRef.current = Date.now();
    setElapsedMs(0);
    setPhase('listening');
  };

  const done = () => {
    hapticStop();
    playWhoosh();
    setCopyIndex(0);
    setPhase('processing'); // cool the orb immediately; process() runs on onDone
    capture.stop();
  };

  const cancel = () => {
    capture.cancel();
    setPhase('ready');
  };

  const retry = () => {
    // Re-queue the SAME recording as a fresh job — the audio is still on disk.
    if (retryUri) void startJob(retryUri, capturedTranscript);
  };

  const sayAnother = () => {
    setJobId(null);
    shownJobRef.current = null;
    setConfirmItems([]);
    setCapturedTranscript('');
    setPhase('ready');
  };

  const openReview = (item: EvaluatedPending) =>
    router.push({ pathname: '/review/[id]', params: { id: item.id } });
  const openEditor = (item: EvaluatedPending) => {
    if (item.op.kind === 'bill_split') {
      router.push({ pathname: '/bill-split', params: { fromPending: item.id } });
    } else if (item.op.kind === 'recurring') {
      router.push({ pathname: '/recurring/new', params: { fromPending: item.id } });
    }
  };

  // ---- Success — per-transaction confirm cards (design: logged state) ------
  if (phase === 'success' && job) {
    const shownTranscript = job.resultTranscript || job.transcript;
    const total = confirmItems.length;
    const nothing = total === 0;
    const heading = nothing ? 'Nothing logged' : total > 1 ? `${total} logged` : 'Logged';

    return (
      <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.bg }]}>
        <View style={styles.successHeader}>
          <View style={[styles.check, { backgroundColor: nothing ? `${colors.textMuted}1F` : `${colors.income}1F` }]}>
            <Feather
              name={nothing ? 'help-circle' : 'check'}
              size={24}
              color={nothing ? colors.textMuted : colors.income}
            />
          </View>
          <View style={styles.successHeadingWrap}>
            <Text style={[type.h1, { color: colors.text }]}>{heading}</Text>
            {shownTranscript ? (
              <Text numberOfLines={2} style={[type.body, { color: colors.textSubtle, fontStyle: 'italic' }]}>
                “{shownTranscript}”
              </Text>
            ) : null}
          </View>
        </View>

        <ScrollView
          contentContainerStyle={styles.successScroll}
          showsVerticalScrollIndicator={false}>
          {nothing ? (
            <Text style={[type.body, { color: colors.textMuted }]}>
              No transaction amount was detected, so nothing was recorded. Kaasu never invents an
              amount — try again with the number included.
            </Text>
          ) : (
            confirmItems.map((item, i) => (
              <ConfirmCard
                key={item.id}
                item={item}
                baseDelay={i * 140}
                reduceMotion={reduceMotion}
                onApproved={refresh}
                onOpenReview={openReview}
                onOpenEditor={openEditor}
              />
            ))
          )}

          {job.unqualifiedCount > 0 ? (
            <View style={[styles.hintPill, { borderColor: colors.warning }]}>
              <Feather name="alert-circle" size={13} color={isDark ? colors.warning : colors.lending} />
              <Text style={[type.caption, { color: isDark ? colors.warning : colors.lending }]}>
                {job.unqualifiedCount} heard without an amount — not logged
              </Text>
            </View>
          ) : null}
        </ScrollView>

        <View style={styles.successFooter}>
          {!nothing ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => router.back()}
              style={[styles.footerBtn, { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: StyleSheet.hairlineWidth }]}>
              <Feather name="inbox" size={16} color={colors.text} />
              <Text style={[styles.footerLabel, { color: colors.text }]}>Review all in queue</Text>
            </Pressable>
          ) : null}
          <View style={styles.footerRow}>
            <Pressable
              accessibilityRole="button"
              onPress={sayAnother}
              style={[styles.footerBtn, styles.footerFlex, { backgroundColor: colors.surfaceAlt }]}>
              <Feather name="mic" size={16} color={colors.primary} />
              <Text style={[styles.footerLabel, { color: colors.primary }]}>Say another</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => router.back()}
              style={[styles.footerBtn, styles.footerFlex, { backgroundColor: colors.primary }]}>
              <Text style={[styles.footerLabel, { color: colors.onPrimary }]}>Done</Text>
            </Pressable>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  // ---- Capture surface (ready / listening / processing / error) ------------
  const captureBg = isDark ? colors.surface : colors.primary;
  const onCapture = isDark ? colors.text : colors.onPrimary;
  const onCaptureMuted = isDark ? colors.textMuted : `${colors.onPrimary}B3`;
  const buttonBg = isDark ? colors.primary : colors.onPrimary;
  const buttonIcon = isDark ? colors.onPrimary : colors.primary;
  const gold = colors.canopyAccent;

  const listening = phase === 'listening';
  const processing = phase === 'processing';
  const isError = phase === 'error';

  const orbPhase: OrbPhase = listening ? 'listening' : processing ? 'processing' : 'ready';
  const eyebrow = listening ? 'Listening' : 'Ready';
  const heading = listening ? 'I’m listening…' : 'What did you\nspend on?';
  const subtitle = listening
    ? 'Tap the orb when you’re done.'
    : 'Tap the orb and just say it — amount, place, the rest is on me.';

  const onOrbPress = () => {
    if (phase === 'ready') void begin();
    else if (listening) done();
  };

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: captureBg }]}>
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close"
          onPress={() => (listening ? cancel() : router.back())}
          style={[styles.close, { backgroundColor: isDark ? colors.surfaceAlt : colors.primaryPress }]}>
          <Feather name="x" size={20} color={onCapture} />
        </Pressable>
      </View>

      {isError ? (
        <View style={styles.failCenter}>
          <View style={[styles.failRing, { borderColor: `${onCapture}59` }]}>
            <Feather name="alert-triangle" size={30} color={gold} />
          </View>
          <Text style={[type.sectionLabel, { color: gold }]}>Couldn’t log that</Text>
          <Text style={[styles.failHint, styles.centerText, { color: onCapture }]}>{errorMsg}</Text>
          <Text style={[type.body, styles.centerText, { color: onCaptureMuted }]}>
            {retryUri
              ? 'Your recording is safe — try again without repeating yourself.'
              : 'Nothing was saved. Give it another go.'}
          </Text>
          <View style={styles.failActions}>
            <Pressable
              accessibilityRole="button"
              onPress={retryUri ? retry : begin}
              style={[styles.failPrimary, { backgroundColor: buttonBg }]}>
              <Feather name={retryUri ? 'refresh-cw' : 'mic'} size={16} color={buttonIcon} />
              <Text style={[styles.footerLabel, { color: buttonIcon }]}>
                {retryUri ? 'Retry parsing' : 'Record again'}
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => router.back()}
              style={[styles.failSecondary, { borderColor: `${onCapture}40` }]}>
              <Text style={[styles.footerLabel, { color: onCapture }]}>Close</Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <>
          <View style={styles.instrument}>
            {!processing ? (
              <Text style={[type.sectionLabel, { color: gold }]}>{eyebrow}</Text>
            ) : (
              <View style={styles.eyebrowSpacer} />
            )}

            <Pressable
              accessibilityRole="button"
              accessibilityLabel={listening ? 'Stop recording' : 'Start recording'}
              disabled={processing}
              onPress={onOrbPress}>
              <VoiceOrb phase={orbPhase} volume={capture.volume} size={240} reduceMotion={reduceMotion} />
            </Pressable>

            {listening ? (
              <Text style={[styles.timer, { color: onCaptureMuted }]}>{formatDuration(elapsedMs)}</Text>
            ) : (
              <View style={styles.timerSpacer} />
            )}
          </View>

          <View style={styles.prompt}>
            {/* Live transcript — the trust builder. Bright while listening; a
                dimmed strip while processing so the copy owns the space. */}
            {listening && capture.transcript ? (
              <Animated.Text
                entering={reduceMotion ? undefined : FadeIn.duration(200)}
                style={[styles.transcript, styles.centerText, { color: onCapture }]}>
                {capture.transcript}
              </Animated.Text>
            ) : null}

            {processing ? (
              <>
                {capturedTranscript ? (
                  <Text
                    numberOfLines={2}
                    style={[styles.transcriptDim, styles.centerText, { color: onCapture }]}>
                    “{capturedTranscript}”
                  </Text>
                ) : null}
                <Animated.Text
                  key={copyIndex}
                  entering={reduceMotion ? undefined : FadeInDown.duration(450)}
                  style={[styles.heading, styles.centerText, { color: onCapture }]}>
                  {PROCESSING_COPY[copyIndex]}
                </Animated.Text>
              </>
            ) : (
              <>
                <Text style={[styles.heading, styles.centerText, { color: onCapture }]}>{heading}</Text>
                <Text style={[styles.subtitle, styles.centerText, { color: onCaptureMuted }]}>
                  {subtitle}
                </Text>
              </>
            )}
          </View>

          <View style={styles.footArea}>
            {listening ? (
              <Pressable accessibilityRole="button" onPress={cancel} hitSlop={space.md}>
                <Text style={[type.label, { color: onCaptureMuted }]}>Cancel</Text>
              </Pressable>
            ) : (
              <Text style={[type.label, styles.centerText, { color: onCaptureMuted }]}>
                {processing ? 'Working on it…' : 'Tap to speak'}
              </Text>
            )}
          </View>
        </>
      )}
    </SafeAreaView>
  );
}

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

  // Capture layout
  instrument: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: space.md,
  },
  eyebrowSpacer: { height: 18 },
  timerSpacer: { height: 22 },
  timer: { ...type.amount, fontSize: 16, height: 22 },
  prompt: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: space.md,
    paddingHorizontal: space.xl,
    paddingTop: space.lg,
  },
  heading: { fontFamily: fontFamily.headingBold, fontSize: 30, lineHeight: 36 },
  subtitle: { ...type.body, fontSize: 16, lineHeight: 24, maxWidth: 320 },
  transcript: { fontFamily: fontFamily.heading, fontSize: 22, lineHeight: 30, maxWidth: 340 },
  transcriptDim: { fontFamily: fontFamily.body, fontSize: 15, lineHeight: 22, opacity: 0.28 },
  centerText: { textAlign: 'center' },

  footArea: { alignItems: 'center', paddingBottom: space.xxl + space.md, minHeight: 40, justifyContent: 'center' },

  // Failure
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
  failHint: { fontFamily: fontFamily.heading, fontSize: 22, lineHeight: 30 },
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

  // Success
  successHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: screenPaddingH,
    paddingTop: space.sm,
    paddingBottom: space.md,
  },
  check: {
    width: 48,
    height: 48,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  successHeadingWrap: { flex: 1, gap: 2 },
  successScroll: { paddingHorizontal: screenPaddingH, paddingBottom: space.xl, gap: space.md },
  hintPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    alignSelf: 'flex-start',
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: space.sm + 2,
    paddingVertical: 4,
  },
  successFooter: {
    paddingHorizontal: screenPaddingH,
    paddingTop: space.sm,
    paddingBottom: space.lg,
    gap: space.sm,
  },
  footerRow: { flexDirection: 'row', gap: space.sm },
  footerFlex: { flex: 1 },
  footerBtn: {
    minHeight: 50,
    borderRadius: radius.pill,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    paddingHorizontal: space.md,
  },
  footerLabel: { fontFamily: fontFamily.heading, fontSize: 15 },
});
