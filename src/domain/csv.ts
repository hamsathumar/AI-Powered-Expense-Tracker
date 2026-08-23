/**
 * CSV export of the transaction ledger — pure, so escaping and the signed
 * amount are unit-tested rather than discovered in a spreadsheet.
 *
 * This is deliberately NOT the backup format. `db/backup.ts` writes JSON
 * containing every table so Kaasu can restore itself; this writes one flat row
 * per transaction for a human to read in Numbers/Excel, and cannot be
 * imported back.
 *
 * Amounts are written as plain signed decimals with no currency symbol and no
 * thousands separator — anything else stops a spreadsheet parsing the column
 * as a number, and a column you can't SUM defeats the point of the export.
 */
import { format } from 'date-fns';

import { accountDeltaMinor } from '@/domain/accountActivity';
import type { LendingDirection, Transaction } from '@/domain/types';

/** Header row, and the order every data row follows. */
export const CSV_HEADERS = [
  'Date',
  'Time',
  'Name',
  'Type',
  'Amount',
  'Category',
  'Account',
  'To Account',
  'Person',
  'Direction',
] as const;

const DIRECTION_LABELS: Record<LendingDirection, string> = {
  lend: 'Lent out',
  lend_repayment_received: 'Repayment received',
  borrow: 'Borrowed',
  borrow_repayment_made: 'Repayment made',
};

/** The joined display fields the exporter needs, mirroring TransactionListItem. */
export interface CsvTransaction {
  tx: Transaction;
  accountName: string | null;
  toAccountName: string | null;
  categoryName: string | null;
  personName: string | null;
}

/**
 * RFC 4180 escaping: wrap in quotes when the value contains a comma, a quote,
 * or a newline, and double any embedded quotes. A transaction name is free
 * text, so all three genuinely happen.
 */
export function escapeCsvField(value: string): string {
  if (!/[",\r\n]/.test(value)) return value;
  return `"${value.replace(/"/g, '""')}"`;
}

export function toCsv(rows: readonly (readonly string[])[]): string {
  // CRLF is what RFC 4180 specifies and what Excel is happiest with.
  return rows.map((row) => row.map(escapeCsvField).join(',')).join('\r\n');
}

/**
 * Signed minor units for the Amount column.
 *
 * Kaasu stores every amount positive and derives direction from the type, so
 * the sign exists only in the export. With an account in context the row is
 * written from that account's point of view. Without one, a transfer would net
 * to zero (it moves money between the user's own accounts) — that reads as a
 * bug in a spreadsheet, so it is written as leaving its source account, with
 * the destination in the "To Account" column.
 */
export function csvAmountMinor(tx: Transaction, accountId?: string): number {
  if (tx.type === 'transfer' && !accountId) return -tx.amountMinor;
  return accountDeltaMinor(tx, accountId);
}

/** Minor units → a plain decimal a spreadsheet will parse. */
export function csvAmount(minor: number): string {
  return (minor / 100).toFixed(2);
}

function row(item: CsvTransaction, accountId?: string): string[] {
  const { tx } = item;
  const occurred = new Date(tx.occurredAt);
  return [
    format(occurred, 'yyyy-MM-dd'),
    format(occurred, 'HH:mm'),
    tx.name,
    tx.type,
    csvAmount(csvAmountMinor(tx, accountId)),
    item.categoryName ?? '',
    item.accountName ?? '',
    item.toAccountName ?? '',
    item.personName ?? '',
    tx.type === 'lending' ? DIRECTION_LABELS[tx.direction] : '',
  ];
}

/**
 * The whole file. `accountId` is the account the list was filtered to, if any
 * — it only changes how transfers are signed.
 */
export function transactionsToCsv(items: CsvTransaction[], accountId?: string): string {
  return toCsv([[...CSV_HEADERS], ...items.map((item) => row(item, accountId))]);
}

/** kaasu-transactions-20260823-1930.csv */
export function transactionCsvFilename(date = new Date()): string {
  return `kaasu-transactions-${format(date, 'yyyyMMdd-HHmm')}.csv`;
}
