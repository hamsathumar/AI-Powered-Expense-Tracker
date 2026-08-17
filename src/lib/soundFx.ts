/**
 * Voice-flow sound cues (design ref: "small sensory details that sell it").
 *
 *   start  → soft rising ping as recording begins
 *   whoosh → airy swish the moment capture stops
 *   chime  → two-note confirmation when a transaction is logged
 *
 * Players are created once and cached, then rewound + replayed on demand
 * (cheaper than recreating a player per cue). Everything is best-effort and
 * wrapped in try/catch: while pipeline B holds the record audio session these
 * may be quiet, and that's acceptable — haptics carry the same beat. Sounds are
 * kept short and subtle per the design system's restrained motion/feel.
 */
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';

const SOURCES = {
  start: require('../../assets/sfx/start.m4a'),
  whoosh: require('../../assets/sfx/whoosh.m4a'),
  chime: require('../../assets/sfx/chime.m4a'),
} as const;

type Cue = keyof typeof SOURCES;

const players: Partial<Record<Cue, AudioPlayer>> = {};

function get(cue: Cue): AudioPlayer | null {
  try {
    if (!players[cue]) players[cue] = createAudioPlayer(SOURCES[cue]);
    return players[cue] ?? null;
  } catch {
    return null;
  }
}

/** Allow playback even with the ringer switch silenced (like most app SFX). */
export function primeSoundSession(): void {
  setAudioModeAsync({ playsInSilentMode: true }).catch(() => {});
}

export function playCue(cue: Cue): void {
  const p = get(cue);
  if (!p) return;
  try {
    p.seekTo(0);
    p.play();
  } catch {
    // best-effort — never let a missing/blocked cue interrupt the flow
  }
}

export const playStart = () => playCue('start');
export const playWhoosh = () => playCue('whoosh');
export const playChime = () => playCue('chime');
