/**
 * Gemini API key storage (technical-plan §5.6).
 *
 * The key is a secret: it lives in the device keychain via expo-secure-store,
 * NEVER in a committed file, .env, or the settings table. A client-side key
 * can still be extracted from any mobile app — acceptable for a private,
 * unpublished, personal app, provided a spending cap is set on the Google AI
 * Studio key. If this app is ever published, move the Gemini call behind a
 * server so the key never reaches the device.
 */
import * as SecureStore from 'expo-secure-store';

const KEY = 'gemini_api_key';

export async function getGeminiApiKey(): Promise<string | null> {
  return SecureStore.getItemAsync(KEY);
}

export async function setGeminiApiKey(value: string): Promise<void> {
  await SecureStore.setItemAsync(KEY, value.trim());
}

export async function clearGeminiApiKey(): Promise<void> {
  await SecureStore.deleteItemAsync(KEY);
}

export async function hasGeminiApiKey(): Promise<boolean> {
  return (await getGeminiApiKey()) !== null;
}
