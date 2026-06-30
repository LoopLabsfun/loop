import { describe, it, expect } from "vitest";
import {
  tickCadenceMinutes,
  cadenceBounds,
  type CadenceBounds,
  type CadenceSignals,
  DEFAULT_MIN_CADENCE_MIN,
  DEFAULT_MAX_CADENCE_MIN,
} from "./agent-cadence";

const BOUNDS: CadenceBounds = { baseMin: 60, minMin: 15, maxMin: 720 };
const FUNDED = { treasurySol: 1, needSol: 0.01 }; // comfortable runway

function sig(over: Partial<CadenceSignals> = {}): CadenceSignals {
  return { ...FUNDED, openTodos: 0, inFlight: 0, unansweredInbound: 0, ...over };
}

describe("tickCadenceMinutes", () => {
  it("ticks sooner when there's a hot, fundable backlog", () => {
    const m = tickCadenceMinutes(sig({ openTodos: 5 }), BOUNDS);
    expect(m).toBe(30); // 60 * 0.5
  });

  it("backs off hard when completely idle (nothing queued or building)", () => {
    const m = tickCadenceMinutes(sig({ openTodos: 0, inFlight: 0 }), BOUNDS);
    expect(m).toBe(240); // 60 * 4
  });

  it("eases off when work is piling up unfinished (congestion)", () => {
    // openWork 0, inFlight 8 → 60 * 1.5 (idle-but-building) * 2 (congestion) = 180
    const m = tickCadenceMinutes(sig({ inFlight: 8 }), BOUNDS);
    expect(m).toBe(180);
  });

  it("stretches the cadence when the treasury runway is thin", () => {
    const hot = sig({ openTodos: 5 });
    const rich = tickCadenceMinutes(hot, BOUNDS); // 30
    const thin = tickCadenceMinutes(
      { ...hot, treasurySol: 0.012, needSol: 0.01 }, // ratio 1.2 < 1.5
      BOUNDS
    );
    expect(thin).toBeGreaterThan(rich);
    expect(thin).toBe(45); // 60 * 0.5 * 1.5
  });

  it("never ticks faster than the floor or slower than the ceiling", () => {
    const tiny: CadenceBounds = { baseMin: 1, minMin: 15, maxMin: 720 };
    expect(tickCadenceMinutes(sig({ openTodos: 9 }), tiny)).toBe(15); // floored
    const huge: CadenceBounds = { baseMin: 100000, minMin: 15, maxMin: 720 };
    expect(tickCadenceMinutes(sig(), huge)).toBe(720); // ceilinged
  });

  it("treats unanswered inbound as demand", () => {
    const m = tickCadenceMinutes(sig({ unansweredInbound: 3 }), BOUNDS);
    expect(m).toBe(30); // 60 * 0.5
  });
});

describe("cadenceBounds", () => {
  it("defaults base to the global cooldown and uses sane floor/ceiling", () => {
    const b = cadenceBounds({});
    expect(b.minMin).toBe(DEFAULT_MIN_CADENCE_MIN);
    expect(b.maxMin).toBe(DEFAULT_MAX_CADENCE_MIN);
    expect(b.baseMin).toBeGreaterThan(0);
  });

  it("reads AGENT_TICK_COOLDOWN_MIN as the base and env overrides for bounds", () => {
    const b = cadenceBounds({
      AGENT_TICK_COOLDOWN_MIN: "30",
      AGENT_TICK_MIN_MIN: "10",
      AGENT_TICK_MAX_MIN: "120",
    });
    expect(b).toEqual({ baseMin: 30, minMin: 10, maxMin: 120 });
  });

  it("keeps minMin ≤ maxMin even if env inverts them", () => {
    const b = cadenceBounds({ AGENT_TICK_MIN_MIN: "500", AGENT_TICK_MAX_MIN: "100" });
    expect(b.minMin).toBeLessThanOrEqual(b.maxMin);
  });
});
