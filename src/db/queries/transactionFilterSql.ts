/**
 * WHERE-clause builder for the Accounts transaction ledger — pure, no database
 * handle, so every combination can be executed against a real SQLite engine in
 * `transactionFilterSql.test.ts`.
 *
 * NOTE this is deliberately NOT the reports filter. Reports enforce the golden
 * rule (approved expense/income only); this list is the ledger and shows all
 * four transaction types and both live statuses. Sharing one builder between
 * them would make it far too easy to leak transfers and lending into a report.
 */
import type { TransactionStatus, TransactionType } from '@/domain/types';

export type Param = string | number;

export interface Statement {
  sql: string;
  params: Param[];
}

export interface TransactionFilter {
  /** Includes transfers where this account is EITHER end — real money moved
   *  through it either way. */
  accountId?: string | null;
  categoryIds?: string[] | null;
  personId?: string | null;
  /** Empty/absent = every type. */
  types?: TransactionType[] | null;
  /** Empty/absent = everything except rejected. */
  statuses?: TransactionStatus[] | null;
  /** Inclusive local 'yyyy-MM-dd'. */
  startDay?: string | null;
  endDay?: string | null;
  /** Case-insensitive substring match on name or description. */
  search?: string | null;
}

const placeholders = (n: number) => new Array(n).fill('?').join(',');

/** True when anything beyond a bare listing is narrowing the results. */
export function hasActiveTransactionFilter(filter: TransactionFilter): boolean {
  return Boolean(
    filter.accountId ||
      filter.personId ||
      (filter.categoryIds && filter.categoryIds.length > 0) ||
      (filter.types && filter.types.length > 0) ||
      (filter.statuses && filter.statuses.length > 0) ||
      filter.startDay ||
      filter.endDay ||
      filter.search?.trim(),
  );
}

export function transactionFilterWhere(filter: TransactionFilter): Statement {
  const clauses: string[] = [];
  const params: Param[] = [];

  // Rejected rows are dismissed history — they only appear if asked for by name.
  if (filter.statuses && filter.statuses.length > 0) {
    clauses.push(`t.status IN (${placeholders(filter.statuses.length)})`);
    params.push(...filter.statuses);
  } else {
    clauses.push("t.status != 'rejected'");
  }

  if (filter.types && filter.types.length > 0) {
    clauses.push(`t.type IN (${placeholders(filter.types.length)})`);
    params.push(...filter.types);
  }

  if (filter.accountId) {
    clauses.push('(t.account_id = ? OR t.to_account_id = ?)');
    params.push(filter.accountId, filter.accountId);
  }

  if (filter.categoryIds && filter.categoryIds.length > 0) {
    clauses.push(`t.category_id IN (${placeholders(filter.categoryIds.length)})`);
    params.push(...filter.categoryIds);
  }

  if (filter.personId) {
    clauses.push('t.person_id = ?');
    params.push(filter.personId);
  }

  // Timestamps are stored UTC; 'localtime' keeps a late-evening entry on the
  // day the user actually made it, matching the list's day grouping.
  if (filter.startDay) {
    clauses.push("date(t.occurred_at, 'localtime') >= ?");
    params.push(filter.startDay);
  }
  if (filter.endDay) {
    clauses.push("date(t.occurred_at, 'localtime') <= ?");
    params.push(filter.endDay);
  }

  const search = filter.search?.trim();
  if (search) {
    clauses.push('(t.name LIKE ? OR t.description LIKE ?)');
    const like = `%${search}%`;
    params.push(like, like);
  }

  return { sql: clauses.join('\n       AND '), params };
}
