# Kaasu AI Transaction Testing Guide

How real-world testing of Kaasu's voice / natural-language transaction input
is run and recorded. Part 1 is the context a testing assistant needs about the
AI; Part 2 is how observations become entries in `Test/AI_TEST_CASE_LOG.md`.

Merged 2026-10-07 from `KAASU_TRANSACTION_AI_CONTEXT.md` and
`TESTING_GUIDELINES.md` (both written 2026-08-14 for round 1). The rules are
unchanged; only round-1-specific wording ("the seven-day period", "known early
observations") was generalised so the guide applies to every round.

---

# Part 1 — Transaction AI context

## 1. Project

Kaasu is an AI-powered personal expense tracker. The application uses AI to
interpret natural-language and voice transaction input and convert it into
structured transaction information.

## 2. AI's role

The AI is an interpreter. It is not the authority over financial records.

The AI may interpret the user's natural-language input, identify transaction
intent, extract relevant information, and provide references to existing Kaasu
entities.

The application remains responsible for:

- validation;
- business rules;
- entity resolution;
- calculations;
- database operations;
- transaction integrity;
- approval state;
- permanent record creation.

## 3. AI input

The user may provide transaction information through voice or
natural-language input. The input may contain:

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

Natural-language input may also contain irrelevant, ambiguous, incomplete, or
non-transactional statements.

## 4. Transactions vs non-transactions

Not every voice statement represents a financial transaction. Examples of
potentially non-transactional input:

- "I went to university yesterday."
- "I'm feeling tired today."
- "What is the weather tomorrow?"

The AI must not convert ordinary conversation into a financial transaction
merely because a financial interpretation is possible.

## 5. Missing information

The AI must not invent critical financial information.

Example: "I spent some money at the shop." — if the amount is required and
unavailable, this is missing information, not an invented amount.

Similarly, the AI must not invent:

- account IDs;
- category IDs;
- person IDs;
- transaction IDs;
- amounts;
- dates;
- recurring rules;
- other critical financial data.

## 6. Existing entity context

The AI may receive context containing existing Kaasu entities: accounts,
expense categories, income categories, people.

AI-generated references must ultimately be resolved against actual application
entities. The AI is never authoritative for database IDs.

## 7. Validation boundary

AI output is untrusted. The application must independently validate it before
the transaction is accepted. The intended safety boundary:

AI interpretation
→ structured output
→ application validation
→ entity resolution
→ confidence/completeness checks
→ Approval Queue
→ user approval
→ permanent database record

## 8. Approval boundary

AI must not directly create permanent financial records. The Approval Queue is
a safety boundary between AI interpretation and permanent transaction storage;
the user must approve the transaction before it is permanently saved.

## 9. Deterministic responsibilities

These remain deterministic application logic, never delegated to AI:

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

AI may interpret the user's language describing these operations, but
deterministic application code remains responsible for executing them.

## 10. Areas to probe

Testing looks for behavioural failures in areas including:

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

This list is not exhaustive. New failure categories discovered during testing
should be recorded.

## 11. Testing objective

The objective is not to prove that the current AI works. It is to discover how
it behaves in realistic use. The evidence from each round drives the next
change to the Transaction AI blueprint (see `TRANSACTION_AI_AMENDMENTS.md`).

---

# Part 2 — Recording test cases

## 12. Purpose

This part defines how the testing assistant collects, classifies, documents,
and maintains observations from real-world testing. Its purpose is to discover
actual AI behaviour, failures, ambiguities, edge cases, and missing
requirements before the next change to the Transaction AI is designed.

It governs test-case documentation only. It must not be used to modify the
Kaasu application itself.

## 13. Testing principle

The test log records what actually happened. Do not modify, reinterpret, or
"improve" the observed behaviour to make it fit the expected architecture.

The distinction between **User Input**, **Expected Behaviour**, **Actual
Behaviour** and **Analysis** must always be preserved. Observed behaviour is
evidence; interpretation and architectural recommendations come later.

## 14. User's testing workflow

The user will normally provide:

1. A screenshot showing the relevant Kaasu AI interaction.
2. A short explanation of what the user intended or what appeared to be wrong.

The user is not required to format the test case. The testing assistant
transforms the supplied evidence into the standardised format below.

Since V1.3 Phase C, the Logged and review screens have a **Why?** sheet whose
Share button produces a plain-text diagnostics report. When available, ask for
it and attach it as evidence.

## 15. Evidence rules

Use the screenshot, the user's explanation, and any diagnostics report as the
primary evidence. Never invent information that cannot reasonably be
established from the evidence.

If information is unavailable:

- use "Unknown" where appropriate, or
- ask a concise clarification question if the missing information is essential
  to classify the case.

Do not assume that an AI response is correct simply because it looks
plausible. Do not assume the user's expectation unless it is clear from their
explanation or the context in Part 1.

## 16. New test case vs existing test case

Before creating a new test case:

1. Review the existing test-case index.
2. Decide whether the observation is a genuinely new failure, or additional
   evidence for an existing test case.

If it is the same underlying failure: update the existing test case, add the
new observation to its evidence/notes, and do not create a duplicate.

If it represents a materially different behaviour or failure mode: create a
new test case.

## 17. Test case ID

Every test case has a unique sequential identifier — `TC-001`, `TC-002`, … —
continuing across rounds (the next is **TC-041**). Never reuse an ID. Before
creating a new one, inspect the log for the next available identifier.

A new round starts its own `# Round N — …` section at the end of the log and
adds its rows to the shared summary and index at the top.

## 18. Required test case information

Every test case should contain:

- Test Case ID
- Date Discovered
- User Input
- Context
- Expected Behaviour
- Actual Behaviour
- Result
- Category
- Severity
- Failure Type
- Reproducibility
- Status
- Notes

## 19. Result values

Only use:

- **PASS** — the observed behaviour matches the expected behaviour.
- **FAIL** — the observed behaviour clearly does not meet the expected
  behaviour.
- **PARTIAL** — the AI correctly handles some important parts of the input but
  fails or behaves incorrectly in another part.
- **UNKNOWN** — there is insufficient evidence to determine whether the
  behaviour is correct.

## 20. Severity

- **Critical** — potential for serious financial data corruption, unauthorised
  transaction creation, dangerous interpretation, or violation of a
  fundamental AI safety boundary.
- **High** — a significant transaction interpretation or data-integrity
  failure that could materially affect the user's financial records.
- **Medium** — a meaningful functionality or interpretation failure that does
  not appear to directly corrupt financial records.
- **Low** — minor behaviour, wording, formatting, usability, or other
  non-critical issue.

Severity must reflect the potential impact of the behaviour, not simply how
surprising the result was.

## 21. Failure categories

Use the most specific applicable category:

- Transaction Classification
- Non-Transactional Input
- Transaction Type
- Amount Extraction
- Date Interpretation
- Time Interpretation
- Category Resolution
- Account Resolution
- Person Resolution
- Split Transaction
- Recurring Transaction
- Transfer
- Lending
- Borrowing
- Repayment
- Missing Information
- Ambiguity
- Confidence Handling
- Entity Resolution
- Structured Output
- Schema Validation
- Business Rule Validation
- Error Handling
- Prompt Injection
- Context Handling
- Other

Multiple categories may be assigned when genuinely necessary.

## 22. Failure type

Use a concise description such as:

- Incorrect classification
- Incorrect extraction
- Missing intent
- Incorrect entity resolution
- Missing required information
- Incorrect temporal interpretation
- Incorrect transaction structure
- Hallucinated information
- Validation failure
- Structured-output failure
- Application integration failure
- Unknown

Do not use unnecessarily complicated terminology.

## 23. Reproducibility

Use: Unknown · Not Tested · Reproduced · Not Reproduced.

Do not claim that a failure is reproducible unless evidence exists.

## 24. Status

Use: Open · Investigating · Confirmed · Resolved · Won't Fix.

Newly discovered issues normally begin as **Open**. Do not mark an issue
Resolved merely because a later observation does not reproduce it.

Once a fix ships, its outcome is recorded by **appending** a
`**RESOLUTION (date) — Amendment X.**` note to the case and updating its row
in the index — the original observation and its Status line are never
rewritten.

## 25. Expected behaviour

Describe what Kaasu should reasonably have done based on the user's stated
intent and the currently supported functionality. Do not introduce future
architecture requirements unless they already exist in the Kaasu context.

## 26. Actual behaviour

Describe what Kaasu actually did, using the screenshot and the user's
explanation. Do not replace the actual behaviour with a proposed explanation.

## 27. Analysis

Analysis may identify the apparent failure pattern, but it must remain
separate from the observed behaviour. For example:

- Observed: "The AI recorded today's date."
- Possible analysis: "The AI may not be receiving or correctly interpreting
  temporal context."

Do not state the analysis as a confirmed technical root cause unless the
evidence proves it.

## 28. No premature fixes

While a round is being recorded, the testing assistant must not:

- propose code changes as part of the test case;
- rewrite the AI prompt;
- redesign the architecture;
- declare a solution;
- instruct Claude Code to modify Kaasu.

A round is for observation and evidence collection. Decisions are made after
it closes.

## 29. Preserve raw evidence

Never delete an existing test case merely because it later appears to be
incorrect. If an observation is corrected, preserve the original and document
the correction. The test log is an evidence record.

## 30. Consistency

Keep terminology consistent across all test cases. Do not create new category
names when an existing category fits. If a genuinely new failure type does not
fit the taxonomy, record it as "Other" and flag it for review during analysis.

## 31. After a round

A round is exploratory; do not finalise architecture during it. Afterwards the
collected cases are analysed to identify:

- recurring failure patterns;
- architectural requirements;
- missing validation rules;
- missing transaction types or structures;
- unsafe behaviours;
- confidence requirements;
- edge cases;
- testing requirements.

Those findings become the next part of `TRANSACTION_AI_AMENDMENTS.md`.
