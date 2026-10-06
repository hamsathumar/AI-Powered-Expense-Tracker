/**
 * People SQL, kept free of a db handle so `peopleSql.test.ts` can run every
 * statement against a real engine (see reportSql.ts for why that matters).
 */

/** Manual order first; name only breaks ties (e.g. two people never dragged). */
export const PEOPLE_ORDER_SQL = 'ORDER BY p.sort_order, p.name';

export const LIST_PEOPLE_SQL = `SELECT p.* FROM people p ${PEOPLE_ORDER_SQL}`;
export const LIST_PEOPLE_BY_NAME_SQL = 'SELECT p.* FROM people p ORDER BY p.name';

/** A new person goes to the end of the manual order. */
export const INSERT_PERSON_SQL = `INSERT INTO people (id, name, unresolved, created_at, sort_order)
  VALUES (?, ?, ?, ?, (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM people))`;

export const SET_PERSON_ORDER_SQL = 'UPDATE people SET sort_order = ? WHERE id = ?';

/** Everyone with their §4.3 net balance in one query (no N+1), in manual order. */
export const LIST_PEOPLE_WITH_NET_SQL = `SELECT p.*, COALESCE(SUM(
       CASE t.direction
         WHEN 'lend'                    THEN  t.amount
         WHEN 'lend_repayment_received' THEN -t.amount
         WHEN 'borrow'                  THEN -t.amount
         WHEN 'borrow_repayment_made'   THEN  t.amount
       END), 0) AS net
     FROM people p
     LEFT JOIN transactions t
       ON t.person_id = p.id AND t.type = 'lending' AND t.status = 'approved'
     GROUP BY p.id
     ${PEOPLE_ORDER_SQL}`;
