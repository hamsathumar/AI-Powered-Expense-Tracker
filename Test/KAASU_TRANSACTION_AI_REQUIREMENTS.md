# Kaasu Transaction AI — Behavioural Requirements Specification

**Phase:** Requirements Definition (behaviour only — not architecture, not implementation).
**Inputs:** `Test/AI_TEST_ANALYSIS.md` (real-world test evidence) and `Test/CURRENT_AI_ARCHITECTURE_AUDIT.md` (confirmed codebase behaviour).
**Status of this document:** defines *what* the Transaction AI must do. It deliberately does **not** define *how*.

Throughout, every requirement is grounded in an explicit chain:

> **EVIDENCE** (what happened / what a financial system fundamentally needs) → **CURRENT BEHAVIOUR** (what the code does today) → **REQUIRED BEHAVIOUR** (what Kaasu must do).

Requirement IDs are stable handles for later phases. Priorities are defined in §16. Traceability is in §17.

---

## 1. Purpose

This document defines the **behavioural requirements** for a safe and reliable Kaasu Transaction AI: the observable behaviour the system must exhibit when converting a spoken money note into a reviewable transaction, and the guarantees it must give around financial integrity.

**This document DEFINES:**
- The safety principles the Transaction AI must obey.
- The transaction intents it must recognise and the minimum information each needs.
- Which fields are financially critical and how each must behave when unresolved.
- Required behaviour for amounts, dates, compound/split input, recurrence, entity resolution, uncertainty, approval, non-transactional input, and injection.
- The conceptual split between AI interpretation and deterministic application logic.
- Controlled outcomes for every failure mode.
- Requirement priorities, traceability to evidence, and the product decisions that remain open.

**This document does NOT define (out of scope, later phases):**
- Any code, file, function, prompt text, JSON schema, or database structure.
- The AI Constitution / system-instruction wording.
- The technical mechanism of validation, entity matching, injection defence, or approval gating.
- The user-interface design of the queue or clarification flows.
- Model selection, tuning, or provider configuration.

Where a behaviour cannot be settled from evidence alone because it is a product choice, it is **not silently decided** — it is listed in §18.

**Finalized product decisions (this revision).** A set of product decisions has now been finalized and is incorporated throughout this document (the resolved list is in §18A). In summary: (a) a grounded transaction **amount is the minimum requirement** to create a transaction candidate — no amount means the input is rejected as `NO_TRANSACTION_VALUE_DETECTED` and never enters the Approval Queue; (b) a single utterance may yield **zero, one, or multiple** independent transaction candidates, plus specialised operations; (c) Kaasu recognises **six high-level operations** — Income, Expense, Transfer, Lending, plus the specialised **Recurring** and **Bill Split** operations, each routed to its own workflow; (d) **Bill Split** requires explicit split evidence; (e) **Recurring** intent is evidence-based (no numeric confidence threshold) and the application owns recurrence execution; (f) a **missing category** does not block candidate creation but does block final approval, and is never defaulted. These decisions sharpen — and in a few places supersede — earlier wording; where they do, the superseded text has been updated rather than left in place.

---

## 2. Core Safety Principles

These are the load-bearing principles. Every later requirement is an application of one or more of them. Each is stated as a principle, then refined against the evidence (not blindly accepted).

**SP-1 — AI output is untrusted data, not instruction.**
*Refinement:* The audit confirms the validation layer already treats output as untrusted in *plumbing*, but the *policy* is weak — untrusted output is allowed to seed real financial values via defaults. "Untrusted" must mean **untrusted for content, identity, and authority**, not merely "re-typed."

**SP-2 — The AI must never invent critical financial information.**
*Refinement:* Evidence shows two invention channels: the **model** fabricating (amounts — TC-012) and the **application** fabricating (defaulting an unresolved account/category/destination to an existing one — TC-013/TC-015). Both are inventions of financial data. This principle must bind **both the model and the application-side resolution logic**, not just the model.

**SP-3 — Missing critical information must stay missing.**
It must remain in an explicit unresolved state that propagates to review, never be silently converted into a plausible real value. Refined from the raw principle: Kaasu does **not** require interactive clarification at capture time (the product is speed-first, "no confirmation dialog before logging"); "controlled clarification/rejection" is satisfied by carrying a genuine *unset* state into the queue, OR by a controlled rejection when no safe transaction can be formed. Which of the two applies per field is specified in §4 and §18.

**SP-4 — An uncertainty flag must never coexist with an unsafe committable value.**
*Refinement (directly from TC-015):* today a `no_account_matched` flag sits on a row whose `account_id` is already a valid, approvable default. A flag must describe the **true underlying state**. If a field is flagged unresolved, that field must actually be unresolved (unset) — not silently holding a default. This is the single highest-value principle in the document.

**SP-5 — User approval must be meaningful.**
Approval must be a real safety boundary, not a status flip. A transaction must be **ineligible for approval** while any critical field is unresolved. Refined: the current pending-boundary (nothing counts until approved) is a genuine, working safeguard and must be preserved; what must change is that approval currently commits anything, including unresolved defaults.

**SP-6 — Application and business rules are authoritative over AI interpretation.**
Where the model's interpretation and the application's rules conflict, the application wins. The AI proposes; deterministic logic disposes. Balances, the golden rule, union invariants, and approval gating are never delegated to the model.

**SP-7 — The AI must not directly mutate financial records.**
The AI may only produce a *proposed pending* transaction. It must never write an approved row, adjust a balance, or alter history. (Confirmed already true today and must remain true.)

**SP-8 — Unsupported or ambiguous input must be handled explicitly.**
The AI must not force every utterance into a single well-formed transaction. Ambiguity, multiple intents, and non-transactional speech require explicit, controlled outcomes (§7, §12), not a silent best-guess single row.

**SP-9 — User-provided content must not override system instructions or safety rules.**
All spoken content is data to be interpreted. No embedded phrase — however it is worded or wherever it appears — may redefine rules, grant authority, or force a transaction (§13).

**SP-10 — Provenance must be honest.**
Refined/added from the audit's "no per-field provenance" finding: the system must be able to distinguish, at review time, a value the **user stated** from a value the **system supplied/guessed**, so that SP-4 and SP-5 are enforceable. Without honest provenance, "unresolved" cannot be reliably represented.

---

## 3. Supported Transaction Intent Requirements

Kaasu recognises **six high-level financial operations**. Four are ordinary transaction types — **Income, Expense, Transfer, Lending** (lending covering lend / borrow / repayment directions) — that use the normal transaction editing/approval workflow. Two are **specialised operations** — **Recurring Transaction** (§8) and **Bill Split** (§7B) — that are *not* cosmetic variations of an ordinary transaction: each is a distinct product operation with its own dedicated editing/approval workflow, and the application must route a recognised operation to the correct workflow. A single utterance may also contain **multiple independent transactions** (§7A).

General intent requirements:

- **TI-1** The AI must classify intent from the **described real-world action**, not from a label the speaker asks it to apply (see §2 SP-6 and §10 on conflict). *(EVIDENCE: TC-013/TC-014 — a stated/persuaded label overrode the action. CURRENT: model `type` trusted verbatim. REQUIRED: action-derived classification, with conflicts surfaced, not silently obeyed.)*
- **TI-2** The AI must never emit a transaction type/operation outside the supported set of six, and the application must reject any that is. *(CURRENT: enum-checked for the four ordinary types; keep and extend to operation routing.)*
- **TI-3 (CRITICAL)** The number of transactions in an utterance is not necessarily one. A single input may yield **zero, one, or multiple** transaction candidates, plus specialised operations (Bill Split, Recurring). The system must represent each detected transaction separately and must not force a single-object result. *(EVIDENCE: TC-001/TC-010/TC-020. CURRENT: the contract emits exactly one transaction. REQUIRED: zero/one/many candidates, each independently reviewable — see §7A and §12 NT-9.)*
- **TI-4 (CRITICAL)** Two distinct thresholds govern a candidate's life: the **candidate threshold** (what is needed to create a pending candidate at all) and **approval eligibility** (what is needed before it may be committed). A grounded amount is the candidate threshold; all remaining approval-required critical fields must be resolved before approval (§4, §11).
- **TI-5 (CRITICAL)** The **candidate threshold is a grounded transaction amount**. If no amount grounded in the user's input is present, the input is not a transaction candidate: it is rejected as `NO_TRANSACTION_VALUE_DETECTED` and must not enter the Approval Queue (§5, §12, §15).

### 3.1 Expense
- Recognise: money leaving the user's account for a good/service.
- Candidate threshold: a grounded amount + recognisable expense intent.
- Required before approval: account, category.
- Optional: person (tagging), description, date (defaults per §6).
- Missing amount → `NO_TRANSACTION_VALUE_DETECTED`; no candidate, no queue entry (§5).
- Missing account/category (amount present) → candidate enters the queue with the field genuinely unresolved; never defaulted; blocks approval until the user resolves it (§4, §11).
- Ambiguous intent (e.g. expense vs transfer) → surfaced as ambiguous, not silently chosen.

### 3.2 Income
- Recognise: money entering the user's account from an external source.
- Candidate threshold: a grounded amount + recognisable income intent.
- Required before approval: account, category.
- Optional: person, description, date.
- Missing amount → `NO_TRANSACTION_VALUE_DETECTED` (§5). Missing account/category (amount present) → enters queue unresolved, blocks approval, never defaulted. Ambiguous: as expense.

### 3.3 Transfer
- Recognise: movement between **two of the user's own** accounts.
- Candidate threshold: a grounded amount + recognisable transfer intent.
- Required before approval: **source account, destination account** (two distinct, both user-authorised). No category, no person.
- Optional: description, date.
- Missing amount → `NO_TRANSACTION_VALUE_DETECTED` (§5).
- Missing/unresolved destination → destination stays **unresolved** (never invented — TC-013/TC-015). A transfer with only one resolvable account enters the queue but is not approvable until the second account is resolved.
- Ambiguous (transfer vs expense/lending) → surfaced as ambiguous.

### 3.4 Lending (lend / borrow)
- Recognise: money moving between the user and a **person**, in a direction (`lend` = user gives; `borrow` = user receives).
- Candidate threshold: a grounded amount + recognisable lending intent.
- Required before approval: account, person, direction.
- Optional: description, date.
- Missing amount → `NO_TRANSACTION_VALUE_DETECTED` (§5).
- Missing person → an unrecognised name is preserved verbatim as an unresolved person (never guessed to an existing one); a lending candidate with no person at all stays unresolved and non-approvable. Missing/uncertain direction must **not** silently default (see §4).
- Ambiguous (lend vs expense; borrow vs income) → surfaced.

### 3.5 Repayment (lend_repayment_received / borrow_repayment_made)
- Recognise: settlement of an existing lending relationship, in the correct direction.
- Candidate threshold: a grounded amount + recognisable repayment intent. Required before approval: account, person, repayment direction.
- Optional: link to prior lending, date.
- **REQUIRED:** repayment must not be silently reclassified as plain income/expense. *(EVIDENCE: TC-006 correct alone, but TC-014 talked a repayment into "income". CURRENT: no conflict concept. REQUIRED: the action "they paid me back" must classify as a repayment; a request to relabel it must be surfaced as a conflict, not obeyed.)*
- Missing direction is a **critical** ambiguity (a repayment in the wrong direction reverses who owes whom) → must not default.

### 3.6 Recurring Transaction (specialised operation) — see §8.
### 3.7 Bill Split (specialised operation) — see §7B.
### 3.8 Compound / multiple transactions in one utterance — see §7A.

---

## 4. Critical Financial Fields

A field is **critical** if a wrong or invented value silently corrupts a balance, a report, or a person's ledger. Kaasu must be **extremely conservative**: a critical field that is not genuinely known must never be materialised into a real value.

Four states must be distinguishable (SP-10):
- **KNOWN** — the user explicitly stated it and it resolves to a user-authorised entity/value.
- **INFERRED** — the AI derived it with high confidence from unambiguous context (allowed only where the table permits).
- **AMBIGUOUS** — more than one plausible value; the system knows it is unsure.
- **UNKNOWN** — the user did not provide it and it cannot be safely inferred.

**CF-CORE: UNKNOWN must never be silently converted into a real value.** AMBIGUOUS must never be silently collapsed to one value.

**Candidate threshold vs approval-required (TI-4/TI-5).** Exactly one critical field is required to *create* a candidate: a **grounded amount**. Its absence is the only field-level condition that rejects the input outright (`NO_TRANSACTION_VALUE_DETECTED`, §5). All other critical fields may be UNKNOWN/AMBIGUOUS at candidate-creation time — the candidate enters the queue with those fields genuinely unresolved — but each must be resolved (by the user, never by a silent default) before the candidate becomes approval-eligible (§11).

| Field | Critical? | Can AI infer? | Can AI default? | Behaviour if UNKNOWN/AMBIGUOUS |
|---|---|---|---|---|
| Amount | **Yes (highest, candidate threshold)** | No — extract only | **Never** | Missing/ungrounded/unresolvable → `NO_TRANSACTION_VALUE_DETECTED` rejection; not placed in the queue; never guessed (§5) |
| Transaction type | **Yes** | Yes, from the action | No (must not default to a type) | Ambiguous → surfaced as ambiguous; not silently chosen |
| Account (source) | **Yes** | Only if the user has exactly one account and context is unambiguous (product decision §18) | **Never to an arbitrary existing account** | Unresolved → stays unset; not approvable until chosen (TC-015) |
| Destination account (transfer) | **Yes** | No | **Never invent** | Unresolved → stays unset; transfer not committable (TC-013) |
| Category (expense/income) | **Yes for approval; not required to create a candidate** | Yes, reasonable inference from the item | **Never** — not first-in-list, not alphabetical-first, not a generic "Other" default | Unresolved → candidate still enters the queue; category stays genuinely unset; must be user-resolved before approval; never defaulted (resolved product decision, §18A) |
| Person (lending) | **Yes** | Preserve an unrecognised name verbatim (do not guess an existing person) | No (never map to the wrong existing person) | Unknown name → unresolved person; no person at all → controlled outcome |
| Person (expense/income tag) | No (optional tag) | Yes | N/A (optional) | Absent → simply absent |
| Lending direction | **Yes** | Yes, from the action | **Never default silently** (today defaults to `lend`) | Ambiguous → surfaced; not silently `lend` |
| Transaction date | **Yes (report/period integrity)** | Yes, resolve relative dates against a reference date | May default to the reference "today" **only when no date was expressed** (and this must be an honest default, not masking an expressed-but-unresolved date) | Expressed-but-unresolvable date → surfaced; unexpressed → reference-today (§6) |
| Recurrence info | **Yes (when recurrence is intended)** | Recognise interval/anchor from speech | No (never invent a schedule) | Intended but incomplete → surfaced/held (§8); not silently one-time without signalling |
| Split info (participants/shares) | **Yes (when split is intended)** | Recognise participants/shares | No (never invent participants or amounts) | Intended but incomplete → surfaced; not silently merged (§7) |

**CF-1 (CRITICAL):** No critical field may be committed while in UNKNOWN or AMBIGUOUS state. *(EVIDENCE: TC-012, TC-013, TC-015. CURRENT: account/category/destination/direction all silently defaulted. REQUIRED: unresolved critical field blocks approval.)*

**CF-2 (CRITICAL):** The state (KNOWN/INFERRED/AMBIGUOUS/UNKNOWN) of each critical field must be honestly represented so review and approval can act on it (SP-4, SP-10).

---

## 5. Amount Requirements

Amount is the most critical field: it is extracted, never inferred, never defaulted. These requirements explicitly cover TC-007 and TC-012.

- **AM-1 (CRITICAL) — No fabricated amounts.** The system must never present or commit a specific numeric amount that the user did not express. *(EVIDENCE: TC-012 — "infinity" produced Rs2,000 and Rs1,000,000. CURRENT: any positive finite number passes; only ≤0/non-finite is rejected. REQUIRED: an amount that is not a genuine extraction of what the user said must be treated as unresolved, not substituted.)*
- **AM-2 (CRITICAL) — Missing amount → rejection, not a queued candidate.** A grounded amount is the candidate threshold (TI-5). If no amount is expressed, the input is **rejected as `NO_TRANSACTION_VALUE_DETECTED`** and must not enter the Approval Queue; no candidate is created and no number is guessed. *(Contrast: a missing account or category, with an amount present, still creates a candidate — §4.)*
- **AM-3 (CRITICAL) — Malformed / non-numeric / non-finite / indefinite amount ("infinity", "all the money", "a lot").** Has no grounded numeric value, so it fails the candidate threshold and must produce the **same** `NO_TRANSACTION_VALUE_DETECTED` rejection as a missing amount — one deterministic outcome for the whole class. *(EVIDENCE: TC-007 "all the money" correctly hard-stopped; TC-012 "infinity" wrongly fabricated Rs2,000 / Rs1,000,000 — two opposite outcomes for the same class. The finalized behaviour canonicalises TC-007's hard-stop as correct and TC-012's fabrication as prohibited.)*
- **AM-4 (CRITICAL) — Zero and negative.** A zero or negative amount is invalid; amounts are always positive minor units with direction derived from type. Such input is unresolvable, not coerced.
- **AM-5 (HIGH) — Vague/approximate ("around 500", "about a thousand").** Product decision whether to accept-with-uncertainty or treat as unresolved (§18); whichever is chosen, the uncertainty must be honestly represented (must not appear as a confident exact figure).
- **AM-6 (HIGH) — Contradictory amounts / self-correction ("500… actually 50,000").** The system may resolve to the corrected value but must signal the uncertainty. *(EVIDENCE: TC-011/TC-019 handled this well; preserve the behaviour and its low-confidence signal.)*
- **AM-7 (HIGH) — Multiple distinct amounts for multiple intents ("600 food, 400 transport").** Must not be merged into one summed amount. Governed by §7. *(EVIDENCE: TC-020 merged to Rs700.)*
- **AM-8 (CRITICAL) — Amounts introduced by embedded instruction text.** An amount that appears only inside an instruction-like phrase ("change the amount to 50,000") must not override the amount of the described transaction. *(EVIDENCE: TC-018. Governed jointly with §13.)*
- **AM-9 (HIGH) — Amount phrasing robustness.** Legitimate regional/spoken phrasings ("2.5k", "1 lac 50,000", "fifteen fifty") must continue to resolve correctly. *(EVIDENCE: TC-005 PASS — a capability to preserve, not regress.)*
- **AM-10 (CRITICAL) — Amount must be grounded in the user's input.** "An amount exists" means the user actually expressed a resolvable value — not that the model produced a positive number. A model-generated figure that is not a genuine extraction of what the user said must never satisfy the candidate threshold (AM-1/TI-5); it is treated as no amount → `NO_TRANSACTION_VALUE_DETECTED`. *(EVIDENCE: TC-012.)*

---

## 6. Temporal Requirements

Three date concepts must be kept distinct:
- **USER-EXPRESSED DATE** — a date the user actually stated ("yesterday", "on the 3rd", "last Friday").
- **APPLICATION REFERENCE DATE** — the "now" the application supplies as the anchor for resolving relative dates and for defaulting.
- **SYSTEM CURRENT DATE** — the device clock at the moment of processing (the source of the reference date, but conceptually separate from what the user meant).

- **TM-1 (HIGH) — Relative dates must resolve against a reference date.** "yesterday/today/tomorrow", named weekdays, and dates embedded in natural speech must be resolved relative to the application reference date. *(EVIDENCE: TC-004 — "yesterday" recorded as today. CURRENT: no reference date is supplied and the occurrence date is hard-set to now; relative dates cannot be honoured. REQUIRED: a supplied reference date and correct relative resolution.)*
- **TM-2 (HIGH) — Explicit dates must be honoured** over the default.
- **TM-3 (MEDIUM) — Missing date defaults to the reference "today"**, and this default must be honest (an unexpressed date defaulting to today is fine; an *expressed but unresolvable* date must not be silently shown as today).
- **TM-4 (MEDIUM) — Future dates** must be representable (e.g. scheduling) and not rejected merely for being future; whether a far-future date warrants a signal is a product decision (§18).
- **TM-5 (LOW) — Time-of-day expressions** ("at 3pm", "this morning") — product decision whether time is captured or only date (§18).
- **TM-6 (CRITICAL-adjacent) — A date must never be fabricated to a specific past/future day the user did not express.** Defaulting to the reference today is the only permitted default.

---

## 7. Compound, Multiple-Transaction & Bill-Split Requirements

This section separates two distinct concepts that must not be conflated: **§7A** — several *independent* transactions in one utterance (each becomes its own candidate); and **§7B** — **Bill Split**, a single shared bill that opens a dedicated specialised operation.

### 7A — Compound / multiple independent transactions

- **CS-1 (HIGH) — Multiple distinct transactions must not be silently dropped or merged.** When an utterance expresses more than one independent transaction, each must become its own reviewable candidate; none may be dropped or merged. *(EVIDENCE: TC-001/TC-010 dropped a transaction; TC-020 merged two into one. CURRENT: single-intent contract, one row only. REQUIRED: separate candidates — resolved, §18A.)*
- **CS-2 (HIGH) — Per-intent fields must be preserved as separate candidates.** For "Rs.1,600 for food and Rs.400 for transport", the two amounts and their two categories are preserved as **two independent expense candidates**, never summed under one category. For "received Rs.1,000 income and spent Rs.400 from it", an income candidate and an expense candidate are produced. *(EVIDENCE: TC-020.)*
- **CS-3 (clarification) — Do not over-engineer ordinary single payments.** A normal statement such as "I spent Rs.2,000 shopping at Keells" remains a **single** expense (amount Rs.2,000; context Keells; category Shopping if provided/resolved). Kaasu must **not** introduce a "one payment with multiple categories" allocation abstraction merely to handle ordinary shopping. Separate candidates are produced **only** when the user explicitly expresses separate transactions/allocations (e.g. "Rs.2,000 at Keells — Rs.1,600 was food and Rs.400 was household"). The stronger and more explicit the separation, the clearer the multi-candidate interpretation.
- **CS-4 (MEDIUM) — Partial decomposition.** If some intents in a compound utterance are resolvable and others are not, the unresolved ones must be surfaced (or independently rejected per their own threshold), never silently dropped. A part with no grounded amount is rejected per TI-5 without discarding the other, valid candidates.
- **CS-5 (resolved, §18A) — Presentation.** Multiple independent transactions are represented as **multiple independent pending candidates**, each independently validated, held, edited, and approved. (Grouping/UX is an implementation concern for the later phase; the behavioural requirement is separate, independently-reviewable candidates.)

### 7B — Bill Split (specialised operation)

Bill Split is a single shared bill divided among the user and other people — a distinct product operation with its own editor/approval workflow, **not** a cosmetic variation of an expense.

- **BS-1 (HIGH) — Explicit split evidence is required.** The system must **not** classify an expense as a Bill Split merely because multiple people are mentioned, multiple people attended, the expense was "for four people", the user paid for others, or splitting seems possible. There must be explicit evidence of bill-splitting intent. *(EVIDENCE: TC-003 — explicit "split payment between myself, Nuski and Sham" was flattened to an ordinary expense.)*
- **BS-2 (HIGH) — Boundary examples.** "I paid Rs.4,000 for dinner for four people" → ordinary **Expense** (the user may have paid the whole bill). "I paid Rs.4,000 for dinner, split between me, Sham, Nuski and Peter" (or "…split equally between…") → **Bill Split**.
- **BS-3 (HIGH) — Dedicated workflow.** A recognised Bill Split enters the Approval Queue and opens the dedicated Bill Splitter editing/approval workflow; it is not editable/approvable as if it were a plain expense.
- **BS-4 (CRITICAL) — Participant resolution follows the entity rules (§9).** Named participants are matched against the People list and resolved to existing entities; person IDs are never invented; an unresolvable participant is preserved with their stated name/context and marked unresolved; another person is never silently substituted; unresolved participants are surfaced for user resolution before final approval/commit.
- **BS-5 (HIGH) — No bypass.** Bill Split never auto-posts; it is held to the same pending/approval boundary and eligibility gate as any other operation (§11). Split-allocation math remains deterministic application logic (§14), not AI.

The database/queue representation is **not** decided here.

---

## 8. Recurring Transaction Requirements

Recurring Transaction is a **specialised operation** with its own dedicated recurring workflow/editor — not a flattened ordinary transaction.

- **RC-1 (HIGH) — Recurrence intent must be recognised, not flattened.** Explicit recurring language ("recurring", "every month on the 15th", "monthly", "weekly") must be captured as a recurring operation, not recorded as a single one-time transaction. *(EVIDENCE: TC-002 — recorded as one-time even when "recurring expense" was explicit. CURRENT: no recurrence in the AI contract. REQUIRED: recurrence intent captured and routed to the recurring workflow.)*
- **RC-2 (MEDIUM) — Supported intervals.** At minimum monthly, weekly, and yearly, plus the intervals the application already supports (daily/custom). Unsupported interval language → surfaced, not silently coerced.
- **RC-3 (HIGH) — An incomplete recurring rule is held, not fabricated.** Recurrence stated without an amount (see TI-5: no grounded amount → not a valid candidate at all) or without an anchor date must be surfaced as incomplete, never completed with invented values (SP-2/CF-CORE).
- **RC-4 (MEDIUM) — Recurrence with an explicit anchor date** must honour that date (subject to §6).
- **RC-5 (HIGH) — Recurring recognition is evidence-based, not a numeric threshold.** The system must distinguish **clear recurring intent**, **strong recurring context**, **ambiguous recurring context**, and **ordinary one-time intent**, based on the evidence in the user's language/context. It must **not** use an arbitrary numeric confidence rule (e.g. "recurring_confidence > 0.50 = recurring"). Clear intent ("Set up a recurring payment of Rs.1,500 for Netflix every month on the 15th") → recurring; strong context ("I pay Netflix Rs.1,500 every month on the 15th") → handled under recurring-intent rules, not blindly flattened; a bare mention ("I paid my usual monthly rent today") must not manufacture a schedule. The exact classification mechanism is deferred to the architecture/technical-contract phase. *(EVIDENCE: TC-002.)*
- **RC-6 (HIGH — ownership & no bypass) — The application owns recurrence execution; the AI never posts future occurrences.** A recognised recurring rule enters the Approval Queue and must be approved by the user. The application owns recurrence scheduling, rule execution, and future-occurrence generation; each generated occurrence follows the app's own pending/approval boundary. Gemini/AI must never directly create or post future financial occurrences, and a recurring instruction must never bypass the Approval Queue or silently auto-post. *(Preserves and strengthens the existing recurring engine's behaviour.)*
- **RC-7 (HIGH) — Dedicated workflow.** A recognised recurring operation opens the dedicated recurring editor/approval workflow, not the ordinary transaction editor.

Recurrence generation logic itself remains deterministic application logic (§14), not AI.

---

## 9. Entity Resolution Requirements

Applies to accounts, categories, people, and destination accounts. This section addresses the confirmed `?? accounts[0]` / `?? categories[0]` / invented-destination fallback.

- **ER-1 (CRITICAL) — A failed match must never silently become an arbitrary existing entity.** *(EVIDENCE: TC-015 — first account committed under a "no account matched" flag; TC-013 — invented "Cash" destination. CURRENT: unresolved account→first-created account, category→alphabetical-first, destination→any other account, each with a non-blocking flag. REQUIRED: an unresolved entity stays genuinely unresolved.)*
- **ER-2 (CRITICAL) — The AI must never introduce an entity the user did not state.** Resolution may only select among **existing, user-authorised** entities, or preserve an unrecognised **person** name verbatim as an explicitly unresolved person. No invented accounts, categories, or destinations. *(EVIDENCE: TC-013/TC-015.)*
- **ER-3 (HIGH) — Exact match.** A confident exact match (name equality, case-insensitive) resolves to that entity (KNOWN).
- **ER-4 (MEDIUM) — Reasonable match.** A near/partial match may resolve, but the confidence must be represented; a low-confidence match must not masquerade as KNOWN. Whether reasonable matching is enabled at all is a product decision (§18).
- **ER-5 (CRITICAL) — No match.** Produces an UNKNOWN entity state that is carried honestly to review and blocks approval for critical entities (ER-1, CF-1).
- **ER-6 (HIGH) — Multiple possible matches.** Must be treated as AMBIGUOUS and surfaced, never resolved by picking the first silently. *(CURRENT: `find` returns the first match with no ambiguity handling.)*
- **ER-7 (HIGH) — User-created entities from voice (unresolved person).** Preserving an unrecognised person name is permitted, but it must be marked unresolved and must not corrupt person balances until confirmed. The lifecycle of such a person (including cleanup after rejection) must be coherent. *(EVIDENCE: TC-009 — AI behaviour correct, but a rejected transaction left an undeletable person; the entity lifecycle is a required behaviour to fix at the app layer.)*
- **ER-8 (CRITICAL) — Flag/state fidelity.** Any "no … matched" indication must correspond to a field that is genuinely unset (SP-4).
- **ER-9 (CRITICAL) — No generic category default.** An unresolved expense/income category must stay genuinely unset — it must **not** be defaulted to the first/alphabetical-first category nor to a generic "Other" catch-all. *(This supersedes the tentative note in TC-015 Obs 3 that a generic "Other" fallback might be acceptable: the finalized decision (§4, §18A) is that a missing category is left unresolved and resolved by the user before approval — never auto-filled. Unlike accounts, there is no product need for a placeholder value here.)*
- **ER-10 (CRITICAL) — Bill-split participants.** Named split participants follow ER-1..ER-8: matched to existing People, never invented, unresolvable ones preserved-and-marked, and surfaced before approval (see BS-4).

---

## 10. Uncertainty and Confidence Requirements

Two classes of uncertainty, treated differently:

- **Informational uncertainty** — low stakes (e.g. naming/capitalisation, an optional tag). May be displayed; does not block approval.
- **Critical financial uncertainty** — an UNKNOWN or AMBIGUOUS critical field (amount, type, account, destination, required category, person for lending, direction, or a conflict between action and requested label).

Requirements:

- **UC-1 (CRITICAL) — A warning must accurately represent the actual underlying state.** A flag indicating "unresolved" must sit on a field that is truly unresolved. *(EVIDENCE: TC-015. This is SP-4 restated as a hard requirement.)*
- **UC-2 (CRITICAL) — Critical financial uncertainty may be displayed and may enter the queue and may be edited, but must NOT be approvable or committable while unresolved.** This explicitly includes a **missing category** (which does not block candidate creation but does block approval — §4) and an unresolved account/destination/person/direction. *(EVIDENCE: TC-012, TC-013, TC-015. CURRENT: flags are purely decorative; anything is approvable. REQUIRED: critical uncertainty is blocking.)*
- **UC-3 (HIGH) — Coverage must follow risk.** The highest-risk situations must carry an uncertainty/conflict signal: unresolved critical fields, action-vs-label type conflicts, self-corrections/contradictions, and detected-but-not-obeyed instruction text. *(EVIDENCE: TC-011/TC-019 flagged benign ambiguity, but TC-013/TC-014/TC-017 carried no signal for far worse failures. CURRENT: the flag set has no conflict concept. REQUIRED: a conflict/uncertainty signal exists for these cases.)*
- **UC-4 (MEDIUM) — Informational uncertainty must not block** the fast path; it is advisory only.
- **UC-5 (HIGH) — Uncertainty must be honestly typed** so the application (not the model) decides whether it is blocking. Confidence self-reported by the model may inform display but must not by itself be the authority on whether a value is safe (SP-6).

---

## 11. Approval Requirements

- **AP-1 (CRITICAL) — Approval is a safety boundary, not a status change.** Approving a transaction is the act that lets it affect balances/reports; it must therefore be gated on the transaction being safe to commit. *(EVIDENCE: TC-015 — one tap committed an unstated account. CURRENT: approval is a bare status flip with no checks. REQUIRED: eligibility conditions enforced before approval.)*
- **AP-2 (CRITICAL) — Eligibility for approval requires all approval-required critical fields to be resolved** (KNOWN, or an explicitly user-accepted state) — including a resolved **category** where the type requires one, both accounts for a transfer, and person+direction for lending. No transaction with an UNKNOWN or AMBIGUOUS approval-required field may be approved. (Ties to CF-1, UC-2, TI-4.)
- **AP-3 (HIGH) — Bulk and one-tap approval paths are held to the same gate.** "Approve all" and "Approve now" must not bypass eligibility. *(CURRENT: both are unguarded status flips.)*
- **AP-4 (HIGH) — Editing to resolve is the path forward.** A blocked transaction must be resolvable by the user supplying the missing/ambiguous value (via edit), after which it becomes eligible. The user, not the AI, supplies the resolving value.
- **AP-5 (CRITICAL) — Nothing may bypass the pending/approval boundary.** No voice, recurring (including generated future occurrences), or Bill Split path may auto-post; specialised operations use the same boundary and eligibility gate. *(Preserves the one safeguard that held in every test.)*
- **AP-6 (HIGH) — Approval must commit exactly what the user reviewed** — no re-interpretation or silent substitution between review and commit.
- **AP-7 (CRITICAL) — The candidate threshold precedes the queue.** Only inputs meeting the candidate threshold (a grounded amount, TI-5) may create a pending candidate at all; an input with no grounded amount is rejected as `NO_TRANSACTION_VALUE_DETECTED` and never reaches the queue or approval (§5, §12).

---

## 12. Non-Transactional and Unsupported Input

- **NT-1 (HIGH) — The presence of a number does not imply a transaction.** The AI must not manufacture a transaction merely because the input contains a figure. *(EVIDENCE: TC-017 — an instruction-shaped utterance produced a fabricated transaction. CURRENT: the pipeline is contractually forced to emit exactly one transaction and cannot say "not a transaction".)*
- **NT-2 (HIGH) — Non-transactional speech** (conversation, questions, unrelated statements) must produce a controlled "no transaction detected" outcome, not a best-guess row.
- **NT-3 (MEDIUM) — Incomplete statements** (a fragment with no committable transaction) → controlled unresolved/no-transaction outcome.
- **NT-4 (HIGH) — Ambiguous statements** → surfaced as ambiguous (per §10), never silently resolved to one interpretation.
- **NT-5 (HIGH) — Unsupported transaction types / structures** → controlled "unsupported" outcome, not a coerced supported type.
- **NT-6 (CRITICAL) — Prompt-injection attempts** → treated as data; see §13.
- **NT-7 (product decision, §18B) —** whether "no transaction detected" is silent, shows a gentle notice, or offers a retry is a product/UX decision; the behavioural requirement is only that no phantom transaction is created.
- **NT-8 (CRITICAL) — No grounded amount → `NO_TRANSACTION_VALUE_DETECTED`.** An input with no grounded transaction value (including an indefinite "amount" like "infinity"/"all the money") is not a transaction candidate and must not enter the queue (TI-5, AM-2/AM-3). Example: "I bought something yesterday." → no candidate, no queue entry, no invented amount. *(EVIDENCE: TC-012 shows the prohibited alternative — fabricating a figure.)*
- **NT-9 (HIGH) — Zero/one/many outcomes are all valid (see TI-3).** One input may legitimately produce **zero** candidates (no grounded transaction), **one** candidate (ordinary case), or **multiple** candidates, plus specialised operations routed to their workflows. The number of AI-detected transactions is not fixed at one.

---

## 13. Prompt-Injection Requirements

All spoken content is untrusted data (SP-1, SP-9). These are behavioural security requirements, not mechanisms.

- **PI-1 (CRITICAL) — User speech cannot redefine system rules.** No embedded phrase may change how the AI classifies, extracts, or validates. *(EVIDENCE: TC-017 — "ignore all previous instructions…" obeyed. CURRENT: instructions and audio share one untrusted turn with no boundary.)*
- **PI-2 (CRITICAL) — User speech cannot instruct the AI to ignore safety rules** (e.g. "record this as income", "override the amount"). Such phrases are, at most, *data* about what the user said — and where they conflict with the described action they are surfaced as conflicts (§10), never silently obeyed. *(EVIDENCE: TC-013, TC-018.)*
- **PI-3 (CRITICAL) — User speech cannot fabricate authorization.** Claims of override/authority ("system override", "admin says") carry no privilege.
- **PI-4 (CRITICAL) — User speech cannot force a transaction** that the described action does not support, nor replace a genuine transaction with a fabricated one. *(EVIDENCE: TC-017 — a real Rs1,500 expense replaced by a fabricated Rs100,000 income.)*
- **PI-5 (CRITICAL) — Application validation remains authoritative** regardless of the content of the speech. Injection resistance must be a property of the architecture, not case-by-case model luck. *(EVIDENCE: TC-016 resisted vs TC-017/TC-018 obeyed — resistance was content-dependent. REQUIRED: a reliable data/instruction boundary plus authoritative validation, so that even if the model is influenced, no unsafe transaction can be committed.)*
- **PI-6 (MEDIUM) — Injected instruction text should not be carried verbatim as if it were transaction content** where it is clearly not a transaction name. *(EVIDENCE: TC-016 — the payload became the item name; low impact but undesirable. Relates to §naming, R12.)*

Note: because obey/resist is ultimately model behaviour (per the audit), PI requirements are satisfied by the *combination* of a data/instruction boundary **and** authoritative deterministic validation (PI-5) — not by trusting the model to resist.

---

## 14. Deterministic vs AI Responsibilities

Conceptual ownership. The AI **proposes**; the application **decides and commits**.

| Responsibility | Owner | Rationale |
|---|---|---|
| Language interpretation (speech → meaning) | **AI** | Core strength; only the model can do this. |
| Transaction classification (type/direction) | **AI proposes → application authoritative** | AI derives from the action; application enforces supported set and conflict handling (SP-6, TI-1). |
| Operation routing (ordinary vs Recurring vs Bill Split; single vs multiple candidates) | **Application (deterministic)** | AI recognises intent/structure; the app routes each candidate to the right workflow and separates multi-intent utterances (TI-3, §7, §8). |
| Candidate-threshold gating & rejection (`NO_TRANSACTION_VALUE_DETECTED`) | **Application (deterministic)** | The app decides what is/isn't a candidate; a grounded amount is required before a candidate exists (TI-5, §15). |
| Extraction (amount, names, transcript) | **AI** | Extraction only — never inference of critical values (§4). |
| Entity matching (names → authorised entities) | **Application (deterministic)** | Must not silently default; identity resolution and ambiguity are rule-based (§9). |
| Validation (safety, completeness, eligibility) | **Application (deterministic)** | Authoritative; independent of model confidence (SP-6, §10). |
| Financial calculations & balances | **Application** | Already deterministic; never delegated to AI. |
| Ledger mutation / database writes | **Application** | AI never writes (SP-7). |
| Recurrence logic (schedule generation) | **Application** | AI recognises intent; the schedule engine is deterministic (§8). |
| Split allocation math | **Application** | AI recognises participants/shares; allocation/rounding is deterministic. |
| Date resolution (relative → absolute) | **Application supplies reference date; resolution is deterministic** where possible; AI may interpret natural phrasing (§6). |
| Approval gating | **Application (deterministic)** | The safety boundary must be rule-based, not model-driven (§11). |
| Uncertainty *classification* (blocking vs informational) | **Application** | The app, not the model, decides what blocks (UC-5). |

---

## 15. Failure and Rejection Requirements

Every failure has one deterministic, controlled outcome. The overarching rule: **a failure must never resolve into a silently-fabricated or committable transaction.**

| Failure | Required controlled outcome |
|---|---|
| Missing critical information (amount present) | Field stays UNKNOWN; candidate enters the queue but is non-approvable until the user resolves it; never defaulted. |
| No grounded transaction value (missing/indefinite/ungrounded amount) | `NO_TRANSACTION_VALUE_DETECTED`: controlled rejection; **no candidate, no queue entry, no guessed number**; recording preserved for retry (TI-5, AM-2/AM-3). |
| Invalid AI output (type/shape) | Rejected as unusable; no transaction created; user-facing controlled failure. |
| Schema/parse failure | Rejected; recording preserved for retry (preserve existing no-loss behaviour). |
| Unsupported intent/type | Controlled "unsupported" outcome; no coercion into a supported type. |
| Ambiguous intent | Surfaced as ambiguous; not silently resolved. |
| Unknown entity (critical) | UNKNOWN entity state; blocks approval; never defaulted to an existing entity. |
| Invalid amount (zero/negative/non-finite/indefinite) | Fails the candidate threshold → `NO_TRANSACTION_VALUE_DETECTED` rejection; no guessed number (AM-1..AM-4, AM-10). |
| Unsafe AI behaviour (fabrication/injection-obeyed) | Deterministic validation prevents commit regardless of model output (PI-5); the unsafe value is treated as unresolved. |
| Injection attempt | Treated as data; no rule/authority change; no forced transaction (§13). |
| Network / API failure | Controlled failure; recording preserved for retry; nothing spoken is lost (preserve existing behaviour). |

---

## 16. Requirement Priority

**CRITICAL** — violation can cause financial-data corruption, silent invention of financial values, unintended transactions, or bypass of the approval safety boundary.
**HIGH** — materially degrades reliability or safety, or drops user-stated information, but is less likely to silently corrupt the ledger on its own.
**MEDIUM** — correctness/quality of interpretation; controlled handling of secondary cases.
**LOW** — polish, phrasing, presentation.

**CRITICAL:** SP-1, SP-2, SP-3, SP-4, SP-5, SP-6, SP-7, SP-9, SP-10; TI-3, TI-4, TI-5; CF-1, CF-2; AM-1, AM-2, AM-3, AM-4, AM-8, AM-10; TM-6; ER-1, ER-2, ER-5, ER-8, ER-9, ER-10; BS-4; UC-1, UC-2; AP-1, AP-2, AP-5, AP-7; NT-1, NT-6, NT-8; PI-1, PI-2, PI-3, PI-4, PI-5.

**HIGH:** TI-1; AM-5, AM-6, AM-7, AM-9; TM-1, TM-2; CS-1, CS-2; BS-1, BS-2, BS-3, BS-5; RC-1, RC-3, RC-5, RC-6, RC-7; ER-3, ER-6, ER-7; UC-3, UC-5; AP-3, AP-4, AP-6; NT-2, NT-4, NT-5, NT-9; SP-8.

**MEDIUM:** TI-2; TM-3, TM-4; CS-4; RC-2, RC-4; ER-4; UC-4; NT-3; PI-6.

**Clarifications (not priority-ranked):** CS-3 (do not over-engineer ordinary single payments); CS-5 (present multi-intent as separate candidates).

**LOW:** TM-5; naming/capitalisation quality (below).

**Naming quality (LOW, from TC-008/TC-016):** generated transaction names must contain only transactionally relevant content and follow a consistent convention; injected/irrelevant content must not populate the name. *(EVIDENCE: TC-008 companion-in-name + inconsistent capitalisation; TC-016 verbatim payload. Not financial-integrity, hence LOW.)*

---

## 17. Requirement Traceability

Every major requirement traces to test evidence, confirmed codebase behaviour, or a fundamental financial-integrity need. Where a requirement rests only on a fundamental need (no direct test), that is stated explicitly rather than inventing evidence.

| Req ID | Requirement (short) | Source Evidence | Current Code Finding | Priority |
|---|---|---|---|---|
| SP-2 | Never invent critical financial info | TC-012, TC-013, TC-015 | model fabricates amount; `?? accounts[0]`/`?? categories[0]`; invented destination | CRITICAL |
| SP-4 | Flag must match true field state | TC-015 | flag decorative; default FK underneath | CRITICAL |
| SP-5 | Approval must be meaningful | TC-015 | approve = status flip, no checks | CRITICAL |
| SP-6 | App rules authoritative over AI | TC-013, TC-014 | model `type` trusted verbatim | CRITICAL |
| SP-9 | User content can't override rules | TC-017, TC-018 | no data/instruction boundary | CRITICAL |
| SP-10 | Honest per-field provenance | TC-015 (+ fundamental) | no per-field provenance; only `source='voice'`+coarse flags | CRITICAL |
| CF-1 | No commit of UNKNOWN/AMBIGUOUS critical field | TC-012/013/015 | all silently defaulted | CRITICAL |
| AM-1 | No fabricated amounts | TC-012 | only ≤0/non-finite rejected | CRITICAL |
| AM-3 | Unresolvable amounts → one consistent outcome | TC-007 vs TC-012 | inconsistent (hard-stop vs fabricate) | CRITICAL |
| AM-8 | Injected amount can't override | TC-018 | no amount cross-check | CRITICAL |
| AM-9 | Preserve good amount phrasing | TC-005 (PASS) | works today — must not regress | HIGH |
| TM-1 | Resolve relative dates vs reference date | TC-004 | no reference date; date hard-set to now | HIGH |
| TM-6 | Never fabricate a specific date | TC-004 (+ fundamental) | occurrence date = now always | CRITICAL |
| CS-1 | No silent drop/merge of multi-intent | TC-001, TC-010, TC-020 | single-object contract | HIGH |
| CS-2 | Preserve per-intent amount+category | TC-020 | merged to one row | HIGH |
| CS-3 | Preserve split structure/participants | TC-003 | no split representation | HIGH |
| RC-1 | Capture recurrence intent | TC-002 | no recurrence field in AI contract | HIGH |
| RC-3 | Incomplete recurrence not committed as complete | TC-002 (+ fundamental) | recurrence not modelled | HIGH |
| ER-1 | No silent default to arbitrary entity | TC-013, TC-015 | `?? accounts[0]`/`?? categories[0]`/invented dest | CRITICAL |
| ER-2 | No AI-invented entities | TC-013, TC-015 | invented destination account | CRITICAL |
| ER-6 | Multiple matches → ambiguous | fundamental (+ audit note) | `find` returns first, no ambiguity handling | HIGH |
| ER-7 | Coherent unresolved-person lifecycle | TC-009 | rejected txn blocks person deletion | HIGH |
| ER-8 | Flag/state fidelity | TC-015 | flag ≠ unset field | CRITICAL |
| UC-2 | Critical uncertainty is non-approvable | TC-012/013/015 | flags non-blocking | CRITICAL |
| UC-3 | Uncertainty coverage follows risk | TC-013/014/017 | no conflict flag exists | HIGH |
| AP-1 | Approval gated on safety | TC-015 | bare status flip | CRITICAL |
| AP-3 | Bulk/one-tap held to same gate | TC-015 (+ audit) | unguarded bulk/now paths | HIGH |
| AP-5 | Nothing bypasses pending boundary | all cases (PASS) | pending-by-default works — preserve | CRITICAL |
| NT-1 | A number ≠ a transaction | TC-017 | contract forces one transaction; no "not a transaction" | HIGH |
| NT-2 | Non-transactional → controlled no-op | fundamental | cannot express "no transaction" | HIGH |
| PI-1..PI-5 | Injection: data-only, app authoritative | TC-016/017/018 | no data/instruction boundary | CRITICAL |
| TI-1 | Classify by action, surface label conflicts | TC-013, TC-014 | type trusted; no conflict concept | HIGH |
| (naming) | Relevant, consistent names | TC-008, TC-016 | name passthrough unsanitised | LOW |
| SP-1/SP-3/SP-7/CF-2/AP-2/AP-6/NT-5 | Untrusted output; missing stays missing; no AI writes; eligibility gate | fundamental financial-integrity (reinforced by the above) | consistent with audit findings | CRITICAL/HIGH |
| TI-3/TI-5 | Zero/one/many candidates; grounded amount is candidate threshold | TC-001/010/020; TC-007/012 | single-object contract; only ≤0/non-finite rejected | CRITICAL |
| AM-10 | Amount must be grounded, not model-produced | TC-012 | any positive number accepted | CRITICAL |
| NT-8 | No grounded amount → `NO_TRANSACTION_VALUE_DETECTED` (no queue) | TC-012 (prohibited alt); TC-007 (correct alt) | forced single transaction; inconsistent | CRITICAL |
| BS-1/BS-2 | Bill Split needs explicit split evidence | TC-003 | split flattened; no split representation | HIGH |
| BS-3/BS-4/BS-5 | Bill Split dedicated workflow; participants resolved not invented; no bypass | TC-003 (+ ER evidence TC-013/015) | no split path; entity defaulting | HIGH/CRITICAL |
| RC-5 | Recurring is evidence-based, no numeric threshold | TC-002 | no recurrence modelling | HIGH |
| RC-6/RC-7 | App owns recurrence execution; dedicated workflow; no bypass | TC-002 (+ fundamental) | no recurrence path | HIGH |
| ER-9 | No generic category default (incl. "Other") | TC-015 Obs3, TC-020 | category defaulted (first/`Other`) | CRITICAL |
| AP-7 | Candidate threshold precedes queue | TC-012 (+ fundamental) | any input becomes a row | CRITICAL |
| (missing-category policy) | Missing category enters queue, blocks approval, never defaulted | TC-015 Obs3 (+ product decision) | category silently defaulted, approvable | CRITICAL |

*Requirements marked "fundamental" are justified by the intrinsic safety needs of a financial system, not by a specific test; this is stated rather than back-filled with invented evidence.*

---

## 18. Product Decisions

### 18A — Resolved (finalized this revision)

1. **Critical ambiguity / missing-field handling.** A grounded **amount is required** to establish a transaction candidate. **Missing amount → immediate `NO_TRANSACTION_VALUE_DETECTED` rejection** (no queue entry). **Amount present with other missing critical fields → the candidate enters the Approval Queue** and is held non-approvable until those fields are resolved. Unresolved approval-required fields **block approval**; they are never silently defaulted. *(Supersedes the earlier open "reject vs clarify vs hold" question. AMBIGUOUS-but-present fields — e.g. two candidate accounts — are held in the queue and resolved by the user, not auto-picked.)*
2. **Multiple transactions.** One input can produce **multiple independent transaction candidates**, each independently validated, held, edited, and approved. *(Resolves the "compound/split presentation" question toward separate candidates.)*
3. **Bill Split.** A **dedicated operation** requiring **explicit split evidence**, opening a **dedicated editing/approval workflow**; participants are resolved against the People list and never invented (§7B).
4. **Recurring Transaction.** A **dedicated operation**; recurring recognition is **evidence-based with no arbitrary numeric confidence threshold**; a recurring rule **enters the Approval Queue**; the **application owns recurrence scheduling/execution** and future occurrences follow the approval boundary (§8).
5. **Missing category.** A candidate **may enter the queue without a category**, but **category must be resolved before approval** and is **never defaulted** (not first-in-list, not "Other") (§4, ER-9).
6. **No transaction value.** Input with no grounded amount → **immediate rejection** as `NO_TRANSACTION_VALUE_DETECTED`, **no Approval Queue entry** (§5, §12, §15).

### 18B — Still open (genuinely undecided; do not assume)

- **Approximate/vague amounts (AM-5).** Accept-with-uncertainty vs treat as unresolved; if accepted, how the approximation is represented so it never reads as an exact figure.
- **Reasonable (fuzzy) entity matching (ER-4).** Enabled at all? If so, what counts as "reasonable", and does a fuzzy match need explicit confirmation before it counts as KNOWN?
- **Time-of-day capture (TM-5).** Date-only, or capture time expressions too?
- **Future dates (TM-4).** Any signal/confirmation for far-future dates, or accept silently?
- **"No transaction detected" / rejection UX (NT-7).** Silent, gentle notice, or retry affordance for `NO_TRANSACTION_VALUE_DETECTED`.
- **Multi-currency input.** Out of v1 single-currency scope; intended behaviour on encountering a non-default currency is undecided.
- **Borderline "strong recurring context" lean (RC-5).** The behaviour is fixed as evidence-based (no numeric threshold); the precise cut between "strong context → recurring" and "one-time" for borderline phrasings is deferred to the architecture/technical-contract phase (mechanism, not behaviour).

---

## 19. Requirements Summary

**Critical requirements (must hold or the ledger can be silently corrupted / a boundary bypassed):**
- Never invent critical financial data — neither the model nor the application (SP-2, CF-1, AM-1, ER-1/ER-2).
- Unresolved critical fields stay genuinely unset and honestly represented; a flag must match true state (SP-3, SP-4, SP-10, CF-2, ER-8, UC-1).
- Approval is a real, gated safety boundary; critical uncertainty is non-approvable; nothing auto-posts; bulk/one-tap are gated (SP-5, UC-2, AP-1/AP-2/AP-3/AP-5).
- Application rules are authoritative over model output, including under injection (SP-6, SP-9, PI-1..PI-5).
- Amounts and dates are extracted/resolved, never fabricated; unresolvable amounts have one consistent outcome (AM-1..AM-4, AM-8, TM-6).
- A number alone is not a transaction; non-transactional input yields no phantom row (NT-1).
- A grounded **amount is the candidate threshold**: no amount (or an indefinite one) → `NO_TRANSACTION_VALUE_DETECTED` rejection, never a queued/guessed row (TI-5, AM-2/AM-3/AM-10, NT-8).

**High-priority requirements:**
- One utterance may yield multiple **independent candidates**; no silent drop/merge; preserve per-intent amount+category (CS-1/CS-2), without over-engineering ordinary single payments (CS-3).
- **Bill Split** is a dedicated operation requiring explicit split evidence, with participants resolved not invented (BS-1..BS-5).
- **Recurring** is a dedicated, evidence-based operation (no numeric threshold); the app owns execution and nothing auto-posts (RC-1/RC-5/RC-6/RC-7).
- Classify by the described action; surface action-vs-label conflicts (TI-1, UC-3).
- Resolve relative dates against a supplied reference date (TM-1/TM-2).
- Honest, risk-proportionate uncertainty that the *application* classifies as blocking or not (UC-3/UC-5).
- Coherent unresolved-person lifecycle (ER-7); ambiguity/multiple-match handling (ER-6); preserve good amount phrasing (AM-9).

**Resolved product decisions (§18A):** amount = candidate threshold (missing → rejection); multiple independent candidates; Bill Split as an explicit-evidence dedicated operation; Recurring as an evidence-based dedicated operation with app-owned execution; missing category enters queue but blocks approval and is never defaulted. **Still-open decisions (§18B):** approximate amounts, fuzzy matching, time-of-day, future-date signalling, rejection UX, multi-currency.

**Capabilities that must be ADDED (currently unrepresentable):** multiple independent candidates from one input; a dedicated **Bill Split** operation/workflow (explicit-evidence gated); a dedicated **Recurring** operation/workflow with app-owned execution; a supplied reference date + relative-date resolution; a genuine "unresolved/unset" critical-field state; a conflict/uncertainty signal; a `NO_TRANSACTION_VALUE_DETECTED` rejection outcome and an "unsupported/non-transactional" outcome; per-field provenance; the two-tier candidate-threshold vs approval-eligibility gating.

**Existing behaviours that must be REMOVED/changed:** silent default of unresolved account→first account, category→alphabetical-first/"Other", destination→arbitrary account, and lending direction→`lend`; acceptance of any positive/fabricated/indefinite number as an amount (and queuing it); flattening recurring or split intent into a single one-time expense; non-blocking decorative flags; approval as a bare status flip (bulk/one-tap included).

**Existing safeguards that must be PRESERVED:** pending-by-default with mandatory human approval; approved-only balance/report accounting; discriminated-union invariants enforced at the write boundary; entity resolution that can only select real user-authorised entities (never a phantom); no-loss retry on failure; secure API-key storage.

---

## Final Question

**"Does this requirements specification provide enough behavioural clarity to design Transaction AI Architecture v1?"**

**YES — architecture design can proceed.**

- The **safety core** is fully specified: no invention (model or app), genuine unset states, honest flags, gated approval, application-authoritative validation, injection-as-data, and consistent amount/date handling.

- The **four decisions that previously gated the structural design are now resolved** (§18A): (1) ambiguity/missing-field handling — amount is the candidate threshold, missing amount rejects, other missing fields hold in the queue and block approval; (2) multiple transactions — separate independent candidates; (3) recurring — dedicated, evidence-based, app-owned execution, in-queue; (4) missing category — enters queue, blocks approval, never defaulted. **Bill Split** is additionally resolved as an explicit-evidence dedicated operation.

- The remaining open items (§18B — approximate amounts, fuzzy matching, time-of-day, future-date signalling, rejection UX, multi-currency) are **refinements** that can be defaulted conservatively and settled during or after architecture without invalidating the structure.

**Recommendation:** Transaction AI Architecture v1 design may begin. The structural shape is now determined: a two-tier candidate model (grounded-amount threshold → approval-eligibility gate), zero/one/many candidates per input, six routed operations (four ordinary + Recurring + Bill Split), genuinely-unset critical fields with honest provenance, and a rule-based approval gate. The §18B refinements should be tracked but do not block design.

*End of requirements specification. This revision updated the requirements document only — no application code, prompts, schemas, or validation were modified.*
