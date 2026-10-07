/**
 * What is stopping a pending operation from being approved, in plain words —
 * ONE description shared by every screen that shows the item (V1.3, TC-040).
 *
 * The gate reports blockers for the machine: several can describe the same
 * underlying fact (a missing amount used to read as three problems, TC-031),
 * and conflict blockers carry an "Unresolved conflict:" prefix that tells the
 * user nothing about what to do (TC-036). This turns that list into what a
 * person needs: each distinct problem once, most important first, saying what
 * to do about it. The Logged card, the Home queue and the review screen all
 * read this, so an item that has a problem shows it everywhere — and an item
 * that has none shows nothing anywhere.
 *
 * Presentation only. It never decides approvability: that stays with the gate.
 */
import type { Blocker, GateResult } from './gate';

export type IssueAction = 'confirm' | 'add' | 'pick' | 'editor';

export interface Issue {
  message: string;
  action: IssueAction;
}

/** Lower sorts first: things only the user can judge, then missing values. */
const ORDER: Record<IssueAction, number> = { confirm: 0, add: 1, pick: 2, editor: 3 };

function describe(b: Blocker): Issue {
  switch (b.code) {
    case 'unresolved_conflict':
      return { message: b.message.replace(/^Unresolved conflict:\s*/i, ''), action: 'confirm' };
    case 'amount_not_grounded':
      return { message: 'Add the amount.', action: 'add' };
    case 'amount_provenance_inferred':
      return { message: 'Check the amount — it was not clearly said.', action: 'confirm' };
    case 'account_unresolved':
      return { message: 'Pick an account.', action: 'pick' };
    case 'account_ambiguous':
      return { message: 'Pick which account was meant.', action: 'pick' };
    case 'to_account_unresolved':
      return { message: 'Pick the account the money went to.', action: 'pick' };
    case 'to_account_ambiguous':
      return { message: 'Pick which account the money went to.', action: 'pick' };
    case 'transfer_same_account':
      return { message: 'A transfer needs two different accounts.', action: 'pick' };
    case 'category_unresolved':
      return { message: 'Pick a category.', action: 'pick' };
    case 'category_ambiguous':
      return { message: 'Pick which category was meant.', action: 'pick' };
    case 'person_unresolved':
      return { message: 'Pick the person.', action: 'pick' };
    case 'person_ambiguous':
      return { message: 'Pick which person was meant.', action: 'pick' };
    case 'payer_unresolved':
      return { message: 'Pick who paid for it.', action: 'pick' };
    case 'payer_ambiguous':
      return { message: 'Pick which person paid for it.', action: 'pick' };
    case 'direction_unresolved':
      return { message: 'Choose lent, borrowed or repaid.', action: 'pick' };
    case 'needs_specialized_editor':
      return { message: b.message, action: 'editor' };
    case 'unsupported_operation':
      return { message: b.message, action: 'pick' };
  }
}

/**
 * Confirmations simple enough to give with one tap where the item is shown:
 * "is this figure right?" / "is this the right day?". An allow-list, on
 * purpose — anything asking whether the item should EXIST or what TYPE it is
 * (a suspected injection, a number from a note, a withdrawal typed as
 * spending, a type contradiction) always needs the full review screen.
 */
const INLINE_CONFIRMABLE = new Set(['amount_by_reference', 'amount_uncertain', 'amount_correction', 'date_unresolved']);

/**
 * True when the ONLY things in the way are such confirmations ("the amount
 * came from Faraj's balance — confirm"), so a one-tap "Confirm & approve" is
 * offered instead of a trip to the review screen.
 */
export function confirmableInline(gate: GateResult): boolean {
  if (gate.approvable || gate.blockers.length === 0) return false;
  return gate.blockers.every(
    (b) => b.code === 'unresolved_conflict' && b.detail !== undefined && INLINE_CONFIRMABLE.has(b.detail),
  );
}

export function describeIssues(gate: GateResult): Issue[] {
  const seen = new Set<string>();
  const out: Issue[] = [];
  for (const blocker of gate.blockers) {
    const issue = describe(blocker);
    if (seen.has(issue.message)) continue;
    seen.add(issue.message);
    out.push(issue);
  }
  return out.sort((a, b) => ORDER[a.action] - ORDER[b.action]);
}
