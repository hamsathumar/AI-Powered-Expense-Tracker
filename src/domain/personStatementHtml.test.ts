import { describe, expect, it } from '@jest/globals';

import { buildPersonStatement, directionTotalsMinor } from './personStatement';
import { escapeHtml, personStatementHtml, type StatementItem } from './personStatementHtml';
import type { LendingDirection, Transaction, TransactionStatus } from './types';

const palette = {
  text: '#000001',
  textMuted: '#000002',
  textSubtle: '#000003',
  border: '#000004',
  surfaceAlt: '#000005',
  primary: '#000006',
  lent: '#8A3D7E',
  borrowed: '#B54E14',
  warning: '#C98A1E',
};

let n = 0;
function lend(
  direction: LendingDirection,
  amountMinor: number,
  day: number,
  opts: { status?: TransactionStatus; name?: string } = {},
): StatementItem {
  const when = new Date(2026, 8, day, 10, 0).toISOString();
  return {
    accountName: 'Cash',
    tx: {
      id: `t${++n}`,
      type: 'lending',
      status: opts.status ?? 'approved',
      name: opts.name ?? 'Loan',
      amountMinor,
      occurredAt: when,
      source: 'manual',
      confidenceFlags: [],
      createdAt: when,
      updatedAt: when,
      accountId: 'a',
      personId: 'p',
      direction,
    } satisfies Transaction,
  };
}

function render(items: StatementItem[], startDay = '2026-09-01', endDay = '2026-09-30', name = 'Kamal') {
  const statement = buildPersonStatement(items, 'p', {
    from: new Date(startDay + 'T00:00:00'),
    to: new Date(endDay + 'T00:00:00'),
  });
  return personStatementHtml({
    personName: name,
    personId: 'p',
    range: { startDay, endDay },
    statement,
    currencySymbol: 'Rs',
    generatedAt: new Date(2026, 9, 6, 9, 5),
    palette,
  });
}

describe('personStatementHtml', () => {
  it('shows each day with its end-of-day balance, in words', () => {
    const html = render([lend('lend', 100000, 1), lend('lend', 50000, 2)]);
    expect(html).toContain('Statement with Kamal');
    expect(html).toContain('1 Sep – 30 Sep 2026');
    expect(html).toContain('Owes you Rs1,000.00');
    expect(html).toContain('Owes you Rs1,500.00');
    expect(html.indexOf('Wednesday, 2 September 2026')).toBeLessThan(
      html.indexOf('Tuesday, 1 September 2026'),
    ); // newest first
  });

  it('signs and labels every lending row — colour is never alone', () => {
    const html = render([
      lend('lend', 1000, 1),
      lend('lend_repayment_received', 200, 2),
      lend('borrow', 300, 3),
      lend('borrow_repayment_made', 400, 4),
    ]);
    expect(html).toContain('+Rs10.00');
    expect(html).toContain('−Rs2.00');
    expect(html).toContain('−Rs3.00');
    expect(html).toContain('+Rs4.00');
    for (const label of ['Lent out', 'Repaid to you', 'Borrowed', 'Repaid by you']) {
      expect(html).toContain(label);
    }
  });

  it('carries the opening balance in from before the range', () => {
    const html = render([lend('lend', 100000, 1), lend('lend', 50000, 20)], '2026-09-10', '2026-09-30');
    expect(html).toMatch(/Opening balance<\/div>\s*<div[^>]*>Owes you Rs1,000.00/);
    expect(html).toMatch(/Closing balance<\/div>\s*<div[^>]*>Owes you Rs1,500.00/);
    expect(html).not.toContain('Tuesday, 1 September 2026');
  });

  it('lists pending rows as not counted', () => {
    const html = render([lend('lend', 100000, 1), lend('lend', 7700, 2, { status: 'pending' })]);
    expect(html).toContain('Pending — not counted yet');
    expect(html).toMatch(/Closing balance<\/div>\s*<div[^>]*>Owes you Rs1,000.00/);
  });

  it('handles an empty period', () => {
    const html = render([], '2026-09-01', '2026-09-30');
    expect(html).toContain('No transactions with Kamal in this period.');
    expect(html).toContain('Settled up');
  });

  it('escapes user-entered names so they cannot inject markup', () => {
    const html = render([lend('lend', 100, 1, { name: '<img src=x onerror=alert(1)>' })], undefined, undefined, 'A&B <b>');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<b>');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).toContain('A&amp;B &lt;b&gt;');
  });

  it('a negative closing balance reads "You owe" in the borrowed tone', () => {
    const html = render([lend('borrow', 25000, 3)]);
    expect(html).toContain(`color:${palette.borrowed}">You owe Rs250.00`);
  });
});

describe('directionTotalsMinor', () => {
  it('sums approved rows per direction inside the range only', () => {
    const items = [
      lend('lend', 100, 1),
      lend('lend', 50, 2),
      lend('borrow', 30, 3),
      lend('lend', 999, 4, { status: 'pending' }),
    ];
    const s = buildPersonStatement(items, 'p', { from: new Date(2026, 8, 2), to: new Date(2026, 8, 30) });
    expect(directionTotalsMinor(s.days, 'p')).toEqual({
      lend: 50,
      lend_repayment_received: 0,
      borrow: 30,
      borrow_repayment_made: 0,
    });
  });
});

describe('escapeHtml', () => {
  it('escapes the five specials', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
  });
});
