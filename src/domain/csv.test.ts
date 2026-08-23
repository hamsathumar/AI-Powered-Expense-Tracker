import { describe, expect, it } from '@jest/globals';

import {
  csvAmount,
  csvAmountMinor,
  escapeCsvField,
  toCsv,
  transactionCsvFilename,
  transactionsToCsv,
  type CsvTransaction,
} from './csv';
import type { LendingDirection, Transaction } from './types';

let counter = 0;

function tx(partial: {
  type: Transaction['type'];
  amountMinor: number;
  name?: string;
  direction?: LendingDirection;
  accountId?: string;
  toAccountId?: string;
  occurredAt?: string;
}): Transaction {
  counter += 1;
  const base = {
    id: `t${counter}`,
    name: partial.name ?? 'Row',
    amountMinor: partial.amountMinor,
    occurredAt: partial.occurredAt ?? '2026-08-23T09:30:00.000Z',
    status: 'approved' as const,
    source: 'manual' as const,
    confidenceFlags: [],
    createdAt: '2026-08-23T09:30:00.000Z',
    updatedAt: '2026-08-23T09:30:00.000Z',
  };
  switch (partial.type) {
    case 'expense':
      return { ...base, type: 'expense', accountId: partial.accountId ?? 'a1', categoryId: 'c1' };
    case 'income':
      return { ...base, type: 'income', accountId: partial.accountId ?? 'a1', categoryId: 'c1' };
    case 'transfer':
      return {
        ...base,
        type: 'transfer',
        accountId: partial.accountId ?? 'a1',
        toAccountId: partial.toAccountId ?? 'a2',
      };
    case 'lending':
      return {
        ...base,
        type: 'lending',
        accountId: partial.accountId ?? 'a1',
        personId: 'p1',
        direction: partial.direction ?? 'lend',
      };
  }
}

const item = (t: Transaction, extra: Partial<CsvTransaction> = {}): CsvTransaction => ({
  tx: t,
  accountName: 'Cash',
  toAccountName: null,
  categoryName: 'Food',
  personName: null,
  ...extra,
});

describe('escapeCsvField', () => {
  it('leaves plain values alone', () => {
    expect(escapeCsvField('Groceries')).toBe('Groceries');
  });

  it('quotes values containing a comma', () => {
    expect(escapeCsvField('Rice, dhal')).toBe('"Rice, dhal"');
  });

  it('doubles embedded quotes', () => {
    expect(escapeCsvField('The "good" shop')).toBe('"The ""good"" shop"');
  });

  it('quotes values containing a newline', () => {
    expect(escapeCsvField('line one\nline two')).toBe('"line one\nline two"');
  });
});

describe('toCsv', () => {
  it('joins fields with commas and rows with CRLF', () => {
    expect(toCsv([['a', 'b'], ['c', 'd']])).toBe('a,b\r\nc,d');
  });
});

describe('csvAmount', () => {
  it('writes a plain decimal with no symbol or separators', () => {
    // A thousands separator would break the column as a number in a spreadsheet.
    expect(csvAmount(125_050)).toBe('1250.50');
    expect(csvAmount(-50_000)).toBe('-500.00');
    expect(csvAmount(0)).toBe('0.00');
  });
});

describe('csvAmountMinor', () => {
  it('signs expense negative and income positive', () => {
    expect(csvAmountMinor(tx({ type: 'expense', amountMinor: 50_000 }))).toBe(-50_000);
    expect(csvAmountMinor(tx({ type: 'income', amountMinor: 50_000 }))).toBe(50_000);
  });

  it('signs a transfer as leaving its source when no account is in context', () => {
    // Netting to zero here would look like a bug in the spreadsheet.
    expect(csvAmountMinor(tx({ type: 'transfer', amountMinor: 20_000 }))).toBe(-20_000);
  });

  it('signs a transfer from the selected account’s point of view', () => {
    const transfer = tx({ type: 'transfer', amountMinor: 20_000, accountId: 'a1', toAccountId: 'a2' });
    expect(csvAmountMinor(transfer, 'a1')).toBe(-20_000);
    expect(csvAmountMinor(transfer, 'a2')).toBe(20_000);
  });

  it('follows lending direction', () => {
    expect(csvAmountMinor(tx({ type: 'lending', amountMinor: 1000, direction: 'lend' }))).toBe(-1000);
    expect(csvAmountMinor(tx({ type: 'lending', amountMinor: 1000, direction: 'borrow' }))).toBe(1000);
    expect(
      csvAmountMinor(tx({ type: 'lending', amountMinor: 1000, direction: 'lend_repayment_received' })),
    ).toBe(1000);
    expect(
      csvAmountMinor(tx({ type: 'lending', amountMinor: 1000, direction: 'borrow_repayment_made' })),
    ).toBe(-1000);
  });
});

describe('transactionsToCsv', () => {
  it('starts with the header row', () => {
    const csv = transactionsToCsv([]);
    expect(csv).toBe('Date,Time,Name,Type,Amount,Category,Account,To Account,Person,Direction');
  });

  it('writes one row per transaction in the given order', () => {
    const csv = transactionsToCsv([
      item(tx({ type: 'expense', amountMinor: 50_000, name: 'Lunch' })),
      item(tx({ type: 'income', amountMinor: 500_000, name: 'Pocket Money' })),
    ]);
    const lines = csv.split('\r\n');
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain('Lunch');
    expect(lines[1]).toContain('-500.00');
    expect(lines[2]).toContain('5000.00');
  });

  it('escapes a name containing a comma so columns do not shift', () => {
    const csv = transactionsToCsv([item(tx({ type: 'expense', amountMinor: 100, name: 'Rice, dhal' }))]);
    const dataLine = csv.split('\r\n')[1];
    expect(dataLine).toContain('"Rice, dhal"');
    // 10 columns means 9 separating commas — the quoted one must not count.
    expect(dataLine.split(',').length).toBe(10 + 1); // the escaped name adds one
    expect(dataLine.startsWith('2026-08-23,')).toBe(true);
  });

  it('fills the transfer and lending columns', () => {
    const csv = transactionsToCsv([
      item(tx({ type: 'transfer', amountMinor: 20_000, name: 'To BOC' }), {
        toAccountName: 'BOC',
        categoryName: null,
      }),
      item(tx({ type: 'lending', amountMinor: 1000, name: 'Lent', direction: 'lend' }), {
        personName: 'Mateen',
        categoryName: null,
      }),
    ]);
    const [, transferLine, lendingLine] = csv.split('\r\n');
    expect(transferLine).toContain('BOC');
    expect(lendingLine).toContain('Mateen');
    expect(lendingLine).toContain('Lent out');
  });

  it('writes every row with the same column count as the header', () => {
    const csv = transactionsToCsv([
      item(tx({ type: 'expense', amountMinor: 100 })),
      item(tx({ type: 'transfer', amountMinor: 100 }), { toAccountName: 'BOC' }),
      item(tx({ type: 'lending', amountMinor: 100 }), { personName: 'Mateen' }),
    ]);
    const lines = csv.split('\r\n');
    const columns = lines.map((l) => l.split(',').length);
    expect(new Set(columns).size).toBe(1);
  });
});

describe('transactionCsvFilename', () => {
  it('is timestamped and .csv', () => {
    expect(transactionCsvFilename(new Date(2026, 7, 23, 19, 30))).toBe(
      'kaasu-transactions-20260823-1930.csv',
    );
  });
});
