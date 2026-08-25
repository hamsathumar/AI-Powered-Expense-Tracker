# Kaasu — Transaction AI V1.2 Amendments (Audit Phase 1)

**Phase:** Post-audit correction.
**Date:** 2026-08-25
**Status:** Implemented and unit-tested (`npm test` — 335 tests, was 318).
**Supersedes nothing.** V1 and the V1.1 amendments stand; this document records
the changes made after the full pipeline audit of 2026-08-25.

**Evidence:** `Test/AI_PIPELINE_AUDIT_2026-08-25.md` (findings F1–F11).
Unlike V1.1, the driver here was not a device-test round but a full read of the
pipeline code against the owner's day-to-day experience — most importantly the
reported failure: *"I received 2,000 … I transferred that amount …" recorded
only the income and silently rejected the transfer.*

**Amends:**
- `Test/TRANSACTION_AI_CONSTITUTION_V1.md` — grounding (§7), date conduct (§10)
- `Test/TRANSACTION_AI_ARCHITECTURE_V1.md` — validation layer (§9), date architecture (§17)
- `Test/TRANSACTION_AI_TECHNICAL_CONTRACT_V1.md` — Amount contract, ConflictKind set

**Phasing:** this document covers **all three phases** of the audit's plan —
Phase 1 in §1–6, Phase 2 in §7–10, Phase 3 in §11–14. The audit is closed.

---

## 1. Amendment H — Grounding by reference *(audit F1, the "that amount" bug)*

### Observed
"I received 2,000 from a person that owes me, and I transferred that amount
from this account to this account" produced only the income. The transfer was
recognised as a transaction but demoted to an unqualified intent and dropped,
because "that amount" carries no digits.

### Root cause
Two gaps acting together. The prompt gave the model no rule for
within-utterance amount references, so what it put in `expression` was luck.
And `computeGrounded()` required the expression itself to encode a magnitude —
correct as an anti-fabrication rule, but unable to distinguish "the model
invented 2000" from "the model correctly carried 2000 forward from three words
earlier".

### Amendment
**An amount may be grounded by reference.** An ungrounded amount is promoted
when ALL of:

1. its expression is clearly anaphoric ("that amount", "the same amount",
   "the full amount", "அதே தொகை" …) — a closed list, nothing fuzzy;
2. the model carried a concrete positive value for it; and
3. that value **exactly matches another grounded amount in the same
   utterance** — a deterministic cross-check, so nothing is invented.

A promoted amount always carries a **blocking `amount_by_reference` conflict**:
the user must confirm the link before the gate will commit. No-invention (§13)
is intact — the promotion can only ever reproduce a number the user actually
said elsewhere in the same sentence.

### Implementation
- `validate.ts` — `isAnaphoricAmountExpression()`, `groundByReference()`, and a
  pre-scan pool of every grounded amount in the utterance. Applied to ordinary
  candidates, bill-split totals, and recurring base amounts (including the
  downgrade paths, which carry the conflict through).
- `interpretPrompt.ts` — REFERENCED AMOUNTS rule: copy the referenced value,
  provenance `AI_INTERPRETED`, append the digits to the expression, add an
  evidence span. The backstop exists for when the model ignores this.
- A promoted bill-split total also feeds the TC-021 dedup, so "spent 900 …
  split that amount" still yields exactly one queue item.
- New `ConflictKind`: `amount_by_reference` (app-attached; never accepted from
  the model — `toConflicts` still whitelists only the model-supplied kinds).

*Tests:* `audit.test.ts` → "Audit F1" (6).

---

## 2. Amendment I — Grounding is not English-only *(audit F2)*

### Observed (risk, not incident)
The owner speaks Tamil / Tamil-English mix. `MAGNITUDE_WORDS` knew "lakh" and
"crore" but no Tamil number words. Tamil inputs had worked only because Gemini
happens to normalise amounts to digits — luck, not design. Had the model
written the expression as spoken ("rendayiram", "ரெண்டாயிரம்"), the amount
would have failed grounding and the transaction silently dropped.

### Amendment
- **Prompt:** whenever `value` is set and the spoken words are not digits, the
  numeric form must be appended inside `expression` — e.g. `"rendayiram
  (2000)"`, `"ஆயிரம் (1000)"`. This makes grounding language-independent at the
  source. A general rule now also states the user may speak English, Tamil, or
  a mix, and entity references still match the listed entity names.
- **Backstop:** `expressionSupportsAmount()` additionally accepts romanised
  Tamil number words (whole-word units, plus **stem** matches for compounded
  magnitudes — "rendayiram" contains no standalone word), Tamil-script stems
  (compounds fuse the initial vowel: ரெண்டாயிரம் carries யிர, not ஆயிரம்), and
  Tamil numeral digits (௦–௯).

*Known limitation, recorded deliberately:* the injection markers and the
suspicious-entity heuristic remain English-only. The structural boundary
(system-instruction vs. audio) and the deterministic gate do not depend on
detection, so this is a flagging gap, not a safety hole. Revisit with the
Phase 3 multilingual test set.

*Tests:* `audit.test.ts` → "Audit F2" (3).

---

## 3. Amendment J — An un-understood date must not commit silently *(audit F4, first half)*

### Observed
`resolveDateExpression()` supports a narrow grammar. For anything else ("last
month", "on the 15th") it returns `resolved: false` — which `toNewTransaction()`
ignored, silently stamping the capture day. The resolver's own docstring
promised "the caller can surface it"; no caller did. TC-004's shape surviving
in miniature.

### Amendment
Validation now checks every **ordinary candidate's** date expression against
the same app-owned resolver. A stated-but-unresolvable expression attaches a
**blocking `date_unresolved` conflict**: approving is impossible until the user
explicitly confirms (which records the capture day, now knowingly) or rejects.

Scope decision: ordinary candidates only. Specialized operations open their
dedicated editors, where the concrete date is visible and editable before
anything is saved — the silence is already broken there.

The **grammar extension** (weeks/months ago, day-of-month, month names) and a
date picker on the review screen are Phase 2 work; this amendment only removes
the silence.

*Tests:* `audit.test.ts` → "Audit F4" (3).

---

## 4. Amendment K — An ambiguous amount must be confirmed *(audit F6)*

### Observed
The contract carries `Amount.state`, but `ResolvedOperation` drops it — so the
V1-era behaviour the first test round praised (TC-011/TC-019: "500 or maybe
5000" got a low-confidence flag) had lost its channel to the queue. An
ambiguous-but-grounded amount looked exactly as confident as a clean one.

### Amendment
A grounded amount whose state is `AMBIGUOUS` now attaches a **blocking
`amount_uncertain` conflict** ("check the figure against the transcript"),
using the same confirm mechanism as injection and reference-grounding.
Coverage follows risk, as R11 required.

*Tests:* `audit.test.ts` → "Audit F6" (2).

---

## 5. Amendment L — A yearly schedule never falls back silently *(audit F7)*

### Observed
`mapFrequency()` maps a `yearly` hint to `'monthly'` because the recurring
editor has no yearly option — an "annual insurance payment" prefilled as a
*monthly* template with no warning. The TC-025 failure shape (stated intent
silently replaced by a default) recurring in a new spot.

### Amendment
`recurringFrequencyNote()` (in `specializedPrefill.ts`) surfaces an explicit
alert in the recurring editor — merged with the existing TC-025 end-date note
under one "Check the schedule" alert — whenever the stated cadence could not be
represented. Full yearly support in the editor remains open (candidate for
Phase 2/3).

*Tests:* covered by existing prefill suite; the note function is trivially
pure. Device check: say "yearly subscription…" and confirm the alert appears.

---

## 6. Amendment M — Hygiene *(audit F11)*

- **API key moved from the URL query string to the `x-goog-api-key` header**
  (`geminiInterpret.ts`). URLs leak into request logs and proxies; headers
  don't.
- **Bulk approve** now loads the entity context once per run instead of once
  per row (`commitOperation.ts` → `commitRecord`). Committing never mutates
  entities, so one context is valid for the whole batch.
- **Month-end edge** in `resolveRecurrenceEnd`'s "until <month>" branch: the
  day is set to 1 *before* the month, so a day-31 anchor can no longer
  overflow into the following month ("until February" from Jan 31 now ends
  28 Feb, not 3 Mar). A stated day earlier in the anchor month now correctly
  rolls to next year instead of ending before the anchor.
- **Documented non-persistence** of the optional person *tag* on
  expense/income in `toTransaction.ts` (the schema has no such column; the
  drop is intentional).
- **Explicitly NOT changed:** the on-device live transcript (pipeline B) — the
  owner confirmed on 2026-08-25 it is a deliberate display-only feature.
  Audit finding F9 is **declined**, permanently.

*Tests:* `dates.test.ts` → "month-end anchors" (3).

---

# Phase 2 — every rejection becomes recoverable

Phase 1 stopped validation from rejecting things it should have accepted.
Phase 2 addresses the other half of the audit's central finding: **what
validation does reject must be visible and completable, not silently gone.**

---

## 7. Amendment N — An unqualified intent enters the queue *(audit F3)*

### Observed
When validation demoted an intent to `UnqualifiedIntent` — the amount could not
be grounded — the whole object was discarded. Only a count survived
(`voice_jobs.unqualified_count`), shown as a small pill: *"2 heard without an
amount — not logged."* The account, category, person and date the user actually
supplied went with it. Nothing could be seen or completed.

This is what turned every strictness decision (including F1's and F2's, before
they were fixed) into silent data loss, and it is the main reason the pipeline
*felt* less accurate than it measured.

### Root cause
Not a bug — a **V1 design assumption**. The contract stated the guarantee as
`entersQueue: false`, and the architecture treated "not committable" and "not
worth keeping" as the same thing. They are not: the Approval Queue holds items
that *cannot yet be committed* by definition.

### Amendment
**An unqualified intent is queued, and cannot be committed.** The enduring
guarantee is the second half, and it is enforced where it belongs — on the
amount, at the gate — not by throwing the intent away.

- **Contract:** `ResolvedOperation.amountMinor` becomes `number | null`. `null`
  is a genuine "not known yet" and is never defaulted to `0`.
  `UnqualifiedIntent.entersQueue: false` is replaced by `committable: false`,
  and the intent gains an app-owned `name` so it reads properly in the queue.
- **Constitution:** preserving what the user said now extends past
  interpretation into the queue — the intent keeps its resolved account,
  category, person and date expression.
- **Architecture:** the gate is the sole arbiter of committability. A null
  amount blocks with `amount_not_grounded`; nothing else changed about the
  boundary.

### Implementation
- **Migration 6** rebuilds `pending_operations` to drop `CHECK (amount > 0)`
  (SQLite cannot drop a CHECK in place). Zero and negative are still refused;
  only NULL is newly allowed.
- `resolve.ts` → `resolveUnqualified()` — builds the queue row, attaching a
  blocking conflict explaining the missing amount. When the model named no
  recognisable operation, the assumed type (`expense`) carries a separate
  blocking `type_unconfirmed` conflict rather than passing itself off as
  understood.
- `interpretVoice.ts` queues unqualified intents alongside candidates.
- `ConfirmCard` / `VoiceReviewSection` render **"Amount needed"** — never a
  fabricated `Rs 0.00`.
- `voiceJobRunner.summarise()` tells the user in the notification: *"…2 still
  need an amount."*
- Voice-screen copy updated: the old "not logged" pill now reads *"N needs an
  amount before it counts."*

*Tests:* `audit2.test.ts` → "Audit F3" (5) + `migration6.test.ts` (6).

---

## 8. Amendment O — The review screen can complete a transaction *(audit F5)*

### Observed
The review screen resolved entities only. If Gemini heard Rs 900 instead of
Rs 990, or the date came out wrong, the only recourse was Reject and re-enter
the whole thing by hand — for a voice-first app, the worst possible ending to a
near-miss, and the blocker that made Amendment N useless on its own.

### Amendment
The review screen edits **amount, name and date** as well as entities.

- The amount uses the app's existing `AmountInput`; a figure the user types is
  recorded with provenance `USER_EXPLICIT` — the strongest grounding there is.
- The date uses the existing `DateTimeField`, seeded by resolving the
  operation's expression against its **capture** time (the same reference the
  commit path uses), and writes back an ISO day. The original wording stays
  visible as *"You said 'yesterday'"*.
- The gate runs on the **edited** operation, so the Approve button always
  reflects what would actually be committed.
- Editing a field **is** the confirmation its conflict was asking for, so
  `amount_uncertain` / `amount_by_reference` clear when the amount is edited,
  and `date_unresolved` clears when the date is set. Every other conflict still
  requires an explicit "Keep as-is".

*Tests:* `audit2.test.ts` → "Audit F3" (the approvable-after-edit case) — the
edits are plain field changes on a `ResolvedOperation`, so they are verified at
the gate rather than through the UI.

---

## 9. Amendment P — The date grammar covers how people actually speak *(audit F4, second half)*

Phase 1 stopped an un-understood date from committing silently. Phase 2 reduces
how often that happens. `resolveDateExpression` now also resolves:

| Wording | Reading |
|---|---|
| `3 days ago`, `two weeks ago`, `a month ago` | counted back from the reference |
| `last week` / `last month` / `last year` | one period back |
| `15 August`, `August 15`, `3rd of August 2025` | that calendar date |
| `2026-08-01` | ISO (also what the review screen's picker writes) |
| `the 15th`, `on the 3rd` | that day of the month |
| `this morning`, `tonight`, `just now` | the reference day |
| `last night`, `yesterday night` | the day before |

Two judgement calls, documented because they are conventions rather than facts:

1. **Past-leaning.** A bare calendar date or day-of-month that has not yet
   happened is read as the most recent one that *has* ("25 December" in August
   means last December). Spoken money notes describe what already happened.
2. **Time-of-day words resolve to the DAY.** Kaasu has no clock-time capture
   (Architecture §26 leaves it open), so "this morning" must not invent an
   hour. It resolves to the reference day, except where the phrase plainly
   means yesterday.

Month arithmetic sets day-1 before changing the month throughout, so a day-31
reference can never overflow ("a month ago" from 31 March is 28 February).
Genuinely unsupported wording still returns `resolved: false` and blocks via
Amendment J.

*Tests:* `audit2.test.ts` → "Audit F4" (9).

---

## 10. Amendment Q — Near-matched names are offered, never applied *(audit F10)*

### Observed
Entity resolution was exact-match only. Speech recognition mangles proper nouns
constantly ("Nuski" → "Nusky"), and every miss became a manual hunt through the
chip list — with no hint about what was actually heard.

### Amendment
`resolveRef` now falls back to **near matches** when nothing matches exactly:
identical after folding to letters/digits, one name contained in the other (the
shorter side at least 4 characters), or within a length-scaled Levenshtein
tolerance (0 / 1 / 2 for short / medium / long names). At most four are offered.

**The safety property is that this never resolves anything.** A near match
returns `status: 'ambiguous'` with the possibilities attached — which the final
gate refuses to commit — so the user still picks, exactly as before. What
changes is that the review screen can now say *"Heard 'Nusky' — did you mean
Nuski?"* instead of leaving them to guess what went wrong.

`commitOperation.refreshRef` was refactored to call the same `resolveRef`, so
the queue and the commit path can never disagree about what a name means.

*Tests:* `audit2.test.ts` → "Audit F10" (6, incl. "does not guess between
genuinely unrelated names" and "an ambiguous suggestion still blocks approval").

---

# Phase 3 — raising the understanding ceiling

Phases 1 and 2 fixed what the app did with the model's reading. Phase 3 is
about the reading itself: giving the model worked examples instead of prose
alone, constraining the shape of what comes back, auditing compound utterances
for money that went missing, and — the part that outlasts all of it — making
prompt changes *measurable* instead of judged by whichever sentence came to
mind.

---

## 11. Amendment R — The prompt shows, not just tells *(audit F8a)*

The system instruction described the contract in prose and gave **no worked
examples**, so every call re-derived the whole thing from rules. Seven
input→output pairs now sit at the end of the instruction, each targeting a
failure this project actually observed:

| # | Shows | Defends |
|---|---|---|
| 1 | two spends in one breath, emitted separately | R1 (TC-001, TC-020) |
| 2 | "that amount" carrying the earlier number, digits appended | audit F1 |
| 3 | Tamil/code-switched speech with digits in `expression` | audit F2 |
| 4 | a split as ONE operation, with no duplicate ordinary candidate | TC-003, TC-021 |
| 5 | an injected instruction recorded as data, never obeyed | TC-022, TC-026 |
| 6 | rambling narration: one real transaction + one amountless intent | audit F3 |
| 7 | a bounded recurrence whose end is wording, never a computed date | TC-025 |

The examples are illustrative about entities and say so — the real account,
category and people lists still come from the context block above them.

---

## 12. Amendment S — The response shape is declared, not hoped for *(audit F8b)*

The request asked only for `responseMimeType: application/json`. That left two
avoidable failures: a response that will not parse (the user has to retry), and
— worse because it is silent — plausible JSON with the wrong field names, which
validation reads as "the model said nothing here" and drops.

`src/ai/interpretSchema.ts` now declares the full contract as a Gemini
`responseSchema`, and temperature drops from 0.2 to **0** (interpretation is
extraction, not composition — the same words should give the same reading).

Three deliberate choices:

- **`required` is kept small.** Forcing a field the utterance does not support
  is how models start inventing; an absent optional entity reference is the
  right answer far more often than a guessed one.
- **Bill Split and Recurring share one object**, because the schema language
  has no discriminated unions. `operationKind` selects which fields apply and
  validation still enforces the real per-kind rules.
- **A schema rejection degrades, it does not break.** If the API rejects the
  schema — an older model, an unsupported keyword — `callGemini` retries once
  *without* it, so voice capture falls back to exactly its previous behaviour.
  This mattered because the schema could not be verified against the live API
  from here.

**This constrains the container, never the contents.** A schema-shaped response
is not a trusted one: grounding, injection checks, dedup and the gate all run
exactly as before.

---

## 13. Amendment T — Compound utterances are audited *(audit F8d)*

### The gap
R1 was the one requirement the audit left unmet. When a single breath carries
several transactions, the model sometimes merges two or drops one — and nothing
downstream can catch it, because validation only ever sees what the model chose
to emit. The queue looks perfectly reasonable, just short.

### Amendment
A second pass reads the transcript beside the first interpretation and answers
one narrow question: **is every sum of money mentioned accounted for exactly
once?** If it reports something, the utterance is interpreted again with that
critique attached, and the better of the two readings is kept.

`src/ai/critic.ts`. Four properties keep this from becoming a hallucination
loop — the well-known failure mode of self-correction:

1. **It only runs when it might help.** `shouldCritique` fires when more sums
   were spoken than readings produced, or on a long (30+ word) utterance. An
   ordinary short note never reaches the network here, so the common case still
   costs exactly one call.
2. **The auditor may only point at money, never assert a transaction.** Its
   whole output is "missing" and "duplicated" lists.
3. **`verifyCritique` discards any claim whose amount does not literally appear
   in the transcript** — deterministic and app-owned, so the critic cannot
   conjure money the user never said.
4. **The repair is trusted no more than the original.** It goes through the
   same validation and the same gate; a fabricated transaction in it still
   fails grounding and lands as an un-approvable "Amount needed" card
   (Amendment N), which is visible and rejectable rather than silent.

`chooseInterpretation` keeps the repair only when it moved the way the critique
called for — more operations when money was missing, fewer when it was
double-counted. A repair that changed nothing, drifted the wrong way, errored,
or timed out leaves the original reading untouched.

*Tests:* `critic.test.ts` (21) — the containment cases matter most.

---

## 14. Amendment U — Prompt changes are measurable *(audit F8c)*

### The gap
Every prompt change until now was judged by re-testing a few utterances by hand
on the phone. That is slow enough that most changes were never really measured:
a fix for one failure could quietly undo another, and the only evidence was
whether the next spoken sentence happened to work.

### Amendment
`src/ai/eval/` — a corpus of utterances with the end state each must produce,
scored by one pure scorer, runnable two ways:

- **Offline** (`eval.test.ts`, part of `npm test`) replays each case's
  **recorded model response** through validate → resolve → gate. It answers
  *"given this reading, does the app still reach the right end state?"* — the
  half of accuracy the app controls. Hermetic: no key, no network, no
  flakiness.
- **Live** (`liveEval.test.ts`, skipped without a key) sends the **utterance**
  to Gemini and scores whatever comes back, which is how a prompt, model or
  schema change gets measured against the whole corpus:

  ```bash
  GEMINI_API_KEY=... npx jest liveEval
  GEMINI_API_KEY=... GEMINI_MODEL=gemini-2.5-pro npx jest liveEval
  GEMINI_API_KEY=... EVAL_ONLY=EV-02,EV-11b npx jest liveEval
  ```

Sixteen cases, most drawn straight from the two real-world rounds (TC-001,
TC-003, TC-004, TC-005, TC-012, TC-013, TC-015, TC-020, TC-021, TC-022,
TC-025, TC-026) plus the audit findings. The scorer checks what would corrupt
a ledger — how many operations, of what type, for how much, against which
entities, whether the gate lets them through — and deliberately ignores names,
wording and evidence spans, which are presentation.

**Deviation from the audit, stated plainly.** F8c proposed making production
two-stage (audio→transcript, then transcript→JSON). Only the *text entry
point* was built (`interpretTextWithGemini`); production still sends audio
straight to interpretation. Splitting it would discard what the model hears in
the audio itself and make every transcription error unrecoverable at stage two,
which is a real accuracy risk — and the eval harness, the actual prize, needs
only that the text path exist. It can be revisited with measurements now that
measuring is possible.

Two cases document a subtlety worth keeping: **EV-11a** covers the model
following the new prompt rule (digits appended, so the amount grounds on its
own and nothing needs confirming), **EV-11b** covers it not (the reference
backstop grounds it, with a mandatory confirmation). Both must work.

*Tests:* `eval.test.ts` (18, incl. one that feeds the scorer a deliberately
wrong reading — a green corpus has to be able to go red).

---

## 15. What did NOT change

- The seven-layer architecture, the three-tier contract, and the ordering of
  layers.
- Grounding remains app-recomputed; the model's own `grounded` flag is never
  read. Reference-grounding is a *widening under proof*, not a relaxation:
  every promoted value is a value the user spoke.
- "The AI never outputs ids"; no first-entity fallback; unresolved stays unset.
  Near-matching (Amendment Q) suggests but never resolves.
- The Approval Queue and the final deterministic gate as the only route to the
  ledger. Every new signal added here (reference, uncertainty, date, missing
  amount, unconfirmed type) blocks **through** the existing conflict/gate
  mechanism rather than around it.
- The golden rule and integer minor units.
- **AI output remains untrusted.** A declared response schema constrains the
  container, not the contents; a critic's repair is validated exactly like a
  first reading. Nothing in Phase 3 moved authority from the app to the model.
- **The on-device live transcript stays display-only.** Audit finding F9 was
  reviewed and **declined by the owner on 2026-08-25**: it is a deliberate
  parallel pipeline for showing speech on screen as it happens. Do not wire it
  into interpretation.

---

## 16. Test coverage

`npm test` — 26 suites, 400 tests (was 318 before V1.2), plus 16 live-eval
tests that stay skipped without an API key.

| Amendment | Tests |
|---|---|
| H — grounding by reference | `audit.test.ts` → *Audit F1* (6, incl. bill-split promotion + dedup interplay, and three "must NOT promote" cases) |
| I — multilingual grounding | `audit.test.ts` → *Audit F2* (3, incl. a vague Tamil expression that must still be refused) |
| J — unresolved date blocks | `audit.test.ts` → *Audit F4* (3) |
| K — ambiguous amount blocks | `audit.test.ts` → *Audit F6* (2) |
| L — yearly note | pure note function; device verification below |
| M — hygiene | `dates.test.ts` → *month-end anchors* (3); header/batching are I/O-side |
| N — queued unqualified intents | `audit2.test.ts` → *Audit F3* (5) + `migration6.test.ts` (6, against a real SQLite engine) |
| O — review-screen editing | `audit2.test.ts` → *Audit F3* → "becomes approvable once the user supplies the amount" |
| P — date grammar | `audit2.test.ts` → *Audit F4* (9) |
| Q — near matches | `audit2.test.ts` → *Audit F10* (6) |
| R — few-shot prompt | measured by the live eval, not asserted offline (the examples are prompt text) |
| S — response schema | shape is data; the fallback path is exercised on-device (checklist below) |
| T — compound-utterance critic | `critic.test.ts` (21, incl. "discards an invented amount outright" and the repair-drift cases) |
| U — eval harness | `eval.test.ts` (18) offline; `liveEval.test.ts` (16) opt-in |

**New in Phase 2:** `migration6.test.ts` executes the shipped migration SQL
against `node:sqlite`. Migration 6 is the first migration to *rebuild* a table
rather than add one, and a mistake there would fail on real financial data at
launch — not the kind of thing to leave to a pure-logic suite.

---

## 17. Device verification checklist

No native config changed — a plain `npx expo run:ios --device` (or hot reload)
is enough. **Migration 6 runs on first launch**; confirm existing queue items
survive it.

1. **F1** — say: *"I received 2000 from Nuski, and I transferred that amount
   from Commercial Bank to Cash."* Expect TWO queue items; the transfer shows a
   "Please confirm" note about the referenced amount and cannot be approved
   until confirmed.
2. **F2** — say an amount in Tamil (e.g. *"rendayiram rupees for food"*).
   Expect it to land in the queue with Rs 2,000, not vanish.
3. **F4** — say: *"I spent 500 on food last month."* Expect a blocking
   "couldn't turn 'last month' into a date" confirm note.
4. **F6** — say: *"It was 500 or maybe 5000 for food."* Expect an
   amount-uncertain confirm note.
5. **F7** — say: *"Set up a yearly subscription of 1200 for internet."*
   Expect the recurring editor to open with a "Check the schedule" alert.
6. **F11** — regression only: a normal parse still succeeds (the API key now
   travels in a header).

Phase 2:

7. **Migration 6** — launch with items already in the review queue and confirm
   they are all still there, with their amounts intact.
8. **F3** — say something with no amount at all: *"I paid the electricity bill
   from Commercial Bank."* Expect a queue card reading **"Amount needed"**
   (not Rs 0.00) that keeps the account, and cannot be approved.
9. **F5** — open that card, type the amount, adjust the date, edit the name,
   pick the category → Approve becomes available and commits correctly. Then
   check the recorded transaction's date matches what the picker showed.
10. **F4** — say *"I spent 500 on food last month"* and *"…on the 15th"*:
    both should now resolve to a real date with no confirm prompt.
11. **F10** — say a person's name slightly wrong ("Nusky" for Nuski). Expect
    the review screen to show *"Heard 'Nusky' — did you mean Nuski?"* with the
    item still blocked until you tap the right chip.
12. **Notification** — background the app during a parse of an
    amountless utterance; the notification should mention that one still needs
    an amount.

Phase 3 — **run the live eval first**, before touching the phone:

```bash
GEMINI_API_KEY=... npx jest liveEval      # 16 cases against the real model
```

That single command now covers what used to take an evening of speaking into
the app. Then on-device:

13. **Structured output works at all** — the first voice capture after this
    change is the real test of the response schema. If Gemini rejects it, the
    client silently retries without the schema, so capture must still succeed
    either way. A parse that returns nothing at all is the signal something is
    wrong; check the error text.
14. **F8d critic** — say a genuinely compound sentence with several amounts:
    *"This morning I spent 500 on food, then 200 on stationery, and I sent
    2000 to Sham."* Expect three separate cards. Try it a few times: this is
    the case that used to drop one.
15. **The critic does not fire on ordinary notes** — a plain *"spent 500 on
    food from cash"* should feel exactly as fast as before (no second call).
16. **Nothing regressed** — re-run checklist items 1–12 above; the few-shot
    examples changed the prompt every one of them depends on.
