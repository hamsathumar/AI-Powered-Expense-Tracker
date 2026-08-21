/**
 * Application-owned naming for AI-interpreted transactions (V1.1).
 *
 * Evidence: TC-023 (two of three transactions were named the bare word
 * "expense" even though the category resolved correctly) and TC-024 (generated
 * names arrived in inconsistent casing — "tutoring income", "petrol").
 *
 * Naming is INFORMATIONAL, never financial — nothing here may change an
 * amount, type, entity or date, and a bad name must never block approval. But
 * it is app-owned rather than model-owned: the model's `name` is a suggestion
 * that this module normalises, rejects, or replaces deterministically.
 *
 * Two rules:
 *   1. Every generated name is rendered in Title Case (TC-024).
 *   2. A name that carries no information — absent, or just the operation word
 *      the model echoed back — is REPLACED by a name derived from the context
 *      the app already resolved (category, person, destination account), never
 *      left as "expense" (TC-023).
 *
 * Pure and synchronous — no I/O — so it is fully unit-testable.
 */
import type { LendingDirection, OrdinaryKind } from './types';

/** Words that stay lowercase inside a title (never first or last). */
const MINOR_WORDS = new Set([
  'a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'from', 'in', 'into',
  'nor', 'of', 'on', 'onto', 'or', 'per', 'the', 'to', 'via', 'vs', 'with',
]);

/**
 * Names that carry no information. The model echoing the operation back
 * ("expense") is the TC-023 failure mode; these are treated as ABSENT so the
 * deterministic fallback runs instead.
 */
const EMPTY_NAMES = new Set([
  'expense', 'income', 'transfer', 'lending', 'lend', 'borrow',
  'transaction', 'payment', 'purchase', 'spending', 'spend', 'unknown',
  'recurring', 'split', 'bill split', 'n/a', 'none', 'untitled',
]);

/** A token already carrying an internal capital is a brand/acronym — leave it
 *  exactly as the user said it ("iPhone", "ATM", "McDonald's", "KFC"). */
function hasInnerCapital(token: string): boolean {
  return /[A-Z]/.test(token.slice(1));
}

function capitaliseWord(word: string): string {
  // Capitalise the first letter of each segment so hyphenated and slashed
  // compounds read correctly: "phone-back" -> "Phone-Back", "food/drink".
  return word.replace(/[\p{L}\p{N}][\p{L}\p{N}'’]*/gu, (seg, offset: number) => {
    // Keep an all-caps or inner-capital segment untouched.
    if (hasInnerCapital(seg)) return seg;
    // Apostrophe suffixes stay lowercase: "Sham's", not "Sham'S".
    if (offset > 0 && /['’]/.test(word[offset - 1] ?? '')) return seg.toLowerCase();
    return seg.charAt(0).toUpperCase() + seg.slice(1).toLowerCase();
  });
}

/**
 * Render a name in Title Case (TC-024). Minor words stay lowercase unless they
 * are the first or last word; brands/acronyms keep their original casing.
 */
export function toTitleCase(input: string): string {
  const words = input.trim().split(/\s+/).filter((w) => w.length > 0);
  if (words.length === 0) return '';
  return words
    .map((word, i) => {
      if (hasInnerCapital(word)) return word; // iPhone, ATM, McDonald's
      const bare = word.toLowerCase();
      const isEdge = i === 0 || i === words.length - 1;
      if (!isEdge && MINOR_WORDS.has(bare.replace(/[^\p{L}]/gu, ''))) return bare;
      return capitaliseWord(word);
    })
    .join(' ');
}

/** True when the model's suggested name carries no usable information. */
export function isEmptyName(raw: string | null | undefined): boolean {
  if (!raw) return true;
  const normalised = raw.trim().toLowerCase().replace(/\s+/g, ' ');
  if (normalised.length === 0) return true;
  if (EMPTY_NAMES.has(normalised)) return true;
  // "an expense", "the transaction", "recurring expense" carry nothing either.
  const stripped = normalised.replace(/^(a|an|the|my|new)\s+/, '');
  if (EMPTY_NAMES.has(stripped)) return true;
  // A name with no letters at all ("200", "---") is not a name.
  return !/\p{L}/u.test(normalised);
}

export interface NameContext {
  operation: OrdinaryKind;
  /** Textual category reference the model gave, if any (e.g. "Groceries"). */
  categoryReference?: string | null;
  /** Textual person reference, if any. */
  personReference?: string | null;
  /** Textual destination-account reference, for transfers. */
  toAccountReference?: string | null;
  /** Textual source-account reference, used only as a last resort. */
  accountReference?: string | null;
  direction?: LendingDirection | null;
  /** true for the recurring specialized branch — affects the last-resort word. */
  recurring?: boolean;
  /** true for the bill-split specialized branch. */
  billSplit?: boolean;
}

const LAST_RESORT: Record<OrdinaryKind, string> = {
  expense: 'Expense',
  income: 'Income',
  transfer: 'Transfer',
  lending: 'Lending',
};

/**
 * Derive a name from context the app has ALREADY resolved. This is the TC-023
 * fix: the category was correct in every failing case, it just was not reused.
 * Nothing is invented — every branch only re-uses a reference the model
 * actually produced.
 */
export function deriveName(ctx: NameContext): string {
  const category = ctx.categoryReference?.trim();
  const person = ctx.personReference?.trim();
  const toAccount = ctx.toAccountReference?.trim();

  if (ctx.operation === 'lending' && person) {
    switch (ctx.direction) {
      case 'lend':
        return toTitleCase(`Lent to ${person}`);
      case 'borrow':
        return toTitleCase(`Borrowed from ${person}`);
      case 'lend_repayment_received':
        return toTitleCase(`Repayment from ${person}`);
      case 'borrow_repayment_made':
        return toTitleCase(`Repaid ${person}`);
      default:
        return toTitleCase(`Lending with ${person}`);
    }
  }

  if (ctx.operation === 'transfer' && toAccount) {
    return toTitleCase(`Transfer to ${toAccount}`);
  }

  if ((ctx.operation === 'expense' || ctx.operation === 'income') && category) {
    // "100 rupees on groceries" -> "Groceries" (TC-023), not "expense".
    return toTitleCase(category);
  }

  if (ctx.billSplit) return 'Split Bill';
  if (ctx.recurring) return toTitleCase(`Recurring ${LAST_RESORT[ctx.operation]}`);
  if (person) return toTitleCase(person);

  return LAST_RESORT[ctx.operation];
}

/**
 * The single entry point used by validation: normalise the model's suggested
 * name, or replace it with a derived one when it carries no information.
 * `sanitise` is injected so the injection defence (V1.1) can strip
 * instruction-like text without this module depending on it.
 */
export function resolveName(
  suggested: string | null | undefined,
  ctx: NameContext,
  sanitise: (s: string) => string = (s) => s,
): string {
  const cleaned = typeof suggested === 'string' ? sanitise(suggested).replace(/\s+/g, ' ').trim() : '';
  if (isEmptyName(cleaned)) return deriveName(ctx);
  return toTitleCase(cleaned).slice(0, 120).trim();
}
