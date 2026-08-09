/**
 * Validation layer (technical-plan §5.4) — the LLM's output is UNTRUSTED.
 *
 * Pure function: takes the raw parsed JSON plus the current entity lists and
 * produces a VoiceDraft with real IDs, or an error if no valid transaction
 * can be formed. Never inserts an unmatched name as if it were valid; instead
 * it resolves against known entities, falls back sensibly, and attaches
 * confidence flags for the user to resolve in the queue (never blocks).
 */
import type { RawParsedTransaction } from '@/ai/prompt';
import type {
  Account,
  Category,
  ConfidenceFlag,
  LendingDirection,
  Person,
  TransactionType,
} from '@/domain/types';

const KNOWN_FLAGS: ReadonlySet<string> = new Set<ConfidenceFlag>([
  'unrecognized_name',
  'no_account_matched',
  'low_confidence_amount',
  'no_category_matched',
]);

const VALID_TYPES: ReadonlySet<string> = new Set<TransactionType>([
  'expense',
  'income',
  'transfer',
  'lending',
]);

const VALID_DIRECTIONS: ReadonlySet<string> = new Set<LendingDirection>([
  'lend',
  'lend_repayment_received',
  'borrow',
  'borrow_repayment_made',
]);

export interface VoiceContext {
  accounts: Account[];
  expenseCategories: Category[];
  incomeCategories: Category[];
  people: Person[];
}

export interface VoiceDraft {
  type: TransactionType;
  amountMinor: number;
  name: string;
  transcript?: string;
  confidenceFlags: ConfidenceFlag[];
  accountId: string;
  toAccountId?: string;
  categoryId?: string;
  personId?: string;
  direction?: LendingDirection;
  /** When set, the caller must create an unresolved Person and use its id. */
  unresolvedPersonName?: string;
}

export type ValidationResult =
  | { ok: true; draft: VoiceDraft }
  | { ok: false; reason: string };

function byName<T extends { name: string }>(items: T[], name: string | null): T | undefined {
  if (!name) return undefined;
  const needle = name.trim().toLowerCase();
  return items.find((item) => item.name.trim().toLowerCase() === needle);
}

export function buildVoiceDraft(
  raw: RawParsedTransaction,
  ctx: VoiceContext,
): ValidationResult {
  if (!raw || typeof raw !== 'object') return { ok: false, reason: 'Empty response.' };
  if (!VALID_TYPES.has(raw.type)) {
    return { ok: false, reason: `Unknown transaction type "${raw.type}".` };
  }
  const type = raw.type as TransactionType;

  // Amount → integer minor units. A non-positive/non-finite amount is not
  // recoverable (amount must be > 0), so this is one of the few hard failures.
  if (typeof raw.amount !== 'number' || !Number.isFinite(raw.amount) || raw.amount <= 0) {
    return { ok: false, reason: "Couldn't understand the amount." };
  }
  const amountMinor = Math.round(raw.amount * 100);
  if (amountMinor <= 0) return { ok: false, reason: "Couldn't understand the amount." };

  const flags = new Set<ConfidenceFlag>();
  for (const flag of Array.isArray(raw.confidence_flags) ? raw.confidence_flags : []) {
    if (KNOWN_FLAGS.has(flag)) flags.add(flag as ConfidenceFlag);
  }

  if (ctx.accounts.length === 0) {
    return { ok: false, reason: 'Add an account before logging by voice.' };
  }

  // Resolve the (from-)account; fall back to the first account and flag.
  const account = byName(ctx.accounts, raw.account) ?? ctx.accounts[0]!;
  if (!byName(ctx.accounts, raw.account)) flags.add('no_account_matched');

  const name = raw.name?.trim() || 'Voice entry';
  const transcript = raw.transcript?.trim() || undefined;

  const base: VoiceDraft = {
    type,
    amountMinor,
    name,
    transcript,
    confidenceFlags: [],
    accountId: account.id,
  };

  switch (type) {
    case 'expense':
    case 'income': {
      const categories = type === 'income' ? ctx.incomeCategories : ctx.expenseCategories;
      if (categories.length === 0) {
        return { ok: false, reason: `No ${type} categories exist.` };
      }
      const category = byName(categories, raw.category) ?? categories[0]!;
      if (!byName(categories, raw.category)) flags.add('no_category_matched');
      const personId = byName(ctx.people, raw.person)?.id;
      return {
        ok: true,
        draft: { ...base, categoryId: category.id, personId, confidenceFlags: [...flags] },
      };
    }

    case 'transfer': {
      if (ctx.accounts.length < 2) {
        return { ok: false, reason: 'Transfers need at least two accounts.' };
      }
      let to = byName(ctx.accounts, raw.toAccount);
      if (!to || to.id === account.id) {
        to = ctx.accounts.find((a) => a.id !== account.id)!;
        flags.add('no_account_matched');
      }
      return { ok: true, draft: { ...base, toAccountId: to.id, confidenceFlags: [...flags] } };
    }

    case 'lending': {
      const direction: LendingDirection = VALID_DIRECTIONS.has(raw.direction ?? '')
        ? (raw.direction as LendingDirection)
        : 'lend';
      const existing = byName(ctx.people, raw.person);
      if (existing) {
        return {
          ok: true,
          draft: { ...base, direction, personId: existing.id, confidenceFlags: [...flags] },
        };
      }
      // Unresolved name: keep it verbatim for the caller to create, and flag.
      const spokenName = raw.person?.trim();
      if (!spokenName) {
        return { ok: false, reason: 'Lending needs a person, but none was heard.' };
      }
      flags.add('unrecognized_name');
      return {
        ok: true,
        draft: {
          ...base,
          direction,
          unresolvedPersonName: spokenName,
          confidenceFlags: [...flags],
        },
      };
    }
  }
}
