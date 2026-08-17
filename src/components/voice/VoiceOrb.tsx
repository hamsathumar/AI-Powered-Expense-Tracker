/**
 * VoiceOrb (design ref: "Voice capture — organic orb flow").
 *
 * One Skia canvas that morphs across every phase of the voice flow — no hard
 * cuts. A soft 7-lobe blob is redrawn each frame; its size, wobble, colour and
 * glow ease toward a per-phase target so the shape reads as a single living
 * instrument:
 *   ready       → calm cream blob, gentle breathing
 *   listening   → warm amber, wobble driven by real mic amplitude (elastic)
 *   processing  → cooler, slower, self-animated "thinking" motion
 *   confirmed   → brief warm swell (the chips appear to emanate from it)
 *
 * Why Skia: React Native has no <canvas>, and animating an SVG path's `d`
 * string every frame on the JS thread stutters. Skia draws the path on the UI
 * thread from a Reanimated worklet, so the morph stays at 60fps. The blob path,
 * fill colour and glow are Reanimated derived values recomputed inside worklets
 * (the `'worklet'` directive marks code that runs on the UI thread).
 *
 * Respects Reduce Motion (design-system §7): motion is frozen to a still blob.
 */
import { Feather } from '@expo/vector-icons';
import {
  Blur,
  Canvas,
  Group,
  Path,
  Skia,
  useClock,
} from '@shopify/react-native-skia';
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  interpolateColor,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

export type OrbPhase = 'ready' | 'listening' | 'processing' | 'confirmed';

interface Props {
  phase: OrbPhase;
  /** Live mic amplitude 0..1 (pipeline B volumechange). Only used while listening. */
  volume?: number;
  size?: number;
  reduceMotion?: boolean;
  /** Colour of the mic glyph shown (ready phase only) over the cream orb. */
  iconColor?: string;
}

const LOBES = 7;

/** Per-phase static targets (fractions of `size`, easing constants). */
interface PhaseConfig {
  radius: number; // base blob radius
  amp: number; // idle wobble amplitude
  speed: number; // wobble angular speed
  reactive: number; // how much live volume adds to amplitude
  glow: number; // blur radius for the glow layer
  colorMix: number; // index into COLORS for the fill
}

const CONFIG: Record<OrbPhase, PhaseConfig> = {
  ready: { radius: 0.3, amp: 0.02, speed: 0.9, reactive: 0, glow: 10, colorMix: 0 },
  listening: { radius: 0.31, amp: 0.05, speed: 1.8, reactive: 0.07, glow: 18, colorMix: 1 },
  processing: { radius: 0.29, amp: 0.035, speed: 1.1, reactive: 0, glow: 16, colorMix: 2 },
  confirmed: { radius: 0.33, amp: 0.02, speed: 0.8, reactive: 0, glow: 20, colorMix: 3 },
};

// Fill colours the blob eases between (design hsl values, as hex).
// 0 ready cream · 1 listening amber · 2 processing cool taupe · 3 confirmed gold
const COLORS = ['#F3EFE9', '#F0C270', '#C4936E', '#F0B84E'];

export function VoiceOrb({
  phase,
  volume = 0,
  size = 220,
  reduceMotion = false,
  iconColor = '#6E3A22',
}: Props) {
  const clock = useClock();

  // Eased scalars — every phase change retargets these with a soft timing curve
  // (the "no hard cuts" rule); nothing snaps.
  const radius = useSharedValue(CONFIG.ready.radius * size);
  const amp = useSharedValue(CONFIG.ready.amp * size);
  const speed = useSharedValue(CONFIG.ready.speed);
  const reactive = useSharedValue(0);
  const glow = useSharedValue(CONFIG.ready.glow);
  const colorMix = useSharedValue(0);
  const swell = useSharedValue(1); // burst multiplier on confirm
  const micOpacity = useSharedValue(1); // mic glyph visible only in ready

  // Live amplitude: chase the incoming volume elastically so the orb feels like
  // it has weight (slightly delayed) rather than twitching frame-to-frame.
  const liveAmp = useSharedValue(0);
  useEffect(() => {
    liveAmp.value = withTiming(reduceMotion ? 0 : volume, { duration: 140 });
  }, [volume, reduceMotion, liveAmp]);

  useEffect(() => {
    const c = CONFIG[phase];
    const D = 620;
    radius.value = withTiming(c.radius * size, { duration: D });
    amp.value = withTiming(reduceMotion ? c.amp * size * 0.25 : c.amp * size, { duration: D });
    speed.value = withTiming(reduceMotion ? 0 : c.speed, { duration: D });
    reactive.value = withTiming(c.reactive * size, { duration: D });
    glow.value = withTiming(c.glow, { duration: D });
    colorMix.value = withTiming(c.colorMix, { duration: D });
    // The mic invites a tap in the ready state, then dissolves as we listen.
    micOpacity.value = withTiming(phase === 'ready' ? 1 : 0, { duration: 260 });
    // Confirm burst: a quick swell that settles — chips read as emanating from it.
    if (phase === 'confirmed' && !reduceMotion) {
      swell.value = withTiming(1.14, { duration: 180 }, () => {
        swell.value = withTiming(1, { duration: 420 });
      });
    } else {
      swell.value = withTiming(1, { duration: 300 });
    }
  }, [phase, size, reduceMotion, radius, amp, speed, reactive, glow, colorMix, swell, micOpacity]);

  const micStyle = useAnimatedStyle(() => ({ opacity: micOpacity.value }));

  const cx = size / 2;
  const cy = size / 2;

  const path = useDerivedValue(() => {
    'worklet';
    const t = reduceMotion ? 0 : clock.value / 1000;
    const R = radius.value * swell.value;
    const a = amp.value + liveAmp.value * reactive.value;
    const sp = speed.value;

    // Sample LOBES points around the circle, each pushed in/out by two layered
    // sine waves (organic, non-repeating wobble), then stitch them into a closed
    // curve using quadratic segments through the lobe midpoints for smoothness.
    const px: number[] = [];
    const py: number[] = [];
    for (let i = 0; i < LOBES; i++) {
      const ang = (i / LOBES) * Math.PI * 2;
      const wob = Math.sin(t * sp + i * 1.7) * 0.6 + Math.sin(t * sp * 0.6 + i * 2.3) * 0.4;
      const r = R + a * wob;
      px.push(cx + r * Math.cos(ang));
      py.push(cy + r * Math.sin(ang));
    }

    const p = Skia.Path.Make();
    const mx0 = (px[LOBES - 1] + px[0]) / 2;
    const my0 = (py[LOBES - 1] + py[0]) / 2;
    p.moveTo(mx0, my0);
    for (let i = 0; i < LOBES; i++) {
      const next = (i + 1) % LOBES;
      const mx = (px[i] + px[next]) / 2;
      const my = (py[i] + py[next]) / 2;
      p.quadTo(px[i], py[i], mx, my);
    }
    p.close();
    return p;
  });

  const fill = useDerivedValue(() => {
    'worklet';
    return interpolateColor(colorMix.value, [0, 1, 2, 3], COLORS);
  });

  const blur = useDerivedValue(() => {
    'worklet';
    return glow.value;
  });

  return (
    <View style={{ width: size, height: size }}>
      <Canvas style={{ width: size, height: size }}>
        {/* Soft glow: the same blob, blurred and translucent, behind the solid one. */}
        <Group opacity={0.5}>
          <Path path={path} color={fill}>
            <Blur blur={blur} />
          </Path>
        </Group>
        <Path path={path} color={fill} />
      </Canvas>
      {/* Mic glyph — a plain RN icon overlaid on the Skia canvas (Skia can't draw
          vector icons). Fills the orb and centres the icon; fades in for ready only. */}
      <Animated.View
        style={[StyleSheet.absoluteFill, styles.micWrap, micStyle]}
        pointerEvents="none">
        <Feather name="mic" size={Math.round(size * 0.15)} color={iconColor} />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  micWrap: { alignItems: 'center', justifyContent: 'center' },
});
