/**
 * The HTML for a person's PDF statement (rendered to PDF by expo-print in
 * services/personStatementPdf.ts). Pure — no React Native — so the content,
 * escaping and money text are unit-tested.
 *
 * Same rules as the screen: one shared lending mapping (label, sign, tone),
 * worded balances, approved-only maths with pending rows listed but marked,
 * and meaning never carried by colour alone (every amount also has a sign and
 * every row a written type). Colours come in from the theme tokens rather than
 * being written here; the PDF always uses the LIGHT palette — it is paper.
 */
import { format } from 'date-fns';

import { describeNetWith, lendingPresentation } from '@/domain/lendingPresentation';
import { formatAmount } from '@/domain/money';
import { directionTotalsMinor, type PersonStatement } from '@/domain/personStatement';
import { describeRange, type DayRange } from '@/domain/statementPeriod';
import type { Transaction } from '@/domain/types';

export interface StatementItem {
  tx: Transaction;
  accountName: string | null;
  /** Logged through a private account — said in words on the row. */
  accountPrivate?: boolean;
}

export interface StatementPalette {
  text: string;
  textMuted: string;
  border: string;
  surfaceAlt: string;
  primary: string;
  lent: string;
  borrowed: string;
  warning: string;
}

export interface StatementHtmlInput {
  personName: string;
  personId: string;
  range: DayRange;
  statement: PersonStatement<StatementItem>;
  currencySymbol: string;
  generatedAt: Date;
  palette: StatementPalette;
}

/** Glyphs mirror the app's Feather icons (lendingPresentation.icon). */
const ICON_GLYPH: Record<string, string> = {
  'arrow-up-right': '↗',
  'corner-down-left': '↵',
  'arrow-down-left': '↙',
  'corner-up-right': '↪',
};

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function rowHtml(item: StatementItem, input: StatementHtmlInput): string {
  const { tx } = item;
  const { palette, currencySymbol } = input;
  const money = (m: number) => escapeHtml(formatAmount(m, currencySymbol));
  const time = format(new Date(tx.occurredAt), 'HH:mm');
  const pending = tx.status === 'pending';
  const account = `${item.accountName ? escapeHtml(item.accountName) : '—'}${item.accountPrivate ? ' (Private)' : ''}`;

  let kind: string;
  let glyph = '•';
  let amount: string;
  let color = palette.textMuted;
  let note = '';

  if (tx.type === 'lending') {
    const p = lendingPresentation(tx.direction);
    kind = p.kind;
    glyph = ICON_GLYPH[p.icon] ?? '•';
    color = palette[p.tone];
    amount = `${p.sign}${money(tx.amountMinor)}`;
  } else {
    // Tagged expense/income (e.g. the expense half of a bill split): listed so
    // the history is complete, but it is spending — not part of what's owed.
    kind = tx.type === 'expense' ? 'Expense' : tx.type === 'income' ? 'Income' : 'Transfer';
    amount = money(tx.amountMinor);
    note = 'Not part of the balance';
  }
  if (pending) note = 'Pending — not counted yet';

  return `<tr class="row${pending ? ' pending' : ''}">
    <td class="time">${time}</td>
    <td class="what">
      <div class="name">${escapeHtml(tx.name)}</div>
      <div class="meta"><span class="glyph" style="color:${color}">${glyph}</span> ${escapeHtml(kind)} · ${account}${
        note ? ` · <span class="note" style="color:${pending ? palette.warning : palette.textMuted}">${note}</span>` : ''
      }</div>
    </td>
    <td class="amount" style="color:${pending ? palette.textMuted : color}">${amount}</td>
  </tr>`;
}

export function personStatementHtml(input: StatementHtmlInput): string {
  const { statement, palette, currencySymbol, personName, personId } = input;
  const money = (m: number) => formatAmount(m, currencySymbol);
  const worded = (net: number) => escapeHtml(describeNetWith(net, money));
  const toneColor = (net: number) =>
    net > 0 ? palette.lent : net < 0 ? palette.borrowed : palette.textMuted;
  const totals = directionTotalsMinor(statement.days, personId);
  const name = escapeHtml(personName);

  const summary = (
    [
      ['lend', 'Lent to them', '+'],
      ['lend_repayment_received', 'They repaid you', '−'],
      ['borrow', 'Borrowed from them', '−'],
      ['borrow_repayment_made', 'You repaid them', '+'],
    ] as const
  )
    .map(([dir, label, sign]) => {
      const p = lendingPresentation(dir);
      return `<tr><td><span class="glyph" style="color:${palette[p.tone]}">${ICON_GLYPH[p.icon]}</span> ${label}</td>
        <td class="amount" style="color:${totals[dir] ? palette[p.tone] : palette.textMuted}">${
          totals[dir] ? sign : ''
        }${escapeHtml(money(totals[dir]))}</td></tr>`;
    })
    .join('');

  const days = statement.days.length
    ? statement.days
        .map(
          (day) => `<section class="day">
        <div class="dayHead">
          <span class="dayTitle">${format(day.date, 'EEEE, d MMMM yyyy')}</span>
        </div>
        <table class="rows">${day.entries.map((e) => rowHtml(e, input)).join('')}</table>
        <div class="dayFoot">End of day: <strong style="color:${toneColor(day.closingBalanceMinor)}">${worded(
          day.closingBalanceMinor,
        )}</strong></div>
      </section>`,
        )
        .join('')
    : `<p class="empty">No transactions with ${name} in this period.</p>`;

  return `<!doctype html>
<html><head><meta charset="utf-8" />
<style>
  * { box-sizing: border-box; }
  body { margin: 0; font-family: -apple-system, 'Helvetica Neue', Helvetica, Arial, sans-serif;
         color: ${palette.text}; font-size: 11px; line-height: 1.45; }
  .brand { color: ${palette.primary}; font-weight: 700; letter-spacing: 0.08em; font-size: 12px; }
  h1 { font-size: 20px; margin: 4px 0 2px; }
  .sub { color: ${palette.textMuted}; }
  .box { border: 1px solid ${palette.border}; border-radius: 10px; padding: 12px 14px; margin: 16px 0; }
  .balances { display: flex; justify-content: space-between; gap: 16px; }
  .label { color: ${palette.textMuted}; font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; }
  .big { font-size: 15px; font-weight: 700; margin-top: 2px; }
  table { width: 100%; border-collapse: collapse; }
  .summary td { padding: 3px 0; }
  .amount { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; font-weight: 600; }
  .glyph { font-weight: 700; }
  .day { margin-top: 14px; page-break-inside: avoid; }
  .dayHead { background: ${palette.surfaceAlt}; border-radius: 6px; padding: 5px 8px; }
  .dayTitle { font-weight: 700; }
  .rows td { padding: 6px 8px; border-bottom: 1px solid ${palette.border}; vertical-align: top; }
  .row { page-break-inside: avoid; }
  .pending .name { color: ${palette.textMuted}; }
  .time { width: 44px; color: ${palette.textMuted}; font-variant-numeric: tabular-nums; }
  .name { font-weight: 600; }
  .meta { color: ${palette.textMuted}; font-size: 10px; }
  .dayFoot { text-align: right; padding: 6px 8px 0; color: ${palette.textMuted}; }
  .empty { color: ${palette.textMuted}; text-align: center; margin: 32px 0; }
  .foot { margin-top: 24px; color: ${palette.textMuted}; font-size: 10px; border-top: 1px solid ${palette.border}; padding-top: 8px; }
</style></head>
<body>
  <div class="brand">KAASU</div>
  <h1>Statement with ${name}</h1>
  <div class="sub">${escapeHtml(describeRange(input.range))}</div>

  <div class="box balances">
    <div><div class="label">Opening balance</div>
      <div class="big" style="color:${toneColor(statement.openingBalanceMinor)}">${worded(statement.openingBalanceMinor)}</div></div>
    <div style="text-align:right"><div class="label">Closing balance</div>
      <div class="big" style="color:${toneColor(statement.closingBalanceMinor)}">${worded(statement.closingBalanceMinor)}</div></div>
  </div>

  <div class="box"><div class="label">In this period</div>
    <table class="summary">${summary}</table></div>

  ${days}

  <div class="foot">
    + means ${name} owes you more (or you owe less); − means the opposite. Balances count approved transactions only; pending ones are listed but not counted.
    Generated by Kaasu on ${escapeHtml(format(input.generatedAt, "d MMM yyyy 'at' HH:mm"))}.
  </div>
</body></html>`;
}
