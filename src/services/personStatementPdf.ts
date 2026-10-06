/**
 * Render a person's statement to PDF and hand it to the iOS share sheet.
 * Only file + OS plumbing lives here — the statement maths
 * (domain/personStatement.ts) and the document (domain/personStatementHtml.ts)
 * are pure and tested.
 *
 * The FULL history is loaded even for a short range: rows before the range are
 * what make its opening balance correct.
 */
import { File, Paths } from 'expo-file-system';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';

import { listTransactionItemsForPerson } from '@/db/queries/transactions';
import { buildPersonStatement } from '@/domain/personStatement';
import { personStatementHtml } from '@/domain/personStatementHtml';
import { fromDay } from '@/domain/reportRange';
import { statementFilename, type DayRange } from '@/domain/statementPeriod';
import type { Person } from '@/domain/types';
import { lightColors } from '@/theme/tokens';

/** A4 at 72 points per inch, with a 36pt (½ inch) margin all round. */
const A4 = { width: 595, height: 842 };
const MARGIN = 36;

export async function sharePersonStatementPdf(
  person: Person,
  range: DayRange,
  currencySymbol: string,
): Promise<void> {
  const items = await listTransactionItemsForPerson(person.id);
  const statement = buildPersonStatement(items, person.id, {
    from: fromDay(range.startDay),
    to: fromDay(range.endDay),
  });

  const html = personStatementHtml({
    personName: person.name,
    personId: person.id,
    range,
    statement,
    currencySymbol,
    generatedAt: new Date(),
    palette: lightColors, // paper is always light
  });

  const { uri } = await Print.printToFileAsync({
    html,
    ...A4,
    margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
  });

  // expo-print names the file with a random UUID; give it a readable name.
  const named = new File(Paths.cache, statementFilename(person.name, range));
  if (named.exists) named.delete();
  new File(uri).move(named);

  if (!(await Sharing.isAvailableAsync())) {
    throw new Error('Sharing is not available on this device.');
  }
  await Sharing.shareAsync(named.uri, {
    mimeType: 'application/pdf',
    dialogTitle: `Statement with ${person.name}`,
    UTI: 'com.adobe.pdf',
  });
}
