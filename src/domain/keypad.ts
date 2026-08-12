/**
 * Amount-keypad calculator model (design-system-v2.md §5.13).
 *
 * The transaction form enters its amount through a custom keypad with quick
 * math (`+ − × =`). This is the pure, tested core: a small left-to-right
 * calculator over MAJOR units, producing an integer MINOR-unit value on save.
 *
 * Money invariant: the stored value is always integer minor units. Operands
 * are typed in major units (max 2 decimals); the final value is rounded to the
 * nearest cent, so decimal-float noise (0.1 + 0.2) can never leak into
 * storage. Nothing here ever holds a float as the source of truth.
 */

export type KeypadOp = '+' | '-' | '*';

/** '=', 'backspace', and 'clear' are actions; the rest are literal characters. */
export type KeypadKey = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '.' | KeypadOp | 'backspace' | 'clear' | 'equals';

const OP_GLYPH: Record<KeypadOp, string> = { '+': '+', '-': '−', '*': '×' };

export interface KeypadState {
  /** Current operand as typed, major units, e.g. "2180" or "21.8". Empty
   *  right after an operator or '='. */
  entry: string;
  /** Accumulated major-unit value from prior operations. */
  acc: number | null;
  /** Pending operator awaiting its right operand. */
  op: KeypadOp | null;
  /** After '=', the next digit starts a fresh entry rather than appending. */
  overwrite: boolean;
}

export function initialKeypadState(): KeypadState {
  return { entry: '', acc: null, op: null, overwrite: false };
}

/** Seed the keypad from a stored minor-unit amount (editing an existing tx). */
export function keypadFromMinor(minor: number): KeypadState {
  const major = Math.abs(minor) / 100;
  // Drop a trailing ".00" so whole amounts read cleanly, keep real cents.
  const entry = Number.isInteger(major) ? String(major) : major.toFixed(2);
  return { entry, acc: null, op: null, overwrite: false };
}

function apply(a: number, op: KeypadOp, b: number): number {
  switch (op) {
    case '+':
      return a + b;
    case '-':
      return a - b;
    case '*':
      return a * b;
  }
}

const MAX_INT_DIGITS = 9; // guardrail against absurd inputs

function pushDigit(entry: string, d: string): string {
  if (entry.includes('.')) {
    const [, cents = ''] = entry.split('.');
    if (cents.length >= 2) return entry; // max 2 decimals
    return entry + d;
  }
  if (entry === '0') return d; // collapse a leading zero
  if (entry.replace('-', '').length >= MAX_INT_DIGITS) return entry;
  return entry + d;
}

/** Apply one key press, returning the next state (pure). */
export function pressKey(state: KeypadState, key: KeypadKey): KeypadState {
  if (key === 'clear') return initialKeypadState();

  if (key === 'backspace') {
    if (state.overwrite) return initialKeypadState();
    if (state.entry !== '') return { ...state, entry: state.entry.slice(0, -1) };
    if (state.op !== null) return { ...state, op: null };
    if (state.acc !== null) return { ...state, acc: null };
    return state;
  }

  if (key === 'equals') {
    if (state.op !== null && state.entry !== '' && state.acc !== null) {
      return { entry: '', acc: apply(state.acc, state.op, parseFloat(state.entry)), op: null, overwrite: true };
    }
    if (state.op !== null && state.entry === '') {
      return { ...state, op: null, overwrite: true }; // drop a dangling operator
    }
    if (state.entry !== '' && state.acc === null) {
      return { entry: '', acc: parseFloat(state.entry), op: null, overwrite: true };
    }
    return state;
  }

  if (key === '+' || key === '-' || key === '*') {
    if (state.entry !== '') {
      const operand = parseFloat(state.entry);
      const acc = state.acc === null ? operand : state.op ? apply(state.acc, state.op, operand) : operand;
      return { entry: '', acc, op: key, overwrite: false };
    }
    if (state.acc !== null) return { ...state, op: key, overwrite: false }; // change operator
    return state; // no first operand yet
  }

  // digit or '.'
  if (key === '.') {
    if (state.overwrite) return { ...state, entry: '0.', overwrite: false };
    if (state.entry === '') return { ...state, entry: '0.' };
    if (state.entry.includes('.')) return state;
    return { ...state, entry: state.entry + '.' };
  }

  // 0-9
  if (state.overwrite) return { ...state, entry: key === '0' ? '0' : key, overwrite: false };
  return { ...state, entry: pushDigit(state.entry, key) };
}

/**
 * The running expression as typed, e.g. "700 +" or "700 + 8", so the user can
 * verify a calculation before it resolves. Empty for a plain single number and
 * once '=' has folded the expression into the amount.
 */
export function expressionString(state: KeypadState): string {
  if (state.op === null || state.acc === null) return '';
  const left = String(Math.round(state.acc * 100) / 100);
  const right = state.entry !== '' ? ` ${state.entry}` : '';
  return `${left} ${OP_GLYPH[state.op]}${right}`;
}

/** The major-unit number currently shown on the display. */
function currentMajor(state: KeypadState): number {
  if (state.entry !== '') {
    const n = parseFloat(state.entry);
    return Number.isFinite(n) ? n : 0;
  }
  return state.acc ?? 0;
}

/** Minor units to render on the amount display (never throws; may be 0). */
export function displayMinor(state: KeypadState): number {
  return Math.round(currentMajor(state) * 100);
}

/**
 * Finalized amount as if '=' were pressed, in integer minor units.
 * Returns null when empty, non-finite, or ≤ 0 — i.e. not a valid amount.
 */
export function resultMinor(state: KeypadState): number | null {
  let value: number | null = null;
  if (state.entry !== '') {
    const operand = parseFloat(state.entry);
    value = state.op !== null && state.acc !== null ? apply(state.acc, state.op, operand) : operand;
  } else if (state.acc !== null) {
    value = state.acc; // trailing operator ignored
  }
  if (value === null || !Number.isFinite(value)) return null;
  const minor = Math.round(value * 100);
  return minor > 0 ? minor : null;
}
