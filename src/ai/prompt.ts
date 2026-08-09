/**
 * Prompt construction + response schema for voice parsing (spec §6,
 * technical-plan §5.2/§5.3).
 *
 * Context (the user's accounts/categories/people) is injected so the model
 * matches EXISTING entities instead of inventing new ones. The schema forces
 * JSON-only output; app-side validation (validate.ts) still treats the
 * result as untrusted.
 */
import type { Account, Category, Person } from '@/domain/types';

/** Shape the model is asked to return (major units; names, not ids). */
export interface RawParsedTransaction {
  type: string;
  name: string;
  amount: number;
  currency: string | null;
  category: string | null;
  account: string | null;
  toAccount: string | null;
  person: string | null;
  direction: string | null;
  transcript: string;
  confidence_flags: string[];
}

/** Gemini responseSchema (OpenAPI subset — UPPERCASE types). */
export const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    type: { type: 'STRING', enum: ['expense', 'income', 'transfer', 'lending'] },
    name: { type: 'STRING' },
    amount: { type: 'NUMBER' },
    currency: { type: 'STRING', nullable: true },
    category: { type: 'STRING', nullable: true },
    account: { type: 'STRING', nullable: true },
    toAccount: { type: 'STRING', nullable: true },
    person: { type: 'STRING', nullable: true },
    // direction validated in code, so kept as a free string here
    direction: { type: 'STRING', nullable: true },
    transcript: { type: 'STRING' },
    confidence_flags: { type: 'ARRAY', items: { type: 'STRING' } },
  },
  required: ['type', 'name', 'amount', 'transcript', 'confidence_flags'],
  propertyOrdering: [
    'type',
    'name',
    'amount',
    'currency',
    'category',
    'account',
    'toAccount',
    'person',
    'direction',
    'transcript',
    'confidence_flags',
  ],
} as const;

export interface PromptContext {
  accounts: Account[];
  expenseCategories: Category[];
  incomeCategories: Category[];
  people: Person[];
  currencyCode: string;
}

function nameList(names: string[]): string {
  return names.length > 0 ? names.join(', ') : '(none yet)';
}

export function buildPrompt(ctx: PromptContext): string {
  return [
    'You convert a short spoken money note into ONE structured transaction for a personal expense tracker.',
    'Return ONLY JSON matching the provided schema — no prose, no markdown.',
    '',
    'Transaction types:',
    '- expense: money leaves an account; needs a category.',
    '- income: money enters an account; needs a category.',
    '- transfer: between two of the user\'s OWN accounts (account -> toAccount); no category, no person.',
    '- lending: money to/from a person. direction is one of: lend (user gave money out), lend_repayment_received (they paid the user back), borrow (user received money), borrow_repayment_made (user paid them back).',
    '',
    'Match names to the user\'s EXISTING entities below. Do NOT invent accounts or categories.',
    `Accounts: ${nameList(ctx.accounts.map((a) => a.name))}`,
    `Expense categories: ${nameList(ctx.expenseCategories.map((c) => c.name))}`,
    `Income categories: ${nameList(ctx.incomeCategories.map((c) => c.name))}`,
    `Known people: ${nameList(ctx.people.map((p) => p.name))}`,
    `Currency: ${ctx.currencyCode} (amount is a positive number in whole currency units as spoken, e.g. "two hundred rupees" -> 200).`,
    '',
    'Never refuse or ask a follow-up. Fill your best guess and add confidence_flags for anything uncertain, drawn ONLY from:',
    'unrecognized_name (a person not in the known list — keep the name exactly as heard),',
    'no_account_matched, low_confidence_amount, no_category_matched.',
    'transcript = what you heard, verbatim.',
    '',
    'Parse the following audio into that JSON.',
  ].join('\n');
}
