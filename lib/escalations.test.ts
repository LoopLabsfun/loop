import { describe, it, expect } from "vitest";
import { planResolution, isEscalationKind, ESCALATION_KINDS } from "./escalations";

describe("isEscalationKind", () => {
  it("accepts the four typed kinds and rejects others", () => {
    for (const k of ESCALATION_KINDS) expect(isEscalationKind(k)).toBe(true);
    expect(isEscalationKind("decision")).toBe(true);
    expect(isEscalationKind("nonsense")).toBe(false);
    expect(isEscalationKind(undefined)).toBe(false);
    expect(isEscalationKind(42)).toBe(false);
  });
});

describe("planResolution", () => {
  it("decision: adopts/declines, rejects a 'done' decision", () => {
    expect(planResolution("decision", "adopted")).toEqual({ ok: true, status: "adopted", note: null });
    expect(planResolution("decision", "declined")).toEqual({ ok: true, status: "declined", note: null });
    expect(planResolution("decision", "done")).toEqual({ ok: false, error: expect.any(String) });
  });

  it("info/action resolve as done and keep a trimmed note", () => {
    expect(planResolution("info", "done", "  use @looplabsfun  ")).toEqual({
      ok: true,
      status: "done",
      note: "use @looplabsfun",
    });
    expect(planResolution("action", "done", "funded 0.5 SOL")).toEqual({
      ok: true,
      status: "done",
      note: "funded 0.5 SOL",
    });
    // empty/whitespace note → null, not an empty string
    expect(planResolution("info", "done", "   ")).toEqual({ ok: true, status: "done", note: null });
  });

  it("SECURITY: credential never stores the response (no secret in the public table)", () => {
    const plan = planResolution("credential", "done", "sk-super-secret-key");
    expect(plan).toEqual({ ok: true, status: "done", note: null });
  });

  it("caps a note at 2000 chars", () => {
    const plan = planResolution("info", "done", "x".repeat(5000));
    expect(plan.ok && plan.note?.length).toBe(2000);
  });
});
