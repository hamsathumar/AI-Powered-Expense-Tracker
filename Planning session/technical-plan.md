# Technical Plan — Kaasu

**Companion documents:** `expense-tracker-spec.md` (what the app does),
`design-system.md` (how it looks).
**Read the functional spec first** — this document assumes its entity model.

**Context:** Single-user personal app. Not published to app stores. Built by a
developer new to mobile development (background: basic Node.js/React/JavaScript,
web only). Development machine: MacBook Air M3 with Xcode. Test device: iPhone
12 Pro.

---

## 1. Stack Decisions

| Layer | Choice | Why |
|---|---|---|
| Framework | **React Native via Expo** | Existing React knowledge transfers; Expo removes native build complexity |
| Language | **TypeScript** | Catches shape errors at compile time — very valuable when juggling 4 transaction types with conditional fields |
| Local DB | **expo-sqlite** | Relational data with real joins/aggregates; the reports are SQL-shaped work |
| Navigation | **expo-router** | File-based routing, similar mental model to Next.js |
| State | **React Context + hooks** (+ TanStack Query optional) | App is single-user and local; Redux is unnecessary overhead here |
| Audio capture | **expo-audio** | Records audio for the voice layer. (`expo-av` was deprecated and removed from the SDK — it does not exist in SDK 57; never use it) |
| Secure storage | **expo-secure-store** | Stores the Gemini API key outside plain source |
| Charts | **react-native-gifted-charts** or **victory-native** | Reports screen — verify compatibility with the project's RN version at stage 5 before committing to one |
| Icons | **@expo/vector-icons** | Bundled with Expo; no separate setup |
| Dates | **date-fns** | Lighter than moment; needed for recurring schedules |
| Styling | **StyleSheet + theme context** | Keeps light/dark theming simple and dependency-free |

### Why Expo over bare React Native
Expo Go lets the app run on the physical iPhone by scanning a QR code — no
Xcode signing ritual for day-to-day work. Note: **`expo-sqlite`,
`expo-secure-store`, and `expo-audio` work in Expo Go**, so the entire MVP can
be developed without a custom native build. If a native module later requires it, migrate to an Expo *development
build* (still Expo tooling, no ejecting).

### Why TypeScript is non-negotiable here
A `Transaction` has conditional required fields (`category_id` required for
Expense/Income but forbidden for Transfer/Lending; `to_account_id` only for
Transfer; `person_id` required for Lending). Discriminated union types make
illegal states unrepresentable and will prevent an entire class of bugs.

---

## 2. Project Structure

The scaffolded project keeps the router directory at `src/app/` (natively
supported by expo-router) rather than a root-level `app/` — follow the
scaffold.

```
expense-tracker/                  # app display name: Kaasu
├── src/
│   ├── app/                      # expo-router screens
│   │   ├── (tabs)/
│   │   │   ├── index.tsx         # Home / Dashboard
│   │   │   ├── accounts.tsx
│   │   │   ├── reports.tsx
│   │   │   └── queue.tsx         # Approval Queue
│   │   ├── transaction/
│   │   │   ├── new.tsx           # Manual entry form
│   │   │   └── [id].tsx          # Edit existing
│   │   ├── person/
│   │   │   ├── index.tsx         # People list
│   │   │   └── [id].tsx          # Person detail + settle up
│   │   ├── bill-split.tsx
│   │   ├── recurring.tsx
│   │   ├── categories.tsx
│   │   ├── voice.tsx             # Voice capture
│   │   └── onboarding.tsx
│   ├── db/
│   │   ├── schema.sql            # Table definitions
│   │   ├── migrations.ts         # Versioned migration runner
│   │   ├── client.ts             # DB open/init singleton
│   │   └── queries/              # One file per entity
│   │       ├── accounts.ts
│   │       ├── categories.ts
│   │       ├── people.ts
│   │       ├── transactions.ts
│   │       └── reports.ts        # Aggregate/report queries
│   ├── domain/
│   │   ├── types.ts              # Discriminated union transaction types
│   │   ├── rules.ts              # Balance math, golden-rule filtering
│   │   ├── billSplit.ts          # Split → transaction generator
│   │   └── recurring.ts          # Due-date evaluation
│   ├── ai/
│   │   ├── gemini.ts             # API call wrapper
│   │   ├── prompt.ts             # Prompt construction w/ context injection
│   │   └── validate.ts           # Validates + sanitizes LLM JSON output
│   ├── theme/
│   │   ├── tokens.ts             # Colors, spacing, radii, typography
│   │   └── ThemeContext.tsx      # Light/dark toggle
│   └── components/               # Reusable UI
└── Planning session/
    ├── design-system.md
    ├── expense-tracker-spec.md
    └── technical-plan.md
```

---

## 3. Database Schema

SQLite. All monetary values stored as **INTEGER in the smallest currency unit
(cents)** — never floating point. `2000` = Rs20.00. Floating point money bugs
are subtle and permanent; avoid them from day one.

```sql
CREATE TABLE accounts (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  type          TEXT NOT NULL CHECK (type IN ('bank','card','cash')),
  owner_label   TEXT,
  opening_balance INTEGER NOT NULL DEFAULT 0,
  icon          TEXT,
  color         TEXT,
  archived      INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL
);

CREATE TABLE categories (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  kind       TEXT NOT NULL CHECK (kind IN ('expense','income')),
  icon       TEXT,
  color      TEXT,
  is_default INTEGER NOT NULL DEFAULT 0,
  archived   INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE people (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  unresolved INTEGER NOT NULL DEFAULT 0,  -- created from unrecognized voice name
  created_at TEXT NOT NULL
);

CREATE TABLE recurring_templates (
  id            TEXT PRIMARY KEY,
  type          TEXT NOT NULL,
  name          TEXT NOT NULL,
  amount        INTEGER NOT NULL,
  account_id    TEXT REFERENCES accounts(id),
  to_account_id TEXT REFERENCES accounts(id),
  category_id   TEXT REFERENCES categories(id),
  person_id     TEXT REFERENCES people(id),
  direction     TEXT,
  frequency     TEXT NOT NULL CHECK (frequency IN ('daily','weekly','monthly','custom')),
  interval_days INTEGER,                   -- for 'custom'
  next_due_date TEXT NOT NULL,
  end_date      TEXT,
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL
);

-- created after recurring_templates so its foreign key target already exists
CREATE TABLE transactions (
  id              TEXT PRIMARY KEY,
  type            TEXT NOT NULL CHECK (type IN ('expense','income','transfer','lending')),
  status          TEXT NOT NULL CHECK (status IN ('pending','approved','rejected')),
  direction       TEXT CHECK (direction IN
                    ('lend','lend_repayment_received','borrow','borrow_repayment_made')),
  name            TEXT NOT NULL,
  amount          INTEGER NOT NULL,        -- minor units, always positive
  description     TEXT,
  occurred_at     TEXT NOT NULL,           -- ISO8601
  account_id      TEXT REFERENCES accounts(id),
  to_account_id   TEXT REFERENCES accounts(id),   -- transfer only
  category_id     TEXT REFERENCES categories(id), -- expense/income only
  person_id       TEXT REFERENCES people(id),     -- required for lending
  source          TEXT NOT NULL CHECK (source IN ('voice','manual','recurring','bill_split')),
  transcript      TEXT,                    -- original spoken text
  confidence_flags TEXT,                   -- JSON array
  bill_split_id   TEXT,                    -- groups transactions from one split
  recurring_id    TEXT REFERENCES recurring_templates(id),
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

CREATE INDEX idx_tx_status     ON transactions(status);
CREATE INDEX idx_tx_occurred   ON transactions(occurred_at);
CREATE INDEX idx_tx_account    ON transactions(account_id);
CREATE INDEX idx_tx_person     ON transactions(person_id);
CREATE INDEX idx_tx_category   ON transactions(category_id);

-- key/value settings, e.g. default_currency, theme_override.
-- v1 is single-currency: default_currency lives here, and transactions
-- deliberately carry NO currency column.
CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
```

### Amount sign convention
`amount` is **always stored positive**. Direction of money flow is derived from
`type` + `direction`, never from a negative number. This keeps aggregate queries
unambiguous.

---

## 4. Core Domain Logic

### 4.1 The Golden Rule (most important logic in the app)
Only `expense` and `income` count as spending/earning. `transfer` and `lending`
are money *movements* and must be **excluded from all spending reports and
category breakdowns**, while still affecting account balances.

```sql
-- Spending reports: ALWAYS filter like this
WHERE status = 'approved' AND type IN ('expense','income')

-- Account balance: includes ALL types
```

### 4.2 Account balance
```
balance = opening_balance
        − Σ(approved expense where account_id = X)
        + Σ(approved income where account_id = X)
        − Σ(approved transfer where account_id = X)        -- money out
        + Σ(approved transfer where to_account_id = X)     -- money in
        − Σ(approved lending where direction IN ('lend','borrow_repayment_made'))
        + Σ(approved lending where direction IN ('lend_repayment_received','borrow'))
```

### 4.3 Person net balance
Positive = they owe the user. Negative = the user owes them.
```
net = + Σ(lend)                     -- user gave them money
      − Σ(lend_repayment_received)  -- they paid it back
      − Σ(borrow)                   -- they gave the user money
      + Σ(borrow_repayment_made)    -- user paid them back
```
Only `approved` rows count. Settle Up prefills from this approved-only
balance; if the person has pending lending rows, the UI shows a hint that
they're not included (see spec §3.5).

### 4.4 Bill split generator
Pure function: `(total, category, participants, splitMethod, payer) → Transaction[]`.
All generated rows share one `bill_split_id` and enter as `status = 'pending'`.
See functional spec §4 for the two cases. Case B (someone else paid) generates
a **borrow + expense pair** for the user's share — net-zero on the account,
spending recorded on the bill's date. Generated rows are approved/rejected
**independently** in the queue (no atomic group approval in v1).
**Validate that the sum of generated
amounts exactly equals the total** — rounding remainders must be assigned
deliberately (e.g. give the remainder cent(s) to the payer) rather than silently
lost.

### 4.5 Recurring evaluation
On app foreground: find templates where `active = 1 AND next_due_date <= today`,
generate a pending transaction for each, advance `next_due_date`, deactivate if
past `end_date`. Guard against duplicate generation if the app is opened
multiple times in a day (check for an existing transaction with the same
`recurring_id` and date).

---

## 5. AI / Gemini Integration

### 5.1 Flow
```
Audio (expo-audio) → Gemini API (audio + context prompt) → strict JSON
  → validate.ts (app-side, NOT the LLM) → insert as status='pending'
```
Gemini accepts audio natively, so no separate speech-to-text service is needed.
Alternative: use on-device iOS transcription and send text only — cheaper and
more private, but adds a dependency. **Start with the direct-audio approach**
for a simpler pipeline.

### 5.2 Context injection
Every request includes the user's current accounts, both category lists, and
people, so the model **matches against existing entities instead of inventing
new ones**. Keep this list compact — send names and ids only.

### 5.3 Output contract
Instruct the model to return **JSON only** — no prose, no markdown fences. Use
Gemini's structured-output / JSON mode where available rather than relying on
prompt wording alone.

### 5.4 Validation layer (mandatory)
The LLM's output is **untrusted input**. `validate.ts` must:
- Confirm JSON parses; strip stray markdown fences defensively
- Confirm `type` is one of the four valid values
- Confirm `amount` is a positive finite number (major units from the model);
  convert to integer minor units before insert
- Sanity-check the model's `currency` against the app's default — a mismatch
  gets a confidence flag, never a silent conversion
- Resolve `category`/`account`/`person` names to real IDs — **never insert an
  unmatched name as if it were valid**
- Enforce type rules (no category on transfer/lending; person required on
  lending; two distinct accounts on transfer)
- Attach `confidence_flags` for anything unresolved rather than guessing

### 5.5 Never block on uncertainty
The model fills what it can and flags the rest. Unresolved names are kept
verbatim with an `unrecognized_name` flag; the user fixes it in the queue.
Flags (canonical list, matches spec §6): `unrecognized_name`,
`no_account_matched`, `low_confidence_amount`, `no_category_matched`.
There is no separate `new_person` flag — `unrecognized_name` covers it.

### 5.6 API key handling — read this
An API key shipped inside a mobile app **can be extracted** — this is true of
any client-side key, and no amount of obfuscation changes it. For a private,
personal, unpublished app this is an acceptable risk, but:
- Store it via `expo-secure-store`, never hardcoded in a committed source file
- Add `.env` to `.gitignore`; never commit the key to the repo
- Set spending limits / quotas on the Google AI Studio key
- **If this app is ever published**, move the Gemini call behind a small server
  (e.g. a Cloud Function) so the key never reaches the device

### 5.7 Failure handling
Voice capture must degrade gracefully: if the network is down or the API fails,
save the audio/transcript locally as a pending item with an `unparsed` state
so nothing spoken is ever lost. Retry later or let the user fill it manually.

---

## 6. Non-Functional Requirements

- **Offline-first.** Everything except voice parsing works with no network.
- **No data loss.** All writes are local and immediate. Add a backup/export
  (JSON or CSV to Files) before relying on the app for real records.
- **Money precision.** Integer minor units everywhere. No floats.
- **Timezone.** Store ISO8601; render in device local time.
- **Accessibility.** Never signal expense/income by color alone (see design
  system) — pair with sign, icon, or label.
- **Performance.** Aggregate in SQL, not JavaScript. Indexes above cover the
  common report queries.

---

## 7. Build Order

Mirrors functional spec §10 — build the data model before the AI layer.

1. **Environment + scaffold.** Expo project runs on the iPhone via Expo Go.
2. **DB layer.** Schema, migration runner, seed default categories, typed query
   functions. Verify with a throwaway screen.
3. **Manual transaction form + list.** All four types. This is the real
   foundation — get the type-conditional field logic right here.
4. **Accounts + Categories management screens.**
5. **Dashboard + Reports.** Implement and test the golden rule explicitly.
6. **People + Lending + Settle Up.**
7. **Bill Splitter.** Built on top of Lending + Expense.
8. **Recurring templates + Approval Queue.**
9. **Voice + Gemini.** Last — it depends on everything above existing.

Ship each stage working before starting the next. Test on the physical device
regularly, not just the simulator.

---

## 8. Testing Priorities

Full test coverage is overkill for a personal app, but **the money math must be
tested** with plain unit tests:
- Account balance across all four types and both transfer directions
- Person net balance through a full lend → partial repay → settle cycle
- Bill split totals reconcile exactly, including rounding remainders
- Golden rule: confirm transfers and lendings never appear in spending reports
- Recurring generation is idempotent (no duplicates on repeated app opens)

---

## 9. Distribution (Personal Use)

For everyday personal use, Expo Go is sufficient. For a standalone app icon on
the home screen, build with EAS (`eas build --platform ios --profile preview`).
Note that a free Apple developer account limits app signing to a **7-day
reinstall cycle**; a paid Apple Developer Program membership extends this to a
year. No App Store submission is needed for personal use.
