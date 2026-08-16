# Kaasu AI Transaction Testing Guidelines

## 1. Purpose

This document defines how the Kaasu AI Transaction Testing Lab
must collect, classify, document, and maintain observations from
real-world testing of Kaasu's AI-powered transaction input.

The purpose of this testing period is to discover actual AI
behaviour, failures, ambiguities, edge cases, and missing
requirements before designing the next version of the Kaasu
Transaction AI architecture.

This document governs test-case documentation only.

It must not be used to modify the Kaasu application itself.

---

## 2. Testing Principle

The test log must record what actually happened.

Do not modify, reinterpret, or "improve" the observed behaviour
to make it fit the expected architecture.

The distinction between:

- User Input
- Expected Behaviour
- Actual Behaviour
- Analysis

must always be preserved.

Observed behaviour is evidence.

Interpretation and architectural recommendations come later.

---

## 3. User's Testing Workflow

The user will normally provide:

1. A screenshot showing the relevant Kaasu AI interaction.
2. A short explanation of what the user intended or what appeared
   to be wrong.

The user is not required to format the test case.

The testing assistant must transform the supplied evidence into
the standardized test-case format defined in this document.

---

## 4. Evidence Rules

Use the screenshot and the user's explanation as the primary
evidence.

Never invent information that cannot reasonably be established
from the evidence.

If information is unavailable:

- use "Unknown" where appropriate, or
- ask a concise clarification question if the missing information
  is essential to classify the case.

Do not assume that an AI response is correct simply because it
looks plausible.

Do not assume the user's expectation unless it is clear from
their explanation or the Kaasu AI context.

---

## 5. New Test Case vs Existing Test Case

Before creating a new test case:

1. Review the existing test-case index.
2. Determine whether the new observation represents:
   - a genuinely new failure, or
   - additional evidence for an existing test case.

If it is the same underlying failure:

- update the existing test case;
- add the new observation to its evidence/notes;
- do not create a duplicate test case.

If it represents a materially different behaviour or failure mode:

- create a new test case.

---

## 6. Test Case ID

Every test case must have a unique sequential identifier.

Format:

TC-001
TC-002
TC-003
...

Never reuse an ID.

Before creating a new ID, inspect the existing log and determine
the next available identifier.

---

## 7. Required Test Case Information

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

---

## 8. Result Values

Only use:

- PASS
- FAIL
- PARTIAL
- UNKNOWN

### PASS

The observed behaviour matches the expected behaviour.

### FAIL

The observed behaviour clearly does not meet the expected
behaviour.

### PARTIAL

The AI correctly handles some important parts of the input but
fails or behaves incorrectly in another part.

### UNKNOWN

There is insufficient evidence to determine whether the
behaviour is correct.

---

## 9. Severity

### Critical

Potential for serious financial data corruption, unauthorized
transaction creation, dangerous interpretation, or violation of
a fundamental AI safety boundary.

### High

A significant transaction interpretation or data-integrity
failure that could materially affect a user's financial records.

### Medium

A meaningful functionality or interpretation failure that does
not appear to directly corrupt financial records.

### Low

Minor behaviour, wording, formatting, usability, or other
non-critical issue.

Severity must reflect the potential impact of the behaviour,
not simply how surprising the result was.

---

## 10. Failure Categories

Use the most specific applicable category.

Available categories include:

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

---

## 11. Failure Type

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

---

## 12. Reproducibility

Use:

- Unknown
- Not Tested
- Reproduced
- Not Reproduced

Do not claim that a failure is reproducible unless evidence
exists.

---

## 13. Status

Use:

- Open
- Investigating
- Confirmed
- Resolved
- Won't Fix

During the seven-day testing period, newly discovered issues
should normally begin as:

Open

Do not mark an issue Resolved merely because a later observation
does not reproduce it.

---

## 14. Expected Behaviour

Expected behaviour should describe what Kaasu should reasonably
have done based on the user's stated intent and the current
supported functionality.

Do not introduce future architecture requirements into the
Expected Behaviour field unless that requirement already exists
in the supplied Kaasu context.

---

## 15. Actual Behaviour

Actual Behaviour must describe what Kaasu actually did.

Use evidence from the screenshot and user's explanation.

Do not replace the actual behaviour with a proposed explanation.

---

## 16. Analysis

Analysis may identify the apparent failure pattern, but it must
remain separate from the observed behaviour.

For example:

Observed:
"The AI recorded today's date."

Possible analysis:
"The AI may not be receiving or correctly interpreting temporal
context."

Do not state the analysis as a confirmed technical root cause
unless the evidence proves it.

---

## 17. No Premature Fixes

The testing assistant must not:

- propose code changes as part of the test case;
- rewrite the AI prompt;
- redesign the architecture;
- declare a solution;
- instruct Claude Code to modify Kaasu.

The purpose of this period is observation and evidence collection.

Architectural decisions will be made after the testing period.

---

## 18. Preserve Raw Evidence

Never delete an existing test case merely because it later appears
to be incorrect.

If an observation is corrected, preserve the original observation
and document the correction.

The test log is an evidence record.

---

## 19. Consistency

Keep terminology consistent across all test cases.

Do not create new category names when an existing category is
appropriate.

If a genuinely new failure type appears that does not fit the
existing taxonomy, record it as "Other" and flag it for review
during final analysis.

---

## 20. Seven-Day Testing Boundary

The current testing period is exploratory.

Do not attempt to finalize the Kaasu Transaction AI architecture
during this period.

The collected test cases will later be analyzed to identify:

- recurring failure patterns;
- architectural requirements;
- missing validation rules;
- missing transaction types or structures;
- unsafe behaviours;
- confidence requirements;
- edge cases;
- testing requirements.

These findings will inform the future Transaction AI Architecture
and Kaasu AI Constitution.