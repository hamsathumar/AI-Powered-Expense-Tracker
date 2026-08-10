/**
 * Money formatting and parsing.
 *
 * Amounts are integer minor units (cents) everywhere in the app; conversion
 * to/from human display happens ONLY here. Currency is a DISPLAY setting: it
 * changes the symbol/code only, never the stored integers.
 */

/** Fixed currency list (Settings picker). Symbols shown before the amount. */
export const CURRENCIES = [
  { code: 'LKR', symbol: 'Rs' },
  { code: 'USD', symbol: '$' },
  { code: 'EUR', symbol: '€' },
  { code: 'GBP', symbol: '£' },
  { code: 'INR', symbol: '₹' },
  { code: 'AUD', symbol: 'A$' },
  { code: 'CAD', symbol: 'C$' },
  { code: 'SGD', symbol: 'S$' },
  { code: 'AED', symbol: 'AED ' },
  { code: 'JPY', symbol: '¥' },
] as const;

export type CurrencyCode = (typeof CURRENCIES)[number]['code'];
export const DEFAULT_CURRENCY_CODE: CurrencyCode = 'LKR';

export function symbolForCurrency(code: string): string {
  return CURRENCIES.find((c) => c.code === code)?.symbol ?? `${code} `;
}

/**
 * The symbol `formatAmount` uses by default. Set once at startup and whenever
 * the currency setting changes (see CurrencyContext), so non-component
 * formatters stay correct without threading the symbol through everywhere.
 */
let activeCurrencySymbol = symbolForCurrency(DEFAULT_CURRENCY_CODE);
export function setActiveCurrencySymbol(symbol: string): void {
  activeCurrencySymbol = symbol;
}

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
export function formatAmount(minor: number, symbol = activeCurrencySymbol): string {
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
