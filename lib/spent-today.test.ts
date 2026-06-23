import { describe, it, expect } from "vitest";
import { spentTodaySol, type ActionRecord } from "./spent-today";

const NOW = Date.UTC(2024, 0, 2, 12, 0, 0); // fixed reference
const HOUR = 60 * 60 * 1000;

describe("spentTodaySol", () => {
  it("returns 0 for empty/nullish input", () => {
    expect(spentTodaySol([], NOW)).toBe(0);
    expect(spentTodaySol(null, NOW)).toBe(0);
    expect(spentTodaySol(undefined, NOW)).toBe(0);
  });

  it("sums only executed actions within the 24h window", () => {
    const records: ActionRecord[] = [
      { amountSol: 0.5, executed: true, executedAt: NOW - HOUR },
      { amountSol: 0.3, executed: true, executedAt: NOW - 2 * HOUR },
    ];
    expect(spentTodaySol(records, NOW)).toBeCloseTo(0.8, 10);
  });

  it("ignores non-executed (simulated/escalated/blocked) actions", () => {
    const records: ActionRecord[] = [
      { amountSol: 1, executed: false, executedAt: NOW - HOUR },
      { amountSol: 1, executedAt: NOW - HOUR }, // executed undefined
      { amountSol: 0.2, executed: true, executedAt: NOW - HOUR },
    ];
    expect(spentTodaySol(records, NOW)).toBeCloseTo(0.2, 10);
  });

  it("excludes records outside the window (older or future)", () => {
    const records: ActionRecord[] = [
      { amountSol: 0.4, executed: true, executedAt: NOW - 25 * HOUR },
      { amountSol: 0.4, executed: true, executedAt: NOW + HOUR },
      { amountSol: 0.1, executed: true, executedAt: NOW - HOUR },
    ];
    expect(spentTodaySol(records, NOW)).toBeCloseTo(0.1, 10);
  });

  it("excludes records with missing or unparseable timestamps", () => {
    const records: ActionRecord[] = [
      { amountSol: 0.4, executed: true },
      { amountSol: 0.4, executed: true, executedAt: "not-a-date" },
      { amountSol: 0.1, executed: true, executedAt: NOW - HOUR },
    ];
    expect(spentTodaySol(records, NOW)).toBeCloseTo(0.1, 10);
  });

  it("parses ISO string and Date timestamps", () => {
    const records: ActionRecord[] = [
      { amountSol: 0.2, executed: true, executedAt: new Date(NOW - HOUR).toISOString() },
      { amountSol: 0.3, executed: true, executedAt: new Date(NOW - 2 * HOUR) },
    ];
    expect(spentTodaySol(records, NOW)).toBeCloseTo(0.5, 10);
  });

  it("treats negative/NaN amounts as 0", () => {
    const records: ActionRecord[] = [
      { amountSol: -5, executed: true, executedAt: NOW - HOUR },
      { amountSol: Number.NaN, executed: true, executedAt: NOW - HOUR },
      { amountSol: 0.25, executed: true, executedAt: NOW - HOUR },
    ];
    expect(spentTodaySol(records, NOW)).toBeCloseTo(0.25, 10);
  });

  it("honours a custom window", () => {
    const records: ActionRecord[] = [
      { amountSol: 0.3, executed: true, executedAt: NOW - 3 * HOUR },
      { amountSol: 0.2, executed: true, executedAt: NOW - HOUR },
    ];
    // 2h window excludes the 3h-old record
    expect(spentTodaySol(records, NOW, 2 * HOUR)).toBeCloseTo(0.2, 10);
  });
});
