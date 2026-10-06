/**
 * How the four lending directions LOOK — the one shared mapping behind every
 * row, card, amount and header that shows a lend / borrow / repayment, so no
 * screen can drift from another.
 *
 * Two tones keep the two relationships apart: `lent` (money owed TO the user)
 * and `borrowed` (money the user owes). A repayment keeps its parent's tone —
 * it is the same relationship — and is told apart by icon, label and sign.
 *
 * SIGN reads as the effect on what the person owes you (the same convention
 * as `personNetBalanceMinor`): + raises "they owe you" / lowers "you owe
 * them", − does the opposite. It is NOT the cash movement in an account.
 *
 * Pure: colour is a theme-token key, icon a Feather glyph name, so this file
 * has no React Native dependency and runs under jest.
 */
import type { LendingDirection } from '@/domain/types';

export type LendingTone = 'lent' | 'borrowed';
export type LendingIconName =
  | 'arrow-up-right'
  | 'corner-down-left'
  | 'arrow-down-left'
  | 'corner-up-right';

export interface LendingPresentation {
  tone: LendingTone;
  icon: LendingIconName;
  sign: '+' | '−';
  isRepayment: boolean;
  /** Sentence for a row subtitle: "Lent to Kamal". */
  label: (name: string) => string;
  /** Name-free form for chips and headings: "Lent out". */
  kind: string;
}

const PRESENTATION: Record<LendingDirection, LendingPresentation> = {
  lend: {
    tone: 'lent',
    icon: 'arrow-up-right',
    sign: '+',
    isRepayment: false,
    label: (n) => `Lent to ${n}`,
    kind: 'Lent out',
  },
  lend_repayment_received: {
    tone: 'lent',
    icon: 'corner-down-left',
    sign: '−',
    isRepayment: true,
    label: (n) => `${n} repaid you`,
    kind: 'Repaid to you',
  },
  borrow: {
    tone: 'borrowed',
    icon: 'arrow-down-left',
    sign: '−',
    isRepayment: false,
    label: (n) => `Borrowed from ${n}`,
    kind: 'Borrowed',
  },
  borrow_repayment_made: {
    tone: 'borrowed',
    icon: 'corner-up-right',
    sign: '+',
    isRepayment: true,
    label: (n) => `Repaid ${n}`,
    kind: 'Repaid by you',
  },
};

export function lendingPresentation(direction: LendingDirection): LendingPresentation {
  return PRESENTATION[direction];
}

/** Tone of a person's net balance: positive → they owe you, negative → you owe them. */
export function netTone(netMinor: number): LendingTone | null {
  if (netMinor > 0) return 'lent';
  if (netMinor < 0) return 'borrowed';
  return null;
}

/**
 * Worded net balance — "Owes you Rs500", "You owe Rs500", "Settled up". Words,
 * never sign alone. `format` turns a POSITIVE minor amount into text (it is
 * `formatAmount` in the app, with the PDF passing its own symbol).
 */
export function describeNetWith(netMinor: number, format: (minor: number) => string): string {
  if (netMinor > 0) return `Owes you ${format(netMinor)}`;
  if (netMinor < 0) return `You owe ${format(-netMinor)}`;
  return 'Settled up';
}
