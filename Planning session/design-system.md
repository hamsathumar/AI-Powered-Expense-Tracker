# Design System & Brand Identity — Kaasu

**Companion documents:** `expense-tracker-spec.md` (what it does),
`technical-plan.md` (how it's built).

**Stack:** React Native (Expo). All tokens below are plain JS/TS objects
consumed via a theme context — no Tailwind, no CSS.

**Method:** Generated following the UI/UX Pro Max methodology — product type →
style → palette → typography → effects → anti-patterns → checklist — with the
palette decision grounded in colour-psychology research for financial products
(sources noted in §2).

---

## 1. Brand Identity

### 1.1 Product positioning
A **private, voice-first personal money tracker**. Not a bank. Not a fintech
product. It holds no money and connects to no institution — it is a quiet
personal record that the user opens several times a day, often mid-conversation
or walking down the street.

This positioning drives every design decision below.

### 1.2 Brand personality
| Trait | Meaning in the UI |
|---|---|
| **Calm** | Never alarms the user about their own spending. No red-splashed warnings. |
| **Effortless** | The primary action (log a transaction) takes one tap and a sentence. |
| **Honest** | Shows what is confirmed vs. pending with total clarity. Never fakes certainty. |
| **Warm** | Feels like a personal notebook, not an accounting terminal. |
| **Unobtrusive** | Gets out of the way. The app is a means, not a destination. |

### 1.3 Name: Kaasu (DECIDED 2026-08-09)
**Kaasu** — "money" in Tamil/Malayalam. Short, local, personal, memorable —
fits the private-notebook positioning exactly. Treat "Kaasu" as the canonical
name throughout the codebase, docs, and `app.json`. (A future rename is
acceptable if the user asks, but this is no longer an open question.)

**Voice & tone:** plain, short, never chirpy. "3 to review" not "You've got 3
exciting transactions waiting!" Never guilt the user: "Rs4,200 on Food this
month," never "You overspent again."

---

## 2. Colour System

### 2.1 The reasoning (why warm, not the usual fintech blue)
Research consistently recommends blue for financial products — it is read as
trustworthy and is the safest choice globally, which is why most banks use it.
**That research is about institutional trust:** persuading a stranger to hand
money to a company.

This app is different. It holds no money, has no company behind it, and is used
privately many times a day. The relevant goal is **reducing financial anxiety
and feeling pleasant in daily use** — and the same body of research supports
that direction: high-trust financial interfaces use calm, organised visual
environments that reduce anxiety, warm tones read as welcoming, and emotionally
clear design outperforms emotionally neutral design (the neobank lesson from
Monzo/Revolut).

**Decision:** warm, earthy, low-saturation base. Blue is retained but demoted to
an *informational* accent, keeping its clarity benefit without making the app
feel like a bank.

### 2.2 Two hard rules (non-negotiable)

**Rule 1 — Never signal meaning with colour alone.**
Roughly 10% of people cannot fully distinguish red from green. Every
expense/income indicator must ALSO carry a sign (`+` / `−`), an icon, or a text
label. This applies to transaction rows, charts, and summary cards.

**Rule 2 — One dominant colour, ≥60% of the visual field.**
The warm neutral background is that dominant colour. Accents are used sparingly
and always mean the same thing everywhere — zero ambiguity.

### 2.3 Light theme tokens

```ts
export const light = {
  // Surfaces — the dominant 60%+
  bg:            '#FBF6F1',  // warm off-white, app background
  surface:       '#FFFFFF',  // cards
  surfaceAlt:    '#F4EBE3',  // subtle raised/secondary panels
  border:        '#E8DDD3',

  // Brand — richer warm brown (vibrant pass 2026-08-10)
  primary:       '#8A4A2A',  // warm brown — primary actions, active nav
  primaryPress:  '#6E3A22',
  primarySoft:   '#F8E2D2',  // warm peach tint — selected chips, tiles
  onPrimary:     '#FFFFFF',

  // Text
  text:          '#2E2723',  // near-black warm
  textMuted:     '#7A6E66',
  textSubtle:    '#A2958B',

  // Semantic — vivid but ≥4.5:1 as numerals; ALWAYS paired with sign/icon/label
  expense:       '#D1462F',  // vivid clay-red (never a dominant fill)
  income:        '#1E9557',  // vivid emerald
  transfer:      '#2C74BE',  // clear blue
  lending:       '#B07514',  // rich gold
  warning:       '#C98A1E',  // amber — pending / needs review

  // Account-type accents (paired with the type label, not colour-alone)
  accountCash:   '#23A866',
  accountBank:   '#2C74BE',
  accountCard:   '#7B5AD6',

  // Feedback
  success:       '#1E9557',
  danger:        '#D1462F',
};
```

### 2.4 Dark theme tokens
Warm-tinted dark, not pure black. Pure `#000` with warm accents reads harsh and
breaks the calm positioning. Semantic hues are lifted in lightness to maintain
contrast on dark surfaces.

```ts
export const dark = {
  bg:            '#1A1614',
  surface:       '#241E1A',
  surfaceAlt:    '#2E2621',
  border:        '#3A302A',

  primary:       '#E09763',  // lifted warm brown — legible on dark
  primaryPress:  '#EDA97A',
  primarySoft:   '#3E2C1E',
  onPrimary:     '#1A1614',

  text:          '#F2EAE3',
  textMuted:     '#B0A199',
  textSubtle:    '#7E7069',

  expense:       '#FF8266',
  income:        '#55D08C',
  transfer:      '#6FB2F2',
  lending:       '#F0B84E',
  warning:       '#F2C24F',

  accountCash:   '#55D08C',
  accountBank:   '#6FB2F2',
  accountCard:   '#A98CF0',

  success:       '#55D08C',
  danger:        '#FF8266',
};
```

**Vibrancy vs. accessibility (2026-08-10):** the palette was made livelier while
keeping the two hard rules — colour never signals meaning alone (sign/icon/label
always present), and red is never a dominant surface (only amounts/small
accents/destructive actions). The warm cream base + brown brand anchor stay as
the calm dominant surface; vibrancy comes from the semantic colours, category
palette, and account-type accents. Coloured numerals keep ≥4.5:1; the brightest
tints are reserved for icon-tiles/segments/chips (fills paired with icon+label).

### 2.5 Colour meaning map (must stay consistent app-wide)
| Colour | Means | Used on |
|---|---|---|
| Primary brown | Action / brand | FAB, primary buttons, active tab |
| Expense red-clay | Money spent | Amounts with `−`, expense chips, chart segments |
| Income green | Money earned | Amounts with `+`, income chips |
| Transfer blue | Own-account movement | Transfer rows, marked "Transfer" |
| Lending amber | Outstanding balance | Person balances, lending rows |
| Warning amber | Needs attention | Pending badge, confidence flags |

### 2.6 Category colours
Categories get their own icon + colour (user-assignable), from a fixed 12-colour
palette — vibrant but harmonious, distinct from the semantic colours, and
distinguishable as pie/donut segments:
`#D1462F #EE7D30 #F2A925 #8FB22E #23A866 #16A89C #2E93D9 #3E6FD6 #7B5AD6 #C74FB0
#E0698F #9C7A5A`.

---

## 3. Typography

**Pairing: Sora (headings/numerals) + Inter (body/UI).**

- **Sora** — geometric, slightly rounded, modern without novelty. Its numerals
  are distinctive and confident, which matters because this app is mostly
  numbers.
- **Inter** — the reference UI typeface for small text; exceptional legibility
  at 12–16px, where most of this interface lives.

Both are free Google Fonts, load via `expo-font`, and cover Latin well.

### 3.1 Type scale
| Token | Size / Line | Weight | Font | Use |
|---|---|---|---|---|
| `displayXL` | 34 / 40 | 700 | Sora | Total balance hero |
| `display` | 28 / 34 | 700 | Sora | Section hero numbers |
| `h1` | 22 / 28 | 600 | Sora | Screen titles |
| `h2` | 18 / 24 | 600 | Sora | Card titles |
| `amount` | 17 / 22 | 600 | Sora | Transaction row amounts |
| `body` | 15 / 22 | 400 | Inter | Default text |
| `label` | 13 / 18 | 500 | Inter | Field labels, chips |
| `caption` | 12 / 16 | 400 | Inter | Timestamps, metadata |

### 3.2 Numeral rules
- Use **tabular figures** for all amounts so digits align vertically in lists.
- Always show the currency symbol before the amount: `Rs1,250.00`.
- Always prefix a sign for expense/income: `−Rs200.00`, `+Rs5,000.00`.
- Abbreviate only in compact summary cards (`Rs17.4K`), never in transaction
  rows or the approval queue where exactness matters.

---

## 4. Layout, Spacing, Shape

```ts
export const space  = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };
export const radius = { sm: 8, md: 12, lg: 16, xl: 24, pill: 999 };
```

- **Base unit: 4px.** All spacing is a multiple.
- **Screen padding: 16px** horizontal.
- **Card radius: 16px**; chips and pills: fully rounded.
- **Minimum touch target: 44×44pt** (iOS HIG). Critical for the voice button and
  queue approve/reject actions.
- **Generous whitespace** — research links it to reduced cognitive load in
  financial interfaces. Do not pack the dashboard.

### 4.1 Elevation
Soft, warm, low-contrast shadows. No hard drop shadows, no neumorphism.
```
shadowColor: '#7A4A34', shadowOpacity: 0.06,
shadowRadius: 12, shadowOffset: { width: 0, height: 4 }
```
In dark mode, express elevation with lighter *surface* colours instead of
shadows (shadows are invisible on dark backgrounds).

---

## 5. Core Components

### 5.1 Transaction Row
The most repeated component in the app.
```
[icon]  Name                        −Rs200.00
        Category · Account · 14:20
```
- Icon: category icon in a rounded square tinted with the category colour
- Amount right-aligned, tabular, coloured **and** signed
- Transfer rows show `Account A → Account B` instead of a category
- Lending rows show the person's name and direction ("Lent to Kamal")
- Pending rows get a subtle amber left edge + "Pending" label

### 5.2 Balance Hero Card
Primary-brown filled card at the top of Home. Total balance in `displayXL`, with
income/expense summary beneath. Includes an eye toggle to hide amounts (useful
in public). Approved transactions only — this must never include pending items.

### 5.3 Type Selector (segmented control)
Four segments: **Expense · Income · Transfer · Lending**. Pill-shaped track,
selected segment filled with primary. Switching type changes which form fields
render — the selector is the form's primary control, so place it at the top.

### 5.4 Chip Selector
Used for accounts, categories, and people. Wrapping rows of pill chips with
icon + label, plus a trailing `+ Add` chip. Selected state uses `primarySoft`
background with a primary border. Faster than dropdowns on mobile and shows all
options at a glance.

### 5.5 Voice Capture Button (signature interaction)
The app's defining element. Large circular button, primary fill, centred.
- Idle: mic icon, gentle resting state
- Recording: soft pulsing ring, live waveform or amplitude bar, elapsed timer
- Processing: subtle indeterminate spinner
- Done: brief confirmation toast ("Logged — 1 to review") and return to idle

Must be reachable one-handed. No confirmation dialog — speed is the entire point.
Failure never loses data (see technical plan §5.7).

### 5.6 Queue Item Card
Transaction row plus:
- The **original transcript** in quoted muted text (lets the user verify the parse)
- Confidence flag pills in warning amber ("Unknown name", "Check amount")
- Inline actions: Approve · Edit · Reject
- Multi-select support for bulk approve

### 5.7 Person Balance Row
```
[avatar initials]  Kamal          Owes you Rs500
```
Direction stated in **words**, not just colour or sign — the clearest possible
expression of who owes whom.

### 5.8 Empty States
Warm, brief, actionable. "No transactions yet — tap the mic to add your first."
Never a bare "No data."

### 5.11 Donut chart (added 2026-08-10)
Reports shows a **donut** below the category bar list (additive, not a
replacement). Hand-built on **react-native-svg** — no chart library. Segments
use each category's palette colour (same as its bar); percentage labels sit on
segments ≥8%; the center hole shows the period total. Tapping a segment selects
it (dims the others) and highlights the matching bar row; tapping a bar row does
the same in reverse. Reflects the current month + the spending-by-category data
(golden-rule filtered in SQL). A charting lib was deliberately avoided
(RN-version compat risk); SVG is the Expo-safe path.

### 5.10 Settings screen (accordion — updated 2026-08-10)
**Profile** stays pinned at the top, always visible: centered circular avatar —
tap to pick a gallery photo, camera-overlay badge — with a name field beneath.

Below it, an **accordion** of three collapsed section rows, **one open at a
time** (opening one closes the others) to keep the screen short. Each row is a
bordered surface card: leading icon + title + a chevron (down collapsed, up
expanded); tapping toggles it with an `easeInEaseOut` LayoutAnimation. The rows:
- **Currency** → the chip picker (display-only; "never converts existing amounts").
- **Data & Backup** → Create / Restore / Clear-all action rows (Clear is
  danger-coloured, type-to-confirm "DELETE").
- **Voice (Gemini)** → API key + model.

Destructive actions always state what will happen before proceeding. Reuse the
rounded tinted-icon-square and ChipSelector patterns; no new visual language.

### 5.9 Date & Time Field (added 2026-08-09)
Use the **native iOS picker** (`@react-native-community/datetimepicker`,
mode `datetime`, display `compact`) — the system pill that expands into the
calendar/time wheels. `themeVariant` follows the app theme; `accentColor` is
the primary brown. A native control is deliberately preferred over a custom
one here: system-familiar, accessible, and matches the calm/unobtrusive
positioning. Do not build a custom calendar.

---

## 6. Navigation (restructured 2026-08-10)

Bottom tab bar, four tabs:

| Tab | Icon | Contains |
|---|---|---|
| **Home** | house | Balance hero, quick-action row, **embedded Approval Queue** |
| **Accounts** | card | Account cards + a searchable, account-filterable transaction list |
| **Reports** | chart | Charts, category breakdown |
| **Settings** | gear | Gemini key/model and app settings |

**Home layout, top to bottom:** header (just the "Kaasu" title) → Balance Hero
→ **quick-action row** → **Approval Queue** (grouped by day, Approve/Edit/Reject
+ Approve all; heading badged "Queue (N)"). The Queue is no longer a tab — it
lives here. There is no Recent-transactions list on Home; that list lives on
Accounts.

**Quick-action row:** a single horizontal row of four icon+label tiles —
Recurring · Split · People · Categories — reusing the rounded tinted-icon-square
language. These replace the old Home header icons. (Fall back to a 2×2 grid only
if labels crowd on-device.)

**Accounts:** account cards on top; tapping a card **selects/filters** the
transaction list below to that account (including transfers that touch it — real
money moves through it); a trailing pencil icon edits the account. A search box
filters the list by name/description.

**Floating buttons (design §5.5 / §4.1):** on Home, a stacked pair bottom-right —
manual **+ Add** (secondary, 52pt) above the **voice mic** (signature, 60pt),
both one-handed reachable above the tab bar. On Accounts, a single **+ account**
FAB bottom-right, same treatment. Never bury the voice button — the app's core
promise is frictionless capture, one tap away.

Remaining secondary screens (Bill Splitter, Recurring, People, Categories) are
reached from the Home quick-action row — kept out of the tab bar to avoid
overcrowding.

---

## 7. Motion (animation pass 2026-08-10)

Calm and quick. Motion confirms actions; it never performs. Implemented with
**react-native-reanimated** (already installed) + expo-router transitions — no
new library, no rebuild.

| Interaction | Duration | Notes |
|---|---|---|
| Screen push (forms, detail) | native iOS slide | expo-router Stack `slide_from_right` + back gesture |
| Voice capture screen | slide up | `presentation: 'modal'`, `slide_from_bottom` — reads as an overlay |
| Tab switch | ~shift | expo-router Tabs `animation: 'shift'` — smooth, not an instant cut |
| Button / FAB press | ~90–140ms | scale to 0.97 (FAB 0.90), `PressableScale` (reanimated) |
| Chip selection | 150ms | Background fade |
| Queue approve/reject | ~200ms | Row fades out (`FadeOut`) + remaining rows slide up (`LinearTransition`) |
| List item appear | ~200ms | `FadeIn` on genuinely new rows |
| Voice pulse | 1200ms loop | Gentle, non-urgent |

Respect **reduce-motion** system settings. No bounces, no parallax, no
celebratory confetti — this is a money app, not a game. The principles are
unchanged; this pass just applies them consistently.

---

## 8. Anti-Patterns (do not do these)

Finance-specific:
- ❌ AI purple/pink gradients — reads untrustworthy for money
- ❌ Neon or highly saturated colours
- ❌ Red as a dominant colour — creates anxiety about one's own finances
- ❌ Alarming language about overspending
- ❌ Colour-only encoding of expense vs. income

General:
- ❌ Emojis used as UI icons (use a real icon set)
- ❌ Pure black `#000000` dark mode with warm accents
- ❌ Cramped layouts with insufficient whitespace
- ❌ Amounts in floating point or without a currency symbol
- ❌ Pending items included in headline totals
- ❌ More than 4 bottom tabs

---

## 9. Pre-Delivery Checklist

- [ ] Text contrast ≥ 4.5:1 in **both** light and dark themes
- [ ] No meaning conveyed by colour alone — sign/icon/label always present
- [ ] All touch targets ≥ 44×44pt
- [ ] Tabular figures on every amount; alignment verified in long lists
- [ ] Dark mode verified on a real device, not just the simulator
- [ ] Pending vs. approved visually unmistakable
- [ ] Voice button reachable one-handed on the iPhone 12 Pro
- [ ] Reduce-motion setting respected
- [ ] Empty states written for every list screen
- [ ] Long names and large amounts truncate gracefully (test Rs1,000,000.00)
- [ ] Category colours remain distinguishable in the reports pie chart

---

## 10. Implementation Notes (React Native)

- Tokens live in `src/theme/tokens.ts`; `ThemeContext` supplies light/dark and
  respects `useColorScheme()` with a manual override stored in settings.
- Never hardcode a hex value in a component — always read from the theme.
- Load Sora and Inter via `expo-font`; render a splash until fonts are ready to
  avoid a flash of fallback type.
- Use `@expo/vector-icons` (Feather or Ionicons) for a consistent icon set.
- Build one `<Amount value={} type={} />` component that centrally handles sign,
  colour, currency symbol, and tabular figures — so those rules can never drift
  between screens.
