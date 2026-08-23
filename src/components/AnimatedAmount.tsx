/**
 * <Amount> that counts to its new value instead of hard-cutting.
 *
 * Used for the handful of hero figures that change in response to a control —
 * the Reports totals when the period or filter changes, the donut centre, the
 * balance card. NOT for list rows: dozens of counting numbers is exactly the
 * "motion that performs" the design system forbids (§7).
 *
 * The count runs on the JS thread via requestAnimationFrame rather than as a
 * Reanimated worklet. Formatting money needs the locale grouping and currency
 * symbol from `domain/money`, which is not worklet-safe, and re-rendering one
 * or two Text nodes for ~400ms is comfortably cheap. The interpolation itself
 * is pure and tested in `domain/countUp.ts`.
 */
import { useEffect, useRef, useState } from 'react';
import type { TextStyle } from 'react-native';

import { Amount } from '@/components/Amount';
import { countUpValue } from '@/domain/countUp';
import type { TransactionType } from '@/domain/types';
import { useReduceMotion } from '@/theme/FeedbackContext';
import { motion } from '@/theme/tokens';

interface Props {
  valueMinor: number;
  txType?: TransactionType;
  textStyle?: TextStyle;
  colorOverride?: string;
  /** Override the count duration; defaults to the chart/number duration. */
  durationMs?: number;
}

export function AnimatedAmount({ durationMs = motion.chart, ...props }: Props) {
  const reduceMotion = useReduceMotion();
  // Swapping components (rather than branching inside one) keeps the counting
  // hook out of the tree entirely when motion is reduced.
  return reduceMotion ? <Amount {...props} /> : <CountingAmount durationMs={durationMs} {...props} />;
}

function CountingAmount({ valueMinor, durationMs = motion.chart, ...rest }: Props) {
  const [displayMinor, setDisplayMinor] = useState(valueMinor);
  /** What is on screen right now — the next count starts from here. */
  const shownRef = useRef(valueMinor);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    const from = shownRef.current;
    if (from === valueMinor) return;

    const startedAt = Date.now();
    const step = () => {
      const progress = (Date.now() - startedAt) / durationMs;
      const next = progress >= 1 ? valueMinor : countUpValue(from, valueMinor, progress);
      shownRef.current = next;
      setDisplayMinor(next);
      frameRef.current = progress >= 1 ? null : requestAnimationFrame(step);
    };

    frameRef.current = requestAnimationFrame(step);
    return () => {
      if (frameRef.current != null) cancelAnimationFrame(frameRef.current);
    };
  }, [valueMinor, durationMs]);

  return <Amount valueMinor={displayMinor} {...rest} />;
}
