/**
 * App-level host for the durable voice-parse queue (TC-027).
 *
 * Mounted once at the root, above the router, so interpretation is no longer
 * tied to the voice screen's lifetime:
 *  - drains the queue on launch (picking up anything the app was killed during),
 *  - drains it again every time Kaasu returns to the foreground,
 *  - marks in-flight work as interrupted the moment iOS suspends us, so the
 *    runner retries it for free instead of blaming the recording,
 *  - keeps the Queue tab badge honest by refreshing the pending count whenever
 *    a job lands.
 *
 * React Native note: `AppState` is the platform's app-lifecycle stream — the
 * mobile analogue of the browser's `visibilitychange`. 'background' means iOS
 * is about to stop running our JavaScript; 'active' means it has resumed.
 */
import { createContext, useCallback, useContext, useEffect, useState, type PropsWithChildren } from 'react';
import { AppState } from 'react-native';

import { noteAppSuspended, pumpVoiceJobs, subscribeVoiceJobs } from '@/ai/voiceJobRunner';
import { enqueueVoiceJob, getVoiceJob, type VoiceJob } from '@/db/queries/voiceJobs';
import { usePendingCount } from '@/state/PendingCount';

interface VoiceJobsState {
  /** Enqueue a capture and start draining. Returns the job id to watch. */
  submit: (input: { audioUri: string; audioMime: string; transcript: string }) => Promise<string>;
  /** Nudge the queue (e.g. after a manual retry). */
  pump: () => void;
  /** Increments whenever any job changes — a cheap subscription signal. */
  revision: number;
}

const VoiceJobsContext = createContext<VoiceJobsState>({
  submit: async () => '',
  pump: () => {},
  revision: 0,
});

export function VoiceJobsProvider({ children }: PropsWithChildren) {
  const { refresh } = usePendingCount();
  const [revision, setRevision] = useState(0);

  // Any job change may have created pending operations — keep the badge live.
  useEffect(() => {
    const unsubscribe = subscribeVoiceJobs(() => {
      setRevision((r) => r + 1);
      refresh();
    });
    return unsubscribe;
  }, [refresh]);

  // Drain on launch, and on every return to the foreground.
  useEffect(() => {
    void pumpVoiceJobs();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void pumpVoiceJobs();
      } else {
        // Tell the runner iOS is taking the app away, so a request that dies
        // now is retried rather than counted as a failure.
        noteAppSuspended();
      }
    });
    return () => sub.remove();
  }, []);

  const submit = useCallback(
    async (input: { audioUri: string; audioMime: string; transcript: string }) => {
      const id = await enqueueVoiceJob(input);
      setRevision((r) => r + 1);
      void pumpVoiceJobs();
      return id;
    },
    [],
  );

  const pump = useCallback(() => {
    void pumpVoiceJobs();
  }, []);

  return (
    <VoiceJobsContext.Provider value={{ submit, pump, revision }}>{children}</VoiceJobsContext.Provider>
  );
}

export function useVoiceJobs(): VoiceJobsState {
  return useContext(VoiceJobsContext);
}

/**
 * Watch one job. The voice screen uses this to show the result inline while it
 * is still open — but the job completes with or without this hook mounted.
 */
export function useVoiceJob(jobId: string | null): VoiceJob | null {
  const { revision } = useVoiceJobs();
  const [job, setJob] = useState<VoiceJob | null>(null);

  useEffect(() => {
    if (!jobId) return; // nothing to fetch; the guard below handles the render
    let cancelled = false;
    getVoiceJob(jobId)
      .then((j) => {
        if (!cancelled) setJob(j);
      })
      .catch(() => {
        if (!cancelled) setJob(null);
      });
    return () => {
      cancelled = true;
    };
  }, [jobId, revision]);

  // Derived, not stored: a cleared jobId reads as "no job" immediately, without
  // an extra render pass to blank the state.
  return job && job.id === jobId ? job : null;
}
