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

/** Feed a string of keys ('a'=×, 's'=−, 'p'=+, 'e'==, 'b'=backspace). */
function run(keys: string): KeypadState {
  const map: Record<string, KeypadKey> = { a: '*', s: '-', p: '+', e: 'equals', b: 'backspace' };
  let state = initialKeypadState();
  for (const ch of keys) {
    const key = (map[ch] ?? ch) as KeypadKey;
    state = pressKey(state, key);
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
    expect(run('05').entry).toBe('5');
    expect(resultMinor(run('05'))).toBe(500);
  });

  it('caps at two decimal places', () => {
    expect(run('1.239').entry).toBe('1.23');
    expect(resultMinor(run('1.239'))).toBe(123);
  });

  it('a lone dot becomes 0.', () => {
    expect(run('.').entry).toBe('0.');
    expect(run('.5').entry).toBe('0.5');
    expect(resultMinor(run('.5'))).toBe(50);
  });

  it('ignores a second dot', () => {
    expect(run('1.2.3').entry).toBe('1.23');
  });
});

describe('keypad — quick math', () => {
  it('adds exactly in minor units', () => {
    expect(resultMinor(run('1200p980'))).toBe(218000);
    expect(resultMinor(run('1200p980e'))).toBe(218000);
  });

  it('avoids decimal float noise (0.1 + 0.2)', () => {
    expect(resultMinor(run('0.1p0.2'))).toBe(30);
    expect(resultMinor(run('12.5p9.8'))).toBe(2230);
  });

  it('subtracts', () => {
    expect(resultMinor(run('500s120'))).toBe(38000);
  });

  it('multiplies (count × price)', () => {
    expect(resultMinor(run('200a3'))).toBe(60000);
    expect(resultMinor(run('12.50a3'))).toBe(3750);
  });

  it('evaluates left-to-right with no precedence', () => {
    // (200 + 100) × 2 = 600, not 200 + (100×2)
    expect(resultMinor(run('200p100a2e'))).toBe(60000);
  });

  it('lets = continue a running total', () => {
    const afterEquals = run('200p100e'); // 300
    const continued = pressKey(pressKey(afterEquals, '*'), '2');
    expect(resultMinor(continued)).toBe(60000);
  });

  it('changing operator before an operand keeps the accumulator', () => {
    expect(resultMinor(run('200pa3'))).toBe(60000); // + then × → ×
  });

  it('drops a dangling trailing operator', () => {
    expect(resultMinor(run('200p'))).toBe(20000);
    expect(resultMinor(run('200pe'))).toBe(20000);
  });
});

describe('keypad — display + guards', () => {
  it('shows the running operand on the display', () => {
    expect(displayMinor(run('2180'))).toBe(218000);
    expect(displayMinor(run('200p'))).toBe(20000); // shows accumulator after operator
    expect(displayMinor(initialKeypadState())).toBe(0);
  });

  it('rejects empty and zero as a final amount', () => {
    expect(resultMinor(initialKeypadState())).toBeNull();
    expect(resultMinor(run('0'))).toBeNull();
    expect(resultMinor(run('0.00'))).toBeNull();
  });

  it('rejects a non-positive result', () => {
    expect(resultMinor(run('100s100e'))).toBeNull(); // 0
    expect(resultMinor(run('100s300e'))).toBeNull(); // negative
  });

  it('backspaces the entry, then the operator, then the accumulator', () => {
    expect(run('218b').entry).toBe('21');
    expect(run('200pb').op).toBeNull();
    const clearedAcc = run('200pb b'.replace(' ', ''));
    expect(clearedAcc.acc).toBeNull();
  });

  it('backspace after = clears everything', () => {
    expect(run('200e b'.replace(' ', ''))).toEqual(initialKeypadState());
  });
});

describe('keypad — running expression', () => {
  it('shows the expression while a calculation is in progress', () => {
    expect(expressionString(run('700p'))).toBe('700 +');
    expect(expressionString(run('700p8'))).toBe('700 + 8');
    expect(expressionString(run('12.50a'))).toBe('12.5 ×');
    expect(expressionString(run('12.50a3'))).toBe('12.5 × 3');
    expect(expressionString(run('500s120'))).toBe('500 − 120');
  });

  it('is empty for a plain number and after = resolves it', () => {
    expect(expressionString(initialKeypadState())).toBe('');
    expect(expressionString(run('700'))).toBe('');
    expect(expressionString(run('700p8e'))).toBe('');
  });
});

describe('keypad — clear (AC)', () => {
  it('resets everything to the initial state', () => {
    expect(pressKey(run('700p8'), 'clear')).toEqual(initialKeypadState());
    expect(pressKey(run('12.99'), 'clear')).toEqual(initialKeypadState());
    expect(resultMinor(pressKey(run('700p8'), 'clear'))).toBeNull();
  });
});

describe('keypad — seeding from stored minor units', () => {
  it('round-trips whole and fractional amounts', () => {
    expect(keypadFromMinor(218000).entry).toBe('2180');
    expect(resultMinor(keypadFromMinor(218000))).toBe(218000);
    expect(keypadFromMinor(2180).entry).toBe('21.80');
    expect(resultMinor(keypadFromMinor(2180))).toBe(2180);
    expect(resultMinor(keypadFromMinor(2185))).toBe(2185);
  });
});
