/**
 * Settle-up allocation (spec §3.5; "what this covers"). A person's outstanding
 * balance is the sum of "charge" lending transactions minus prior repayments
 * (technical-plan §4.3). The app stores settlements as plain repayment rows —
 * there is no per-charge link — so which charges a repayment covers is DERIVED
 * chronologically (FIFO): the oldest charges are settled first.
 *
 * This module is pure and tested. It:
 *   1. consumes prior repayments against the oldest charges to get the
 *      still-outstanding amount per charge, then
 *   2. allocates the NEW settlement across those remaining charges, oldest
 *      first, splitting the final charge partially when the amount runs out.
 *
 * Amounts are integer minor units throughout.
 */

export interface SettlementCharge {
  id: string;
  name: string;
  /** ISO timestamp; ordering key for FIFO. */
  occurredAt: string;
  /** 'bill_split' | 'manual' | 'voice' | 'recurring' — for the subtitle. */
  source: string;
  amountMinor: number;
}

export interface SettlementCoverage {
  id: string;
  name: string;
  occurredAt: string;
  source: string;
  /** The charge's original amount. */
  chargeMinor: number;
  /** How much of the charge THIS settlement covers (≤ its remaining). */
  coveredMinor: number;
}

/** Sum of the charges still outstanding after prior repayments (never < 0). */
export function outstandingMinor(charges: SettlementCharge[], priorRepaidMinor: number): number {
  const total = charges.reduce((sum, c) => sum + c.amountMinor, 0);
  return Math.max(0, total - Math.max(0, priorRepaidMinor));
}

/**
 * Which charges a settlement of `settlementMinor` covers, oldest first.
 * Returns only the charges the settlement actually touches, each with the
 * covered amount (the last may be partial). Empty when there is nothing to
 * cover or the amount is ≤ 0.
 */
export function allocateSettlement(
  charges: SettlementCharge[],
  priorRepaidMinor: number,
  settlementMinor: number,
): SettlementCoverage[] {
  const sorted = [...charges].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));

  // 1) Apply prior repayments to the oldest charges to get remaining-per-charge.
  let prior = Math.max(0, priorRepaidMinor);
  const remaining = sorted.map((charge) => {
    const applied = Math.min(prior, charge.amountMinor);
    prior -= applied;
    return { charge, remainingMinor: charge.amountMinor - applied };
  });

  // 2) Allocate this settlement across the still-outstanding charges, FIFO.
  let toAllocate = Math.max(0, settlementMinor);
  const coverage: SettlementCoverage[] = [];
  for (const { charge, remainingMinor } of remaining) {
    if (toAllocate <= 0) break;
    if (remainingMinor <= 0) continue;
    const coveredMinor = Math.min(toAllocate, remainingMinor);
    toAllocate -= coveredMinor;
    coverage.push({
      id: charge.id,
      name: charge.name,
      occurredAt: charge.occurredAt,
      source: charge.source,
      chargeMinor: charge.amountMinor,
      coveredMinor,
    });
  }
  return coverage;
}
