import { describe, it, expect } from "vitest";
import { effortForTask, type SdkEffort } from "./agent-effort";

type T = Parameters<typeof effortForTask>[0];
const task = (over: Partial<T> = {}): T => ({
  title: "Do a thing",
  detail: "somewhere in the app",
  category: "feature",
  ...over,
});

// No env override / no global ceiling unless a test sets it.
const NO_ENV: Record<string, string | undefined> = {};

describe("effortForTask — complexity classification", () => {
  it("rates mechanical/scoped work as low", () => {
    const p = effortForTask(
      task({ title: "Guard fmtPrice against non-finite input", detail: "clamp NaN to a fallback", category: "fix" }),
      NO_ENV
    );
    expect(p.effort).toBe<SdkEffort>("low");
    expect(p.maxTurns).toBe(12);
  });

  it("rates broad/multi-file work as high", () => {
    const p = effortForTask(
      task({ title: "Refactor the token page flow into a new component", detail: "restructure the route" }),
      NO_ENV
    );
    expect(p.effort).toBe<SdkEffort>("high");
    expect(p.maxTurns).toBe(40);
  });

  it("defaults a featureless feature to medium", () => {
    const p = effortForTask(task({ title: "Show the founder a recap", detail: "in the wallet" }), NO_ENV);
    expect(p.effort).toBe<SdkEffort>("medium");
    expect(p.maxTurns).toBe(24);
  });

  it("defaults a featureless fix to low (fixes tend to be scoped)", () => {
    const p = effortForTask(task({ title: "Fix the recap", detail: "in the wallet", category: "fix" }), NO_ENV);
    expect(p.effort).toBe<SdkEffort>("low");
  });

  it("breaks low/high ties toward high (depth over a marginal saving)", () => {
    // contains a HIGH ("component") and a LOW ("typo") signal — hi >= lo ⇒ high
    const p = effortForTask(task({ title: "Fix a typo in the new component", detail: "" }), NO_ENV);
    expect(p.effort).toBe<SdkEffort>("high");
  });
});

describe("effortForTask — retry escalation", () => {
  it("bumps effort one level after a prior failed attempt", () => {
    const base = task({ title: "Guard fmtPrice", detail: "clamp NaN", category: "fix" });
    expect(effortForTask(base, NO_ENV).effort).toBe<SdkEffort>("low");
    const retried = effortForTask({ ...base, lastOutcome: "last attempt FAILED tsc — TS2345" }, NO_ENV);
    expect(retried.effort).toBe<SdkEffort>("medium");
    expect(retried.reason).toMatch(/bumped after prior failure/);
  });

  it("does not bump past high", () => {
    const p = effortForTask(
      task({ title: "Refactor the architecture", detail: "system rewrite", lastOutcome: "FAILED" }),
      NO_ENV
    );
    expect(p.effort).toBe<SdkEffort>("high");
  });

  it("ignores a non-failure lastOutcome", () => {
    const p = effortForTask(
      task({ title: "Guard fmtPrice", detail: "clamp NaN", category: "fix", lastOutcome: "held: no check ran" }),
      NO_ENV
    );
    expect(p.effort).toBe<SdkEffort>("low");
  });
});

describe("effortForTask — env controls", () => {
  it("AGENT_SDK_EFFORT forces a fixed level for all tasks", () => {
    const p = effortForTask(
      task({ title: "Refactor the whole architecture", detail: "system rewrite" }),
      { AGENT_SDK_EFFORT: "low" }
    );
    expect(p.effort).toBe<SdkEffort>("low");
    expect(p.reason).toMatch(/forced/);
  });

  it("ignores an invalid AGENT_SDK_EFFORT and classifies normally", () => {
    const p = effortForTask(task({ title: "Guard fmtPrice", detail: "clamp NaN", category: "fix" }), {
      AGENT_SDK_EFFORT: "turbo",
    });
    expect(p.effort).toBe<SdkEffort>("low");
  });

  it("clamps per-task maxTurns under the AGENT_SDK_MAX_TURNS ceiling", () => {
    const p = effortForTask(task({ title: "Refactor the architecture", detail: "system rewrite" }), {
      AGENT_SDK_MAX_TURNS: "20",
    });
    expect(p.effort).toBe<SdkEffort>("high"); // would want 40 turns
    expect(p.maxTurns).toBe(20); // …but the global ceiling wins
  });

  it("hard-caps the ceiling at 100", () => {
    const p = effortForTask(task({ title: "Refactor the architecture", detail: "system rewrite" }), {
      AGENT_SDK_MAX_TURNS: "999",
    });
    expect(p.maxTurns).toBe(40); // high's own budget, well under the 100 cap
  });
});
