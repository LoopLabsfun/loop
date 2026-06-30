import { describe, it, expect } from "vitest";
import { triStatus, checklistReady } from "./provisioning-check";

describe("triStatus", () => {
  it("maps null→unarmed, true→ok, false→missing", () => {
    expect(triStatus(null)).toBe("unarmed");
    expect(triStatus(true)).toBe("ok");
    expect(triStatus(false)).toBe("missing");
  });
});

describe("checklistReady", () => {
  it("is ready when no brick is missing (unarmed does not block)", () => {
    expect(checklistReady([{ status: "ok" }, { status: "ok" }])).toBe(true);
    expect(checklistReady([{ status: "ok" }, { status: "unarmed" }])).toBe(true);
    expect(checklistReady([{ status: "ok" }, { status: "missing" }])).toBe(false);
    expect(checklistReady([])).toBe(true);
  });
});
