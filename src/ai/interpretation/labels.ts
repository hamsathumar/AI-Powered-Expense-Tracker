/**
 * Text the user DICTATED — a label ("label it as …") or a note — read the way
 * they meant it (V1.4, TC-044).
 *
 * Speech-to-text writes spoken punctuation as words: "rent hyphen nizam
 * molevi" arrives with the word "hyphen" in it. The model sometimes drops the
 * word (but adds no symbol), and the app's own label override (V1.3, TC-036)
 * then put the raw word back — "Rent Hyphen Nizam Molevi".
 *
 * Two pure helpers:
 *  - `applySpokenPunctuation` turns spoken punctuation words into symbols.
 *    `strict` mode (used on model-written names) converts only words that are
 *    never ordinary words in a name; the full set (used on text the user
 *    explicitly dictated as a label or note) also converts "dash", "slash"
 *    and "and sign".
 *  - `preferModelSpelling` keeps the model's spelling of the SAME words the
 *    user dictated ("molevi" → "Mowlavi"), while keeping the user's label —
 *    its words, order and punctuation. A model name that is different words
 *    never replaces the label.
 *
 * Presentation only: names and notes never affect money, type or entities.
 */
import { editDistance } from './resolve';

type Rule = [RegExp, string];

/** Words that are never an ordinary part of a transaction name. */
const STRICT_RULES: Rule[] = [
  [/\s*\bhyphen\b\s*/gi, ' - '],
  [/\s*\bsemi[\s-]?colon\b\s*/gi, '; '],
  [/\s*\bcolon\b\s*/gi, ': '],
  [/\b(?:open|opening|left)\s+(?:bracket|parenthesis|paren|brace)s?\b\s*/gi, ' ('],
  [/\s*\b(?:close|closed|closing|right)\s+(?:bracket|parenthesis|paren|brace)s?\b/gi, ') '],
  [/\s*\bforward\s+slash\b\s*/gi, '/'],
  [/\s*\bampersand\b\s*/gi, ' & '],
];

/** Also real words ("Dash Cam"), so converted only in text the user dictated. */
const DICTATED_RULES: Rule[] = [
  [/\s*\bdash\b\s*/gi, ' - '],
  [/\s*\bslash\b\s*/gi, '/'],
  [/\s*\band\s+sign\b\s*/gi, ' & '],
];

export function applySpokenPunctuation(text: string, mode: 'dictated' | 'strict' = 'dictated'): string {
  if (!text) return text;
  let out = text;
  const rules = mode === 'strict' ? STRICT_RULES : [...STRICT_RULES, ...DICTATED_RULES];
  for (const [pattern, symbol] of rules) out = out.replace(pattern, symbol);
  if (out === text) return text;
  return out
    .replace(/\(\s+/g, '(')
    .replace(/\s+\)/g, ')')
    .replace(/\s+([:;])/g, '$1')
    .replace(/\s+/g, ' ')
    // A separator left dangling at either end ("rent hyphen") means nothing.
    .replace(/^[\s\-:;/&]+|[\s\-:;/&]+$/g, '')
    .trim();
}

const WORD = /[\p{L}\p{N}'’]+/gu;

/** Same word, spelled differently: same first letter, and close enough. */
function sameWord(a: string, b: string): boolean {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  if (x === y) return true;
  if (x[0] !== y[0]) return false;
  const shorter = Math.min(x.length, y.length);
  if (shorter < 4) return false;
  const max = Math.max(1, Math.floor(shorter * 0.4));
  return editDistance(x, y, max) <= max;
}

/**
 * The user's label with the model's spelling of its words, when — and only
 * when — the model's name is the same words in the same order. Anything else
 * returns the label untouched.
 */
export function preferModelSpelling(label: string, modelName: string | null | undefined): string {
  if (!label || !modelName) return label;
  const labelWords = label.match(WORD) ?? [];
  const modelWords = modelName.match(WORD) ?? [];
  if (labelWords.length === 0 || labelWords.length !== modelWords.length) return label;
  if (!labelWords.every((w, i) => sameWord(w, modelWords[i]!))) return label;
  let i = 0;
  return label.replace(WORD, () => modelWords[i++]!);
}
