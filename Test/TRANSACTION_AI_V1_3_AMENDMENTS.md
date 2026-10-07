# Kaasu — Transaction AI V1.3 Amendments

**Phase:** Post-implementation correction, driven by evidence.
**Date:** 2026-10-07
**Status:** Phases A, B and C implemented and unit-tested (`npm test` — 575
tests, was 484); live eval 27/27 on `gemini-3.5-flash-lite`; Phases A and B
verified on-device by the owner (2026-10-07). Phase C awaits its device check.
**Supersedes nothing.** V1, V1.1 and V1.2 stand.

**Evidence:** `Test/AI_TEST_CASE_LOG_v3.md` (TC-028 … TC-040).
**Owner decisions (2026-10-07):** D1 honour stated clock times, ask on a bare
hour · D2 ATM withdrawal = transfer to the account named "Cash" when unique ·
D3 "paid X on their behalf" = lending · D4 "X paid for me" = one queue item
committing the borrow + expense pair · D5 whole-balance repayment filled from
the approved balance, with confirmation · D6 build diagnostics.

---

## 0. What the third round showed

Every safety boundary held again: nothing was fabricated, no entity was
invented, nothing reached the ledger without the gate, and the one Critical
case (TC-034) was blocked by the gate rather than committed.

The failures were of four kinds, and only one of them is about the model:

| Kind | Cases | Layer |
|---|---|---|
| Information landed in the wrong field, or near-miss names | TC-029, TC-031 (account), TC-035 | validation / resolution |
| The same fact reported several times, or not shown where the user looks | TC-028, TC-031, TC-036 (UX), TC-038, TC-040 | validation / presentation |
| A capability the app did not have | TC-031 (amount), TC-033, TC-037 | application |
| The model's reading of the action | TC-030, TC-032, TC-034, TC-036, TC-039 | prompt / contract (Phase B) |

Phase A fixes the first three kinds deterministically, so they hold whatever
the model does.

---

## 1. Amendment V — Action-vs-label is app-owned *(TC-028, TC-036)*

**Observed.** TC-028 showed two near-identical "Please confirm" notes for one
contradiction. TC-036 showed "label it as fruits" / "label it as Sham's share"
raising an "Unresolved conflict" that named nothing in conflict.

**Root cause.** The model's own `action_vs_label` conflict objects were passed
straight through the whitelist, and the app added its own whenever
`requestedLabel` named a type — two reports of one fact (TC-028). And the model
used `action_vs_label` for any "label it as X" — a NAME, not a type (TC-036).

**Amendment.** Like grounding, the conflict is now decided by the app. It
exists only when the user asked for a *different transaction type* than the
action described — read from `requestedLabel`, or failing that from the type
words in the model's own conflict note. The model's conflict objects of this
kind are never passed through, so there is at most ONE per operation, and a
label that names no type raises nothing. Exact duplicate conflicts of any kind
collapse. TC-013 ("…but record it as income") is still flagged.

*Code:* `validate.ts` → `finalizeConflicts`, `otherTypeNamed`.

## 2. Amendment W — One problem, one message, on every screen *(TC-031, TC-040)*

- The gate no longer reports `amount_provenance_inferred` for a **null**
  amount (that is already `amount_not_grounded`), and `resolveUnqualified` no
  longer attaches a third "no amount was heard" conflict — the null amount is
  itself the blocker (V1.2 Amendment N said so; the extra conflict only
  repeated it).
- `issues.ts` → `describeIssues()` turns gate blockers into plain sentences —
  each distinct problem once, confirmations first, with what to do ("Pick an
  account.", "Add the amount.") and no "Unresolved conflict:" prefix.
- The voice **Logged** card now shows these issues (TC-040: it showed none),
  using the same function as the Home queue. Presentation only; the gate still
  alone decides approvability.

## 3. Amendment X — "To <account>" is the account for income and lending *(TC-029, TC-031, TC-035)*

For income and lending the user's account is where the money **landed** ("to
cash", "into BOC"), and the model puts that in `toAccount` — a field only
transfers read, so it was dropped. When `account` is empty and `toAccount`
names something, that reference is used. Stated accounts are never
overridden; expenses and transfers are untouched. Applies to candidates,
downgraded specialized operations, recurring, and unqualified intents.

## 4. Amendment Y — Generic words around an account name *(TC-029)*

`resolveAccountRef`: when exact matching finds nothing, retry — still exact —
with descriptive words removed progressively: possessives and "account"
first, then type words ("bank", "card", "wallet"). It resolves only on a
**unique** exact match, and only when every removed type word **agrees with
the account's real type** ("BOC card" can never become the BOC bank account).
"Commercial Bank account" stops at "Commercial Bank". Used at interpretation
and, through `refreshRef`, at commit — the two paths cannot disagree.

## 5. Amendment Z — One voiced intent, one queue item *(TC-038)*

The model can list one amountless intent in both `candidates` (null amount)
and `unqualifiedIntents`; both are read, so one sentence produced two
"Amount needed" cards. An unqualified intent is now suppressed when it repeats
a kept one, or a qualified candidate (same type and name, compatible entity
references). Different names survive. This is the TC-021 rule extended to the
amountless tier.

*Not fixable here:* the TC-038 transcript contained no number. If one was
spoken, it never reached the model — a capture issue, which Phase C's
diagnostics are meant to make visible.

## 6. Amendment AA — Dates carry a clock time *(TC-033, decision D1)*

Reverses the V1.2 convention that time-of-day words resolve to the day,
**for expressions that carry an hour**:

| Wording | Reading |
|---|---|
| yesterday around 10:00 in the evening | yesterday 22:00 |
| last night at 9 | yesterday 21:00 |
| today at 9:30 am · 2 days ago at 18:45 | as stated |
| at 10 pm (said in the morning, no day) | the most recent 22:00 (past-leaning) |
| yesterday at 10 | yesterday, **"morning or evening?"** blocking note |
| yesterday evening | yesterday, reference time kept — no hour invented |

A number is a time only with a cue (at/around, `:mm`, am/pm, a part of day),
so "15 August", "the 15th" and "3 days ago" are unchanged. The review screen
now compares and writes back to the minute (`yyyy-MM-ddTHH:mm`), so a
corrected time is kept and answers the morning-or-evening note.

## 7. Amendment AB — A bill split has a date *(TC-037)*

The split editor gains a **When** field. A voice-started split prefills it
from the stated date, resolved against the moment it was **spoken** (the same
rule as `toNewTransaction`); an un-understood or am/pm-ambiguous date raises
an alert instead of quietly using today.

## 8. Amendment AC — "All the money he owed me" *(TC-031, decision D5)*

Answers the owner's "AI asks the app" idea with a deterministic lookup rather
than a second model call: the model never sees a balance, and nothing new is
sent to the network.

When an amountless **lending repayment** carries a whole-balance phrase (closed
list: "all … owed", "everything I owe", "the full balance", "settled up in
full"), the person is resolved, the direction matches who owes whom, and the
approved balance is non-zero, the amount is filled from the **approved**
balance with a blocking `amount_by_reference` confirmation ("Amount taken from
Areej's approved balance: 5000. Confirm before approving."), naming any
pending lending rows not included — the Settle Up rule (P8). Partial phrases
("half of what he owes") stay "Amount needed". Editing the amount clears the
confirmation, as for every amount conflict.

---

## 8a. Device-check follow-ups (2026-10-07)

The owner's first on-device pass of Phase A found three gaps:

1. **"label it as fruits" still named "Strawberries".** The response schema
   describes `requestedLabel` as "a type the user asked for", so the label
   never reached the app. `validate.ts` → `userLabel()` now reads "label /
   name / call / title it (as) X" from the transcript itself and applies it
   as the name when the utterance yields exactly ONE operation (several →
   left to the Phase B prompt). A label that names a TYPE is never a name; it
   raises the action-vs-label conflict instead — now even when the model
   reported nothing. Instruction-like labels are never adopted.
2. **"Borrowed 300 from Nuski to cash" still had no account.** The model left
   the account out entirely (not even in `toAccount`). The resolver now
   recovers it from what the user said about THAT operation — its evidence
   spans, or the transcript clause naming its person or amount — when an
   account NAME follows "to / into / in" (and "from" for lending), and only
   when exactly one account matches. A reference the model did give is never
   overridden; expenses are untouched; a bare mention ("room rent") never
   counts. The unqualified-intent response schema also gained `direction` and
   `toAccount`, which it had been missing.
3. **Faraj's balance repayment** showed a false "1 needs an amount" pill and an
   unformatted figure. The pill now counts the live cards; the note reads
   "Faraj's approved balance is Rs1,250.00 — this settles it in full. Confirm
   the amount."; and items blocked ONLY by confirmations get a one-tap
   **Confirm & approve** on the Logged card and the Home queue
   (`confirmAndCommitPendingOperation`, still through the gate; never offered
   for a suspected injection). Lending cards now show their account chip.

## 9. Phase B — implemented (prompt / contract / critic)

Every rule below is in the prompt AND, where the risk is to the ledger, has a
deterministic backstop that holds when the model ignores the prompt — proven
by replaying the bad round-3 readings ("-bad" eval cases).

### AD — Notes *(TC-034, Critical)*
- **Contract:** `note` on ordinary candidates and unqualified intents (and the
  response schema); `ResolvedOperation.note` (optional — pre-V1.3 rows lack
  it) is saved as the transaction's **Note** (`description`). Notes get the
  injection check names get, capped at 200 chars.
- **Prompt:** a dictated note belongs to its transaction; numbers in it are not
  amounts (worked example #8).
- **Critic:** `shouldCritique` no longer counts numbers inside a dictated note,
  and the auditor is told notes are not missing sums — the most likely source
  of the spurious second transaction.
- **Backstop:** `userNote()` reads "add (an optional) note as …" / "note: …"
  from the transcript (a cue is required — "a note book" is not a note). An
  operation whose amount appears ONLY inside that note gets a blocking
  `note_not_transaction` conflict (new app-attached kind) — flagged, never
  silently dropped; the note is attached to the one real operation.

### AE — Labels are names *(TC-036, TC-028)*
`requestedLabel` is redefined (prompt + schema) as a transaction TYPE only;
"label / name / call it X" sets `name` (worked example #9, which also shows a
borrow's "to cash" in `account`). The app-side `userLabel()` (§8a) still
covers single-operation utterances whatever the model does.

### AF — On someone's behalf = lending *(TC-030, D3)*
Prompt rule + worked example #10. A gift/treat stays an expense.

### AG — Paid by someone else *(TC-039, D4)*
- **Contract:** `paidBy` (expense only; "me"/"I" means no payer).
- **Gate:** an unresolved/ambiguous payer blocks ("Pick who paid for it.").
- **Commit:** `toNewTransactions()` writes the **borrow + expense pair**
  atomically (`insertTransactionsAtomically`) — the bill-split Case B shape:
  net zero on the account, the spending on its date, the debt on the person.
  One queue item, so "one sum of money, one operation" and the critic hold.
- **Review screen:** a "Paid by" chip group with an "I paid" option.

### AH — Cash withdrawal = transfer *(TC-032, D2)*
- **Prompt:** withdrawal → transfer, destination the account named "Cash" when
  the list has exactly one (accounts are now listed with their type — names
  and type only, never ids or balances). Worked example #12.
- **Backstop 1:** a withdrawal transfer with no destination resolves it to the
  unique account named "Cash"; otherwise left for the user.
- **Backstop 2:** a withdrawal still typed as an EXPENSE gets a blocking
  `type_unconfirmed` question, so it can never inflate spending via
  "Approve now".

### One-tap confirmation is an allow-list
"Confirm & approve" (§8a) now only covers figure/day confirmations
(`amount_by_reference`, `amount_uncertain`, `amount_correction`,
`date_unresolved`). Anything asking whether the item should exist or what
type it is — injection, a note number, a withdrawal-as-expense, a type
contradiction — always goes to the review screen.

### Eval corpus
EV-16 … EV-27 (+ EV-19-bad, EV-21-bad): 32 cases offline, all green. The
scorer now passes the same spoken-scope context the app does.

### Live eval — REQUIRED before trusting the prompt change
`GEMINI_API_KEY=... npx jest liveEval` — the offline replay proves the app's
handling; only the live run proves the model now produces these readings.

### First live run — 2026-10-07, `gemini-3.5-flash-lite`
24/30 passed. None of the 6 failures was the model breaking a rule:

- **EV-19-bad, EV-21-bad, EV-11b** — backstop cases replaying a recorded BAD
  reading. Live, the model read them correctly (ATM → transfer to Cash; "200
  left" → the note; digits appended to "that amount"), so there was nothing to
  catch. Now `offlineOnly` — they stay in the offline replay.
- **EV-01, EV-11a/b** — the expectations were wrong: they wanted an account the
  user never stated (the income in "received 1000 from tutoring", the
  repayment in "received 2000 from Nuski"). The model correctly left it
  unresolved. Expectations now assert `account: null` (never invented).
- **EV-16 (TC-028)** — a real gap: told that labels are names, the model named
  the income "Rent Provision" and raised nothing. The app now raises the ONE
  type note itself when the user calls the transaction by a different type's
  noun ("name **the expense** as …" said of an income). EV-16b replays that
  live reading.

Also found: `gemini-2.5-flash` now answers **404** (retired). The app default
and the live-eval default are now `gemini-3.5-flash-lite`, and a 404 now says
"check the model name in Settings" with Google's own message.

### Second live run — 2026-10-07, `gemini-3.5-flash-lite`
**27/27 passed** (the four backstop cases run offline only). Phases A and B
are verified against the real model; on-device checks (§14) remain.

### Device round for Phase B — 2026-10-07
4 of 5 checks looked failed, but the screenshots lacked markers the current
code renders (the lending account chip; the "part of your note" warning on the
Rs200 card) — the phone was running an older embedded bundle, so Phase B had
not reached it. Replaying the transcripts through current code still showed two
real gaps, now fixed:

- **A label restated as a model conflict** ("Shamsiya is not a known entity"):
  any MODEL conflict whose note contains the user's label is dropped (app-owned
  type/injection conflicts never are), and with several operations the one the
  model attached it to is the one named.
- **"…spent 70 on lunch from it"**: `inheritFundingAccount()` gives an expense
  paid "from it / from the money I borrowed" the account of the money that came
  in earlier in the same sentence — only when that is exactly one account, and
  only when the expense's own clause says so. EV-28 covers it.

Re-checked on a fresh build: **all passed** (owner, 2026-10-07).

## 10. Phase C — implemented (diagnostics)

**Why:** three round-3 root causes (TC-029, TC-034, TC-038) could only be
inferred, because the evidence was discarded; and one device round was
misdiagnosed until a stale bundle was spotted. The record makes "why did it
read it like that?" a matter of looking.

- `src/ai/diagnostics.ts` (pure, tested): per capture — model, Gemini's
  transcript, the **critic outcome** (`not_needed` / `no_findings` /
  `applied` / `kept_original` / `repair_failed`) with its verified findings,
  every **validation adjustment** (`ValidatedInterpretation.issues`),
  Gemini's **raw answer** and any critic re-read (each capped at 30k chars),
  and what blocks each resulting item.
- **Migration 9** — `voice_jobs.diagnostics` (JSON). Not financial data. Only
  the latest **50** captures keep a record; older ones are cleared on each new
  parse.
- `ResolvedOperation.voiceJobId` (optional) links a queue item to its capture.
- **UI:** a **Why?** button on the Logged screen and "Why was it read like
  this?" on the review screen open `VoiceDiagnosticsSheet`; **Share** sends a
  plain-text report via the iOS share sheet.
- **Privacy:** never leaves the phone unless shared; no field can hold the API
  key; no balances.

*Tests:* `src/ai/diagnostics.test.ts` (7, incl. migration 9 on a real engine).

## 11. What did NOT change

The seven layers; the untrusted-output principle; app-recomputed grounding; no
ids from the model; no first-entity fallback (Amendment Y resolves only on a
unique exact match of the name the user said); the gate as the only route to
the ledger; the golden rule; integer minor units. Every new signal blocks
through the existing conflict/gate mechanism.

## 12. Tests

`src/ai/interpretation/v13.test.ts` — 62 tests (+ 14 eval-corpus cases), one block per amendment, each
named after its test case.

## 13. Device verification (Phase A)

Hot reload is enough — no native change.

1. **TC-028** — "Income of 6000 rupees to BOC bank account … name the expense
   as rent provision." → ONE "Please confirm" note, and **BOC pre-selected**.
2. **TC-036** — "Bought strawberries for 500 rupees on cash, label it as
   fruits." → no conflict at all.
3. **TC-035** — "borrowed 300 rupees from Nuski to cash and spent 270 on
   lunch…" → both items have Cash.
4. **TC-031** — "Areej settled up all the money that he owed me to my
   Commercial Bank." → Commercial Bank selected, amount = Areej's balance, one
   "Confirm" note. With no balance: a single "Add the amount."
5. **TC-033** — "…sugar yesterday around 10 in the evening" → yesterday 22:00,
   no prompt. "…yesterday at 10" → asks morning or evening.
6. **TC-037** — open Split a bill: a **When** field; a voice split said
   "yesterday" opens on yesterday.
7. **TC-038** — an amountless sentence → one "Amount needed" card.
8. **TC-040** — any blocked item shows the same reasons on the Logged card as
   in the Home queue.

## 14. Device verification (Phase B)

Hot reload is enough. Run the live eval first.

1. **TC-034** — "Transfer 5000 from Room to BOC, add a note as 200 left." →
   ONE transfer card with a "200 left" note chip; approving saves the Note.
2. **TC-030** — "I paid Sham's rent of 5000 using cash on behalf of him." →
   Lending · Lent out · Sham · Cash.
3. **TC-039** — "Sham paid 280 rupees for dinner for me." → one Dinner card
   with "Paid by Sham"; pick an account, approve → Sham's profile shows you
   owe him 280 and Reports shows a 280 Food expense.
4. **TC-032** — "Withdrew 500 from the BOC ATM." → Transfer BOC → Cash.
5. **TC-036 (several)** — "Borrowed 300 from Nuski to cash, label it as Sham's
   share, and spent 270 on lunch." → the borrow is named "Sham's Share", both
   on Cash.

## 15. Device verification (Phase C)

Reload is enough (migration 9 runs on launch; no native change).

1. Say anything → on the Logged screen tap **Why?** → the panel shows what was
   heard, each item and what blocks it, the critic line, the adjustments, and
   (on tap) Gemini's raw answer.
2. Open any new voice item from the queue → **Why was it read like this?**
   opens the same panel. Items logged before this update have no link.
3. Tap **Share** → the iOS share sheet offers the plain-text report.
