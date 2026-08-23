/**
 * Key/value settings (technical-plan §3). Non-secret config only — the
 * Gemini API key lives in SecureStore (see src/ai/secureConfig.ts), never
 * here.
 */
import { getDb } from '@/db/client';
import { DEFAULT_CURRENCY_CODE } from '@/domain/money';

export async function getSetting(key: string): Promise<string | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ value: string }>(
    'SELECT value FROM settings WHERE key = ?',
    key,
  );
  return row?.value ?? null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?',
    key,
    value,
    value,
  );
}

export const SETTINGS_KEYS = {
  geminiModel: 'gemini_model',
  defaultCurrency: 'default_currency',
  profileName: 'profile_name',
  profilePhotoUri: 'profile_photo_uri',
  appearance: 'appearance',
  haptics: 'haptics',
  motion: 'motion',
} as const;

/** Theme preference: follow the system, or force light/dark (v2 §5.10). */
export type AppearanceMode = 'system' | 'light' | 'dark';
export const DEFAULT_APPEARANCE: AppearanceMode = 'system';

export async function getAppearance(): Promise<AppearanceMode> {
  const stored = await getSetting(SETTINGS_KEYS.appearance);
  return stored === 'light' || stored === 'dark' ? stored : 'system';
}

/**
 * Feel preferences (Settings → Appearance). Haptics and motion are
 * enhancements, so both default to on and degrade silently — but a money app
 * gets used in meetings and in bed, so both need an off switch that does not
 * depend on changing an iOS system setting.
 */
export type MotionMode = 'system' | 'reduced' | 'full';
export const DEFAULT_MOTION: MotionMode = 'system';

export async function getHapticsEnabled(): Promise<boolean> {
  return (await getSetting(SETTINGS_KEYS.haptics)) !== 'off';
}

export async function getMotionMode(): Promise<MotionMode> {
  const stored = await getSetting(SETTINGS_KEYS.motion);
  return stored === 'reduced' || stored === 'full' ? stored : 'system';
}

/**
 * Default Gemini model. `generateContent` still serves this; if Google
 * deprecates it, the user edits the model in Settings — no code change.
 * (A newer "Interactions API" exists but the stable generateContent path is
 * what this app targets.)
 */
export const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';

export async function getGeminiModel(): Promise<string> {
  return (await getSetting(SETTINGS_KEYS.geminiModel)) ?? DEFAULT_GEMINI_MODEL;
}

export async function getCurrencyCode(): Promise<string> {
  return (await getSetting(SETTINGS_KEYS.defaultCurrency)) ?? DEFAULT_CURRENCY_CODE;
}

export interface Profile {
  name: string | null;
  photoUri: string | null;
}

export async function getProfile(): Promise<Profile> {
  const [name, photoUri] = await Promise.all([
    getSetting(SETTINGS_KEYS.profileName),
    getSetting(SETTINGS_KEYS.profilePhotoUri),
  ]);
  return { name, photoUri };
}
