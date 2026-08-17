/**
 * Shared Gemini helpers. The Transaction AI V1 request/response lives in
 * src/ai/geminiInterpret.ts; this module only holds the audio helper both the
 * old and new paths reused.
 */

/** Read a local file:// URI as base64 without extra native modules. */
export async function fileToBase64(uri: string): Promise<string> {
  const response = await fetch(uri);
  const blob = await response.blob();
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read the recording.'));
    reader.onloadend = () => resolve(reader.result as string);
    reader.readAsDataURL(blob);
  });
  const comma = dataUrl.indexOf(',');
  return comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
}
