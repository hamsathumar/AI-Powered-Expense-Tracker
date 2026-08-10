/**
 * Profile photo: pick an existing image from the gallery (no camera) and
 * COPY it into the app's persistent document directory, so we own a stable
 * path rather than depending on a transient gallery URI.
 */
import { File, Paths } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';

/** Returns the new persistent file URI, or null if permission denied / canceled. */
export async function pickProfilePhoto(): Promise<string | null> {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) return null;

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: 'images',
    quality: 0.7,
  });
  if (result.canceled || !result.assets?.[0]) return null;

  const source = new File(result.assets[0].uri);
  const dest = new File(Paths.document, `profile-${Date.now()}.jpg`);
  if (dest.exists) dest.delete();
  await source.copy(dest);
  return dest.uri;
}

/** Best-effort delete of a stored profile photo (e.g. on replace / clear). */
export function deleteProfilePhoto(uri: string | null | undefined): void {
  if (!uri) return;
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch {
    // non-fatal — a stale file is harmless
  }
}
