# Kaasu AI Transaction Test Case Log

**Testing Period:** 7-Day Real-World Test (Round 3 — post-fix verification)
**Project:** Kaasu — AI Expense Tracker
**Purpose:** Evidence collection for Transaction AI architecture design

Note: Test cases TC-001–TC-027 were recorded in the prior testing round(s) and are frozen/archived separately following implementation of fixes. This log continues numbering from TC-028 for the current round.

---

# Test Summary

| Metric | Count |
|---|---:|
| Total Test Cases | 13 |
| PASS | 0 |
| FAIL | 10 |
| PARTIAL | 3 |
| UNKNOWN | 0 |
| Critical | 1 |
| High | 4 |
| Medium | 7 |
| Low | 1 |

---

# Test Case Index

| ID | Date | Category | Severity | Result | Status |
|---|---|---|---|---|---|
| TC-028 | 2026-08-21 | Structured Output, Ambiguity Handling | Low | PARTIAL | Open |
| TC-029 | 2026-08-21 | Entity Resolution, Account Resolution | Medium | FAIL | Open |
| TC-030 | 2026-08-21 | Lending, Transaction Classification | High | FAIL | Open |
| TC-031 | 2026-08-21 | Missing Information, Amount Extraction, Structured Output | Medium | PARTIAL | Open |
| TC-032 | 2026-08-27 | Transaction Classification, Transaction Type | High | FAIL | Open |
| TC-033 | 2026-08-29 | Date Interpretation, Time Interpretation | Medium | PARTIAL | Open |
| TC-034 | 2026-08-29 | Non-Transactional Input, Structured Output, Transaction Classification | Critical | FAIL | Open |
| TC-035 | 2026-09-02 | Entity Resolution, Account Resolution, Lending | Medium | FAIL | Open |
| TC-036 | 2026-09-06 | Ambiguity Handling, Structured Output, Lending | Medium | FAIL | Open |
| TC-037 | 2026-09-12 | Split Transaction, Structured Output, Date Interpretation | Medium | FAIL | Open |
| TC-038 | 2026-09-13 | Structured Output, Amount Extraction | High | FAIL | Open |
| TC-039 | 2026-09-17 | Lending, Transaction Classification, Structured Output | High | FAIL | Open |
| TC-040 | 2026-09-17 | Structured Output, Ambiguity Handling | Medium | FAIL | Open |

---

# Detailed Test Cases

<!--
New detailed test cases are added below.

Do not delete previous test cases.

Do not renumber existing test cases.

Maintain chronological order by default.
-->

## TC-028

- **Test Case ID:** TC-028
- **Date Discovered:** 2026-08-21
- **User Input:** "Income of 6000 rupees to BOC bank account. Make it the category as pocket money and name the expense as rent provision."
- **Context:** Post-fix (second testing round). Kaasu "Finish details" confirmation screen reached after voice/text input. Transaction resolved as Income, Rs6,000.00, named "Rent Provision," category "Pocket Money" pre-selected. Two items appeared under a "PLEASE CONFIRM" section.
- **Expected Behaviour:** The user's input contains a self-contradictory reference (stated "Income" but then used the word "expense" when instructing how to label/name the transaction). When such an ambiguity is detected, the AI should raise it for user confirmation once, not as multiple separate, near-identical flags.
- **Actual Behaviour:** Two separate confirmation flags were shown, both describing essentially the same underlying contradiction: (1) "User described an income operation but asked to name the expense/label context as rent provision." (2) "Described action is 'income' but the input asked to record it as 'expense'." Both offered the same "Keep as-is" resolution option.
- **Result:** PARTIAL
- **Category:** Structured Output, Ambiguity Handling
- **Severity:** Low
- **Failure Type:** Redundant/duplicate flag generation
- **Reproducibility:** Not Tested
- **Status:** Open
- **Notes:** Per the user, the AI otherwise did a very good job resolving the transaction (correct amount, income type, category, and name) and correctly surfaced the ambiguity for confirmation rather than silently guessing — this is the desired safety behavior. The issue is narrowly that the same underlying contradiction was split into two redundant flags rather than one. Root cause not investigated (evidence collection phase only, per testing guidelines).

---

## TC-029

- **Test Case ID:** TC-029
- **Date Discovered:** 2026-08-21
- **User Input:** "Income of 6000 rupees to BOC bank account. Make it the category as pocket money and name the expense as rent provision." (same input as TC-028; distinct failure mode observed on the same screen)
- **Context:** Post-fix (second testing round). Same "Finish details" screen as TC-028. ACCOUNT field showed four options (Commercial Bank, Cash, BOC, eZ Wallet) with none pre-selected/highlighted, in contrast to the CATEGORY field where "Pocket Money" was correctly pre-selected/highlighted.
- **Expected Behaviour:** Since the user explicitly stated "BOC bank account," the AI should auto-select "BOC" in the Account field rather than leaving it fully unresolved for manual selection.
- **Actual Behaviour:** No account was pre-selected among the four Account options, despite "BOC" being explicitly named in the input. The user would need to manually select "BOC" before approving.
- **Result:** FAIL
- **Category:** Entity Resolution, Account Resolution
- **Severity:** Medium
- **Failure Type:** Missing entity resolution
- **Reproducibility:** Not Tested
- **Status:** Open
- **Notes:** Unlike a previously noted pattern where an account was silently pre-selected to an incorrect default underneath a "no match" flag, this instance shows no account pre-selected at all — the field is left blank rather than silently defaulting, which is a safer failure mode but still an incomplete extraction given the account was explicitly named. Root cause not investigated (evidence collection phase only, per testing guidelines).

---

## TC-030

- **Test Case ID:** TC-030
- **Date Discovered:** 2026-08-21
- **User Input:** "I paid Sham's rent of Rs.5000 using cash on behalf of himself." No screenshot captured for this observation — logged from the user's description, per the user's explicit request.
- **Context:** Post-fix (second testing round). Reported by the user as a single specific instance (not a general impression).
- **Expected Behaviour:** The described action — the user paying a bill (rent) on behalf of another named person (Sham) — represents money advanced to/on behalf of that person, i.e. a Lending operation (direction: lend, person: Sham), not an ordinary personal expense for the user.
- **Actual Behaviour:** Per the user, the transaction was logged as a Rent expense attributed to the user's own spending, with no lending relationship or person (Sham) reference recorded.
- **Result:** FAIL
- **Category:** Lending, Transaction Classification
- **Severity:** High
- **Failure Type:** Incorrect classification
- **Reproducibility:** Not Tested
- **Status:** Open
- **Notes:** The phrase "on behalf of himself" (referring to Sham) appears to be the key signal that this was money paid for another person rather than the user's own expense; this signal was not picked up. Recording it as the user's own rent expense both misattributes the spending category and fails to create any lending record against Sham, which could materially affect both the user's expense totals and Sham's tracked balance. Root cause not investigated (evidence collection phase only, per testing guidelines).

---

## TC-031

- **Test Case ID:** TC-031
- **Date Discovered:** 2026-08-21
- **User Input:** "Areej settled up all the money that he owed me to my Commercial Bank."
- **Context:** Post-fix (second testing round). Kaasu Home screen, "To review" queue. Item titled "Repayment from Areej," flagged "Amount needed," with meta "Account needed · Areej."
- **Expected Behaviour:** The AI correctly identifying this as a Repayment involving person Areej is the desired classification behavior. Since the phrase "all the money that he owed me" refers to a specific existing balance (Areej's tracked owed amount) rather than an indefinite/unresolvable quantity, the system should ideally be able to resolve this to a concrete figure (e.g., by referencing the person's existing tracked balance) rather than leaving the amount permanently unresolved with no path to completion other than the user manually re-typing a number.
- **Actual Behaviour:** The AI correctly recognized the transaction as a Repayment tied to person Areej, and correctly did not fabricate a specific numeric amount for the relative phrase "all the money that he owed me" — consistent with the no-invention principle. However, it surfaced three overlapping messages for what is effectively a single missing-amount issue: (1) "No amount yet — add one before approving." (2) "The amount was not grounded in what the user said." (3) "Unresolved conflict: No amount was heard for this one — add it before approving." The transaction cannot be approved until the user manually enters the amount.
- **Result:** PARTIAL
- **Category:** Missing Information, Amount Extraction, Structured Output
- **Severity:** Medium
- **Failure Type:** Missing required information not resolved; redundant duplicate flags
- **Reproducibility:** Not Tested
- **Status:** Open
- **Notes:** The non-fabrication behavior here is correct and should be preserved as-is; the gap is a missing capability to resolve a balance-relative reference ("all the money he owed me") using data the application itself may already track for that person, plus the redundant flag pattern also seen in TC-028.

**User's proposed architectural idea (recorded for future reference only; not evaluated, endorsed, or converted into a requirement during this testing phase, per testing guidelines):** The user hypothesizes that the AI-to-application pipeline is currently strictly one-way (voice input → AI output → application), with no mechanism for the AI to ask the application a clarifying follow-up question when it recognizes it is missing a piece of information the application may already hold (e.g., "the user referenced a previous balance for this person — what is that balance?"). The user proposes building a back-and-forth mechanism where the AI could query the application for such a specific missing parameter, receive an answer, and reprocess/finalize the transaction using it. The user's stated belief is that this single mechanism could resolve an estimated 50–70% of the inputs currently ending up flagged as incomplete/unfinished transactions, since many such flags may stem from the AI lacking access to data the application already has, rather than from genuine ambiguity in the user's spoken input. This is recorded as the user's idea for consideration during the later architectural-analysis phase, not as an adopted finding or fix.

---

## TC-032

- **Test Case ID:** TC-032
- **Date Discovered:** 2026-08-27
- **User Input:** "withdraw 500 rupees from BOC ATM" (voice/text input, per the "Logged" confirmation screenshot).
- **Context:** Post-fix (second testing round). Kaasu "Logged" confirmation screen reached after input. Transaction resolved as Expense, −Rs500.00, named "ATM Withdrawal," with category "Other," account "BOC," and date "Today" pre-selected/shown as chips. "Approve now" / "Review" options presented.
- **Expected Behaviour:** Per the user, an ATM withdrawal moves money from a bank account into the user's own cash holdings — it does not leave the user's overall financial position for a good or service. The user's expectation is that this should be recognized as a Transfer (source: BOC, destination: the user's cash holdings), not an Expense.
- **Actual Behaviour:** The transaction was classified as an Expense of Rs500.00, named "ATM Withdrawal," with category "Other" and account "BOC" pre-selected, ready for one-tap "Approve now."
- **Result:** FAIL
- **Category:** Transaction Classification, Transaction Type
- **Severity:** High
- **Failure Type:** Incorrect classification
- **Reproducibility:** Not Tested
- **Status:** Open
- **Notes:** Per the user, this is a conceptual classification gap rather than an extraction error: the AI correctly extracted the amount, account, and "ATM withdrawal" intent, but classified the operation as spending rather than as a movement between the user's own bank and cash holdings. If this pattern is systemic, it would cause "Other"-category expense totals/reports to be inflated by self-transfers rather than genuine spending. Whether Kaasu currently models cash-in-hand as a first-class account entity that a Transfer destination could resolve to is unknown from this single observation. Root cause not investigated (evidence collection phase only, per testing guidelines).

---

## TC-033

- **Test Case ID:** TC-033
- **Date Discovered:** 2026-08-29
- **User Input:** Voice/text input describing a "Sugar" purchase under Groceries, with the spoken date/time expression "yesterday around 10:00 in the evening."
- **Context:** Post-fix (second testing round). Kaasu "Finish details" confirmation screen. Transaction: Name "Sugar," Category "Groceries" (pre-selected), Account "Room" (the user's own account, correctly pre-selected). DATE fields showed "29 Aug 2026" and "09:50" — i.e. the current day and current time at the moment of speaking, not the previous day's evening. A "PLEASE CONFIRM" flag read: "Couldn't turn 'yesterday around 10:00 in the evening' into a date — approving records it on the day it was spoken. Confirm, or reject and re-enter with the date," with a "Keep as-is" option.
- **Expected Behaviour:** The relative date-and-time expression "yesterday around 10:00 in the evening" should resolve to the previous calendar day at approximately 22:00, rather than defaulting to the day/time the input was spoken.
- **Actual Behaviour:** The date/time fields defaulted to the current day and current time, and the AI flagged that it could not resolve the expression into a date, requiring the user to either confirm "Keep as-is" or reject and re-enter the transaction with the date corrected manually.
- **Result:** PARTIAL
- **Category:** Date Interpretation, Time Interpretation
- **Severity:** Medium
- **Failure Type:** Incorrect temporal interpretation
- **Reproducibility:** Not Tested (this specific instance)
- **Status:** Open
- **Notes:** Per the user, saying only a relative date ("yesterday," with no time component) resolves correctly to the previous day in their general experience; the failure appears specifically when a time-of-day expression ("around 10:00 in the evening") is combined with the relative date reference. This is the user's own observation distinguishing the two cases based on prior use, not a confirmed root cause from this testing phase. The AI's behavior of flagging for user confirmation rather than silently recording the wrong date is a safer failure mode than silent misdating (consistent with the non-fabrication principle), but the underlying date+time resolution capability failed. The "Room" account chip seen in the screenshot was confirmed by the user to be a legitimate, correctly pre-selected account of theirs — not a resolution issue. Root cause not investigated (evidence collection phase only, per testing guidelines).

---

## TC-034

- **Test Case ID:** TC-034
- **Date Discovered:** 2026-08-29
- **User Input:** "Transfer 5,000 from Room account to BOC add then optional note as 200 left" (per the "2 logged" confirmation screen transcript).
- **Context:** Post-fix (second testing round). Kaasu "2 logged" confirmation screen. Two items were logged from this single utterance: (1) Transfer, Rs5,000.00, named "Transfer to BOC," Room → BOC, date Today — correctly formed and directly approvable ("Approve now" / "Review"). (2) Expense, −Rs200.00, named "Note," flagged "Category needed" and "Account needed," date Today — not directly approvable, requiring "Finish details in queue."
- **Expected Behaviour:** The clause "add [an] optional note as 200 left" describes metadata (an optional note/annotation) to attach to the single Transfer transaction, not a second financial transaction. The AI should produce one Transfer candidate (Rs.5,000, Room → BOC) with an optional Note field populated with the text "200 left."
- **Actual Behaviour:** The AI correctly created the Transfer candidate (Rs.5,000, Room → BOC), but also created a second, unintended Expense candidate for Rs.200.00, literally named "Note," with category and account left unresolved/flagged and requiring further manual completion before it could be approved.
- **Result:** FAIL
- **Category:** Non-Transactional Input, Structured Output, Transaction Classification
- **Severity:** Critical
- **Failure Type:** Unauthorized/spurious transaction creation from non-transactional content
- **Reproducibility:** Not Tested (this specific instance is confirmed via screenshot; the user reports this reflects a broader pattern with note-style annotations, but that broader pattern has not itself been formally reproduced in this log)
- **Status:** Open
- **Notes:** The numeric figure "200" embedded in what the user intended purely as a descriptive note appears to have been sufficient on its own to trigger a second, independent transaction candidate — directly matching the general principle that the mere presence of a number should not imply a transaction. There does not currently appear to be any capability for the AI to recognize or populate an optional "note" field on a transaction; note-like language is instead parsed as transactional content. The spurious Expense candidate was not silently auto-approved — it remained incomplete/flagged and required the user to finish or reject it — which limits but does not eliminate the practical risk, since a bulk "approve all"-style action could still commit it once completed. Root cause not investigated (evidence collection phase only, per testing guidelines).

---

## TC-035

- **Test Case ID:** TC-035
- **Date Discovered:** 2026-09-02
- **User Input:** "borrowed 300 rupees from Nuski to cash and spent 270 on lunch from the money I borrowed"
- **Context:** Post-fix (second testing round). Kaasu Home screen, "To review" queue (2 items). Two candidates were logged from this single utterance: (1) "Lunch," −Rs270.00, meta "Cash · Food" — account correctly resolved to Cash, category resolved to Food, directly approvable ("Approve"). (2) "Borrowed from Nuski," Rs300.00, meta "Account needed · Nuski," flagged "No account selected," not directly approvable, requiring "Finish details."
- **Expected Behaviour:** The user explicitly stated the borrowed money was moved "to cash." Since the sibling "Lunch" candidate drawn from the very same utterance correctly resolved its account to Cash, the "Borrowed from Nuski" (Lending) candidate should likewise have resolved its account to Cash rather than being left unresolved.
- **Actual Behaviour:** The Lending/Borrow candidate's account field was left unresolved ("No account selected"), flagged "Account needed," despite "to cash" being explicitly stated in the same transcript and correctly applied to the other (Lunch) candidate from that same transcript.
- **Result:** FAIL
- **Category:** Entity Resolution, Account Resolution, Lending
- **Severity:** Medium
- **Failure Type:** Missing entity resolution (inconsistent across sibling candidates from the same utterance)
- **Reproducibility:** Not Tested
- **Status:** Open
- **Notes:** This parallels TC-029 (an explicitly stated account not being pre-selected), but here it is notable that one candidate from the compound utterance (Lunch) correctly resolved the stated account while its sibling candidate (Borrowed from Nuski), drawn from the identical spoken account reference, did not — raising the possibility that account resolution may currently be applied inconsistently across operation types (e.g. ordinary Expense vs. Lending), though this is not confirmed from a single observation. The AI's behavior of leaving the field genuinely unresolved and blocking approval, rather than defaulting to an arbitrary account, is the safer/correct fallback per the non-fabrication principle. Root cause not investigated (evidence collection phase only, per testing guidelines).

---

## TC-036

- **Test Case ID:** TC-036
- **Date Discovered:** 2026-09-06
- **User Input:** Obs 1 (2026-09-06): "I borrowed 266 rupees from Nuski, label it as Sham's share on lunch." Obs 2 (2026-09-17): "Bought strawberries for 500 rupees on cash, label it as fruits."
- **Context:** Post-fix (second testing round). Obs 1: Kaasu Home screen, "To review" queue (1 item). Item: "Lunch Share," Rs266.00, meta "Account needed · Nuski." Two flags shown: (1) "Unresolved conflict: User asked to label the borrowing transaction as Sham's share." (2) "No account selected." Only a "Finish details" action was available for this item — no "Keep as-is" or other direct resolution shortcut was shown for the conflict flag specifically. Obs 2: Kaasu "Logged" confirmation screen showed the transaction as correctly resolved (Expense, −Rs500.00, "Strawberries," category "Groceries," account "Cash," date "Today") with no flag visible on that screen. Only upon separately visiting the Home screen "To review" queue did a flag appear on the same item: "Unresolved conflict: User asked to label the expense as fruits," alongside a "Finish details" / edit icon / reject (X) action row.
- **Expected Behaviour:** Per the user, "label it as [X]" (Obs 1: "Sham's share"; Obs 2: "fruits") was intended as descriptive naming/context for the transaction (what the money was for, or a nickname for the item), not as a competing instruction that changes the transaction's type, person, direction, or category. The user expected the AI to simply apply the requested label/name without raising any conflict, since it appears to have heard and transcribed the instruction correctly in both cases.
- **Actual Behaviour:** In both observations, the AI flagged an "Unresolved conflict" describing only that the user asked to apply a label, without clarifying what the two competing values supposedly were or how to resolve them, and without offering a direct one-tap resolution action for that specific flag. In Obs 2, the category was in fact correctly resolved to "Groceries" (not overridden to "fruits"), and the amount/account/date were all correct — yet the conflict flag was still raised. The user reported not understanding what the flag was asking them to do in either case.
- **Result:** FAIL
- **Category:** Ambiguity Handling, Structured Output, Lending
- **Severity:** Medium
- **Failure Type:** Incorrect/spurious conflict detection; unclear structured-output messaging
- **Reproducibility:** Reproduced (same underlying pattern observed across two different transaction types — Lending in Obs 1, Expense in Obs 2 — both triggered by a "label it as [X]" instruction)
- **Status:** Open
- **Notes:** Per the user, both inputs were simple/unambiguous, and the resulting flag was confusing because it did not clearly state what was in conflict or how to resolve it (contrast with TC-028, where a comparable flag at least offered a "Keep as-is" option). This raises the possibility that any "label it as [X]" phrasing is being misread as a competing person/category/type instruction rather than as descriptive naming or context, though the exact trigger condition is not confirmed from these two observations alone. In Obs 1 the separate "No account selected" flag appears to be expected/correct behavior, since the user did not specify an account for the borrowed cash. In Obs 2, the category was correctly resolved despite the flag being raised, suggesting the conflict-detection mechanism may be triggering independently of whether the requested field was actually overridden. Root cause not investigated (evidence collection phase only, per testing guidelines).

---

## TC-037

- **Test Case ID:** TC-037
- **Date Discovered:** 2026-09-12
- **User Input:** Unknown exact phrasing — no screenshot or transcript was captured for the voice/AI-driven attempt. The initial evidence is a screenshot of the manual "Split a bill" entry screen (reached via the Split icon on the Home screen), which contains "What was it," "Total," "Paid from," "Who was in," "Who paid?," and "How to split"/"Category" fields. Per the user, a separate split-bill request was also tested via voice/AI input, independent of this manual screenshot.
- **Context:** Post-fix (second testing round). The manual "Split a bill" screen shows no date or time field anywhere. Per the user, when they separately tested initiating a split-bill transaction via voice/AI input, the resulting flow likewise had no date/time field or option, though no screenshot was captured for that specific instance.
- **Expected Behaviour:** A split-bill transaction should support specifying a date (and optionally a time) other than the current moment, so that a bill split that occurred on a prior day can be recorded accurately — consistent with how ordinary transactions (Income/Expense/Transfer/Lending) support date selection.
- **Actual Behaviour:** No date/time field is present on the Bill Split entry screen shown in the screenshot (manual path). Per the user, the same absence was also observed when a split-bill transaction was initiated via voice/AI input — there is currently no way to record a split bill against any date other than the default (today).
- **Result:** FAIL
- **Category:** Split Transaction, Structured Output, Date Interpretation
- **Severity:** Medium
- **Failure Type:** Missing capability (no date/time field for split-bill transactions)
- **Reproducibility:** Reproduced (per the user, confirmed absent both on the manual entry screen and in a separate voice/AI-driven attempt, though the latter has no captured evidence beyond the user's description)
- **Status:** Open
- **Notes:** This is primarily an application/UI-layer capability gap (the manual form itself has no date/time input) rather than a pure AI-interpretation error, but per the user it applies equally when the transaction is initiated via voice/AI, so it is recorded here since Bill Split is one of the six operations under active testing in this project. No exact input phrase or screenshot exists for the AI-driven instance. Whether the underlying Bill Split data model carries a date field at any layer (AI contract, application, or database) is unknown from this evidence. Root cause not investigated (evidence collection phase only, per testing guidelines).

---

## TC-038

- **Test Case ID:** TC-038
- **Date Discovered:** 2026-09-13
- **User Input:** "spent rupees on samosas, cash" (per the on-screen transcript shown under "2 logged").
- **Context:** Post-fix (second testing round). Kaasu "2 logged" confirmation screen reached after a single voice input. Two separate Expense candidates were created, both named "Samosas," both flagged "Amount needed," both showing identical meta chips (Snacks · Cash · Today), and both requiring "Finish details in queue." A banner read "2 need an amount before they count."
- **Expected Behaviour:** A single utterance describing one purchase ("samosas," paid in cash) should produce exactly one Expense candidate. If the user's spoken amount was captured, that candidate should show a resolved amount; if no amount was genuinely grounded in what was said, one candidate should be created and flagged "Amount needed" — not two.
- **Actual Behaviour:** Two identical Expense candidates were created from the single utterance ("Samosas," Snacks, Cash, Today), both flagged "Amount needed." The visible on-screen transcript ("spent rupees on samosas, cash") contains no audible numeric amount. The user reports believing they did state an amount, but no amount appears in the captured transcript or either candidate.
- **Result:** FAIL
- **Category:** Structured Output, Amount Extraction
- **Severity:** High
- **Failure Type:** Duplicate/redundant transaction candidate creation from a single non-compound utterance; possible amount-extraction failure
- **Reproducibility:** Not Tested
- **Status:** Open
- **Notes:** Per the user, this was not intended as two separate purchases — only one "samosas" transaction was described. Unlike TC-034 (a second candidate arising from note-like content) or TC-028 (redundant confirmation *flags* on a single transaction), this instance duplicates the entire transaction candidate itself. Whether the user actually spoke an amount that was dropped during capture/extraction, or no amount was said at all, cannot be determined from the available evidence (transcript shows no figure). Neither candidate is directly approvable as-is (both are blocked pending amount entry), which limits but does not eliminate risk — if a user resolves and approves both without noticing they are duplicates, the same purchase could be recorded twice. Root cause not investigated (evidence collection phase only, per testing guidelines).

---

## TC-039

- **Test Case ID:** TC-039
- **Date Discovered:** 2026-09-17
- **User Input:** "Sham paid 280 rupees for dinner for me."
- **Context:** Post-fix (second testing round). Kaasu "Logged" confirmation screen reached after a single voice input. One item was logged: Expense, −Rs280.00, named "Dinner," category "Food," flagged "Account needed," date "Today," not directly approvable, requiring "Finish details in queue."
- **Expected Behaviour:** Per the user, the described scenario — another named person (Sham) paying on the user's behalf — represents a compound event: an ordinary Expense (Dinner, Rs280, attributable to the user's spending) together with a Lending/Borrowing relationship (the user now owes Sham Rs280). The AI should recognize this as two related outcomes rather than a single plain expense.
- **Actual Behaviour:** The AI recorded only a single Expense transaction (Dinner, Rs280, Food) with the account left unresolved and flagged "Account needed." No borrowing/lending record or reference to Sham was created or surfaced anywhere in the output.
- **Result:** FAIL
- **Category:** Lending, Transaction Classification, Structured Output
- **Severity:** High
- **Failure Type:** Missing intent; incorrect/incomplete transaction structure (third-party-payment context not decomposed into Expense + Borrowing)
- **Reproducibility:** Not Tested
- **Status:** Open
- **Notes:** This parallels TC-030 (where the user paying on behalf of another person, Sham, was recorded as a plain personal expense instead of Lending) but in the reverse direction — here another person (Sham) pays on the user's behalf, which per the user's expectation should yield a Borrowing relationship (user owes Sham) in addition to the Expense, not instead of it. Whether Kaasu's current AI contract or application logic has any concept of deriving a linked Lending/Borrowing record from a third-party-payment expense is unknown from this evidence. This is also a candidate instance of the broader "compound/multi-outcome intent not decomposed" pattern already seen in different forms (TC-001/TC-010/TC-020, TC-035), though the underlying mechanism here (one utterance implying two related but distinct financial effects) is not identical to those and is recorded as a separate observation rather than merged into them. Root cause not investigated (evidence collection phase only, per testing guidelines).

---

## TC-040

- **Test Case ID:** TC-040
- **Date Discovered:** 2026-09-17
- **User Input:** "Bought strawberries for 500 rupees on cash, label it as fruits." (same input as TC-036 Obs 2; distinct failure mode observed across two different screens)
- **Context:** Post-fix (second testing round). Immediately after voice input, Kaasu's "Logged" confirmation screen showed the transaction fully resolved (Expense, −Rs500.00, "Strawberries," category "Groceries," account "Cash," date "Today") with no flag, warning, or indication of any issue visible on that screen — only a "Finish details in queue" action, which per the user's established pattern elsewhere in this log can appear even on items with no flag. Only when the user separately navigated to the Home screen "To review" queue did a flag appear on that same item: "Unresolved conflict: User asked to label the expense as fruits," shown alongside "Finish details," an edit icon, and a reject (X) action.
- **Expected Behaviour:** Per the user, if the AI determines a logged transaction has an issue requiring the user's attention (a flag), that flag should be surfaced immediately on the "Logged" confirmation screen shown right after the input is processed — the point at which the user is already looking at the result and best placed to correct it — not only later, on a separate screen (the Home "To review" queue) that the user must think to visit on their own.
- **Actual Behaviour:** The flag was shown only in the Home "To review" queue and was completely absent from the "Logged" confirmation screen for the same transaction, even though the transaction (per TC-036) was already flagged with an unresolved conflict at the time it was logged. The user only became aware of the issue by separately checking the Home screen afterward.
- **Result:** FAIL
- **Category:** Structured Output, Ambiguity Handling
- **Severity:** Medium
- **Failure Type:** Inconsistent flag surfacing across screens (flag present in one UI location, absent in another, for the same transaction at the same point in time)
- **Reproducibility:** Not Tested
- **Status:** Open
- **Notes:** This is a distinct failure mode from TC-036, which concerns why the conflict flag was raised at all; TC-040 concerns where that flag is (and is not) shown once it exists. Per the user, the general principle they expect is binary: inputs with no issue should show no flag anywhere, and inputs with a genuine issue should show that flag consistently in every place the transaction appears, starting with the first confirmation screen the user sees. Whether other flagged test cases in this log (e.g. TC-028, TC-031) also exhibited this same screen-visibility gap on their respective "Logged"/"Finish details" confirmation screens was not separately checked at the time and is unknown from existing evidence. Root cause not investigated (evidence collection phase only, per testing guidelines).
