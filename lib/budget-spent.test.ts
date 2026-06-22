import { describe, it, expect } from 'vitest';
import { spentTodaySol, type SpendEntry } from './budget-spent';

const NOW = Date.parse('2024-01-02T12:00:00.000Z');
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();

describe('spentTodaySol', () => {
  it('sums only executed actions in the window', () => {
    const entries: SpendEntry[] = [
      { amountSol: 0.5, disposition: 'executed', at: iso(1_000) },
      { amountSol: 0.25, disposition: 'executed', at: iso(2_000) },
      { amountSol: 9, disposition: 'simulated', at: iso(3_000) },
      { amountSol: 9, disposition: 'escalated', at: iso(4_000) },
      { amountSol: 9, disposition: 'denied', at: iso(5_000) },
    ];
    expect(spentTodaySol(entries, NOW)).toBeCloseTo(0.75, 9);
  });

  it('excludes actions older than the rolling window', () => {
    const entries: SpendEntry[] = [
      { amountSol: 1, disposition: 'executed', at: iso(23 * 60 * 60 * 1000) },
      { amountSol: 1, disposition: 'executed', at: iso(25 * 60 * 60 * 1000) },
    ];
    expect(spentTodaySol(entries, NOW)).toBeCloseTo(1, 9);
  });

  it('ignores future-dated and unparseable timestamps', () => {
    const entries: SpendEntry[] = [
      { amountSol: 1, disposition: 'executed', at: new Date(NOW + 60_000).toISOString() },
      { amountSol: 1, disposition: 'executed', at: 'not-a-date' },
    ];
    expect(spentTodaySol(entries, NOW)).toBe(0);
  });

  it('treats negative and NaN amounts as 0', () => {
    const entries: SpendEntry[] = [
      { amountSol: -5, disposition: 'executed', at: iso(1_000) },
      { amountSol: Number.NaN, disposition: 'executed', at: iso(1_000) },
      { amountSol: 0.3, disposition: 'executed', at: iso(1_000) },
    ];
    expect(spentTodaySol(entries, NOW)).toBeCloseTo(0.3, 9);
  });

  it('returns 0 for an empty list', () => {
    expect(spentTodaySol([], NOW)).toBe(0);
  });

  it('respects a custom window', () => {
    const entries: SpendEntry[] = [
      { amountSol: 1, disposition: 'executed', at: iso(30 * 60 * 1000) },
      { amountSol: 1, disposition: 'executed', at: iso(90 * 60 * 1000) },
    ];
    expect(spentTodaySol(entries, NOW, 60 * 60 * 1000)).toBeCloseTo(1, 9);
  });
});
