import { describe, expect, it } from '@jest/globals';

import {
  displayMinor,
  expressionString,
  initialKeypadState,
  keypadFromMinor,
  pressKey,
  resultMinor,
  type KeypadKey,
  type KeypadState,
} from '@/domain/keypad';

/** Feed a string of keys: digits/'.' literal; a=×, s=−, p=+, d=÷, e==, b=⌫, c=AC. */
function run(keys: string): KeypadState {
  const map: Record<string, KeypadKey> = {
    a: '*',
    s: '-',
    p: '+',
    d: '/',
    e: 'equals',
    b: 'backspace',
    c: 'clear',
  };
  let state = initialKeypadState();
  for (const ch of keys) {
    state = pressKey(state, (map[ch] ?? ch) as KeypadKey);
  }
  return state;
}

describe('keypad — plain entry', () => {
  it('types whole major units into minor units', () => {
    expect(resultMinor(run('2180'))).toBe(218000);
  });

  it('types decimals as cents', () => {
    expect(resultMinor(run('21.80'))).toBe(2180);
    expect(resultMinor(run('21.8'))).toBe(2180);
    expect(resultMinor(run('0.05'))).toBe(5);
  });

  it('collapses a leading zero', () => {
    expect(run('05').expr).toBe('5');
    expect(resultMinor(run('05'))).toBe(500);
  });

  it('caps at two decimal places', () => {
    expect(run('1.239').expr).toBe('1.23');
    expect(resultMinor(run('1.239'))).toBe(123);
  });

  it('a lone dot becomes 0.', () => {
    expect(run('.').expr).toBe('0.');
    expect(run('.5').expr).toBe('0.5');
    expect(resultMinor(run('.5'))).toBe(50);
  });

  it('ignores a second dot in the same operand', () => {
    expect(run('1.2.3').expr).toBe('1.23');
  });
});

describe('keypad — quick math', () => {
  it('adds exactly in minor units', () => {
    expect(resultMinor(run('1200p980'))).toBe(218000);
    expect(resultMinor(run('1200p980e'))).toBe(218000);
  });

  it('avoids decimal float noise', () => {
    expect(resultMinor(run('0.1p0.2'))).toBe(30);
    expect(resultMinor(run('12.5p9.8'))).toBe(2230);
  });

  it('subtracts and multiplies', () => {
    expect(resultMinor(run('500s120'))).toBe(38000);
    expect(resultMinor(run('200a3'))).toBe(60000);
    expect(resultMinor(run('12.50a3'))).toBe(3750);
  });

  it('divides, rounding to the cent', () => {
    expect(resultMinor(run('100d4'))).toBe(2500);
    expect(resultMinor(run('100d3'))).toBe(3333);
  });

  it('rejects divide-by-zero', () => {
    expect(resultMinor(run('5d0'))).toBeNull();
  });

  it('evaluates left-to-right with no precedence', () => {
    // (200 + 300) × 3 = 1500, not 200 + (300×3)
    expect(resultMinor(run('200p300a3'))).toBe(150000);
  });

  it('lets = continue a running total', () => {
    expect(run('200p100e').expr).toBe('300');
    expect(resultMinor(run('200p100ea2'))).toBe(60000); // 300 × 2
  });

  it('swaps a trailing operator', () => {
    expect(run('200pa3').expr).toBe('200*3');
    expect(resultMinor(run('200pa3'))).toBe(60000);
  });

  it('ignores a dangling trailing operator', () => {
    expect(resultMinor(run('200p'))).toBe(20000);
    expect(displayMinor(run('200p300a'))).toBe(50000); // shows 200+300 while × is pending
  });
});

describe('keypad — running expression (panel header)', () => {
  it('keeps the full raw expression with display glyphs', () => {
    expect(expressionString(run('200p300a3'))).toBe('200+300×3');
    expect(expressionString(run('500s120'))).toBe('500−120');
    expect(expressionString(run('100d4'))).toBe('100÷4');
  });

  it('shows the plain number while typing, and the result after =', () => {
    expect(expressionString(run('600'))).toBe('600');
    expect(expressionString(initialKeypadState())).toBe('');
    expect(expressionString(run('200p300a3e'))).toBe('1500');
  });
});

describe('keypad — clear (AC) and backspace', () => {
  it('AC resets everything to the initial state', () => {
    expect(pressKey(run('200p300a3'), 'clear')).toEqual(initialKeypadState());
    expect(resultMinor(pressKey(run('999'), 'clear'))).toBeNull();
  });

  it('backspace deletes one character', () => {
    expect(run('218b').expr).toBe('21');
    expect(run('200pb').expr).toBe('200');
    expect(run('200p3b').expr).toBe('200+');
  });

  it('a digit after = starts fresh; an operator after = continues', () => {
    expect(run('200p100e5').expr).toBe('5');
    expect(run('200p100ep5').expr).toBe('300+5');
  });
});

describe('keypad — display + guards', () => {
  it('shows the running result on the amount display', () => {
    expect(displayMinor(run('2180'))).toBe(218000);
    expect(displayMinor(run('200p300'))).toBe(50000);
    expect(displayMinor(initialKeypadState())).toBe(0);
  });

  it('rejects empty, zero, and non-positive results', () => {
    expect(resultMinor(initialKeypadState())).toBeNull();
    expect(resultMinor(run('0'))).toBeNull();
    expect(resultMinor(run('0.00'))).toBeNull();
    expect(resultMinor(run('100s100'))).toBeNull();
    expect(resultMinor(run('100s300'))).toBeNull();
  });
});

describe('keypad — seeding from stored minor units', () => {
  it('round-trips whole and fractional amounts', () => {
    expect(keypadFromMinor(218000).expr).toBe('2180');
    expect(resultMinor(keypadFromMinor(218000))).toBe(218000);
    expect(keypadFromMinor(2180).expr).toBe('21.80');
    expect(resultMinor(keypadFromMinor(2185))).toBe(2185);
  });
});
