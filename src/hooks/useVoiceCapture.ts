/**
 * Pipeline B — live on-device speech capture (expo-speech-recognition).
 *
 * ONE microphone capture feeds both consumers of the voice flow, so there is no
 * iOS dual-audio-session contention:
 *
 *  - Pipeline B (this hook): iOS SFSpeechRecognizer streams PARTIAL transcripts
 *    and volume levels *while the user speaks* — purely to make the capture
 *    screen feel alive (live words on screen + an audio-reactive orb). This is
 *    display-only; it never touches the ledger or the interpretation.
 *  - Pipeline A (unchanged): when capture ends, the module hands back the
 *    PERSISTED WAV of the exact same utterance. The screen feeds that file to
 *    `interpretVoice()` → Gemini. The whole interpretation pipeline is
 *    untouched; only the capture *source* is unified (WAV instead of the old
 *    expo-audio mp4).
 *
 * On-device recognition (`requiresOnDeviceRecognition`) keeps the transcript
 * private and free. If the user denies Microphone/Speech permission the hook
 * reports it so the screen can guide them to Settings — nothing is captured.
 *
 * React Native note: `useSpeechRecognitionEvent` subscribes to native events
 * (start / result / volumechange / audioend / end / error) emitted by the
 * speech module for the lifetime of the component — the RN analogue of adding
 * DOM event listeners, but managed for us so they unsubscribe on unmount.
 */
import { useCallback, useRef, useState } from 'react';

import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from 'expo-speech-recognition';

export type StartOutcome =
  | { ok: true }
  | { ok: false; reason: 'permission' | 'unavailable'; message: string };

export interface CaptureResult {
  /** Persisted WAV of the whole utterance (fed to Gemini), or null if none. */
  uri: string | null;
  /** Best transcript the recognizer heard (may be empty). Display only. */
  transcript: string;
  /** True when the user cancelled — the screen discards without parsing. */
  cancelled: boolean;
}

interface Options {
  /** Fires once when a capture session fully ends (natural stop or cancel). */
  onDone: (result: CaptureResult) => void;
  /** BCP-47 recognition locale. */
  lang?: string;
}

/** Map the module's -2..10 volume float onto a 0..1 amplitude for the orb. */
function normalizeVolume(value: number): number {
  return Math.max(0, Math.min(1, value / 8));
}

export function useVoiceCapture({ onDone, lang = 'en-US' }: Options) {
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [volume, setVolume] = useState(0);

  // Session accumulators live in refs so the native event callbacks always read
  // live values without re-subscribing, and so the terminal `end` event can
  // assemble the final result from whatever arrived (order isn't guaranteed).
  const uriRef = useRef<string | null>(null);
  const transcriptRef = useRef('');
  const cancelledRef = useRef(false);
  const activeRef = useRef(false); // a session we started is still running

  useSpeechRecognitionEvent('start', () => setIsListening(true));

  // The persisted-file URI can arrive on either audio event; keep the latest.
  useSpeechRecognitionEvent('audiostart', (e) => {
    if (e.uri) uriRef.current = e.uri;
  });
  useSpeechRecognitionEvent('audioend', (e) => {
    if (e.uri) uriRef.current = e.uri;
  });

  useSpeechRecognitionEvent('result', (e) => {
    const text = e.results?.[0]?.transcript ?? '';
    // iOS can emit an empty partial before the first words — don't blank the UI.
    if (text) {
      transcriptRef.current = text;
      setTranscript(text);
    }
  });

  useSpeechRecognitionEvent('volumechange', (e) => {
    setVolume(normalizeVolume(e.value));
  });

  useSpeechRecognitionEvent('error', (e) => {
    // 'aborted' is our own cancel; 'no-speech' is a normal quiet ending. Neither
    // is a hard failure here — the persisted audio (if any) still goes to Gemini.
    if (e.error === 'aborted') cancelledRef.current = true;
  });

  useSpeechRecognitionEvent('end', () => {
    if (!activeRef.current) return; // ignore stray end events
    activeRef.current = false;
    setIsListening(false);
    setVolume(0);
    onDone({
      uri: uriRef.current,
      transcript: transcriptRef.current.trim(),
      cancelled: cancelledRef.current,
    });
  });

  const start = useCallback(async (): Promise<StartOutcome> => {
    const perm = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    if (!perm.granted) {
      return {
        ok: false,
        reason: 'permission',
        message: 'Kaasu needs microphone and speech access to log by voice.',
      };
    }
    // Reset for a fresh session.
    uriRef.current = null;
    transcriptRef.current = '';
    cancelledRef.current = false;
    setTranscript('');
    setVolume(0);
    try {
      activeRef.current = true;
      ExpoSpeechRecognitionModule.start({
        lang,
        interimResults: true, // stream partial words as the user speaks
        continuous: true, // run until WE stop — tolerate mid-sentence pauses
        requiresOnDeviceRecognition: true, // private + offline; no network cost
        addsPunctuation: true,
        volumeChangeEventOptions: { enabled: true, intervalMillis: 100 },
        // Persist the same audio so pipeline A can send it to Gemini unchanged.
        // 16 kHz mono keeps the WAV (and its base64 upload) small.
        recordingOptions: { persist: true, outputSampleRate: 16000 },
      });
      return { ok: true };
    } catch (e) {
      activeRef.current = false;
      return {
        ok: false,
        reason: 'unavailable',
        message: e instanceof Error ? e.message : String(e),
      };
    }
  }, [lang]);

  /** Stop and finalize — yields the persisted audio + final transcript via onDone. */
  const stop = useCallback(() => {
    ExpoSpeechRecognitionModule.stop();
  }, []);

  /** Abort immediately and discard — onDone fires with cancelled: true. */
  const cancel = useCallback(() => {
    cancelledRef.current = true;
    ExpoSpeechRecognitionModule.abort();
  }, []);

  return { isListening, transcript, volume, start, stop, cancel };
}
