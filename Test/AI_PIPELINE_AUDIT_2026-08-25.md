# Kaasu AI Pipeline Audit — 2026-08-25

**Type:** Full audit of the voice → Gemini → validation → approval-queue
pipeline. Covers `src/ai/` end to end, the queue/commit path, and all eleven
docs in `Test/`.
**Requested by the owner** with the goal: the app should understand natural,
conversational speech — long, complex, mixed-language — and record what the
user *meant*.
**Resolution status: CLOSED.** All three phases implemented 2026-08-25 —
see `Test/TRANSACTION_AI_V1_2_AMENDMENTS.md` (Amendments H–U). Every finding is
fixed, mitigated, or explicitly declined; the table below records which.

---

## Verdict

The safety architecture is mature: every boundary designed after the two test
rounds holds in the code as written, and the docs match the implementation.
The remaining distance to the goal is an **understanding-and-recovery**
problem, not a safety problem: validation is over-strict in exactly one place
(amount grounding), the model gets no worked examples and no second chance on
complex utterances, and what validation rejects disappears almost silently
instead of being recoverable.

**Docs-drift check:** the feared "contradictory iterations" residue does not
exist. The pre-V1 pipeline is fully deleted; V1.1 amendments accurately
describe the code; tests pin all past fixes. Only
`Test/CURRENT_AI_ARCHITECTURE_AUDIT.md` is stale (it describes the pre-V1
code) — now carries a HISTORICAL banner.

## Verified strengths

1. Structural instruction/data boundary (rules in `system_instruction`; audio
   is the only user-turn content).
2. Three-tier untrusted contract (Raw → Validated → Resolved); grounding
   recomputed app-side; model ids never read.
3. No invention: no first-entity fallback, no defaulted account, no fabricated
   amount survives validation (TC-012/TC-015 class structurally dead).
4. One commit path, gated twice — re-resolution against live data + the
   deterministic gate re-run at commit; bulk/single/inline all funnel through it.
5. Injection containment in depth: prompt → shape-based detection →
   entity-reference quarantine → `createPerson` DB-boundary guard.
6. Durable `voice_jobs` queue with suspension-aware retry.
7. Dates resolve against capture time, not approval time.
8. Pure-logic test discipline (300+ tests; SQL run against a real engine).

## Findings

| # | Finding | Severity | Status |
|---|---|---|---|
| F1 | Anaphoric amounts dropped — "that amount" fails `computeGrounded()` (no digits in expression); transaction demoted to unqualified intent and lost | High | **Fixed** — V1.2 Amendment H |
| F2 | Grounding + injection detection English-only; Tamil amounts survive only because Gemini happens to normalise to digits | High | **Fixed** (grounding) — V1.2 Amendment I; injection detection still English-only (accepted, revisit Phase 3) |
| F3 | Unqualified intents invisible & not durable — only a count survives (`voice_jobs.unqualifiedCount`); nothing to see or complete | High | **Fixed** — V1.2 Amendment N (migration 6) |
| F4 | Unsupported date expressions silently commit as capture day (`toNewTransaction` ignores `resolved:false`); narrow date grammar | Medium | **Fixed** — blocking conflict (Amendment J) + extended grammar (Amendment P) |
| F5 | Review screen can't edit amount, date, or name — near-miss forces reject-and-retype | Medium | **Fixed** — V1.2 Amendment O |
| F6 | `Amount.state === 'AMBIGUOUS'` dropped after validation; `confidenceFlags` hardcoded `[]`; TC-011/019 signal had no channel | Medium | **Fixed** — V1.2 Amendment K |
| F7 | `yearly` recurrence hint silently mapped to monthly (prefill AND end-date arithmetic) | Medium | **Mitigated** — explicit editor alert (V1.2 Amendment L); real yearly support open |
| F8 | Accuracy ceiling: one zero-shot flash call, no few-shot examples, no `responseSchema`, temp 0.2 | Medium | **Fixed** — V1.2 Amendments R (few-shot), S (schema + temp 0), T (critic), U (eval harness). Production stays single-call on audio by design — see Amendment U |
| F9 | On-device transcript unused by interpretation | — | **Declined by owner** — it is deliberately display-only; do not wire it in |
| F10 | Entity resolution exact-match only; misheard names cost manual taps | Low | **Fixed** — V1.2 Amendment Q (suggested as `ambiguous`, never auto-resolved) |
| F11 | Hygiene: API key in URL; bulk-approve N+1 context loads; month-end overflow in "until <month>"; undocumented person-tag drop | Low | **Fixed** — V1.2 Amendment M |

## Requirements scorecard (against `AI_TEST_ANALYSIS.md` R1–R12)

**All twelve are now addressed in the implementation.** R4 and R11 (Partial in
the original audit) are closed by Amendments J/P and K/N/O. R1 — compound
input, the one that stayed model-dependent — is now defended in three places:
worked examples in the prompt (R), an auditor that re-reads compound utterances
for money that went missing (T), and corpus cases that make a regression
visible (U).

The honest caveat: R1 is defended, not *proven*. It depends on model behaviour,
which is why Amendment U exists — `npx jest liveEval` is how the claim gets
re-checked after any prompt, model, or schema change.

## Plan — all phases complete (2026-08-25)

- **Phase 1:** F1, F2, F4-first-half, F6, F7-note, F11.
- **Phase 2:** F3 (queued needs-amount items, migration 6), F5 (review-screen
  amount/date/name editing), F4-second-half (extended date grammar), F10
  (near-match suggestions).
- **Phase 3:** F8a (seven worked examples), F8b (`responseSchema` +
  temperature 0, with a degrade-not-break fallback), F8d (compound-utterance
  critic with a deterministic containment check), F8c (eval corpus — offline
  replay in `npm test`, live scoring behind `GEMINI_API_KEY`). Production
  remains a single audio call by design; only the text entry point was added.

## Where to go next

Nothing in this audit is outstanding. The natural next step is **evidence, not
code**: run `npx jest liveEval` against the real model, and keep using the app.
When something reads wrong, add it to `src/ai/eval/corpus.ts` as a case and to
the test log — the corpus is now the cheapest place in the project to pin a
failure so it cannot come back.
