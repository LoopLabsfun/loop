import { describe, it, expect } from 'vitest';
import { budgetStatus } from './budget-status';

describe('budgetStatus', () => {
  it('computes a normal partial spend', () => {
    const s = budgetStatus(0.25, 1);
    expect(s.spent).toBe(0.25);
    expect(s.cap).toBe(1);
    expect(s.remaining).toBe(0.75);
    expect(s.pct).toBeCloseTo(25, 6);
  });

  it('caps spent at the cap and floors remaining at 0', () => {
    const s = budgetStatus(5, 2);
    expect(s.spent).toBe(2);
    expect(s.remaining).toBe(0);
    expect(s.pct).toBe(100);
  });

  it('returns pct 0 and remaining 0 for a zero cap', () => {
    const s = budgetStatus(1, 0);
    expect(s.cap).toBe(0);
    expect(s.spent).toBe(0);
    expect(s.remaining).toBe(0);
    expect(s.pct).toBe(0);
  });

  it('floors negative inputs to 0', () => {
    const s = budgetStatus(-3, -1);
    expect(s.spent).toBe(0);
    expect(s.cap).toBe(0);
    expect(s.remaining).toBe(0);
    expect(s.pct).toBe(0);
  });

  it('treats NaN inputs as 0', () => {
    const s = budgetStatus(Number.NaN, Number.NaN);
    expect(s.spent).toBe(0);
    expect(s.cap).toBe(0);
    expect(s.remaining).toBe(0);
    expect(s.pct).toBe(0);
  });

  it('clamps pct to 100 even with a tiny over-spend', () => {
    const s = budgetStatus(1.0000001, 1);
    expect(s.pct).toBeLessThanOrEqual(100);
    expect(s.remaining).toBeGreaterThanOrEqual(0);
  });

  describe('over flag', () => {
    it('is true when floored spend genuinely exceeds the cap', () => {
      const s = budgetStatus(5, 2);
      expect(s.over).toBe(true);
    });

    it('is true even for a tiny over-spend the clamp would otherwise hide', () => {
      const s = budgetStatus(1.0000001, 1);
      expect(s.over).toBe(true);
      expect(s.spent).toBe(1);
      expect(s.pct).toBe(100);
    });

    it('is false exactly at the cap', () => {
      const s = budgetStatus(2, 2);
      expect(s.over).toBe(false);
      expect(s.pct).toBe(100);
    });

    it('is false for a partial spend', () => {
      const s = budgetStatus(0.5, 1);
      expect(s.over).toBe(false);
    });

    it('is false for a zero cap with no spend', () => {
      const s = budgetStatus(0, 0);
      expect(s.over).toBe(false);
    });

    it('is true for any positive spend against a zero cap', () => {
      const s = budgetStatus(1, 0);
      expect(s.over).toBe(true);
    });
  });
});
