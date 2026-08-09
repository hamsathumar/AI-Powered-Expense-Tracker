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

export const lightColors = {
  // Surfaces — the dominant 60%+
  bg:           '#FBF6F1', // warm off-white, app background
  surface:      '#FFFFFF', // cards
  surfaceAlt:   '#F4EBE3', // subtle raised/secondary panels
  border:       '#E8DDD3',

  // Brand
  primary:      '#7A4A34', // deep warm brown — primary actions, active nav
  primaryPress: '#653B29',
  primarySoft:  '#F0E1D7', // tinted backgrounds, selected chips
  onPrimary:    '#FFFFFF',

  // Text
  text:         '#2E2723', // near-black warm
  textMuted:    '#7A6E66',
  textSubtle:   '#A2958B',

  // Semantic — ALWAYS paired with sign/icon/label, never colour alone
  expense:      '#B4462F', // warm red-clay, not alarm red
  income:       '#3F7A52', // muted forest green, not neon
  transfer:     '#4A6F94', // calm blue — movement, neutral
  lending:      '#8A6A3B', // amber-brown — owed/outstanding
  warning:      '#B8853A', // pending / needs review flags

  // Feedback
  success:      '#3F7A52',
  danger:       '#B4462F',
} as const;

export const darkColors: ThemeColors = {
  bg:           '#1A1614',
  surface:      '#241E1A',
  surfaceAlt:   '#2E2621',
  border:       '#3A302A',

  primary:      '#C89070', // lifted brown — legible on dark
  primaryPress: '#D9A184',
  primarySoft:  '#33281F',
  onPrimary:    '#1A1614',

  text:         '#F2EAE3',
  textMuted:    '#B0A199',
  textSubtle:   '#7E7069',

  expense:      '#E08A72',
  income:       '#7FBF95',
  transfer:     '#8FB2D4',
  lending:      '#D4AE72',
  warning:      '#E0B36B',

  success:      '#7FBF95',
  danger:       '#E08A72',
};

export type ThemeColors = { [K in keyof typeof lightColors]: string };

/**
 * Category colours (design-system.md §2.6): a fixed ~12-option palette for
 * user-assignable category colours, deliberately distinct from the semantic
 * colours above so custom categories never clash with them, and muted enough
 * to stay distinguishable in charts.
 */
export const categoryPalette = [
  '#D08C60', // apricot
  '#A87C4F', // caramel
  '#8C9A5B', // olive
  '#5B8A72', // sage
  '#4E8A8B', // teal
  '#6D8FB0', // dusty blue
  '#7D6FA0', // muted violet
  '#B07A8C', // rose
  '#C2856B', // clay
  '#9C8A3C', // mustard
  '#6B7F5C', // moss
  '#8A7B6B', // taupe
] as const;

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
  /** Field labels, chips */
  label:     { fontFamily: fontFamily.medium, fontSize: 13, lineHeight: 18 },
  /** Timestamps, metadata */
  caption:   { fontFamily: fontFamily.body, fontSize: 12, lineHeight: 16 },
} as const satisfies Record<string, TextStyle>;
