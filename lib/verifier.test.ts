import { describe, it, expect } from "vitest";
import {
  defaultGate,
  evaluateGate,
  isIndependentlyVerified,
  canShip,
  gateTaskStatus,
  gateAgentShip,
  checkFromSandbox,
  classifyCheck,
  type VerifyCheck,
} from "./verifier";

const chk = (kind: VerifyCheck["kind"], passed: boolean): VerifyCheck => ({
  kind,
  name: kind,
  passed,
});

describe("defaultGate", () => {
  it("floor is build + typecheck; official also needs test + lint", () => {
    expect(defaultGate({ official: false })).toEqual(["build", "typecheck"]);
    expect(defaultGate({ official: true })).toEqual([
      "build",
      "typecheck",
      "test",
      "lint",
    ]);
  });
});

describe("evaluateGate", () => {
  it("passes only when all required present and green", () => {
    const r = evaluateGate(
      [chk("build", true), chk("typecheck", true)],
      ["build", "typecheck"]
    );
    expect(r.passed).toBe(true);
  });
  it("fails on a missing required check (would ship blind)", () => {
    const r = evaluateGate([chk("build", true)], ["build", "typecheck"]);
    expect(r.passed).toBe(false);
    expect(r.missing).toContain("typecheck");
  });
  it("fails on a recorded failing check", () => {
    const r = evaluateGate(
      [chk("build", true), chk("typecheck", false)],
      ["build", "typecheck"]
    );
    expect(r.passed).toBe(false);
    expect(r.failed.map((c) => c.kind)).toContain("typecheck");
  });
});

describe("isIndependentlyVerified (maker ≠ checker)", () => {
  it("true only for two distinct non-empty ids", () => {
    expect(isIndependentlyVerified("agent:loop", "ci")).toBe(true);
    expect(isIndependentlyVerified("agent:loop", "agent:loop")).toBe(false);
    expect(isIndependentlyVerified("agent:loop", "")).toBe(false);
    expect(isIndependentlyVerified(null, "ci")).toBe(false);
    expect(isIndependentlyVerified(" x ", "x")).toBe(false); // trimmed-equal
  });
});

describe("canShip", () => {
  const greenGate = evaluateGate([chk("build", true), chk("typecheck", true)], [
    "build",
    "typecheck",
  ]);
  it("blocks when maker == checker even with a green gate", () => {
    expect(canShip({ gate: greenGate, makerId: "a", checkerId: "a" }).ok).toBe(false);
  });
  it("blocks when gate failed even with a distinct checker", () => {
    const red = evaluateGate([chk("build", false)], ["build", "typecheck"]);
    expect(canShip({ gate: red, makerId: "a", checkerId: "ci" }).ok).toBe(false);
  });
  it("allows only with distinct checker AND green gate", () => {
    expect(canShip({ gate: greenGate, makerId: "a", checkerId: "ci" }).ok).toBe(true);
  });
});

describe("gateTaskStatus", () => {
  const p = { official: false };
  it("passes non-shipped statuses through untouched", () => {
    for (const s of ["todo", "building", "blocked"] as const) {
      expect(gateTaskStatus({ project: p, status: s, makerId: "agent:loop" })).toEqual({
        status: s,
        note: null,
      });
    }
  });
  it("downgrades a self-claimed 'shipped' (no checker) to 'building'", () => {
    const r = gateTaskStatus({ project: p, status: "shipped", makerId: "agent:loop" });
    expect(r.status).toBe("building");
    expect(r.note).toMatch(/checker distinct from its maker/);
  });
  it("downgrades 'shipped' when checker exists but gate is missing checks", () => {
    const r = gateTaskStatus({
      project: p,
      status: "shipped",
      makerId: "agent:loop",
      checkerId: "ci",
    });
    expect(r.status).toBe("building");
  });
  it("allows 'shipped' with a distinct checker and a passing gate", () => {
    const r = gateTaskStatus({
      project: p,
      status: "shipped",
      makerId: "agent:loop",
      checkerId: "ci",
      checks: [chk("build", true), chk("typecheck", true)],
    });
    expect(r.status).toBe("shipped");
    expect(r.note).toBeNull();
  });
});

describe("classifyCheck", () => {
  it("labels common runners by what they ran", () => {
    expect(classifyCheck("pytest -q")).toBe("test");
    expect(classifyCheck("npm test")).toBe("test");
    expect(classifyCheck("npx vitest run")).toBe("test");
    expect(classifyCheck("tsc --noEmit")).toBe("typecheck");
    expect(classifyCheck("npm run build")).toBe("build");
    expect(classifyCheck("next build")).toBe("build");
    expect(classifyCheck("eslint .")).toBe("lint");
    expect(classifyCheck("ruff check")).toBe("lint");
    expect(classifyCheck("python data.py")).toBe("custom");
  });
});

describe("checkFromSandbox", () => {
  it("maps a green run to a passing, named check", () => {
    const c = checkFromSandbox(
      { language: "bash", code: "npm test" },
      { ok: true, stderr: "" }
    );
    expect(c.passed).toBe(true);
    expect(c.kind).toBe("test");
    expect(c.name).toBe("e2b:bash");
  });
  it("maps a failing run to a failing check with the error detail", () => {
    const c = checkFromSandbox(
      { language: "python", code: "pytest" },
      { ok: false, error: "1 failed", stderr: "AssertionError" }
    );
    expect(c.passed).toBe(false);
    expect(c.detail).toContain("1 failed");
  });
});

describe("gateAgentShip (runtime per-cycle gate)", () => {
  it("passes non-shipped statuses through untouched", () => {
    for (const s of ["todo", "building", "blocked"] as const) {
      expect(
        gateAgentShip({ status: s, makerId: "agent:loop", checks: [] })
      ).toEqual({ status: s, note: null });
    }
  });
  it("holds 'shipped' when no objective check ran (nothing could fail)", () => {
    const r = gateAgentShip({ status: "shipped", makerId: "agent:loop", checks: [] });
    expect(r.status).toBe("building");
    expect(r.note).toMatch(/no objective check/);
  });
  it("holds 'shipped' when the checker is not independent of the maker", () => {
    const r = gateAgentShip({
      status: "shipped",
      makerId: "agent:loop",
      checkerId: "agent:loop",
      checks: [chk("test", true)],
    });
    expect(r.status).toBe("building");
  });
  it("holds 'shipped' when a recorded check failed", () => {
    const r = gateAgentShip({
      status: "shipped",
      makerId: "agent:loop",
      checkerId: "verifier:e2b",
      checks: [chk("test", false)],
    });
    expect(r.status).toBe("building");
  });
  it("ships when an independent checker ran ≥1 passing check (not the full 4-kind gate)", () => {
    const r = gateAgentShip({
      status: "shipped",
      makerId: "agent:loop",
      checkerId: "verifier:e2b",
      checks: [chk("test", true)],
    });
    expect(r.status).toBe("shipped");
    expect(r.note).toBeNull();
  });
});
