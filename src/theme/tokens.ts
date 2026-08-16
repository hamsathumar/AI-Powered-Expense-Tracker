/**
 * Design tokens — the single source of truth for every colour, spacing,
 * radius, and type style in Kaasu.
 *
 * Values come verbatim from `Planning session/design-system.md`.
 * NEVER hardcode a hex value, spacing number, or font size in a component —
 * always read from here via the theme context (`useTheme`).
 */
import { Platform, type TextStyle } from 'react-native';

// ---------------------------------------------------------------------------
// Colours (design-system.md §2)
// ---------------------------------------------------------------------------

// Palette (design-system.md §2). Vibrant pass 2026-08-10: the warm cream base
// + brown brand anchor stay as the calm dominant surface; vibrancy comes from
// richer semantic colours, category palette, and account-type accents. Colour
// still NEVER signals meaning alone — always paired with sign/icon/label.
export const lightColors = {
  // Surfaces — the dominant 60%+ (unchanged: calm base + text contrast)
  bg:           '#FBF6F1', // warm off-white, app background
  surface:      '#FFFFFF', // cards
  surfaceAlt:   '#F4EBE3', // subtle raised/secondary panels
  border:       '#E8DDD3',

  // Brand — richer warm brown
  primary:      '#8A4A2A', // warm brown — primary actions, active nav
  primaryPress: '#6E3A22',
  primarySoft:  '#F8E2D2', // warm peach tint — selected chips, tiles
  onPrimary:    '#FFFFFF',

  // Text
  text:         '#2E2723', // near-black warm
  textMuted:    '#7A6E66',
  textSubtle:   '#A2958B',

  // Semantic — vivid but ≥4.5:1 as numerals; ALWAYS paired with sign/icon/label
  expense:      '#D1462F', // vivid clay-red (never a dominant fill)
  income:       '#1E9557', // vivid emerald
  transfer:     '#2C74BE', // clear blue
  lending:      '#B07514', // rich gold
  warning:      '#C98A1E', // amber — pending / needs review

  // Account-type accents (paired with the type label, not colour-alone)
  accountCash:  '#23A866',
  accountBank:  '#2C74BE',
  accountCard:  '#7B5AD6',

  // Feedback
  success:      '#1E9557',
  danger:       '#D1462F',

  // Accent legible on the brown Home canopy (design-system-v2.md §5.2 spend
  // bar). Brighter than `lending` so gold reads on the primary surface.
  canopyAccent: '#F0B84E',

  // Filled positive-action button (queue Approve pill, voice "Approve now").
  // Deep green + white content, deliberately identical in both themes so white
  // stays legible on the fill (design-system-v2.md §5.6). `onFilled` is the
  // content colour for any filled semantic control.
  positiveFill: '#1E9557',
  onFilled:     '#FFFFFF',
} as const;

export const darkColors: ThemeColors = {
  bg:           '#1A1614',
  surface:      '#241E1A',
  surfaceAlt:   '#2E2621',
  border:       '#3A302A',

  primary:      '#E09763', // lifted warm brown — legible on dark
  primaryPress: '#EDA97A',
  primarySoft:  '#3E2C1E',
  onPrimary:    '#1A1614',

  text:         '#F2EAE3',
  textMuted:    '#B0A199',
  textSubtle:   '#7E7069',

  expense:      '#FF8266',
  income:       '#55D08C',
  transfer:     '#6FB2F2',
  lending:      '#F0B84E',
  warning:      '#F2C24F',

  accountCash:  '#55D08C',
  accountBank:  '#6FB2F2',
  accountCard:  '#A98CF0',

  success:      '#55D08C',
  danger:       '#FF8266',

  canopyAccent: '#F0B84E',
  positiveFill: '#1E9557',
  onFilled:     '#FFFFFF',
};

export type ThemeColors = { [K in keyof typeof lightColors]: string };

/**
 * Category colours (design-system.md §2.6): a fixed 12-option palette for
 * user-assignable category colours — vibrant but harmonious, distinct from
 * the semantic colours, and distinguishable as pie/donut segments.
 */
export const categoryPalette = [
  '#D1462F', // coral-red
  '#EE7D30', // orange
  '#F2A925', // amber
  '#8FB22E', // lime-olive
  '#23A866', // emerald
  '#16A89C', // teal
  '#2E93D9', // sky blue
  '#3E6FD6', // indigo
  '#7B5AD6', // violet
  '#C74FB0', // magenta
  '#E0698F', // rose
  '#9C7A5A', // warm taupe
] as const;

/**
 * Recurring-group segment colours (recurring redesign — Feature 4). A fixed,
 * theme-independent mapping drawn from the category palette so the summary bar
 * reads consistently in both themes. Each segment is ALWAYS paired with its
 * legend label — never colour-alone. `other` is a neutral taupe.
 */
export const recurringGroupColors = {
  subscription: '#7B5AD6', // violet
  bill:         '#2E93D9', // sky blue
  rent:         '#9C7A5A', // warm taupe
  loan:         '#EE7D30', // orange
  other:        '#A2958B', // neutral
} as const;

// ---------------------------------------------------------------------------
// Layout (design-system.md §4) — base unit 4px
// ---------------------------------------------------------------------------

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { sm: 8, md: 12, lg: 16, xl: 24, pill: 999 } as const;

/** Horizontal screen padding (design-system.md §4). */
export const screenPaddingH = space.lg;

/** Minimum touch target size in pt (iOS HIG). */
export const minTouchTarget = 44;

/** Soft warm elevation for light mode (design-system.md §4.1).
 *  In dark mode, express elevation with lighter surface colours instead. */
export const shadow = {
  shadowColor: '#7A4A34',
  shadowOpacity: 0.06,
  shadowRadius: 12,
  shadowOffset: { width: 0, height: 4 },
} as const;

/** Upward-cast elevation for the pinned keypad panel (design-system-v2.md §4.1)
 *  — it needs to read as floating above the form. */
export const keypadShadow = {
  shadowColor: '#7A4A34',
  shadowOpacity: 0.08,
  shadowRadius: 24,
  shadowOffset: { width: 0, height: -8 },
} as const;

// ---------------------------------------------------------------------------
// Measured layout constants (design-system-v2.md §4.2)
// Read every screen measurement from here; never hardcode a size in a
// component. `space`/`radius` above remain the primitive scale.
// ---------------------------------------------------------------------------

export const layout = {
  screenPaddingH: 16,
  canopyPaddingH: 24, // the brown Home header is inset 24, not 16
  sheetRadius: 24, // content sheet over the canopy
  sheetOverlap: 22, // sheet pulls up over the canopy by this much
  cardRadius: 16,
  heroCardRadius: 20, // detail-screen amount card, donut card
  rowRadius: 12, // transaction rows, list rows
  iconTile: { size: 40, radius: 12 }, // row icon squares
  iconTileSm: { size: 36, radius: 8 }, // dense list rows
  quickActionTile: { size: 46, radius: 14 },
  chipPaddingV: 9,
  chipPaddingH: 16,
  pendingEdge: 4, // amber left edge on queue cards
  accountEdge: 4, // type-coloured left edge on account cards
  primaryButtonH: 54,
  voiceBarH: 56,
  fabSm: 56,
  keypadKeyH: 50,
  tabBarPaddingBottom: 22, // above the home indicator
} as const;

/** Bottom-anchored content clearance (design-system-v2.md §4.3): any scroll
 *  view under the voice bar / a FAB needs at least this much bottom spacer so
 *  nothing scrolls beneath a floating control. */
export const bottomClearance = { home: 200, accounts: 190 } as const;

// ---------------------------------------------------------------------------
// Typography (design-system.md §3)
// Weight is baked into the loaded font-family name, so styles set fontFamily
// rather than fontWeight.
// ---------------------------------------------------------------------------

export const fontFamily = {
  heading: 'Sora_600SemiBold',
  headingBold: 'Sora_700Bold',
  body: 'Inter_400Regular',
  medium: 'Inter_500Medium',
} as const;

/** Tabular figures so digits align vertically in lists — required on every
 *  amount (design-system.md §3.2). */
export const tabularNums: Pick<TextStyle, 'fontVariant'> = Platform.select({
  default: { fontVariant: ['tabular-nums'] },
});

export const type = {
  /** Total balance hero */
  displayXL: { fontFamily: fontFamily.headingBold, fontSize: 34, lineHeight: 40 },
  /** Section hero numbers */
  display:   { fontFamily: fontFamily.headingBold, fontSize: 28, lineHeight: 34 },
  /** Screen titles */
  h1:        { fontFamily: fontFamily.heading, fontSize: 22, lineHeight: 28 },
  /** Card titles */
  h2:        { fontFamily: fontFamily.heading, fontSize: 18, lineHeight: 24 },
  /** Transaction row amounts */
  amount:    { fontFamily: fontFamily.heading, fontSize: 17, lineHeight: 22, ...tabularNums },
  /** Default text */
  body:      { fontFamily: fontFamily.body, fontSize: 15, lineHeight: 22 },
  /** Single-line text-input text. Identical to `body` but WITHOUT lineHeight:
   *  on iOS a lineHeight set on a TextInput renders its glyphs offset toward
   *  the top of the line box, so a single-line field looks vertically
   *  un-centred against its icons/border. Use this on every single-line
   *  TextInput (multiline fields keep `body`, where lineHeight aids reading). */
  input:     { fontFamily: fontFamily.body, fontSize: 15, includeFontPadding: false },
  /** Field labels, chips */
  label:     { fontFamily: fontFamily.medium, fontSize: 13, lineHeight: 18 },
  /** Timestamps, metadata */
  caption:   { fontFamily: fontFamily.body, fontSize: 12, lineHeight: 16 },

  // --- Added in v2 (design-system-v2.md §3) ---
  /** Amount display on the transaction form */
  amountInput:      { fontFamily: fontFamily.headingBold, fontSize: 40, lineHeight: 48, ...tabularNums },
  /** Cents on that display — colour applied at usage: always `textMuted`,
   *  never a tint of the semantic hue (design-system-v2.md §2.7). */
  amountInputCents: { fontFamily: fontFamily.headingBold, fontSize: 26, ...tabularNums },
  /** Keypad digits */
  keypadKey:        { fontFamily: fontFamily.heading, fontSize: 20 },
  /** Day headers and eyebrow labels — uppercase, tracked; colour `textSubtle`
   *  applied at usage. */
  sectionLabel:     { fontFamily: fontFamily.medium, fontSize: 13, lineHeight: 18, letterSpacing: 0.8, textTransform: 'uppercase' },
} as const satisfies Record<string, TextStyle>;
