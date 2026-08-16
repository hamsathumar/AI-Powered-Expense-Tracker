# Kaasu Transaction AI Context

## 1. Project

Kaasu is an AI-powered personal expense tracker.

The application uses AI to interpret natural-language and voice
transaction input and convert it into structured transaction
information.

The current application is an MVP undergoing real-world testing.

---

## 2. AI's Role

The AI is an interpreter.

It is not the authority over financial records.

The AI may interpret the user's natural-language input, identify
transaction intent, extract relevant information, and provide
references to existing Kaasu entities.

The application remains responsible for:

- validation;
- business rules;
- entity resolution;
- calculations;
- database operations;
- transaction integrity;
- approval state;
- permanent record creation.

---

## 3. Current AI Input

The user may provide transaction information through voice or
natural-language input.

The input may contain:

- transaction amount;
- transaction type;
- date;
- account;
- category;
- person;
- merchant/payee;
- notes;
- split information;
- recurring information;
- lending or borrowing information;
- repayment information;
- transfer information.

Natural-language input may also contain irrelevant,
ambiguous, incomplete, or non-transactional statements.

---

## 4. AI Must Distinguish Transactions from Non-Transactions

Not every voice statement represents a financial transaction.

Examples of potentially non-transactional input:

"I went to university yesterday."

"I'm feeling tired today."

"What is the weather tomorrow?"

The AI must not convert ordinary conversation into a financial
transaction merely because a financial interpretation is possible.

---

## 5. Missing Information

The AI must not invent critical financial information.

Examples:

"I spent some money at the shop."

If the amount is required and unavailable, this should be treated
as missing information rather than an invented amount.

Similarly, the AI must not invent:

- account IDs;
- category IDs;
- person IDs;
- transaction IDs;
- amounts;
- dates;
- recurring rules;
- other critical financial data.

---

## 6. Existing Entity Context

The AI may receive context containing existing Kaasu entities,
including:

- accounts;
- expense categories;
- income categories;
- people.

AI-generated references must ultimately be resolved against actual
application entities.

The AI must not be treated as authoritative for database IDs.

---

## 7. Validation Boundary

AI output is untrusted.

The application must independently validate AI output before the
transaction is accepted.

The intended safety boundary includes:

AI interpretation
→ structured output
→ application validation
→ entity resolution
→ confidence/completeness checks
→ Approval Queue
→ user approval
→ permanent database record

---

## 8. Approval Boundary

AI must not directly create permanent financial records.

The Approval Queue is a safety boundary between AI interpretation
and permanent transaction storage.

The user must approve the transaction before permanent saving.

---

## 9. Deterministic Responsibilities

The following should remain deterministic application logic rather
than being delegated to AI:

- balances;
- totals;
- calculations;
- category operations;
- bill splitting calculations;
- lending/borrowing calculations;
- settlements;
- recurring transaction execution;
- database operations;
- currency calculations;
- reports.

AI may interpret the user's language describing these operations,
but deterministic application code remains responsible for their
actual execution.

---

## 10. Current Testing Focus

The seven-day real-world test period is intended to discover
behavioural failures in areas including:

- date interpretation;
- split transactions;
- recurring transactions;
- transaction classification;
- missing information;
- ambiguity;
- non-transactional input;
- entity resolution;
- confidence;
- structured output;
- validation;
- unusual natural-language phrasing;
- mixed-language or conversational input;
- adversarial or prompt-injection-style input.

This list is not exhaustive.

New failure categories discovered during testing should be recorded.

---

## 11. Known Early Observations

The current testing period has already produced observations
involving:

1. Date context not being correctly interpreted from voice input.
2. Split transaction input not being recognized correctly.
3. Recurring transaction input not being recognized correctly.

These are observations, not yet finalized architectural conclusions.

Additional testing may confirm, refine, or contradict them.

---

## 12. Testing Objective

The objective is not to prove that the current AI works.

The objective is to discover how it behaves in realistic use.

The resulting evidence will be used after the seven-day period to
design the next version of the Kaasu Transaction AI architecture
and its governing AI Constitution.