import { describe, it, expect } from "vitest";
import { buildSummaries, dedupeSimilarTasks, dedupeNewBacklogTitles } from "./agent-data";

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

// dedupeSimilarTasks collapses a stalled agent's reworded re-plans of one task
// (newest-first in → newest representative kept) while keeping genuinely
// different tasks. This is what stops the "wall of budget-status cards".
describe("dedupeSimilarTasks", () => {
  const t = (title: string) => ({ title });

  it("collapses reworded variants of the same task to one (the newest)", () => {
    const rows = [
      t("Add today's budget-status (spent/cap/remaining/pct) endpoint to transparency API"),
      t("Add today's budget-status (spent/cap/remaining/pct) helper + endpoint to transparency API"),
      t("Add budgetStatus(spent/cap/remaining/pct) helper for transparency budget view"),
      t("Add today's budget-status (spent/cap/remaining) endpoint + helper to transparency API"),
    ];
    const out = dedupeSimilarTasks(rows);
    expect(out).toHaveLength(1);
    expect(out[0]).toBe(rows[0]); // newest representative kept
  });

  it("keeps genuinely different tasks even with shared words", () => {
    const rows = [
      t("Add holder count to the token page"),
      t("Add price chart to the token page"),
      t("Wire Vercel Analytics into the visitors stat"),
    ];
    expect(dedupeSimilarTasks(rows)).toHaveLength(3);
  });

  it("returns an empty list unchanged", () => {
    expect(dedupeSimilarTasks([])).toEqual([]);
  });
});

// dedupeNewBacklogTitles is the insertion-time guard for backlog grooming — it
// stops a stalled/retried tick from re-proposing the same logical task under a
// reworded title (the bug that produced 3 near-identical "landing hero" rows on
// one project's backlog in one morning).
describe("dedupeNewBacklogTitles", () => {
  const c = (title: string) => ({ title });

  it("drops an exact-title match regardless of status", () => {
    const existing = [{ title: "Add holder count to token page", status: "shipped" }];
    const out = dedupeNewBacklogTitles([c("Add holder count to token page")], existing, "unrelated");
    expect(out).toHaveLength(0);
  });

  it("drops a fuzzy-similar reworded title against a still-OPEN task (the ploop bug)", () => {
    const existing = [
      { title: "Build Loop landing page hero with game value prop and CTA buttons", status: "blocked" },
    ];
    const out = dedupeNewBacklogTitles(
      [c("Build the Loop landing page hero — game pitch and CTA buttons")],
      existing,
      "unrelated"
    );
    expect(out).toHaveLength(0);
  });

  it("allows a fuzzy-similar title through when the only match already SHIPPED", () => {
    // Re-proposing related work after the original shipped is legitimate (e.g.
    // extending a feature), so only OPEN tasks block a fuzzy match.
    const existing = [
      { title: "Build Loop landing page hero with game value prop and CTA buttons", status: "shipped" },
    ];
    const out = dedupeNewBacklogTitles(
      [c("Build the Loop landing page hero — game pitch and CTA buttons")],
      existing,
      "unrelated"
    );
    expect(out).toHaveLength(1);
  });

  it("drops the task just upserted this tick, and dedupes near-duplicates within the batch", () => {
    const out = dedupeNewBacklogTitles(
      [
        c("Add waitlist email capture"), // exact dup of taskTitle -> dropped
        c("Add waitlist signup form to landing page"), // survives, establishes the cluster
        c("Add a waitlist email signup form to the page"), // fuzzy-similar to the one above -> dropped
        c("Add breed roster preview"), // genuinely different -> survives
      ],
      [],
      "Add waitlist email capture"
    );
    expect(out.map((x) => x.title)).toEqual(["Add waitlist signup form to landing page", "Add breed roster preview"]);
  });

  it("keeps genuinely different candidates", () => {
    const out = dedupeNewBacklogTitles(
      [c("Add holder count to token page"), c("Wire Vercel Analytics into the visitors stat")],
      [],
      "unrelated"
    );
    expect(out).toHaveLength(2);
  });
});
