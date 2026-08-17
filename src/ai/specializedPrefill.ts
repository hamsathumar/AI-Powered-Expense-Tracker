/**
 * Deterministic, application-owned prefill adapters for the specialized-editor
 * handoff (Transaction AI V1).
 *
 * They map a validated + resolved `ResolvedOperation` (whose `.specialized`
 * payload holds the BillSplitOperation / RecurringOperation) into the input
 * models the EXISTING dedicated editors consume — never passing raw Gemini
 * output, never inventing ids, never defaulting an unresolved entity. An
 * entity that did not resolve is left null so the editor can require the user
 * to pick it; participant names the AI heard but that are not in People are
 * surfaced (not auto-created) for the user to add.
 *
 * Pure and unit-testable.
 */
import { resolveDateExpression } from '@/ai/interpretation/dates';
import type { ResolvedOperation } from '@/ai/interpretation/types';
import { formatMinorUnits } from '@/domain/money';
import type { RecurringFrequency, RecurringTemplate } from '@/domain/types';

export const ME = 'me';

interface PersonLite {
  id: string;
  name: string;
}

const isMe = (s: string) => /^(me|myself|i|my|mine|us)$/i.test(s.trim());

function amountToInputText(amountMinor: number): string {
  return formatMinorUnits(amountMinor).replace(/,/g, '');
}

export interface BillSplitPrefill {
  name: string;
  amountText: string;
  accountId: string | null;
  categoryId: string | null;
  /** Editor participant ids: always includes ME, plus resolved person ids. */
  participantIds: string[];
  /** ME or a resolved person id. */
  payerId: string;
  /** Names the AI heard that are NOT in People yet — user adds them (never auto-created). */
  unresolvedNames: string[];
}

export function buildBillSplitPrefill(op: ResolvedOperation, people: PersonLite[]): BillSplitPrefill {
  const bs = op.specialized && op.specialized.kind === 'bill_split' ? op.specialized : null;
  const findPerson = (name: string) =>
    people.find((p) => p.name.trim().toLowerCase() === name.trim().toLowerCase());

  const participantIds = new Set<string>([ME]); // the user is always in their own split
  const unresolved: string[] = [];

  if (bs) {
    for (const ref of bs.participants) {
      const name = ref.reference?.trim();
      if (!name) continue;
      if (isMe(name)) {
        participantIds.add(ME);
        continue;
      }
      const match = findPerson(name);
      if (match) participantIds.add(match.id);
      else unresolved.push(name);
    }
  }

  let payerId = ME;
  const payerRef = bs?.payer?.reference?.trim();
  if (payerRef && !isMe(payerRef)) {
    const match = findPerson(payerRef);
    if (match && participantIds.has(match.id)) payerId = match.id;
  }

  return {
    name: op.name,
    amountText: amountToInputText(op.amountMinor),
    accountId: op.account?.status === 'resolved' ? op.account.id : null,
    categoryId: op.category?.status === 'resolved' ? op.category.id : null,
    participantIds: [...participantIds],
    payerId,
    unresolvedNames: [...new Set(unresolved)],
  };
}

/** The existing recurring editor has no "yearly"; map unknowns to its default. */
function mapFrequency(hint: string | undefined): RecurringFrequency {
  return hint === 'weekly' || hint === 'daily' || hint === 'monthly' ? hint : 'monthly';
}

/**
 * Build a synthetic `RecurringTemplate` used ONLY as `initial` prefill for the
 * existing `RecurringForm`. The form always constructs a fresh
 * `NewRecurringTemplate` on save, so the placeholder id/createdAt here are
 * never persisted.
 */
export function buildRecurringInitial(op: ResolvedOperation, now: Date): RecurringTemplate {
  const rec = op.specialized && op.specialized.kind === 'recurring' ? op.specialized : null;
  const anchor = resolveDateExpression(rec?.anchorDate.expression ?? null, now);
  const resolvedId = (r: ResolvedOperation['account']) => (r?.status === 'resolved' ? (r.id ?? undefined) : undefined);

  return {
    id: 'ai-prefill',
    type: op.operation,
    name: op.name,
    amountMinor: op.amountMinor,
    accountId: resolvedId(op.account),
    toAccountId: resolvedId(op.toAccount),
    categoryId: resolvedId(op.category),
    personId: resolvedId(op.person),
    direction: op.direction ?? undefined,
    frequency: mapFrequency(rec?.intervalHint),
    intervalDays: undefined,
    nextDueDate: anchor.iso.slice(0, 10), // 'yyyy-MM-dd'
    endDate: undefined,
    status: 'active',
    pausedUntil: undefined,
    recurringGroup: 'other',
    totalInstallments: undefined,
    principalMinor: undefined,
    active: true,
    createdAt: now.toISOString(),
  };
}
