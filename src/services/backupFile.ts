/**
 * Device file I/O for backups: write JSON to a file and hand it to the iOS
 * share sheet, and pick a backup file back via the document picker. Pure
 * file/OS plumbing — the DB-side logic lives in src/db/backup.ts.
 */
import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import { exportBackup } from '@/db/backup';
import { backupFilename } from '@/domain/backupFormat';

/** Serialize the DB, write it to a temp file, and open the iOS share sheet. */
export async function shareBackup(): Promise<void> {
  const backup = await exportBackup();
  const json = JSON.stringify(backup, null, 2);

  const file = new File(Paths.cache, backupFilename());
  if (file.exists) file.delete();
  file.create();
  file.write(json);

  if (!(await Sharing.isAvailableAsync())) {
    throw new Error('Sharing is not available on this device.');
  }
  await Sharing.shareAsync(file.uri, {
    mimeType: 'application/json',
    dialogTitle: 'Save your Kaasu backup',
    UTI: 'public.json',
  });
}

/** Pick a .json file and return its text, or null if the user cancels. */
export async function pickBackupText(): Promise<string | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: 'application/json',
    copyToCacheDirectory: true,
  });
  if (result.canceled || !result.assets?.[0]) return null;
  return new File(result.assets[0].uri).text();
}
