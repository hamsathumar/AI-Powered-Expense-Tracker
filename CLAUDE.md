# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

# Kaasu — Personal Expense Tracker

Private, single-user, **voice-first** expense tracker for iOS. Personal use
only — never published to app stores. The owner is learning mobile development
through this project (background: web React/Node): briefly explain new React
Native/Expo concepts as they appear; don't re-explain web React concepts.

## Commands

```bash
npm start                      # Metro + hot reload (daily work)
npx expo run:ios --device      # build/install dev build; also re-signs weekly
npx expo prebuild              # REQUIRED after app.json / native-plugin changes (run:ios skips it)
npm run lint                   # expo lint (ESLint 9, eslint-config-expo)
npx tsc --noEmit               # typecheck
npm test                       # jest (ts-jest, node env, src/**/*.test.ts only)
npx jest src/domain/money      # single test file (path pattern)
npx jest -t "rounding"         # single test by name
GEMINI_API_KEY=... npx jest liveEval   # live model eval (skipped without key)
```

Tests run in plain node — no React Native runtime — so logic worth testing
must live in pure modules (`src/domain/`, `src/ai/interpretation/`,
`db/queries/*Sql.ts`). `@/` aliases `src/`. `android/` and `ios/` are
generated native projects.

## Architecture

- **Layering:** `src/domain/` (pure money/business logic + types, no I/O) →
  `src/db/queries/` (typed SQLite access; `getDb()` in `db/client.ts` is a
  memoized singleton that runs migrations on open) → screens/components in
  `src/app/` (expo-router file routes; tabs in `(tabs)/`) and `src/components/`.
- **Migrations** (`db/migrations.ts`): ordered list keyed by
  `PRAGMA user_version`, each applied in one transaction. Never edit a shipped
  migration — append a new one.
- **Voice/AI pipeline** (`src/ai/`): audio → Gemini (`geminiInterpret.ts`,
  schema in `interpretSchema.ts`, prompt in `interpretPrompt.ts`) → raw
  interpretation → deterministic `interpretation/` stages (`validate`,
  `resolve` entity references, `dates`, `naming`, `injection`) → queued as
  `pending_operations` → `gate.ts` `evaluateApproval` (the single
  authoritative pre-commit check, used by single, bulk and "approve now") →
  `commitOperation.ts` writes transactions (always `pending`). The model never
  writes to the DB; everything it says is re-grounded against the transcript
  and existing entities. Parse requests run through a durable job queue
  (`voiceJobRunner.ts`, `voice_jobs` table, `state/VoiceJobs.tsx`) so they
  survive backgrounding.
- **Provider stack** in `src/app/_layout.tsx` wires theme, feedback
  (haptics/motion), pending-count and voice-job contexts, and
  `GestureHandlerRootView`.

## Source of truth

The three planning docs in `Planning session/` are canonical and override
generic skill recommendations:

- `expense-tracker-spec.md` — what the app does: entities, the 4 transaction
  types, Bill Splitter, Recurring, Voice/LLM layer, Approval Queue, screens
- `technical-plan.md` — stack, SQLite schema, domain logic/balance math,
  Gemini integration, **build order (§7)**
- `design-system.md` — colour tokens, typography (Sora + Inter), components,
  motion, anti-patterns. Overrides any generic design skill.

For the voice/AI layer specifically, `Test/` holds the AI blueprint. Read
`TRANSACTION_AI_AMENDMENTS.md` **first** — newest part (V1.3) first, then
V1.2 and V1.1. It records every change made after real-world testing
(`AI_TEST_CASE_LOG.md`, all rounds) and the 2026-08-25 pipeline audit
(`AI_PIPELINE_AUDIT_2026-08-25.md`), and points into the V1 constitution /
architecture / technical-contract documents. Section numbers (§) restart in
each part — cite "V1.1 §10" or the amendment letter (A…AH, unique).
`Test/archive/` holds historical documents (`CURRENT_AI_ARCHITECTURE_AUDIT.md`,
`AI_TEST_ANALYSIS.md`) — evidence lineage only, do not act on them. How to
record a new test case: `Test/AI_TESTING_GUIDE.md`.

## Stack

Expo SDK 57 (React Native 0.86, React 19, TypeScript), expo-router (routes in
`src/app/`), expo-sqlite, expo-secure-store, **expo-audio** (NOT expo-av — it
was removed from the SDK), date-fns, StyleSheet + theme context (no Tailwind).
Gemini API for voice→JSON parsing — built **last** (stage 9).

Dev flow: **local development build** (`npx expo run:ios --device`, phone
plugged in + unlocked), then `npm start` + hot reload for daily work. NOT Expo
Go — the App Store's Expo Go in the user's region is stuck on SDK 54 and can't
load this SDK 57 project. Do not downgrade the SDK to chase Expo Go. Free
Apple ID signing expires weekly → re-run `expo run:ios` to re-sign.

## The golden rule (most important logic in the app)

Only `expense` and `income` count toward spending/earning reports. `transfer`
and `lending` are pure money movements: they affect account balances (lending
also affects person balances) but must NEVER appear in spending/income reports
or category breakdowns.

**Private accounts** (migration 8, `accounts.is_private`) are the one
deliberate extension: a private account's own expense/income never reaches
personal reports or Home totals, and a transfer that CROSSES the boundary is
re-typed — personal → private counts as an expense ("Moved to private"),
private → personal as income ("Back from private"). Transfers within one side
and all lending still never count. It lives in ONE place,
`reportSql.reportRowsSql` (every report builder reads from it), mirrored for
the Accounts day header by `dayNetMinor(..., privateAccountIds)`. Picking a
private account in the Reports filter shows its own report. Person balances
still include lending done through a private account.

## Non-negotiable conventions

- **Money is INTEGER minor units (cents). Never floats.** Amounts stored
  positive; direction derives from `type`/`direction`, never a sign.
- Transaction types are a **TypeScript discriminated union** — illegal states
  unrepresentable (e.g. no category on transfer/lending).
- **Never hardcode colours, spacing, or font sizes** — always read theme
  tokens (`src/theme/tokens.ts`).
- Every transaction is born `status = 'pending'` (statuses: pending /
  approved / rejected — no "edited" state); **only approved rows count**
  toward any balance, report, or total.
- Never signal meaning by colour alone — always pair with sign/icon/label.
- **Build strictly one stage at a time** per `technical-plan.md` §7; finish
  and verify each stage (on the physical device) before starting the next.
- Money math must have unit tests (technical-plan.md §8).

## Key decisions (resolved 2026-08-09, reflected in the docs)

- **App name: Kaasu** ("money" in Tamil/Malayalam).
- **Bill split when someone else paid:** generate a **borrow + expense pair**
  at split time — net-zero on the account, spending reported on the bill's
  date with the right category. Settlement is a plain repayment (not spending).
- Bill-split transactions are approved **independently** in the queue (not
  atomic as a group).
- Settle Up prefills from the approved-only balance, with a hint when pending
  lending rows exist.
- Single currency for v1, stored in `settings` — no currency column on
  transactions.

## Status

- Stage 1 ✅ (2026-08-09): template cleaned, theme tokens + ThemeContext,
  Sora/Inter fonts, four-tab skeleton; verified on iPhone via local dev build.
- Stage 2 ✅ (2026-08-09): DB layer — schema v1 + migration runner
  (`PRAGMA user_version`), seeded categories, domain types (discriminated
  union), typed queries with §4.2/§4.3 balance math in SQL; verified on-device
  via the TEMPORARY `src/app/dev-db.tsx` screen (remove in Stage 3, along
  with the Test Cash/Test Kamal rows it created).
- Stage 3 ✅ (2026-08-09): money format/parse (`src/domain/money.ts`), Amount /
  TypeSelector / ChipSelector / AmountInput / TransactionRow components,
  type-conditional form (`transaction/new.tsx`, saves as pending), recent list
  on Home, native iOS date-time picker (design-system §5.9), migration 2
  removed Stage-2 test rows; all four types verified on-device.
- Stage 4 ✅: Accounts + Categories management (shared AccountForm/CategoryForm,
  soft-delete archive, icon/colour pickers from `categoryPalette`).
- Stage 5 ✅: Dashboard (BalanceHero) + Reports (category bars, month nav);
  golden rule in `src/db/queries/reports.ts`; money math extracted to pure
  `src/domain/rules.ts` with jest tests (`npm test`).
- Stage 6 ✅: People + Lending + Settle Up (worded balances, approved-only
  prefill with pending hint — decision P8).
- Stage 7 ✅: Bill Splitter — pure `src/domain/billSplit.ts` (borrow+expense
  pair for Case B), atomic insert, rounding tests.
- Stage 8 ✅: real Approval Queue (grouped, approve/edit/reject/bulk, tab
  badge via `PendingCountProvider`) + Recurring templates (pure
  `src/domain/recurring.ts`, idempotent foreground evaluation). Long-press
  hack removed.
- Stage 9 ✅: Voice + Gemini — `src/ai/` (prompt, validate [tested], gemini
  REST client on the stable generateContent endpoint, parseVoice orchestrator),
  API key in expo-secure-store via Settings, model is a user setting
  (default `gemini-3.5-flash-lite` since 2026-10-07 — 2.5-flash now 404s), expo-audio capture screen, floating mic on Home.

- **Transaction AI V1.1 ✅ (2026-08-21):** second-round test evidence
  (`Test/AI_TEST_CASE_LOG.md`, TC-021…TC-027) closed. Seven amendments —
  duplicate suppression for split/recurring, shape-based injection detection,
  entity-reference containment (incl. a guard on `createPerson` itself),
  app-owned Title Case naming, recurrence end conditions, and a durable
  voice-parse job queue (`voice_jobs`, migration 5) that survives
  backgrounding and app kill. Blueprint updated in
  `Test/TRANSACTION_AI_AMENDMENTS.md` (V1.1) + amendment blocks in the three V1
  docs. **Needs `npx expo prebuild` before the next run** — `expo-notifications`
  was added to `app.json`.

- **Reports v2 ✅ (2026-08-23):** the Reports tab rebuilt around one shared
  period + filter. `src/domain/reportRange.ts` (pure, tested) owns presets
  (daily/weekly/monthly/yearly/custom), previous-period comparison, and the
  trend chart's buckets; `db/queries/reports.ts` gained range+filter aware
  queries (`getRangeSummary`, `getDailyTotals`, `getBreakdown`,
  `getSliceStats`, `listSliceTransactionIds`) that still enforce the golden
  rule in SQL. New UI in `src/components/reports/` (balance card with
  vs-previous deltas, Quick Insights, bar/line TrendChart, Dropdown,
  BreakdownRow, filter sheet) plus a drill-down route
  `src/app/reports/[dim]/[id].tsx`. Breakdowns slice by category / account /
  person / recurring-vs-one-off, for spending or income.
  The SQL itself lives in a pure `db/queries/reportSql.ts` (no db handle) so
  `reportSql.test.ts` can execute every statement against a real engine via
  node's built-in `node:sqlite`, using the schema read straight out of
  `migrations.ts`. **Add report SQL there, not inline** — a `GROUP BY` on an
  output alias shipped broken precisely because no test ever ran the SQL.

- **Feel pass ✅ (2026-08-23):** motion + haptics applied across the app, not
  just the voice flow. `src/theme/FeedbackContext.tsx` owns the two prefs
  (haptics on/off, motion full/reduced) and resolves them against the OS
  reduce-motion request — **the OS always wins**; the app switch can only
  reduce further. Haptics are gated in one place (`lib/haptics.setHapticsEnabled`)
  so non-component code can fire them. Durations live in `tokens.motion` —
  never hardcode a millisecond. New: `ScreenFade` (tab content entrance —
  the Tabs navigator stays on instant switching, see below), `AnimatedAmount`
  (count-up, pure maths in `domain/countUp.ts`), `SwipeableRow` (needs the
  `GestureHandlerRootView` now mounted in `_layout`), `TransactionPeek`
  (long-press). Sliding indicators on SegmentedControl/TypeSelector, donut
  sweep-in, trend bars growing, pull-to-refresh on Home/Accounts/Reports.
  **Do not re-add `animation: 'shift'` to the Tabs navigator** — it caused the
  blank-tab regression; animate content with `ScreenFade` instead.

- **AI audit + V1.2 Phase 1 ✅ (2026-08-25):** full pipeline audit
  (`Test/AI_PIPELINE_AUDIT_2026-08-25.md`, findings F1–F11) followed by the
  Phase 1 fixes (`Test/TRANSACTION_AI_AMENDMENTS.md` (V1.2)): anaphoric amounts
  ("that amount") grounded by reference with a confirm conflict; Tamil/mixed
  amount expressions grounded (prompt guarantees digits in `expression`);
  un-resolvable date expressions and AMBIGUOUS amounts now block via
  conflicts; yearly-cadence fallback surfaced in the recurring editor; Gemini
  key moved to a header. New suite `src/ai/interpretation/audit.test.ts`.
  The on-device live transcript is **deliberately display-only** — never wire
  it into interpretation.

- **V1.2 Phase 2 ✅ (2026-08-25):** rejections became recoverable. An intent
  heard without an amount is now **queued** (migration 6 allows a NULL
  `pending_operations.amount`) as a visibly incomplete card the gate refuses to
  commit, instead of being discarded; the review screen edits amount, name and
  date (not just entities), gating on the edited operation; the relative-date
  grammar covers "last month", "the 15th", "15 August", ISO, time-of-day; and
  misheard entity names surface as near-match suggestions that stay
  `ambiguous`. New suites `audit2.test.ts` + `migration6.test.ts` (the latter
  runs shipped migration SQL against a real engine — do that for any future
  table rebuild). Phase 3 (few-shot + responseSchema + two-stage/eval harness)
  approved, not yet built.

- **V1.2 Phase 3 ✅ (2026-08-25):** the model's own reading got better.
  Seven worked examples in the system instruction (`interpretPrompt.ts`); a
  declared Gemini `responseSchema` (`interpretSchema.ts`) + temperature 0, with
  a **retry-without-schema fallback** so a rejected schema degrades instead of
  breaking voice; a **compound-utterance critic** (`critic.ts`) that re-reads
  long/multi-amount utterances for dropped or double-counted money, contained
  by a deterministic "the amount must appear in the transcript" check and
  re-validated through the normal gate; and an **eval harness** (`src/ai/eval/`)
  — `eval.test.ts` replays recorded model outputs in `npm test`,
  `GEMINI_API_KEY=... npx jest liveEval` scores the real model against the
  corpus. **Run the live eval after any prompt/model/schema change**, and add a
  corpus case whenever something reads wrong. Production deliberately stays a
  single audio→JSON call; only a text entry point was added.

- **People & lending pass (2026-10-06):** negative opening balances (sign is a
  separate +/− control — the decimal pad has no minus; editing an opening
  balance on an account with history asks first). One shared lending mapping,
  `domain/lendingPresentation.ts` — `lent` (plum) / `borrowed` (orange) tones,
  a distinct icon per direction, and a sign that means **effect on what the
  person owes you** (lend +, repaid-to-you −, borrow −, repaid-by-you +) — used
  by `<Amount direction>` and every lending row. Person screen grouped by day
  with an end-of-day running balance (`domain/personStatement.ts`, shared with
  the PDF). People reorder by hold-and-drag (`components/SortableList.tsx`,
  migration 7 `people.sort_order`; Manual / A–Z / Owed, manual order also
  drives pickers; voice resolution uses `listPeople('name')`). PDF statement
  export on the person profile (`expo-print`, `domain/personStatementHtml.ts`,
  presets in `domain/statementPeriod.ts`). **Needs `npx expo prebuild` +
  `npx expo run:ios --device`** — `expo-print` is a new native module.
- **Voice "Logged" cards stay in sync (2026-10-06):** pending AI operations are
  deleted on both approve and reject, so `state/pendingOutcomes.ts` records
  what happened to each one; every consumer (Approve now, review screen, Home
  queue, bulk approve, bill-split/recurring editors) goes through
  `commitPendingOperation` / `rejectPendingOperation` /
  `markPendingOperationSaved`. Never delete a pending operation directly.
- **Transaction AI V1.3 — Phase A ✅ (2026-10-07):** third test round
  (`Test/AI_TEST_CASE_LOG.md`, TC-028…TC-040) — read
  `Test/TRANSACTION_AI_AMENDMENTS.md` (V1.3) FIRST for the AI layer now.
  App-side only: action-vs-label conflicts app-owned (`finalizeConflicts`);
  one message per problem + `issues.ts` `describeIssues` shared by the Logged
  card / Home queue; `toAccount` used as the account for income/lending when
  `account` is empty; `resolveAccountRef` strips generic words ("BOC bank
  account" → BOC, type-checked); amountless-intent dedup; dates carry a clock
  time (bare hour → "morning or evening?"); bill split has a When field;
  whole-balance repayments filled from the approved balance with confirmation.
  Tests: `src/ai/interpretation/v13.test.ts`.
- **V1.3 Phase B ✅ (2026-10-07):** contract gained `note` (saved as the Note)
  and `paidBy` (expense → atomic borrow + expense pair via
  `toNewTransactions`); prompt rules + worked examples #8–#12 (notes, labels
  are names, on-behalf = lend, paid-by, ATM = transfer to "Cash"); accounts
  shown to the model with their type; critic ignores numbers inside notes;
  backstops: `note_not_transaction` conflict, withdrawal-as-expense blocks,
  withdrawal transfer → unique "Cash". "Confirm & approve" is an allow-list
  (figure/day confirmations only). Eval corpus EV-16…EV-27. Live eval
  27/27 on `gemini-3.5-flash-lite` (2026-10-07; backstop cases are
  `offlineOnly`). Verified on-device 2026-10-07.
- **V1.3 Phase C ✅ (2026-10-07):** voice diagnostics — `src/ai/diagnostics.ts`
  (pure), migration 9 `voice_jobs.diagnostics` (latest 50 kept),
  `ResolvedOperation.voiceJobId`, `VoiceDiagnosticsSheet` behind **Why?** on
  the Logged screen and the review screen, Share = plain-text report. When a
  voice reading is wrong, ASK FOR THE SHARED REPORT before guessing.
- **Private accounts (2026-10-06):** see the golden-rule note above. Toggle in
  the account form (confirmed when the account has history); lock + "Private"
  label on account cards, rows, detail, PDF; CSV gains a `Private` column;
  Home/Reports total balance is personal-only; Recurring forecast skips
  private templates.

**MVP build (stages 1–9) complete.** Money math + validation covered by jest
(`npm test` — 575 tests, plus 16 skipped live-eval tests). Gemini model name is user-editable in Settings —
change it if Google deprecates the default. To re-sign weekly:
`npx expo run:ios --device`.
