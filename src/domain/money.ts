/**
 * Money formatting and parsing.
 *
 * Amounts are integer minor units (cents) everywhere in the app; conversion
 * to/from human display happens ONLY here.
 *
 * v1 is single-currency. The symbol will come from `settings` once
 * onboarding exists; until then this default applies.
 */
export const DEFAULT_CURRENCY_SYMBOL = 'Rs';

/** 125050 → "1,250.50" (no symbol, no sign). */
export function formatMinorUnits(minor: number): string {
  if (!Number.isInteger(minor)) {
    throw new Error(`Expected integer minor units, got ${minor}`);
  }
  const abs = Math.abs(minor);
  const major = Math.floor(abs / 100).toLocaleString('en-US');
  const cents = String(abs % 100).padStart(2, '0');
  return `${major}.${cents}`;
}

/** 125050 → "Rs1,250.50". Sign handling lives in <Amount>, not here. */
export function formatAmount(minor: number, symbol = DEFAULT_CURRENCY_SYMBOL): string {
  return `${symbol}${formatMinorUnits(minor)}`;
}

/**
 * User input → minor units. Accepts "1250", "1,250.5", "1250.50".
 * Returns null for anything invalid, non-positive, or with >2 decimals.
 * Transaction amounts must be > 0; pass `allowZero` for fields where zero is
 * meaningful (e.g. an account's opening balance).
 */
export function parseAmountInput(
  text: string,
  { allowZero = false }: { allowZero?: boolean } = {},
): number | null {
  const cleaned = text.replace(/,/g, '').trim();
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const [majorPart, centPart = ''] = cleaned.split('.');
  const minor = Number(majorPart) * 100 + Number(centPart.padEnd(2, '0') || '0');
  if (minor === 0) return allowZero ? 0 : null;
  return minor;
}
