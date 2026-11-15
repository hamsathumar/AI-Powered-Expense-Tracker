/**
 * Application-owned entity resolution.
 *
 * Turns TEXTUAL references from a validated interpretation into real
 * application entity ids — or leaves them genuinely unresolved. There is NO
 * "?? first entity" fallback: an unmatched reference stays `unresolved`, and a
 * reference that matches more than one entity stays `ambiguous`. The AI never
 * supplies ids; only this layer does.
 *
 * Pure: callers inject the current entity lists, so it is unit-testable and
 * re-runnable at commit time (the final gate re-resolves against live data).
 */
import { formatAmount } from '@/domain/money';

import { isSuspiciousEntityReference } from './injection';
import { deriveName } from './naming';
import type {
  Conflict,
  EntityRef,
  LendingDirection,
  OrdinaryCandidate,
  OrdinaryKind,
  Provenance,
  ResolvedOperation,
  ResolvedRef,
  SpecializedOperation,
  UnqualifiedIntent,
  ValidatedInterpretation,
} from './types';

export interface EntityLite {
  id: string;
  name: string;
  /** Accounts only: 'bank' | 'card' | 'cash'. Lets a type word the user
   *  added ("BOC *bank* account") be checked against the real account. */
  kind?: string;
  /** Accounts only: a private account (migration 8). Never chosen by a
   *  default — its spending would vanish from personal reports. */
  isPrivate?: boolean;
}

/** A person's APPROVED lending balance (+ they owe the user), plus how many
 *  of their lending rows are still pending — exactly what Settle Up shows. */
export interface PersonBalance {
  netMinor: number;
  pendingCount: number;
}

export interface ResolveContext {
  accounts: EntityLite[];
  expenseCategories: EntityLite[];
  incomeCategories: EntityLite[];
  people: EntityLite[];
  /** Optional: enables filling "all the money he owed me" (TC-031). */
  personBalances?: Map<string, PersonBalance>;
}

function matchPool(reference: string, pool: EntityLite[]): EntityLite[] {
  const needle = reference.trim().toLowerCase();
  return pool.filter((e) => e.name.trim().toLowerCase() === needle);
}

// ── Near-match suggestions (audit F10) ───────────────────────────────────
/** Fold to comparable letters/digits: "Commercial Bank" → "commercialbank". */
function fold(s: string): string {
  return s.trim().toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}

/** Levenshtein distance, bailing out once it exceeds `max`. */
export function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const value = Math.min(prev[j]! + 1, row[j - 1]! + 1, prev[j - 1]! + cost);
      row.push(value);
      if (value < best) best = value;
    }
    if (best > max) return max + 1;
    prev = row;
  }
  return prev[b.length]!;
}

/** How far two labels of this length may differ and still be "the same name". */
function tolerance(length: number): number {
  if (length <= 3) return 0;
  if (length <= 6) return 1;
  return 2;
}

/**
 * Names close enough to what was heard to be worth OFFERING. Speech
 * recognition mangles proper nouns constantly ("Nuski" → "Nusky"), and an
 * exact-match-only resolver turns every such miss into a manual hunt.
 *
 * These are SUGGESTIONS, never resolutions — the caller marks them
 * `ambiguous`, which the final gate refuses to commit. The user still picks.
 */
export function nearMatches(reference: string, pool: EntityLite[]): EntityLite[] {
  const needle = fold(reference);
  if (needle.length < 3) return []; // too short to guess safely
  const scored: { entity: EntityLite; score: number }[] = [];
  for (const entity of pool) {
    const candidate = fold(entity.name);
    if (candidate.length === 0) continue;
    if (candidate === needle) {
      scored.push({ entity, score: 0 });
      continue;
    }
    // One name contained in the other ("bank" → "Commercial Bank"). The
    // shorter side must be a real word's worth of characters, so a stray
    // fragment cannot match half the list.
    const shorter = Math.min(candidate.length, needle.length);
    if (shorter >= 4 && (candidate.includes(needle) || needle.includes(candidate))) {
      scored.push({ entity, score: candidate.startsWith(needle) || needle.startsWith(candidate) ? 1 : 2 });
      continue;
    }
    const limit = tolerance(Math.min(candidate.length, needle.length));
    if (limit === 0) continue;
    const distance = editDistance(needle, candidate, limit);
    if (distance <= limit) scored.push({ entity, score: 2 + distance });
  }
  return scored
    .sort((a, b) => a.score - b.score || a.entity.name.localeCompare(b.entity.name))
    .slice(0, 4)
    .map((s) => s.entity);
}

/**
 * Resolve one reference against a pool. Never guesses; never picks the first.
 *
 * A reference that matches exactly one entity resolves. Anything else —
 * several exact matches, or only near-matches — stays UNRESOLVED/AMBIGUOUS
 * with the possibilities attached, so the user chooses and the gate keeps
 * blocking until they do.
 */
export function resolveRef(ref: EntityRef | null, pool: EntityLite[]): ResolvedRef | null {
  if (!ref) return null;
  if (!ref.reference) {
    return { reference: null, id: null, status: 'unresolved', options: [] };
  }
  const matches = matchPool(ref.reference, pool);
  if (matches.length === 1) {
    return { reference: ref.reference, id: matches[0]!.id, status: 'resolved', options: [] };
  }
  if (matches.length > 1) {
    return {
      reference: ref.reference,
      id: null,
      status: 'ambiguous',
      options: matches.map((m) => ({ id: m.id, name: m.name })),
    };
  }
  // No exact match: offer near-matches for confirmation (audit F10).
  const near = nearMatches(ref.reference, pool);
  if (near.length > 0) {
    return {
      reference: ref.reference,
      id: null,
      status: 'ambiguous',
      options: near.map((m) => ({ id: m.id, name: m.name })),
    };
  }
  return { reference: ref.reference, id: null, status: 'unresolved', options: [] };
}

// ── V1.3 (TC-029): generic words around an account name ─────────────────
/** Words that describe what an account IS rather than naming it. "account"
 *  fits any account; the rest must agree with the account's real type, so
 *  "BOC card" can never resolve to a BOC *bank* account. */
const GENERIC_ACCOUNT_WORDS: { pattern: RegExp; kinds: string[] | null }[] = [
  { pattern: /\b(?:savings\s+|current\s+)?(?:account|acct|a\/c)\b|^\s*(?:my|the|our)\s+/gi, kinds: null },
  { pattern: /\bbank\b/gi, kinds: ['bank'] },
  { pattern: /\b(?:credit\s+|debit\s+)?card\b/gi, kinds: ['card'] },
  { pattern: /\b(?:wallet|in\s+hand)\b/gi, kinds: ['cash'] },
];

/**
 * Resolve an ACCOUNT reference. Exact matching runs first and is unchanged.
 * Only when it finds nothing does a second, still-exact pass retry with the
 * generic words removed — "BOC bank account" → "BOC" — and that pass resolves
 * ONLY when:
 *  - the stripped name matches exactly ONE account, and
 *  - every type word removed agrees with that account's type.
 * Otherwise the ordinary result (near-match suggestions or unresolved) stands.
 * No guessing is added: the user said the account's name; the extra words
 * merely described it.
 */
export function resolveAccountRef(ref: EntityRef | null, pool: EntityLite[]): ResolvedRef | null {
  const first = resolveRef(ref, pool);
  if (!first || first.status === 'resolved' || !ref?.reference) return first;
  if (first.status === 'ambiguous' && matchPool(ref.reference, pool).length > 1) return first;

  // Strip progressively — "Commercial Bank account" must stop at
  // "Commercial Bank" (whose own name contains "Bank"), while "BOC bank
  // account" goes on to "BOC". The first step that matches exactly ONE
  // account, with every removed type word agreeing, wins.
  let stripped = ref.reference;
  const removedKinds: (string[] | null)[] = [];
  for (const { pattern, kinds } of GENERIC_ACCOUNT_WORDS) {
    const next = stripped.replace(pattern, ' ').replace(/\s+/g, ' ').trim();
    if (next === stripped.replace(/\s+/g, ' ').trim()) continue;
    removedKinds.push(kinds);
    stripped = next;
    if (stripped.length === 0) return first;
    const matches = matchPool(stripped, pool);
    if (matches.length > 1) return first;
    if (matches.length === 0) continue;
    const account = matches[0]!;
    const typeAgrees = removedKinds.every(
      (k) => k === null || (account.kind !== undefined && k.includes(account.kind)),
    );
    if (!typeAgrees) return first;
    // The account's real name labels it from here on ("BOC", not "BOC bank
    // account") — the descriptive words added nothing.
    return { reference: account.name, id: account.id, status: 'resolved', options: [] };
  }
  return first;
}

// ── V1.3 (TC-031): "all the money he owed me" ───────────────────────────
/** A closed list of phrases that mean "the person's whole balance". Like the
 *  anaphoric-amount list, deliberately narrow: "half of what he owes" or "some
 *  of it" is NOT here and stays "Amount needed". */
const WHOLE_BALANCE =
  /\b(?:all|everything|whatever)\b[^.]{0,30}\b(?:owed?|owing|borrowed|lent|due)\b|\b(?:full|whole|entire|complete|total)\s+(?:balance|amount|debt|dues?)\b|\bsettled?\s+(?:up\s+)?(?:in\s+full|everything|completely|fully)\b|\bsettled?\s+up\s+all\b/i;

export function isWholeBalanceExpression(text: string | null): boolean {
  return !!text && WHOLE_BALANCE.test(text);
}

/**
 * Fill a repayment's amount from the person's APPROVED balance when the user
 * referred to the whole balance instead of a figure. Returns null unless every
 * piece lines up: a resolved person, a repayment direction that matches who
 * owes whom, and a non-zero balance in that direction. The result always
 * carries a BLOCKING confirmation — the app supplied the figure, the user must
 * agree to it (editing the amount clears it, like any amount conflict).
 */
function fillFromBalance(
  intent: UnqualifiedIntent,
  person: ResolvedRef | null,
  ctx: ResolveContext,
  spoken: string[] = [],
): { amountMinor: number; conflict: Conflict } | null {
  if (intent.operation !== 'lending' || !person?.id || !ctx.personBalances) return null;
  // V1.4 (TC-041): the model may leave the whole-balance words out of the
  // amount and evidence; the sentences naming this person count too.
  const said = [intent.amount.expression, ...intent.evidence.map((e) => e.sourceText), ...spoken];
  if (!said.some(isWholeBalanceExpression)) return null;
  const balance = ctx.personBalances.get(person.id);
  if (!balance) return null;
  let amountMinor = 0;
  if (intent.direction === 'lend_repayment_received' && balance.netMinor > 0) amountMinor = balance.netMinor;
  if (intent.direction === 'borrow_repayment_made' && balance.netMinor < 0) amountMinor = -balance.netMinor;
  if (amountMinor <= 0) return null;

  const name = person.options[0]?.name ?? intent.person?.reference ?? 'them';
  const figure = formatAmount(amountMinor);
  const pending =
    balance.pendingCount > 0
      ? ` ${balance.pendingCount} pending lending item${balance.pendingCount === 1 ? '' : 's'} with ${name} ${balance.pendingCount === 1 ? 'is' : 'are'} not included.`
      : '';
  return {
    amountMinor,
    conflict: {
      kind: 'amount_by_reference',
      note: `${name}'s approved balance is ${figure} — this settles it in full.${pending} Confirm the amount.`,
    },
  };
}

// ── V1.3: the account the user SAID, when the model left it out ─────────
/**
 * What the user said about THIS operation: its own evidence spans, plus the
 * clauses of the transcript that mention its person or its amount. When the
 * utterance holds only one operation, the whole transcript is its scope.
 * Clauses split at "and", "then" and punctuation, so in "borrowed 300 from
 * Nuski to cash and spent 270 on lunch" the borrow sees only its own half.
 */
export interface SpokenScope {
  transcript: string;
  /** True when the utterance produced exactly one operation. */
  soleOperation: boolean;
}

function scopeTexts(
  scope: SpokenScope | undefined,
  evidence: { sourceText: string }[],
  anchors: (string | null | undefined)[],
): string[] {
  const texts = evidence.map((e) => e.sourceText);
  if (!scope?.transcript) return texts;
  if (scope.soleOperation) return [...texts, scope.transcript];
  const marks = anchors.filter((a): a is string => !!a && a.trim().length >= 2).map((a) => a.toLowerCase());
  if (marks.length === 0) return texts;
  const clauses = scope.transcript.split(/[,;.!?]|\band\b|\bthen\b/i);
  return [...texts, ...clauses.filter((c) => marks.some((m) => c.toLowerCase().includes(m)))];
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * TC-035 backstop: the model sometimes leaves an income/lending account out
 * even though the user said it ("borrowed 300 from Nuski TO CASH"). The app
 * looks for an account NAME right after a money-movement word in what the user
 * said about this operation, and adopts it only when exactly ONE account is
 * named that way. A bare mention never counts ("paid room rent" does not mean
 * the Room account) — only "to/into/in" (and "from" for lending, where money
 * can leave the account) followed by the name.
 */
function accountFromWords(
  operation: OrdinaryKind,
  texts: string[],
  accounts: EntityLite[],
): EntityLite | null {
  if (operation !== 'income' && operation !== 'lending') return null;
  const cue = operation === 'lending' ? '(?:to|into|in|from)' : '(?:to|into|in)';
  const found = new Set<EntityLite>();
  for (const account of accounts) {
    const pattern = new RegExp(
      `\\b${cue}\\s+(?:my\\s+|the\\s+|our\\s+)?${escapeRegex(account.name.trim())}(?![\\p{L}\\p{N}])`,
      'iu',
    );
    if (texts.some((t) => pattern.test(t))) found.add(account);
  }
  return found.size === 1 ? [...found][0]! : null;
}

/** Adopt a spoken account when the model gave none at all. A reference the
 *  model DID give (even an unresolved one) is never overridden. */
function withSpokenAccount(
  resolved: ResolvedRef | null,
  operation: OrdinaryKind,
  texts: string[],
  accounts: EntityLite[],
): ResolvedRef | null {
  if (resolved && (resolved.status === 'resolved' || resolved.reference)) return resolved;
  const spoken = accountFromWords(operation, texts, accounts);
  if (!spoken) return resolved;
  return { reference: spoken.name, id: spoken.id, status: 'resolved', options: [] };
}

// ── V1.3 (TC-032, decision D2): where withdrawn cash goes ───────────────
const WITHDRAWAL_WORDS = /\b(withdr[ae]w[ns]?|withdrawals?|withdrawing|atm)\b/i;

/**
 * A transfer the user described as a cash withdrawal, whose destination the
 * model left empty, goes to the account literally named "Cash" — only when
 * exactly one account has that name. Otherwise the destination stays for the
 * user to pick. Never overrides a destination the model did give.
 */
function withCashDestination(
  resolved: ResolvedRef | null,
  texts: string[],
  accounts: EntityLite[],
): ResolvedRef | null {
  if (resolved && (resolved.status === 'resolved' || resolved.reference)) return resolved;
  if (!texts.some((t) => WITHDRAWAL_WORDS.test(t))) return resolved;
  const cash = accounts.filter((a) => a.name.trim().toLowerCase() === 'cash');
  if (cash.length !== 1) return resolved;
  return { reference: cash[0]!.name, id: cash[0]!.id, status: 'resolved', options: [] };
}

// ── V1.3 (device round): "spent 70 on lunch FROM IT" ──────────────────────
/** "from it", "from that", "from the money I borrowed / got", "from what I
 *  received" — the spend was paid out of money that came in earlier in the
 *  SAME sentence. A closed list; nothing vaguer counts. */
const FROM_THAT_MONEY =
  /\bfrom\s+(?:it|that|this|(?:the|that)\s+(?:same\s+)?(?:money|cash|amount)(?:\s+(?:i|that\s+i)\s+(?:borrowed|got|received|took))?|the\s+borrowed\s+(?:money|cash|amount)|what\s+i\s+(?:borrowed|got|received))\b/i;

/**
 * An expense the user paid "from it" / "from the money I borrowed" takes the
 * account of the money that came in earlier in the same utterance — but only
 * when that is ONE resolved account. Anything else is left for the user to
 * pick. Applied after every operation is resolved, because it reads a
 * sibling's account.
 *
 * Money in: income, a borrow, a repayment received — and (V1.4, TC-047) the
 * DESTINATION of a transfer: "withdrew 4000 from BOC. From that amount I lent
 * Hafsa 1500" means the loan came out of Cash.
 *
 * Money out: an expense — and (TC-047) money the user lends or repays.
 *
 * Which ones it covers: an operation whose own clause says "from it" (found by
 * its amount), or — TC-047 — any operation in a sentence that OPENS with the
 * phrase before its amount ("From that amount I lent Hafsa 1500 and lent
 * Nuski 500 …"), since the phrase governs the whole sentence. A stated
 * account is never overridden.
 */
export function inheritFundingAccount(ops: ResolvedOperation[], transcript: string): ResolvedOperation[] {
  if (!transcript || !FROM_THAT_MONEY.test(transcript)) return ops;
  const resolvedKey = (r: ResolvedRef | null | undefined) =>
    r?.status === 'resolved' && r.id ? `${r.id}\u0000${r.reference ?? ''}` : null;
  const funding = new Set(
    ops
      .map((o) => {
        if (o.operation === 'income') return resolvedKey(o.account);
        if (o.operation === 'lending' && (o.direction === 'borrow' || o.direction === 'lend_repayment_received')) {
          return resolvedKey(o.account);
        }
        if (o.operation === 'transfer') return resolvedKey(o.toAccount);
        return null;
      })
      .filter((k): k is string => k !== null),
  );
  if (funding.size !== 1) return ops;
  const [id, reference] = [...funding][0]!.split('\u0000') as [string, string];
  const clauses = transcript.split(/[,;.!?]|\band\b|\bthen\b/i);
  const sentences = transcript.split(/[.;!?]+/);
  const spendsMoney = (o: ResolvedOperation) =>
    o.operation === 'expense' ||
    (o.operation === 'lending' && (o.direction === 'lend' || o.direction === 'borrow_repayment_made'));
  return ops.map((o) => {
    if (!spendsMoney(o) || o.amountMinor === null) return o;
    if (o.account && (o.account.status === 'resolved' || o.account.reference)) return o;
    const amount = new RegExp(`(^|\\D)${Math.round(o.amountMinor / 100)}(\\D|$)`);
    const inOwnClause = clauses.some((c) => amount.test(c) && FROM_THAT_MONEY.test(c));
    const inLedSentence = sentences.some((sentence) => {
      const phrase = sentence.match(FROM_THAT_MONEY);
      const figure = sentence.match(amount);
      return (
        phrase?.index !== undefined &&
        figure?.index !== undefined &&
        phrase.index < figure.index &&
        // The phrase opens the sentence ("From that amount I …"), so it
        // governs everything after it — not a "from it" at the tail of
        // someone else's clause.
        /^\s*(?:and\s+|then\s+|so\s+)?$/i.test(sentence.slice(0, phrase.index))
      );
    });
    if (!inOwnClause && !inLedSentence) return o;
    return { ...o, account: { reference: reference || null, id, status: 'resolved', options: [] } };
  });
}

// ── V1.4 (TC-041): the person the user NAMED, when the model left it out ──
/** Whole-name mentions of saved people in `text`. A name inside a longer
 *  matched name ("Mowlavi" inside "Mayees Mowlavi") is not a second person. */
function peopleNamedIn(text: string, people: EntityLite[]): EntityLite[] {
  if (!text) return [];
  const found = people.filter((p) => {
    const name = p.name.trim();
    if (name.length < 2) return false;
    return new RegExp(`(?:^|[^\\p{L}\\p{N}])${escapeRegex(name)}(?![\\p{L}\\p{N}])`, 'iu').test(text);
  });
  return found.filter(
    (p) =>
      !found.some(
        (q) => q !== p && q.name.length > p.name.length && q.name.toLowerCase().includes(p.name.toLowerCase()),
      ),
  );
}

/** Sentences of the transcript that name `name` (split at . ; ! ?). */
function sentencesMentioning(transcript: string, name: string): string[] {
  if (!transcript || !name) return [];
  const needle = name.toLowerCase();
  return transcript.split(/[.;!?]+/).filter((s) => s.toLowerCase().includes(needle));
}

/**
 * A lending operation's person, recovered from the model's own words when it
 * gave none — TC-041: "Settlement from Nuski" carried the name in its title
 * and evidence, but `person` was empty, so "all they owe me" could not be
 * filled from Nuski's balance.
 *
 * Only a SAVED person counts, found by whole name in the operation's name
 * (or, failing that, in its evidence when that names exactly one person).
 * It resolves outright only when the user really said that name; a name that
 * appears only in the model's text is offered as a suggestion the user must
 * confirm. A reference the model DID give is never overridden.
 */
export function recoverPerson(
  ref: EntityRef | null,
  name: string,
  evidence: { sourceText: string }[],
  transcript: string,
  people: EntityLite[],
): ResolvedRef | null {
  const resolved = resolveRef(ref, people);
  if (ref?.reference) return resolved;
  const fromName = peopleNamedIn(name, people);
  const pick =
    fromName.length === 1 ? fromName : peopleNamedIn(evidence.map((e) => e.sourceText).join('\n'), people);
  if (pick.length !== 1) return resolved;
  const person = pick[0]!;
  if (peopleNamedIn(transcript, [person]).length === 1) {
    return { reference: person.name, id: person.id, status: 'resolved', options: [] };
  }
  return { reference: person.name, id: null, status: 'ambiguous', options: [{ id: person.id, name: person.name }] };
}

// ── V1.4 (TC-042): "Nuski and Mayees settled all they owe me" ────────────
const REPAY_VERB = /\b(?:settled?|settling|repaid|repays?|paid\s+(?:me\s+)?back|pays?\s+(?:me\s+)?back|gave\s+(?:me\s+)?back|returned|cleared)\b/i;
const OWED_TO_ME = /\b(?:owe[sd]?|owing)\s+me\b|\b(?:paid|gave|pays?)\s+me\s+back\b|\brepaid\s+me\b/i;
const OWED_BY_ME =
  /\b(?:i|we)\s+(?:still\s+)?(?:owed?|owing)\b|\b(?:i|we)\s+(?:have\s+|had\s+)?(?:settled|repaid|paid\s+back|cleared|returned)\b/i;
/** Where a name part stops being a name: "Sham in cash" → "Sham". */
const NAME_TAIL = /\s+\b(?:in|into|to|from|via|using|with|by|through|on|at|for|all|everything|today|yesterday)\b.*$/i;
const NAME_LEAD = /^(?:(?:both|also|and|my|our|friends?)\s+)+/i;
const NOT_A_NAME = /^(?:i|me|we|us|he|she|they|them|him|her|it|my|our|the|a|an|all|everything|both|someone|somebody)$/i;

function repaymentDirection(text: string): LendingDirection | null {
  const toMe = OWED_TO_ME.test(text);
  const byMe = OWED_BY_ME.test(text);
  if (toMe === byMe) return null;
  return toMe ? 'lend_repayment_received' : 'borrow_repayment_made';
}

function cleanNamePart(part: string): string | null {
  const text = part.replace(NAME_TAIL, '').replace(NAME_LEAD, '').trim();
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0 || words.length > 3) return null;
  if (!words.every((w) => /^[\p{L}'’.-]+$/u.test(w) && !NOT_A_NAME.test(w))) return null;
  if (isSuspiciousEntityReference(text)) return null;
  return text;
}

/**
 * The people a whole-balance repayment sentence names: the run of names right
 * before the repayment verb ("… and Nuski and Mayees Mowlavi settled …") when
 * they repaid the user, or right after "owe / to" when the user repaid them.
 * Every name is kept — a mis-heard one becomes a "Pick the person" card,
 * never a silent drop.
 */
function namesInRepayment(sentence: string, direction: LendingDirection): string[] {
  const split = (t: string) => t.split(/\s*(?:,|&|\band\b|\bplus\b)\s*/i);
  if (direction === 'lend_repayment_received') {
    const verb = sentence.match(REPAY_VERB);
    if (!verb || verb.index === undefined) return [];
    const parts = split(sentence.slice(0, verb.index));
    const names: string[] = [];
    for (let i = parts.length - 1; i >= 0; i--) {
      const name = cleanNamePart(parts[i]!);
      if (!name) break;
      names.unshift(name);
    }
    return names;
  }
  const cues = [...sentence.matchAll(/\b(?:owed?|owing|to|repaid|paid\s+back|settled\s+(?:up\s+)?with)\b/gi)];
  const last = cues[cues.length - 1];
  if (!last || last.index === undefined) return [];
  const names: string[] = [];
  for (const part of split(sentence.slice(last.index + last[0].length))) {
    const name = cleanNamePart(part);
    if (!name) break;
    names.push(name);
  }
  return names;
}

/**
 * TC-042: the model merged "Nuski and Mayees Mowlavi settled all the amounts
 * they owe me" into ONE amountless income with no person. When an amountless
 * income / lending / unknown intent (with no person of its own) carries
 * whole-balance repayment wording, and its sentence names at least one SAVED
 * person exactly, it becomes one repayment per person named — each then
 * filled from that person's approved balance with the usual blocking
 * confirmation (D5), or left "Amount needed".
 *
 * Only amountless intents are touched, so no spoken sum can be counted twice
 * (TC-021); the direction must be stated ("owe me" / "I owe"), never guessed.
 */
function expandGroupRepayment(
  intent: UnqualifiedIntent,
  scope: SpokenScope,
  ctx: ResolveContext,
): UnqualifiedIntent[] | null {
  if (intent.operation === 'transfer' || intent.operation === 'expense') return null;
  if (intent.operation === 'lending') {
    if (intent.person?.reference) return null;
    if (intent.direction === 'lend' || intent.direction === 'borrow') return null;
    // Its own name already says who (TC-041) — that is the person, not a group.
    if (recoverPerson(null, intent.name, intent.evidence, scope.transcript, ctx.people)?.reference) return null;
  }
  const own = intent.evidence.map((e) => e.sourceText.trim().toLowerCase()).filter((t) => t.length >= 8);
  const sentences = scope.transcript
    .split(/[.;!?]+/)
    .map((s) => s.trim())
    .filter((s) => s && isWholeBalanceExpression(s) && REPAY_VERB.test(s))
    .filter((s) => scope.soleOperation || own.some((t) => s.toLowerCase().includes(t.slice(0, 15))));
  if (sentences.length !== 1) return null;
  const sentence = sentences[0]!;
  const direction =
    intent.operation === 'lending' && intent.direction ? intent.direction : repaymentDirection(sentence);
  if (!direction) return null;
  const heard = namesInRepayment(sentence, direction);
  const exact = heard.map((h) => ctx.people.find((p) => p.name.trim().toLowerCase() === h.toLowerCase()));
  if (!exact.some(Boolean)) return null;
  return heard.map((h, i) => {
    const reference = exact[i]?.name ?? h;
    return {
      ...intent,
      localId: `${intent.localId}-p${i + 1}`,
      operation: 'lending',
      direction,
      person: { reference, provenance: 'USER_EXPLICIT', state: 'KNOWN', candidates: [] },
      category: null,
      name: deriveName({ operation: 'lending', personReference: reference, direction }),
      evidence: [{ sourceText: sentence, supports: 'whole-balance repayment by a person named here' }, ...intent.evidence],
    };
  });
}

// ── V1.4 (TC-046): "…and Nuski paid it" ──────────────────────────────────
function payerPattern(name: string): RegExp {
  const n = escapeRegex(name.trim());
  const end = String.raw`(?=\s*(?:$|[,.;!?]|\s(?:and|but|so|too|as\s+well|yesterday|today)\b))`;
  const what = String.raw`(?:\s+(?:for\s+)?(?:it|that|this|the\s+(?:bill|amount|whole\s+thing)|everything|for\s+(?:me|us)|on\s+my\s+behalf))?`;
  return new RegExp(
    String.raw`(?:^|[^\p{L}\p{N}])${n}\s+(?:has\s+|had\s+|already\s+)?paid${what}${end}` +
      String.raw`|(?:^|[^\p{L}\p{N}])${n}\s+paid\b[^,.;!?]{0,60}\bfor\s+(?:me|us)\b` +
      String.raw`|\bpaid\s+by\s+${n}(?![\p{L}\p{N}])`,
    'iu',
  );
}

/**
 * TC-046: an expense whose sentence says a SAVED person paid it ("snacks for
 * 160 and Nuski paid it", "paid by Nuski") but where the model gave no
 * `paidBy`. The name must precede "paid" (so "I paid Nuski" never counts) and
 * nothing may follow it but the thing paid for — "Nuski paid me back" is a
 * repayment, not this. Skipped when the model already recorded a borrow from
 * that person for the same amount, which would double the debt.
 */
function payerFromWords(
  cand: OrdinaryCandidate,
  scope: SpokenScope,
  people: EntityLite[],
  siblings: OrdinaryCandidate[],
): EntityRef | null {
  if (cand.operation !== 'expense' || cand.paidBy?.reference || cand.amount.valueMinor === null) return null;
  const digits = String(Math.round(cand.amount.valueMinor / 100));
  const sentences = scope.transcript
    .split(/[.;!?]+/)
    .filter((s) => scope.soleOperation || new RegExp(`(^|\\D)${digits}(\\D|$)`).test(s));
  const payers = peopleNamedIn(sentences.join('. '), people).filter((p) =>
    sentences.some((s) => payerPattern(p.name).test(s)),
  );
  if (payers.length !== 1) return null;
  const payer = payers[0]!;
  // One of several payers ("Sham and Nuski paid it") is not Nuski alone.
  const together = people.some(
    (q) =>
      q !== payer &&
      new RegExp(`${escapeRegex(q.name.trim())}\\s*(?:,|&|\\band\\b)\\s*${escapeRegex(payer.name.trim())}\\s+paid`, 'iu').test(
        sentences.join('. '),
      ),
  );
  if (together) return null;
  const doubled = siblings.some(
    (o) =>
      o.operation === 'lending' &&
      o.direction === 'borrow' &&
      o.amount.valueMinor === cand.amount.valueMinor &&
      o.person?.reference?.trim().toLowerCase() === payer.name.toLowerCase(),
  );
  if (doubled) return null;
  return { reference: payer.name, provenance: 'USER_EXPLICIT', state: 'KNOWN', candidates: [] };
}

/**
 * The account that hosts a paid-by-someone-else pair (owner decision
 * 2026-11-15, TC-046). The borrow + expense pair nets to zero on whichever
 * account holds it, so the user should not have to pick one: the account
 * literally named "Cash" is used when there is exactly one and it is not
 * private. Otherwise the user picks, as before.
 */
export function pairHostAccount(accounts: EntityLite[]): EntityLite | null {
  const cash = accounts.filter((a) => a.name.trim().toLowerCase() === 'cash');
  if (cash.length !== 1 || cash[0]!.isPrivate) return null;
  return cash[0]!;
}

function withPairHost(resolved: ResolvedRef | null, accounts: EntityLite[]): ResolvedRef | null {
  if (resolved && (resolved.status === 'resolved' || resolved.reference)) return resolved;
  const host = pairHostAccount(accounts);
  if (!host) return resolved;
  return { reference: host.name, id: host.id, status: 'resolved', options: [] };
}

function categoryPool(op: OrdinaryCandidate['operation'], ctx: ResolveContext): EntityLite[] {
  return op === 'income' ? ctx.incomeCategories : ctx.expenseCategories;
}

/**
 * An intent the user voiced but whose amount could not be grounded (audit F3).
 *
 * V1 discarded these after validation: only a count survived, so a real intent
 * carrying a correct account, category, person and date became unrecoverable —
 * strictness turned into silent data loss. They now enter the queue as
 * ordinary pending rows with a NULL amount, which the user fills in on the
 * review screen.
 *
 * Nothing is invented to make that possible. The amount stays null (the gate
 * refuses it), and when the model named no recognisable operation, the assumed
 * type carries a blocking `type_unconfirmed` conflict rather than passing
 * itself off as understood.
 */
export function resolveUnqualified(
  intent: UnqualifiedIntent,
  ctx: ResolveContext,
  scope?: SpokenScope,
): ResolvedOperation {
  const operation: OrdinaryKind = intent.operation === 'unknown' ? 'expense' : intent.operation;
  const known = intent.operation !== 'unknown';
  const isExpInc = operation === 'expense' || operation === 'income';

  // The null amount is itself the blocker (the gate reports it once, as
  // "No amount yet"). V1.2 also attached an amount conflict here, which made a
  // single missing figure read as three separate problems (TC-031).
  const conflicts: Conflict[] = [];
  if (!known) {
    conflicts.push({
      kind: 'type_unconfirmed',
      note: 'The type was not clear from what you said; it is assumed to be an expense. Confirm or change it.',
    });
  }

  const transcript = scope?.transcript ?? '';
  const person =
    operation === 'lending'
      ? recoverPerson(intent.person, intent.name, intent.evidence, transcript, ctx.people)
      : resolveRef(intent.person, ctx.people);
  const personName = person?.id ? ctx.people.find((p) => p.id === person.id)?.name : undefined;
  const fromBalance = fillFromBalance(
    intent,
    person && personName ? { ...person, options: [{ id: person.id!, name: personName }] } : person,
    ctx,
    personName ? sentencesMentioning(transcript, personName) : [],
  );
  if (fromBalance) conflicts.unshift(fromBalance.conflict);

  return {
    localId: intent.localId,
    kind: operation,
    operation,
    // Genuinely not known — never defaulted. The one exception is a whole-
    // balance repayment, filled from the app's own ledger with a confirmation.
    amountMinor: fromBalance?.amountMinor ?? null,
    amountProvenance: fromBalance ? 'AI_INTERPRETED' : 'UNRESOLVED',
    account: withSpokenAccount(
      resolveAccountRef(intent.account, ctx.accounts),
      operation,
      scopeTexts(scope, intent.evidence, [intent.person?.reference, intent.amount.expression]),
      ctx.accounts,
    ),
    toAccount: null,
    category: isExpInc ? resolveRef(intent.category, categoryPool(operation, ctx)) : null,
    person,
    direction: intent.direction,
    requestedLabel: null,
    dateExpression: intent.date.expression,
    name: intent.name,
    note: intent.note,
    paidBy: null,
    conflicts,
    transcript: '',
    specialized: null,
  };
}

export function resolveCandidate(
  cand: OrdinaryCandidate,
  ctx: ResolveContext,
  scope?: SpokenScope,
): ResolvedOperation {
  const isExpInc = cand.operation === 'expense' || cand.operation === 'income';
  const paidBy = cand.operation === 'expense' ? resolveRef(cand.paidBy, ctx.people) : null;
  const spokenAccount = withSpokenAccount(
    resolveAccountRef(cand.account, ctx.accounts),
    cand.operation,
    scopeTexts(scope, cand.evidence, [
      cand.person?.reference,
      cand.amount.expression?.replace(/\D+/g, '') || cand.amount.expression,
    ]),
    ctx.accounts,
  );
  return {
    localId: cand.localId,
    kind: cand.operation,
    operation: cand.operation,
    amountMinor: cand.amount.valueMinor,
    amountProvenance: cand.amount.provenance,
    account: paidBy ? withPairHost(spokenAccount, ctx.accounts) : spokenAccount,
    toAccount:
      cand.operation === 'transfer'
        ? withCashDestination(
            resolveAccountRef(cand.toAccount, ctx.accounts),
            [cand.name, ...scopeTexts(scope, cand.evidence, [cand.amount.expression?.replace(/\D+/g, '') || null])],
            ctx.accounts,
          )
        : null,
    category: isExpInc ? resolveRef(cand.category, categoryPool(cand.operation, ctx)) : null,
    person:
      cand.operation === 'lending'
        ? recoverPerson(cand.person, cand.name, cand.evidence, scope?.transcript ?? '', ctx.people)
        : resolveRef(cand.person, ctx.people),
    direction: cand.direction,
    requestedLabel: cand.requestedLabel,
    dateExpression: cand.date.expression,
    name: cand.name,
    note: cand.note,
    paidBy,
    conflicts: cand.conflicts,
    transcript: '',
    specialized: null,
  };
}

/**
 * Specialized operations (Bill Split / Recurring) resolve their scalar refs
 * but are kept as a `specialized` payload for the dedicated editors — they are
 * NOT committed through the ordinary path (the gate blocks that).
 */
export function resolveSpecialized(op: SpecializedOperation, ctx: ResolveContext): ResolvedOperation {
  const base =
    op.kind === 'bill_split' ? op.total.valueMinor : op.base.valueMinor;
  const provenance: Provenance =
    op.kind === 'bill_split' ? op.total.provenance : op.base.provenance;
  const operation = op.operation;
  const isExpInc = operation === 'expense' || operation === 'income';
  const direction: LendingDirection | null =
    op.kind === 'recurring' ? op.direction : null;
  return {
    localId: op.localId,
    kind: op.kind,
    operation,
    amountMinor: base ?? 0,
    amountProvenance: provenance,
    account: resolveAccountRef(op.account, ctx.accounts),
    toAccount:
      op.kind === 'recurring' && operation === 'transfer'
        ? resolveAccountRef(op.toAccount, ctx.accounts)
        : null,
    category: isExpInc ? resolveRef(op.category, categoryPool(operation, ctx)) : null,
    person: op.kind === 'recurring' ? resolveRef(op.person, ctx.people) : null,
    direction,
    requestedLabel: null,
    dateExpression: op.kind === 'recurring' ? op.anchorDate.expression : op.date.expression,
    name: op.name,
    conflicts: op.conflicts,
    transcript: '',
    specialized: op,
  };
}

/**
 * Resolve a whole validated interpretation — the ONE path both the app
 * (`interpretVoice`) and the eval harness (`score.ts`) use, so a replay
 * reaches exactly the end state the app would (V1.4). Returns the operations
 * plus what the app adjusted, for the diagnostics.
 */
export function resolveInterpretation(
  validated: ValidatedInterpretation,
  ctx: ResolveContext,
): { operations: ResolvedOperation[]; issues: string[] } {
  const issues: string[] = [];
  const transcript = validated.transcript;
  const count =
    validated.candidates.length + validated.specializedOperations.length + validated.unqualifiedIntents.length;
  const scope: SpokenScope = { transcript, soleOperation: count === 1 };

  // TC-046: who paid, from the user's words. Never alongside a bill split,
  // which records its own payer.
  const hasSplit = validated.specializedOperations.some((s) => s.kind === 'bill_split');
  const candidates = validated.candidates.map((c) => {
    const payer = hasSplit ? null : payerFromWords(c, scope, ctx.people, validated.candidates);
    if (!payer) return c;
    issues.push(`"${payer.reference}" paid for it, taken from what the user said`);
    return { ...c, paidBy: payer };
  });

  // TC-042: one merged whole-balance repayment → one per person named.
  const intents = validated.unqualifiedIntents.flatMap((u) => {
    const expanded = expandGroupRepayment(u, scope, ctx);
    if (!expanded) return [u];
    issues.push(`one repayment by ${expanded.length} people read as one per person`);
    return expanded;
  });

  const fromIntents = intents.map((u) => {
    const op = resolveUnqualified(u, ctx, scope);
    if (op.operation === 'lending' && !u.person?.reference && op.person?.reference) {
      issues.push(`person "${op.person.reference}" taken from the name the user said`);
    }
    return op;
  });
  // Several readings of the same person's whole-balance repayment (the model
  // split it AND the app expanded it) are one repayment.
  const seen = new Set<string>();
  const uniqueIntents = fromIntents.filter((op) => {
    if (op.operation !== 'lending' || !op.person?.reference) return true;
    if (op.direction !== 'lend_repayment_received' && op.direction !== 'borrow_repayment_made') return true;
    const key = `${op.direction}|${op.person.id ?? op.person.reference.trim().toLowerCase()}`;
    if (seen.has(key)) {
      issues.push(`dropped a second repayment card for "${op.person.reference}"`);
      return false;
    }
    seen.add(key);
    return true;
  });

  const operations = inheritFundingAccount(
    [
      ...candidates.map((c) => resolveCandidate(c, ctx, scope)),
      ...validated.specializedOperations.map((s) => resolveSpecialized(s, ctx)),
      ...uniqueIntents,
    ],
    transcript,
  ).map((o) => ({ ...o, transcript }));
  return { operations, issues };
}
