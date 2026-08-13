/**
 * Amount-keypad calculator model (design-system-v2.md §5.13).
 *
 * The transaction form enters its amount through a custom keypad with quick
 * math (`+ − × ÷ =`). This is the pure, tested core: it keeps the raw typed
 * expression as a string (so the panel can show it verbatim, e.g. "200+300×3")
 * and evaluates it left-to-right into an integer MINOR-unit value on save.
 *
 * Money invariant: the stored value is always integer minor units. Operands
 * are typed in major units (max 2 decimals); the final value is rounded to the
 * nearest cent, so decimal-float noise (0.1 + 0.2) can never leak into storage.
 * Evaluation is left-to-right with no operator precedence (calculator style).
 */

export type KeypadOp = '+' | '-' | '*' | '/';

/** '=', 'backspace', and 'clear' (AC) are actions; the rest are characters. */
export type KeypadKey = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '.' | KeypadOp | 'backspace' | 'clear' | 'equals';

export interface KeypadState {
  /** Raw expression as typed, operators as `+ - * /`, e.g. "200+300*3". */
  expr: string;
  /** True right after '=', so the next digit starts a fresh number. */
  justEvaluated: boolean;
}

const OPS = '+-*/';
const isOp = (ch: string): boolean => OPS.includes(ch);

const MAX_INT_DIGITS = 9;

export function initialKeypadState(): KeypadState {
  return { expr: '', justEvaluated: false };
}

/** Seed the keypad from a stored minor-unit amount (editing an existing tx). */
export function keypadFromMinor(minor: number): KeypadState {
  const major = Math.abs(minor) / 100;
  const expr = Number.isInteger(major) ? String(major) : major.toFixed(2);
  return { expr, justEvaluated: false };
}

/** The number segment after the last operator (what's currently being typed). */
function lastSegment(expr: string): string {
  let i = expr.length;
  while (i > 0 && !isOp(expr[i - 1]!)) i--;
  return expr.slice(i);
}

/** Integer minor units → a clean expression operand ("1500" or "33.33"),
 *  built without float so '=' can seed the next calculation exactly. */
function minorToExpr(minor: number): string {
  const major = Math.floor(minor / 100);
  const cents = minor % 100;
  return cents === 0 ? String(major) : `${major}.${String(cents).padStart(2, '0')}`;
}

function applyOp(a: number, op: string, b: number): number {
  switch (op) {
    case '+':
      return a + b;
    case '-':
      return a - b;
    case '*':
      return a * b;
    default:
      return a / b;
  }
}

/**
 * Evaluate the expression left-to-right into integer minor units. A trailing
 * operator is ignored (e.g. "200+" → 200). Returns null when empty or the
 * result is not finite (e.g. divide-by-zero).
 */
function evaluate(expr: string): number | null {
  let e = expr;
  if (e.length > 0 && isOp(e[e.length - 1]!)) e = e.slice(0, -1);
  if (e === '') return null;

  const nums: number[] = [];
  const ops: string[] = [];
  let cur = '';
  for (const ch of e) {
    if (isOp(ch)) {
      if (cur === '') return null;
      nums.push(parseFloat(cur));
      ops.push(ch);
      cur = '';
    } else {
      cur += ch;
    }
  }
  if (cur === '') return null;
  nums.push(parseFloat(cur));

  let acc = nums[0]!;
  for (let i = 0; i < ops.length; i++) acc = applyOp(acc, ops[i]!, nums[i + 1]!);
  if (!Number.isFinite(acc)) return null;
  return Math.round(acc * 100);
}

/** Apply one key press, returning the next state (pure). */
export function pressKey(state: KeypadState, key: KeypadKey): KeypadState {
  if (key === 'clear') return initialKeypadState();

  if (key === 'backspace') {
    if (state.expr === '') return state;
    return { expr: state.expr.slice(0, -1), justEvaluated: false };
  }

  if (key === 'equals') {
    const minor = evaluate(state.expr);
    if (minor === null || minor <= 0) return state;
    return { expr: minorToExpr(minor), justEvaluated: true };
  }

  if (isOp(key)) {
    // Amounts are positive: no leading operator.
    if (state.expr === '') return state;
    let expr = state.expr;
    if (isOp(expr[expr.length - 1]!)) expr = expr.slice(0, -1); // swap a trailing op
    return { expr: expr + key, justEvaluated: false };
  }

  // digit or '.'
  const base = state.justEvaluated ? '' : state.expr;
  const seg = lastSegment(base);

  if (key === '.') {
    if (seg.includes('.')) return { expr: base, justEvaluated: false };
    if (seg === '') return { expr: `${base}0.`, justEvaluated: false };
    return { expr: `${base}.`, justEvaluated: false };
  }

  // 0-9
  if (seg.includes('.')) {
    const cents = seg.split('.')[1] ?? '';
    if (cents.length >= 2) return { expr: base, justEvaluated: false };
  } else if (seg === '0') {
    return { expr: base.slice(0, -1) + key, justEvaluated: false }; // collapse leading zero
  } else if (seg.length >= MAX_INT_DIGITS) {
    return { expr: base, justEvaluated: false };
  }
  return { expr: base + key, justEvaluated: false };
}

/** The raw expression with operators as display glyphs (× ÷ −), for the panel
 *  header. Empty when nothing has been entered. */
export function expressionString(state: KeypadState): string {
  return state.expr.replace(/\*/g, '×').replace(/\//g, '÷').replace(/-/g, '−');
}

/** Minor units to render on the amount display (never throws; 0 when empty). */
export function displayMinor(state: KeypadState): number {
  return evaluate(state.expr) ?? 0;
}

/** Finalized amount in integer minor units, or null when empty / ≤ 0 / not
 *  finite — i.e. not a valid amount to save. */
export function resultMinor(state: KeypadState): number | null {
  const minor = evaluate(state.expr);
  return minor !== null && minor > 0 ? minor : null;
}
