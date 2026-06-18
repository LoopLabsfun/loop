import { describe, it, expect } from "vitest";
import { buildSummaries } from "./agent-data";

// buildSummaries is pure (no DB) — it rolls up the real task rows into an honest
// per-day summary. Rows use the agent_tasks shape (id, title, status, created_at).
const DAY = 86_400_000;

describe("buildSummaries", () => {
  const now = Date.parse("2026-06-18T12:00:00Z");
  const at = (daysAgo: number) =>
    new Date(now - daysAgo * DAY).toISOString();

  it("labels today/yesterday and lists shipped titles", () => {
    const rows = [
      { id: 1, title: "Ship A", detail: "", category: "feature", status: "shipped", created_at: at(0) },
      { id: 2, title: "Build B", detail: "", category: "feature", status: "building", created_at: at(0) },
      { id: 3, title: "Ship C", detail: "", category: "fix", status: "shipped", created_at: at(1) },
    ];
    const out = buildSummaries(rows, now);
    expect(out[0].day).toBe("Today");
    expect(out[0].shipped).toEqual(["Ship A"]);
    expect(out[1].day).toBe("Yesterday");
    expect(out[1].shipped).toEqual(["Ship C"]);
  });

  it("notes a day where nothing shipped", () => {
    const rows = [
      { id: 1, title: "Build X", detail: "", category: "feature", status: "building", created_at: at(0) },
      { id: 2, title: "Build Y", detail: "", category: "ops", status: "todo", created_at: at(0) },
    ];
    const out = buildSummaries(rows, now);
    expect(out[0].shipped).toHaveLength(0);
    expect(out[0].note).toMatch(/nothing shipped/i);
    expect(out[0].note).toMatch(/2 tasks/);
  });

  it("returns [] for no rows", () => {
    expect(buildSummaries([], now)).toEqual([]);
  });
});
