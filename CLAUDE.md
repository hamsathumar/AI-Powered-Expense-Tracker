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

## Stack

Expo SDK 57 (React Native 0.86, React 19, TypeScript), expo-router (routes in
`src/app/`), expo-sqlite, expo-secure-store, **expo-audio** (NOT expo-av — it
was removed from the SDK), date-fns, StyleSheet + theme context (no Tailwind).
Gemini API for voice→JSON parsing — built **last** (stage 9). Dev flow: Expo Go
on iPhone 12 Pro via QR code.

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

Stage 0 complete: planning docs finalized; SDK 57 default template scaffolded
(still contains demo screens and blue template branding — cleanup is part of
Stage 1). Next: Stage 1 (environment + scaffold, running on the iPhone).
