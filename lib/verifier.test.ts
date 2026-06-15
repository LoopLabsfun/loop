import { describe, it, expect } from "vitest";
import {
  defaultGate,
  evaluateGate,
  isIndependentlyVerified,
  canShip,
  gateTaskStatus,
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
