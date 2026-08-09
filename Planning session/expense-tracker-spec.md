# Kaasu — Functional Specification

**Purpose of this document:** a complete functional and data spec for a personal
(single-user, not published to app stores) expense tracking app with voice-driven
entry powered by an LLM. Written to be handed to an AI coding assistant to scaffold
and implement. Design inspired by the Paisa expense tracker app (UI/UX patterns
only — no code or assets reused from Paisa).

**Platform:** Mobile app — React Native via Expo (decided; see `technical-plan.md`).
**Backend:** Local-first (on-device SQLite or similar). No multi-user, no server
sync required for v1.
**AI layer:** Google Gemini API (via Google AI Studio) for voice/text transcript
→ structured transaction parsing. Gemini accepts audio input directly, so a
separate speech-to-text step is optional.

---

## 1. Core Principle

Every real financial fact in the app is a **Transaction**. Accounts, Categories,
and People are lookup/tag entities that transactions attach to. Dashboards and
reports are **computed views** over transactions — nothing is double-stored.

A second core principle: **nothing is final until approved.** Every transaction,
regardless of source (voice, recurring, manual), enters the system with
`status = pending` and sits in an **Approval Queue**. Only `approved` transactions
count toward balances, reports, and person balances. This lets the user rapid-fire
log transactions by voice all day with zero friction, then batch-review at a
convenient time (e.g., at night).

---

## 2. Transaction Types

There are exactly **four** transaction types. Get the semantics of each right —
this is the most important part of the data model.

### 2.1 Expense
- Money leaves one Account.
- Requires a Category (from the expense category set).
- Person is optional (e.g., "paid the plumber" — no need to track a person).
- Counts toward spending totals, category breakdowns, and reports.

### 2.2 Income
- Money enters one Account.
- Requires a Category (from the income category set — separate list from expense
  categories).
- Person is optional.
- Counts toward earning totals and reports.

### 2.3 Transfer
- Money moves between **two of the user's own Accounts** (from → to).
- No Category. No Person.
- Net effect on total balance across all accounts = zero.
- Does NOT count as spending or earning — excluded from expense/income reports.

### 2.4 Lending
- Money moves between the user and a **Person** (not one of the user's own
  accounts).
- No Category.
- Does NOT count as spending or earning — excluded from expense/income reports.
  This is a money *movement*, not spending, and must never inflate expense totals.
- Two directions, both handled by this one type with a sign/direction flag:
  - **Lend out**: user's account balance decreases; the Person's balance owed
    *to* the user increases.
  - **Repayment received**: user's account balance increases; the Person's
    balance owed to the user decreases (reverses the lend).
  - **Borrow** (mirror case): user's account balance increases; the Person's
    balance owed *by* the user increases.
  - **Repayment made**: user's account balance decreases; the Person's balance
    owed by the user decreases.
- All four of the above are the same `Lending` type with a `direction` field —
  do not create separate types for lend/borrow/repay.

**Golden rule:** Only Expense and Income affect spending/earning reports.
Transfer and Lending are pure money-movement and must be excluded from those
calculations, but Transfer and Lending DO affect individual Account balances,
and Lending affects Person balances.

---

## 3. Entities

### 3.1 Account
| Field | Type | Notes |
|---|---|---|
| id | uuid | |
| name | string | e.g. "Commercial Bank" |
| type | enum | Bank, Card, Cash |
| owner_label | string | optional, e.g. account holder name |
| currency | string | set at onboarding, one default currency for v1 |
| icon / color | string | for UI |
| balance | computed | opening_balance + sum of approved transactions affecting this account |

### 3.2 Category
| Field | Type | Notes |
|---|---|---|
| id | uuid | |
| name | string | |
| type | enum | `expense` or `income` — two separate lists, never shared |
| icon / color | string | |
| is_default | bool | seeded vs. user-created |

Transfer and Lending transactions never have a category.

### 3.3 Person
A first-class entity, not just a tag — linked from Expense (optional),
Income (optional), and Lending (required) transactions, and from Bill Splitter.

| Field | Type | Notes |
|---|---|---|
| id | uuid | |
| name | string | |
| net_balance | computed | positive = they owe the user; negative = user owes them |
| is_unresolved | bool | true if created from an unrecognized voice name (see §6) |

Person detail screen should show: net balance, full transaction history involving
them, and a **"Settle up"** action (see §3.5).

### 3.4 Transaction
| Field | Type | Notes |
|---|---|---|
| id | uuid | |
| type | enum | Expense, Income, Transfer, Lending |
| status | enum | `pending`, `approved`, `rejected` — editing a pending item keeps it `pending` until approved; there is no separate `edited` state |
| name | string | short title, e.g. "Boarding Rent" |
| amount | integer | **minor units (cents), always positive** — direction of money flow derives from `type`/`direction`, never a sign |
| description | string | optional |
| date, time | datetime | |
| account_id | uuid | required for Expense/Income/Lending; both from+to for Transfer |
| to_account_id | uuid | Transfer only |
| category_id | uuid | Expense/Income only |
| person_id | uuid | required for Lending; optional for Expense/Income |
| direction | enum | Lending only: `lend`, `lend_repayment_received`, `borrow`, `borrow_repayment_made` |
| source | enum | `voice`, `manual`, `recurring`, `bill_split` |
| transcript | string | original spoken text, if source = voice (shown in queue for verification) |
| confidence_flags | array | see §6, e.g. `["unrecognized_name", "low_confidence_amount"]` |
| linked_bill_split_id | uuid | optional, see §4 |
| linked_recurring_id | uuid | optional, see §5 |

**Currency:** v1 is single-currency. The default currency lives in `settings`,
not on each transaction row. (The voice/LLM contract still returns a `currency`
field, which validation sanity-checks against the default — see §6.)

### 3.5 Settle Up (person-level action, not a separate entity)
Pre-fills a Lending transaction (repayment direction) between the user and a
selected person, defaulting to their current outstanding balance but editable
for partial settlement.

The prefilled amount is computed from **approved** transactions only. If the
person has pending lending transactions not reflected in that number, show a
hint (e.g. "2 pending items not included") so the prefill is never silently
misleading.

---

## 4. Bill Splitter

**Bill Splitter is not a separate storage entity — it's a transaction generator.**
Given a total amount, a category (for the user's own share), a list of
participants, and who paid, it creates a set of Transactions atomically.

### Inputs
- Total amount
- Category (for the payer's own share — e.g. Food)
- Participants (list of People; user may or may not include themselves)
- Split method: equal or custom amounts per participant
- Who paid (the payer — either the user, or one of the participants)

### Logic — Case A: User is the payer
The full amount leaves the user's account. It generates:
1. **One Expense transaction** for the user's own share, categorized normally
   (e.g. Food) — this is real spending and appears in reports.
2. **One Lending transaction per other participant** (direction = `lend`) for
   their share — they now owe the user that amount. These do NOT appear in
   expense reports.

Example: Rs1500 lunch, split 3 ways equally, user paid.
→ Expense Rs500 (Food, user's own account) + Lending Rs500 owed by Person A
(direction=lend) + Lending Rs500 owed by Person B (direction=lend).
Total money that left the account = Rs1500, but only Rs500 counts as the
user's spending.

### Logic — Case B: Someone else is the payer (DECIDED)
No money leaves the user's account at the time of the bill, but the user's
share IS real spending and must appear in reports on the bill's date. It
generates a **pair** of transactions for the user's share:
1. **One Lending transaction** (direction = `borrow`) — money "in" from the
   payer, owed back to them. Affects the person balance (user owes payer).
2. **One Expense transaction** for the same amount, categorized normally
   (e.g. Food) — this records the real spending.

Net effect on the user's account balance is **zero** (borrow in + expense
out), which is correct: no money actually moved. The person balance shows the
debt, and spending reports show the expense with the correct date and
category.

When the user later pays the person back, use **Settle Up** (§3.5), creating a
`borrow_repayment_made` Lending transaction — money leaves the user's account
at that point, and it does NOT count as spending (the spending was already
recorded at split time).

**Decision history (2026-08-09):** an earlier draft generated only the lone
`borrow`, deferring the expense "to settlement" — but settlement creates a
Lending transaction, which the golden rule excludes from reports, so
friend-paid bills would never have appeared in spending reports at all. The
borrow + expense pair fixes this. This is final, not an open question.

### Approval behavior for generated transactions
All transactions from one split share a `bill_split_id` but are approved,
edited, or rejected **independently** in the Approval Queue — no atomic
group approval in v1. If partial approval proves confusing in practice,
revisit and make the group atomic.

---

## 5. Recurring Transactions

A Recurring template stores the full transaction shape (type, name, amount,
category, account, person, etc.) plus a schedule.

| Field | Type | Notes |
|---|---|---|
| id | uuid | |
| template | Transaction shape | as above, minus date/status |
| frequency | enum | daily, weekly, monthly, custom interval |
| next_due_date | date | |
| end_date | date | optional |
| active | bool | |

**Behavior:** When a recurring transaction becomes due, it generates a new
Transaction with `status = pending` and `source = recurring`, and it lands in
the **same Approval Queue** as voice-captured entries — never auto-posted.

---

## 6. Voice / LLM Layer

### Flow
1. User taps voice button, speaks a transaction.
2. Audio is sent to Gemini (directly, or via on-device transcription first —
   implementation choice) along with **context**: the user's current Accounts,
   Categories (both lists), and People, so the LLM matches against known
   entities rather than inventing new ones.
3. Gemini returns strict JSON matching the Transaction shape.
4. A validation layer (app code, NOT the LLM) checks the JSON is well-formed
   before it's allowed into the queue.
5. Transaction is created with `status = pending`, `source = voice`, and the
   original transcript attached.

### Handling uncertainty — never block, always flag
The LLM should never refuse or ask a follow-up question mid-capture. It fills
in what it can and attaches `confidence_flags` for anything uncertain,
so the user resolves it later in the Approval Queue:

- `unrecognized_name` — spoken name doesn't match any existing Person. Use the
  name as heard (verbatim, best-effort) rather than blocking; user can rename
  or confirm/create the Person during review.
- `no_account_matched` — unclear which account.
- `low_confidence_amount` — amount transcription/parse uncertain.
- `no_category_matched` — couldn't confidently map to an existing category.

This is the **canonical, complete flag list** (there is no separate
`new_person` flag — `unrecognized_name` covers that case).

Queue items with flags should be visually marked (e.g. a warning icon) so the
user can bulk-approve clean items and focus attention on flagged ones.

### Suggested LLM output contract (example)
```json
{
  "type": "expense",
  "name": "Lunch",
  "amount": 200,
  "currency": "LKR",
  "category": "Food",
  "account": "Cash Wallet",
  "person": null,
  "confidence_flags": []
}
```
```json
{
  "type": "lending",
  "name": "Lent to Kamal",
  "amount": 500,
  "currency": "LKR",
  "direction": "lend",
  "account": "Cash Wallet",
  "person": "Kamal",
  "confidence_flags": ["unrecognized_name"]
}
```

**Contract notes:** the model returns `amount` in major units as spoken
("two hundred rupees" → `200`); the validation layer converts to integer
minor units before insert. The `currency` field is sanity-checked against the
app's single default currency — a mismatch gets a flag, never a conversion.

---

## 7. Approval Queue

Central screen. Lists all `pending` transactions grouped by day, each showing:
amount, type, category/person, note, original transcript (if voice), and any
confidence flags.

Actions per item: **Approve**, **Edit** (opens the standard transaction
form, pre-filled), **Reject** (discard). Also supports **bulk approve** for
speed when reviewing many items at once.

Only `approved` transactions affect account balances, person balances, and
reports. `pending` items are excluded from all totals.

---

## 8. Screens (MVP)

1. **Onboarding** — set default currency, set up initial accounts, review/edit
   default categories.
2. **Home / Dashboard** — total balance, income/expense summary (approved
   only), pending-review badge/count, quick links to key sections.
3. **Voice Capture** — one-tap record → transcribe → parse → land in queue.
   Minimal UI, designed for zero-friction rapid entry.
4. **Approval Queue** — see §7.
5. **Manual Transaction Form** — reused for manual entry and for editing queue
   items. Fields per §3.4, with type selector (Expense/Income/Transfer/Lending)
   changing which fields show.
6. **Bill Splitter** — enter total, category, participants, split method, payer
   → generates transactions per §4, which land in the Approval Queue like
   everything else.
7. **Accounts** — list of accounts with balances; add/edit account.
8. **Categories** — manage expense/income category lists; add custom
   categories.
9. **People** — list of people with net balances; tap into a person for
   history + Settle Up.
10. **Recurring** — list of active recurring templates; add/edit/pause.
11. **Reports** — spending by category, income vs. expense over time, trends.
    Must exclude Transfer and Lending from these calculations (see golden
    rule in §2).

---

## 9. Explicitly Out of Scope for v1

Do not build these unless/until requested — deliberately deferred to avoid
overwhelming the app with options:

- Budgets (spending limits per category)
- Goals (savings targets)
- Labels
- Places
- Assets
- Multi-currency conversion (single default currency for v1)
- Multi-user / cloud sync (local-first, single user)

---

## 10. Build Order Suggestion

For a first-time mobile app builder, stage the build:

1. Manual-entry tracker: Accounts, Categories, Transactions (all 4 types,
   manual form only), local storage, basic balance display.
2. Reports screen (respecting the golden rule).
3. Person entity + Lending type + Settle Up.
4. Bill Splitter (built on top of Lending + Expense).
5. Recurring templates → Approval Queue integration.
6. Voice capture → LLM parsing → Approval Queue integration (the AI layer is
   added last, once the underlying data model is solid).
