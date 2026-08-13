import { describe, expect, it } from '@jest/globals';

import { allocateSettlement, outstandingMinor, type SettlementCharge } from '@/domain/settlement';

// Three charges, oldest → newest, totalling Rs950 (95000 minor).
const charges: SettlementCharge[] = [
  { id: 'a', name: 'Lunch', occurredAt: '2026-08-01T10:00:00.000Z', source: 'manual', amountMinor: 20000 },
  { id: 'b', name: 'Taxi', occurredAt: '2026-08-05T10:00:00.000Z', source: 'manual', amountMinor: 30000 },
  { id: 'c', name: 'Dinner', occurredAt: '2026-08-09T10:00:00.000Z', source: 'bill_split', amountMinor: 45000 },
];

describe('settlement — outstanding', () => {
  it('is the charges total minus prior repayments, floored at 0', () => {
    expect(outstandingMinor(charges, 0)).toBe(95000);
    expect(outstandingMinor(charges, 20000)).toBe(75000);
    expect(outstandingMinor(charges, 99999)).toBe(0);
    expect(outstandingMinor([], 0)).toBe(0);
  });
});

describe('settlement — FIFO allocation', () => {
  it('settlement smaller than the oldest charge covers it partially', () => {
    const cov = allocateSettlement(charges, 0, 8000); // Rs80 of the Rs200 lunch
    expect(cov).toHaveLength(1);
    expect(cov[0]).toMatchObject({ id: 'a', coveredMinor: 8000, chargeMinor: 20000 });
  });

  it('settlement exactly matching the oldest charge covers just it', () => {
    const cov = allocateSettlement(charges, 0, 20000);
    expect(cov.map((c) => c.id)).toEqual(['a']);
    expect(cov[0]!.coveredMinor).toBe(20000);
  });

  it('settlement spanning several charges covers oldest→newest, last partial', () => {
    const cov = allocateSettlement(charges, 0, 80000); // 20000 + 30000 + 30000
    expect(cov.map((c) => c.id)).toEqual(['a', 'b', 'c']);
    expect(cov.map((c) => c.coveredMinor)).toEqual([20000, 30000, 30000]);
    expect(cov[2]!.chargeMinor).toBe(45000); // charge is 45000, only 30000 covered
  });

  it('settlement equal to the whole outstanding covers everything', () => {
    const cov = allocateSettlement(charges, 0, 95000);
    expect(cov.map((c) => c.coveredMinor)).toEqual([20000, 30000, 45000]);
  });

  it('prior repayments settle the oldest charges first, so a new settlement starts later', () => {
    // Rs250 already repaid → charge a (200) fully gone; b (300) has 250 left.
    const cov = allocateSettlement(charges, 25000, 30000); // settle Rs300 more
    expect(cov[0]).toMatchObject({ id: 'b', coveredMinor: 25000 }); // finish b's remaining 250
    expect(cov[1]).toMatchObject({ id: 'c', coveredMinor: 5000 }); // then 50 of dinner
    expect(cov).toHaveLength(2);
  });

  it('returns nothing when there are no charges or the amount is ≤ 0', () => {
    expect(allocateSettlement([], 0, 10000)).toEqual([]);
    expect(allocateSettlement(charges, 0, 0)).toEqual([]);
    expect(allocateSettlement(charges, 0, -500)).toEqual([]);
  });

  it('never allocates past what remains (prior repayments cover all)', () => {
    expect(allocateSettlement(charges, 95000, 10000)).toEqual([]);
  });

  it('sorts unordered charges before allocating', () => {
    const shuffled = [charges[2]!, charges[0]!, charges[1]!];
    const cov = allocateSettlement(shuffled, 0, 25000); // 200 lunch + 50 of taxi
    expect(cov.map((c) => c.id)).toEqual(['a', 'b']);
    expect(cov.map((c) => c.coveredMinor)).toEqual([20000, 5000]);
  });
});
