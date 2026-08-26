# Design System & Brand Identity — Kaasu (v2, redesign pass 2026-08-12)

Supersedes the v1 document. Everything in v1 that is not mentioned here is
unchanged. This version records the decisions made while designing the full
redesigned UI (`Kaasu Redesign.dc.html`, option 2a + turn 3 screens), so the
implementation can be built from this file alone.

**Companion documents:** `expense-tracker-spec.md` (what it does),
`technical-plan.md` (how it's built).

**Stack:** React Native (Expo). All tokens are plain JS/TS objects consumed via a
theme context — no Tailwind, no CSS.

---

## 0. What changed from v1

| Area | v1 | v2 |
|---|---|---|
| Home header | Brown hero **card** inset on the cream page | **Full-bleed brown canopy** header; content sheet lifts over it with a 24px top radius |
| Home order | Hero → quick actions → queue | Canopy (balance + in/out + spend bar) → quick actions → **To review** → Spending this month → Coming up |
| Pending count | Separate pill inside the hero | A line in the canopy footer row, beside the spend bar |
| Voice button | 60pt circular mic FAB | **Full-width "Hold to speak" bar** + a 56pt `+` button beside it |
| Queue actions | Three equal text actions on a divider row | **Filled green Approve pill** + two 44pt icon buttons (edit, reject) |
| Account cards | Type-coloured card fills | **Neutral cards with a 4px type-coloured left edge** |
| Settings | Accordion, one section open | **Plain list of rows**, each opens a subpage |
| Amount entry | Plain field | **Large amount display + custom keypad** with `+ − × =` |
| Reports | Bars + donut | Month switcher, in/out summary, category bars, donut, **daily spending bars**, **by-account** |
| Coming up | — | New Home section: next recurring + people who owe you |

The two hard colour rules, the palette, the type scale, spacing, radii and the
anti-patterns are all unchanged and still binding.

---

## 1. Brand Identity

Unchanged from v1. **Kaasu** — a private, voice-first personal money tracker.
Calm, effortless, honest, warm, unobtrusive. Voice & tone: plain and short,
never chirpy, never guilt-inducing. "2 to review", not "You've got 2 exciting
transactions waiting!"

Copy decisions made in the redesign, adopt these strings:

- Canopy: `Total balance` · `This month in` / `This month out` ·
  `Spent 69% of what came in` · `2 to review — not counted`
- Queue heading: `To review` with a count badge; action `Approve all`
- Voice bar: `Hold to speak`; while recording `Release to stop · it lands in your queue`
- After capture: `Logged` / `Waiting in your queue on Home. Nothing is counted
  until you approve it.`
- Spending section: `Spending this month`; overflow row is `Everything else`
- Upcoming section: `Coming up`
- Lending: always in words — `Owes you Rs2,000`, `Lent to Suresh`
- Settle up: `They are paying you` · `What this covers` · `Record repayment`
- Split summary sentence, stated before the action:
  `Creates one expense of Rs12,600.00 on Commercial Bank, and lends Rs4,000.00
  to Suresh and Rs3,000.00 to Ayesha.`

---

## 2. Colour System

### 2.1–2.6 Tokens
Unchanged from v1 — light, dark, category palette (12 colours), and the two hard
rules (never colour alone; one dominant colour ≥60%). Reproduced here for
convenience only where v2 adds guidance.

### 2.7 New: contrast rule for de-emphasised numerals (correction)
A tinted wash of a semantic colour is **not** allowed for any part of an amount.
When the cents are visually de-emphasised on the amount display, they must use a
**muted text token**, never a lightened expense/income hue:

- light: cents in `textMuted` `#7A6E66` (≈4.9:1 on `bg`)
- dark: cents in `textMuted` `#B0A199` (≈7:1 on `bg`)

The digits are data, and §3.2 requires exact amounts, so they carry body
contrast. (A tinted `#E3A091` / `#2F6B4B` cents treatment was tried and
rejected at ≈2.0:1 and ≈2.9:1.)

### 2.8 New: where the brown may be a large surface
`primary` is allowed as a **full-bleed surface** in exactly two places:

1. the Home canopy header (top ~300px)
2. the voice capture screen (full screen, reads as a modal overlay)

Everywhere else `primary` is reserved for buttons, active nav, selected chips
and small accents. In dark mode neither surface uses `primary`: the canopy is
`surface` `#241E1A` and the voice screen keeps the same, with `primary`
`#E09763` used for type and the action bar only.

### 2.9 New: chart colour assignment
Category bars, donut segments and the by-account list all read colour from the
same source as the category/account, so a category is the same colour in every
chart. Overflow rows ("Everything else") use `#9C7A5A` (warm taupe, last in the
category palette) and are never given a real category's colour. Account
breakdown rows use the account-type accents as a 4px rounded rule, not a fill.

---

## 3. Typography

Pairing unchanged: **Sora** (headings, numerals) + **Inter** (body, UI). Scale
unchanged. Additions observed in the redesign:

| Token | Size / Line | Weight | Font | Use |
|---|---|---|---|---|
| `amountInput` | 40 / 48 | 700 | Sora | The amount display on the transaction form |
| `amountInputCents` | 26 | 700 | Sora | Cents on that display, in `textMuted` |
| `keypadKey` | 20 | 600 | Sora | Keypad digits |
| `sectionLabel` | 13 / 18 | 500 | Inter | Day headers and eyebrow labels — uppercase, `letterSpacing: 0.8`, `textSubtle` |

`h1` (22/28 Sora 600) is the screen title on Accounts, Reports and Settings;
`h2` (18/24) is the Home section heading and the pushed-screen title in the
header bar. Numeral rules from v1 §3.2 all still apply, including tabular
figures everywhere and abbreviation only in compact summaries (`Rs17.4K`).

---

## 4. Layout, Spacing, Shape

`space` and `radius` unchanged. Base unit 4px, screen padding 16px, card radius
16px, minimum touch target 44×44pt.

### 4.2 New: measured layout constants
```ts
export const layout = {
  screenPaddingH: 16,
  canopyPaddingH: 24,        // the brown Home header is inset 24, not 16
  sheetRadius: 24,           // content sheet over the canopy
  sheetOverlap: 22,          // sheet pulls up over the canopy by this much
  cardRadius: 16,
  heroCardRadius: 20,        // detail-screen amount card, donut card
  rowRadius: 12,             // transaction rows, list rows
  iconTile: { size: 40, radius: 12 },   // row icon squares
  iconTileSm: { size: 36, radius: 8 },  // dense list rows
  quickActionTile: { size: 46, radius: 14 },
  chipPaddingV: 9, chipPaddingH: 16,
  pendingEdge: 4,            // amber left edge on queue cards
  accountEdge: 4,            // type-coloured left edge on account cards
  primaryButtonH: 54,
  voiceBarH: 56,
  fabSm: 56,
  keypadKeyH: 50,
  tabBarPaddingBottom: 22,   // above the home indicator
};
```

### 4.3 Bottom-anchored content clearance
Any scroll view that sits under the voice bar or a FAB needs a bottom spacer of
**at least** `bottomInset + control height + 24`. In the mockups this is 200px
on Home and 190px on Accounts. Nothing in a list may sit under a floating
control — this was the single most common defect while designing.

### 4.1 Elevation
Unchanged: `shadowColor '#7A4A34'`, opacity 0.06, radius 12, offset `{0, 4}`.
Dark mode uses lighter surfaces instead of shadows. The keypad panel is the one
exception and carries an upward shadow, `offset { width: 0, height: -8 }`,
opacity 0.08, radius 24 — it needs to read as floating above the form.

---

## 5. Core Components

### 5.1 Transaction Row — unchanged
```
[icon]  Name                        −Rs200.00
        Category · Account · 14:20
```
36pt icon tile (radius 8) tinted with the category colour at ~13% alpha, amount
right-aligned, signed and tabular. Transfers show `Account A → Account B` and
use `transfer` blue with no sign. Lending shows the direction in words. Pending
rows get a 3px amber left edge **and** the word `Pending` in the subtitle.

### 5.2 Balance Canopy (replaces Balance Hero Card)
Full-bleed `primary` surface at the top of Home, inset 24px, containing in
order:

1. app title `Kaasu` (Sora 700 / 20) and a month pill (`primaryPress` fill)
2. `Total balance` label + eye toggle
3. the balance in `displayXL`-ish 38/44 Sora 700, tabular
4. `This month in` / `This month out` pair, 32px gap, signed
5. an 8px spend bar (`lending` gold fill on a `primaryPress` track) with
   `Spent N% of what came in` and `N to review — not counted` beneath

Approved transactions only — pending items never enter these figures. The
content sheet below has a 24px top radius and pulls up 22px over the canopy.
The eye toggle masks the balance and both month figures as `Rs ••••••` / `••••`.

### 5.3 Type Selector — now four segments
`Expense · Income · Transfer · Lending` on a pill track (`surfaceAlt`), selected
segment filled `primary` with `onPrimary` label at Inter 600/13. Sits directly
under the screen title. Switching type changes which fields render:

- expense/income: account, category, person (optional)
- transfer: from account, to account, no category
- lending: account, direction, person (required)

At four segments the labels are tight on a 390pt screen; if they truncate on
device, reduce to Inter 600/12 before changing the layout.

### 5.4 Chip Selector — unchanged
Wrapping pill chips, 9×16 padding, `surface` fill + `border` when unselected,
`primarySoft` fill + `primary` border + `primary` label when selected, trailing
`+ Add` chip in `primary` text. Used for accounts, categories, people, split
participants and settle-up destination.

### 5.5 Voice Capture (revised — bar, not FAB)
The entry point is a **full-width "Hold to speak" bar**, 56pt tall, `primary`
fill, mic icon + Sora 600/16 label, sitting 92px above the bottom edge with a
56pt `+` circle beside it for manual entry. It is the widest, easiest target on
Home — that is the point.

The capture screen is a full-bleed `primary` modal (`slide_from_bottom`) with:

- eyebrow `Listening` in `lending` gold, uppercase
- a 10-bar amplitude meter, white bars at varying alpha
- the live transcript in Sora 600/22 centred, up to ~3 lines
- an elapsed timer in tabular figures
- a 96pt ring around a 74pt white mic button
- footer hint `Release to stop · it lands in your queue`
- a close `×` in a `primaryPress` circle, top right

**Confirmation state** is its own screen on `bg`: a green check in a tinted
circle, `Logged`, the parsed transaction rendered as a real row inside a
bordered card, the reassurance line, then `Approve now` (green) /
`Review later` (outline), and a `Say another` chip at the bottom. No dialog, no
confetti. If parsing fails, keep the audio and transcript and file the item with
a confidence flag rather than losing it.

### 5.6 Queue Item Card (revised actions)
`surface` card, 16px radius, `border` hairline, containing: a 36pt round
category icon, name + amount on one baseline, `Category · Account · time`, the
**always-visible** transcript in italic `textSubtle` 13/19, then confidence-flag
pills, then the action row.

Actions, left-inset to align with the text column (62px):
- **Approve** — filled `income` pill, flex 1, white check + label
- **Edit** — 44pt outlined icon button
- **Reject** — 44pt outlined icon button in `expense`

Bulk approve is an `Approve all` text action in the section header, next to the
`To review` heading and its amber count badge. Approve/reject animates as
`FadeOut` + `LinearTransition` on the remaining rows.

Empty queue: keep the section, show the prompt to log by voice — never a bare
"No data".

### 5.7 Person Balance Row — unchanged
Direction in words: `Owes you Rs2,000`, in `lending` gold.

### 5.8 Empty States — unchanged, warm and actionable.

### 5.9 Date & Time Field
The form shows date and time as two `surface` pills in the `When` field; tapping
either opens the **native iOS picker** (`datetimepicker`, mode `datetime`,
`themeVariant` following the theme, `accentColor` = primary). Do not build a
custom calendar.

### 5.10 Settings (revised — plain rows, not an accordion)
Profile pinned at top: 96pt circular avatar (initials on `primarySoft`, tap to
pick a photo) with a 32pt camera badge in `primary` and a 2px `bg` ring, name
beneath in Sora 600/18.

Below it, a list of `surface` rows, 16px radius, each: 38pt tinted icon tile +
title (Sora 600/16) + a one-line current value in `caption` + chevron. Rows:
**Currency**, **Data & Backup**, **Voice**, **Appearance**, **About Kaasu**.
Each pushes a subpage (`slide_from_right`). The current-value line is required —
it is what makes the list readable without opening anything.

Destructive actions live inside Data & Backup, state what will happen, and use
type-to-confirm `DELETE`.

### 5.11 Donut chart
Unchanged in intent: hand-built on **react-native-svg**, segments coloured from
the category palette, centre hole showing the period total, tap to select a
segment (dims others, highlights the matching bar row) and vice versa. In the
mockups it is 190pt across with a 116pt hole, and it sits **inside a `surface`
card with a wrapping legend of colour chip + `Name %`** below it — the legend is
required (colour is never the only key). No leader lines: they were the least
readable part of the reference app.

### 5.12 New: Account Card
`surface` card, 16px radius, a **4px type-coloured left edge**
(`accountBank` / `accountCash` / `accountCard`), then a 40pt tinted icon tile,
name in Sora 600/16, `Type · detail` in caption, balance right-aligned in Sora
600/17 tabular. The **selected** card swaps its `border` for `primary` and adds
`showing below` to its subtitle — colour never carries the selection alone.
Tapping a card filters the list beneath it, including transfers that touch it.

### 5.13 New: Amount Display + Keypad
The transaction form's amount is a centred display, not a text input: eyebrow
`Amount`, then the signed figure in Sora 700/40 coloured by type
(`expense` / `income` / `transfer` / `lending`), with the cents at 26pt in
`textMuted`.

The keypad is a pinned bottom panel on `surface` with a hairline top border and
an upward shadow: a 4-column grid of 50pt keys — digits and `.` on `bg`, the
operators `+ − × =` on `surfaceAlt` in `primary`, a backspace key — and the
primary `Save transaction` button, 54pt pill, directly beneath. Quick math
evaluates on `=` and the display shows the result; the stored value is always
integer minor units.

### 5.14 New: Transaction Detail
Pushed screen with a back chevron, title `Transaction` and an edit pencil.
Body: a centred `surface` card (20px radius) with a 56pt category tile, the
signed amount in Sora 700/34 coloured by type, the name, and a provenance chip
(`Added by voice · Approved`). Then a `surface` card of label/value rows
(hairline dividers): Category, Account, When, Person, Note. Then, for voice
items, a `surfaceAlt` block titled `What you said` with the transcript. Footer:
`Edit` (primary pill, flex) + a 44pt outlined delete button in `expense`.

### 5.15 New: Bill Split
Fields in order: what it was, total (large tabular figure in a 60pt field),
paid-from account chips, participant chips (including `You`), then a split-mode
segmented control **Equal · Custom amounts**. Below it, one row per participant
with their share, then a reconciliation line —
`Assigned Rs12,600.00 of Rs12,600.00` with `Balanced` in `income` (or the
remaining amount in `warning` when it doesn't add up). A `surfaceAlt` block
states in plain words exactly which transactions will be created, above
`Create split`. Never create the split while unbalanced.

### 5.16 New: Settle Up
Person card (56pt avatar, name, `Owes you Rs6,000.00` in `lending`, and the
count of things it spans), the amount they are paying with a `Full amount`
shortcut, destination account chips, a `What this covers` list of the individual
lendings/splits being settled, then `Record repayment`. Partial repayments are
allowed and reduce the outstanding balance.

---

## 6. Navigation

Bottom tab bar, four tabs — **Home · Accounts · Reports · Settings**. The bar is
`surface` (white) with a hairline top border, 10px top padding and 22px bottom
padding, icons 22pt, labels 12pt; the active tab is `primary` icon + Inter 500
label, inactive `textSubtle`. Never more than four tabs.

**Home, top to bottom:** canopy → quick-action row → **To review** queue →
**Spending this month** → **Coming up** → bottom spacer.

**Quick-action row:** four tiles — Recurring · Split · People · Categories —
46pt `surface` squares with a `border` and a `primary` glyph, label beneath in
caption. These are the only entry points to those secondary screens.

**Coming up:** the next due recurring template and any person with an
outstanding balance, as `surface` rows. It exists so the app answers "what's
about to happen" without a fifth tab.

**Accounts:** account cards on top; tapping one filters the day-grouped
transaction list beneath (day header + the day's net in tabular figures on the
right); search field plus a filter button; a single `+` FAB bottom right.

> **The day's net, defined (2026-08-25).** It answers a different question
> depending on the filter, and both are in `src/domain/accountActivity.ts`:
>
> - **All accounts → net spending.** Only `expense` and `income` count, per the
>   golden rule. Lending and transfers are excluded, so a day of pure movement
>   nets to zero.
> - **One account selected → that account's cash movement,** where transfers
>   and lending genuinely belong.
>
> The all-accounts case previously used the cash figure and was wrong twice
> over: lending rows render *unsigned*, so the total could not be derived from
> anything on screen, and a bill split where someone else paid (a borrow +
> expense pair) cancelled itself out — hiding the very spending the split
> feature exists to report.

**Reports:** month switcher (chevron / `August 2026` / chevron) → income and
spending summary pair → category bars → donut card → daily spending bars
(current day highlighted in `primary`, the rest `primarySoft`) → by-account
list.

**Floating controls:** Home carries the `Hold to speak` bar + `+` circle;
Accounts carries a single 56pt `+` FAB; other screens carry none. Forms are
pushed full screens, never bottom sheets.

---

## 7. Motion

Unchanged from v1: expo-router transitions + reanimated. Screen push
`slide_from_right`; voice capture `slide_from_bottom` as a modal; tab switch
`shift`; press scale 0.97 (0.90 on the voice bar); chip selection 150ms fade;
queue approve/reject 200ms `FadeOut` + `LinearTransition`; voice pulse 1200ms.
Respect reduce-motion. No bounces, no parallax, no confetti.

---

## 8. Anti-Patterns

All of v1's still apply. Added from this pass:

- ❌ Amount digits in a low-contrast tint of the semantic colour
- ❌ Content sitting under the voice bar or a FAB (always add the bottom spacer)
- ❌ Pie/donut leader labels instead of a legend
- ❌ Type-coloured card fills for accounts (edge, tile and label carry the type)
- ❌ A dense multi-card overview grid on Home
- ❌ Colour-only selection state on account cards or chips
- ❌ Creating a split or settlement that doesn't reconcile to the total

---

## 9. Pre-Delivery Checklist

- [ ] Text contrast ≥ 4.5:1 in both themes — **including cents and de-emphasised numerals**
- [ ] No meaning conveyed by colour alone — sign/icon/label always present
- [ ] All touch targets ≥ 44×44pt, including queue edit/reject icon buttons
- [ ] Tabular figures on every amount; alignment verified in long lists
- [ ] Nothing scrolls under the voice bar, the `+` circle or a FAB
- [ ] Pending vs. approved unmistakable; pending never in headline totals
- [ ] Voice bar reachable one-handed on the iPhone 12 Pro
- [ ] Reduce-motion respected
- [ ] Empty states written for every list screen, including an empty queue
- [ ] Long names and large amounts truncate gracefully (test Rs1,000,000.00)
- [ ] Four type-selector segments legible without truncation
- [ ] Category colours consistent between bars, donut and rows
- [ ] Keypad `=` result matches the stored minor-unit value

---

## 10. Implementation Notes (React Native)

As v1: tokens in `src/theme/tokens.ts`, `ThemeContext` for light/dark, never a
hardcoded hex in a component, Sora + Inter via `expo-font` behind a splash,
`@expo/vector-icons` (Feather) for icons, one `<Amount value type />` component
owning sign, colour, symbol and tabular figures.

Added for v2:

- Add `layout` (§4.2) to the tokens file and read every measurement from it.
- New components to build: `BalanceCanopy` (replaces `BalanceHero`),
  `VoiceBar`, `AmountDisplay`, `Keypad`, `AccountCard`, `DayHeader`,
  `SectionHeader` (title + optional action), `ComingUpRow`, `SettingsRow`,
  `SplitParticipantRow`, `ProvenanceChip`.
- `QueueItemCard` changes shape: filled Approve pill + two icon buttons, and the
  transcript is always rendered when present.
- Feather has no truck glyph — Transport uses `navigation`. Pick every category
  icon from Feather names only, so nothing is hand-drawn.
- The canopy's spend percentage is `monthExpense / monthIncome`, clamped to
  100%, and hidden when income is zero (show the bar track only).
