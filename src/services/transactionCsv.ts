/**
 * Write the transaction ledger to a CSV file and hand it to the iOS share
 * sheet. Mirrors `backupFile.ts` — the row/escaping logic is pure and lives in
 * `domain/csv.ts`; this is only file + OS plumbing.
 *
 * Distinct from the backup in Settings → Data: that writes JSON for every
 * table so Kaasu can restore itself. This writes one readable row per
 * transaction for a spreadsheet, and cannot be imported back.
 */
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import { transactionCsvFilename, transactionsToCsv, type CsvTransaction } from '@/domain/csv';

/**
 * `accountId` is the account the list was filtered to, if any — it only
 * affects how transfers are signed. Returns the number of rows written.
 */
export async function shareTransactionsCsv(
  items: CsvTransaction[],
  accountId?: string,
): Promise<number> {
  if (items.length === 0) {
    throw new Error('There are no transactions to export.');
  }

  const csv = transactionsToCsv(items, accountId);

  const file = new File(Paths.cache, transactionCsvFilename());
  if (file.exists) file.delete();
  file.create();
  file.write(csv);

  if (!(await Sharing.isAvailableAsync())) {
    throw new Error('Sharing is not available on this device.');
  }
  await Sharing.shareAsync(file.uri, {
    mimeType: 'text/csv',
    dialogTitle: 'Export transactions',
    UTI: 'public.comma-separated-values-text',
  });

  return items.length;
}
