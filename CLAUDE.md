@AGENTS.md

# Kaasu — Personal Expense Tracker

Private, single-user, **voice-first** expense tracker for iOS. Personal use
only — never published to app stores. The owner is learning mobile development
through this project (background: web React/Node): briefly explain new React
Native/Expo concepts as they appear; don't re-explain web React concepts.

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
`TRANSACTION_AI_V1_1_AMENDMENTS.md` **first** — it records what changed after
real-world testing and points into the V1 constitution / architecture /
technical-contract documents.

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
  (default `gemini-2.5-flash`), expo-audio capture screen, floating mic on Home.

- **Transaction AI V1.1 ✅ (2026-08-21):** second-round test evidence
  (`Test/AI_TEST_CASE_LOG_v2.md`, TC-021…TC-027) closed. Seven amendments —
  duplicate suppression for split/recurring, shape-based injection detection,
  entity-reference containment (incl. a guard on `createPerson` itself),
  app-owned Title Case naming, recurrence end conditions, and a durable
  voice-parse job queue (`voice_jobs`, migration 5) that survives
  backgrounding and app kill. Blueprint updated in
  `Test/TRANSACTION_AI_V1_1_AMENDMENTS.md` + amendment blocks in the three V1
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

**MVP build (stages 1–9) complete.** Money math + validation covered by jest
(`npm test` — 236 tests). Gemini model name is user-editable in Settings —
change it if Google deprecates the default. To re-sign weekly:
`npx expo run:ios --device`.
